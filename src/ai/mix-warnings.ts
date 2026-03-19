import type { Session } from '../engine/types';
import { getTrackKind, MASTER_BUS_ID } from '../engine/types';
import type { SpectralSlotManager } from '../engine/spectral-slots';
import type { AudioMetricsSnapshot } from '../audio/live-audio-metrics';

export type MixWarningType = 'clipping' | 'low_headroom' | 'overcompressed' | 'masking';

export interface MixWarning {
  type: MixWarningType;
  severity: number;
  message: string;
  trackId?: string;
  trackIds?: string[];
  trackLabel?: string;
  trackLabels?: string[];
  band?: string;
  peak?: number;
  headroom?: number;
  crest?: number;
  rms?: number;
}

const CLIPPING_THRESHOLD_DB = -0.3;
const LOW_HEADROOM_THRESHOLD_DB = -3;
const OVERCOMPRESSED_CREST_THRESHOLD_DB = 4;
const OVERCOMPRESSED_RMS_THRESHOLD_DB = -16;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getTrackLabel(session: Session, trackId: string): string {
  if (trackId === MASTER_BUS_ID) return 'Master Bus';
  const track = session.tracks.find(t => t.id === trackId);
  if (!track) return trackId;
  return track.name ?? trackId;
}

export function deriveMixWarnings(
  session: Session,
  audioMetrics: AudioMetricsSnapshot | undefined,
  spectralSlots: SpectralSlotManager,
): MixWarning[] {
  const warnings: MixWarning[] = [];

  if (audioMetrics) {
    if (audioMetrics.master.peak >= CLIPPING_THRESHOLD_DB) {
      warnings.push({
        type: 'clipping',
        severity: 1,
        trackId: MASTER_BUS_ID,
        trackLabel: 'Master Bus',
        peak: audioMetrics.master.peak,
        message: `Master Bus is clipping at ${audioMetrics.master.peak} dBFS. Pull levels back before making more tonal decisions.`,
      });
    } else if (audioMetrics.master.peak >= LOW_HEADROOM_THRESHOLD_DB) {
      const headroom = Math.max(0, -audioMetrics.master.peak);
      warnings.push({
        type: 'low_headroom',
        severity: clamp01(
          (audioMetrics.master.peak - LOW_HEADROOM_THRESHOLD_DB)
          / (CLIPPING_THRESHOLD_DB - LOW_HEADROOM_THRESHOLD_DB),
        ),
        trackId: MASTER_BUS_ID,
        trackLabel: 'Master Bus',
        peak: audioMetrics.master.peak,
        headroom: Math.round(headroom * 10) / 10,
        message: `Master Bus headroom is down to ${Math.round(headroom * 10) / 10} dB. Further boosts risk clipping.`,
      });
    }
    if (audioMetrics.master.crest <= OVERCOMPRESSED_CREST_THRESHOLD_DB && audioMetrics.master.rms >= OVERCOMPRESSED_RMS_THRESHOLD_DB) {
      warnings.push({
        type: 'overcompressed',
        severity: clamp01((OVERCOMPRESSED_CREST_THRESHOLD_DB - audioMetrics.master.crest) / 4 + 0.35),
        trackId: MASTER_BUS_ID,
        trackLabel: 'Master Bus',
        crest: audioMetrics.master.crest,
        rms: audioMetrics.master.rms,
        message: `Master Bus looks over-compressed (crest ${audioMetrics.master.crest} dB, RMS ${audioMetrics.master.rms} dBFS).`,
      });
    }

    for (const [trackId, frame] of Object.entries(audioMetrics.tracks)) {
      if (frame.peak >= CLIPPING_THRESHOLD_DB) {
        warnings.push({
          type: 'clipping',
          severity: 1,
          trackId,
          trackLabel: getTrackLabel(session, trackId),
          peak: frame.peak,
          message: `${getTrackLabel(session, trackId)} is clipping at ${frame.peak} dBFS.`,
        });
      }
      if (frame.crest <= OVERCOMPRESSED_CREST_THRESHOLD_DB && frame.rms >= OVERCOMPRESSED_RMS_THRESHOLD_DB) {
        warnings.push({
          type: 'overcompressed',
          severity: clamp01((OVERCOMPRESSED_CREST_THRESHOLD_DB - frame.crest) / 4 + 0.35),
          trackId,
          trackLabel: getTrackLabel(session, trackId),
          crest: frame.crest,
          rms: frame.rms,
          message: `${getTrackLabel(session, trackId)} looks over-compressed (crest ${frame.crest} dB, RMS ${frame.rms} dBFS).`,
        });
      }
    }
  }

  const collisions = spectralSlots.detectCollisions();
  for (const collision of collisions) {
    warnings.push({
      type: 'masking',
      severity: clamp01(0.65 + Math.min(0.25, collision.losers.length * 0.1)),
      trackIds: collision.trackIds,
      trackLabels: collision.trackIds.map(trackId => getTrackLabel(session, trackId)),
      band: collision.band,
      message: `Spectral masking risk in the ${collision.band} band between ${collision.trackIds.map(trackId => getTrackLabel(session, trackId)).join(', ')}.`,
    });
  }

  const activeAudioTracks = session.tracks.filter(
    track => getTrackKind(track) === 'audio' && !track.muted,
  );
  const unslottedTracks = activeAudioTracks.filter(track => !spectralSlots.get(track.id));
  if (activeAudioTracks.length >= 3 && unslottedTracks.length > 0) {
    warnings.push({
      type: 'masking',
      severity: clamp01(0.45 + unslottedTracks.length * 0.1),
      trackIds: unslottedTracks.map(track => track.id),
      trackLabels: unslottedTracks.map(track => track.name ?? track.id),
      message:
        `${activeAudioTracks.length} active audio tracks have no spectral slot coverage for ` +
        `${unslottedTracks.length} track(s): ${unslottedTracks.map(track => track.name ?? track.id).join(', ')}.`,
    });
  }

  return warnings;
}
