import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutomationEngine } from '../../src/ai/automation';

describe('Human ramp parity with AI drift', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('uses the same AutomationEngine.start() as AI drift', () => {
    // The human ramp feature reuses AutomationEngine — this test verifies
    // the same engine handles both AI drift and human ramps identically.
    const engine = new AutomationEngine();
    const values: number[] = [];

    // Simulate a human ramp: start=0.3, target=0.8, duration=2000ms
    engine.start('track1', 'timbre', 0.3, 0.8, 2000, (_param, value) => {
      values.push(value);
    });

    expect(engine.getActiveCount()).toBe(1);

    // At 50% through
    vi.advanceTimersByTime(1000);
    engine.tick(Date.now());
    expect(values[values.length - 1]).toBeCloseTo(0.55, 1);

    // At 100%
    vi.advanceTimersByTime(1000);
    engine.tick(Date.now());
    expect(values[values.length - 1]).toBeCloseTo(0.8, 1);
    expect(engine.getActiveCount()).toBe(0);
  });

  it('cancels ramp when user grabs the knob (arbitration)', () => {
    const engine = new AutomationEngine();
    const cb = vi.fn();

    // Start a ramp
    engine.start('track1', 'timbre', 0.0, 1.0, 2000, cb);
    expect(engine.getActiveCount()).toBe(1);

    // User grabs knob — handler calls cancel
    engine.cancel('track1', 'timbre');
    expect(engine.getActiveCount()).toBe(0);

    // No more callbacks after cancel
    vi.advanceTimersByTime(1000);
    engine.tick(Date.now());
    expect(cb).not.toHaveBeenCalled();
  });

  it('undo cancels active automation for affected param', () => {
    const engine = new AutomationEngine();
    const cb = vi.fn();

    // Start a ramp
    engine.start('track1', 'morph', 0.2, 0.9, 3000, cb);

    // Simulate what handleUndo does: cancel automation for the undone param
    engine.cancel('track1', 'morph');
    expect(engine.getActiveCount()).toBe(0);

    vi.advanceTimersByTime(1500);
    engine.tick(Date.now());
    expect(cb).not.toHaveBeenCalled();
  });
});
