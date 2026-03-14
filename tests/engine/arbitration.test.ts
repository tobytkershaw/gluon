// tests/engine/arbitration.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Arbitrator } from '../../src/engine/arbitration';

describe('Arbitrator', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('blocks AI during active interaction', () => {
    const arb = new Arbitrator();
    arb.humanInteractionStart();
    expect(arb.canAIAct('v0', 'timbre')).toBe(false);
    arb.humanInteractionEnd();
    vi.advanceTimersByTime(600);
    expect(arb.canAIAct('v0', 'timbre')).toBe(true);
  });

  it('blocks AI for cooldown after param touch', () => {
    const arb = new Arbitrator(500);
    arb.humanTouched('v0', 'timbre', 0.8);
    expect(arb.canAIAct('v0', 'timbre')).toBe(false);
    vi.advanceTimersByTime(600);
    expect(arb.canAIAct('v0', 'timbre')).toBe(true);
  });

  it('does not block AI on a different voice for same param', () => {
    const arb = new Arbitrator(500);
    arb.humanTouched('v0', 'timbre', 0.8);
    expect(arb.canAIAct('v0', 'timbre')).toBe(false);
    expect(arb.canAIAct('v1', 'timbre')).toBe(true);
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

  describe('target-scoped arbitration', () => {
    it('source holds do not bleed into processor-scoped queries', () => {
      const arb = new Arbitrator(500);
      arb.humanTouched('v0', 'timbre', 0.8, 'source');
      // Source param is held
      expect(arb.getHeldSourceParams('v0').timbre).toBe(0.8);
      expect(arb.isHoldingSource('v0')).toBe(true);
      // But a processor-scoped touch is separate
      arb.humanTouched('v0', 'cutoff', 0.5, 'processor:fx1');
      // Source query should not include processor params
      expect(arb.getHeldSourceParams('v0')).toEqual({ timbre: 0.8 });
    });

    it('isHoldingSource returns false after cooldown expires', () => {
      const arb = new Arbitrator(500);
      arb.humanTouched('v0', 'timbre', 0.8, 'source');
      expect(arb.isHoldingSource('v0')).toBe(true);
      vi.advanceTimersByTime(600);
      expect(arb.isHoldingSource('v0')).toBe(false);
    });

    it('isHoldingSource returns true during active interaction', () => {
      const arb = new Arbitrator(500);
      arb.humanInteractionStart();
      expect(arb.isHoldingSource('v0')).toBe(true);
      arb.humanInteractionEnd();
      // No source touches, so after interaction ends it should be false
      expect(arb.isHoldingSource('v0')).toBe(false);
    });

    it('humanTouched defaults to source target', () => {
      const arb = new Arbitrator(500);
      arb.humanTouched('v0', 'timbre', 0.8);
      expect(arb.getHeldSourceParams('v0').timbre).toBe(0.8);
      expect(arb.isHoldingSource('v0')).toBe(true);
    });

    it('getHeldSourceParams is equivalent to legacy getHeldParams', () => {
      const arb = new Arbitrator(500);
      arb.humanTouched('v0', 'timbre', 0.8, 'source');
      arb.humanTouched('v0', 'morph', 0.3, 'source');
      expect(arb.getHeldParams('v0')).toEqual(arb.getHeldSourceParams('v0'));
    });
  });
});
