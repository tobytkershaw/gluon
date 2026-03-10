// src/engine/sequencer-helpers.ts
import type { Step, Pattern } from './sequencer-types';

export function createDefaultStep(): Step {
  return { gate: false, accent: false, micro: 0 };
}

export function createDefaultPattern(length = 16): Pattern {
  const clamped = Math.max(1, Math.min(64, length));
  return {
    steps: Array.from({ length: clamped }, createDefaultStep),
    length: clamped,
  };
}
