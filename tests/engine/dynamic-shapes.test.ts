import { describe, it, expect } from 'vitest';
import {
  applyDynamicShape,
  getDynamicShapeList,
  DYNAMIC_SHAPE_NAMES,
} from '../../src/engine/dynamic-shapes';
import type { MusicalEvent, TriggerEvent, NoteEvent } from '../../src/engine/canonical-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trigger(at: number, velocity = 0.8): TriggerEvent {
  return { kind: 'trigger', at, velocity };
}

function note(at: number, pitch = 60, velocity = 0.8): NoteEvent {
  return { kind: 'note', at, pitch, velocity, duration: 0.5 };
}

function getVelocity(e: MusicalEvent): number {
  if (e.kind === 'trigger') return e.velocity ?? 0.8;
  if (e.kind === 'note') return e.velocity;
  return 0;
}

// Standard 16th note grid for testing
const GRID_16 = Array.from({ length: 16 }, (_, i) => trigger(i, 0.8));

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe('dynamic shape registry', () => {
  it('has at least 8 built-in shapes', () => {
    expect(DYNAMIC_SHAPE_NAMES.length).toBeGreaterThanOrEqual(8);
  });

  it('getDynamicShapeList returns entries with name and description', () => {
    const list = getDynamicShapeList();
    expect(list.length).toBeGreaterThan(0);
    for (const entry of list) {
      expect(entry.name).toBeTruthy();
      expect(entry.description).toBeTruthy();
    }
  });

  it('has unique names', () => {
    const names = getDynamicShapeList().map(e => e.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ---------------------------------------------------------------------------
// Unknown shape returns events unchanged
// ---------------------------------------------------------------------------

describe('unknown shape', () => {
  it('returns events unchanged', () => {
    const events = [trigger(0), trigger(4)];
    const result = applyDynamicShape('nonexistent', events, 16);
    expect(result).toEqual(events);
  });
});

// ---------------------------------------------------------------------------
// Empty events
// ---------------------------------------------------------------------------

describe('empty events', () => {
  it.each(DYNAMIC_SHAPE_NAMES)('shape "%s" handles empty events', (name) => {
    const result = applyDynamicShape(name, [], 16);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Individual shapes
// ---------------------------------------------------------------------------

describe('accent_downbeats', () => {
  it('beat 1 is louder than upbeats', () => {
    const result = applyDynamicShape('accent_downbeats', GRID_16, 16);
    const beat1 = getVelocity(result[0]);
    const upbeat = getVelocity(result[1]); // step 1 is an upbeat
    expect(beat1).toBeGreaterThan(upbeat);
  });

  it('on-beats are louder than upbeats', () => {
    const result = applyDynamicShape('accent_downbeats', GRID_16, 16);
    const onBeat = getVelocity(result[4]); // beat 2
    const upbeat = getVelocity(result[1]); // 16th between beats
    expect(onBeat).toBeGreaterThan(upbeat);
  });
});

describe('accent_backbeat', () => {
  it('beats 2 and 4 are louder than beat 1', () => {
    const result = applyDynamicShape('accent_backbeat', GRID_16, 16);
    const beat1 = getVelocity(result[0]);
    const beat2 = getVelocity(result[4]);
    const beat4 = getVelocity(result[12]);
    expect(beat2).toBeGreaterThan(beat1);
    expect(beat4).toBeGreaterThan(beat1);
  });
});

describe('accent_offbeats', () => {
  it('upbeats are louder than on-beats', () => {
    const result = applyDynamicShape('accent_offbeats', GRID_16, 16);
    const onBeat = getVelocity(result[0]);
    const upbeat = getVelocity(result[1]);
    expect(upbeat).toBeGreaterThan(onBeat);
  });
});

describe('crescendo', () => {
  it('velocity increases across the pattern', () => {
    const result = applyDynamicShape('crescendo', GRID_16, 16);
    const firstVel = getVelocity(result[0]);
    const lastVel = getVelocity(result[result.length - 1]);
    expect(lastVel).toBeGreaterThan(firstVel);
  });

  it('velocity is monotonically non-decreasing', () => {
    const result = applyDynamicShape('crescendo', GRID_16, 16);
    for (let i = 1; i < result.length; i++) {
      expect(getVelocity(result[i])).toBeGreaterThanOrEqual(getVelocity(result[i - 1]) - 0.001);
    }
  });
});

describe('decrescendo', () => {
  it('velocity decreases across the pattern', () => {
    const result = applyDynamicShape('decrescendo', GRID_16, 16);
    const firstVel = getVelocity(result[0]);
    const lastVel = getVelocity(result[result.length - 1]);
    expect(firstVel).toBeGreaterThan(lastVel);
  });
});

describe('ghost_verse', () => {
  it('most events are soft', () => {
    const result = applyDynamicShape('ghost_verse', GRID_16, 16);
    const softCount = result.filter(e => getVelocity(e) < 0.5).length;
    expect(softCount).toBeGreaterThan(result.length / 2);
  });

  it('beat 1 is accented', () => {
    const result = applyDynamicShape('ghost_verse', GRID_16, 16);
    const beat1 = getVelocity(result[0]);
    const ghostStep = getVelocity(result[1]);
    expect(beat1).toBeGreaterThan(ghostStep);
  });
});

describe('swell', () => {
  it('peak velocity is in the middle', () => {
    const result = applyDynamicShape('swell', GRID_16, 16);
    const velocities = result.map(getVelocity);
    const maxIdx = velocities.indexOf(Math.max(...velocities));
    // Peak should be roughly in the middle (steps 6-10)
    expect(maxIdx).toBeGreaterThan(3);
    expect(maxIdx).toBeLessThan(13);
  });

  it('edges are softer than center', () => {
    const result = applyDynamicShape('swell', GRID_16, 16);
    const firstVel = getVelocity(result[0]);
    const middleVel = getVelocity(result[8]);
    expect(middleVel).toBeGreaterThan(firstVel);
  });
});

describe('push_pull', () => {
  it('alternates loud and soft', () => {
    const result = applyDynamicShape('push_pull', GRID_16, 16);
    for (let i = 0; i < result.length - 1; i += 2) {
      const loud = getVelocity(result[i]);
      const soft = getVelocity(result[i + 1]);
      expect(loud).toBeGreaterThan(soft);
    }
  });
});

// ---------------------------------------------------------------------------
// Velocity bounds
// ---------------------------------------------------------------------------

describe('velocity clamping', () => {
  it.each(DYNAMIC_SHAPE_NAMES)('shape "%s" keeps velocities in 0-1', (name) => {
    const events = [trigger(0, 1.0), trigger(4, 0.0), note(8, 60, 0.5)];
    const result = applyDynamicShape(name, events, 16);
    for (const e of result) {
      const vel = getVelocity(e);
      expect(vel).toBeGreaterThanOrEqual(0);
      expect(vel).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Works with note events
// ---------------------------------------------------------------------------

describe('note events', () => {
  it('applies velocity shaping to note events', () => {
    const events = [note(0, 60, 0.8), note(4, 64, 0.8), note(15, 67, 0.8)];
    const result = applyDynamicShape('crescendo', events, 16);
    expect(getVelocity(result[0])).toBeLessThan(getVelocity(result[2]));
  });
});

// ---------------------------------------------------------------------------
// Parameter events pass through unchanged
// ---------------------------------------------------------------------------

describe('parameter events', () => {
  it('parameter events are not modified by shapes', () => {
    const events: MusicalEvent[] = [
      { kind: 'parameter', at: 0, controlId: 'cutoff', value: 0.5 },
      { kind: 'parameter', at: 8, controlId: 'cutoff', value: 0.8 },
    ];
    const result = applyDynamicShape('crescendo', events, 16);
    expect(result).toEqual(events);
  });
});
