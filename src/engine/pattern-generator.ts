// src/engine/pattern-generator.ts — Composable pattern generators with layered transformations.

import type { MusicalEvent, TriggerEvent, NoteEvent } from './canonical-types';
import { generateArchetypeEvents } from './pattern-archetypes';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GeneratorBase =
  | { type: 'pulse'; steps: number; pulses: number; rotation?: number }   // Euclidean
  | { type: 'sequence'; hits: number[] }
  | { type: 'probability'; density: number }
  | { type: 'archetype'; name: string };

export type GeneratorLayer =
  | { type: 'velocity_cycle'; values: number[] }
  | { type: 'accent'; positions: number[]; amount: number }
  | { type: 'skip_every'; n: number; offset?: number }
  | { type: 'swing'; amount: number }
  | { type: 'humanize'; timing: number; velocity: number }
  | { type: 'pitch_pattern'; notes: number[]; mode: 'cycle' | 'random' }
  | { type: 'ghost_notes'; probability: number; velocity: number }
  | { type: 'density_ramp'; from: number; to: number };

export interface PatternGenerator {
  base: GeneratorBase;
  layers: GeneratorLayer[];
  bars?: number;
}

// ---------------------------------------------------------------------------
// Seeded PRNG — deterministic for reproducibility
// ---------------------------------------------------------------------------

/**
 * Simple 32-bit xorshift seeded PRNG.
 * Returns a function that produces values in [0, 1).
 */
function seededRandom(seed: number): () => number {
  let state = seed | 0 || 1; // ensure non-zero
  return () => {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return ((state >>> 0) / 0xFFFFFFFF);
  };
}

/**
 * Simple string hash for seeding the PRNG.
 */
function hashString(s: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Build a seed from the generator description for deterministic output.
 */
function generatorSeed(gen: PatternGenerator): number {
  return hashString(JSON.stringify(gen));
}

// ---------------------------------------------------------------------------
// Euclidean rhythm
// ---------------------------------------------------------------------------

/**
 * Bjorklund's algorithm for Euclidean rhythms.
 * Returns an array of `steps` booleans with `pulses` evenly distributed.
 */
function bjorklund(steps: number, pulses: number): boolean[] {
  if (pulses >= steps) return Array(steps).fill(true);
  if (pulses <= 0) return Array(steps).fill(false);

  let pattern: number[][] = [];
  const remainder: number[][] = [];

  for (let i = 0; i < steps; i++) {
    if (i < pulses) pattern.push([1]);
    else remainder.push([0]);
  }

  while (remainder.length > 1) {
    const newPattern: number[][] = [];
    const newRemainder: number[][] = [];
    const minLen = Math.min(pattern.length, remainder.length);

    for (let i = 0; i < minLen; i++) {
      newPattern.push([...pattern[i], ...remainder[i]]);
    }

    // Leftover from whichever was longer
    if (pattern.length > remainder.length) {
      for (let i = minLen; i < pattern.length; i++) {
        newRemainder.push(pattern[i]);
      }
    } else {
      for (let i = minLen; i < remainder.length; i++) {
        newRemainder.push(remainder[i]);
      }
    }

    pattern = newPattern;
    remainder.length = 0;
    remainder.push(...newRemainder);
  }

  // Flatten and merge remaining
  const flat = [...pattern, ...remainder].flat();
  return flat.map(v => v === 1);
}

// ---------------------------------------------------------------------------
// Base generators
// ---------------------------------------------------------------------------

function generatePulse(base: Extract<GeneratorBase, { type: 'pulse' }>, stepsPerBar: number, bars: number): MusicalEvent[] {
  const totalSteps = stepsPerBar * bars;
  const pattern = bjorklund(base.steps, base.pulses);
  const rotation = base.rotation ?? 0;
  const events: TriggerEvent[] = [];

  // Scale step positions to fit within totalSteps
  const stepScale = totalSteps / base.steps;

  for (let i = 0; i < base.steps; i++) {
    const rotatedIdx = (i + rotation) % base.steps;
    if (pattern[rotatedIdx]) {
      events.push({ kind: 'trigger', at: i * stepScale, velocity: 0.8 });
    }
  }

  return events;
}

function generateSequence(base: Extract<GeneratorBase, { type: 'sequence' }>, stepsPerBar: number, bars: number): MusicalEvent[] {
  const totalSteps = stepsPerBar * bars;
  return base.hits
    .filter(h => h >= 0 && h < totalSteps)
    .map(h => ({ kind: 'trigger' as const, at: h, velocity: 0.8 }));
}

function generateProbability(base: Extract<GeneratorBase, { type: 'probability' }>, stepsPerBar: number, bars: number, rng: () => number): MusicalEvent[] {
  const totalSteps = stepsPerBar * bars;
  const events: TriggerEvent[] = [];
  for (let i = 0; i < totalSteps; i++) {
    if (rng() < base.density) {
      events.push({ kind: 'trigger', at: i, velocity: 0.8 });
    }
  }
  return events;
}

function generateArchetypeBase(base: Extract<GeneratorBase, { type: 'archetype' }>, stepsPerBar: number, bars: number): MusicalEvent[] {
  return generateArchetypeEvents(base.name, { stepsPerBar, bars });
}

function generateBase(base: GeneratorBase, stepsPerBar: number, bars: number, rng: () => number): MusicalEvent[] {
  switch (base.type) {
    case 'pulse': return generatePulse(base, stepsPerBar, bars);
    case 'sequence': return generateSequence(base, stepsPerBar, bars);
    case 'probability': return generateProbability(base, stepsPerBar, bars, rng);
    case 'archetype': return generateArchetypeBase(base, stepsPerBar, bars);
  }
}

// ---------------------------------------------------------------------------
// Layer application
// ---------------------------------------------------------------------------

function applyVelocityCycle(events: MusicalEvent[], layer: Extract<GeneratorLayer, { type: 'velocity_cycle' }>): MusicalEvent[] {
  if (layer.values.length === 0) return events;
  return events.map((e, i) => {
    const vel = layer.values[i % layer.values.length];
    if (e.kind === 'trigger') return { ...e, velocity: vel };
    if (e.kind === 'note') return { ...e, velocity: vel };
    return e;
  });
}

function applyAccent(events: MusicalEvent[], layer: Extract<GeneratorLayer, { type: 'accent' }>): MusicalEvent[] {
  const posSet = new Set(layer.positions);
  return events.map(e => {
    if (!posSet.has(e.at)) return e;
    if (e.kind === 'trigger') {
      const vel = (e.velocity ?? 0.8) + layer.amount;
      return { ...e, velocity: Math.max(0, Math.min(1, vel)), accent: true };
    }
    if (e.kind === 'note') {
      const vel = e.velocity + layer.amount;
      return { ...e, velocity: Math.max(0, Math.min(1, vel)) };
    }
    return e;
  });
}

function applySkipEvery(events: MusicalEvent[], layer: Extract<GeneratorLayer, { type: 'skip_every' }>): MusicalEvent[] {
  const offset = layer.offset ?? 0;
  return events.filter((_, i) => (i + offset) % layer.n !== 0);
}

function applySwing(events: MusicalEvent[], layer: Extract<GeneratorLayer, { type: 'swing' }>): MusicalEvent[] {
  return events.map(e => {
    // Swing offbeat 16ths: odd-numbered steps get pushed forward
    const isOffbeat = Math.abs(e.at % 2 - 1) < 0.001;
    if (!isOffbeat) return e;
    const swingOffset = layer.amount * 0.5; // max 0.5 step shift
    return { ...e, at: e.at + swingOffset };
  });
}

function applyHumanize(events: MusicalEvent[], layer: Extract<GeneratorLayer, { type: 'humanize' }>, rng: () => number): MusicalEvent[] {
  return events.map(e => {
    const timingJitter = (rng() - 0.5) * 2 * layer.timing * 0.2; // max ±0.2 steps
    const newAt = Math.max(0, e.at + timingJitter);
    if (e.kind === 'trigger') {
      const vel = (e.velocity ?? 0.8) + (rng() - 0.5) * 2 * layer.velocity * 0.15;
      return { ...e, at: newAt, velocity: Math.max(0, Math.min(1, vel)) };
    }
    if (e.kind === 'note') {
      const vel = e.velocity + (rng() - 0.5) * 2 * layer.velocity * 0.15;
      return { ...e, at: newAt, velocity: Math.max(0, Math.min(1, vel)) };
    }
    return { ...e, at: newAt };
  });
}

function applyPitchPattern(events: MusicalEvent[], layer: Extract<GeneratorLayer, { type: 'pitch_pattern' }>, rng: () => number): MusicalEvent[] {
  if (layer.notes.length === 0) return events;
  return events.map((e, i) => {
    let pitch: number;
    if (layer.mode === 'cycle') {
      pitch = layer.notes[i % layer.notes.length];
    } else {
      pitch = layer.notes[Math.floor(rng() * layer.notes.length)];
    }
    if (e.kind === 'trigger') {
      // Convert trigger to note
      return {
        kind: 'note' as const,
        at: e.at,
        pitch,
        velocity: e.velocity ?? 0.8,
        duration: 0.5,
      };
    }
    if (e.kind === 'note') {
      return { ...e, pitch };
    }
    return e;
  });
}

function applyGhostNotes(events: MusicalEvent[], layer: Extract<GeneratorLayer, { type: 'ghost_notes' }>, stepsPerBar: number, bars: number, rng: () => number): MusicalEvent[] {
  const totalSteps = stepsPerBar * bars;
  const existingPositions = new Set(events.map(e => Math.round(e.at * 100) / 100));
  const ghosts: MusicalEvent[] = [];

  for (let step = 0; step < totalSteps; step++) {
    if (existingPositions.has(step)) continue;
    if (rng() < layer.probability) {
      ghosts.push({ kind: 'trigger', at: step, velocity: layer.velocity });
    }
  }

  return [...events, ...ghosts].sort((a, b) => a.at - b.at);
}

function applyDensityRamp(events: MusicalEvent[], layer: Extract<GeneratorLayer, { type: 'density_ramp' }>, rng: () => number): MusicalEvent[] {
  if (events.length === 0) return events;
  const maxAt = events.reduce((max, e) => Math.max(max, e.at), 0);
  if (maxAt <= 0) return events;

  return events.filter(e => {
    const progress = e.at / maxAt;
    const threshold = layer.from + progress * (layer.to - layer.from);
    return rng() < threshold;
  });
}

function applyLayer(
  events: MusicalEvent[],
  layer: GeneratorLayer,
  rng: () => number,
  stepsPerBar: number,
  bars: number,
): MusicalEvent[] {
  switch (layer.type) {
    case 'velocity_cycle': return applyVelocityCycle(events, layer);
    case 'accent': return applyAccent(events, layer);
    case 'skip_every': return applySkipEvery(events, layer);
    case 'swing': return applySwing(events, layer);
    case 'humanize': return applyHumanize(events, layer, rng);
    case 'pitch_pattern': return applyPitchPattern(events, layer, rng);
    case 'ghost_notes': return applyGhostNotes(events, layer, stepsPerBar, bars, rng);
    case 'density_ramp': return applyDensityRamp(events, layer, rng);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate events from a PatternGenerator definition.
 * Computation is deterministic — same input produces same output.
 *
 * @param gen  Generator definition (base + layers)
 * @param stepsPerBar  Steps per bar (default 16)
 * @param patternDuration  Optional pattern duration in steps — used to infer
 *                         bar count when `gen.bars` is not set.
 */
export function generateFromGenerator(
  gen: PatternGenerator,
  stepsPerBar = 16,
  patternDuration?: number,
): MusicalEvent[] {
  const bars = gen.bars
    ?? (patternDuration != null ? Math.max(1, Math.floor(patternDuration / stepsPerBar)) : 1);
  const rng = seededRandom(generatorSeed(gen));

  let events = generateBase(gen.base, stepsPerBar, bars, rng);

  for (const layer of gen.layers) {
    events = applyLayer(events, layer, rng, stepsPerBar, bars);
  }

  // Sort by position
  events.sort((a, b) => a.at - b.at);

  return events;
}
