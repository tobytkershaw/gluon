// tests/ai/patch-cache-race.test.ts — Regression test for #1212
//
// Verifies that save_patch followed by list_patches does not lose freshly
// saved patches when the lazy-load from IndexedDB fires between the two calls.

import { describe, it, expect, vi } from 'vitest';
import { GluonAI } from '../../src/ai/api';
import type {
  PlannerProvider,
  ListenerProvider,
  GenerateResult,
  FunctionResponse,
  ToolSchema,
  NeutralFunctionCall,
} from '../../src/ai/types';
import type { Session } from '../../src/engine/types';
import { createSession } from '../../src/engine/session';

// ---------------------------------------------------------------------------
// Test infrastructure (mirrors tool-handlers-adversarial.test.ts)
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

/** Call a sequence of tools on a shared GluonAI instance and return all responses. */
async function callToolsSequentially(
  session: Session,
  calls: Array<{ name: string; args: Record<string, unknown> }>,
): Promise<Record<string, unknown>[]> {
  const responses: Record<string, unknown>[] = [];

  for (let i = 0; i < calls.length; i++) {
    const fc: NeutralFunctionCall = { id: `call-${i}`, name: calls[i].name, args: calls[i].args };
    const planner = createMockPlanner([fc]);
    const listener = createMockListener();
    // Each call uses a fresh GluonAI to simulate the real scenario where
    // _userPatchesLoaded starts false.
    const ai = new GluonAI(planner, listener);

    await ai.ask(session, 'test');

    const continueMock = planner.continueTurn as ReturnType<typeof vi.fn>;
    const callArgs = continueMock.mock.calls[0];
    const funcResponses: FunctionResponse[] = callArgs?.[0]?.functionResponses ?? [];
    const resp = funcResponses.find(r => r.id === `call-${i}`);
    responses.push((resp?.result ?? {}) as Record<string, unknown>);
  }

  return responses;
}

/** Call two tools on the SAME GluonAI instance (sequential turns). */
async function callToolsPersistent(
  session: Session,
  calls: Array<{ name: string; args: Record<string, unknown> }>,
): Promise<Record<string, unknown>[]> {
  const responses: Record<string, unknown>[] = [];
  const listener = createMockListener();

  // We need a single GluonAI instance to test the persistent cache state.
  // Use a planner that serves one tool call per startTurn invocation.
  let callIndex = 0;
  const planner: PlannerProvider = {
    name: 'mock',
    isConfigured: () => true,
    startTurn: vi.fn(async (): Promise<GenerateResult> => {
      const i = callIndex++;
      if (i < calls.length) {
        const fc: NeutralFunctionCall = { id: `call-${i}`, name: calls[i].name, args: { ...calls[i].args } };
        return { textParts: [], functionCalls: [fc] };
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

  const ai = new GluonAI(planner, listener);

  for (let i = 0; i < calls.length; i++) {
    await ai.ask(session, `test-${i}`);

    const continueMock = planner.continueTurn as ReturnType<typeof vi.fn>;
    // The i-th ask() call triggers the i-th continueTurn call
    const callArgs = continueMock.mock.calls[i];
    const funcResponses: FunctionResponse[] = callArgs?.[0]?.functionResponses ?? [];
    const resp = funcResponses.find(r => r.id === `call-${i}`);
    responses.push((resp?.result ?? {}) as Record<string, unknown>);
  }

  return responses;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('patch cache race condition (#1212)', () => {
  it('save_patch marks cache as loaded so list_patches does not overwrite', async () => {
    const session = createSession();
    const trackId = session.tracks[0].id;

    const responses = await callToolsPersistent(session, [
      { name: 'save_patch', args: { trackId, name: 'My Test Patch', tags: ['test'] } },
      { name: 'list_patches', args: {} },
    ]);

    // save_patch should succeed
    const saveResp = responses[0];
    expect(saveResp.saved).toBe(true);
    expect(saveResp.name).toBe('My Test Patch');

    // list_patches should include the user patch that was just saved
    const listResp = responses[1];
    expect(listResp.userCount).toBeGreaterThanOrEqual(1);

    // The saved patch should appear in the patch list
    const patches = listResp.patches as Array<{ name: string }>;
    const found = patches.find(p => p.name === 'My Test Patch');
    expect(found, 'freshly saved patch should appear in list_patches').toBeDefined();
  });

  it('save_patch marks cache as loaded so load_patch can find it', async () => {
    const session = createSession();
    const trackId = session.tracks[0].id;

    const responses = await callToolsPersistent(session, [
      { name: 'save_patch', args: { trackId, name: 'Loadable Patch', tags: ['test'] } },
      { name: 'load_patch', args: { trackId, patch: 'Loadable Patch' } },
    ]);

    // save_patch should succeed
    expect(responses[0].saved).toBe(true);

    // load_patch should find the patch (not return an error)
    const loadResp = responses[1];
    expect(loadResp.error).toBeUndefined();
  });
});
