import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GluonAI } from '../../src/ai/api';
import { createSession, addTrack } from '../../src/engine/session';
import type {
  FunctionResponse,
  GenerateResult,
  ListenerProvider,
  NeutralFunctionCall,
  PlannerProvider,
  ToolSchema,
} from '../../src/ai/types';
import type { Session } from '../../src/engine/types';
import type { PcmRenderResult } from '../../src/audio/render-offline';

function createMockPlanner(): PlannerProvider & {
  startTurnResults: GenerateResult[];
  continueTurnResults: GenerateResult[];
  lastFunctionResponses: FunctionResponse[];
  userMessages: string[];
  clearCalls: number;
} {
  const planner = {
    name: 'mock',
    startTurnResults: [] as GenerateResult[],
    continueTurnResults: [] as GenerateResult[],
    lastFunctionResponses: [] as FunctionResponse[],
    userMessages: [] as string[],
    clearCalls: 0,

    isConfigured: () => true,

    startTurn: vi.fn(async (opts: { systemPrompt: string; userMessage: string; tools: ToolSchema[] }): Promise<GenerateResult> => {
      planner.userMessages.push(opts.userMessage);
      return planner.startTurnResults.shift() ?? { textParts: [], functionCalls: [] };
    }),

    continueTurn: vi.fn(async (opts: { systemPrompt: string; tools: ToolSchema[]; functionResponses: FunctionResponse[] }): Promise<GenerateResult> => {
      planner.lastFunctionResponses = opts.functionResponses;
      return planner.continueTurnResults.shift() ?? { textParts: [], functionCalls: [] };
    }),

    commitTurn: vi.fn(() => {}),
    discardTurn: vi.fn(() => {}),
    trimHistory: vi.fn((_n: number) => {}),
    clearHistory: vi.fn(() => { planner.clearCalls++; }),
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
  ctx?: {
    listen?: {
      renderOffline?: (session: Session, trackIds?: string[], bars?: number) => Promise<Blob>;
      renderOfflinePcm?: (session: Session, trackIds?: string[], bars?: number) => Promise<PcmRenderResult>;
    };
  },
): Promise<Record<string, unknown>> {
  const callId = `${toolName}-call`;
  const fc: NeutralFunctionCall = { id: callId, name: toolName, args };
  planner.startTurnResults.push({ textParts: [], functionCalls: [fc] });
  planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

  await ai.ask(session, 'test', ctx);

  const response = planner.lastFunctionResponses.find(r => r.id === callId);
  return (response?.result ?? {}) as Record<string, unknown>;
}

describe('Project boundary contract: GluonAI project-scoped state', () => {
  let planner: ReturnType<typeof createMockPlanner>;
  let listener: ReturnType<typeof createMockListener>;
  let ai: GluonAI;

  beforeEach(() => {
    planner = createMockPlanner();
    listener = createMockListener();
    ai = new GluonAI(planner, listener);
  });

  it('clearHistory resets the spectral slot registry', async () => {
    let session = createSession();
    session = addTrack(session, 'audio');

    const firstTrackId = session.tracks[0].id;
    const candidateTrackIds = session.tracks
      .filter(track => track.id !== 'master-bus')
      .map(track => track.id);
    expect(candidateTrackIds.length).toBeGreaterThanOrEqual(2);
    const secondTrackId = candidateTrackIds.find(trackId => trackId !== firstTrackId);
    expect(secondTrackId).toBeDefined();

    const firstResponse = await callTool(ai, planner, session, 'assign_spectral_slot', {
      trackId: firstTrackId,
      bands: ['sub'],
      priority: 8,
    });
    expect(firstResponse.allSlots).toHaveLength(1);

    ai.clearHistory();

    const secondResponse = await callTool(ai, planner, session, 'assign_spectral_slot', {
      trackId: secondTrackId as string,
      bands: ['sub'],
      priority: 8,
    });

    expect(planner.clearCalls).toBe(1);
    expect(secondResponse.allSlots).toEqual([
      expect.objectContaining({ trackId: secondTrackId as string, primaryBands: ['sub'], priority: 8 }),
    ]);
    expect(secondResponse.collisions).toBeUndefined();
  });

  it('clearHistory resets the motif library', async () => {
    const session = createSession();
    session.tracks[0].patterns[0].events = [{ kind: 'trigger', at: 0, velocity: 1 }];

    const registerResponse = await callTool(ai, planner, session, 'manage_motif', {
      action: 'register',
      name: 'Pulse',
      trackId: session.tracks[0].id,
    });
    expect(registerResponse.applied).toBe(true);

    ai.clearHistory();

    const listResponse = await callTool(ai, planner, session, 'manage_motif', {
      action: 'list',
    });
    expect(listResponse.count).toBe(0);
    expect(listResponse.motifs).toEqual([]);
  });

  it('clearHistory clears turn-scoped snapshots by clearing the snapshot store', async () => {
    const session = createSession();
    const renderResponse = await callTool(
      ai,
      planner,
      session,
      'render',
      { bars: 2 },
      {
        listen: {
          renderOfflinePcm: vi.fn(async () => ({
            pcm: new Float32Array(128),
            sampleRate: 44100,
          })),
        },
      },
    );

    const snapshotId = renderResponse.snapshotId as string;
    expect(typeof snapshotId).toBe('string');

    ai.clearHistory();

    const analyzeResponse = await callTool(ai, planner, session, 'analyze', {
      snapshotId,
      types: ['spectral'],
    });
    expect(analyzeResponse.error).toContain(`Snapshot not found: ${snapshotId}`);
  });

  it('clearHistory clears recent auto diff summaries from subsequent turn state', async () => {
    const session = createSession();
    const trackId = session.tracks[0].id;

    const renderOfflinePcm = vi.fn(async (): Promise<PcmRenderResult> => {
      const pcm = new Float32Array(4410);
      for (let i = 0; i < pcm.length; i++) pcm[i] = 0.2 * Math.sin(2 * Math.PI * 220 * i / 44100);
      return { pcm, sampleRate: 44100 };
    });

    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{
        id: 'sk1',
        name: 'sketch',
        args: {
          trackId,
          description: 'simple pulse',
          events: [{ kind: 'trigger', at: 0, velocity: 1 }],
        },
      }],
    });
    planner.continueTurnResults.push({ textParts: ['Done.'], functionCalls: [] });
    await ai.ask(session, 'make it pulse', {
      listen: {
        renderOffline: vi.fn(async () => new Blob()),
        renderOfflinePcm,
      },
    });

    ai.clearHistory();

    planner.startTurnResults.push({ textParts: ['ok'], functionCalls: [] });
    await ai.ask(session, 'what changed?');

    expect(planner.userMessages.at(-1)).not.toContain('"recentAutoDiffs"');
  });
});
