import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Arbitrator } from '../../src/engine/arbitration';

describe('Arbitrator', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('allows AI action when human is not active', () => {
    const arb = new Arbitrator();
    expect(arb.canAIAct('timbre')).toBe(true);
  });

  it('blocks AI action on param human is actively touching', () => {
    const arb = new Arbitrator();
    arb.humanTouched('timbre');
    expect(arb.canAIAct('timbre')).toBe(false);
  });

  it('allows AI action on different param than human is touching', () => {
    const arb = new Arbitrator();
    arb.humanTouched('timbre');
    expect(arb.canAIAct('morph')).toBe(true);
  });

  it('allows AI action after cooldown expires', () => {
    const arb = new Arbitrator(500);
    arb.humanTouched('timbre');
    expect(arb.canAIAct('timbre')).toBe(false);
    vi.advanceTimersByTime(501);
    expect(arb.canAIAct('timbre')).toBe(true);
  });

  it('resets cooldown on repeated touch', () => {
    const arb = new Arbitrator(500);
    arb.humanTouched('timbre');
    vi.advanceTimersByTime(400);
    arb.humanTouched('timbre');
    vi.advanceTimersByTime(400);
    expect(arb.canAIAct('timbre')).toBe(false);
    vi.advanceTimersByTime(101);
    expect(arb.canAIAct('timbre')).toBe(true);
  });

  it('blocks all AI actions when human is in active interaction', () => {
    const arb = new Arbitrator();
    arb.humanInteractionStart();
    expect(arb.canAIAct('timbre')).toBe(false);
    expect(arb.canAIAct('morph')).toBe(false);
    arb.humanInteractionEnd();
    expect(arb.canAIAct('timbre')).toBe(true);
  });
});
