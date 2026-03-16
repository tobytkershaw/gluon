// tests/ui/automation-lane.test.ts
// Unit tests for AutomationLane breakpoint extraction and interpolation path logic.

import { describe, it, expect } from 'vitest';
import type { MusicalEvent, ParameterEvent, NoteEvent } from '../../src/engine/canonical-types';
import { interpolateParameterValue } from '../../src/engine/interpolation';

describe('AutomationLane breakpoint logic', () => {
  /** Filter parameter events for a given controlId (mirrors AutomationLane's extraction). */
  function extractBreakpoints(events: MusicalEvent[], controlId: string) {
    return events
      .filter((e): e is ParameterEvent => e.kind === 'parameter' && (e as ParameterEvent).controlId === controlId)
      .map(pe => ({
        at: pe.at,
        value: pe.value as number,
        interpolation: pe.interpolation ?? 'step',
        tension: pe.tension ?? 0,
      }));
  }

  it('extracts breakpoints for a single controlId', () => {
    const events: MusicalEvent[] = [
      { kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 1 },
      { kind: 'parameter', at: 0, controlId: 'timbre', value: 0.2, interpolation: 'linear' },
      { kind: 'parameter', at: 2, controlId: 'morph', value: 0.5 },
      { kind: 'parameter', at: 4, controlId: 'timbre', value: 0.8, interpolation: 'curve', tension: 0.3 },
    ];

    const bps = extractBreakpoints(events, 'timbre');
    expect(bps).toHaveLength(2);
    expect(bps[0]).toEqual({ at: 0, value: 0.2, interpolation: 'linear', tension: 0 });
    expect(bps[1]).toEqual({ at: 4, value: 0.8, interpolation: 'curve', tension: 0.3 });
  });

  it('ignores non-numeric parameter values', () => {
    const events: MusicalEvent[] = [
      { kind: 'parameter', at: 0, controlId: 'mode', value: 'saw' } as ParameterEvent,
      { kind: 'parameter', at: 2, controlId: 'timbre', value: 0.5 },
    ];

    const bps = extractBreakpoints(events, 'timbre');
    expect(bps).toHaveLength(1);
    expect(bps[0].value).toBe(0.5);
  });

  it('returns empty array when no matching events', () => {
    const events: MusicalEvent[] = [
      { kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 1 },
      { kind: 'parameter', at: 0, controlId: 'morph', value: 0.5 },
    ];

    const bps = extractBreakpoints(events, 'timbre');
    expect(bps).toHaveLength(0);
  });

  it('interpolates linear segment correctly', () => {
    const from: ParameterEvent = {
      kind: 'parameter', at: 0, controlId: 'timbre', value: 0.0, interpolation: 'linear',
    };
    const to: ParameterEvent = {
      kind: 'parameter', at: 4, controlId: 'timbre', value: 1.0,
    };

    expect(interpolateParameterValue(from, to, 0)).toBe(0.0);
    expect(interpolateParameterValue(from, to, 2)).toBeCloseTo(0.5);
    expect(interpolateParameterValue(from, to, 4)).toBeCloseTo(1.0);
  });

  it('step interpolation returns undefined for intermediate positions', () => {
    const from: ParameterEvent = {
      kind: 'parameter', at: 0, controlId: 'timbre', value: 0.0, interpolation: 'step',
    };
    const to: ParameterEvent = {
      kind: 'parameter', at: 4, controlId: 'timbre', value: 1.0,
    };

    expect(interpolateParameterValue(from, to, 2)).toBeUndefined();
  });

  it('curve interpolation respects tension', () => {
    const from: ParameterEvent = {
      kind: 'parameter', at: 0, controlId: 'timbre', value: 0.0, interpolation: 'curve', tension: 0.5,
    };
    const to: ParameterEvent = {
      kind: 'parameter', at: 4, controlId: 'timbre', value: 1.0,
    };

    const midVal = interpolateParameterValue(from, to, 2);
    expect(midVal).toBeDefined();
    // Positive tension = fast start/slow end, so midpoint should be > 0.5
    expect(midVal!).toBeGreaterThan(0.5);
  });
});
