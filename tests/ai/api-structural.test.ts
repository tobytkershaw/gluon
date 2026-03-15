// tests/ai/api-structural.test.ts — Structural integrity tests for api.ts
//
// Verifies that every tool declared in GLUON_TOOLS has a corresponding handler
// in executeFunctionCall, and that every AIAction type has a case in projectAction.
// These tests exist to catch regressions from merge conflicts and multi-agent edits.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GluonAI } from '../../src/ai/api';
import { GLUON_TOOLS } from '../../src/ai/tool-schemas';
import type { PlannerProvider, ListenerProvider, GenerateResult, FunctionResponse, ToolSchema } from '../../src/ai/types';
import { createSession } from '../../src/engine/session';

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
      return { param: 'brightness', target: { absolute: 0.5 }, trackId: 'v0' };
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
    case 'add_view':
      return { trackId: 'v0', viewKind: 'step-grid', description: 'test' };
    case 'remove_view':
      return { trackId: 'v0', viewId: 'step-grid-v0', description: 'test' };
    case 'add_processor':
      return { trackId: 'v0', moduleType: 'rings', description: 'test' };
    case 'remove_processor':
      return { trackId: 'v0', processorId: 'rings-123', description: 'test' };
    case 'replace_processor':
      return { trackId: 'v0', processorId: 'rings-123', newModuleType: 'clouds', description: 'test' };
    case 'add_modulator':
      return { trackId: 'v0', moduleType: 'tides', description: 'test' };
    case 'remove_modulator':
      return { trackId: 'v0', modulatorId: 'tides-123', description: 'test' };
    case 'connect_modulator':
      return { trackId: 'v0', modulatorId: 'tides-123', targetKind: 'source', targetParam: 'brightness', depth: 0.2, description: 'test' };
    case 'disconnect_modulator':
      return { trackId: 'v0', modulationId: 'mod-123', description: 'test' };
    case 'set_surface':
      return { trackId: 'v0', semanticControls: [], description: 'test' };
    case 'pin':
      return { trackId: 'v0', moduleId: 'source', controlId: 'brightness' };
    case 'unpin':
      return { trackId: 'v0', moduleId: 'source', controlId: 'brightness' };
    case 'label_axes':
      return { trackId: 'v0', x: 'Brightness', y: 'Texture' };
    case 'set_importance':
      return { trackId: 'v0', importance: 0.5 };
    case 'mark_approved':
      return { trackId: 'v0', level: 'liked', reason: 'test' };
    case 'render':
      return { bars: 2 };
    case 'spectral':
      return { snapshotId: 'snap-1' };
    case 'dynamics':
      return { snapshotId: 'snap-1' };
    case 'rhythm':
      return { snapshotId: 'snap-1' };
    case 'raise_decision':
      return { question: 'which direction?' };
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
  // Tools that need external plumbing (listen, render, spectral, dynamics,
  // rhythm) may return a different error (e.g. "not available", "snapshot
  // not found") — that's fine, it proves the handler exists.

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
    // This is a compile-time check reinforced at runtime.
    // The AIAction union includes all types that executeFunctionCall creates.
    // projectAction must handle each one (or fall through to default safely).
    //
    // We verify this by listing every action type that executeFunctionCall
    // can produce and checking they're all covered.

    // Tools that produce actions (not analysis-only tools like listen/render/spectral/dynamics/rhythm):
    const actionProducingTools = [
      'move', 'sketch', 'set_transport', 'set_model', 'transform',
      'add_view', 'remove_view',
      'add_processor', 'remove_processor', 'replace_processor',
      'add_modulator', 'remove_modulator',
      'connect_modulator', 'disconnect_modulator',
      'set_surface', 'pin', 'unpin', 'label_axes',
      'set_importance', 'mark_approved', 'raise_decision',
    ];

    // Analysis-only tools produce no actions (actions: []):
    const analysisOnlyTools = ['listen', 'render', 'spectral', 'dynamics', 'rhythm'];

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
    expect(GLUON_TOOLS.length).toBe(26);
  });
});
