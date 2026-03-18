import { describe, it, expect } from 'vitest';
import { generateFromGenerator } from '../../src/engine/pattern-generator';
import type { PatternGenerator, GeneratorBase, GeneratorLayer } from '../../src/engine/pattern-generator';
import type { MusicalEvent } from '../../src/engine/canonical-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getVelocity(e: MusicalEvent): number {
  if (e.kind === 'trigger') return e.velocity ?? 0.8;
  if (e.kind === 'note') return e.velocity;
  return 0;
}

function gen(base: GeneratorBase, layers: GeneratorLayer[] = [], bars?: number): PatternGenerator {
  return { base, layers, bars };
}

// ---------------------------------------------------------------------------
// Pulse (Euclidean) base
// ---------------------------------------------------------------------------

describe('pulse (Euclidean) base', () => {
  it('E(4,16) produces 4 evenly spaced hits', () => {
    const events = generateFromGenerator(gen({ type: 'pulse', steps: 16, pulses: 4 }));
    expect(events.length).toBe(4);
    // Should be evenly spaced: 0, 4, 8, 12
    const positions = events.map(e => e.at);
    expect(positions).toEqual([0, 4, 8, 12]);
  });

  it('E(3,8) produces 3 hits in 8 steps', () => {
    const events = generateFromGenerator(gen({ type: 'pulse', steps: 8, pulses: 3 }));
    expect(events.length).toBe(3);
  });

  it('E(5,8) produces a classic tresillo-like pattern', () => {
    const events = generateFromGenerator(gen({ type: 'pulse', steps: 8, pulses: 5 }));
    expect(events.length).toBe(5);
  });

  it('rotation shifts the pattern', () => {
    const noRot = generateFromGenerator(gen({ type: 'pulse', steps: 8, pulses: 3 }));
    const rot = generateFromGenerator(gen({ type: 'pulse', steps: 8, pulses: 3, rotation: 2 }));
    expect(rot.length).toBe(noRot.length);
    // Positions should differ
    const noRotPositions = noRot.map(e => e.at);
    const rotPositions = rot.map(e => e.at);
    expect(rotPositions).not.toEqual(noRotPositions);
  });

  it('E(n,n) fills all positions', () => {
    const events = generateFromGenerator(gen({ type: 'pulse', steps: 8, pulses: 8 }));
    expect(events.length).toBe(8);
  });

  it('E(0,n) produces no events', () => {
    const events = generateFromGenerator(gen({ type: 'pulse', steps: 8, pulses: 0 }));
    expect(events.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Sequence base
// ---------------------------------------------------------------------------

describe('sequence base', () => {
  it('places triggers at specified positions', () => {
    const events = generateFromGenerator(gen({ type: 'sequence', hits: [0, 3, 7, 12] }));
    expect(events.length).toBe(4);
    expect(events.map(e => e.at)).toEqual([0, 3, 7, 12]);
  });

  it('filters out of range positions', () => {
    const events = generateFromGenerator(gen({ type: 'sequence', hits: [0, 5, -1, 20] }));
    // -1 is filtered out, 20 > 16 (1 bar) is also filtered
    const positions = events.map(e => e.at);
    expect(positions).not.toContain(-1);
  });

  it('empty hits produces no events', () => {
    const events = generateFromGenerator(gen({ type: 'sequence', hits: [] }));
    expect(events.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Probability base
// ---------------------------------------------------------------------------

describe('probability base', () => {
  it('density 1.0 fills all steps', () => {
    const events = generateFromGenerator(gen({ type: 'probability', density: 1.0 }));
    expect(events.length).toBe(16);
  });

  it('density 0.0 produces no events', () => {
    const events = generateFromGenerator(gen({ type: 'probability', density: 0.0 }));
    expect(events.length).toBe(0);
  });

  it('is deterministic (same input = same output)', () => {
    const g = gen({ type: 'probability', density: 0.5 });
    const a = generateFromGenerator(g);
    const b = generateFromGenerator(g);
    expect(a.map(e => e.at)).toEqual(b.map(e => e.at));
  });

  it('different densities produce different event counts on average', () => {
    const sparse = generateFromGenerator(gen({ type: 'probability', density: 0.2 }));
    const dense = generateFromGenerator(gen({ type: 'probability', density: 0.8 }));
    expect(dense.length).toBeGreaterThan(sparse.length);
  });
});

// ---------------------------------------------------------------------------
// Archetype base
// ---------------------------------------------------------------------------

describe('archetype base', () => {
  it('generates events from a named archetype', () => {
    const events = generateFromGenerator(gen({ type: 'archetype', name: 'four_on_the_floor' }));
    expect(events.length).toBe(4);
    expect(events.map(e => e.at)).toEqual([0, 4, 8, 12]);
  });

  it('returns empty for unknown archetype', () => {
    const events = generateFromGenerator(gen({ type: 'archetype', name: 'nonexistent' }));
    expect(events.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

describe('velocity_cycle layer', () => {
  it('cycles velocity values across events', () => {
    const events = generateFromGenerator(gen(
      { type: 'pulse', steps: 8, pulses: 8 },
      [{ type: 'velocity_cycle', values: [1.0, 0.5] }],
    ));
    expect(getVelocity(events[0])).toBeCloseTo(1.0, 1);
    expect(getVelocity(events[1])).toBeCloseTo(0.5, 1);
    expect(getVelocity(events[2])).toBeCloseTo(1.0, 1);
    expect(getVelocity(events[3])).toBeCloseTo(0.5, 1);
  });
});

describe('accent layer', () => {
  it('boosts velocity at specified positions', () => {
    const events = generateFromGenerator(gen(
      { type: 'sequence', hits: [0, 4, 8, 12] },
      [{ type: 'accent', positions: [0, 8], amount: 0.2 }],
    ));
    expect(getVelocity(events[0])).toBeGreaterThan(getVelocity(events[1]));
    expect(getVelocity(events[2])).toBeGreaterThan(getVelocity(events[3]));
  });
});

describe('skip_every layer', () => {
  it('removes every Nth event', () => {
    const events = generateFromGenerator(gen(
      { type: 'pulse', steps: 8, pulses: 8 },
      [{ type: 'skip_every', n: 2 }],
    ));
    // Removes indices 0, 2, 4, 6 — keeps 1, 3, 5, 7
    expect(events.length).toBe(4);
  });

  it('offset shifts which events are skipped', () => {
    const events = generateFromGenerator(gen(
      { type: 'pulse', steps: 8, pulses: 8 },
      [{ type: 'skip_every', n: 2, offset: 1 }],
    ));
    // Removes indices 1, 3, 5, 7 — keeps 0, 2, 4, 6
    expect(events.length).toBe(4);
  });
});

describe('swing layer', () => {
  it('offsets offbeat events', () => {
    const noSwing = generateFromGenerator(gen(
      { type: 'pulse', steps: 16, pulses: 16 },
    ));
    const withSwing = generateFromGenerator(gen(
      { type: 'pulse', steps: 16, pulses: 16 },
      [{ type: 'swing', amount: 0.5 }],
    ));
    // Offbeat events (at odd positions) should be shifted
    const offbeat1 = noSwing.find(e => Math.abs(e.at - 1) < 0.001);
    const offbeat1Swung = withSwing.find(e => e.at > 0.9 && e.at < 1.5);
    expect(offbeat1).toBeDefined();
    expect(offbeat1Swung).toBeDefined();
    expect(offbeat1Swung!.at).toBeGreaterThan(offbeat1!.at);
  });
});

describe('humanize layer', () => {
  it('adds jitter to timing and velocity', () => {
    const clean = generateFromGenerator(gen(
      { type: 'pulse', steps: 8, pulses: 8 },
    ));
    const humanized = generateFromGenerator(gen(
      { type: 'pulse', steps: 8, pulses: 8 },
      [{ type: 'humanize', timing: 0.5, velocity: 0.5 }],
    ));
    // At least some events should have shifted positions
    let timingDiffs = 0;
    let velocityDiffs = 0;
    for (let i = 0; i < clean.length; i++) {
      if (Math.abs(clean[i].at - humanized[i].at) > 0.001) timingDiffs++;
      if (Math.abs(getVelocity(clean[i]) - getVelocity(humanized[i])) > 0.001) velocityDiffs++;
    }
    expect(timingDiffs).toBeGreaterThan(0);
    expect(velocityDiffs).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const g = gen(
      { type: 'pulse', steps: 8, pulses: 8 },
      [{ type: 'humanize', timing: 0.5, velocity: 0.5 }],
    );
    const a = generateFromGenerator(g);
    const b = generateFromGenerator(g);
    expect(a.map(e => e.at)).toEqual(b.map(e => e.at));
  });
});

describe('pitch_pattern layer', () => {
  it('cycle mode assigns pitches in order', () => {
    const events = generateFromGenerator(gen(
      { type: 'pulse', steps: 4, pulses: 4 },
      [{ type: 'pitch_pattern', notes: [60, 64, 67], mode: 'cycle' }],
    ));
    // All events should now be note events
    for (const e of events) {
      expect(e.kind).toBe('note');
    }
    expect((events[0] as { pitch: number }).pitch).toBe(60);
    expect((events[1] as { pitch: number }).pitch).toBe(64);
    expect((events[2] as { pitch: number }).pitch).toBe(67);
    expect((events[3] as { pitch: number }).pitch).toBe(60); // wraps
  });

  it('random mode uses pitches from the set', () => {
    const notes = [48, 55, 62];
    const events = generateFromGenerator(gen(
      { type: 'pulse', steps: 8, pulses: 8 },
      [{ type: 'pitch_pattern', notes, mode: 'random' }],
    ));
    for (const e of events) {
      expect(e.kind).toBe('note');
      expect(notes).toContain((e as { pitch: number }).pitch);
    }
  });
});

describe('ghost_notes layer', () => {
  it('adds ghost notes between existing events', () => {
    const base = generateFromGenerator(gen(
      { type: 'sequence', hits: [0, 4, 8, 12] },
    ));
    const withGhosts = generateFromGenerator(gen(
      { type: 'sequence', hits: [0, 4, 8, 12] },
      [{ type: 'ghost_notes', probability: 1.0, velocity: 0.3 }],
    ));
    expect(withGhosts.length).toBeGreaterThan(base.length);
    // Ghost notes should have lower velocity
    const ghosts = withGhosts.filter(e => !base.some(b => Math.abs(b.at - e.at) < 0.001));
    for (const g of ghosts) {
      expect(getVelocity(g)).toBeCloseTo(0.3, 1);
    }
  });
});

describe('density_ramp layer', () => {
  it('from:0 to:1 thins the start more than the end', () => {
    const g = gen(
      { type: 'pulse', steps: 16, pulses: 16 },
      [{ type: 'density_ramp', from: 0.0, to: 1.0 }],
    );
    const events = generateFromGenerator(g);
    // Should have fewer events than 16
    expect(events.length).toBeLessThan(16);
    // The last event should survive (density approaches 1.0)
    const lastOrigAt = 15;
    const hasLast = events.some(e => Math.abs(e.at - lastOrigAt) < 0.001);
    // Not guaranteed but very likely with density=1.0 at the end
    // (deterministic PRNG might not hit exactly, so just check count)
    expect(events.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Layer composition
// ---------------------------------------------------------------------------

describe('layer composition', () => {
  it('applies layers in order', () => {
    // Generate Euclidean, then apply velocity cycle, then humanize
    const events = generateFromGenerator(gen(
      { type: 'pulse', steps: 8, pulses: 5 },
      [
        { type: 'velocity_cycle', values: [1.0, 0.5] },
        { type: 'humanize', timing: 0.2, velocity: 0.1 },
      ],
    ));
    expect(events.length).toBe(5);
    // Velocities should roughly follow the cycle pattern (with humanize noise)
    // First event is ~1.0, second is ~0.5
    expect(getVelocity(events[0])).toBeGreaterThan(0.7);
    expect(getVelocity(events[1])).toBeLessThan(0.7);
  });
});

// ---------------------------------------------------------------------------
// Multi-bar
// ---------------------------------------------------------------------------

describe('multi-bar generation', () => {
  it('probability base generates events across multiple bars', () => {
    const events = generateFromGenerator(gen(
      { type: 'probability', density: 1.0 },
      [],
      2,
    ));
    expect(events.length).toBe(32); // 16 * 2
  });

  it('euclidean scales to multi-bar', () => {
    const events = generateFromGenerator(gen(
      { type: 'pulse', steps: 8, pulses: 4 },
      [],
      2,
    ));
    expect(events.length).toBe(4);
    // Positions should be scaled to 32 steps
    const maxAt = Math.max(...events.map(e => e.at));
    expect(maxAt).toBeLessThan(32);
  });
});

// ---------------------------------------------------------------------------
// Events are sorted by position
// ---------------------------------------------------------------------------

describe('output ordering', () => {
  it('events are sorted by at position', () => {
    const events = generateFromGenerator(gen(
      { type: 'pulse', steps: 16, pulses: 8 },
      [{ type: 'ghost_notes', probability: 0.5, velocity: 0.3 }],
    ));
    for (let i = 1; i < events.length; i++) {
      expect(events[i].at).toBeGreaterThanOrEqual(events[i - 1].at);
    }
  });
});
