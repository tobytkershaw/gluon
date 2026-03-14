import type { SynthParamValues } from '../engine/types';
import type { ScheduledNote } from '../engine/sequencer-types';

export interface PlaitsAuditScenario {
  id: string;
  durationSeconds: number;
  model: number;
  baseParams: SynthParamValues;
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

export type PlaitsAuditRenderer = (scenario: PlaitsAuditScenario) => Promise<Float32Array>;

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

export async function renderAuditScenario(
  scenario: PlaitsAuditScenario,
  render: PlaitsAuditRenderer,
): Promise<PlaitsAuditResult> {
  const audio = await render(scenario);
  return {
    scenario,
    metrics: analyzeBuffer(audio),
    audio,
  };
}

export async function runAuditSuite(
  scenarios: PlaitsAuditScenario[],
  render: PlaitsAuditRenderer,
): Promise<PlaitsAuditResult[]> {
  const results: PlaitsAuditResult[] = [];
  for (const scenario of scenarios) {
    results.push(await renderAuditScenario(scenario, render));
  }
  return results;
}

// Plaits model names for reference:
// 0: Virtual Analog   1: Waveshaping      2: FM
// 3: Grain            4: Additive         5: Wavetable
// 6: Chord            7: Speech           8: Swarm
// 9: Noise            10: Particle        11: String (inharmonic)
// 12: Modal (resonator) 13: Bass drum     14: Snare drum
// 15: Hi-hat

function sustainNote(model: number, params: SynthParamValues, dur = 1.6): PlaitsAuditScenario {
  return {
    id: `model-${model}-sustain`,
    durationSeconds: dur + 0.4,
    model,
    baseParams: params,
    notes: [{
      voiceId: 'audit',
      time: 0.05,
      gateOffTime: 0.05 + dur,
      accent: false,
      params,
    }],
  };
}

function percHits(model: number, params: SynthParamValues): PlaitsAuditScenario {
  return {
    id: `model-${model}-perc`,
    durationSeconds: 1.2,
    model,
    baseParams: params,
    notes: [
      { voiceId: 'audit', time: 0.05, gateOffTime: 0.12, accent: true, params },
      { voiceId: 'audit', time: 0.35, gateOffTime: 0.42, accent: false, params: { ...params, timbre: params.timbre + 0.1 } },
      { voiceId: 'audit', time: 0.65, gateOffTime: 0.72, accent: true, params: { ...params, morph: params.morph - 0.1 } },
    ],
  };
}

function paramSweep(model: number, base: SynthParamValues): PlaitsAuditScenario {
  return {
    id: `model-${model}-sweep`,
    durationSeconds: 2.5,
    model,
    baseParams: base,
    notes: [
      { voiceId: 'audit', time: 0.05, gateOffTime: 2.0, accent: false, params: base },
      { voiceId: 'audit', time: 0.8, gateOffTime: 2.0, accent: false, params: { ...base, timbre: 0.9, morph: 0.1 } },
      { voiceId: 'audit', time: 1.5, gateOffTime: 2.0, accent: false, params: { ...base, timbre: 0.1, morph: 0.9 } },
    ],
  };
}

const mid: SynthParamValues = { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 };

export const DEFAULT_AUDIT_SCENARIOS: PlaitsAuditScenario[] = [
  // Tonal models — sustain + param sweep to test smoothing
  sustainNote(0, mid),                                             // Virtual Analog
  sustainNote(1, mid),                                             // Waveshaping
  sustainNote(2, { harmonics: 0.4, timbre: 0.6, morph: 0.3, note: 0.47 }), // FM
  sustainNote(3, { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.55 }), // Grain
  sustainNote(4, { harmonics: 0.7, timbre: 0.5, morph: 0.5, note: 0.47 }), // Additive
  sustainNote(5, mid),                                             // Wavetable
  sustainNote(6, { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.40 }), // Chord
  sustainNote(7, { harmonics: 0.3, timbre: 0.5, morph: 0.5, note: 0.47 }), // Speech
  sustainNote(8, mid),                                             // Swarm
  sustainNote(9, { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 }), // Noise
  sustainNote(10, { harmonics: 0.5, timbre: 0.4, morph: 0.6, note: 0.47 }), // Particle
  sustainNote(11, { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 }), // String
  sustainNote(12, { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 }), // Modal

  // Drum models — short percussive hits (trigger pulse width matters here)
  percHits(13, { harmonics: 0.6, timbre: 0.4, morph: 0.3, note: 0.35 }), // Bass drum
  percHits(14, { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.40 }), // Snare
  percHits(15, { harmonics: 0.5, timbre: 0.7, morph: 0.5, note: 0.50 }), // Hi-hat

  // Param sweep on a few key models — tests smoothing under rapid changes
  paramSweep(0, mid),                                              // VA sweep
  paramSweep(8, mid),                                              // Swarm sweep
  paramSweep(12, mid),                                             // Modal sweep
];
