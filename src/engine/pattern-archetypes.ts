// src/engine/pattern-archetypes.ts — Built-in pattern archetypes for common rhythmic/melodic patterns.

import type { MusicalEvent, TriggerEvent, NoteEvent } from './canonical-types';

export type InstrumentHintType = 'kick' | 'snare' | 'hat' | 'bass' | 'melodic' | 'chord' | 'percussion';

export interface PatternArchetype {
  name: string;
  description: string;
  genre: string[];
  instrumentHint: InstrumentHintType;
  stepsPerBar: number;
  bars: number;
  events: MusicalEvent[];
  variants?: Record<string, MusicalEvent[]>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trigger(at: number, velocity = 0.8, accent = false): TriggerEvent {
  return { kind: 'trigger', at, velocity, ...(accent ? { accent: true } : {}) };
}

function note(at: number, pitch: number, velocity = 0.8, duration = 0.5): NoteEvent {
  return { kind: 'note', at, pitch, velocity, duration };
}

// ---------------------------------------------------------------------------
// Built-in archetypes
// ---------------------------------------------------------------------------

const ARCHETYPES: Record<string, PatternArchetype> = {
  // ---- Drums ----
  four_on_the_floor: {
    name: 'four_on_the_floor',
    description: 'Classic kick on every beat — house, techno, disco.',
    genre: ['house', 'techno', 'disco'],
    instrumentHint: 'kick',
    stepsPerBar: 16,
    bars: 1,
    events: [
      trigger(0, 1.0, true),
      trigger(4, 0.9),
      trigger(8, 0.95),
      trigger(12, 0.9),
    ],
  },

  two_and_four: {
    name: 'two_and_four',
    description: 'Snare on beats 2 and 4 — rock, pop, funk.',
    genre: ['rock', 'pop', 'funk'],
    instrumentHint: 'snare',
    stepsPerBar: 16,
    bars: 1,
    events: [
      trigger(4, 0.9, true),
      trigger(12, 0.9, true),
    ],
  },

  offbeat_hat: {
    name: 'offbeat_hat',
    description: 'Hi-hat on upbeats — reggae, dub, ska.',
    genre: ['reggae', 'dub', 'ska'],
    instrumentHint: 'hat',
    stepsPerBar: 16,
    bars: 1,
    events: [
      trigger(2, 0.7),
      trigger(6, 0.7),
      trigger(10, 0.7),
      trigger(14, 0.7),
    ],
  },

  '16th_hat': {
    name: '16th_hat',
    description: 'Straight 16th note hi-hats with accent pattern.',
    genre: ['house', 'techno', 'pop'],
    instrumentHint: 'hat',
    stepsPerBar: 16,
    bars: 1,
    events: Array.from({ length: 16 }, (_, i) =>
      trigger(i, i % 4 === 0 ? 0.9 : i % 2 === 0 ? 0.6 : 0.4),
    ),
  },

  breakbeat: {
    name: 'breakbeat',
    description: 'Syncopated break pattern — breakbeat, big beat.',
    genre: ['breakbeat', 'big beat'],
    instrumentHint: 'percussion',
    stepsPerBar: 16,
    bars: 1,
    events: [
      trigger(0, 1.0, true),   // kick
      trigger(3, 0.7),         // ghost
      trigger(4, 0.9, true),   // snare
      trigger(6, 0.6),         // ghost
      trigger(8, 0.5),         // ghost kick
      trigger(10, 0.9, true),  // snare
      trigger(11, 0.6),        // ghost
      trigger(13, 0.7),        // ghost
    ],
  },

  halftime: {
    name: 'halftime',
    description: 'Half-time feel — snare on beat 3 only.',
    genre: ['trap', 'dubstep', 'half-time'],
    instrumentHint: 'snare',
    stepsPerBar: 16,
    bars: 1,
    events: [
      trigger(8, 1.0, true),
    ],
  },

  dnb_break: {
    name: 'dnb_break',
    description: 'Two-bar drum & bass break — fast syncopated pattern.',
    genre: ['dnb', 'jungle'],
    instrumentHint: 'percussion',
    stepsPerBar: 16,
    bars: 2,
    events: [
      // Bar 1
      trigger(0, 1.0, true),
      trigger(4, 0.9, true),
      trigger(6, 0.6),
      trigger(10, 0.9, true),
      trigger(14, 0.7),
      // Bar 2
      trigger(16, 0.95, true),
      trigger(18, 0.5),
      trigger(20, 0.9, true),
      trigger(24, 0.6),
      trigger(26, 0.9, true),
      trigger(30, 0.7),
    ],
  },

  // ---- Bass ----
  root_eighth: {
    name: 'root_eighth',
    description: 'Eighth-note root bass — steady pulse.',
    genre: ['rock', 'punk', 'pop'],
    instrumentHint: 'bass',
    stepsPerBar: 16,
    bars: 1,
    events: Array.from({ length: 8 }, (_, i) =>
      note(i * 2, 36, i % 4 === 0 ? 0.9 : 0.7, 1.5),
    ),
  },

  octave_bounce: {
    name: 'octave_bounce',
    description: 'Alternating root and octave — disco, house bass.',
    genre: ['disco', 'house'],
    instrumentHint: 'bass',
    stepsPerBar: 16,
    bars: 1,
    events: [
      note(0, 36, 0.9, 1.5),
      note(2, 48, 0.7, 1.5),
      note(4, 36, 0.85, 1.5),
      note(6, 48, 0.7, 1.5),
      note(8, 36, 0.9, 1.5),
      note(10, 48, 0.7, 1.5),
      note(12, 36, 0.85, 1.5),
      note(14, 48, 0.7, 1.5),
    ],
  },

  walking_bass: {
    name: 'walking_bass',
    description: 'Quarter-note walking bass line — jazz, blues.',
    genre: ['jazz', 'blues'],
    instrumentHint: 'bass',
    stepsPerBar: 16,
    bars: 1,
    events: [
      note(0, 36, 0.9, 3.5),
      note(4, 40, 0.8, 3.5),
      note(8, 43, 0.8, 3.5),
      note(12, 41, 0.8, 3.5),
    ],
  },

  syncopated_sub: {
    name: 'syncopated_sub',
    description: 'Syncopated sub bass — dubstep, UK bass.',
    genre: ['dubstep', 'uk bass', 'grime'],
    instrumentHint: 'bass',
    stepsPerBar: 16,
    bars: 1,
    events: [
      note(0, 36, 1.0, 3.0),
      note(6, 36, 0.7, 2.0),
      note(10, 36, 0.8, 2.5),
      note(14, 36, 0.6, 1.0),
    ],
  },

  // ---- Melodic ----
  arp_up: {
    name: 'arp_up',
    description: 'Ascending arpeggio — 16th note upward pattern.',
    genre: ['trance', 'synthpop', 'edm'],
    instrumentHint: 'melodic',
    stepsPerBar: 16,
    bars: 1,
    events: [
      note(0, 60, 0.9, 0.5),
      note(1, 64, 0.7, 0.5),
      note(2, 67, 0.7, 0.5),
      note(3, 72, 0.8, 0.5),
      note(4, 60, 0.85, 0.5),
      note(5, 64, 0.7, 0.5),
      note(6, 67, 0.7, 0.5),
      note(7, 72, 0.8, 0.5),
      note(8, 60, 0.9, 0.5),
      note(9, 64, 0.7, 0.5),
      note(10, 67, 0.7, 0.5),
      note(11, 72, 0.8, 0.5),
      note(12, 60, 0.85, 0.5),
      note(13, 64, 0.7, 0.5),
      note(14, 67, 0.7, 0.5),
      note(15, 72, 0.8, 0.5),
    ],
  },

  arp_down: {
    name: 'arp_down',
    description: 'Descending arpeggio — 16th note downward pattern.',
    genre: ['trance', 'synthpop', 'edm'],
    instrumentHint: 'melodic',
    stepsPerBar: 16,
    bars: 1,
    events: [
      note(0, 72, 0.9, 0.5),
      note(1, 67, 0.7, 0.5),
      note(2, 64, 0.7, 0.5),
      note(3, 60, 0.8, 0.5),
      note(4, 72, 0.85, 0.5),
      note(5, 67, 0.7, 0.5),
      note(6, 64, 0.7, 0.5),
      note(7, 60, 0.8, 0.5),
      note(8, 72, 0.9, 0.5),
      note(9, 67, 0.7, 0.5),
      note(10, 64, 0.7, 0.5),
      note(11, 60, 0.8, 0.5),
      note(12, 72, 0.85, 0.5),
      note(13, 67, 0.7, 0.5),
      note(14, 64, 0.7, 0.5),
      note(15, 60, 0.8, 0.5),
    ],
  },

  arp_updown: {
    name: 'arp_updown',
    description: 'Up-then-down arpeggio — bouncing pattern.',
    genre: ['trance', 'synthpop', 'edm'],
    instrumentHint: 'melodic',
    stepsPerBar: 16,
    bars: 1,
    events: [
      note(0, 60, 0.9, 0.5),
      note(1, 64, 0.7, 0.5),
      note(2, 67, 0.7, 0.5),
      note(3, 72, 0.8, 0.5),
      note(4, 72, 0.85, 0.5),
      note(5, 67, 0.7, 0.5),
      note(6, 64, 0.7, 0.5),
      note(7, 60, 0.8, 0.5),
      note(8, 60, 0.9, 0.5),
      note(9, 64, 0.7, 0.5),
      note(10, 67, 0.7, 0.5),
      note(11, 72, 0.8, 0.5),
      note(12, 72, 0.85, 0.5),
      note(13, 67, 0.7, 0.5),
      note(14, 64, 0.7, 0.5),
      note(15, 60, 0.8, 0.5),
    ],
  },

  stab: {
    name: 'stab',
    description: 'Rhythmic chord stabs — house, garage.',
    genre: ['house', 'garage', 'disco'],
    instrumentHint: 'chord',
    stepsPerBar: 16,
    bars: 1,
    events: [
      // Beat 1 chord
      note(0, 60, 0.9, 0.25),
      note(0, 64, 0.9, 0.25),
      note(0, 67, 0.9, 0.25),
      // Offbeat stab
      note(3, 60, 0.7, 0.25),
      note(3, 64, 0.7, 0.25),
      note(3, 67, 0.7, 0.25),
      // Beat 3 chord
      note(8, 60, 0.85, 0.25),
      note(8, 64, 0.85, 0.25),
      note(8, 67, 0.85, 0.25),
      // Offbeat stab
      note(11, 60, 0.65, 0.25),
      note(11, 64, 0.65, 0.25),
      note(11, 67, 0.65, 0.25),
    ],
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Look up an archetype by name.
 */
export function getArchetype(name: string): PatternArchetype | undefined {
  return ARCHETYPES[name];
}

/**
 * Return a summary list of all available archetypes.
 */
export function getArchetypeList(): { name: string; description: string; instrumentHint: string }[] {
  return Object.values(ARCHETYPES).map(a => ({
    name: a.name,
    description: a.description,
    instrumentHint: a.instrumentHint,
  }));
}

/**
 * Generate events from a named archetype, optionally rescaling to different
 * step counts or bar lengths.
 *
 * Options:
 * - `bars`: target bar count (default: archetype's own bar count)
 * - `stepsPerBar`: target steps per bar (default: archetype's own)
 *
 * When the target differs from the archetype's native resolution, events are
 * proportionally rescaled.
 */
export function generateArchetypeEvents(
  name: string,
  options?: { bars?: number; stepsPerBar?: number },
): MusicalEvent[] {
  const archetype = ARCHETYPES[name];
  if (!archetype) return [];

  const srcSteps = archetype.stepsPerBar;
  const srcBars = archetype.bars;
  const dstSteps = options?.stepsPerBar ?? srcSteps;
  const dstBars = options?.bars ?? srcBars;

  // Step 1: Rescale per-bar positions if stepsPerBar changed
  let baseEvents: MusicalEvent[];
  if (srcSteps === dstSteps) {
    baseEvents = archetype.events.map(e => ({ ...e }));
  } else {
    const stepScale = dstSteps / srcSteps;
    baseEvents = archetype.events.map(e => {
      const scaled = { ...e, at: e.at * stepScale };
      if (e.kind === 'note' && 'duration' in e) {
        (scaled as NoteEvent).duration = (e as NoteEvent).duration * stepScale;
      }
      return scaled;
    });
  }

  // Step 2: Tile across bars if requesting more bars than source
  if (dstBars > srcBars) {
    const oneCopySteps = dstSteps * srcBars;
    return tileEvents(baseEvents, oneCopySteps, dstBars, srcBars);
  }

  return baseEvents;
}

/**
 * Tile a set of events across multiple bars by repeating the source events.
 */
function tileEvents(
  events: MusicalEvent[],
  srcTotalSteps: number,
  dstBars: number,
  srcBars: number,
): MusicalEvent[] {
  const result: MusicalEvent[] = [];
  const repetitions = Math.ceil(dstBars / srcBars);
  for (let rep = 0; rep < repetitions; rep++) {
    const offset = rep * srcTotalSteps;
    for (const e of events) {
      result.push({ ...e, at: e.at + offset });
    }
  }
  return result;
}

/** All archetype names. Exported for test/tool use. */
export const ARCHETYPE_NAMES = Object.keys(ARCHETYPES);
