// tests/ai/chord-progression.test.ts — Tests for chord progression session metadata.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { compressState } from '../../src/ai/state-compression';
import { buildSystemPrompt } from '../../src/ai/system-prompt';
import { GluonAI } from '../../src/ai/api';
import { executeOperations } from '../../src/engine/operation-executor';
import { applyUndo } from '../../src/engine/primitives';
import { createSession } from '../../src/engine/session';
import { Arbitrator } from '../../src/engine/arbitration';
import type { PlannerProvider, ListenerProvider, GenerateResult, FunctionResponse } from '../../src/ai/types';
import type { Session } from '../../src/engine/types';

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

function createAdapter() {
  return {
    id: 'test',
    name: 'Test Adapter',
    mapControl() {
      return { adapterId: 'test', path: 'params.timbre' };
    },
    mapRuntimeParamKey(paramKey: string) {
      return paramKey === 'note' ? 'frequency' : paramKey;
    },
    applyControlChanges() {},
    mapEvents() { return []; },
    readControlState() { return {}; },
    readRegions() { return []; },
    getControlSchemas() { return []; },
    validateOperation() { return { valid: true }; },
    midiToNormalisedPitch(midi: number) { return midi / 127; },
    normalisedPitchToMidi(n: number) { return Math.round(n * 127); },
  };
}

describe('chord progression session metadata', () => {
  it('compresses chord progression with derived tones', () => {
    const session = createSession();
    session.chordProgression = [
      { bar: 1, chord: 'Fm' },
      { bar: 3, chord: 'Eb' },
    ];

    const result = compressState(session);
    expect(result.chord_progression).toEqual([
      { bar: 1, chord: 'Fm', tones: ['F', 'G#', 'C'] },
      { bar: 3, chord: 'Eb', tones: ['D#', 'G', 'A#'] },
    ]);
  });

  it('mentions chord progression guidance in the system prompt', () => {
    const prompt = buildSystemPrompt(createSession());
    expect(prompt).toContain('set_chord_progression');
    expect(prompt).toContain('chord_progression');
  });
});

describe('set_chord_progression tool execution', () => {
  let planner: ReturnType<typeof createMockPlanner>;
  let ai: GluonAI;

  beforeEach(() => {
    planner = createMockPlanner();
    ai = new GluonAI(planner, createMockListener());
  });

  it('sets and normalizes chord progression entries', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{
        id: 'c1',
        name: 'set_chord_progression',
        args: { chords: [{ bar: 3, chord: 'Eb' }, { bar: 1, chord: 'Fm' }] },
      }],
    });
    planner.continueTurnResults.push({ textParts: ['done'], functionCalls: [] });

    const actions = await ai.ask(createSession(), 'set the progression');
    const progressionActions = actions.filter(a => a.type === 'set_chord_progression');
    expect(progressionActions).toHaveLength(1);
    expect((progressionActions[0] as { chordProgression: Session['chordProgression'] }).chordProgression).toEqual([
      { bar: 1, chord: 'Fm' },
      { bar: 3, chord: 'Eb' },
    ]);

    const response = planner.lastFunctionResponses.find(r => r.name === 'set_chord_progression');
    expect(response).toBeDefined();
    const payload = response!.result as Record<string, unknown>;
    expect(payload.applied).toBe(true);
    expect(payload.chord_progression).toEqual([
      { bar: 1, chord: 'Fm', tones: ['F', 'G#', 'C'] },
      { bar: 3, chord: 'Eb', tones: ['D#', 'G', 'A#'] },
    ]);
  });

  it('clears chord progression when requested', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'set_chord_progression', args: { clear: true } }],
    });
    planner.continueTurnResults.push({ textParts: ['done'], functionCalls: [] });

    const session = createSession();
    session.chordProgression = [{ bar: 1, chord: 'Fm' }];
    const actions = await ai.ask(session, 'clear it');
    const progressionActions = actions.filter(a => a.type === 'set_chord_progression');
    expect(progressionActions).toHaveLength(1);
    expect((progressionActions[0] as { chordProgression: Session['chordProgression'] }).chordProgression).toBeNull();
  });

  it('rejects empty chord progression payloads', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'set_chord_progression', args: {} }],
    });
    planner.continueTurnResults.push({ textParts: ['done'], functionCalls: [] });

    await ai.ask(createSession(), 'set the progression');

    const response = planner.lastFunctionResponses.find(r => r.name === 'set_chord_progression');
    expect(response).toBeDefined();
    const payload = response!.result as Record<string, unknown>;
    expect(payload.error).toBeDefined();
    expect(String(payload.error)).toContain('non-empty chords array');
  });
});

describe('Operation executor: chord progression', () => {
  it('stores chord progression and restores it via undo', () => {
    const session = createSession();
    session.chordProgression = [{ bar: 1, chord: 'Fm' }];

    const report = executeOperations(
      session,
      [{ type: 'set_chord_progression', chordProgression: [{ bar: 1, chord: 'Eb' }, { bar: 3, chord: 'Db' }] }],
      createAdapter(),
      new Arbitrator(),
    );

    expect(report.session.chordProgression).toEqual([
      { bar: 1, chord: 'Eb' },
      { bar: 3, chord: 'Db' },
    ]);
    expect(report.log[0].description).toContain('chord progression');

    const undone = applyUndo(report.session);
    expect(undone.chordProgression).toEqual([{ bar: 1, chord: 'Fm' }]);
  });
});
