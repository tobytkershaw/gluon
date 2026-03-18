// src/engine/musical-helpers.ts
// Higher-level musical helper primitives that operate on event arrays.
// All functions are pure — they return new arrays without mutating input.

import type { MusicalEvent, NoteEvent, TriggerEvent } from './canonical-types';

// ---------------------------------------------------------------------------
// Seeded RNG (deterministic when seed provided, Math.random fallback)
// ---------------------------------------------------------------------------

type RNG = () => number;

/**
 * Simple mulberry32 PRNG for deterministic output in tests.
 * When no seed is provided, uses Math.random.
 */
function makeRng(seed?: number): RNG {
  if (seed === undefined) return Math.random;
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// humanize
// ---------------------------------------------------------------------------

export interface HumanizeParams {
  /** Velocity jitter amount (0-1). 0 = no change, 1 = up to +/-50% of current velocity. */
  velocityAmount: number;
  /** Timing jitter amount (0-1). 0 = no change, 1 = up to +/-0.125 steps (1/32 note). */
  timingAmount: number;
  /** Optional seed for deterministic output. */
  seed?: number;
}

/**
 * Apply random velocity and timing jitter to trigger/note events.
 * Parameter events are passed through unchanged.
 *
 * - Velocity is jittered within [0, 1], scaled by velocityAmount.
 * - Timing is jittered within [0, duration), scaled by timingAmount.
 *   Maximum timing offset at amount=1 is 0.125 steps (a 1/32 note).
 */
export function humanize(
  events: MusicalEvent[],
  duration: number,
  params: HumanizeParams,
): MusicalEvent[] {
  const { velocityAmount, timingAmount, seed } = params;
  const rng = makeRng(seed);
  const maxTimingOffset = 0.125; // 1/32 note at amount=1

  const result = events.map((e) => {
    if (e.kind === 'parameter') return { ...e };

    const clone = { ...e };

    // Velocity jitter
    if (velocityAmount > 0 && 'velocity' in clone && clone.velocity !== undefined) {
      const jitter = (rng() * 2 - 1) * velocityAmount * 0.5;
      (clone as NoteEvent | TriggerEvent).velocity = Math.max(
        0,
        Math.min(1, (clone as NoteEvent | TriggerEvent).velocity! + jitter),
      );
    }

    // Timing jitter
    if (timingAmount > 0) {
      const offset = (rng() * 2 - 1) * timingAmount * maxTimingOffset;
      let newAt = clone.at + offset;
      // Wrap within [0, duration)
      newAt = ((newAt % duration) + duration) % duration;
      clone.at = newAt;
    }

    return clone;
  });

  return result.sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------------------
// euclidean
// ---------------------------------------------------------------------------

export interface EuclideanParams {
  /** Number of hits (1 to steps). */
  hits: number;
  /** Number of steps in the pattern. */
  steps: number;
  /** Rotation offset (0 to steps-1). Default: 0. */
  rotation?: number;
  /** Velocity for generated events (0-1). Default: 0.8. */
  velocity?: number;
  /** Event kind to generate. Default: 'trigger'. */
  eventKind?: 'trigger' | 'note';
  /** MIDI pitch for note events. Default: 60. */
  pitch?: number;
  /** Note duration for note events. Default: 0.25. */
  noteDuration?: number;
}

/**
 * Generate a Euclidean rhythm — maximally even distribution of `hits` among `steps`.
 * Uses the Bjorklund algorithm.
 *
 * Returns a new event array (does not merge with existing events).
 * The caller can merge the result with existing events using concat + normalize.
 */
export function euclidean(params: EuclideanParams): MusicalEvent[] {
  const {
    hits,
    steps,
    rotation = 0,
    velocity = 0.8,
    eventKind = 'trigger',
    pitch = 60,
    noteDuration = 0.25,
  } = params;

  if (hits <= 0 || steps <= 0 || hits > steps) return [];

  // Bjorklund algorithm
  const pattern = bjorklund(hits, steps);

  // Apply rotation
  const rotated = [...pattern.slice(pattern.length - rotation), ...pattern.slice(0, pattern.length - rotation)];

  // Convert to events
  const events: MusicalEvent[] = [];
  for (let i = 0; i < rotated.length; i++) {
    if (rotated[i]) {
      if (eventKind === 'note') {
        events.push({
          kind: 'note',
          at: i,
          pitch,
          velocity,
          duration: noteDuration,
        } as NoteEvent);
      } else {
        events.push({
          kind: 'trigger',
          at: i,
          velocity,
        } as TriggerEvent);
      }
    }
  }

  return events;
}

/**
 * Bjorklund algorithm (Toussaint 2005): distributes `hits` as evenly as
 * possible across `steps` via recursive remainder distribution (analogous
 * to Euclidean GCD division).
 *
 * Returns a boolean array where true = hit.
 */
function bjorklund(hits: number, steps: number): boolean[] {
  if (hits >= steps) return new Array(steps).fill(true);
  if (hits <= 0) return new Array(steps).fill(false);

  // Start with k groups of [1] (hits) and (n-k) groups of [0] (rests)
  let front: number[][] = [];
  let back: number[][] = [];
  for (let i = 0; i < hits; i++) front.push([1]);
  for (let i = 0; i < steps - hits; i++) back.push([0]);

  // Recursively distribute the remainder groups into the front groups,
  // like Euclidean GCD division, until at most one remainder is left.
  while (back.length > 1) {
    const distributeCount = Math.min(front.length, back.length);
    const newFront: number[][] = [];
    for (let i = 0; i < distributeCount; i++) {
      newFront.push([...front[i], ...back[i]]);
    }
    const newBack: number[][] = [];
    // Leftover front groups (if front was longer)
    for (let i = distributeCount; i < front.length; i++) {
      newBack.push(front[i]);
    }
    // Leftover back groups (if back was longer)
    for (let i = distributeCount; i < back.length; i++) {
      newBack.push(back[i]);
    }
    front = newFront;
    back = newBack;
  }

  // Concatenate all groups to form the final pattern
  const flat = [...front, ...back].flat();
  return flat.map(v => v === 1);
}

// ---------------------------------------------------------------------------
// ghost_notes
// ---------------------------------------------------------------------------

export interface GhostNotesParams {
  /** Velocity for ghost notes (0-1). Default: 0.3. */
  velocity?: number;
  /** Probability of adding a ghost note at each eligible position (0-1). Default: 0.5. */
  probability?: number;
  /** Optional seed for deterministic output. */
  seed?: number;
}

/**
 * Add low-velocity "ghost" hits around existing accented/loud beats.
 *
 * For each existing trigger/note event, considers the positions immediately
 * before and after it (+/- 1 step). If those positions are empty, adds a
 * ghost event there with the given probability and velocity.
 *
 * Works on both trigger and note patterns. The ghost events match the kind
 * of the source event.
 */
export function ghostNotes(
  events: MusicalEvent[],
  duration: number,
  params: GhostNotesParams = {},
): MusicalEvent[] {
  const { velocity = 0.3, probability = 0.5, seed } = params;
  const rng = makeRng(seed);

  // Index occupied positions (trigger/note only)
  const occupied = new Set<number>();
  for (const e of events) {
    if (e.kind === 'trigger' || e.kind === 'note') {
      occupied.add(Math.round(e.at));
    }
  }

  const ghosts: MusicalEvent[] = [];

  for (const e of events) {
    if (e.kind === 'parameter') continue;

    // Only generate ghosts around events that are "accented" (higher velocity)
    const eventVelocity = (e as NoteEvent | TriggerEvent).velocity ?? 0.8;
    if (eventVelocity <= velocity) continue; // Skip quiet events — they don't need ghosts

    const step = Math.round(e.at);
    const candidates = [
      ((step - 1) % duration + duration) % duration,
      ((step + 1) % duration + duration) % duration,
    ];

    for (const pos of candidates) {
      if (occupied.has(pos)) continue;
      if (rng() > probability) continue;

      occupied.add(pos); // Prevent duplicate ghosts

      if (e.kind === 'note') {
        const note = e as NoteEvent;
        ghosts.push({
          kind: 'note',
          at: pos,
          pitch: note.pitch,
          velocity,
          duration: note.duration,
        } as NoteEvent);
      } else {
        ghosts.push({
          kind: 'trigger',
          at: pos,
          velocity,
        } as TriggerEvent);
      }
    }
  }

  const result = [...events.map(e => ({ ...e })), ...ghosts];
  return result.sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------------------
// swing
// ---------------------------------------------------------------------------

export interface SwingParams {
  /** Swing amount (0-1). 0 = straight, 1 = maximum swing (dotted eighth feel). */
  amount: number;
}

/**
 * Apply swing to even-numbered steps by delaying them.
 *
 * Swing works by shifting events on even-numbered off-beats (steps 1, 3, 5, ...)
 * later in time. At amount=1, the shift is 0.5 steps (a full triplet feel).
 *
 * Only affects events that sit exactly on integer step positions.
 * Events with micro-timing offsets are left untouched.
 */
export function swing(
  events: MusicalEvent[],
  duration: number,
  params: SwingParams,
): MusicalEvent[] {
  const { amount } = params;
  if (amount <= 0) return events.map(e => ({ ...e }));

  const maxShift = 0.5; // At amount=1, shift half a step

  const result = events.map((e) => {
    const clone = { ...e };
    const step = Math.round(clone.at);
    const isOnGrid = Math.abs(clone.at - step) < 0.001;
    // Swing affects odd-numbered steps (the "and" of each beat: 1, 3, 5, 7...)
    if (isOnGrid && step % 2 === 1) {
      clone.at = clone.at + amount * maxShift;
      // Wrap within duration
      if (clone.at >= duration) clone.at -= duration;
    }
    return clone;
  });

  return result.sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------------------
// thin
// ---------------------------------------------------------------------------

export interface ThinParams {
  /** Probability of removing each event (0-1). 0 = keep all, 1 = remove all. */
  probability: number;
  /** Optional seed for deterministic output. */
  seed?: number;
}

/**
 * Probabilistically remove events from a pattern.
 * Parameter events are never thinned (they're locks, not notes).
 * Preserves at least one event if the original had any trigger/note events.
 */
export function thin(
  events: MusicalEvent[],
  params: ThinParams,
): MusicalEvent[] {
  const { probability, seed } = params;
  const rng = makeRng(seed);

  if (probability <= 0) return events.map(e => ({ ...e }));

  const paramEvents = events.filter(e => e.kind === 'parameter').map(e => ({ ...e }));
  const gateEvents = events.filter(e => e.kind !== 'parameter');

  if (gateEvents.length === 0) return [...paramEvents];

  const kept = gateEvents.filter(() => rng() >= probability).map(e => ({ ...e }));

  // Preserve at least one gate event
  if (kept.length === 0 && gateEvents.length > 0) {
    const randomIndex = Math.floor(rng() * gateEvents.length);
    kept.push({ ...gateEvents[randomIndex] });
  }

  const result = [...paramEvents, ...kept];
  return result.sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------------------
// densify
// ---------------------------------------------------------------------------

export interface DensifyParams {
  /** Probability of adding a new event at each empty step (0-1). */
  probability: number;
  /** Velocity for added events (0-1). Default: 0.6. */
  velocity?: number;
  /** Optional seed for deterministic output. */
  seed?: number;
}

/**
 * Probabilistically add events at empty integer step positions.
 * Fills gaps in a pattern — the inverse of thin.
 *
 * New events match the predominant kind in the pattern (trigger or note).
 * For note patterns, new notes use the most common pitch.
 */
export function densify(
  events: MusicalEvent[],
  duration: number,
  params: DensifyParams,
): MusicalEvent[] {
  const { probability, velocity = 0.6, seed } = params;
  const rng = makeRng(seed);

  if (probability <= 0) return events.map(e => ({ ...e }));

  // Find occupied integer positions
  const occupied = new Set<number>();
  for (const e of events) {
    if (e.kind === 'trigger' || e.kind === 'note') {
      occupied.add(Math.round(e.at));
    }
  }

  // Determine predominant event kind
  const noteCount = events.filter(e => e.kind === 'note').length;
  const triggerCount = events.filter(e => e.kind === 'trigger').length;
  const predominantKind: 'note' | 'trigger' = noteCount > triggerCount ? 'note' : 'trigger';

  // For note events, find the most common pitch
  let commonPitch = 60;
  if (predominantKind === 'note') {
    const pitchCounts = new Map<number, number>();
    for (const e of events) {
      if (e.kind === 'note') {
        const p = (e as NoteEvent).pitch;
        pitchCounts.set(p, (pitchCounts.get(p) ?? 0) + 1);
      }
    }
    let maxCount = 0;
    for (const [p, c] of pitchCounts) {
      if (c > maxCount) { maxCount = c; commonPitch = p; }
    }
  }

  const added: MusicalEvent[] = [];
  for (let step = 0; step < duration; step++) {
    if (occupied.has(step)) continue;
    if (rng() >= probability) continue;

    if (predominantKind === 'note') {
      added.push({
        kind: 'note',
        at: step,
        pitch: commonPitch,
        velocity,
        duration: 0.25,
      } as NoteEvent);
    } else {
      added.push({
        kind: 'trigger',
        at: step,
        velocity,
      } as TriggerEvent);
    }
  }

  const result = [...events.map(e => ({ ...e })), ...added];
  return result.sort((a, b) => a.at - b.at);
}
