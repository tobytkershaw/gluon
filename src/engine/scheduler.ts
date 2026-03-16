// src/engine/scheduler.ts
import type { Session, SynthParamValues, Track } from './types';
import type { ScheduledNote } from './sequencer-types';
import type { MusicalEvent, Region, TriggerEvent, NoteEvent, ParameterEvent } from './canonical-types';
import { getAudibleTracks, resolveEventParams } from './sequencer-helpers';
import { controlIdToRuntimeParam } from '../audio/instrument-registry';
import { recordQaAudioTrace } from '../qa/audio-trace';
import { buildRuntimeEventId, PlaybackPlan } from './playback-plan';

const LOOKAHEAD_MS = 25;
const LOOKAHEAD_SEC = 0.1;
/** Safety margin so first-beat events have future timestamps in the worklet. */
export const START_OFFSET_SEC = 0.05;
/** Max steps the scheduler will catch up after a resume — longer gaps are lossy. */
export const MAX_CATCHUP_STEPS = 8;

/**
 * Binary search: find index of first event with `at >= target`.
 * Events must be sorted by `at` (canonical invariant #4).
 */
function lowerBound(events: MusicalEvent[], target: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (events[mid].at < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class Scheduler {
  private getSession: () => Session;
  private getAudioTime: () => number;
  private getAudioState: () => AudioContextState | undefined;
  private onNote: (note: ScheduledNote) => void;
  private onPositionChange: (globalStep: number) => void;
  private getHeldParams: (trackId: string) => Partial<SynthParamValues>;
  private onParameterEvent?: (trackId: string, controlId: string, value: number | string | boolean) => void;
  private onClick?: (time: number, accent: boolean) => void;

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private cursor = 0; // absolute step units (fractional)
  private startTime = 0;
  private previousBpm = 0;
  private generation = 0;
  private playbackPlan = new PlaybackPlan();
  /** Next metronome step to schedule (in absolute step units, always a multiple of 4). */
  private nextClickStep = 0;

  constructor(
    getSession: () => Session,
    getAudioTime: () => number,
    getAudioState: () => AudioContextState | undefined,
    onNote: (note: ScheduledNote) => void,
    onPositionChange: (globalStep: number) => void,
    getHeldParams: (trackId: string) => Partial<SynthParamValues>,
    onParameterEvent?: (trackId: string, controlId: string, value: number | string | boolean) => void,
    onClick?: (time: number, accent: boolean) => void,
  ) {
    this.getSession = getSession;
    this.getAudioTime = getAudioTime;
    this.getAudioState = getAudioState;
    this.onNote = onNote;
    this.onPositionChange = onPositionChange;
    this.getHeldParams = getHeldParams;
    this.onParameterEvent = onParameterEvent;
    this.onClick = onClick;
  }

  start(startOffset = START_OFFSET_SEC, startStep = 0, generation = 0): void {
    if (this.intervalId !== null) return;
    // Offset start so first-beat events have future timestamps in the
    // worklet. Without this, messages race the render thread and may
    // be stale-drained or miss gain automation. Tests pass 0.
    const session = this.getSession();
    const stepDuration = 60 / (session.transport.bpm * 4);
    this.startTime = this.getAudioTime() + startOffset - startStep * stepDuration;
    this.cursor = startStep;
    this.previousBpm = session.transport.bpm;
    this.generation = generation;
    this.playbackPlan.reset(generation);
    // Align metronome to the next beat boundary (steps are 16th notes, beats are groups of 4)
    this.nextClickStep = Math.ceil(startStep / 4) * 4;

    this.tick();
    this.intervalId = setInterval(() => this.tick(), LOOKAHEAD_MS);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.playbackPlan.reset(this.generation);
  }

  isRunning(): boolean {
    return this.intervalId !== null;
  }

  invalidateTrack(trackId: string, fromStep = this.cursor): void {
    this.playbackPlan.invalidateTrack(trackId, this.generation, Math.floor(fromStep));
  }

  private tick(): void {
    // Skip entirely while AudioContext is suspended (tab backgrounded)
    if (this.getAudioState?.() === 'suspended') return;

    const session = this.getSession();
    const { bpm, swing } = session.transport;

    // Handle BPM change mid-play
    if (bpm !== this.previousBpm) {
      this.reanchorBpm(bpm);
      this.previousBpm = bpm;
    }

    const currentAudioTime = this.getAudioTime();
    const stepDuration = 60 / (bpm * 4); // seconds per step

    // Publish position based on actual audio time (absolute offset, never accumulated)
    const elapsed = currentAudioTime - this.startTime;
    let globalStep = elapsed / stepDuration;

    // Transport-level loop: wrap globalStep back to loopStart when it reaches loopEnd
    const { loopEnabled, loopStart: ls, loopEnd: le } = session.transport;
    if (loopEnabled && le != null && ls != null && le > ls) {
      if (globalStep >= le) {
        const loopLen = le - ls;
        // Reanchor startTime so playback continues seamlessly from loopStart
        const overshoot = globalStep - le;
        const wrappedOffset = overshoot % loopLen;
        globalStep = ls + wrappedOffset;
        this.startTime = currentAudioTime - globalStep * stepDuration;
        this.cursor = globalStep;
        this.playbackPlan.reset(this.generation);
      }
    }

    this.onPositionChange(globalStep);

    // Cap catch-up window after resume: if the cursor fell too far behind,
    // advance it so we only schedule the most recent MAX_CATCHUP_STEPS.
    if (globalStep - this.cursor > MAX_CATCHUP_STEPS) {
      this.cursor = globalStep - MAX_CATCHUP_STEPS;
    }

    // Calculate lookahead window in step units. The window extends from the
    // cursor to at least currentAudioTime + LOOKAHEAD_SEC. If the tab was
    // backgrounded and the cursor fell behind the current audio position,
    // the window naturally covers the gap — all missed events are scheduled
    // in one batch without duplicates (cursor advances past them).
    const lookaheadSteps = LOOKAHEAD_SEC / stepDuration;
    const lookaheadEnd = Math.max(
      this.cursor + lookaheadSteps,
      globalStep + lookaheadSteps,
    );
    // Prune at the playhead (globalStep), not the cursor (scheduling frontier).
    // The cursor is always ahead of globalStep by the lookahead window. Pruning
    // at cursor would remove plan entries for events between globalStep and
    // cursor — events that haven't actually played yet — making them vulnerable
    // to double-scheduling if invalidateTrack re-admits them.
    this.playbackPlan.pruneBeforeStep(Math.floor(globalStep));

    // Schedule metronome clicks if enabled
    if (session.transport.metronome?.enabled && this.onClick) {
      while (this.nextClickStep < lookaheadEnd) {
        const clickTime = this.startTime + this.nextClickStep * stepDuration;
        // Beat 1 accent: step 0 mod 16 = downbeat of a 4/4 bar (16 sixteenth notes)
        const isDownbeat = this.nextClickStep % 16 === 0;
        this.onClick(clickTime, isDownbeat);
        this.nextClickStep += 4; // quarter note = 4 sixteenth-note steps
      }
    }

    const audibleTracks = getAudibleTracks(session);

    for (const track of audibleTracks) {
      if (track.regions.length === 0) continue;

      for (const region of track.regions) {
        const events = region.events;
        const regionLen = region.duration;
        if (regionLen <= 0 || events.length === 0) continue;

        const regionStart = region.start;

        if (region.loop) {
          // Looping region: compute segments relative to region start
          const relStart = this.cursor - regionStart;
          const relEnd = lookaheadEnd - regionStart;
          if (relEnd <= 0) continue;
          const segments = this.getLocalSegments(
            Math.max(0, relStart),
            relEnd,
            regionLen,
          );
          for (const seg of segments) {
            this.scheduleSegmentEvents(track, region, events, regionLen, regionStart, seg, stepDuration, swing);
          }
        } else {
          // Non-looping region: play once at region.start
          const regionEnd = regionStart + regionLen;
          if (regionEnd <= this.cursor || regionStart >= lookaheadEnd) continue;
          const localStart = Math.max(0, this.cursor - regionStart);
          const localEnd = Math.min(regionLen, lookaheadEnd - regionStart);
          if (localEnd <= localStart) continue;
          this.scheduleSegmentEvents(track, region, events, regionLen, regionStart, { localStart, localEnd, loopCycle: 0 }, stepDuration, swing);
        }
      }
    }

    // Advance cursor past everything we've scheduled
    this.cursor = lookaheadEnd;
  }

  /**
   * Schedule events from a single region segment. Extracted from the main loop
   * to support multi-region iteration (both looping and non-looping regions).
   */
  private scheduleSegmentEvents(
    track: Track,
    region: Region,
    events: MusicalEvent[],
    regionLen: number,
    regionStart: number,
    seg: { localStart: number; localEnd: number; loopCycle: number },
    stepDuration: number,
    swing: number,
  ): void {
    const startIdx = lowerBound(events, seg.localStart);

    for (let i = startIdx; i < events.length; i++) {
      const event = events[i];
      if (event.at >= seg.localEnd) break;
      if (event.at < seg.localStart) continue;

      // Absolute step includes the region's start offset
      const absoluteStep = regionStart + seg.loopCycle * regionLen + event.at;

      // Standalone parameter events: fire callback to apply automation values.
      if (event.kind === 'parameter') {
        const parameterEventId = buildRuntimeEventId(
          this.generation,
          track.id,
          region.id,
          event,
          seg.loopCycle,
        );
        if (!this.playbackPlan.admit(parameterEventId, absoluteStep, this.generation, track.id)) {
          continue;
        }
        if (this.onParameterEvent) {
          const pe = event as ParameterEvent;
          this.onParameterEvent(track.id, pe.controlId, pe.value);
        }
        continue;
      }
      // velocity=0 is the "ungated" sentinel
      if (event.kind === 'trigger' && (event as TriggerEvent).velocity === 0) continue;

      const runtimeEventId = buildRuntimeEventId(
        this.generation,
        track.id,
        region.id,
        event,
        seg.loopCycle,
      );
      if (!this.playbackPlan.admit(runtimeEventId, absoluteStep, this.generation, track.id)) {
        continue;
      }

      // Base time
      const baseTime = this.startTime + absoluteStep * stepDuration;
      const isOddInPair = Math.floor(absoluteStep) % 2 === 1;
      const swingDelay = isOddInPair ? swing * (stepDuration * 0.75) : 0;
      const noteTime = baseTime + swingDelay;

      // Gate-off time
      let gateOffAbsolute: number;
      if (event.kind === 'note') {
        gateOffAbsolute = absoluteStep + (event as NoteEvent).duration;
      } else {
        gateOffAbsolute = absoluteStep + 1;
      }
      const gateOffBase = this.startTime + gateOffAbsolute * stepDuration;
      const gateOffOdd = Math.floor(gateOffAbsolute) % 2 === 1;
      const gateOffSwingDelay = gateOffOdd ? swing * (stepDuration * 0.75) : 0;
      const gateOffTime = gateOffBase + gateOffSwingDelay;

      const accent = event.kind === 'trigger'
        ? !!((event as TriggerEvent).accent || ((event as TriggerEvent).velocity !== undefined && (event as TriggerEvent).velocity! >= 0.95))
        : (event as NoteEvent).velocity >= 0.95;

      const heldParams = this.getHeldParams(track.id);
      const resolvedParams = resolveEventParams(
        events,
        event.at,
        track.params,
        heldParams,
        (controlId) => controlIdToRuntimeParam[controlId] ?? controlId,
      );

      if (event.kind === 'note') {
        resolvedParams.note = (event as NoteEvent).pitch / 127;
      }

      this.onNote({
        eventId: runtimeEventId,
        generation: this.generation,
        trackId: track.id,
        time: noteTime,
        gateOffTime,
        accent,
        params: resolvedParams,
        baseParams: track.params,
      });

      recordQaAudioTrace({
        type: 'scheduler.note',
        trackId: track.id,
        generation: this.generation,
        eventId: runtimeEventId,
        eventKind: event.kind,
        at: event.at,
        absoluteStep,
        noteTime,
        gateOffTime,
        accent,
      });
    }
  }

  /**
   * Convert an absolute step window [start, end) into region-local segments,
   * handling loop wrapping. Each segment has a localStart, localEnd, and loopCycle.
   */
  private getLocalSegments(
    absStart: number,
    absEnd: number,
    regionLen: number,
  ): { localStart: number; localEnd: number; loopCycle: number }[] {
    const segments: { localStart: number; localEnd: number; loopCycle: number }[] = [];

    const startCycle = Math.floor(absStart / regionLen);
    const endCycle = Math.floor((absEnd - 0.0001) / regionLen); // -epsilon to avoid including next cycle at exact boundary

    for (let cycle = startCycle; cycle <= endCycle; cycle++) {
      const cycleStart = cycle * regionLen;
      let localStart = Math.max(0, absStart - cycleStart);
      const localEnd = Math.min(regionLen, absEnd - cycleStart);

      // Guard against floating-point dust at loop boundaries: the cursor
      // accumulates lookaheadSteps each tick via addition, and 0.1/stepDuration
      // is not exactly representable in float64.  After many ticks the cursor
      // overshoots exact multiples of regionLen by ~1e-15, producing a
      // localStart just above 0.  lowerBound then skips events at position 0,
      // silencing the first step on subsequent loops.
      if (localStart > 0 && localStart < 1e-9) localStart = 0;

      if (localEnd > localStart) {
        segments.push({ localStart, localEnd, loopCycle: cycle });
      }
    }

    return segments;
  }

  private reanchorBpm(newBpm: number): void {
    const currentAudioTime = this.getAudioTime();
    const oldStepDuration = 60 / (this.previousBpm * 4);
    const playbackStep = (currentAudioTime - this.startTime) / oldStepDuration;

    const newStepDuration = 60 / (newBpm * 4);
    this.startTime = currentAudioTime - (playbackStep * newStepDuration);
    this.cursor = playbackStep;
  }
}
