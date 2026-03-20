// tests/ai/analyze-validation.test.ts — Validate analyze tool input constraints
//
// #1230: diff analysis rejects mismatched scope or bars between snapshots
// #1231: masking analysis rejects duplicate trackIds in snapshot list

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { GluonAI } from '../../src/ai/api';
import type { PlannerProvider, ListenerProvider, GenerateResult, FunctionResponse, ToolSchema } from '../../src/ai/types';
import { createSession } from '../../src/engine/session';
import { storeSnapshot, clearSnapshots } from '../../src/audio/snapshot-store';
import type { AudioSnapshot } from '../../src/audio/snapshot-store';

// ---------------------------------------------------------------------------
// Mock providers (minimal — we only care about function call responses)
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

    startTurn: vi.fn(async (_opts: { systemPrompt: string; userMessage: string; tools: ToolSchema[] }): Promise<GenerateResult> => {
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSilentSnapshot(overrides: Partial<AudioSnapshot> & { id: string }): AudioSnapshot {
  const defaults: AudioSnapshot = {
    id: overrides.id,
    pcm: new Float32Array(4410), // 0.1s at 44100
    sampleRate: 44100,
    scope: [],
    bars: 2,
  };
  return { ...defaults, ...overrides };
}

/** Send a single analyze function call and return the tool response. */
async function callAnalyze(
  planner: ReturnType<typeof createMockPlanner>,
  ai: GluonAI,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  planner.startTurnResults.push({
    textParts: [],
    functionCalls: [{ id: 'test-analyze', name: 'analyze', args }],
  });
  planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

  const session = createSession();
  await ai.ask(session, 'analyze');

  const response = planner.lastFunctionResponses.find(r => r.name === 'analyze');
  expect(response).toBeDefined();
  return response!.result as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('analyze tool validation', () => {
  let planner: ReturnType<typeof createMockPlanner>;
  let ai: GluonAI;

  beforeEach(() => {
    clearSnapshots();
    planner = createMockPlanner();
    const listener = createMockListener();
    ai = new GluonAI(planner, listener);
  });

  afterEach(() => {
    clearSnapshots();
  });

  // -------------------------------------------------------------------------
  // #1230 — diff rejects mismatched scope
  // -------------------------------------------------------------------------

  describe('diff scope/bars validation (#1230)', () => {
    it('returns error when diff snapshots have mismatched scope', async () => {
      const snapA = makeSilentSnapshot({ id: 'snap-a', scope: ['track-1'], bars: 2 });
      const snapB = makeSilentSnapshot({ id: 'snap-b', scope: ['track-2'], bars: 2 });
      storeSnapshot(snapA);
      storeSnapshot(snapB);

      const result = await callAnalyze(planner, ai, {
        types: ['diff'],
        snapshotId: 'snap-a',
        compareSnapshotId: 'snap-b',
      });

      const errors = result.errors as string[] | undefined;
      expect(errors).toBeDefined();
      expect(errors!.some(e => e.includes('mismatched scope'))).toBe(true);
      expect(result.results).toBeDefined();
      expect((result.results as Record<string, unknown>).diff).toBeUndefined();
    });

    it('returns error when diff snapshots have mismatched bars', async () => {
      const snapA = makeSilentSnapshot({ id: 'snap-a', scope: ['track-1'], bars: 2 });
      const snapB = makeSilentSnapshot({ id: 'snap-b', scope: ['track-1'], bars: 4 });
      storeSnapshot(snapA);
      storeSnapshot(snapB);

      const result = await callAnalyze(planner, ai, {
        types: ['diff'],
        snapshotId: 'snap-a',
        compareSnapshotId: 'snap-b',
      });

      const errors = result.errors as string[] | undefined;
      expect(errors).toBeDefined();
      expect(errors!.some(e => e.includes('mismatched duration'))).toBe(true);
      expect((result.results as Record<string, unknown>).diff).toBeUndefined();
    });

    it('allows diff when scope and bars match', async () => {
      const snapA = makeSilentSnapshot({ id: 'snap-a', scope: ['track-1'], bars: 2 });
      const snapB = makeSilentSnapshot({ id: 'snap-b', scope: ['track-1'], bars: 2 });
      storeSnapshot(snapA);
      storeSnapshot(snapB);

      const result = await callAnalyze(planner, ai, {
        types: ['diff'],
        snapshotId: 'snap-a',
        compareSnapshotId: 'snap-b',
      });

      // Should succeed — no errors about scope/bars
      const errors = result.errors as string[] | undefined;
      const hasScopeError = errors?.some(e => e.includes('mismatched scope') || e.includes('mismatched duration'));
      expect(hasScopeError ?? false).toBe(false);
      expect((result.results as Record<string, unknown>).diff).toBeDefined();
    });

    it('diff error does not block other analysis types in the same call', async () => {
      const snapA = makeSilentSnapshot({ id: 'snap-a', scope: ['track-1'], bars: 2 });
      const snapB = makeSilentSnapshot({ id: 'snap-b', scope: ['track-2'], bars: 2 });
      storeSnapshot(snapA);
      storeSnapshot(snapB);

      const result = await callAnalyze(planner, ai, {
        types: ['spectral', 'diff'],
        snapshotId: 'snap-a',
        compareSnapshotId: 'snap-b',
      });

      // diff should error
      const errors = result.errors as string[];
      expect(errors.some(e => e.includes('mismatched scope'))).toBe(true);

      // spectral should still succeed
      const results = result.results as Record<string, unknown>;
      expect(results.spectral).toBeDefined();
      expect(results.diff).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // #1231 — masking rejects duplicate trackIds
  // -------------------------------------------------------------------------

  describe('masking duplicate trackId validation (#1231)', () => {
    it('returns error when masking snapshots have duplicate trackIds', async () => {
      const snap1 = makeSilentSnapshot({ id: 'snap-1', scope: ['track-1'], bars: 2 });
      const snap2 = makeSilentSnapshot({ id: 'snap-2', scope: ['track-1'], bars: 2 });
      storeSnapshot(snap1);
      storeSnapshot(snap2);

      const result = await callAnalyze(planner, ai, {
        types: ['masking'],
        snapshotIds: ['snap-1', 'snap-2'],
      });

      const errors = result.errors as string[] | undefined;
      expect(errors).toBeDefined();
      expect(errors!.some(e => e.includes('duplicate snapshots for track'))).toBe(true);
      expect((result.results as Record<string, unknown>).masking).toBeUndefined();
    });

    it('allows masking when all trackIds are unique', async () => {
      const snap1 = makeSilentSnapshot({ id: 'snap-1', scope: ['track-1'], bars: 2 });
      const snap2 = makeSilentSnapshot({ id: 'snap-2', scope: ['track-2'], bars: 2 });
      storeSnapshot(snap1);
      storeSnapshot(snap2);

      const result = await callAnalyze(planner, ai, {
        types: ['masking'],
        snapshotIds: ['snap-1', 'snap-2'],
      });

      // Should succeed — no duplicate error
      const errors = result.errors as string[] | undefined;
      const hasDupError = errors?.some(e => e.includes('duplicate snapshots'));
      expect(hasDupError ?? false).toBe(false);
      expect((result.results as Record<string, unknown>).masking).toBeDefined();
    });

    it('masking duplicate error does not block other analysis types', async () => {
      const primarySnap = makeSilentSnapshot({ id: 'snap-primary', scope: ['track-1'], bars: 2 });
      const dup1 = makeSilentSnapshot({ id: 'snap-dup1', scope: ['track-1'], bars: 2 });
      const dup2 = makeSilentSnapshot({ id: 'snap-dup2', scope: ['track-1'], bars: 2 });
      storeSnapshot(primarySnap);
      storeSnapshot(dup1);
      storeSnapshot(dup2);

      const result = await callAnalyze(planner, ai, {
        types: ['spectral', 'masking'],
        snapshotId: 'snap-primary',
        snapshotIds: ['snap-dup1', 'snap-dup2'],
      });

      // masking should error
      const errors = result.errors as string[];
      expect(errors.some(e => e.includes('duplicate snapshots'))).toBe(true);

      // spectral should still succeed
      const results = result.results as Record<string, unknown>;
      expect(results.spectral).toBeDefined();
      expect(results.masking).toBeUndefined();
    });
  });
});
