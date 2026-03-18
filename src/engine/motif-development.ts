// src/engine/motif-development.ts — Development operations on motifs.
// Each operation is a pure function: (motif, options?) => new Motif.

import type { Motif } from './motif';
import type { MusicalEvent, NoteEvent, TriggerEvent } from './canonical-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cloneEvents(events: MusicalEvent[]): MusicalEvent[] {
  return events.map(e => ({ ...e }));
}

function isNote(e: MusicalEvent): e is NoteEvent {
  return e.kind === 'note';
}

function isTrigger(e: MusicalEvent): e is TriggerEvent {
  return e.kind === 'trigger';
}

function deriveMotif(base: Motif, override: Partial<Motif>): Motif {
  return { ...base, ...override, id: base.id + '-dev' };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** Shift all pitches by a number of semitones. */
export function transpose(motif: Motif, semitones: number): Motif {
  const events = cloneEvents(motif.events).map(e => {
    if (isNote(e)) {
      return { ...e, pitch: Math.max(0, Math.min(127, e.pitch + semitones)) };
    }
    return e;
  });
  const rootPitch = motif.rootPitch !== undefined
    ? Math.max(0, Math.min(127, motif.rootPitch + semitones))
    : undefined;
  return deriveMotif(motif, { events, rootPitch });
}

/** Mirror intervals around an axis pitch. Defaults to rootPitch or first note. */
export function invert(motif: Motif, axisPitch?: number): Motif {
  const axis = axisPitch ?? motif.rootPitch ?? findFirstPitch(motif.events) ?? 60;
  const events = cloneEvents(motif.events).map(e => {
    if (isNote(e)) {
      const interval = e.pitch - axis;
      return { ...e, pitch: Math.max(0, Math.min(127, axis - interval)) };
    }
    return e;
  });
  return deriveMotif(motif, { events });
}

/** Reverse events in time. */
export function retrograde(motif: Motif): Motif {
  const duration = motif.duration;
  const events = cloneEvents(motif.events).map(e => {
    const eventDuration = isNote(e) ? e.duration : 0;
    return { ...e, at: Math.max(0, duration - e.at - eventDuration) };
  });
  events.sort((a, b) => a.at - b.at);
  return deriveMotif(motif, { events });
}

/** Double all durations (notes and total). */
export function augment(motif: Motif, factor: number = 2): Motif {
  const events = cloneEvents(motif.events).map(e => {
    const stretched = { ...e, at: e.at * factor };
    if (isNote(stretched)) {
      return { ...stretched, duration: stretched.duration * factor };
    }
    return stretched;
  });
  return deriveMotif(motif, { events, duration: motif.duration * factor });
}

/** Halve all durations (notes and total). */
export function diminish(motif: Motif, factor: number = 2): Motif {
  const events = cloneEvents(motif.events).map(e => {
    const compressed = { ...e, at: e.at / factor };
    if (isNote(compressed)) {
      return { ...compressed, duration: compressed.duration / factor };
    }
    return compressed;
  });
  return deriveMotif(motif, { events, duration: motif.duration / factor });
}

/** Extract a subset of events by index range. */
export function fragment(
  motif: Motif,
  options: { start?: number; end?: number } = {},
): Motif {
  const start = options.start ?? 0;
  const end = options.end ?? motif.events.length;
  const events = cloneEvents(motif.events.slice(start, end));
  if (events.length === 0) {
    return deriveMotif(motif, { events, duration: 0 });
  }
  // Shift events so the fragment starts at 0
  const offset = events[0].at;
  for (const e of events) {
    e.at -= offset;
  }
  const lastEvent = events[events.length - 1];
  const lastDur = isNote(lastEvent) ? lastEvent.duration : 1;
  const newDuration = lastEvent.at + lastDur;
  return deriveMotif(motif, { events, duration: newDuration });
}

/** Reorder segments of the motif. Splits into N equal segments and rearranges by order array. */
export function permute(motif: Motif, order: number[]): Motif {
  const segCount = order.length;
  if (segCount === 0) return deriveMotif(motif, { events: [] });
  const segDur = motif.duration / segCount;

  const segments: MusicalEvent[][] = Array.from({ length: segCount }, () => []);
  for (const e of motif.events) {
    const segIdx = Math.min(Math.floor(e.at / segDur), segCount - 1);
    segments[segIdx].push({ ...e });
  }

  const events: MusicalEvent[] = [];
  for (let i = 0; i < order.length; i++) {
    const srcIdx = order[i];
    if (srcIdx < 0 || srcIdx >= segCount) continue;
    const srcOffset = srcIdx * segDur;
    const destOffset = i * segDur;
    for (const e of segments[srcIdx]) {
      events.push({ ...e, at: e.at - srcOffset + destOffset });
    }
  }
  events.sort((a, b) => a.at - b.at);
  return deriveMotif(motif, { events });
}

/** Add passing tones between consecutive notes. */
export function ornament(motif: Motif): Motif {
  const events = cloneEvents(motif.events);
  const notes = events.filter(isNote);
  const extras: NoteEvent[] = [];

  for (let i = 0; i < notes.length - 1; i++) {
    const curr = notes[i];
    const next = notes[i + 1];
    const gap = next.at - (curr.at + curr.duration);
    if (gap >= 0.25) {
      // Insert a passing tone halfway
      const midPitch = Math.round((curr.pitch + next.pitch) / 2);
      if (midPitch !== curr.pitch && midPitch !== next.pitch) {
        extras.push({
          kind: 'note',
          at: curr.at + curr.duration,
          pitch: Math.max(0, Math.min(127, midPitch)),
          velocity: curr.velocity * 0.6,
          duration: Math.min(gap, 0.25),
        });
      }
    }
  }

  const allEvents = [...events, ...extras];
  allEvents.sort((a, b) => a.at - b.at);
  return deriveMotif(motif, { events: allEvents });
}

/** Remove events by probability (0.0 = remove none, 1.0 = remove all). */
export function thin(motif: Motif, probability: number, rng?: () => number): Motif {
  const random = rng ?? Math.random;
  const events = cloneEvents(motif.events).filter(() => random() >= probability);
  return deriveMotif(motif, { events });
}

/** Stack the motif with a transposed copy to create harmony. */
export function layer(motif: Motif, intervalSemitones: number): Motif {
  const original = cloneEvents(motif.events);
  const transposed = cloneEvents(motif.events).map(e => {
    if (isNote(e)) {
      return { ...e, pitch: Math.max(0, Math.min(127, e.pitch + intervalSemitones)) };
    }
    return e;
  });
  const events = [...original, ...transposed];
  events.sort((a, b) => a.at - b.at);
  return deriveMotif(motif, { events });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function findFirstPitch(events: MusicalEvent[]): number | undefined {
  for (const e of events) {
    if (isNote(e)) return e.pitch;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Operation dispatcher — used by the tool handler
// ---------------------------------------------------------------------------

export interface DevelopmentOp {
  op: 'transpose' | 'invert' | 'retrograde' | 'augment' | 'diminish' |
      'fragment' | 'permute' | 'ornament' | 'thin' | 'layer';
  semitones?: number;
  axisPitch?: number;
  factor?: number;
  start?: number;
  end?: number;
  order?: number[];
  probability?: number;
}

/** Apply a sequence of development operations to a motif. */
export function applyDevelopmentOps(motif: Motif, ops: DevelopmentOp[]): Motif {
  let result = motif;
  for (const op of ops) {
    switch (op.op) {
      case 'transpose':
        result = transpose(result, op.semitones ?? 0);
        break;
      case 'invert':
        result = invert(result, op.axisPitch);
        break;
      case 'retrograde':
        result = retrograde(result);
        break;
      case 'augment':
        result = augment(result, op.factor ?? 2);
        break;
      case 'diminish':
        result = diminish(result, op.factor ?? 2);
        break;
      case 'fragment':
        result = fragment(result, { start: op.start, end: op.end });
        break;
      case 'permute':
        result = permute(result, op.order ?? []);
        break;
      case 'ornament':
        result = ornament(result);
        break;
      case 'thin':
        result = thin(result, op.probability ?? 0.3);
        break;
      case 'layer':
        result = layer(result, op.semitones ?? 7);
        break;
    }
  }
  return result;
}
