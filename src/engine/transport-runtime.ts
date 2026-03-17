import type { Transport } from './sequencer-types';

export type TransportStatus = Transport['status'];

export interface RuntimeTransportState {
  status: TransportStatus;
  playheadBeats: number;
  anchorAudioTime: number | null;
  generation: number;
  bpm: number;
  swing: number;
}

/** @deprecated No-op — kept temporarily so call sites compile. Remove in a follow-up. */
export function normalizeTransport(transport: Transport): Transport {
  return transport;
}

export function createRuntimeTransport(transport: Transport): RuntimeTransportState {
  const normalized = normalizeTransport(transport);
  return {
    // Runtime transport tracks the live scheduler/audio state, not just the
    // persisted session intent. Start cold and let TransportController.sync()
    // reconcile from session transport so first-play works even if the
    // controller is created after session.transport flips to "playing".
    status: 'stopped',
    playheadBeats: 0,
    anchorAudioTime: null,
    generation: 0,
    bpm: normalized.bpm,
    swing: normalized.swing,
  };
}

export function playTransportState(state: RuntimeTransportState, audioTime: number, generation: number): RuntimeTransportState {
  return {
    ...state,
    status: 'playing',
    anchorAudioTime: audioTime,
    generation,
  };
}

export function pauseTransportState(state: RuntimeTransportState, generation: number): RuntimeTransportState {
  return {
    ...state,
    status: 'paused',
    anchorAudioTime: null,
    generation,
  };
}

export function stopTransportState(state: RuntimeTransportState, generation: number): RuntimeTransportState {
  return {
    ...state,
    status: 'stopped',
    playheadBeats: 0,
    anchorAudioTime: null,
    generation,
  };
}
