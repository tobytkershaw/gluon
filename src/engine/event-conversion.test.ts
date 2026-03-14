import { describe, it, expect } from 'vitest';
import { eventsToSteps, stepsToEvents } from './event-conversion';
import type { TriggerEvent, ParameterEvent, NoteEvent, MusicalEvent } from './canonical-types';

describe('eventsToSteps', () => {
  it('does not let a parameter event overwrite micro from a trigger event', () => {
    const trigger: TriggerEvent = {
      kind: 'trigger',
      at: 2.3, // micro = 0.3
      velocity: 0.8,
    };
    const param: ParameterEvent = {
      kind: 'parameter',
      at: 2.7, // fractional 0.7 — must NOT overwrite micro
      controlId: 'cutoff',
      value: 0.5,
    };

    const steps = eventsToSteps([trigger, param], 4);

    expect(steps[2].gate).toBe(true);
    expect(steps[2].micro).toBeCloseTo(0.3);
    expect(steps[2].params).toEqual({ cutoff: 0.5 });
  });

  it('does not let a parameter event set micro when no trigger is present', () => {
    const param: ParameterEvent = {
      kind: 'parameter',
      at: 1.5,
      controlId: 'resonance',
      value: 0.9,
    };

    const steps = eventsToSteps([param], 4);

    expect(steps[1].gate).toBe(false);
    expect(steps[1].micro).toBe(0);
    expect(steps[1].params).toEqual({ resonance: 0.9 });
  });

  it('sets micro from a note event', () => {
    const note: NoteEvent = {
      kind: 'note',
      at: 0.2,
      pitch: 60,
      velocity: 0.8,
      duration: 0.25,
    };

    const steps = eventsToSteps([note], 2, { midiToPitch: (m) => m / 127 });

    expect(steps[0].gate).toBe(true);
    expect(steps[0].micro).toBeCloseTo(0.2);
  });

  it('preserves trigger micro when parameter event appears before trigger', () => {
    const param: ParameterEvent = {
      kind: 'parameter',
      at: 3.9,
      controlId: 'decay',
      value: 0.4,
    };
    const trigger: TriggerEvent = {
      kind: 'trigger',
      at: 3.15,
      velocity: 0.8,
    };

    // Parameter processed first, then trigger
    const steps = eventsToSteps([param, trigger], 4);

    expect(steps[3].gate).toBe(true);
    expect(steps[3].micro).toBeCloseTo(0.15);
  });
});

describe('stepsToEvents', () => {
  it('round-trips a basic gated step', () => {
    const events = stepsToEvents([
      { gate: true, accent: false, micro: 0 },
      { gate: false, accent: false, micro: 0 },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('trigger');
    expect(events[0].at).toBe(0);
  });
});
