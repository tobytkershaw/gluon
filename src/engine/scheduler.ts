// src/engine/scheduler.ts
import type { Session, SynthParamValues } from './types';
import type { ScheduledNote } from './sequencer-types';
import { getAudibleVoices, resolveNoteParams } from './sequencer-helpers';

const TICKS_PER_STEP = 12; // 48 PPQN / 4 steps per beat
const LOOKAHEAD_MS = 25;
const LOOKAHEAD_SEC = 0.1;

export class Scheduler {
  private getSession: () => Session;
  private getAudioTime: () => number;
  private onNote: (note: ScheduledNote) => void;
  private onPositionChange: (globalStep: number) => void;
  private getHeldParams: (voiceId: string) => Partial<SynthParamValues>;

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private cursor = 0; // ticks
  private startTime = 0;
  private previousBpm = 0;
  private _bpm = 0; // internal source of truth — avoids stale reads from React state

  constructor(
    getSession: () => Session,
    getAudioTime: () => number,
    onNote: (note: ScheduledNote) => void,
    onPositionChange: (globalStep: number) => void,
    getHeldParams: (voiceId: string) => Partial<SynthParamValues>,
  ) {
    this.getSession = getSession;
    this.getAudioTime = getAudioTime;
    this.onNote = onNote;
    this.onPositionChange = onPositionChange;
    this.getHeldParams = getHeldParams;
  }

  start(): void {
    if (this.intervalId !== null) return;
    this.startTime = this.getAudioTime();
    this.cursor = 0;
    const session = this.getSession();
    this._bpm = session.transport.bpm;
    this.previousBpm = this._bpm;

    this.tick();
    this.intervalId = setInterval(() => this.tick(), LOOKAHEAD_MS);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  isRunning(): boolean {
    return this.intervalId !== null;
  }

  /** Imperatively update BPM, bypassing the React render cycle. */
  setBpm(bpm: number): void {
    if (bpm === this._bpm) return;
    this.reanchorBpm(bpm);
    this.previousBpm = this._bpm;
    this._bpm = bpm;
  }

  private tick(): void {
    const session = this.getSession();
    const { swing } = session.transport;

    // Sync from session only when session BPM diverges from our last-known
    // session value (i.e. changed via a non-imperative path like AI action).
    // This avoids oscillation: setBpm() updates _bpm immediately, but
    // session state may lag behind by one React commit.
    const sessionBpm = session.transport.bpm;
    if (sessionBpm !== this.previousBpm && sessionBpm !== this._bpm) {
      this.reanchorBpm(sessionBpm);
      this.previousBpm = this._bpm;
      this._bpm = sessionBpm;
    }

    const bpm = this._bpm;
    const currentAudioTime = this.getAudioTime();
    const tickDuration = 60 / (bpm * 4) / TICKS_PER_STEP; // seconds per tick
    const stepDuration = tickDuration * TICKS_PER_STEP;

    // Publish position based on actual audio time
    const elapsed = currentAudioTime - this.startTime;
    const globalStep = elapsed / stepDuration;
    this.onPositionChange(globalStep);

    // Calculate how far ahead to schedule
    const lookaheadEnd = currentAudioTime + LOOKAHEAD_SEC;
    const lookaheadEndTick = Math.floor((lookaheadEnd - this.startTime) / tickDuration);

    const audibleVoices = getAudibleVoices(session);

    // Walk step boundaries from current cursor to lookahead end.
    // This correctly handles multiple step boundaries (e.g., after tab backgrounding).
    const startStep = Math.floor(this.cursor / TICKS_PER_STEP);
    const endStep = Math.floor(lookaheadEndTick / TICKS_PER_STEP);

    for (let stepIdx = startStep; stepIdx <= endStep; stepIdx++) {
      const stepTick = stepIdx * TICKS_PER_STEP;
      // Skip steps we've already scheduled (cursor is past this step's tick)
      if (stepTick < this.cursor) continue;

      for (const voice of audibleVoices) {
        const patternStep = stepIdx % voice.pattern.length;
        if (patternStep >= voice.pattern.steps.length) continue;
        const step = voice.pattern.steps[patternStep];
        if (!step.gate) continue;

        // Calculate base time for this step
        const baseTime = this.startTime + stepIdx * stepDuration;

        // Apply swing
        const beatLocalStep = stepIdx % 4;
        const pairPosition = beatLocalStep % 2;
        const swingDelay = pairPosition * swing * (stepDuration * 0.75);
        const noteTime = baseTime + swingDelay;

        // Calculate gate-off time (next step's time)
        const nextStepTime = this.startTime + (stepIdx + 1) * stepDuration;
        const nextBeatLocal = (stepIdx + 1) % 4;
        const nextPairPos = nextBeatLocal % 2;
        const nextSwingDelay = nextPairPos * swing * (stepDuration * 0.75);
        const gateOffTime = nextStepTime + nextSwingDelay;

        // Resolve params: voice base + step locks + human held
        const heldParams = this.getHeldParams(voice.id);
        const resolvedParams = resolveNoteParams(voice, step, heldParams);

        this.onNote({
          voiceId: voice.id,
          time: noteTime,
          gateOffTime,
          accent: step.accent,
          params: resolvedParams,
        });
      }
    }

    // Advance cursor past everything we've scheduled
    this.cursor = Math.max(this.cursor, lookaheadEndTick + 1);
  }

  private reanchorBpm(newBpm: number): void {
    const currentAudioTime = this.getAudioTime();
    const oldStepDuration = 60 / (this._bpm * 4);
    const playbackStep = (currentAudioTime - this.startTime) / oldStepDuration;
    const playbackTick = playbackStep * TICKS_PER_STEP;

    const newTickDuration = 60 / (newBpm * 4) / TICKS_PER_STEP;
    this.startTime = currentAudioTime - (playbackTick * newTickDuration);
    this.cursor = Math.floor(playbackTick);
  }
}
