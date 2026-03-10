import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutomationEngine } from '../../src/ai/automation';

describe('AutomationEngine', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('starts with no active automations', () => {
    const engine = new AutomationEngine();
    expect(engine.getActiveCount()).toBe(0);
  });

  it('interpolates a value over time', () => {
    const engine = new AutomationEngine();
    const values: number[] = [];
    engine.start('timbre', 0.0, 1.0, 1000, (param, value) => {
      values.push(value);
    });
    expect(engine.getActiveCount()).toBe(1);
    vi.advanceTimersByTime(500);
    engine.tick(Date.now());
    expect(values.length).toBe(1);
    expect(values[0]).toBeCloseTo(0.5, 1);
    vi.advanceTimersByTime(500);
    engine.tick(Date.now());
    expect(values[values.length - 1]).toBeCloseTo(1.0, 1);
    expect(engine.getActiveCount()).toBe(0);
  });

  it('cancels an automation', () => {
    const engine = new AutomationEngine();
    const cb = vi.fn();
    engine.start('timbre', 0.0, 1.0, 1000, cb);
    engine.cancel('timbre');
    expect(engine.getActiveCount()).toBe(0);
    vi.advanceTimersByTime(500);
    engine.tick(Date.now());
    expect(cb).not.toHaveBeenCalled();
  });

  it('replaces existing automation on same param', () => {
    const engine = new AutomationEngine();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    engine.start('timbre', 0.0, 1.0, 1000, cb1);
    engine.start('timbre', 0.5, 0.8, 500, cb2);
    expect(engine.getActiveCount()).toBe(1);
    vi.advanceTimersByTime(250);
    engine.tick(Date.now());
    expect(cb2).toHaveBeenCalled();
    expect(cb1).toHaveBeenCalledTimes(0);
  });
});
