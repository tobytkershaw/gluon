// tests/engine/sequencing-fixtures.ts
//
// Canonical sequencing fixtures for regression testing.
// Each fixture provides a PatternSketch (what the AI sends) and
// the expected Step array (what the engine should produce).

import type { PatternSketch, Step } from '../../src/engine/sequencer-types';

// ---------------------------------------------------------------------------
// Helper: create a default (silent) step
// ---------------------------------------------------------------------------
function off(): Step {
  return { gate: false, accent: false, micro: 0 };
}

function on(accent = false, params?: Record<string, number>): Step {
  return { gate: true, accent, micro: 0, ...(params ? { params } : {}) };
}

// ---------------------------------------------------------------------------
// FOUR_ON_FLOOR — kick on every beat (positions 0, 4, 8, 12)
// ---------------------------------------------------------------------------
export const FOUR_ON_FLOOR_SKETCH: PatternSketch = {
  length: 16,
  steps: [
    { index: 0, gate: true },
    { index: 4, gate: true },
    { index: 8, gate: true },
    { index: 12, gate: true },
  ],
};

export const FOUR_ON_FLOOR_EXPECTED: Step[] = Array.from({ length: 16 }, (_, i) =>
  [0, 4, 8, 12].includes(i) ? on() : off(),
);

// Positions where gates should fire
export const FOUR_ON_FLOOR_GATE_POSITIONS = [0, 4, 8, 12];

// ---------------------------------------------------------------------------
// OFFBEAT_HATS — triggers on odd positions (1, 3, 5, 7, 9, 11, 13, 15)
// ---------------------------------------------------------------------------
export const OFFBEAT_HATS_SKETCH: PatternSketch = {
  length: 16,
  steps: [1, 3, 5, 7, 9, 11, 13, 15].map(i => ({ index: i, gate: true })),
};

export const OFFBEAT_HATS_EXPECTED: Step[] = Array.from({ length: 16 }, (_, i) =>
  i % 2 === 1 ? on() : off(),
);

export const OFFBEAT_HATS_GATE_POSITIONS = [1, 3, 5, 7, 9, 11, 13, 15];

// ---------------------------------------------------------------------------
// PARAM_LOCKS — pattern with parameter events (param locks on specific steps)
// Kick on 0, 4, 8, 12 with timbre automation on 0 and 8
// ---------------------------------------------------------------------------
export const PARAM_LOCKS_SKETCH: PatternSketch = {
  length: 16,
  steps: [
    { index: 0, gate: true, params: { timbre: 0.2 } },
    { index: 4, gate: true },
    { index: 8, gate: true, params: { timbre: 0.9 } },
    { index: 12, gate: true },
  ],
};

export const PARAM_LOCKS_EXPECTED: Step[] = Array.from({ length: 16 }, (_, i) => {
  if (i === 0) return on(false, { timbre: 0.2 });
  if (i === 8) return on(false, { timbre: 0.9 });
  if (i === 4 || i === 12) return on();
  return off();
});

export const PARAM_LOCKS_GATE_POSITIONS = [0, 4, 8, 12];
export const PARAM_LOCKS_LOCK_MAP: Record<number, Record<string, number>> = {
  0: { timbre: 0.2 },
  8: { timbre: 0.9 },
};

// ---------------------------------------------------------------------------
// PITCHED_MELODY — NoteEvents with different pitches
// A simple 4-note melody on steps 0, 2, 4, 6
// ---------------------------------------------------------------------------
export const PITCHED_MELODY_SKETCH: PatternSketch = {
  length: 8,
  steps: [
    { index: 0, gate: true, params: { note: 0.47 } },   // ~C4 (MIDI 60)
    { index: 2, gate: true, params: { note: 0.52 } },   // ~D4
    { index: 4, gate: true, params: { note: 0.55 } },   // ~E4
    { index: 6, gate: true, accent: true, params: { note: 0.59 } }, // ~G4, accented
  ],
};

export const PITCHED_MELODY_EXPECTED: Step[] = Array.from({ length: 8 }, (_, i) => {
  if (i === 0) return on(false, { note: 0.47 });
  if (i === 2) return on(false, { note: 0.52 });
  if (i === 4) return on(false, { note: 0.55 });
  if (i === 6) return on(true, { note: 0.59 });
  return off();
});

export const PITCHED_MELODY_GATE_POSITIONS = [0, 2, 4, 6];
export const PITCHED_MELODY_NOTES: Record<number, number> = {
  0: 0.47,
  2: 0.52,
  4: 0.55,
  6: 0.59,
};

// ---------------------------------------------------------------------------
// MIXED_PATTERN — combination of triggers, notes, and param events
// Steps: trigger@0, note@1, param-only@3, accented-trigger@4,
//        note+param@5, trigger@8
// ---------------------------------------------------------------------------
export const MIXED_PATTERN_SKETCH: PatternSketch = {
  length: 16,
  steps: [
    { index: 0, gate: true },
    { index: 1, gate: true, params: { note: 0.47 } },
    { index: 3, gate: false, params: { timbre: 0.7 } }, // param lock on silent step
    { index: 4, gate: true, accent: true },
    { index: 5, gate: true, params: { note: 0.52, morph: 0.3 } },
    { index: 8, gate: true },
  ],
};

export const MIXED_PATTERN_EXPECTED: Step[] = Array.from({ length: 16 }, (_, i) => {
  if (i === 0) return on();
  if (i === 1) return on(false, { note: 0.47 });
  if (i === 3) return { gate: false, accent: false, micro: 0, params: { timbre: 0.7 } };
  if (i === 4) return on(true);
  if (i === 5) return on(false, { note: 0.52, morph: 0.3 });
  if (i === 8) return on();
  return off();
});

export const MIXED_PATTERN_GATE_POSITIONS = [0, 1, 4, 5, 8];
export const MIXED_PATTERN_ACCENT_POSITIONS = [4];

// ---------------------------------------------------------------------------
// EMPTY_PATTERN — nothing gated (regression: ensure empty round-trips)
// ---------------------------------------------------------------------------
export const EMPTY_PATTERN_SKETCH: PatternSketch = {
  length: 16,
  steps: [],
};

// ---------------------------------------------------------------------------
// MAX_LENGTH_PATTERN — 64 steps, gates on every 4th step
// ---------------------------------------------------------------------------
export const MAX_LENGTH_SKETCH: PatternSketch = {
  length: 64,
  steps: Array.from({ length: 16 }, (_, i) => ({ index: i * 4, gate: true })),
};

export const MAX_LENGTH_GATE_POSITIONS = Array.from({ length: 16 }, (_, i) => i * 4);
