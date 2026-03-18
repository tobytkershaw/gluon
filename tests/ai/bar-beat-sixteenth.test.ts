// tests/ai/bar-beat-sixteenth.test.ts — Tests for bar.beat.sixteenth position parsing
// and integration with executeFunctionCall for sketch and edit_pattern tools.

import { describe, it, expect, vi } from 'vitest';
import { parsePosition, resolveSketchPositions, resolveEditPatternPositions } from '../../src/ai/bar-beat-sixteenth';
import { GluonAI } from '../../src/ai/api';
import { createSession, addTrack } from '../../src/engine/session';
import type { PlannerProvider, ListenerProvider, GenerateResult, FunctionResponse, ToolSchema } from '../../src/ai/types';

// ---------------------------------------------------------------------------
// Unit tests for parsePosition
// ---------------------------------------------------------------------------

describe('parsePosition', () => {
  it('passes through numeric values unchanged', () => {
    expect(parsePosition(0)).toBe(0);
    expect(parsePosition(4)).toBe(4);
    expect(parsePosition(36)).toBe(36);
    expect(parsePosition(4.1)).toBe(4.1); // microtiming
  });

  it('parses 1.1.1 as step 0', () => {
    expect(parsePosition('1.1.1')).toBe(0);
  });

  it('parses 3.2.1 as step 36', () => {
    // (3-1)*16 + (2-1)*4 + (1-1) = 32 + 4 + 0 = 36
    expect(parsePosition('3.2.1')).toBe(36);
  });

  it('parses 2.1.3 as step 18', () => {
    // (2-1)*16 + (1-1)*4 + (3-1) = 16 + 0 + 2 = 18
    expect(parsePosition('2.1.3')).toBe(18);
  });

  it('parses 1.3.1 as step 8 (beat 3)', () => {
    // (1-1)*16 + (3-1)*4 + (1-1) = 0 + 8 + 0 = 8
    expect(parsePosition('1.3.1')).toBe(8);
  });

  it('parses 1.1.4 as step 3', () => {
    // (1-1)*16 + (1-1)*4 + (4-1) = 0 + 0 + 3 = 3
    expect(parsePosition('1.1.4')).toBe(3);
  });

  it('parses 4.4.4 as step 63', () => {
    // (4-1)*16 + (4-1)*4 + (4-1) = 48 + 12 + 3 = 63
    expect(parsePosition('4.4.4')).toBe(63);
  });

  it('handles bars > 4 for longer patterns', () => {
    // 5.1.1 = (5-1)*16 = 64
    expect(parsePosition('5.1.1')).toBe(64);
  });

  it('throws on invalid format — too few parts', () => {
    expect(() => parsePosition('1.1')).toThrow('expected "bar.beat.sixteenth"');
  });

  it('throws on invalid format — too many parts', () => {
    expect(() => parsePosition('1.1.1.1')).toThrow('expected "bar.beat.sixteenth"');
  });

  it('throws on bar = 0', () => {
    expect(() => parsePosition('0.1.1')).toThrow('Invalid bar');
  });

  it('throws on negative bar', () => {
    expect(() => parsePosition('-1.1.1')).toThrow('Invalid bar');
  });

  it('throws on beat = 0', () => {
    expect(() => parsePosition('1.0.1')).toThrow('Invalid beat');
  });

  it('throws on beat > 4', () => {
    expect(() => parsePosition('1.5.1')).toThrow('Invalid beat');
  });

  it('throws on sixteenth = 0', () => {
    expect(() => parsePosition('1.1.0')).toThrow('Invalid sixteenth');
  });

  it('throws on sixteenth > 4', () => {
    expect(() => parsePosition('1.1.5')).toThrow('Invalid sixteenth');
  });

  it('throws on non-integer bar', () => {
    expect(() => parsePosition('1.5.1.1')).toThrow();
  });

  it('throws on non-numeric parts', () => {
    expect(() => parsePosition('a.b.c')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Unit tests for batch resolvers
// ---------------------------------------------------------------------------

describe('resolveSketchPositions', () => {
  it('resolves mixed numeric and string positions', () => {
    const events = [
      { kind: 'trigger', at: 0 as number | string, velocity: 1.0 },
      { kind: 'trigger', at: '1.3.1' as number | string, velocity: 0.8 },
      { kind: 'trigger', at: '2.1.1' as number | string, velocity: 1.0 },
      { kind: 'trigger', at: 12 as number | string, velocity: 0.5 },
    ];
    const resolved = resolveSketchPositions(events);
    expect(resolved.map(e => e.at)).toEqual([0, 8, 16, 12]);
  });

  it('throws on any invalid position in the array', () => {
    const events = [
      { kind: 'trigger', at: '1.1.1' as number | string },
      { kind: 'trigger', at: '1.5.1' as number | string }, // beat 5 invalid
    ];
    expect(() => resolveSketchPositions(events)).toThrow('Invalid beat');
  });
});

describe('resolveEditPatternPositions', () => {
  it('resolves string step positions to numbers', () => {
    const ops = [
      { action: 'add' as const, step: '2.3.1' as number | string },
      { action: 'remove' as const, step: 4 as number | string },
    ];
    const resolved = resolveEditPatternPositions(ops);
    // (2-1)*16 + (3-1)*4 + (1-1) = 16 + 8 + 0 = 24
    expect(resolved[0].step).toBe(24);
    expect(resolved[1].step).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Integration tests — executeFunctionCall via GluonAI
// ---------------------------------------------------------------------------

function createMockPlanner(): PlannerProvider & {
  startTurnResults: GenerateResult[];
  continueTurnResults: GenerateResult[];
  lastFunctionResponses: FunctionResponse[];
} {
  const planner = {
    name: 'mock',
    startTurnResults: [] as GenerateResult[],
    continueTurnResults: [] as GenerateResult[],
    lastFunctionResponses: [] as FunctionResponse[],
    isConfigured: () => true,
    startTurn: vi.fn(async (): Promise<GenerateResult> => {
      return planner.startTurnResults.shift() ?? { textParts: [], functionCalls: [] };
    }),
    continueTurn: vi.fn(async (opts: { functionResponses: FunctionResponse[] }): Promise<GenerateResult> => {
      planner.lastFunctionResponses = opts.functionResponses;
      return planner.continueTurnResults.shift() ?? { textParts: [], functionCalls: [] };
    }),
    commitTurn: vi.fn(() => {}),
    discardTurn: vi.fn(() => {}),
    trimHistory: vi.fn((_n: number) => {}),
    clearHistory: vi.fn(() => {}),
  };
  return planner;
}

function createMockListener(): ListenerProvider {
  return {
    name: 'mock',
    isConfigured: () => true,
    evaluate: vi.fn(async () => 'sounds good'),
  };
}

function sessionWithTrack() {
  let session = createSession();
  session = addTrack(session, 'audio');
  const track = session.tracks.find(t => t.id !== 'master-bus')!;
  track.agency = 'ON';
  return { session, trackId: track.id };
}

describe('executeFunctionCall integration — bar.beat.sixteenth', () => {
  it('sketch tool accepts bar.beat.sixteenth strings in events', async () => {
    const planner = createMockPlanner();
    const listener = createMockListener();
    const ai = new GluonAI(planner, listener);
    const { session, trackId } = sessionWithTrack();

    planner.startTurnResults = [{
      textParts: [],
      functionCalls: [{
        id: 'call-1',
        name: 'sketch',
        args: {
          trackId,
          description: 'four on the floor',
          events: [
            { kind: 'trigger', at: '1.1.1', velocity: 1.0 },
            { kind: 'trigger', at: '1.2.1', velocity: 1.0 },
            { kind: 'trigger', at: '1.3.1', velocity: 1.0 },
            { kind: 'trigger', at: '1.4.1', velocity: 1.0 },
          ],
        },
      }],
    }];
    planner.continueTurnResults = [{ textParts: ['done'], functionCalls: [] }];

    const actions = await ai.ask(session, 'add a kick pattern');
    // The response for sketch should be applied: true
    const response = planner.lastFunctionResponses[0];
    expect(response.result.applied).toBe(true);
    // Actions should contain the sketch with resolved numeric positions
    const sketchAction = actions.find(a => a.type === 'sketch') as { type: string; events: { at: number }[] };
    expect(sketchAction).toBeDefined();
    // 1.1.1=0, 1.2.1=4, 1.3.1=8, 1.4.1=12
    expect(sketchAction.events!.map((e: { at: number }) => e.at)).toEqual([0, 4, 8, 12]);
  });

  it('sketch tool rejects invalid bar.beat.sixteenth strings', async () => {
    const planner = createMockPlanner();
    const listener = createMockListener();
    const ai = new GluonAI(planner, listener);
    const { session, trackId } = sessionWithTrack();

    planner.startTurnResults = [{
      textParts: [],
      functionCalls: [{
        id: 'call-1',
        name: 'sketch',
        args: {
          trackId,
          description: 'bad pattern',
          events: [
            { kind: 'trigger', at: '1.5.1', velocity: 1.0 }, // beat 5 invalid
          ],
        },
      }],
    }];
    planner.continueTurnResults = [{ textParts: ['oops'], functionCalls: [] }];

    await ai.ask(session, 'add pattern');
    const response = planner.lastFunctionResponses[0];
    expect(response.result.error).toBeDefined();
    expect(response.result.error).toContain('Invalid beat');
  });

  it('edit_pattern tool accepts bar.beat.sixteenth strings in operations', async () => {
    const planner = createMockPlanner();
    const listener = createMockListener();
    const ai = new GluonAI(planner, listener);
    const { session, trackId } = sessionWithTrack();

    planner.startTurnResults = [{
      textParts: [],
      functionCalls: [{
        id: 'call-1',
        name: 'edit_pattern',
        args: {
          trackId,
          description: 'add ghost note on bar 2 beat 3',
          operations: [
            { action: 'add', step: '2.3.1', event: { type: 'trigger', velocity: 0.3 } },
          ],
        },
      }],
    }];
    planner.continueTurnResults = [{ textParts: ['done'], functionCalls: [] }];

    const actions = await ai.ask(session, 'add a ghost note');
    const response = planner.lastFunctionResponses[0];
    expect(response.result.applied).toBe(true);
    const editAction = actions.find(a => a.type === 'edit_pattern') as { type: string; operations: { step: number }[] };
    expect(editAction).toBeDefined();
    // 2.3.1 = (2-1)*16 + (3-1)*4 + 0 = 24
    expect(editAction.operations[0].step).toBe(24);
  });

  it('sketch tool still accepts numeric at values', async () => {
    const planner = createMockPlanner();
    const listener = createMockListener();
    const ai = new GluonAI(planner, listener);
    const { session, trackId } = sessionWithTrack();

    planner.startTurnResults = [{
      textParts: [],
      functionCalls: [{
        id: 'call-1',
        name: 'sketch',
        args: {
          trackId,
          description: 'simple kick',
          events: [
            { kind: 'trigger', at: 0, velocity: 1.0 },
            { kind: 'trigger', at: 4, velocity: 1.0 },
          ],
        },
      }],
    }];
    planner.continueTurnResults = [{ textParts: ['done'], functionCalls: [] }];

    const actions = await ai.ask(session, 'kick');
    const response = planner.lastFunctionResponses[0];
    expect(response.result.applied).toBe(true);
    const sketchAction = actions.find(a => a.type === 'sketch') as { type: string; events: { at: number }[] };
    expect(sketchAction.events!.map((e: { at: number }) => e.at)).toEqual([0, 4]);
  });
});
