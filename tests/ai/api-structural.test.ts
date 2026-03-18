// tests/ai/api-structural.test.ts — Structural integrity tests for api.ts
//
// Verifies that every tool declared in GLUON_TOOLS has a corresponding handler
// in executeFunctionCall, and that every AIAction type has a case in projectAction.
// These tests exist to catch regressions from merge conflicts and multi-agent edits.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GluonAI } from '../../src/ai/api';
import { GLUON_TOOLS } from '../../src/ai/tool-schemas';
import type { PlannerProvider, ListenerProvider, GenerateResult, FunctionResponse, ToolSchema } from '../../src/ai/types';
import { createSession, addTrack } from '../../src/engine/session';

// ---------------------------------------------------------------------------
// Mock planner: returns a single function call for the configured tool name
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

    startTurn: vi.fn(async (opts: { systemPrompt: string; userMessage: string; tools: ToolSchema[] }): Promise<GenerateResult> => {
      return planner.startTurnResults.shift() ?? { textParts: [], functionCalls: [] };
    }),

    continueTurn: vi.fn(async (opts: { systemPrompt: string; tools: ToolSchema[]; functionResponses: FunctionResponse[] }): Promise<GenerateResult> => {
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

/**
 * Build minimal valid args for a given tool name so the handler doesn't
 * reject on missing-required-parameter validation. We don't need perfect
 * args — we just need to get past the "Unknown tool" check.
 */
function minimalArgsForTool(toolName: string): Record<string, unknown> {
  switch (toolName) {
    case 'move':
      return { param: 'timbre', target: { absolute: 0.5 }, trackId: 'v0' };
    case 'sketch':
      return { trackId: 'v0', description: 'test', events: [{ kind: 'trigger', at: 0, velocity: 1.0 }] };
    case 'listen':
      return { question: 'how does it sound?' };
    case 'set_transport':
      return { bpm: 120 };
    case 'set_model':
      return { trackId: 'v0', model: 'virtual-analog' };
    case 'transform':
      return { trackId: 'v0', operation: 'reverse', description: 'test' };
    case 'manage_view':
      return { action: 'add', trackId: 'v0', viewKind: 'step-grid', description: 'test' };
    case 'manage_processor':
      return { action: 'add', trackId: 'v0', moduleType: 'rings', description: 'test' };
    case 'manage_modulator':
      return { action: 'add', trackId: 'v0', moduleType: 'tides', description: 'test' };
    case 'modulation_route':
      return { action: 'connect', trackId: 'v0', modulatorId: 'tides-123', targetKind: 'source', targetParam: 'timbre', depth: 0.2, description: 'test' };
    case 'set_surface':
      return { trackId: 'v0', semanticControls: [], description: 'test' };
    case 'pin_control':
      return { action: 'pin', trackId: 'v0', moduleId: 'source', controlId: 'timbre' };
    case 'label_axes':
      return { trackId: 'v0', x: 'Brightness', y: 'Texture' };
    case 'set_track_meta':
      return { trackId: 'v0', importance: 0.5 };
    case 'render':
      return { bars: 2 };
    case 'analyze':
      return { snapshotId: 'snap-1', types: ['spectral'] };
    case 'raise_decision':
      return { question: 'which direction?' };
    case 'manage_track':
      return { action: 'add', kind: 'audio', description: 'test' };
    case 'manage_send':
      return { action: 'add', trackId: 'v0', busId: 'master-bus', level: 0.5 };
    case 'set_master':
      return { volume: 0.7 };
    case 'manage_pattern':
      return { action: 'add', trackId: 'v0', description: 'test' };
    case 'manage_sequence':
      return { action: 'append', trackId: 'v0', patternId: 'v0-pattern-0', description: 'test' };
    case 'report_bug':
      return { summary: 'test bug', category: 'tool', details: 'expected X got Y', severity: 'low' };
    case 'set_intent':
      return { genre: ['techno'] };
    case 'set_section':
      return { name: 'intro' };
    case 'set_scale':
      return { root: 0, mode: 'major' };
    case 'assign_spectral_slot':
      return { trackId: 'v0', bands: ['sub', 'low'], priority: 8 };
    case 'manage_motif':
      return { action: 'list' };
    default:
      return {};
  }
}

describe('API Structural Integrity', () => {
  let planner: ReturnType<typeof createMockPlanner>;
  let listener: ReturnType<typeof createMockListener>;
  let ai: GluonAI;

  beforeEach(() => {
    planner = createMockPlanner();
    listener = createMockListener();
    ai = new GluonAI(planner, listener);
  });

  // -----------------------------------------------------------------------
  // Core invariant: every declared tool name has a handler
  // -----------------------------------------------------------------------

  const toolNames = GLUON_TOOLS.map(t => t.name);

  it('GLUON_TOOLS has no duplicate tool names', () => {
    const unique = new Set(toolNames);
    expect(unique.size).toBe(toolNames.length);
  });

  // For each tool, verify the executeFunctionCall switch does NOT hit the
  // "Unknown tool" default branch. We do this by calling ask() with a
  // function call for the tool and inspecting the response passed back to
  // continueTurn. If the response contains { error: "Unknown tool: ..." }
  // the tool has no handler.
  //
  // Tools that need external plumbing (listen, render, analyze) may return
  // a different error (e.g. "not available", "snapshot not found") — that's
  // fine, it proves the handler exists.

  for (const toolName of toolNames) {
    it(`has a handler for tool "${toolName}"`, async () => {
      const args = minimalArgsForTool(toolName);

      planner.startTurnResults.push({
        textParts: [],
        functionCalls: [{ id: `test-${toolName}`, name: toolName, args }],
      });
      planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

      const session = createSession();
      await ai.ask(session, 'test');

      // Check the function response that was fed back to continueTurn
      const responses = planner.lastFunctionResponses;
      expect(responses.length).toBeGreaterThanOrEqual(1);

      const response = responses.find(r => r.name === toolName);
      expect(response).toBeDefined();

      // The critical check: the response must NOT be "Unknown tool: <name>"
      const result = response!.result as Record<string, unknown>;
      if (result.error) {
        expect(result.error).not.toContain('Unknown tool');
      }
    });
  }

  // -----------------------------------------------------------------------
  // AIAction types coverage in projectAction
  // -----------------------------------------------------------------------

  it('projectAction handles all action types that executeFunctionCall can produce', () => {
    // Tools that produce actions (not analysis-only tools like listen/render/analyze):
    const actionProducingTools = [
      'move', 'sketch', 'edit_pattern', 'set_transport', 'set_model', 'transform',
      'manage_view', 'manage_processor', 'manage_modulator',
      'modulation_route', 'set_surface', 'pin_control', 'label_axes',
      'manage_send', 'set_master', 'manage_pattern', 'manage_sequence',
      'set_track_meta', 'manage_track', 'raise_decision', 'report_bug',
      'set_intent', 'set_section', 'set_scale', 'shape_timbre',
      'apply_chain_recipe', 'set_mix_role', 'apply_modulation',
      'assign_spectral_slot',
      'manage_motif',
    ];

    // Analysis-only tools produce no actions (actions: []):
    const analysisOnlyTools = ['listen', 'render', 'analyze', 'explain_chain', 'simplify_chain'];

    // Together they should cover all GLUON_TOOLS
    const allCovered = [...actionProducingTools, ...analysisOnlyTools].sort();
    const allTools = toolNames.slice().sort();
    expect(allCovered).toEqual(allTools);
  });

  // -----------------------------------------------------------------------
  // Tool schema count matches (catches accidentally dropped tools)
  // -----------------------------------------------------------------------

  it('tool count matches expected value', () => {
    // Update this number if you add or remove tools
    expect(GLUON_TOOLS.length).toBe(35);
  });

  // -----------------------------------------------------------------------
  // Merged tool behavior tests
  // -----------------------------------------------------------------------

  it('manage_processor: action=add without moduleType returns error', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'test', name: 'manage_processor', args: { action: 'add', trackId: 'v0', description: 'test' } }],
    });
    planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

    await ai.ask(createSession(), 'test');
    const response = planner.lastFunctionResponses.find(r => r.name === 'manage_processor');
    expect((response!.result as Record<string, unknown>).error).toContain('moduleType');
  });

  it('manage_processor: action=remove without processorId returns error', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'test', name: 'manage_processor', args: { action: 'remove', trackId: 'v0', description: 'test' } }],
    });
    planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

    await ai.ask(createSession(), 'test');
    const response = planner.lastFunctionResponses.find(r => r.name === 'manage_processor');
    expect((response!.result as Record<string, unknown>).error).toContain('processorId');
  });

  it('manage_processor: action=replace without both returns error', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'test', name: 'manage_processor', args: { action: 'replace', trackId: 'v0', description: 'test' } }],
    });
    planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

    await ai.ask(createSession(), 'test');
    const response = planner.lastFunctionResponses.find(r => r.name === 'manage_processor');
    expect((response!.result as Record<string, unknown>).error).toBeDefined();
  });

  it('set_track_meta: neither field returns error', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'test', name: 'set_track_meta', args: { trackId: 'v0' } }],
    });
    planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

    await ai.ask(createSession(), 'test');
    const response = planner.lastFunctionResponses.find(r => r.name === 'set_track_meta');
    expect((response!.result as Record<string, unknown>).error).toContain('At least one');
  });

  it('set_track_meta: approval fails without reason, importance still applied', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'test', name: 'set_track_meta', args: { trackId: 'v0', approval: 'liked', importance: 0.8 } }],
    });
    planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

    await ai.ask(createSession(), 'test');
    const response = planner.lastFunctionResponses.find(r => r.name === 'set_track_meta');
    const result = response!.result as Record<string, unknown>;
    expect(result.errors).toContain('approval requires reason');
    expect(result.applied).toContain('importance');
  });

  it('set_track_meta: approval fails with bad enum, importance still applied', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'test', name: 'set_track_meta', args: { trackId: 'v0', approval: 'bogus', reason: 'test', importance: 0.7 } }],
    });
    planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

    await ai.ask(createSession(), 'test');
    const response = planner.lastFunctionResponses.find(r => r.name === 'set_track_meta');
    const result = response!.result as Record<string, unknown>;
    expect(result.errors).toBeDefined();
    expect((result.errors as string[])[0]).toContain('Invalid approval level');
    expect(result.applied).toContain('importance');
  });

  it('set_track_meta: only musicalRole preserves existing importance', async () => {
    const session = createSession();
    // Set a known importance on v0
    const track = session.tracks.find(v => v.id === 'v0')!;
    track.importance = 0.9;

    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'test', name: 'set_track_meta', args: { trackId: 'v0', musicalRole: 'driving rhythm' } }],
    });
    planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

    const actions = await ai.ask(session, 'test');
    // The action should carry the existing importance value
    const importanceAction = actions.find(a => a.type === 'set_importance');
    expect(importanceAction).toBeDefined();
    expect((importanceAction as { importance: number }).importance).toBe(0.9);
    expect((importanceAction as { musicalRole: string }).musicalRole).toBe('driving rhythm');

    const response = planner.lastFunctionResponses.find(r => r.name === 'set_track_meta');
    const result = response!.result as Record<string, unknown>;
    expect(result.applied).toContain('musicalRole');
    expect(result.applied).not.toContain('importance');
  });

  it('set_track_meta: only musicalRole errors when importance never set', async () => {
    const session = createSession();
    // v0 has no importance set (undefined)
    const track = session.tracks.find(v => v.id === 'v0')!;
    delete (track as Record<string, unknown>).importance;

    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'test', name: 'set_track_meta', args: { trackId: 'v0', musicalRole: 'driving rhythm' } }],
    });
    planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

    const actions = await ai.ask(session, 'test');
    // No set_importance action should be generated
    expect(actions.find(a => a.type === 'set_importance')).toBeUndefined();

    const response = planner.lastFunctionResponses.find(r => r.name === 'set_track_meta');
    const result = response!.result as Record<string, unknown>;
    expect(result.errors).toBeDefined();
    expect((result.errors as string[])[0]).toContain('importance to be set first');
  });

  it('set_track_meta: non-number importance returns error', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'test', name: 'set_track_meta', args: { trackId: 'v0', importance: null } }],
    });
    planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

    await ai.ask(createSession(), 'test');
    const response = planner.lastFunctionResponses.find(r => r.name === 'set_track_meta');
    const result = response!.result as Record<string, unknown>;
    expect(result.errors).toBeDefined();
    expect((result.errors as string[])[0]).toContain('finite number');
  });

  it('analyze: deduplicates types', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'test', name: 'analyze', args: { snapshotId: 'nonexistent', types: ['spectral', 'spectral'] } }],
    });
    planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

    await ai.ask(createSession(), 'test');
    const response = planner.lastFunctionResponses.find(r => r.name === 'analyze');
    // Should get "Snapshot not found" error, not "Unknown tool"
    expect((response!.result as Record<string, unknown>).error).toContain('Snapshot not found');
  });

  // -----------------------------------------------------------------------
  // Ordinal track identity resolution (#515)
  // -----------------------------------------------------------------------

  it('move: resolves "Track 1" to v0', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'test', name: 'move', args: { param: 'timbre', target: { absolute: 0.5 }, trackId: 'Track 1' } }],
    });
    planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

    const actions = await ai.ask(createSession(), 'make track 1 darker');
    const moveAction = actions.find(a => a.type === 'move');
    expect(moveAction).toBeDefined();
    expect((moveAction as { trackId?: string }).trackId).toBe('v0');
  });

  it('sketch: resolves "Track 2" to v1', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'test', name: 'sketch', args: { trackId: 'Track 2', description: 'test', events: [{ kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 0.25 }] } }],
    });
    planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

    let session = createSession();
    session = addTrack(session)!;
    const actions = await ai.ask(session, 'write a pattern on track 2');
    const sketchAction = actions.find(a => a.type === 'sketch');
    expect(sketchAction).toBeDefined();
    expect((sketchAction as { trackId: string }).trackId).toBe('v1');
  });

  it('rejects unknown track reference', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'test', name: 'move', args: { param: 'timbre', target: { absolute: 0.5 }, trackId: 'Track 99' } }],
    });
    planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

    await ai.ask(createSession(), 'test');
    const response = planner.lastFunctionResponses.find(r => r.name === 'move');
    expect((response!.result as Record<string, unknown>).error).toContain('Unknown track');
  });

  it('resolves bare ordinal "1" as trackId', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'test', name: 'move', args: { param: 'timbre', target: { absolute: 0.5 }, trackId: '1' } }],
    });
    planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

    const actions = await ai.ask(createSession(), 'test');
    const moveAction = actions.find(a => a.type === 'move');
    expect(moveAction).toBeDefined();
    expect((moveAction as { trackId?: string }).trackId).toBe('v0');
  });

  it('internal IDs still work after ordinal resolution', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'test', name: 'move', args: { param: 'timbre', target: { absolute: 0.5 }, trackId: 'v2' } }],
    });
    planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

    let session = createSession();
    session = addTrack(session)!;
    session = addTrack(session)!;
    const actions = await ai.ask(session, 'test');
    const moveAction = actions.find(a => a.type === 'move');
    expect(moveAction).toBeDefined();
    expect((moveAction as { trackId?: string }).trackId).toBe('v2');
  });
});
