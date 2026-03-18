// src/engine/groove-templates.ts
// Groove DNA — micro-timing templates extracted from real drum performances.
// Each template defines per-instrument timing offsets (fractional steps) and
// optional velocity scaling per step position within a bar.
// All functions are pure — they return new arrays without mutating input.

import type { MusicalEvent, NoteEvent, TriggerEvent } from './canonical-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Instrument lane key for groove template lookup. */
export type InstrumentHint = 'kick' | 'snare' | 'hat' | 'melodic';

/**
 * A groove template encodes systematic per-instrument, per-beat timing and
 * velocity offsets that give patterns authentic feel. Unlike random humanize
 * jitter, groove templates apply *musical* micro-timing — a kick slightly
 * ahead, snare slightly behind, hats swung.
 */
export interface GrooveTemplate {
  name: string;
  description: string;
  genre: string[];
  /** Number of steps per bar the template is defined for. */
  stepsPerBar: number;
  /**
   * Per-instrument timing offsets in fractional steps.
   * Positive = late (behind the beat), negative = early (ahead of the beat).
   * Array length must equal stepsPerBar. `default` is used when no instrument
   * hint matches.
   */
  timing: {
    kick?: number[];
    snare?: number[];
    hat?: number[];
    melodic?: number[];
    default: number[];
  };
  /**
   * Per-instrument velocity multipliers (1.0 = no change).
   * Optional — when absent, velocity is not modified.
   */
  velocity?: {
    kick?: number[];
    snare?: number[];
    hat?: number[];
    melodic?: number[];
    default?: number[];
  };
}

// ---------------------------------------------------------------------------
// Built-in templates
// ---------------------------------------------------------------------------

const straight: GrooveTemplate = {
  name: 'straight',
  description: 'No deviation — perfectly quantized reference.',
  genre: ['any'],
  stepsPerBar: 16,
  timing: {
    default: new Array(16).fill(0),
  },
};

const mpcSwing: GrooveTemplate = {
  name: 'mpc_swing',
  description: 'Lazy, behind-the-beat MPC feel. Hats swing on upbeats, kick and snare sit slightly late.',
  genre: ['hip-hop', 'neo-soul', 'boom-bap', 'lo-fi'],
  stepsPerBar: 16,
  timing: {
    kick:    [0, 0, 0, 0,  0.02, 0, 0, 0,  0, 0, 0, 0,  0.02, 0, 0, 0],
    snare:   [0, 0, 0, 0,  0.03, 0, 0, 0,  0, 0, 0, 0,  0.03, 0, 0, 0],
    hat:     [0, 0.08, 0, 0.10,  0, 0.07, 0, 0.12,  0, 0.08, 0, 0.10,  0, 0.07, 0, 0.11],
    default: [0, 0.05, 0, 0.06,  0, 0.05, 0, 0.07,  0, 0.05, 0, 0.06,  0, 0.05, 0, 0.07],
  },
  velocity: {
    hat:     [1.0, 0.75, 1.0, 0.7,  1.0, 0.75, 1.0, 0.7,  1.0, 0.75, 1.0, 0.7,  1.0, 0.75, 1.0, 0.7],
  },
};

const shuffle808: GrooveTemplate = {
  name: '808_shuffle',
  description: 'TR-808 hardware shuffle character — even 16ths with swing on upbeats.',
  genre: ['electro', 'miami-bass', 'trap'],
  stepsPerBar: 16,
  timing: {
    kick:    [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0],
    snare:   [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0],
    hat:     [0, 0.12, 0, 0.12,  0, 0.12, 0, 0.12,  0, 0.12, 0, 0.12,  0, 0.12, 0, 0.12],
    default: [0, 0.08, 0, 0.08,  0, 0.08, 0, 0.08,  0, 0.08, 0, 0.08,  0, 0.08, 0, 0.08],
  },
};

const garage: GrooveTemplate = {
  name: 'garage',
  description: 'UK garage 2-step bounce — skipped kicks, shuffled hats, syncopated snare.',
  genre: ['uk-garage', '2-step', 'speed-garage'],
  stepsPerBar: 16,
  timing: {
    kick:    [0, 0, 0, 0.06,  0, 0, 0, 0,  0, 0, 0, 0.06,  0, 0, 0, 0],
    snare:   [0, 0, 0, 0,  0.04, 0, 0, 0,  0, 0, 0, 0,  0.04, 0, 0, 0],
    hat:     [0, 0.10, 0, 0.08,  0, 0.10, 0, 0.06,  0, 0.10, 0, 0.08,  0, 0.10, 0, 0.06],
    default: [0, 0.06, 0, 0.05,  0, 0.06, 0, 0.04,  0, 0.06, 0, 0.05,  0, 0.06, 0, 0.04],
  },
  velocity: {
    hat:     [1.0, 0.65, 0.9, 0.6,  1.0, 0.65, 0.9, 0.6,  1.0, 0.65, 0.9, 0.6,  1.0, 0.65, 0.9, 0.6],
  },
};

const technoDrive: GrooveTemplate = {
  name: 'techno_drive',
  description: 'Slightly ahead, pushing feel — kick drives forward, hats rush.',
  genre: ['techno', 'industrial', 'hard-techno'],
  stepsPerBar: 16,
  timing: {
    kick:    [-0.03, 0, 0, 0,  -0.04, 0, 0, 0,  -0.03, 0, 0, 0,  -0.05, 0, 0, 0],
    snare:   [0, 0, 0, 0,  -0.02, 0, 0, 0,  0, 0, 0, 0,  -0.02, 0, 0, 0],
    hat:     [-0.02, -0.01, -0.02, -0.01,  -0.02, -0.01, -0.03, -0.01,  -0.02, -0.01, -0.02, -0.01,  -0.02, -0.01, -0.03, -0.01],
    default: [-0.02, 0, -0.01, 0,  -0.02, 0, -0.01, 0,  -0.02, 0, -0.01, 0,  -0.02, 0, -0.01, 0],
  },
  velocity: {
    kick:    [1.05, 1.0, 1.0, 1.0,  1.05, 1.0, 1.0, 1.0,  1.05, 1.0, 1.0, 1.0,  1.08, 1.0, 1.0, 1.0],
  },
};

const laidBack: GrooveTemplate = {
  name: 'laid_back',
  description: 'Everything slightly late — relaxed, behind-the-beat feel.',
  genre: ['reggae', 'dub', 'r&b', 'neo-soul'],
  stepsPerBar: 16,
  timing: {
    kick:    [0.04, 0.03, 0.04, 0.03,  0.05, 0.03, 0.04, 0.03,  0.04, 0.03, 0.04, 0.03,  0.05, 0.03, 0.04, 0.03],
    snare:   [0.06, 0.04, 0.05, 0.04,  0.07, 0.04, 0.05, 0.04,  0.06, 0.04, 0.05, 0.04,  0.08, 0.05, 0.06, 0.04],
    hat:     [0.03, 0.05, 0.04, 0.06,  0.03, 0.05, 0.04, 0.07,  0.03, 0.05, 0.04, 0.06,  0.03, 0.05, 0.04, 0.07],
    default: [0.04, 0.04, 0.04, 0.04,  0.05, 0.04, 0.04, 0.04,  0.04, 0.04, 0.04, 0.04,  0.05, 0.04, 0.04, 0.04],
  },
};

const dnbBreak: GrooveTemplate = {
  name: 'dnb_break',
  description: 'Breakbeat timing — syncopated snare ghost notes, rushing hats.',
  genre: ['drum-and-bass', 'jungle', 'breakbeat'],
  stepsPerBar: 16,
  timing: {
    kick:    [0, 0, 0, 0,  0, 0, 0, 0,  -0.02, 0, 0, 0,  0, 0, 0, 0],
    snare:   [0, 0, 0, 0,  0.03, 0, -0.03, 0,  0, 0, 0, 0,  0.03, 0, -0.03, 0],
    hat:     [-0.02, 0.04, -0.01, 0.05,  -0.02, 0.04, -0.01, 0.06,  -0.02, 0.04, -0.01, 0.05,  -0.02, 0.04, -0.01, 0.06],
    default: [0, 0.03, 0, 0.03,  0, 0.03, 0, 0.04,  0, 0.03, 0, 0.03,  0, 0.03, 0, 0.04],
  },
  velocity: {
    snare:   [1.0, 0.7, 1.0, 0.65,  1.0, 0.7, 0.6, 0.65,  1.0, 0.7, 1.0, 0.65,  1.0, 0.7, 0.6, 0.65],
    hat:     [1.0, 0.6, 0.9, 0.55,  1.0, 0.6, 0.9, 0.5,  1.0, 0.6, 0.9, 0.55,  1.0, 0.6, 0.9, 0.5],
  },
};

const dilla: GrooveTemplate = {
  name: 'dilla',
  description: 'Drunk timing — extreme behind-the-beat feel with uneven offsets. Inspired by J Dilla.',
  genre: ['hip-hop', 'neo-soul', 'lo-fi'],
  stepsPerBar: 16,
  timing: {
    kick:    [0, 0.02, 0.04, 0.01,  0.06, 0.02, 0.03, 0.01,  0, 0.02, 0.05, 0.01,  0.07, 0.02, 0.03, 0.01],
    snare:   [0.03, 0.05, 0.02, 0.06,  0.08, 0.04, 0.03, 0.07,  0.03, 0.05, 0.02, 0.06,  0.10, 0.04, 0.03, 0.07],
    hat:     [0, 0.10, 0.03, 0.12,  0.02, 0.08, 0.04, 0.15,  0, 0.10, 0.03, 0.12,  0.02, 0.08, 0.04, 0.15],
    default: [0.02, 0.06, 0.03, 0.07,  0.04, 0.05, 0.03, 0.08,  0.02, 0.06, 0.03, 0.07,  0.04, 0.05, 0.03, 0.09],
  },
  velocity: {
    hat:     [0.9, 0.55, 0.85, 0.5,  0.9, 0.55, 0.8, 0.45,  0.9, 0.55, 0.85, 0.5,  0.9, 0.55, 0.8, 0.45],
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** All built-in groove templates, keyed by name. */
export const GROOVE_TEMPLATES: Record<string, GrooveTemplate> = {
  straight,
  mpc_swing: mpcSwing,
  '808_shuffle': shuffle808,
  garage,
  techno_drive: technoDrive,
  laid_back: laidBack,
  dnb_break: dnbBreak,
  dilla,
};

/** Names of all available groove templates. */
export const GROOVE_TEMPLATE_NAMES = Object.keys(GROOVE_TEMPLATES);

// ---------------------------------------------------------------------------
// applyGroove
// ---------------------------------------------------------------------------

/**
 * Apply a groove template to a set of musical events.
 *
 * For each trigger/note event, maps its step position to the template's
 * timing offset for the given instrument, scales by `amount`, and shifts
 * the event's `at` position. Optionally applies velocity scaling.
 *
 * Parameter events are passed through unchanged.
 *
 * @param events - Input events (not mutated).
 * @param template - The groove template to apply.
 * @param amount - Groove intensity, 0.0 (none) to 1.0 (full template values).
 * @param instrumentHint - Which instrument lane to use from the template.
 * @param duration - Pattern duration in steps (for wrapping). When omitted,
 *   negative `at` values are clamped to 0.
 */
export function applyGroove(
  events: MusicalEvent[],
  template: GrooveTemplate,
  amount: number,
  instrumentHint?: InstrumentHint,
  duration?: number,
): MusicalEvent[] {
  if (amount <= 0) return events.map(e => ({ ...e }));

  const clampedAmount = Math.min(1, amount);
  const timingLane = getTimingLane(template, instrumentHint);
  const velocityLane = getVelocityLane(template, instrumentHint);
  const steps = template.stepsPerBar;

  const result = events.map((e) => {
    if (e.kind === 'parameter') return { ...e };

    const clone = { ...e };

    // Map event step to template index (wrap for multi-bar patterns)
    const stepIndex = ((Math.round(clone.at) % steps) + steps) % steps;

    // Apply timing offset
    const timingOffset = timingLane[stepIndex] * clampedAmount;
    let newAt = clone.at + timingOffset;

    // Wrap or clamp
    if (duration != null && duration > 0) {
      newAt = ((newAt % duration) + duration) % duration;
    } else if (newAt < 0) {
      newAt = 0;
    }
    clone.at = newAt;

    // Apply velocity scaling
    if (velocityLane && 'velocity' in clone && clone.velocity !== undefined) {
      const velScale = velocityLane[stepIndex];
      // Interpolate toward the template's velocity scaling based on amount
      const scaledVel = (clone as NoteEvent | TriggerEvent).velocity! * (1 + (velScale - 1) * clampedAmount);
      (clone as NoteEvent | TriggerEvent).velocity = Math.max(0, Math.min(1, scaledVel));
    }

    return clone;
  });

  return result.sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTimingLane(template: GrooveTemplate, hint?: InstrumentHint): number[] {
  if (hint && template.timing[hint]) return template.timing[hint]!;
  return template.timing.default;
}

function getVelocityLane(template: GrooveTemplate, hint?: InstrumentHint): number[] | undefined {
  if (!template.velocity) return undefined;
  if (hint && template.velocity[hint]) return template.velocity[hint]!;
  return template.velocity.default;
}
