import type { SynthParams } from './synth-interface';
import { PlaitsSynth } from './plaits-synth';
import type { ScheduledNote } from '../engine/sequencer-types';

export interface PlaitsAuditScenario {
  id: string;
  durationSeconds: number;
  model: number;
  baseParams: SynthParams;
  notes: ScheduledNote[];
}

export interface BufferMetrics {
  peak: number;
  rms: number;
  maxDelta: number;
}

export interface PlaitsAuditResult {
  scenario: PlaitsAuditScenario;
  metrics: BufferMetrics;
  audio: Float32Array;
}

function monoFromStereo(buffer: AudioBuffer): Float32Array {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const mono = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) {
    mono[i] = (left[i] + right[i]) * 0.5;
  }
  return mono;
}

export function analyzeBuffer(audio: Float32Array): BufferMetrics {
  let peak = 0;
  let sumSquares = 0;
  let maxDelta = 0;

  for (let i = 0; i < audio.length; i += 1) {
    const sample = audio[i];
    const absSample = Math.abs(sample);
    peak = Math.max(peak, absSample);
    sumSquares += sample * sample;
    if (i > 0) {
      maxDelta = Math.max(maxDelta, Math.abs(sample - audio[i - 1]));
    }
  }

  return {
    peak,
    rms: audio.length > 0 ? Math.sqrt(sumSquares / audio.length) : 0,
    maxDelta,
  };
}

export async function renderAuditScenario(scenario: PlaitsAuditScenario): Promise<PlaitsAuditResult> {
  const sampleRate = 48_000;
  const frameCount = Math.ceil(scenario.durationSeconds * sampleRate);
  const ctx = new OfflineAudioContext(2, frameCount, sampleRate);
  const synth = await PlaitsSynth.create(ctx as unknown as AudioContext, ctx.destination);

  synth.setModel(scenario.model);
  synth.setParams(scenario.baseParams);

  for (const note of scenario.notes) {
    synth.scheduleNote(note);
  }

  const rendered = await ctx.startRendering();
  synth.destroy();

  const audio = monoFromStereo(rendered);
  return {
    scenario,
    metrics: analyzeBuffer(audio),
    audio,
  };
}

export async function runAuditSuite(scenarios: PlaitsAuditScenario[]): Promise<PlaitsAuditResult[]> {
  const results: PlaitsAuditResult[] = [];
  for (const scenario of scenarios) {
    results.push(await renderAuditScenario(scenario));
  }
  return results;
}

export const DEFAULT_AUDIT_SCENARIOS: PlaitsAuditScenario[] = [
  {
    id: 'sustain',
    durationSeconds: 2,
    model: 0,
    baseParams: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    notes: [
      {
        voiceId: 'audit',
        time: 0.05,
        gateOffTime: 1.6,
        accent: false,
        params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
      },
    ],
  },
  {
    id: 'drums',
    durationSeconds: 1.2,
    model: 13,
    baseParams: { harmonics: 0.6, timbre: 0.4, morph: 0.3, note: 0.35 },
    notes: [
      {
        voiceId: 'audit',
        time: 0.05,
        gateOffTime: 0.12,
        accent: true,
        params: { harmonics: 0.6, timbre: 0.4, morph: 0.3, note: 0.35 },
      },
      {
        voiceId: 'audit',
        time: 0.35,
        gateOffTime: 0.42,
        accent: false,
        params: { harmonics: 0.65, timbre: 0.35, morph: 0.25, note: 0.35 },
      },
      {
        voiceId: 'audit',
        time: 0.65,
        gateOffTime: 0.72,
        accent: true,
        params: { harmonics: 0.7, timbre: 0.45, morph: 0.2, note: 0.35 },
      },
    ],
  },
];
