import { describe, expect, it } from 'vitest';
import { PlaybackPlan, buildRuntimeEventId } from './playback-plan';
import type { TriggerEvent, NoteEvent, ParameterEvent } from './canonical-types';

describe('PlaybackPlan', () => {
  it('admits an event only once per generation', () => {
    const plan = new PlaybackPlan();
    plan.reset(3);
    const event: TriggerEvent = { kind: 'trigger', at: 0, velocity: 0.8 };
    const eventId = buildRuntimeEventId(3, 'v1', 'r1', event, 0);

    expect(plan.admit(eventId, 0, 3, 'v1')).toBe(true);
    expect(plan.admit(eventId, 0, 3, 'v1')).toBe(false);
    expect(plan.has(eventId)).toBe(true);
  });

  it('resets admission when the generation changes', () => {
    const plan = new PlaybackPlan();
    plan.reset(1);
    const event: TriggerEvent = { kind: 'trigger', at: 0, velocity: 0.8 };
    const oldEventId = buildRuntimeEventId(1, 'v1', 'r1', event, 0);
    const newEventId = buildRuntimeEventId(2, 'v1', 'r1', event, 0);

    expect(plan.admit(oldEventId, 0, 1, 'v1')).toBe(true);
    expect(plan.admit(newEventId, 0, 2, 'v1')).toBe(true);
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

  it('distinguishes note events by pitch at the same step (chords)', () => {
    const plan = new PlaybackPlan();
    plan.reset(1);
    const noteC: NoteEvent = { kind: 'note', at: 4, pitch: 60, velocity: 0.8, duration: 1 };
    const noteE: NoteEvent = { kind: 'note', at: 4, pitch: 64, velocity: 0.8, duration: 1 };

    const idC = buildRuntimeEventId(1, 'v1', 'r1', noteC, 0);
    const idE = buildRuntimeEventId(1, 'v1', 'r1', noteE, 0);

    // IDs must be distinct so both notes are admitted
    expect(idC).not.toEqual(idE);

    expect(plan.admit(idC, 4, 1, 'v1')).toBe(true);
    expect(plan.admit(idE, 4, 1, 'v1')).toBe(true);
  });

  it('invalidates planned events for a track from a minimum step', () => {
    const plan = new PlaybackPlan();
    plan.reset(5);
    const early: TriggerEvent = { kind: 'trigger', at: 2, velocity: 0.8 };
    const late: TriggerEvent = { kind: 'trigger', at: 12, velocity: 0.8 };
    const earlyId = buildRuntimeEventId(5, 'v1', 'r1', early, 0);
    const lateId = buildRuntimeEventId(5, 'v1', 'r1', late, 0);

    expect(plan.admit(earlyId, 2, 5, 'v1')).toBe(true);
    expect(plan.admit(lateId, 12, 5, 'v1')).toBe(true);

    plan.invalidateTrack('v1', 5, 8);

    expect(plan.has(earlyId)).toBe(true);
    expect(plan.has(lateId)).toBe(false);
  });
});
