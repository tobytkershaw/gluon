import { describe, expect, it } from 'vitest';
import { PlaybackPlan, buildRuntimeEventId } from './playback-plan';
import type { TriggerEvent, ParameterEvent } from './canonical-types';

describe('PlaybackPlan', () => {
  it('admits an event only once per generation', () => {
    const plan = new PlaybackPlan();
    plan.reset(3);
    const event: TriggerEvent = { kind: 'trigger', at: 0, velocity: 0.8 };
    const eventId = buildRuntimeEventId(3, 'v1', 'r1', event, 0);

    expect(plan.admit(eventId, 0, 3)).toBe(true);
    expect(plan.admit(eventId, 0, 3)).toBe(false);
    expect(plan.has(eventId)).toBe(true);
  });

  it('resets admission when the generation changes', () => {
    const plan = new PlaybackPlan();
    plan.reset(1);
    const event: TriggerEvent = { kind: 'trigger', at: 0, velocity: 0.8 };
    const oldEventId = buildRuntimeEventId(1, 'v1', 'r1', event, 0);
    const newEventId = buildRuntimeEventId(2, 'v1', 'r1', event, 0);

    expect(plan.admit(oldEventId, 0, 1)).toBe(true);
    expect(plan.admit(newEventId, 0, 2)).toBe(true);
    expect(plan.has(oldEventId)).toBe(false);
    expect(plan.has(newEventId)).toBe(true);
  });

  it('distinguishes parameter events by control id at the same position', () => {
    const cutoff: ParameterEvent = { kind: 'parameter', at: 4, controlId: 'cutoff', value: 0.4 };
    const morph: ParameterEvent = { kind: 'parameter', at: 4, controlId: 'morph', value: 0.4 };

    expect(buildRuntimeEventId(1, 'v1', 'r1', cutoff, 0)).not.toEqual(
      buildRuntimeEventId(1, 'v1', 'r1', morph, 0),
    );
  });
});
