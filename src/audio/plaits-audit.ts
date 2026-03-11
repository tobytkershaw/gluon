import type { SynthParams } from './synth-interface';
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
