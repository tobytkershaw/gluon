import type { Session, SynthParamValues } from './types';
import type { AudioEngine } from '../audio/audio-engine';
import { Scheduler, START_OFFSET_SEC } from './scheduler';
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
  onParameterEvent?: (trackId: string, controlId: string, value: number | string | boolean) => void;
  createScheduler?: (deps: {
    getSession: () => Session;
    onNote: (note: import('./sequencer-types').ScheduledNote) => void;
    onPositionChange: (step: number) => void;
    getHeldParams: (trackId: string) => Partial<SynthParamValues>;
    onParameterEvent?: (trackId: string, controlId: string, value: number | string | boolean) => void;
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
  private trackRegionSignatures = new Map<string, string>();

  constructor({
    audio,
    getSession,
    onPositionChange,
    getHeldParams,
    onParameterEvent,
    createScheduler,
  }: TransportControllerDeps) {
    this.audio = audio;
    this.getSession = getSession;
    this.onPositionChange = onPositionChange;
    this.runtime = createRuntimeTransport(getSession().transport);
    const handlePositionChange = (step: number) => {
      this.lastStep = step;
      this.runtime = { ...this.runtime, playheadBeats: step / 4 };
      this.onPositionChange(step);
    };
    this.scheduler = createScheduler
      ? createScheduler({
          getSession,
          onNote: (note) => this.audio.scheduleNote(note, this.runtime.generation),
          onPositionChange: handlePositionChange,
          getHeldParams,
          onParameterEvent,
        })
      : new Scheduler(
          getSession,
          () => this.audio.getCurrentTime(),
          () => this.audio.getState(),
          (note) => this.audio.scheduleNote(note, this.runtime.generation),
          handlePositionChange,
          getHeldParams,
          onParameterEvent,
        );
    this.syncArrangement();
  }

  sync(): void {
    const transport = normalizeTransport(this.getSession().transport);
    this.runtime = {
      ...this.runtime,
      bpm: transport.bpm,
      swing: transport.swing,
    };

    if (transport.status === 'playing') {
      if (this.runtime.status !== 'playing') {
        const generation = this.audio.advanceGeneration();
        const startStep = transport.status === 'playing' && this.runtime.status === 'paused'
          ? this.runtime.playheadBeats * 4
          : 0;
        this.audio.restoreBaseline();
        this.scheduler.start(START_OFFSET_SEC, startStep, generation);
        this.runtime = playTransportState(this.runtime, this.audio.getCurrentTime(), generation);
        recordQaAudioTrace({
          type: 'transport.play-start',
          audioTime: this.audio.getCurrentTime(),
          generation,
          startStep,
        });
      }
    } else if (transport.status === 'paused') {
      if (this.runtime.status === 'playing') {
        this.scheduler.stop();
        const generation = this.audio.advanceGeneration();
        this.audio.releaseGeneration(generation);
        this.runtime = pauseTransportState(
          { ...this.runtime, playheadBeats: this.lastStep / 4 },
          generation,
        );
      }
    } else if (this.runtime.status !== 'stopped') {
      this.scheduler.stop();
      const generation = this.audio.advanceGeneration();
      if (this.pendingHardStop) {
        this.audio.silenceGeneration(generation);
      } else {
        this.audio.releaseGeneration(generation);
      }
      this.pendingHardStop = false;
      this.lastStep = 0;
      this.runtime = stopTransportState(this.runtime, generation);
      this.onPositionChange(0);
    } else if (this.pendingHardStop) {
      const generation = this.audio.advanceGeneration();
      this.audio.silenceGeneration(generation);
      this.pendingHardStop = false;
      this.runtime = stopTransportState(this.runtime, generation);
      this.onPositionChange(0);
    }

    recordQaAudioTrace({
      type: 'transport.state',
      playing: transport.playing,
      status: transport.status,
      bpm: transport.bpm,
      swing: transport.swing,
      generation: this.runtime.generation,
    });
  }

  requestHardStop(): void {
    this.pendingHardStop = true;
  }

  syncArrangement(): void {
    const session = this.getSession();
    for (const track of session.tracks) {
      const region = track.regions[0];
      const signature = region
        ? `${region.id}:${region.duration}:${region.events.map(event => {
            switch (event.kind) {
              case 'parameter':
                return `${event.kind}:${event.at}:${event.controlId}:${String(event.value)}`;
              case 'note':
                return `${event.kind}:${event.at}:${event.pitch}:${event.duration}:${event.velocity}`;
              default:
                return `${event.kind}:${event.at}:${event.velocity ?? ''}:${event.accent ?? ''}`;
            }
          }).join('|')}`
        : 'none';
      const previous = this.trackRegionSignatures.get(track.id);
      if (previous !== undefined && previous !== signature && this.runtime.status === 'playing') {
        this.scheduler.invalidateTrack(track.id, this.lastStep);
        recordQaAudioTrace({
          type: 'transport.arrangement-invalidated',
          generation: this.runtime.generation,
          trackId: track.id,
          fromStep: this.lastStep,
        });
      }
      this.trackRegionSignatures.set(track.id, signature);
    }
  }

  dispose(): void {
    this.scheduler.stop();
  }
}
