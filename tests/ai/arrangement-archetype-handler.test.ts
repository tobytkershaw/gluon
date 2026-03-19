// tests/ai/arrangement-archetype-handler.test.ts — Tests for the apply_arrangement_archetype tool handler.

import { describe, it, expect, vi } from 'vitest';
import { GluonAI } from '../../src/ai/api';
import type { PlannerProvider, ListenerProvider, GenerateResult, FunctionResponse, NeutralFunctionCall } from '../../src/ai/types';
import type { Session, AIAction } from '../../src/engine/types';
import { createSession } from '../../src/engine/session';
import { ARRANGEMENT_ARCHETYPE_NAMES } from '../../src/engine/arrangement-archetypes';

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

function createMockPlanner(calls: NeutralFunctionCall[]): PlannerProvider {
  let firstCall = true;
  return {
    name: 'mock',
    isConfigured: () => true,
    startTurn: vi.fn(async (): Promise<GenerateResult> => {
      if (firstCall) {
        firstCall = false;
        return { textParts: [], functionCalls: calls };
      }
      return { textParts: [], functionCalls: [] };
    }),
    continueTurn: vi.fn(async (): Promise<GenerateResult> => {
      return { textParts: [], functionCalls: [] };
    }),
    commitTurn: vi.fn(),
    discardTurn: vi.fn(),
    trimHistory: vi.fn(),
    clearHistory: vi.fn(),
  };
}

function createMockListener(): ListenerProvider {
  return {
    name: 'mock',
    isConfigured: () => true,
    evaluate: vi.fn(async () => 'sounds good'),
  };
}

async function callTool(
  session: Session,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ actions: AIAction[]; response: Record<string, unknown> }> {
  const fc: NeutralFunctionCall = { id: 'test-call-1', name: toolName, args };
  const planner = createMockPlanner([fc]);
  const listener = createMockListener();
  const ai = new GluonAI(planner, listener);
  const actions = await ai.ask(session, 'test');

  const continueMock = planner.continueTurn as ReturnType<typeof vi.fn>;
  const callArgs = continueMock.mock.calls[0];
  const funcResponses: FunctionResponse[] = callArgs?.[0]?.functionResponses ?? [];
  const resp = funcResponses.find(r => r.id === 'test-call-1');

  const toolActions = actions.filter(a => a.type !== 'say') as AIAction[];

  return {
    actions: toolActions,
    response: (resp?.result ?? {}) as Record<string, unknown>,
  };
}

function makeSession(): Session {
  return createSession();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('apply_arrangement_archetype handler', () => {
  describe('validation', () => {
    it('rejects missing archetype', async () => {
      const session = makeSession();
      const trackId = session.tracks[0].id;
      const { response } = await callTool(session, 'apply_arrangement_archetype', {
        trackId,
        description: 'test',
      });
      expect(response.error).toMatch(/archetype/i);
    });

    it('rejects missing trackId', async () => {
      const session = makeSession();
      const { response } = await callTool(session, 'apply_arrangement_archetype', {
        archetype: 'techno_64bar',
        description: 'test',
      });
      expect(response.error).toMatch(/trackId/i);
    });

    it('rejects missing description', async () => {
      const session = makeSession();
      const trackId = session.tracks[0].id;
      const { response } = await callTool(session, 'apply_arrangement_archetype', {
        archetype: 'techno_64bar',
        trackId,
      });
      expect(response.error).toMatch(/description/i);
    });

    it('rejects unknown archetype name', async () => {
      const session = makeSession();
      const trackId = session.tracks[0].id;
      const { response } = await callTool(session, 'apply_arrangement_archetype', {
        archetype: 'nonexistent_archetype',
        trackId,
        description: 'test',
      });
      expect(response.error).toMatch(/unknown/i);
      expect(response.available).toBeDefined();
    });

    it('rejects unknown trackId', async () => {
      const session = makeSession();
      const { response } = await callTool(session, 'apply_arrangement_archetype', {
        archetype: 'techno_64bar',
        trackId: 'nonexistent-track',
        description: 'test',
      });
      expect(response.error).toBeDefined();
    });
  });

  describe('successful application', () => {
    it('produces actions for techno_64bar', async () => {
      const session = makeSession();
      const trackId = session.tracks[0].id;
      const { actions, response } = await callTool(session, 'apply_arrangement_archetype', {
        archetype: 'techno_64bar',
        trackId,
        description: '64-bar techno kick',
      });

      expect(response.applied).toBe(true);
      expect(response.archetype).toBe('techno_64bar');
      expect(response.totalBars).toBe(64);
      expect(response.trackId).toBe(trackId);
    });

    it('produces manage_pattern actions for each section', async () => {
      const session = makeSession();
      const trackId = session.tracks[0].id;
      const { actions } = await callTool(session, 'apply_arrangement_archetype', {
        archetype: 'techno_64bar',
        trackId,
        description: '64-bar techno kick',
      });

      // techno_64bar has 6 sections, each needs add + set_length + rename = 3 manage_pattern actions
      const managePatternActions = actions.filter(a => a.type === 'manage_pattern');
      // 6 sections * 3 actions each = 18 manage_pattern actions
      expect(managePatternActions.length).toBe(18);
    });

    it('produces sketch actions for non-silent sections', async () => {
      const session = makeSession();
      const trackId = session.tracks[0].id;
      const { actions } = await callTool(session, 'apply_arrangement_archetype', {
        archetype: 'techno_64bar',
        trackId,
        description: '64-bar techno kick',
      });

      // techno_64bar has 6 sections, none are silent, so 6 sketch actions
      const sketchActions = actions.filter(a => a.type === 'sketch');
      expect(sketchActions.length).toBe(6);
    });

    it('response includes section metadata', async () => {
      const session = makeSession();
      const trackId = session.tracks[0].id;
      const { response } = await callTool(session, 'apply_arrangement_archetype', {
        archetype: 'house_32bar',
        trackId,
        description: '32-bar house groove',
      });

      const sections = response.sections as Array<{ name: string; bars: number; density: string; energy: number }>;
      expect(sections).toBeDefined();
      expect(sections.length).toBe(5); // house_32bar has 5 sections
      expect(sections[0].name).toBe('Intro');
      expect(sections[sections.length - 1].name).toBe('Outro');
    });

    it('resolves track by ordinal label', async () => {
      const session = makeSession();
      const { response } = await callTool(session, 'apply_arrangement_archetype', {
        archetype: 'ambient_32bar',
        trackId: 'Track 1',
        description: 'ambient arrangement',
      });

      expect(response.applied).toBe(true);
      expect(response.trackId).toBe(session.tracks[0].id);
    });
  });

  describe('all archetypes produce valid actions', () => {
    for (const name of ARRANGEMENT_ARCHETYPE_NAMES) {
      it(`${name} produces non-empty action list`, async () => {
        const session = makeSession();
        const trackId = session.tracks[0].id;
        const { actions, response } = await callTool(session, 'apply_arrangement_archetype', {
          archetype: name,
          trackId,
          description: `test ${name}`,
        });

        expect(response.applied).toBe(true);
        expect(actions.length).toBeGreaterThan(0);

        // Every action should target the correct track
        for (const action of actions) {
          if ('trackId' in action) {
            expect((action as { trackId: string }).trackId).toBe(trackId);
          }
        }
      });
    }
  });
});
