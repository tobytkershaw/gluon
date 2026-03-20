import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GluonAI } from '../../src/ai/api';
import { createSession, addTrack } from '../../src/engine/session';
import { clearSnapshots, storeSnapshot } from '../../src/audio/snapshot-store';
import type {
  FunctionResponse,
  GenerateResult,
  ListenerProvider,
  NeutralFunctionCall,
  PlannerProvider,
  ToolSchema,
} from '../../src/ai/types';
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

async function callTool(
  ai: GluonAI,
  planner: ReturnType<typeof createMockPlanner>,
  session: Session,
  toolName: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const callId = `${toolName}-call`;
  const fc: NeutralFunctionCall = { id: callId, name: toolName, args };
  planner.startTurnResults.push({ textParts: [], functionCalls: [fc] });
  planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

  await ai.ask(session, 'test');

  const response = planner.lastFunctionResponses.find(r => r.id === callId);
  return (response?.result ?? {}) as Record<string, unknown>;
}

describe('Snapshot compatibility contract', () => {
  let planner: ReturnType<typeof createMockPlanner>;
  let listener: ReturnType<typeof createMockListener>;
  let ai: GluonAI;

  beforeEach(() => {
    planner = createMockPlanner();
    listener = createMockListener();
    ai = new GluonAI(planner, listener);
    clearSnapshots();
  });

  it('rejects diff analysis when before/after snapshots have different scope', async () => {
    const session = createSession();
    const secondSession = addTrack(session, 'audio');
    const secondTrackId = secondSession.tracks.find(track => track.id !== session.tracks[0].id && track.id !== 'master-bus')!.id;

    storeSnapshot({
      id: 'before',
      pcm: new Float32Array(128),
      sampleRate: 44100,
      scope: [session.tracks[0].id],
      bars: 2,
    });
    storeSnapshot({
      id: 'after',
      pcm: new Float32Array(128),
      sampleRate: 44100,
      scope: [secondTrackId],
      bars: 2,
    });

    const response = await callTool(ai, planner, secondSession, 'analyze', {
      snapshotId: 'after',
      compareSnapshotId: 'before',
      types: ['diff'],
    });

    expect(response.errors).toContain('Diff analysis requires snapshots with the same render scope. Got after=v1 and before=v0.');
  });

  it('returns compatible analysis types even when diff compatibility fails', async () => {
    storeSnapshot({
      id: 'after',
      pcm: new Float32Array([0, 0.2, -0.2, 0]),
      sampleRate: 44100,
      scope: ['v0'],
      bars: 2,
    });
    storeSnapshot({
      id: 'before',
      pcm: new Float32Array([0, 0.1, -0.1, 0]),
      sampleRate: 44100,
      scope: ['v1'],
      bars: 2,
    });

    const response = await callTool(ai, planner, createSession(), 'analyze', {
      snapshotId: 'after',
      compareSnapshotId: 'before',
      types: ['spectral', 'diff'],
    });

    expect(response.results).toHaveProperty('spectral');
    expect(response.results).not.toHaveProperty('diff');
    expect(response.errors).toContain('Diff analysis requires snapshots with the same render scope. Got after=v0 and before=v1.');
  });

  it('rejects diff analysis when before/after snapshots have different bar counts', async () => {
    const session = createSession();
    const trackId = session.tracks[0].id;

    storeSnapshot({
      id: 'before',
      pcm: new Float32Array(128),
      sampleRate: 44100,
      scope: [trackId],
      bars: 2,
    });
    storeSnapshot({
      id: 'after',
      pcm: new Float32Array(128),
      sampleRate: 44100,
      scope: [trackId],
      bars: 4,
    });

    const response = await callTool(ai, planner, session, 'analyze', {
      snapshotId: 'after',
      compareSnapshotId: 'before',
      types: ['diff'],
    });

    expect(response.errors).toContain('Diff analysis requires snapshots rendered for the same number of bars. Got after=4, before=2.');
  });

  it('does not produce masking results when duplicate snapshots target the same track', async () => {
    const session = createSession();
    const trackId = session.tracks[0].id;

    storeSnapshot({
      id: 'snap-1',
      pcm: new Float32Array(128),
      sampleRate: 44100,
      scope: [trackId],
      bars: 2,
    });
    storeSnapshot({
      id: 'snap-2',
      pcm: new Float32Array(128),
      sampleRate: 44100,
      scope: [trackId],
      bars: 2,
    });

    const response = await callTool(ai, planner, session, 'analyze', {
      snapshotIds: ['snap-1', 'snap-2'],
      types: ['masking'],
    });

    expect(response.results).toEqual({});
    expect(response.errors).toContain(`Masking analysis requires snapshots for different tracks. Duplicate track scope: ${trackId}.`);
  });
});
