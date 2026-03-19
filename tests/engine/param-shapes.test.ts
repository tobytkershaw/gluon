import { describe, it, expect } from 'vitest';
import {
  evaluateShape,
  expandParamShapes,
  validateParamShape,
  validateParamShapes,
} from '../../src/engine/param-shapes';
import type {
  ParamShape,
  RampUpShape,
  RampDownShape,
  TriangleShape,
  SineShape,
  SquareShape,
  RandomWalkShape,
  StepsShape,
  EnvelopeShape,
  ParamShapes,
} from '../../src/engine/param-shapes';

describe('evaluateShape', () => {
  describe('ramp_up', () => {
    const shape: RampUpShape = { shape: 'ramp_up', period: 16, range: [0.0, 1.0] };

    it('starts at min', () => {
      expect(evaluateShape(shape, 0)).toBeCloseTo(0.0);
    });

    it('ramps up linearly', () => {
      expect(evaluateShape(shape, 8)).toBeCloseTo(0.5);
    });

    it('wraps at period boundary', () => {
      expect(evaluateShape(shape, 16)).toBeCloseTo(0.0);
    });

    it('respects custom range', () => {
      const s: RampUpShape = { shape: 'ramp_up', period: 8, range: [0.2, 0.8] };
      expect(evaluateShape(s, 0)).toBeCloseTo(0.2);
      expect(evaluateShape(s, 4)).toBeCloseTo(0.5);
    });
  });

  describe('ramp_down', () => {
    const shape: RampDownShape = { shape: 'ramp_down', period: 16, range: [0.0, 1.0] };

    it('starts at max', () => {
      expect(evaluateShape(shape, 0)).toBeCloseTo(1.0);
    });

    it('ramps down linearly', () => {
      expect(evaluateShape(shape, 8)).toBeCloseTo(0.5);
    });

    it('wraps at period boundary', () => {
      expect(evaluateShape(shape, 16)).toBeCloseTo(1.0);
    });
  });

  describe('triangle', () => {
    const shape: TriangleShape = { shape: 'triangle', period: 16, range: [0.0, 1.0] };

    it('starts at min', () => {
      expect(evaluateShape(shape, 0)).toBeCloseTo(0.0);
    });

    it('peaks at midpoint', () => {
      expect(evaluateShape(shape, 8)).toBeCloseTo(1.0);
    });

    it('returns to min at period end', () => {
      expect(evaluateShape(shape, 16)).toBeCloseTo(0.0);
    });

    it('quarter point is midway', () => {
      expect(evaluateShape(shape, 4)).toBeCloseTo(0.5);
    });
  });

  describe('sine', () => {
    const shape: SineShape = { shape: 'sine', period: 16, range: [0.0, 1.0] };

    it('starts at midpoint (sin(0) = 0 maps to 0.5)', () => {
      expect(evaluateShape(shape, 0)).toBeCloseTo(0.5);
    });

    it('peaks at quarter period', () => {
      expect(evaluateShape(shape, 4)).toBeCloseTo(1.0);
    });

    it('returns to midpoint at half period', () => {
      expect(evaluateShape(shape, 8)).toBeCloseTo(0.5);
    });

    it('troughs at three-quarter period', () => {
      expect(evaluateShape(shape, 12)).toBeCloseTo(0.0);
    });

    it('respects phase offset', () => {
      const s: SineShape = { shape: 'sine', period: 16, range: [0.0, 1.0], phase: 0.25 };
      // phase 0.25 shifts by quarter period, so step 0 = peak
      expect(evaluateShape(s, 0)).toBeCloseTo(1.0);
    });
  });

  describe('square', () => {
    const shape: SquareShape = { shape: 'square', period: 8, range: [0.2, 0.8] };

    it('first half is high', () => {
      expect(evaluateShape(shape, 0)).toBeCloseTo(0.8);
      expect(evaluateShape(shape, 3)).toBeCloseTo(0.8);
    });

    it('second half is low', () => {
      expect(evaluateShape(shape, 4)).toBeCloseTo(0.2);
      expect(evaluateShape(shape, 7)).toBeCloseTo(0.2);
    });

    it('wraps at period', () => {
      expect(evaluateShape(shape, 8)).toBeCloseTo(0.8);
    });
  });

  describe('random_walk', () => {
    const shape: RandomWalkShape = { shape: 'random_walk', range: [0.0, 1.0], stepSize: 0.1 };

    it('stays within range', () => {
      for (let step = 0; step < 64; step++) {
        const v = evaluateShape(shape, step);
        expect(v).toBeGreaterThanOrEqual(0.0);
        expect(v).toBeLessThanOrEqual(1.0);
      }
    });

    it('is deterministic with the same seed', () => {
      const a = evaluateShape(shape, 10, 123);
      const b = evaluateShape(shape, 10, 123);
      expect(a).toBe(b);
    });

    it('produces different values with different seeds', () => {
      const a = evaluateShape(shape, 10, 1);
      const b = evaluateShape(shape, 10, 999);
      expect(a).not.toBe(b);
    });
  });

  describe('steps', () => {
    const shape: StepsShape = { shape: 'steps', values: [0.2, 0.5, 0.8], stepsPerValue: 4 };

    it('returns first value for first chunk', () => {
      expect(evaluateShape(shape, 0)).toBe(0.2);
      expect(evaluateShape(shape, 3)).toBe(0.2);
    });

    it('returns second value for second chunk', () => {
      expect(evaluateShape(shape, 4)).toBe(0.5);
      expect(evaluateShape(shape, 7)).toBe(0.5);
    });

    it('wraps around values array', () => {
      expect(evaluateShape(shape, 12)).toBe(0.2); // 12/4 = 3 % 3 = 0
    });
  });

  describe('envelope', () => {
    const shape: EnvelopeShape = {
      shape: 'envelope',
      attack: 4,
      hold: 4,
      release: 8,
      range: [0.0, 1.0],
    };

    it('starts at min', () => {
      expect(evaluateShape(shape, 0)).toBeCloseTo(0.0);
    });

    it('ramps up during attack', () => {
      expect(evaluateShape(shape, 2)).toBeCloseTo(0.5);
    });

    it('reaches max at end of attack', () => {
      expect(evaluateShape(shape, 4)).toBeCloseTo(1.0);
    });

    it('holds at max during hold phase', () => {
      expect(evaluateShape(shape, 6)).toBeCloseTo(1.0);
    });

    it('decays during release', () => {
      expect(evaluateShape(shape, 12)).toBeCloseTo(0.5);
    });

    it('wraps after full envelope cycle', () => {
      // total = 4 + 4 + 8 = 16, step 16 wraps to 0
      expect(evaluateShape(shape, 16)).toBeCloseTo(0.0);
    });
  });
});

describe('expandParamShapes', () => {
  it('generates one event per step per shape', () => {
    const shapes: ParamShapes = {
      cutoff: { shape: 'ramp_up', period: 16, range: [0.0, 1.0] },
    };
    const events = expandParamShapes(shapes, 16);
    expect(events).toHaveLength(16);
    expect(events.every(e => e.kind === 'parameter')).toBe(true);
    expect(events.every(e => e.controlId === 'cutoff')).toBe(true);
  });

  it('generates events for multiple shapes', () => {
    const shapes: ParamShapes = {
      cutoff: { shape: 'ramp_up', period: 16, range: [0.0, 1.0] },
      timbre: { shape: 'triangle', period: 8, range: [0.2, 0.8] },
    };
    const events = expandParamShapes(shapes, 16);
    expect(events).toHaveLength(32); // 16 steps * 2 shapes
    expect(events.filter(e => e.controlId === 'cutoff')).toHaveLength(16);
    expect(events.filter(e => e.controlId === 'timbre')).toHaveLength(16);
  });

  it('events are sorted by at position', () => {
    const shapes: ParamShapes = {
      cutoff: { shape: 'ramp_up', period: 16, range: [0.0, 1.0] },
      timbre: { shape: 'triangle', period: 8, range: [0.2, 0.8] },
    };
    const events = expandParamShapes(shapes, 16);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].at).toBeGreaterThanOrEqual(events[i - 1].at);
    }
  });

  it('values match evaluateShape output', () => {
    const shape: ParamShape = { shape: 'sine', period: 16, range: [0.3, 0.7] };
    const shapes: ParamShapes = { morph: shape };
    const events = expandParamShapes(shapes, 16);
    for (const e of events) {
      expect(e.value).toBeCloseTo(evaluateShape(shape, e.at));
    }
  });

  it('handles empty shapes', () => {
    const events = expandParamShapes({}, 16);
    expect(events).toHaveLength(0);
  });

  it('handles zero-length pattern', () => {
    const shapes: ParamShapes = {
      cutoff: { shape: 'ramp_up', period: 16, range: [0.0, 1.0] },
    };
    const events = expandParamShapes(shapes, 0);
    expect(events).toHaveLength(0);
  });
});

describe('validateParamShape', () => {
  it('accepts valid ramp_up', () => {
    expect(validateParamShape({ shape: 'ramp_up', period: 16, range: [0.0, 1.0] })).toBeNull();
  });

  it('accepts valid triangle', () => {
    expect(validateParamShape({ shape: 'triangle', period: 8, range: [0.2, 0.8] })).toBeNull();
  });

  it('accepts valid sine with phase', () => {
    expect(validateParamShape({ shape: 'sine', period: 16, range: [0.0, 1.0], phase: 0.25 })).toBeNull();
  });

  it('accepts valid square', () => {
    expect(validateParamShape({ shape: 'square', period: 4, range: [0.1, 0.9] })).toBeNull();
  });

  it('accepts valid random_walk', () => {
    expect(validateParamShape({ shape: 'random_walk', range: [0.0, 1.0], stepSize: 0.1 })).toBeNull();
  });

  it('accepts valid steps', () => {
    expect(validateParamShape({ shape: 'steps', values: [0.2, 0.5, 0.8], stepsPerValue: 4 })).toBeNull();
  });

  it('accepts valid envelope', () => {
    expect(validateParamShape({ shape: 'envelope', attack: 4, hold: 4, release: 8, range: [0.0, 1.0] })).toBeNull();
  });

  it('rejects non-object', () => {
    expect(validateParamShape(42)).not.toBeNull();
    expect(validateParamShape(null)).not.toBeNull();
    expect(validateParamShape('string')).not.toBeNull();
  });

  it('rejects unknown shape type', () => {
    expect(validateParamShape({ shape: 'wiggle', period: 16, range: [0.0, 1.0] })).toContain('Unknown shape');
  });

  it('rejects missing range', () => {
    expect(validateParamShape({ shape: 'ramp_up', period: 16 })).toContain('range');
  });

  it('rejects out-of-bounds range', () => {
    expect(validateParamShape({ shape: 'ramp_up', period: 16, range: [-0.1, 1.0] })).toContain('between 0.0');
    expect(validateParamShape({ shape: 'ramp_up', period: 16, range: [0.0, 1.5] })).toContain('between 0.0');
  });

  it('rejects missing period', () => {
    expect(validateParamShape({ shape: 'triangle', range: [0.0, 1.0] })).toContain('period');
  });

  it('rejects zero period', () => {
    expect(validateParamShape({ shape: 'triangle', period: 0, range: [0.0, 1.0] })).toContain('period');
  });

  it('rejects random_walk without stepSize', () => {
    expect(validateParamShape({ shape: 'random_walk', range: [0.0, 1.0] })).toContain('stepSize');
  });

  it('rejects steps without values', () => {
    expect(validateParamShape({ shape: 'steps', stepsPerValue: 4 })).toContain('values');
  });

  it('rejects steps with empty values', () => {
    expect(validateParamShape({ shape: 'steps', values: [], stepsPerValue: 4 })).toContain('values');
  });

  it('rejects steps without stepsPerValue', () => {
    expect(validateParamShape({ shape: 'steps', values: [0.5] })).toContain('stepsPerValue');
  });

  it('rejects envelope with zero total duration', () => {
    expect(validateParamShape({ shape: 'envelope', attack: 0, hold: 0, release: 0, range: [0.0, 1.0] })).toContain('duration');
  });

  it('rejects envelope with negative values', () => {
    expect(validateParamShape({ shape: 'envelope', attack: -1, hold: 4, release: 4, range: [0.0, 1.0] })).toContain('non-negative');
  });
});

describe('validateParamShapes', () => {
  it('accepts valid shapes record', () => {
    const shapes = {
      cutoff: { shape: 'triangle', period: 16, range: [0.2, 0.8] },
      timbre: { shape: 'sine', period: 8, range: [0.3, 0.7] },
    };
    expect(validateParamShapes(shapes)).toBeNull();
  });

  it('rejects non-object', () => {
    expect(validateParamShapes(null)).not.toBeNull();
    expect(validateParamShapes(42)).not.toBeNull();
  });

  it('reports which controlId is invalid', () => {
    const shapes = {
      cutoff: { shape: 'triangle', period: 16, range: [0.2, 0.8] },
      bad: { shape: 'unknown' },
    };
    const err = validateParamShapes(shapes);
    expect(err).toContain('paramShapes.bad');
  });

  it('accepts empty object', () => {
    expect(validateParamShapes({})).toBeNull();
  });
});
