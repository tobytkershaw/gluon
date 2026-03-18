import { describe, it, expect } from 'vitest';
import {
  applyGroove,
  GROOVE_TEMPLATES,
  GROOVE_TEMPLATE_NAMES,
} from '../../src/engine/groove-templates';
import type { GrooveTemplate, InstrumentHint } from '../../src/engine/groove-templates';
import { humanize } from '../../src/engine/musical-helpers';
import type {
  MusicalEvent,
  NoteEvent,
  TriggerEvent,
  ParameterEvent,
} from '../../src/engine/canonical-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trigger(at: number, extra: Partial<TriggerEvent> = {}): TriggerEvent {
  return { kind: 'trigger', at, velocity: 0.8, ...extra };
}

function note(at: number, extra: Partial<NoteEvent> = {}): NoteEvent {
  return { kind: 'note', at, pitch: 60, velocity: 0.8, duration: 0.25, ...extra };
}

function param(at: number, controlId: string, value: number): ParameterEvent {
  return { kind: 'parameter', at, controlId, value };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe('groove template registry', () => {
  it('has at least 7 built-in templates', () => {
    expect(GROOVE_TEMPLATE_NAMES.length).toBeGreaterThanOrEqual(7);
  });

  it('includes expected template names', () => {
    const expected = ['straight', 'mpc_swing', '808_shuffle', 'garage', 'techno_drive', 'laid_back', 'dnb_break'];
    for (const name of expected) {
      expect(GROOVE_TEMPLATES[name]).toBeDefined();
    }
  });

  it('all templates have stepsPerBar=16 and matching timing array lengths', () => {
    for (const [name, tmpl] of Object.entries(GROOVE_TEMPLATES)) {
      expect(tmpl.stepsPerBar).toBe(16);
      expect(tmpl.timing.default.length).toBe(16);
      for (const lane of Object.values(tmpl.timing)) {
        expect(lane.length).toBe(16);
      }
      if (tmpl.velocity) {
        for (const lane of Object.values(tmpl.velocity)) {
          if (lane) expect(lane.length).toBe(16);
        }
      }
    }
  });

  it('straight template has all zero offsets', () => {
    const tmpl = GROOVE_TEMPLATES['straight'];
    expect(tmpl.timing.default.every(v => v === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyGroove — timing
// ---------------------------------------------------------------------------

describe('applyGroove — timing', () => {
  const events: MusicalEvent[] = [trigger(0), trigger(4), trigger(8), trigger(12)];

  it('straight template does not change event positions', () => {
    const result = applyGroove(events, GROOVE_TEMPLATES['straight'], 1.0);
    expect(result.map(e => e.at)).toEqual([0, 4, 8, 12]);
  });

  it('applies timing offsets from template', () => {
    const tmpl = GROOVE_TEMPLATES['mpc_swing'];
    const result = applyGroove(events, tmpl, 1.0);
    // Events should be shifted by the template's default timing lane values at those steps
    for (let i = 0; i < events.length; i++) {
      const step = events[i].at;
      const expectedOffset = tmpl.timing.default[step];
      // Result event at should be original + offset (since amount=1.0)
      const resultEvent = result.find(e => Math.abs(e.at - (step + expectedOffset)) < 0.001);
      expect(resultEvent).toBeDefined();
    }
  });

  it('amount=0 returns events unchanged', () => {
    const result = applyGroove(events, GROOVE_TEMPLATES['mpc_swing'], 0);
    expect(result.map(e => e.at)).toEqual([0, 4, 8, 12]);
  });

  it('amount scales timing offset linearly', () => {
    const tmpl = GROOVE_TEMPLATES['laid_back'];
    const halfResult = applyGroove([trigger(0)], tmpl, 0.5);
    const fullResult = applyGroove([trigger(0)], tmpl, 1.0);
    const halfOffset = halfResult[0].at;
    const fullOffset = fullResult[0].at;
    // Half amount should be approximately half the offset of full amount
    expect(halfOffset).toBeCloseTo(fullOffset / 2, 3);
  });

  it('amount is clamped to 1.0', () => {
    const tmpl = GROOVE_TEMPLATES['laid_back'];
    const result1 = applyGroove([trigger(0)], tmpl, 1.0);
    const result2 = applyGroove([trigger(0)], tmpl, 2.0);
    expect(result1[0].at).toBeCloseTo(result2[0].at, 6);
  });

  it('wraps within duration for positive offsets', () => {
    // Place an event near the end of a 16-step pattern with a positive offset
    const tmpl = GROOVE_TEMPLATES['laid_back'];
    const nearEnd = [trigger(15)];
    const result = applyGroove(nearEnd, tmpl, 1.0, undefined, 16);
    expect(result[0].at).toBeGreaterThanOrEqual(0);
    expect(result[0].at).toBeLessThan(16);
  });

  it('wraps within duration for negative offsets', () => {
    // Place an event at position 0 with a negative offset template
    const tmpl = GROOVE_TEMPLATES['techno_drive'];
    const atStart = [trigger(0)];
    const result = applyGroove(atStart, tmpl, 1.0, undefined, 16);
    // Should wrap to end of pattern
    expect(result[0].at).toBeGreaterThanOrEqual(0);
    expect(result[0].at).toBeLessThan(16);
  });

  it('clamps to 0 when no duration provided and offset is negative', () => {
    const tmpl = GROOVE_TEMPLATES['techno_drive'];
    const atStart = [trigger(0)];
    const result = applyGroove(atStart, tmpl, 1.0);
    expect(result[0].at).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// applyGroove — instrument hint
// ---------------------------------------------------------------------------

describe('applyGroove — instrument hint', () => {
  it('uses instrument-specific lane when hint is provided', () => {
    const tmpl = GROOVE_TEMPLATES['mpc_swing'];
    const events = [trigger(1)]; // step 1 has different offsets per lane
    const hatResult = applyGroove(events, tmpl, 1.0, 'hat');
    const kickResult = applyGroove(events, tmpl, 1.0, 'kick');
    const defaultResult = applyGroove(events, tmpl, 1.0);
    // Hat and kick lanes have different offsets at step 1
    expect(hatResult[0].at).not.toBeCloseTo(kickResult[0].at, 3);
    // Default should use the default lane
    expect(defaultResult[0].at).toBeCloseTo(1 + tmpl.timing.default[1], 6);
  });

  it('falls back to default lane when instrument lane is missing', () => {
    const tmpl = GROOVE_TEMPLATES['straight']; // only has default lane
    const events = [trigger(1)];
    const result = applyGroove(events, tmpl, 1.0, 'kick');
    expect(result[0].at).toBe(1); // straight has zero offsets
  });
});

// ---------------------------------------------------------------------------
// applyGroove — velocity
// ---------------------------------------------------------------------------

describe('applyGroove — velocity', () => {
  it('applies velocity scaling from template', () => {
    const tmpl = GROOVE_TEMPLATES['mpc_swing'];
    // Step 1 has hat velocity of 0.75
    const events: MusicalEvent[] = [trigger(1, { velocity: 0.8 })];
    const result = applyGroove(events, tmpl, 1.0, 'hat');
    const resultVel = (result[0] as TriggerEvent).velocity;
    // At amount=1.0, velocity should be scaled: 0.8 * (1 + (0.75 - 1) * 1.0) = 0.8 * 0.75 = 0.6
    expect(resultVel).toBeCloseTo(0.6, 2);
  });

  it('velocity scaling respects amount', () => {
    const tmpl = GROOVE_TEMPLATES['mpc_swing'];
    const events: MusicalEvent[] = [trigger(1, { velocity: 0.8 })];
    const halfResult = applyGroove(events, tmpl, 0.5, 'hat');
    const fullResult = applyGroove(events, tmpl, 1.0, 'hat');
    const halfVel = (halfResult[0] as TriggerEvent).velocity!;
    const fullVel = (fullResult[0] as TriggerEvent).velocity!;
    // Half amount should produce less velocity change
    expect(Math.abs(halfVel - 0.8)).toBeLessThan(Math.abs(fullVel - 0.8));
  });

  it('velocity stays clamped to [0, 1]', () => {
    const tmpl = GROOVE_TEMPLATES['techno_drive'];
    // Kick at step 0 has velocity scale 1.05 — with high input could exceed 1.0
    const events: MusicalEvent[] = [trigger(0, { velocity: 1.0 })];
    const result = applyGroove(events, tmpl, 1.0, 'kick');
    const resultVel = (result[0] as TriggerEvent).velocity!;
    expect(resultVel).toBeLessThanOrEqual(1.0);
    expect(resultVel).toBeGreaterThanOrEqual(0);
  });

  it('does not modify velocity when template has no velocity lane', () => {
    const tmpl = GROOVE_TEMPLATES['straight'];
    const events: MusicalEvent[] = [trigger(0, { velocity: 0.8 })];
    const result = applyGroove(events, tmpl, 1.0);
    expect((result[0] as TriggerEvent).velocity).toBe(0.8);
  });
});

// ---------------------------------------------------------------------------
// applyGroove — event types
// ---------------------------------------------------------------------------

describe('applyGroove — event types', () => {
  it('passes parameter events through unchanged', () => {
    const events: MusicalEvent[] = [param(4, 'timbre', 0.5)];
    const result = applyGroove(events, GROOVE_TEMPLATES['mpc_swing'], 1.0);
    expect(result[0]).toEqual(param(4, 'timbre', 0.5));
  });

  it('works with note events', () => {
    const events: MusicalEvent[] = [note(1, { velocity: 0.7 })];
    const tmpl = GROOVE_TEMPLATES['mpc_swing'];
    const result = applyGroove(events, tmpl, 1.0);
    expect(result[0].at).toBeCloseTo(1 + tmpl.timing.default[1], 6);
  });

  it('does not mutate input events', () => {
    const events: MusicalEvent[] = [trigger(0), trigger(4)];
    const copy = events.map(e => ({ ...e }));
    applyGroove(events, GROOVE_TEMPLATES['mpc_swing'], 1.0);
    expect(events).toEqual(copy);
  });

  it('returns events sorted by at', () => {
    // Create events where groove might reorder them
    const events: MusicalEvent[] = [trigger(0), trigger(1)];
    const result = applyGroove(events, GROOVE_TEMPLATES['techno_drive'], 1.0, 'kick');
    for (let i = 1; i < result.length; i++) {
      expect(result[i].at).toBeGreaterThanOrEqual(result[i - 1].at);
    }
  });
});

// ---------------------------------------------------------------------------
// applyGroove — multi-bar patterns
// ---------------------------------------------------------------------------

describe('applyGroove — multi-bar patterns', () => {
  it('wraps template for events beyond one bar', () => {
    // Event at step 17 should use template index 1 (17 % 16 = 1)
    const tmpl = GROOVE_TEMPLATES['mpc_swing'];
    const events: MusicalEvent[] = [trigger(17)];
    const result = applyGroove(events, tmpl, 1.0, undefined, 32);
    const expectedOffset = tmpl.timing.default[1]; // step 17 % 16 = 1
    expect(result[0].at).toBeCloseTo(17 + expectedOffset, 6);
  });
});

// ---------------------------------------------------------------------------
// Interaction with humanize
// ---------------------------------------------------------------------------

describe('groove + humanize interaction', () => {
  it('groove and humanize compose (groove first, then humanize adds jitter)', () => {
    // This is a design intent test — groove should shift systematically,
    // humanize should add randomness on top. We verify that applying both
    // produces different results than applying either alone.
    const events: MusicalEvent[] = [trigger(0), trigger(4), trigger(8), trigger(12)];
    const duration = 16;

    const grooved = applyGroove(events, GROOVE_TEMPLATES['mpc_swing'], 0.7, undefined, duration);
    const humanized = humanize(events, duration, { velocityAmount: 0.3, timingAmount: 0.3, seed: 42 });
    const both = humanize(
      applyGroove(events, GROOVE_TEMPLATES['mpc_swing'], 0.7, undefined, duration),
      duration,
      { velocityAmount: 0.3, timingAmount: 0.3, seed: 42 },
    );

    // Both combined should differ from either alone
    const groovedPositions = grooved.map(e => e.at);
    const bothPositions = both.map(e => e.at);
    const humanizedPositions = humanized.map(e => e.at);

    // At least one position should differ between grooved-only and grooved+humanized
    const hasDiff = groovedPositions.some((pos, i) => Math.abs(pos - bothPositions[i]) > 0.001);
    expect(hasDiff).toBe(true);
  });
});
