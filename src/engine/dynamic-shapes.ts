// src/engine/dynamic-shapes.ts — Named velocity contour shapes applied as post-processing.

import type { MusicalEvent } from './canonical-types';

export interface DynamicShape {
  name: string;
  description: string;
  apply(events: MusicalEvent[], stepsPerBar: number): MusicalEvent[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp a value to 0-1 range. */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Apply a velocity multiplier to an event, returning a new event. */
function withVelocity(e: MusicalEvent, multiplier: number): MusicalEvent {
  if (e.kind === 'trigger') {
    const vel = e.velocity ?? 0.8;
    return { ...e, velocity: clamp01(vel * multiplier) };
  }
  if (e.kind === 'note') {
    return { ...e, velocity: clamp01(e.velocity * multiplier) };
  }
  // parameter events have no velocity
  return e;
}

// ---------------------------------------------------------------------------
// Shape definitions
// ---------------------------------------------------------------------------

const SHAPES: Record<string, DynamicShape> = {
  accent_downbeats: {
    name: 'accent_downbeats',
    description: 'Strong on beat 1, moderate on beats 2-4, soft on upbeats.',
    apply(events, stepsPerBar) {
      const beatSize = stepsPerBar / 4;
      return events.map(e => {
        const posInBar = e.at % stepsPerBar;
        if (Math.abs(posInBar) < 0.001) return withVelocity(e, 1.2);         // beat 1
        if (Math.abs(posInBar % beatSize) < 0.001) return withVelocity(e, 1.0); // other beats
        return withVelocity(e, 0.7);                                         // upbeats
      });
    },
  },

  accent_backbeat: {
    name: 'accent_backbeat',
    description: 'Strong accents on beats 2 and 4.',
    apply(events, stepsPerBar) {
      const beatSize = stepsPerBar / 4;
      return events.map(e => {
        const posInBar = e.at % stepsPerBar;
        const beat = Math.round(posInBar / beatSize);
        if (beat === 1 || beat === 3) return withVelocity(e, 1.2);  // beats 2 and 4 (0-indexed 1,3)
        return withVelocity(e, 0.8);
      });
    },
  },

  accent_offbeats: {
    name: 'accent_offbeats',
    description: 'Accent upbeats between main beats.',
    apply(events, stepsPerBar) {
      const beatSize = stepsPerBar / 4;
      return events.map(e => {
        const posInBar = e.at % stepsPerBar;
        const isOnBeat = Math.abs(posInBar % beatSize) < 0.001;
        return withVelocity(e, isOnBeat ? 0.7 : 1.1);
      });
    },
  },

  crescendo: {
    name: 'crescendo',
    description: 'Linearly increasing velocity across the pattern.',
    apply(events, stepsPerBar) {
      if (events.length === 0) return events;
      const maxAt = events.reduce((max, e) => Math.max(max, e.at), 0);
      const totalDuration = maxAt > 0 ? maxAt : stepsPerBar;
      return events.map(e => {
        const progress = e.at / totalDuration;
        // Map from 0.5 to 1.2 multiplier
        const multiplier = 0.5 + progress * 0.7;
        return withVelocity(e, multiplier);
      });
    },
  },

  decrescendo: {
    name: 'decrescendo',
    description: 'Linearly decreasing velocity across the pattern.',
    apply(events, stepsPerBar) {
      if (events.length === 0) return events;
      const maxAt = events.reduce((max, e) => Math.max(max, e.at), 0);
      const totalDuration = maxAt > 0 ? maxAt : stepsPerBar;
      return events.map(e => {
        const progress = e.at / totalDuration;
        // Map from 1.2 to 0.5 multiplier
        const multiplier = 1.2 - progress * 0.7;
        return withVelocity(e, multiplier);
      });
    },
  },

  ghost_verse: {
    name: 'ghost_verse',
    description: 'Mostly soft (0.3-0.4 velocity) with occasional accents (0.9) — sparse, delicate feel.',
    apply(events, stepsPerBar) {
      const beatSize = stepsPerBar / 4;
      return events.map(e => {
        const posInBar = e.at % stepsPerBar;
        // Accent beat 1 only, everything else ghosted
        if (Math.abs(posInBar) < 0.001) return withVelocity(e, 1.1);
        // Occasional accent on beat 3
        if (Math.abs(posInBar - beatSize * 2) < 0.001) return withVelocity(e, 0.9);
        // Ghost everything else
        return withVelocity(e, 0.4);
      });
    },
  },

  push_pull: {
    name: 'push_pull',
    description: 'Alternating loud-soft pattern creating rhythmic tension.',
    apply(events) {
      return events.map((e, i) => {
        const multiplier = i % 2 === 0 ? 1.1 : 0.6;
        return withVelocity(e, multiplier);
      });
    },
  },

  swell: {
    name: 'swell',
    description: 'Soft → loud → soft (sine curve) — builds and releases within the pattern.',
    apply(events, stepsPerBar) {
      if (events.length === 0) return events;
      const maxAt = events.reduce((max, e) => Math.max(max, e.at), 0);
      const totalDuration = maxAt > 0 ? maxAt : stepsPerBar;
      return events.map(e => {
        const progress = e.at / totalDuration;
        // Sine curve from 0 to pi, mapped to 0.4 to 1.2
        const sine = Math.sin(progress * Math.PI);
        const multiplier = 0.4 + sine * 0.8;
        return withVelocity(e, multiplier);
      });
    },
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply a named dynamic shape to a set of events.
 * Returns a new array with velocity-modified events.
 * If the shape name is not found, returns events unchanged.
 */
export function applyDynamicShape(
  name: string,
  events: MusicalEvent[],
  stepsPerBar: number,
): MusicalEvent[] {
  const shape = SHAPES[name];
  if (!shape) return events;
  return shape.apply(events, stepsPerBar);
}

/**
 * Return a summary list of all available dynamic shapes.
 */
export function getDynamicShapeList(): { name: string; description: string }[] {
  return Object.values(SHAPES).map(s => ({
    name: s.name,
    description: s.description,
  }));
}

/** All shape names. Exported for test/tool use. */
export const DYNAMIC_SHAPE_NAMES = Object.keys(SHAPES);
