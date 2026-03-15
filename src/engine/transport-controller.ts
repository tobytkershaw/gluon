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

interface TransportControllerDeps {
  audio: AudioEngine;
  getSession: () => Session;
  onPositionChange: (step: number) => void;
  getHeldParams: (trackId: string) => Partial<SynthParamValues>;
  onParameterEvent?: (trackId: string, controlId: string, value: number | string | boolean) => void;
}

export class TransportController {
  private readonly audio: AudioEngine;
  private readonly getSession: () => Session;
  private readonly onPositionChange: (step: number) => void;
  private readonly scheduler: Scheduler;
  private runtime: RuntimeTransportState;
  private pendingHardStop = false;
  private lastStep = 0;

  constructor({
    audio,
    getSession,
    onPositionChange,
    getHeldParams,
    onParameterEvent,
  }: TransportControllerDeps) {
    this.audio = audio;
    this.getSession = getSession;
    this.onPositionChange = onPositionChange;
    this.runtime = createRuntimeTransport(getSession().transport);
    this.scheduler = new Scheduler(
      getSession,
      () => this.audio.getCurrentTime(),
      () => this.audio.getState(),
      (note) => this.audio.scheduleNote(note, this.runtime.generation),
      (step) => {
        this.lastStep = step;
        this.runtime = { ...this.runtime, playheadBeats: step / 4 };
        this.onPositionChange(step);
      },
      getHeldParams,
      onParameterEvent,
    );
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
        this.audio.releaseAll(generation);
        this.runtime = pauseTransportState(
          { ...this.runtime, playheadBeats: this.lastStep / 4 },
          generation,
        );
      }
    } else if (this.runtime.status !== 'stopped') {
      this.scheduler.stop();
      const generation = this.audio.advanceGeneration();
      if (this.pendingHardStop) {
        this.audio.silenceAll(generation);
      } else {
        this.audio.releaseAll(generation);
      }
      this.pendingHardStop = false;
      this.lastStep = 0;
      this.runtime = stopTransportState(this.runtime, generation);
      this.onPositionChange(0);
    } else if (this.pendingHardStop) {
      const generation = this.audio.advanceGeneration();
      this.audio.silenceAll(generation);
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

  dispose(): void {
    this.scheduler.stop();
  }
}
