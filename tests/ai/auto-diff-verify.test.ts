// tests/ai/auto-diff-verify.test.ts — Tests for auto-diff verification on sketch and edit_pattern tools.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GluonAI } from '../../src/ai/api';
import type { PlannerProvider, ListenerProvider, GenerateResult, FunctionResponse, ToolSchema } from '../../src/ai/types';
import { createSession, addTrack } from '../../src/engine/session';
import type { Session } from '../../src/engine/types';
import type { PcmRenderResult } from '../../src/audio/render-offline';

// ---------------------------------------------------------------------------
// Mock planner: captures function responses for inspection
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
 * Create a mock renderOfflinePcm that returns distinct PCM buffers
 * based on session state (different events = different audio).
 */
function createMockRenderPcm() {
  let callCount = 0;
  return vi.fn(async (_session: Session, _trackIds?: string[], _bars?: number): Promise<PcmRenderResult> => {
    callCount++;
    // Return different PCM for before vs after to produce a non-trivial diff.
    // "Before" (1st call) has low amplitude, "After" (2nd call) has higher.
    const length = 4410; // ~0.1s at 44100Hz
    const pcm = new Float32Array(length);
    const amplitude = callCount % 2 === 1 ? 0.1 : 0.5;
    for (let i = 0; i < length; i++) {
      pcm[i] = amplitude * Math.sin(2 * Math.PI * 440 * i / 44100);
    }
    return { pcm, sampleRate: 44100 };
  });
}

function buildSession(): Session {
  let session = createSession();
  session = addTrack(session, 'audio');
  // Add an event so sketch has content to diff against
  const track = session.tracks[0];
  track.patterns[0].events = [
    { kind: 'trigger', at: 0, velocity: 1.0 },
    { kind: 'trigger', at: 4, velocity: 0.8 },
  ];
  // Enable agency
  track.agency = 'on';
  return session;
}

describe('Auto-diff verification', () => {
  let planner: ReturnType<typeof createMockPlanner>;
  let listener: ReturnType<typeof createMockListener>;
  let ai: GluonAI;
  let mockRenderPcm: ReturnType<typeof createMockRenderPcm>;

  beforeEach(() => {
    planner = createMockPlanner();
    listener = createMockListener();
    ai = new GluonAI(planner, listener);
    mockRenderPcm = createMockRenderPcm();
  });

  // -----------------------------------------------------------------------
  // sketch tool with verify
  // -----------------------------------------------------------------------

  it('sketch with verify=true includes verification in response', async () => {
    const session = buildSession();
    const trackId = session.tracks[0].id;

    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{
        id: 'test-sketch',
        name: 'sketch',
        args: {
          trackId,
          description: 'four on the floor',
          events: [
            { kind: 'trigger', at: 0, velocity: 1.0 },
            { kind: 'trigger', at: 4, velocity: 1.0 },
            { kind: 'trigger', at: 8, velocity: 1.0 },
            { kind: 'trigger', at: 12, velocity: 1.0 },
          ],
          verify: true,
        },
      }],
    });
    planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

    await ai.ask(session, 'make a four on the floor', {
      listen: {
        renderOffline: vi.fn(async () => new Blob()),
        renderOfflinePcm: mockRenderPcm,
      },
    });

    const responses = planner.lastFunctionResponses;
    expect(responses.length).toBe(1);

    const result = responses[0].result as Record<string, unknown>;
    expect(result.applied).toBe(true);
    expect(result.verification).toBeDefined();

    const verification = result.verification as { summary: string; confidence: number };
    expect(typeof verification.summary).toBe('string');
    expect(typeof verification.confidence).toBe('number');
    expect(verification.confidence).toBeGreaterThan(0);

    // renderOfflinePcm called 4 times: 2 from verify (before + after) + 2 from auto-diff
    expect(mockRenderPcm).toHaveBeenCalledTimes(4);
  });

  it('sketch with verify=false does NOT include verification', async () => {
    const session = buildSession();
    const trackId = session.tracks[0].id;

    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{
        id: 'test-sketch',
        name: 'sketch',
        args: {
          trackId,
          description: 'basic kick',
          events: [{ kind: 'trigger', at: 0, velocity: 1.0 }],
          verify: false,
        },
      }],
    });
    planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

    await ai.ask(session, 'test', {
      listen: {
        renderOffline: vi.fn(async () => new Blob()),
        renderOfflinePcm: mockRenderPcm,
      },
    });

    const result = planner.lastFunctionResponses[0].result as Record<string, unknown>;
    expect(result.applied).toBe(true);
    expect(result.verification).toBeUndefined();
    // Auto-diff still runs (before + after), but verify is not included in response
    expect(mockRenderPcm).toHaveBeenCalledTimes(2);
  });

  it('sketch without verify param does NOT include verification (opt-in)', async () => {
    const session = buildSession();
    const trackId = session.tracks[0].id;

    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{
        id: 'test-sketch',
        name: 'sketch',
        args: {
          trackId,
          description: 'basic kick',
          events: [{ kind: 'trigger', at: 0, velocity: 1.0 }],
        },
      }],
    });
    planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

    await ai.ask(session, 'test', {
      listen: {
        renderOffline: vi.fn(async () => new Blob()),
        renderOfflinePcm: mockRenderPcm,
      },
    });

    const result = planner.lastFunctionResponses[0].result as Record<string, unknown>;
    expect(result.applied).toBe(true);
    expect(result.verification).toBeUndefined();
    // Auto-diff still runs (before + after)
    expect(mockRenderPcm).toHaveBeenCalledTimes(2);
  });

  it('sketch with verify=true gracefully handles missing renderOfflinePcm', async () => {
    const session = buildSession();
    const trackId = session.tracks[0].id;

    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{
        id: 'test-sketch',
        name: 'sketch',
        args: {
          trackId,
          description: 'test',
          events: [{ kind: 'trigger', at: 0, velocity: 1.0 }],
          verify: true,
        },
      }],
    });
    planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

    // No listen context at all
    await ai.ask(session, 'test');

    const result = planner.lastFunctionResponses[0].result as Record<string, unknown>;
    expect(result.applied).toBe(true);
    // Should succeed without verification when render is unavailable
    expect(result.verification).toBeUndefined();
  });

  it('sketch with verify=true gracefully handles render failure', async () => {
    const session = buildSession();
    const trackId = session.tracks[0].id;

    const failingRender = vi.fn(async (): Promise<PcmRenderResult> => {
      throw new Error('WASM not loaded');
    });

    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{
        id: 'test-sketch',
        name: 'sketch',
        args: {
          trackId,
          description: 'test',
          events: [{ kind: 'trigger', at: 0, velocity: 1.0 }],
          verify: true,
        },
      }],
    });
    planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

    await ai.ask(session, 'test', {
      listen: {
        renderOffline: vi.fn(async () => new Blob()),
        renderOfflinePcm: failingRender,
      },
    });

    const result = planner.lastFunctionResponses[0].result as Record<string, unknown>;
    expect(result.applied).toBe(true);
    // Should succeed without verification when render throws
    expect(result.verification).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // edit_pattern tool with verify
  // -----------------------------------------------------------------------

  it('edit_pattern with verify=true includes verification in response', async () => {
    const session = buildSession();
    const trackId = session.tracks[0].id;

    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{
        id: 'test-edit',
        name: 'edit_pattern',
        args: {
          trackId,
          description: 'add ghost hit',
          operations: [
            { action: 'add', step: 2, event: { type: 'trigger', velocity: 0.3 } },
          ],
          verify: true,
        },
      }],
    });
    planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

    await ai.ask(session, 'add a ghost hit', {
      listen: {
        renderOffline: vi.fn(async () => new Blob()),
        renderOfflinePcm: mockRenderPcm,
      },
    });

    const responses = planner.lastFunctionResponses;
    expect(responses.length).toBe(1);

    const result = responses[0].result as Record<string, unknown>;
    expect(result.applied).toBe(true);
    expect(result.verification).toBeDefined();

    const verification = result.verification as { summary: string; confidence: number };
    expect(typeof verification.summary).toBe('string');
    expect(typeof verification.confidence).toBe('number');

    // renderOfflinePcm called 4 times: 2 from verify (before + after) + 2 from auto-diff
    expect(mockRenderPcm).toHaveBeenCalledTimes(4);
  });

  it('edit_pattern without verify does NOT include verification', async () => {
    const session = buildSession();
    const trackId = session.tracks[0].id;

    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{
        id: 'test-edit',
        name: 'edit_pattern',
        args: {
          trackId,
          description: 'add ghost hit',
          operations: [
            { action: 'add', step: 2, event: { type: 'trigger', velocity: 0.3 } },
          ],
        },
      }],
    });
    planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

    await ai.ask(session, 'test', {
      listen: {
        renderOffline: vi.fn(async () => new Blob()),
        renderOfflinePcm: mockRenderPcm,
      },
    });

    const result = planner.lastFunctionResponses[0].result as Record<string, unknown>;
    expect(result.applied).toBe(true);
    expect(result.verification).toBeUndefined();
    // Auto-diff still runs (before + after)
    expect(mockRenderPcm).toHaveBeenCalledTimes(2);
  });
});
