import { describe, it, expect } from 'vitest';
import {
  validateRegion,
  validateEvent,
  normalizeRegionEvents,
  createDefaultRegion,
} from '../../src/engine/region-helpers';
import type {
  Region,
  MusicalEvent,
  TriggerEvent,
  NoteEvent,
  ParameterEvent,
} from '../../src/engine/canonical-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRegion(overrides: Partial<Region> = {}): Region {
  return {
    id: 'r1',
    kind: 'pattern',
    start: 0,
    duration: 16,
    loop: true,
    events: [],
    ...overrides,
  };
}

function trigger(at: number, extra: Partial<TriggerEvent> = {}): TriggerEvent {
  return { kind: 'trigger', at, ...extra };
}

function note(at: number, extra: Partial<NoteEvent> = {}): NoteEvent {
  return { kind: 'note', at, pitch: 60, velocity: 0.8, duration: 0.25, ...extra };
}

function param(at: number, controlId: string, value: number): ParameterEvent {
  return { kind: 'parameter', at, controlId, value };
}

// ---------------------------------------------------------------------------
// validateRegion
// ---------------------------------------------------------------------------

describe('validateRegion', () => {
  it('accepts a valid empty region', () => {
    const { valid, errors } = validateRegion(makeRegion());
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid region with events', () => {
    const region = makeRegion({
      events: [trigger(0), trigger(4), param(8, 'timbre', 0.5)],
    });
    const { valid } = validateRegion(region);
    expect(valid).toBe(true);
  });

  // Invariant 1: duration > 0
  it('rejects duration <= 0', () => {
    const { valid, errors } = validateRegion(makeRegion({ duration: 0 }));
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('duration'))).toBe(true);
  });

  it('rejects negative duration', () => {
    const { valid } = validateRegion(makeRegion({ duration: -1 }));
    expect(valid).toBe(false);
  });

  // Invariant 2: start >= 0
  it('rejects negative start', () => {
    const { valid, errors } = validateRegion(makeRegion({ start: -1 }));
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('start'))).toBe(true);
  });

  it('accepts start = 0', () => {
    const { valid } = validateRegion(makeRegion({ start: 0 }));
    expect(valid).toBe(true);
  });

  // Invariant 3: events in [0, duration)
  it('rejects event at >= duration', () => {
    const region = makeRegion({ duration: 8, events: [trigger(8)] });
    const { valid, errors } = validateRegion(region);
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('out of range'))).toBe(true);
  });

  it('rejects event at < 0', () => {
    const region = makeRegion({ events: [trigger(-1)] });
    const { valid } = validateRegion(region);
    expect(valid).toBe(false);
  });

  it('accepts event at boundary at=0', () => {
    const region = makeRegion({ events: [trigger(0)] });
    const { valid } = validateRegion(region);
    expect(valid).toBe(true);
  });

  it('accepts event just below duration', () => {
    const region = makeRegion({ duration: 8, events: [trigger(7.999)] });
    const { valid } = validateRegion(region);
    expect(valid).toBe(true);
  });

  // Invariant 4: sorted by at
  it('rejects unsorted events', () => {
    const region = makeRegion({ events: [trigger(4), trigger(2)] });
    const { valid, errors } = validateRegion(region);
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('not sorted'))).toBe(true);
  });

  // Invariant 5: trigger velocity 0-1
  it('rejects trigger velocity > 1', () => {
    const region = makeRegion({ events: [trigger(0, { velocity: 1.5 })] });
    const { valid } = validateRegion(region);
    expect(valid).toBe(false);
  });

  it('rejects trigger velocity < 0', () => {
    const region = makeRegion({ events: [trigger(0, { velocity: -0.1 })] });
    const { valid } = validateRegion(region);
    expect(valid).toBe(false);
  });

  it('accepts trigger without velocity', () => {
    const region = makeRegion({ events: [trigger(0)] });
    const { valid } = validateRegion(region);
    expect(valid).toBe(true);
  });

  // Invariant 6: note constraints
  it('rejects note pitch out of range', () => {
    const region = makeRegion({ events: [note(0, { pitch: 128 })] });
    const { valid } = validateRegion(region);
    expect(valid).toBe(false);
  });

  it('rejects note velocity out of range', () => {
    const region = makeRegion({ events: [note(0, { velocity: -0.1 })] });
    const { valid } = validateRegion(region);
    expect(valid).toBe(false);
  });

  it('rejects note duration <= 0', () => {
    const region = makeRegion({ events: [note(0, { duration: 0 })] });
    const { valid } = validateRegion(region);
    expect(valid).toBe(false);
  });

  // Invariant 7: parameter controlId non-empty
  it('rejects parameter with empty controlId', () => {
    const region = makeRegion({ events: [param(0, '', 0.5)] });
    const { valid } = validateRegion(region);
    expect(valid).toBe(false);
  });

  // Invariant 8: no duplicate triggers
  it('rejects duplicate triggers at same position', () => {
    const region = makeRegion({ events: [trigger(4), trigger(4.0005)] });
    const { valid, errors } = validateRegion(region);
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('Duplicate TriggerEvents'))).toBe(true);
  });

  // Invariant 9: no duplicate parameter events for same controlId
  it('rejects duplicate parameter events for same controlId at same position', () => {
    const region = makeRegion({
      events: [param(2, 'timbre', 0.3), param(2, 'timbre', 0.7)],
    });
    const { valid, errors } = validateRegion(region);
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('Duplicate ParameterEvents'))).toBe(true);
  });

  it('accepts different controlIds at same position', () => {
    const region = makeRegion({
      events: [param(2, 'timbre', 0.3), param(2, 'decay', 0.7)],
    });
    const { valid } = validateRegion(region);
    expect(valid).toBe(true);
  });

  // Invariant 10: no simultaneous notes (monophonic)
  it('rejects simultaneous notes', () => {
    const region = makeRegion({ events: [note(4), note(4, { pitch: 72 })] });
    const { valid, errors } = validateRegion(region);
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('monophonic'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateEvent
// ---------------------------------------------------------------------------

describe('validateEvent', () => {
  const region = makeRegion({ duration: 8 });

  it('returns null for a valid trigger', () => {
    expect(validateEvent(trigger(0), region)).toBeNull();
  });

  it('returns error for event outside region', () => {
    const err = validateEvent(trigger(8), region);
    expect(err).not.toBeNull();
    expect(err).toContain('out of range');
  });

  it('returns error for note with negative pitch', () => {
    const err = validateEvent(note(0, { pitch: -1 }), region);
    expect(err).toContain('pitch');
  });

  it('returns error for parameter with empty controlId', () => {
    const err = validateEvent(param(0, '', 0.5), region);
    expect(err).toContain('controlId');
  });
});

// ---------------------------------------------------------------------------
// normalizeRegionEvents
// ---------------------------------------------------------------------------

describe('normalizeRegionEvents', () => {
  it('sorts events by at', () => {
    const region = makeRegion({ events: [trigger(4), trigger(1), trigger(2)] });
    const result = normalizeRegionEvents(region);
    expect(result.events.map(e => e.at)).toEqual([1, 2, 4]);
  });

  it('deduplicates triggers at same position (last wins)', () => {
    const region = makeRegion({
      events: [
        { kind: 'trigger', at: 4, velocity: 0.5 } as TriggerEvent,
        { kind: 'trigger', at: 4, velocity: 1.0 } as TriggerEvent,
      ],
    });
    const result = normalizeRegionEvents(region);
    expect(result.events).toHaveLength(1);
    expect((result.events[0] as TriggerEvent).velocity).toBe(1.0);
  });

  it('deduplicates parameter events for same controlId at same position', () => {
    const region = makeRegion({
      events: [param(2, 'timbre', 0.3), param(2, 'timbre', 0.9)],
    });
    const result = normalizeRegionEvents(region);
    expect(result.events).toHaveLength(1);
    expect((result.events[0] as ParameterEvent).value).toBe(0.9);
  });

  it('keeps parameter events with different controlIds at same position', () => {
    const region = makeRegion({
      events: [param(2, 'timbre', 0.3), param(2, 'decay', 0.7)],
    });
    const result = normalizeRegionEvents(region);
    expect(result.events).toHaveLength(2);
  });

  it('deduplicates simultaneous notes (last wins)', () => {
    const region = makeRegion({
      events: [note(4, { pitch: 60 }), note(4, { pitch: 72 })],
    });
    const result = normalizeRegionEvents(region);
    expect(result.events).toHaveLength(1);
    expect((result.events[0] as NoteEvent).pitch).toBe(72);
  });

  it('does not mutate the original region', () => {
    const events: MusicalEvent[] = [trigger(4), trigger(1)];
    const region = makeRegion({ events });
    normalizeRegionEvents(region);
    expect(region.events[0].at).toBe(4); // unchanged
  });

  it('handles empty events array', () => {
    const region = makeRegion({ events: [] });
    const result = normalizeRegionEvents(region);
    expect(result.events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// createDefaultRegion
// ---------------------------------------------------------------------------

describe('createDefaultRegion', () => {
  it('produces a valid region', () => {
    const region = createDefaultRegion('track-1', 16);
    const { valid } = validateRegion(region);
    expect(valid).toBe(true);
  });

  it('has correct duration and empty events', () => {
    const region = createDefaultRegion('kick', 8);
    expect(region.duration).toBe(8);
    expect(region.events).toHaveLength(0);
    expect(region.start).toBe(0);
    expect(region.loop).toBe(true);
    expect(region.kind).toBe('pattern');
  });

  it('includes trackId in the region id', () => {
    const region = createDefaultRegion('snare', 16);
    expect(region.id).toContain('snare');
  });
});
