// src/engine/scheduler.ts
import type { Session, SynthParamValues } from './types';
import type { ScheduledNote } from './sequencer-types';
import type { MusicalEvent, TriggerEvent, NoteEvent, ParameterEvent } from './canonical-types';
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

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private cursor = 0; // absolute step units (fractional)
  private startTime = 0;
  private previousBpm = 0;
  private generation = 0;
  private playbackPlan = new PlaybackPlan();

  constructor(
    getSession: () => Session,
    getAudioTime: () => number,
    getAudioState: () => AudioContextState | undefined,
    onNote: (note: ScheduledNote) => void,
    onPositionChange: (globalStep: number) => void,
    getHeldParams: (trackId: string) => Partial<SynthParamValues>,
    onParameterEvent?: (trackId: string, controlId: string, value: number | string | boolean) => void,
  ) {
    this.getSession = getSession;
    this.getAudioTime = getAudioTime;
    this.getAudioState = getAudioState;
    this.onNote = onNote;
    this.onPositionChange = onPositionChange;
    this.getHeldParams = getHeldParams;
    this.onParameterEvent = onParameterEvent;
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
    const globalStep = elapsed / stepDuration;
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
    this.playbackPlan.pruneBeforeStep(Math.floor(this.cursor));

    const audibleTracks = getAudibleTracks(session);

    for (const track of audibleTracks) {
      if (track.regions.length === 0) continue;
      const region = track.regions[0];
      const events = region.events;
      const regionLen = region.duration;
      if (regionLen <= 0 || events.length === 0) continue;

      // Convert absolute window to region-local segments, handling loop wrapping
      const segments = this.getLocalSegments(this.cursor, lookaheadEnd, regionLen);

      for (const seg of segments) {
        const startIdx = lowerBound(events, seg.localStart);

        for (let i = startIdx; i < events.length; i++) {
          const event = events[i];
          if (event.at >= seg.localEnd) break;
          if (event.at < seg.localStart) continue;

          // Standalone parameter events: fire callback to apply automation values.
          // Parameter events co-located with triggers/notes are still resolved
          // inline via resolveEventParams below.
          if (event.kind === 'parameter') {
            const parameterAbsoluteStep = seg.loopCycle * regionLen + event.at;
            const parameterEventId = buildRuntimeEventId(
              this.generation,
              track.id,
              region.id,
              event,
              seg.loopCycle,
            );
            if (!this.playbackPlan.admit(parameterEventId, parameterAbsoluteStep, this.generation)) {
              continue;
            }
            if (this.onParameterEvent) {
              const pe = event as ParameterEvent;
              this.onParameterEvent(track.id, pe.controlId, pe.value);
            }
            continue;
          }
          // velocity=0 is the "ungated" sentinel — trigger exists to preserve
          // accent state but should not produce a gate (matches event-conversion.ts)
          if (event.kind === 'trigger' && (event as TriggerEvent).velocity === 0) continue;

          // Absolute step position of this event
          const absoluteStep = seg.loopCycle * regionLen + event.at;
          const runtimeEventId = buildRuntimeEventId(
            this.generation,
            track.id,
            region.id,
            event,
            seg.loopCycle,
          );
          if (!this.playbackPlan.admit(runtimeEventId, absoluteStep, this.generation)) {
            continue;
          }

          // Base time
          const baseTime = this.startTime + absoluteStep * stepDuration;

          // Apply swing to odd positions in beat pairs (positions 1, 3 within a beat)
          const isOddInPair = Math.floor(absoluteStep) % 2 === 1;
          const swingDelay = isOddInPair ? swing * (stepDuration * 0.75) : 0;
          const noteTime = baseTime + swingDelay;

          // Gate-off time
          // Known M2 limitation: gate-off times are computed using the current
          // stepDuration. If BPM changes after a note-on is scheduled but before
          // its gate-off fires, the gate-off will land at the wrong wall-clock
          // time. Fixing this would require tracking in-flight gate-offs and
          // recomputing them on tempo change, deferred to M3.
          let gateOffAbsolute: number;
          if (event.kind === 'note') {
            gateOffAbsolute = absoluteStep + (event as NoteEvent).duration;
          } else {
            // TriggerEvent: fixed gate length of 1 step
            gateOffAbsolute = absoluteStep + 1;
          }
          const gateOffBase = this.startTime + gateOffAbsolute * stepDuration;
          // Apply swing to gate-off position
          const gateOffOdd = Math.floor(gateOffAbsolute) % 2 === 1;
          const gateOffSwingDelay = gateOffOdd ? swing * (stepDuration * 0.75) : 0;
          const gateOffTime = gateOffBase + gateOffSwingDelay;

          // Determine accent — must match projection rules in eventsToSteps():
          // accent is true if event.accent is set OR velocity >= 0.95
          const accent = event.kind === 'trigger'
            ? !!((event as TriggerEvent).accent || ((event as TriggerEvent).velocity !== undefined && (event as TriggerEvent).velocity! >= 0.95))
            : (event as NoteEvent).velocity >= 0.95;

          // Resolve params: track base + parameter events at same position + held
          const heldParams = this.getHeldParams(track.id);
          const resolvedParams = resolveEventParams(
            events,
            event.at,
            track.params,
            heldParams,
            (controlId) => controlIdToRuntimeParam[controlId] ?? controlId,
          );

          // Inject NoteEvent pitch into resolved params — resolveEventParams
          // only collects ParameterEvents, so NoteEvent.pitch would be lost.
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
    }

    // Advance cursor past everything we've scheduled
    this.cursor = lookaheadEnd;
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
