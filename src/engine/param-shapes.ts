// src/engine/param-shapes.ts — Inline parameter shape types and evaluation.
// Lets the AI describe parameter changes over a pattern as shapes (ramps,
// triangles, cycles) that expand to ParameterEvent p-locks at sketch time.

import type { ParameterEvent } from './canonical-types';

// ---------------------------------------------------------------------------
// Shape type definitions
// ---------------------------------------------------------------------------

export interface RampUpShape {
  shape: 'ramp_up';
  period: number;       // in steps
  range: [number, number]; // [min, max]
}

export interface RampDownShape {
  shape: 'ramp_down';
  period: number;
  range: [number, number];
}

export interface TriangleShape {
  shape: 'triangle';
  period: number;
  range: [number, number];
}

export interface SineShape {
  shape: 'sine';
  period: number;
  range: [number, number];
  phase?: number; // 0-1, default 0
}

export interface SquareShape {
  shape: 'square';
  period: number;
  range: [number, number];
}

export interface RandomWalkShape {
  shape: 'random_walk';
  range: [number, number];
  stepSize: number;     // max delta per step
}

export interface StepsShape {
  shape: 'steps';
  values: number[];
  stepsPerValue: number;
}

export interface EnvelopeShape {
  shape: 'envelope';
  attack: number;       // in steps
  hold: number;         // in steps
  release: number;      // in steps
  range: [number, number];
}

export type ParamShape =
  | RampUpShape
  | RampDownShape
  | TriangleShape
  | SineShape
  | SquareShape
  | RandomWalkShape
  | StepsShape
  | EnvelopeShape;

/** Map from controlId to the shape that drives it. */
export type ParamShapes = Record<string, ParamShape>;

// ---------------------------------------------------------------------------
// Shape evaluation — pure function, no side effects
// ---------------------------------------------------------------------------

/**
 * Evaluate a parameter shape at a given step position.
 * Returns a value in the shape's range.
 *
 * @param shape  The shape definition
 * @param step   Step position within the pattern (0-based)
 * @param seed   Optional seed for deterministic random_walk (default: 42)
 */
export function evaluateShape(shape: ParamShape, step: number, seed = 42): number {
  const [lo, hi] = shape.range ?? [0, 1];

  switch (shape.shape) {
    case 'ramp_up': {
      const t = (step % shape.period) / shape.period;
      return lo + (hi - lo) * t;
    }

    case 'ramp_down': {
      const t = (step % shape.period) / shape.period;
      return hi - (hi - lo) * t;
    }

    case 'triangle': {
      const t = (step % shape.period) / shape.period;
      // 0→1 for first half, 1→0 for second half
      const tri = t < 0.5 ? t * 2 : 2 - t * 2;
      return lo + (hi - lo) * tri;
    }

    case 'sine': {
      const phase = shape.phase ?? 0;
      const t = (step % shape.period) / shape.period;
      const s = Math.sin(2 * Math.PI * (t + phase));
      // Map [-1, 1] to [lo, hi]
      return lo + (hi - lo) * (s + 1) / 2;
    }

    case 'square': {
      const t = (step % shape.period) / shape.period;
      return t < 0.5 ? hi : lo;
    }

    case 'random_walk': {
      // Deterministic pseudo-random walk using a simple hash.
      // Walk from midpoint using seeded steps.
      let value = (lo + hi) / 2;
      for (let i = 0; i <= step; i++) {
        const hash = simpleHash(seed + i);
        const delta = (hash - 0.5) * 2 * shape.stepSize;
        value = Math.max(lo, Math.min(hi, value + delta));
      }
      return value;
    }

    case 'steps': {
      const idx = Math.floor(step / shape.stepsPerValue) % shape.values.length;
      return shape.values[idx];
    }

    case 'envelope': {
      const { attack, hold, release } = shape;
      const total = attack + hold + release;
      const pos = step % total;
      if (pos < attack) {
        // Attack phase: ramp up
        return lo + (hi - lo) * (pos / attack);
      } else if (pos < attack + hold) {
        // Hold phase: sustain at hi
        return hi;
      } else {
        // Release phase: ramp down
        const releasePos = pos - attack - hold;
        return hi - (hi - lo) * (releasePos / release);
      }
    }

    default:
      return lo;
  }
}

/**
 * Simple deterministic hash returning a value in [0, 1).
 * Used for random_walk reproducibility.
 */
function simpleHash(n: number): number {
  let h = (n * 2654435761) >>> 0;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) >>> 0;
  return (h & 0x7fffffff) / 0x80000000;
}

// ---------------------------------------------------------------------------
// Expansion: shape → ParameterEvent[]
// ---------------------------------------------------------------------------

/**
 * Expand param shapes into ParameterEvent arrays that can be merged into
 * a pattern's event list. Generates one ParameterEvent per step per shape.
 *
 * @param shapes        Map of controlId → ParamShape
 * @param patternLength Duration of the pattern in steps
 * @param seed          Optional seed for random_walk reproducibility
 * @returns Array of ParameterEvents, sorted by `at`
 */
export function expandParamShapes(
  shapes: ParamShapes,
  patternLength: number,
  seed = 42,
): ParameterEvent[] {
  const events: ParameterEvent[] = [];

  for (const [controlId, shape] of Object.entries(shapes)) {
    for (let step = 0; step < patternLength; step++) {
      const value = evaluateShape(shape, step, seed);
      events.push({
        kind: 'parameter',
        at: step,
        controlId,
        value,
      });
    }
  }

  // Sort by `at` to maintain canonical invariant
  events.sort((a, b) => a.at - b.at);
  return events;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_SHAPES = new Set([
  'ramp_up', 'ramp_down', 'triangle', 'sine', 'square',
  'random_walk', 'steps', 'envelope',
]);

/**
 * Validate a ParamShape definition. Returns null if valid, or an error string.
 */
export function validateParamShape(shape: unknown): string | null {
  if (!shape || typeof shape !== 'object') return 'Shape must be an object';
  const s = shape as Record<string, unknown>;

  if (!s.shape || typeof s.shape !== 'string') return 'Shape must have a "shape" field';
  if (!VALID_SHAPES.has(s.shape)) return `Unknown shape type: "${s.shape}"`;

  // Validate range for shapes that use it
  if (s.shape !== 'steps') {
    if (!Array.isArray(s.range) || s.range.length !== 2) {
      return `Shape "${s.shape}" requires a range: [min, max]`;
    }
    const [lo, hi] = s.range as number[];
    if (typeof lo !== 'number' || typeof hi !== 'number') {
      return 'Range values must be numbers';
    }
    if (lo < 0 || lo > 1 || hi < 0 || hi > 1) {
      return 'Range values must be between 0.0 and 1.0';
    }
  }

  // Shape-specific validation
  switch (s.shape) {
    case 'ramp_up':
    case 'ramp_down':
    case 'triangle':
    case 'sine':
    case 'square':
      if (typeof s.period !== 'number' || s.period <= 0) {
        return `Shape "${s.shape}" requires a positive period`;
      }
      break;

    case 'random_walk':
      if (typeof s.stepSize !== 'number' || s.stepSize <= 0) {
        return 'random_walk requires a positive stepSize';
      }
      break;

    case 'steps':
      if (!Array.isArray(s.values) || s.values.length === 0) {
        return 'steps requires a non-empty values array';
      }
      for (const v of s.values as unknown[]) {
        if (typeof v !== 'number') return 'steps values must be numbers';
      }
      if (typeof s.stepsPerValue !== 'number' || s.stepsPerValue <= 0) {
        return 'steps requires a positive stepsPerValue';
      }
      break;

    case 'envelope':
      if (typeof s.attack !== 'number' || s.attack < 0) {
        return 'envelope requires a non-negative attack';
      }
      if (typeof s.hold !== 'number' || s.hold < 0) {
        return 'envelope requires a non-negative hold';
      }
      if (typeof s.release !== 'number' || s.release < 0) {
        return 'envelope requires a non-negative release';
      }
      if ((s.attack as number) + (s.hold as number) + (s.release as number) <= 0) {
        return 'envelope total duration (attack + hold + release) must be > 0';
      }
      break;
  }

  return null;
}

/**
 * Validate all shapes in a paramShapes record. Returns null if all valid,
 * or the first error string found.
 */
export function validateParamShapes(shapes: unknown): string | null {
  if (!shapes || typeof shapes !== 'object') return 'paramShapes must be an object';
  for (const [controlId, shape] of Object.entries(shapes as Record<string, unknown>)) {
    const err = validateParamShape(shape);
    if (err) return `paramShapes.${controlId}: ${err}`;
  }
  return null;
}
