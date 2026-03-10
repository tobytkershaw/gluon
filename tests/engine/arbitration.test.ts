// tests/engine/arbitration.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Arbitrator } from '../../src/engine/arbitration';

describe('Arbitrator', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('blocks AI during active interaction', () => {
    const arb = new Arbitrator();
    arb.humanInteractionStart();
    expect(arb.canAIAct('timbre')).toBe(false);
    arb.humanInteractionEnd();
    vi.advanceTimersByTime(600);
    expect(arb.canAIAct('timbre')).toBe(true);
  });

  it('blocks AI for cooldown after param touch', () => {
    const arb = new Arbitrator(500);
    arb.humanTouched('v0', 'timbre', 0.8);
    expect(arb.canAIAct('timbre')).toBe(false);
    vi.advanceTimersByTime(600);
    expect(arb.canAIAct('timbre')).toBe(true);
  });

  it('getHeldParams returns values within cooldown for specific voice', () => {
    const arb = new Arbitrator(500);
    arb.humanTouched('v0', 'timbre', 0.8);
    arb.humanTouched('v0', 'morph', 0.3);
    const held = arb.getHeldParams('v0');
    expect(held.timbre).toBe(0.8);
    expect(held.morph).toBe(0.3);
    // Different voice should be empty
    expect(arb.getHeldParams('v1')).toEqual({});
  });

  it('getHeldParams excludes expired params', () => {
    const arb = new Arbitrator(500);
    arb.humanTouched('v0', 'timbre', 0.8);
    vi.advanceTimersByTime(600);
    const held = arb.getHeldParams('v0');
    expect(held.timbre).toBeUndefined();
  });

  it('getHeldParams returns empty when no interaction', () => {
    const arb = new Arbitrator();
    expect(arb.getHeldParams('v0')).toEqual({});
  });

  it('tracks params per voice independently', () => {
    const arb = new Arbitrator(500);
    arb.humanTouched('v0', 'timbre', 0.8);
    arb.humanTouched('v1', 'timbre', 0.2);
    expect(arb.getHeldParams('v0').timbre).toBe(0.8);
    expect(arb.getHeldParams('v1').timbre).toBe(0.2);
  });
});
