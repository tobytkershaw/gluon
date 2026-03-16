// src/engine/scheduler.ts
import type { Session, SynthParamValues, Track } from './types';
import { getActivePattern } from './types';
import type { ScheduledNote } from './sequencer-types';
import type { MusicalEvent, Pattern, TriggerEvent, NoteEvent, ParameterEvent } from './canonical-types';
import { getAudibleTracks, resolveEventParams } from './sequencer-helpers';
import { controlIdToRuntimeParam } from '../audio/instrument-registry';
import { recordQaAudioTrace } from '../qa/audio-trace';
import { buildRuntimeEventId, PlaybackPlan } from './playback-plan';
import { getInterpolatedParams } from './interpolation';

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
  private onSequenceEnd?: () => void;

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private cursor = 0; // absolute step units (fractional)
  private startTime = 0;
  private previousBpm = 0;
  private generation = 0;
  private playbackPlan = new PlaybackPlan();
  /** Next metronome step to schedule (in absolute step units, always a multiple of stepsPerBeat). */
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
    onSequenceEnd?: () => void,
  ) {
    this.getSession = getSession;
    this.getAudioTime = getAudioTime;
    this.getAudioState = getAudioState;
    this.onNote = onNote;
    this.onPositionChange = onPositionChange;
    this.getHeldParams = getHeldParams;
    this.onParameterEvent = onParameterEvent;
    this.onClick = onClick;
    this.onSequenceEnd = onSequenceEnd;
  }

  start(startOffset = START_OFFSET_SEC, startStep = 0, generation = 0): void {
    if (this.intervalId !== null) return;
    const session = this.getSession();
    const stepDuration = 60 / (session.transport.bpm * 4);
    this.startTime = this.getAudioTime() + startOffset - startStep * stepDuration;
    this.cursor = startStep;
    this.previousBpm = session.transport.bpm;
    this.generation = generation;
    this.playbackPlan.reset(generation);
    // Align metronome to the next beat boundary using time signature
    const stepsPerBeat = 16 / (session.transport.timeSignature?.denominator ?? 4);
    this.nextClickStep = Math.ceil(startStep / stepsPerBeat) * stepsPerBeat;

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
    const transportMode = session.transport.mode ?? 'pattern';

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

    // Pattern mode: wrap globalStep at the max active pattern duration across
    // all audible tracks. Using only one track's duration would silently truncate
    // longer patterns on other tracks in a multi-track session.
    if (transportMode === 'pattern') {
      const audibleTracks = getAudibleTracks(session);
      let maxPatternLen = 0;
      for (const t of audibleTracks) {
        if (t.patterns.length > 0) {
          const len = getActivePattern(t).duration;
          if (len > maxPatternLen) maxPatternLen = len;
        }
      }
      if (maxPatternLen > 0 && globalStep >= maxPatternLen) {
        // Reanchor so playback loops seamlessly
        const overshoot = globalStep - maxPatternLen;
        const wrappedOffset = overshoot % maxPatternLen;
        globalStep = wrappedOffset;
        this.startTime = currentAudioTime - globalStep * stepDuration;
        this.cursor = globalStep;
        this.playbackPlan.reset(this.generation);
      }
    }

    // Song mode: check for end of sequence
    if (transportMode === 'song') {
      let maxSequenceLen = 0;
      for (const track of getAudibleTracks(session)) {
        let trackLen = 0;
        for (const ref of track.sequence) {
          const pat = track.patterns.find(p => p.id === ref.patternId);
          if (pat) trackLen += pat.duration;
        }
        if (trackLen > maxSequenceLen) maxSequenceLen = trackLen;
      }
      if (maxSequenceLen > 0 && globalStep >= maxSequenceLen) {
        // End of sequence — stop playback
        this.stop();
        this.onSequenceEnd?.();
        return;
      }
    }

    this.onPositionChange(globalStep);

    // Cap catch-up window after resume: if the cursor fell too far behind,
    // advance it so we only schedule the most recent MAX_CATCHUP_STEPS.
    // Events before the cap are silently dropped — lossy by design — because
    // scheduling dozens of stale notes at once produces an audible burst of
    // overlapping triggers that sounds worse than skipping them.
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
      const ts = session.transport.timeSignature ?? { numerator: 4, denominator: 4 };
      const stepsPerBeat = 16 / ts.denominator;
      const stepsPerBar = stepsPerBeat * ts.numerator;
      while (this.nextClickStep < lookaheadEnd) {
        const clickTime = this.startTime + this.nextClickStep * stepDuration;
        const isDownbeat = stepsPerBar > 0 && this.nextClickStep % stepsPerBar === 0;
        this.onClick(clickTime, isDownbeat);
        this.nextClickStep += stepsPerBeat;
      }
    }

    const audibleTracks = getAudibleTracks(session);

    for (const track of audibleTracks) {
      if (track.patterns.length === 0) continue;

      if (transportMode === 'pattern') {
        // Pattern mode: loop the active pattern
        const activePattern = getActivePattern(track);
        const events = activePattern.events;
        const patternLen = activePattern.duration;
        if (patternLen <= 0 || events.length === 0) continue;

        const segments = this.getLocalSegments(
          Math.max(0, this.cursor),
          lookaheadEnd,
          patternLen,
        );
        for (const seg of segments) {
          this.scheduleSegmentEvents(track, activePattern, events, patternLen, 0, seg, stepDuration, swing);
        }
      } else {
        // Song mode: walk the sequence
        let sequenceOffset = 0;
        for (const ref of track.sequence) {
          const pat = track.patterns.find(p => p.id === ref.patternId);
          if (!pat) continue;
          const patternLen = pat.duration;
          if (patternLen <= 0) continue;

          const patternEnd = sequenceOffset + patternLen;
          // Only schedule if this pattern overlaps the scheduling window
          if (patternEnd > this.cursor && sequenceOffset < lookaheadEnd) {
            const localCursorStart = Math.max(0, this.cursor - sequenceOffset);
            const localLookaheadEnd = Math.min(patternLen, lookaheadEnd - sequenceOffset);
            if (localLookaheadEnd > localCursorStart && pat.events.length > 0) {
              this.scheduleSegmentEvents(
                track, pat, pat.events, patternLen, sequenceOffset,
                { localStart: localCursorStart, localEnd: localLookaheadEnd, loopCycle: 0 },
                stepDuration, swing,
              );
            }
          }
          sequenceOffset = patternEnd;
        }
      }
    }

    // Advance cursor past everything we've scheduled
    this.cursor = lookaheadEnd;
  }

  /**
   * Schedule events from a single pattern segment.
   */
  private scheduleSegmentEvents(
    track: Track,
    pattern: Pattern,
    events: MusicalEvent[],
    patternLen: number,
    sequenceOffset: number,
    seg: { localStart: number; localEnd: number; loopCycle: number },
    stepDuration: number,
    swing: number,
  ): void {
    const startIdx = lowerBound(events, seg.localStart);

    for (let i = startIdx; i < events.length; i++) {
      const event = events[i];
      if (event.at >= seg.localEnd) break;
      if (event.at < seg.localStart) continue;

      const absoluteStep = sequenceOffset + seg.loopCycle * patternLen + event.at;

      // Standalone parameter events: fire callback to apply automation values.
      if (event.kind === 'parameter') {
        const parameterEventId = buildRuntimeEventId(
          this.generation,
          track.id,
          pattern.id,
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
        pattern.id,
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
        gateOffAbsolute = absoluteStep + ((event as TriggerEvent).gate ?? 1);
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

    // Emit interpolated parameter values at each integer step in the window.
    if (this.onParameterEvent) {
      const iStart = Math.ceil(seg.localStart);
      const iEnd = Math.floor(seg.localEnd);
      for (let step = iStart; step < iEnd; step++) {
        const interpolated = getInterpolatedParams(events, step, patternLen);
        for (const { controlId, value } of interpolated) {
          const interpId = `${this.generation}:${track.id}:${pattern.id}:${seg.loopCycle}:interp:${controlId}@${step}`;
          const absStep = sequenceOffset + seg.loopCycle * patternLen + step;
          if (!this.playbackPlan.admit(interpId, absStep, this.generation, track.id)) {
            continue;
          }
          this.onParameterEvent(track.id, controlId, value);
        }
      }
    }
  }

  /**
   * Convert an absolute step window [start, end) into pattern-local segments,
   * handling loop wrapping. Each segment has a localStart, localEnd, and loopCycle.
   */
  private getLocalSegments(
    absStart: number,
    absEnd: number,
    patternLen: number,
  ): { localStart: number; localEnd: number; loopCycle: number }[] {
    const segments: { localStart: number; localEnd: number; loopCycle: number }[] = [];

    const startCycle = Math.floor(absStart / patternLen);
    const endCycle = Math.floor((absEnd - 0.0001) / patternLen);

    for (let cycle = startCycle; cycle <= endCycle; cycle++) {
      const cycleStart = cycle * patternLen;
      let localStart = Math.max(0, absStart - cycleStart);
      const localEnd = Math.min(patternLen, absEnd - cycleStart);

      // Guard against floating-point dust at loop boundaries: the cursor
      // accumulates lookaheadSteps each tick via addition, and 0.1/stepDuration
      // is not exactly representable in float64.  After many ticks the cursor
      // overshoots exact multiples of patternLen by ~1e-15, producing a
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
