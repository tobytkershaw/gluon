import type { Session, SynthParamValues } from './types';
import type { AudioEngine } from '../audio/audio-engine';
import { Scheduler, START_OFFSET_SEC } from './scheduler';
import type { ScheduledParameterEvent, Transport } from './sequencer-types';
import {
  createRuntimeTransport,
  normalizeTransport,
  pauseTransportState,
  playTransportState,
  stopTransportState,
  type RuntimeTransportState,
} from './transport-runtime';
import { recordQaAudioTrace } from '../qa/audio-trace';

interface SchedulerLike {
  start(startOffset?: number, startStep?: number, generation?: number): void;
  stop(): void;
  invalidateTrack(trackId: string, fromStep?: number): void;
}

interface TransportControllerDeps {
  audio: AudioEngine;
  getSession: () => Session;
  onPositionChange: (step: number) => void;
  getHeldParams: (trackId: string) => Partial<SynthParamValues>;
  onParameterEvent?: (event: ScheduledParameterEvent) => void;
  onSequenceEnd?: () => void;
  createScheduler?: (deps: {
    getSession: () => Session;
    onNote: (note: import('./sequencer-types').ScheduledNote) => void;
    onPositionChange: (step: number) => void;
    getHeldParams: (trackId: string) => Partial<SynthParamValues>;
    onParameterEvent?: (event: ScheduledParameterEvent) => void;
    onClick?: (time: number, accent: boolean) => void;
    onSequenceEnd?: () => void;
  }) => SchedulerLike;
}

export class TransportController {
  private readonly audio: AudioEngine;
  private readonly getSession: () => Session;
  private readonly onPositionChange: (step: number) => void;
  private readonly scheduler: SchedulerLike;
  private runtime: RuntimeTransportState;
  private pendingHardStop = false;
  private lastStep = 0;
  private trackSeen = new Set<string>();
  private lastHandledTransportCommandId: number | null = null;
  private parameterEventTimers = new Map<ReturnType<typeof setTimeout>, string>();
  private lastTransport: Transport;

  constructor({
    audio,
    getSession,
    onPositionChange,
    getHeldParams,
    onParameterEvent,
    onSequenceEnd,
    createScheduler,
  }: TransportControllerDeps) {
    this.audio = audio;
    this.getSession = getSession;
    this.onPositionChange = onPositionChange;
    this.runtime = createRuntimeTransport(getSession().transport);
    this.lastTransport = normalizeTransport(getSession().transport);
    const handlePositionChange = (step: number) => {
      this.lastStep = step;
      this.runtime = { ...this.runtime, playheadBeats: step / 4 };
      this.onPositionChange(step);
    };
    const handleClick = (time: number, accent: boolean) => this.audio.scheduleClick(time, accent);
    const handleParameterEvent = (event: ScheduledParameterEvent) => {
      if (!onParameterEvent) return;
      const delayMs = Math.max(0, (event.time - this.audio.getCurrentTime()) * 1000);
      if (delayMs <= 1) {
        onParameterEvent(event);
        return;
      }

      const generation = this.runtime.generation;
      const timer = setTimeout(() => {
        this.parameterEventTimers.delete(timer);
        if (this.runtime.generation !== generation || this.runtime.status !== 'playing') return;
        // Guard against tracks removed during playback (#1223)
        const session = this.getSession();
        if (!session.tracks.some(t => t.id === event.trackId)) return;
        onParameterEvent(event);
      }, delayMs);
      this.parameterEventTimers.set(timer, event.trackId);
    };
    this.scheduler = createScheduler
      ? createScheduler({
          getSession,
          onNote: (note) => this.audio.scheduleNote(note, this.runtime.generation),
          onPositionChange: handlePositionChange,
          getHeldParams,
          onParameterEvent: handleParameterEvent,
          onClick: handleClick,
          onSequenceEnd,
        })
      : new Scheduler(
          getSession,
          () => this.audio.getCurrentTime(),
          () => this.audio.getState(),
          (note) => this.audio.scheduleNote(note, this.runtime.generation),
          handlePositionChange,
          getHeldParams,
          handleParameterEvent,
          handleClick,
          onSequenceEnd,
        );
    this.syncArrangement();
  }

  sync(): void {
    const transport = normalizeTransport(this.getSession().transport);
    const structuralTransportChange = this.hasStructuralTransportChange(this.lastTransport, transport);
    this.runtime = {
      ...this.runtime,
      bpm: transport.bpm,
      swing: transport.swing,
    };
    const transportCommand = this.getSession().transportCommand;

    if (transport.status === 'playing') {
      const hasFreshPlayFromStep = transportCommand?.kind === 'play-from-step'
        && transportCommand.requestId !== this.lastHandledTransportCommandId;
      const needsRestart = this.runtime.status !== 'playing'
        || hasFreshPlayFromStep
        || structuralTransportChange;
      if (needsRestart) {
        // Stop the current scheduler if already playing (play-from-cursor restart)
        if (this.runtime.status === 'playing') {
          this.scheduler.stop();
          this.clearParameterEventTimers();
          this.audio.releaseGeneration(this.audio.advanceGeneration());
        }
        const generation = this.audio.advanceGeneration();
        let startStep: number;
        if (transportCommand?.kind === 'play-from-step') {
          startStep = transportCommand.step;
          this.lastHandledTransportCommandId = transportCommand.requestId;
        } else if (structuralTransportChange && this.runtime.status === 'playing') {
          startStep = this.lastStep;
        } else if (this.runtime.status === 'paused') {
          startStep = this.runtime.playheadBeats * 4;
        } else {
          startStep = 0;
        }
        // On resume from pause, skip the start offset — the audio worklet is
        // already running and the offset would push globalStep backward by
        // ~0.5 steps on the first tick, causing a visible/audible position jump.
        const isResume = this.runtime.status === 'paused' || (structuralTransportChange && this.runtime.status === 'playing');
        const offset = isResume ? 0 : START_OFFSET_SEC;
        this.audio.restoreBaseline();
        // Restore metronome volume after silenceMetronome() zeroed it on stop/pause.
        const metVol = transport.metronome?.volume ?? 0.5;
        this.audio.setMetronomeVolume(metVol);
        // Update runtime BEFORE starting the scheduler so that the synchronous
        // first tick sees the new generation (fixes #543 — stale generation on resume).
        this.runtime = playTransportState(this.runtime, generation);
        this.scheduler.start(offset, startStep, generation);
        recordQaAudioTrace({
          type: 'transport.play-start',
          audioTime: this.audio.getCurrentTime(),
          generation,
          startStep,
        });
      } else {
        // Already playing, no restart needed — but metronome state may have changed.
        if (!transport.metronome?.enabled) {
          this.audio.silenceMetronome();
        } else {
          this.audio.setMetronomeVolume(transport.metronome.volume ?? 0.5);
        }
      }
    } else if (transport.status === 'paused') {
      if (this.runtime.status === 'playing') {
        this.scheduler.stop();
        this.clearParameterEventTimers();
        this.audio.silenceMetronome();
        const generation = this.audio.advanceGeneration();
        this.audio.releaseGeneration(generation);
        this.runtime = pauseTransportState(
          { ...this.runtime, playheadBeats: this.lastStep / 4 },
          generation,
        );
      }
      this.lastHandledTransportCommandId = null;
    } else if (this.runtime.status !== 'stopped') {
      this.scheduler.stop();
      this.clearParameterEventTimers();
      this.audio.silenceMetronome();
      const generation = this.audio.advanceGeneration();
      if (this.pendingHardStop) {
        this.audio.silenceGeneration(generation);
      } else {
        this.audio.releaseGeneration(generation);
      }
      this.pendingHardStop = false;
      this.lastStep = 0;
      this.lastHandledTransportCommandId = null;
      this.runtime = stopTransportState(this.runtime, generation);
      this.onPositionChange(0);
    } else if (this.pendingHardStop) {
      this.clearParameterEventTimers();
      this.audio.silenceMetronome();
      const generation = this.audio.advanceGeneration();
      this.audio.silenceGeneration(generation);
      this.pendingHardStop = false;
      this.lastHandledTransportCommandId = null;
      this.runtime = stopTransportState(this.runtime, generation);
      this.onPositionChange(0);
    }

    recordQaAudioTrace({
      type: 'transport.state',
      playing: transport.status === 'playing',
      status: transport.status,
      bpm: transport.bpm,
      swing: transport.swing,
      generation: this.runtime.generation,
    });
    this.lastTransport = transport;
  }

  /** Externally trigger a track invalidation without relying on _patternDirty.
   *  Used when audio slots become available after the scheduler already passed
   *  the events (e.g. async drum pad WASM instantiation). */
  invalidateTrackNow(trackId: string): void {
    if (this.runtime.status !== 'playing') return;
    this.clearParameterEventTimers(trackId);
    this.scheduler.invalidateTrack(trackId, this.lastStep);
    recordQaAudioTrace({
      type: 'transport.arrangement-invalidated',
      generation: this.runtime.generation,
      trackId,
      fromStep: this.lastStep,
    });
  }

  requestHardStop(): void {
    this.pendingHardStop = true;
  }

  private clearParameterEventTimers(trackId?: string): void {
    for (const [timer, timerTrackId] of this.parameterEventTimers) {
      if (trackId && timerTrackId !== trackId) continue;
      clearTimeout(timer);
      this.parameterEventTimers.delete(timer);
    }
  }

  syncArrangement(): void {
    const session = this.getSession();
    const currentTrackIds = new Set(session.tracks.map(t => t.id));

    // Clear pending timers for tracks that have been removed (#1223)
    for (const seenId of this.trackSeen) {
      if (!currentTrackIds.has(seenId)) {
        this.clearParameterEventTimers(seenId);
        this.trackSeen.delete(seenId);
      }
    }

    for (const track of session.tracks) {
      if (track._patternDirty && this.runtime.status === 'playing') {
        this.clearParameterEventTimers(track.id);
        this.scheduler.invalidateTrack(track.id, this.lastStep);
        recordQaAudioTrace({
          type: 'transport.arrangement-invalidated',
          generation: this.runtime.generation,
          trackId: track.id,
          fromStep: this.lastStep,
        });
      }
      // Clear dirty flag after invalidation (order matters: check → invalidate → clear)
      if (track._patternDirty) {
        track._patternDirty = false;
      }
      this.trackSeen.add(track.id);
    }
  }

  dispose(): void {
    this.scheduler.stop();
    this.clearParameterEventTimers();
  }

  private hasStructuralTransportChange(prev: Transport, next: Transport): boolean {
    const prevMode = prev.mode ?? 'pattern';
    const nextMode = next.mode ?? 'pattern';
    if (prevMode !== nextMode) return true;

    const prevLoop = prev.loop ?? true;
    const nextLoop = next.loop ?? true;
    if (prevLoop !== nextLoop) return true;

    const prevTs = prev.timeSignature ?? { numerator: 4, denominator: 4 };
    const nextTs = next.timeSignature ?? { numerator: 4, denominator: 4 };
    return prevTs.numerator !== nextTs.numerator || prevTs.denominator !== nextTs.denominator;
  }
}
