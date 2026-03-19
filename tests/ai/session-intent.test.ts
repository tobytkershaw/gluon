// tests/ai/session-intent.test.ts — Tests for session intent (#728) and section metadata (#751)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { compressState } from '../../src/ai/state-compression';
import { createSession } from '../../src/engine/session';
import { buildSystemPrompt } from '../../src/ai/system-prompt';
import { GluonAI } from '../../src/ai/api';
import type { PlannerProvider, ListenerProvider, GenerateResult, FunctionResponse, ToolSchema } from '../../src/ai/types';
import type { Session, SessionIntent, SectionMeta } from '../../src/engine/types';

// ---------------------------------------------------------------------------
// Mock providers
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

// ---------------------------------------------------------------------------
// State Compression — intent & section
// ---------------------------------------------------------------------------

describe('State compression: session intent', () => {
  it('omits intent when session has no intent', () => {
    const session = createSession();
    const result = compressState(session);
    expect('intent' in result).toBe(false);
  });

  it('omits intent when intent is an empty object', () => {
    const session = createSession();
    session.intent = {};
    const result = compressState(session);
    expect('intent' in result).toBe(false);
  });

  it('includes intent when session has intent fields', () => {
    const session = createSession();
    session.intent = { genre: ['dubstep', 'uk bass'], mood: ['dark'] };
    const result = compressState(session);
    expect(result.intent).toBeDefined();
    expect(result.intent!.genre).toEqual(['dubstep', 'uk bass']);
    expect(result.intent!.mood).toEqual(['dark']);
  });

  it('includes all intent fields when set', () => {
    const session = createSession();
    session.intent = {
      genre: ['techno'],
      references: ['Surgeon'],
      mood: ['industrial'],
      avoid: ['major chords'],
      currentGoal: 'build a pounding kick',
    };
    const result = compressState(session);
    expect(result.intent).toEqual(session.intent);
  });

  it('adds genre reference overlays for matched genres', () => {
    const session = createSession();
    session.intent = { genre: ['techno'] };

    const result = compressState(session);

    expect(result.genre_reference_overlays).toEqual([
      expect.objectContaining({
        genre: 'techno',
        profileId: 'techno_minimal',
        lufs: { min: -12, max: -7 },
        dynamicRange: { min: 5, max: 12 },
        crestFactor: { min: 5, max: 10 },
        spectralCentroidHz: { min: 1200, max: 3000 },
      }),
    ]);
    expect(result.genre_reference_overlays?.[0].frequencyBalance).toHaveLength(6);
  });

  it('dedupes overlays when multiple genre tags resolve to the same profile', () => {
    const session = createSession();
    session.intent = { genre: ['techno', 'minimal techno'] };

    const result = compressState(session);

    expect(result.genre_reference_overlays).toHaveLength(1);
    expect(result.genre_reference_overlays?.[0].profileId).toBe('techno_minimal');
  });

  it('omits overlays when no genre tag matches a reference profile', () => {
    const session = createSession();
    session.intent = { genre: ['glitch folk'] };

    const result = compressState(session);

    expect('genre_reference_overlays' in result).toBe(false);
  });
});

describe('State compression: section metadata', () => {
  it('omits section when session has no section', () => {
    const session = createSession();
    const result = compressState(session);
    expect('section' in result).toBe(false);
  });

  it('omits section when section is an empty object', () => {
    const session = createSession();
    session.section = {};
    const result = compressState(session);
    expect('section' in result).toBe(false);
  });

  it('includes section when session has section fields', () => {
    const session = createSession();
    session.section = { name: 'drop', targetEnergy: 0.9, targetDensity: 0.8 };
    const result = compressState(session);
    expect(result.section).toBeDefined();
    expect(result.section!.name).toBe('drop');
    expect(result.section!.targetEnergy).toBe(0.9);
    expect(result.section!.targetDensity).toBe(0.8);
  });

  it('includes section intent field', () => {
    const session = createSession();
    session.section = { name: 'intro', intent: 'sparse and tense' };
    const result = compressState(session);
    expect(result.section!.intent).toBe('sparse and tense');
  });
});

// ---------------------------------------------------------------------------
// System prompt mentions intent & section
// ---------------------------------------------------------------------------

describe('System prompt: intent & section guidance', () => {
  it('includes set_intent tool guidance', () => {
    const prompt = buildSystemPrompt(createSession());
    expect(prompt).toContain('set_intent');
  });

  it('includes set_section tool guidance', () => {
    const prompt = buildSystemPrompt(createSession());
    expect(prompt).toContain('set_section');
  });

  it('includes intent/section in compressed state format description', () => {
    const prompt = buildSystemPrompt(createSession());
    expect(prompt).toContain('intent');
    expect(prompt).toContain('section');
  });
});

// ---------------------------------------------------------------------------
// Tool execution via GluonAI.ask()
// ---------------------------------------------------------------------------

describe('set_intent tool execution', () => {
  let planner: ReturnType<typeof createMockPlanner>;
  let ai: GluonAI;

  beforeEach(() => {
    planner = createMockPlanner();
    ai = new GluonAI(planner, createMockListener());
  });

  it('set_intent updates session intent (genre)', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'set_intent', args: { genre: ['dubstep', 'uk bass'] } }],
    });
    planner.continueTurnResults.push({ textParts: ['done'], functionCalls: [] });

    const session = createSession();
    const actions = await ai.ask(session, 'set the genre');
    const intentActions = actions.filter(a => a.type === 'set_intent');
    expect(intentActions).toHaveLength(1);
    expect((intentActions[0] as { type: string; intent: SessionIntent }).intent.genre).toEqual(['dubstep', 'uk bass']);
  });

  it('set_intent merges with existing intent', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'set_intent', args: { mood: ['dark'] } }],
    });
    planner.continueTurnResults.push({ textParts: ['done'], functionCalls: [] });

    const session = createSession();
    session.intent = { genre: ['dubstep'] };
    const result = await ai.ask(session, 'set mood');

    // The response should include the merged intent for projection
    const response = planner.lastFunctionResponses.find(r => r.name === 'set_intent');
    expect(response).toBeDefined();
    const payload = response!.result as Record<string, unknown>;
    const intentState = (payload as { intent: SessionIntent }).intent;
    expect(intentState.genre).toEqual(['dubstep']);
    expect(intentState.mood).toEqual(['dark']);
  });

  it('set_intent rejects when no fields provided', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'set_intent', args: {} }],
    });
    planner.continueTurnResults.push({ textParts: ['ok'], functionCalls: [] });

    const session = createSession();
    await ai.ask(session, 'set intent');

    const response = planner.lastFunctionResponses.find(r => r.name === 'set_intent');
    const payload = response!.result as Record<string, unknown>;
    expect(payload.error).toBeDefined();
    expect(String(payload.error)).toContain('At least one intent field');
  });
});

describe('set_section tool execution', () => {
  let planner: ReturnType<typeof createMockPlanner>;
  let ai: GluonAI;

  beforeEach(() => {
    planner = createMockPlanner();
    ai = new GluonAI(planner, createMockListener());
  });

  it('set_section updates session section', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'set_section', args: { name: 'drop', targetEnergy: 0.9 } }],
    });
    planner.continueTurnResults.push({ textParts: ['done'], functionCalls: [] });

    const session = createSession();
    const actions = await ai.ask(session, 'now the drop');
    const sectionActions = actions.filter(a => a.type === 'set_section');
    expect(sectionActions).toHaveLength(1);
    const section = (sectionActions[0] as { type: string; section: SectionMeta }).section;
    expect(section.name).toBe('drop');
    expect(section.targetEnergy).toBe(0.9);
  });

  it('set_section clamps targetEnergy to 0-1', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'set_section', args: { targetEnergy: 1.5, targetDensity: -0.3 } }],
    });
    planner.continueTurnResults.push({ textParts: ['done'], functionCalls: [] });

    const session = createSession();
    const actions = await ai.ask(session, 'set section');
    const sectionActions = actions.filter(a => a.type === 'set_section');
    expect(sectionActions).toHaveLength(1);
    const section = (sectionActions[0] as { type: string; section: SectionMeta }).section;
    expect(section.targetEnergy).toBe(1);
    expect(section.targetDensity).toBe(0);
  });

  it('set_section merges with existing section', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'set_section', args: { intent: 'peak energy' } }],
    });
    planner.continueTurnResults.push({ textParts: ['done'], functionCalls: [] });

    const session = createSession();
    session.section = { name: 'drop', targetEnergy: 0.9 };
    await ai.ask(session, 'set section intent');

    const response = planner.lastFunctionResponses.find(r => r.name === 'set_section');
    const payload = response!.result as Record<string, unknown>;
    const sectionState = (payload as { section: SectionMeta }).section;
    expect(sectionState.name).toBe('drop');
    expect(sectionState.intent).toBe('peak energy');
  });

  it('set_section rejects when no fields provided', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'set_section', args: {} }],
    });
    planner.continueTurnResults.push({ textParts: ['ok'], functionCalls: [] });

    const session = createSession();
    await ai.ask(session, 'set section');

    const response = planner.lastFunctionResponses.find(r => r.name === 'set_section');
    const payload = response!.result as Record<string, unknown>;
    expect(payload.error).toBeDefined();
    expect(String(payload.error)).toContain('At least one section field');
  });
});

// ---------------------------------------------------------------------------
// Operation executor — set_intent / set_section in executeOperations
// ---------------------------------------------------------------------------

describe('Operation executor: intent & section', () => {
  // Import executeOperations to test the full execution path
  // These tests verify that executeOperations correctly merges intent/section
  // into the session state (not just the tool handler).

  it('set_intent action merges into session via executeOperations', async () => {
    const { executeOperations } = await import('../../src/engine/operation-executor');
    let session = createSession();
    session.intent = { genre: ['techno'] };

    const result = executeOperations(session, [
      { type: 'set_intent', intent: { mood: ['dark'], currentGoal: 'build a beat' } },
    ]);

    expect(result.session.intent).toEqual({
      genre: ['techno'],
      mood: ['dark'],
      currentGoal: 'build a beat',
    });
  });

  it('set_section action merges into session via executeOperations', async () => {
    const { executeOperations } = await import('../../src/engine/operation-executor');
    let session = createSession();
    session.section = { name: 'intro', targetEnergy: 0.3 };

    const result = executeOperations(session, [
      { type: 'set_section', section: { intent: 'sparse and tense' } },
    ]);

    expect(result.session.section).toEqual({
      name: 'intro',
      targetEnergy: 0.3,
      intent: 'sparse and tense',
    });
  });

  it('set_intent produces log entry', async () => {
    const { executeOperations } = await import('../../src/engine/operation-executor');
    const session = createSession();

    const result = executeOperations(session, [
      { type: 'set_intent', intent: { genre: ['dubstep'], mood: ['dark'] } },
    ]);

    expect(result.log.length).toBeGreaterThan(0);
    expect(result.log[0].description).toContain('intent updated');
  });

  it('set_section produces log entry with section name', async () => {
    const { executeOperations } = await import('../../src/engine/operation-executor');
    const session = createSession();

    const result = executeOperations(session, [
      { type: 'set_section', section: { name: 'breakdown' } },
    ]);

    expect(result.log.length).toBeGreaterThan(0);
    expect(result.log[0].description).toContain('breakdown');
  });
});
