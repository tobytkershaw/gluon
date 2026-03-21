// tests/ai/tool-handlers-silent-failures.test.ts
//
// Tests verifying that AI tool handlers produce visible warnings/errors
// instead of silently failing. Covers #1416.

import { describe, it, expect, vi } from 'vitest';
import { GluonAI } from '../../src/ai/api';
import type { PlannerProvider, ListenerProvider, GenerateResult, FunctionResponse, ToolSchema, NeutralFunctionCall } from '../../src/ai/types';
import type { Session } from '../../src/engine/types';
import { createSession } from '../../src/engine/session';

// ---------------------------------------------------------------------------
// Test infrastructure (copied from tool-handlers-adversarial)
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
): Promise<{ actions: unknown[]; response: Record<string, unknown> }> {
  const fc: NeutralFunctionCall = { id: 'test-call-1', name: toolName, args };
  const planner = createMockPlanner([fc]);
  const listener = createMockListener();
  const ai = new GluonAI(planner, listener);
  const actions = await ai.ask(session, 'test');

  const continueMock = planner.continueTurn as ReturnType<typeof vi.fn>;
  const callArgs = continueMock.mock.calls[0];
  const funcResponses: FunctionResponse[] = callArgs?.[0]?.functionResponses ?? [];
  const resp = funcResponses.find(r => r.id === 'test-call-1');
  const toolActions = actions.filter(a => a.type !== 'say');

  return {
    actions: toolActions,
    response: (resp?.result ?? {}) as Record<string, unknown>,
  };
}

function makeSession(): Session {
  return createSession();
}

function makeRichSession(): Session {
  const session = makeSession();
  const track = session.tracks[0];
  track.processors = [
    { id: 'clouds-1', type: 'clouds', model: 0, params: { position: 0.5, size: 0.5, density: 0.5, texture: 0.5 } },
  ];
  track.modulators = [
    { id: 'tides-1', type: 'tides', model: 1, params: { frequency: 0.3, shape: 0.5 } },
  ];
  track.modulations = [
    { id: 'mod-1', modulatorId: 'tides-1', target: { kind: 'source', param: 'timbre' }, depth: 0.5 },
  ];
  return session;
}

function makeDrumRackSession(): Session {
  const session = makeSession();
  const track = session.tracks[0];
  track.engine = 'drum-rack' as Session['tracks'][0]['engine'];
  (track as Record<string, unknown>).model = -1;
  (track as Record<string, unknown>).drumRack = {
    pads: [
      { id: 'kick', name: 'Kick', source: { engine: 'plaits', model: 13, params: { frequency: 0.25 } }, level: 0.8, pan: 0.0 },
      { id: 'snare', name: 'Snare', source: { engine: 'plaits', model: 14, params: { frequency: 0.38 } }, level: 0.8, pan: 0.0 },
    ],
  };
  return session;
}

// ---------------------------------------------------------------------------
// move — silent failure prevention
// ---------------------------------------------------------------------------

describe('move — silent failure prevention (#1416)', () => {
  it('returns error when processorId does not exist on track', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'move', {
      param: 'timbre',
      target: { absolute: 0.5 },
      trackId: session.tracks[0].id,
      processorId: 'ghost-proc',
    });
    expect(actions).toHaveLength(0);
    expect(response.error).toBeDefined();
    expect(response.error).toContain('ghost-proc');
    expect(response.error).toContain('not found');
  });

  it('returns error when modulatorId does not exist on track', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'move', {
      param: 'frequency',
      target: { absolute: 0.5 },
      trackId: session.tracks[0].id,
      modulatorId: 'ghost-mod',
    });
    expect(actions).toHaveLength(0);
    expect(response.error).toBeDefined();
    expect(response.error).toContain('ghost-mod');
    expect(response.error).toContain('not found');
  });

  it('includes available IDs in error when processorId is wrong', async () => {
    const session = makeRichSession();
    const { response } = await callTool(session, 'move', {
      param: 'position',
      target: { absolute: 0.7 },
      trackId: session.tracks[0].id,
      processorId: 'wrong-id',
    });
    expect(response.error).toContain('wrong-id');
    expect(response.available).toBeInstanceOf(Array);
    expect((response.available as string[]).some(a => a.includes('clouds-1'))).toBe(true);
  });

  it('includes available IDs in error when modulatorId is wrong', async () => {
    const session = makeRichSession();
    const { response } = await callTool(session, 'move', {
      param: 'frequency',
      target: { absolute: 0.7 },
      trackId: session.tracks[0].id,
      modulatorId: 'wrong-id',
    });
    expect(response.error).toContain('wrong-id');
    expect(response.available).toBeInstanceOf(Array);
    expect((response.available as string[]).some(a => a === 'tides-1')).toBe(true);
  });

  it('succeeds with valid processorId and includes no warnings', async () => {
    const session = makeRichSession();
    const { response, actions } = await callTool(session, 'move', {
      param: 'position',
      target: { absolute: 0.7 },
      trackId: session.tracks[0].id,
      processorId: 'clouds-1',
    });
    expect(actions).toHaveLength(1);
    expect(response.applied).toBe(true);
    expect(response.warnings).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// set_model — silent failure prevention
// ---------------------------------------------------------------------------

describe('set_model — silent failure prevention (#1416)', () => {
  it('returns error for unknown engine model name', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'set_model', {
      trackId: session.tracks[0].id,
      model: 'not-a-real-engine',
    });
    expect(actions).toHaveLength(0);
    expect(response.error).toBeDefined();
    expect(response.error).toContain('not-a-real-engine');
    expect(response.available).toBeInstanceOf(Array);
  });

  it('returns error when processorId does not exist', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'set_model', {
      trackId: session.tracks[0].id,
      model: 'virtual-analog',
      processorId: 'nonexistent-proc',
    });
    expect(actions).toHaveLength(0);
    expect(response.error).toBeDefined();
    expect(response.error).toContain('nonexistent-proc');
    expect(response.error).toContain('not found');
  });

  it('returns error when modulatorId does not exist', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'set_model', {
      trackId: session.tracks[0].id,
      model: 'virtual-analog',
      modulatorId: 'nonexistent-mod',
    });
    expect(actions).toHaveLength(0);
    expect(response.error).toBeDefined();
    expect(response.error).toContain('nonexistent-mod');
    expect(response.error).toContain('not found');
  });

  it('succeeds with valid engine model name', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'set_model', {
      trackId: session.tracks[0].id,
      model: 'virtual-analog',
    });
    expect(actions).toHaveLength(1);
    expect(response.queued).toBe(true);
    expect(response.availableParams).toBeInstanceOf(Array);
  });
});

// ---------------------------------------------------------------------------
// sketch — silent failure prevention
// ---------------------------------------------------------------------------

describe('sketch — silent failure prevention (#1416)', () => {
  it('warns when an invalid groove name is provided', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'sketch', {
      trackId: session.tracks[0].id,
      description: 'test pattern',
      events: [{ kind: 'note', at: 0, note: 60, velocity: 0.8, duration: 1 }],
      groove: 'nonexistent-groove',
    });
    expect(actions).toHaveLength(1);
    expect(response.applied).toBe(true);
    expect(response.warnings).toBeDefined();
    expect(response.warnings).toBeInstanceOf(Array);
    expect((response.warnings as string[]).some(w => w.includes('nonexistent-groove'))).toBe(true);
  });

  it('does not warn when a valid groove is provided', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'sketch', {
      trackId: session.tracks[0].id,
      description: 'test pattern',
      events: [{ kind: 'note', at: 0, note: 60, velocity: 0.8, duration: 1 }],
      groove: 'mpc_swing',
    });
    expect(actions).toHaveLength(1);
    expect(response.applied).toBe(true);
    expect(response.warnings).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// manage_drum_pad — silent failure prevention
// ---------------------------------------------------------------------------

describe('manage_drum_pad — silent failure prevention (#1416)', () => {
  it('returns error for unknown pad model on add', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'manage_drum_pad', {
      trackId: session.tracks[0].id,
      action: 'add',
      padId: 'kick',
      model: 'fake-engine-model',
      description: 'add kick',
    });
    expect(actions).toHaveLength(0);
    expect(response.error).toBeDefined();
    expect(response.error).toContain('fake-engine-model');
    expect(response.available).toBeInstanceOf(Array);
  });

  it('warns when pad params contain invalid control IDs', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'manage_drum_pad', {
      trackId: session.tracks[0].id,
      action: 'add',
      padId: 'kick',
      model: 'analog-bass-drum',
      params: { frequency: 0.25, portamento_leak: 0.5 },
      description: 'add kick with bad param',
    });
    // Should still create the action but warn about invalid param
    expect(response.applied).toBe(true);
    expect(response.warnings).toBeDefined();
    expect((response.warnings as string[]).some(w => w.includes('portamento_leak'))).toBe(true);
  });

  it('returns error when renaming a non-existent pad', async () => {
    const session = makeDrumRackSession();
    const { response, actions } = await callTool(session, 'manage_drum_pad', {
      trackId: session.tracks[0].id,
      action: 'rename',
      padId: 'ghost-pad',
      name: 'New Name',
      description: 'rename ghost pad',
    });
    expect(actions).toHaveLength(0);
    expect(response.error).toBeDefined();
    expect(response.error).toContain('ghost-pad');
    expect(response.error).toContain('not found');
    expect(response.available).toBeInstanceOf(Array);
  });

  it('returns error when removing a non-existent pad', async () => {
    const session = makeDrumRackSession();
    const { response, actions } = await callTool(session, 'manage_drum_pad', {
      trackId: session.tracks[0].id,
      action: 'remove',
      padId: 'ghost-pad',
      description: 'remove ghost pad',
    });
    expect(actions).toHaveLength(0);
    expect(response.error).toBeDefined();
    expect(response.error).toContain('ghost-pad');
  });

  it('succeeds with valid pad rename', async () => {
    const session = makeDrumRackSession();
    const { response, actions } = await callTool(session, 'manage_drum_pad', {
      trackId: session.tracks[0].id,
      action: 'rename',
      padId: 'kick',
      name: 'Deep Kick',
      description: 'rename kick',
    });
    expect(actions).toHaveLength(1);
    expect(response.applied).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// manage_processor — silent failure prevention
// ---------------------------------------------------------------------------

describe('manage_processor — silent failure prevention (#1416)', () => {
  it('returns error when removing a non-existent processor', async () => {
    const session = makeRichSession();
    const { response, actions } = await callTool(session, 'manage_processor', {
      action: 'remove',
      trackId: session.tracks[0].id,
      processorId: 'nonexistent-proc',
      description: 'remove test',
    });
    expect(actions).toHaveLength(0);
    expect(response.error).toContain('nonexistent-proc');
    expect(response.error).toContain('not found');
    expect(response.available).toBeInstanceOf(Array);
  });

  it('returns error when replacing a non-existent processor', async () => {
    const session = makeRichSession();
    const { response, actions } = await callTool(session, 'manage_processor', {
      action: 'replace',
      trackId: session.tracks[0].id,
      processorId: 'nonexistent-proc',
      moduleType: 'clouds',
      description: 'replace test',
    });
    expect(actions).toHaveLength(0);
    expect(response.error).toContain('nonexistent-proc');
    expect(response.error).toContain('not found');
  });

  it('returns error when bypassing a non-existent processor', async () => {
    const session = makeRichSession();
    const { response, actions } = await callTool(session, 'manage_processor', {
      action: 'bypass',
      trackId: session.tracks[0].id,
      processorId: 'nonexistent-proc',
      description: 'bypass test',
    });
    expect(actions).toHaveLength(0);
    expect(response.error).toContain('nonexistent-proc');
    expect(response.error).toContain('not found');
  });

  it('succeeds when removing an existing processor', async () => {
    const session = makeRichSession();
    const { response, actions } = await callTool(session, 'manage_processor', {
      action: 'remove',
      trackId: session.tracks[0].id,
      processorId: 'clouds-1',
      description: 'remove clouds',
    });
    expect(actions).toHaveLength(1);
    expect(response.applied).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// manage_modulator — silent failure prevention
// ---------------------------------------------------------------------------

describe('manage_modulator — silent failure prevention (#1416)', () => {
  it('returns error when removing a non-existent modulator', async () => {
    const session = makeRichSession();
    const { response, actions } = await callTool(session, 'manage_modulator', {
      action: 'remove',
      trackId: session.tracks[0].id,
      modulatorId: 'nonexistent-mod',
      description: 'remove test',
    });
    expect(actions).toHaveLength(0);
    expect(response.error).toContain('nonexistent-mod');
    expect(response.error).toContain('not found');
    expect(response.available).toBeInstanceOf(Array);
  });

  it('succeeds when removing an existing modulator', async () => {
    const session = makeRichSession();
    const { response, actions } = await callTool(session, 'manage_modulator', {
      action: 'remove',
      trackId: session.tracks[0].id,
      modulatorId: 'tides-1',
      description: 'remove tides',
    });
    expect(actions).toHaveLength(1);
    expect(response.queued).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// modulation_route — silent failure prevention
// ---------------------------------------------------------------------------

describe('modulation_route — silent failure prevention (#1416)', () => {
  it('returns error when connecting with non-existent modulatorId', async () => {
    const session = makeRichSession();
    const { response, actions } = await callTool(session, 'modulation_route', {
      action: 'connect',
      trackId: session.tracks[0].id,
      modulatorId: 'ghost-mod',
      targetKind: 'source',
      targetParam: 'timbre',
      depth: 0.5,
      description: 'connect test',
    });
    expect(actions).toHaveLength(0);
    expect(response.error).toContain('ghost-mod');
    expect(response.error).toContain('not found');
  });

  it('returns error when connecting to non-existent processorId', async () => {
    const session = makeRichSession();
    const { response, actions } = await callTool(session, 'modulation_route', {
      action: 'connect',
      trackId: session.tracks[0].id,
      modulatorId: 'tides-1',
      targetKind: 'processor',
      targetParam: 'position',
      processorId: 'ghost-proc',
      depth: 0.5,
      description: 'connect to ghost proc',
    });
    expect(actions).toHaveLength(0);
    expect(response.error).toContain('ghost-proc');
    expect(response.error).toContain('not found');
  });

  it('returns error when disconnecting a non-existent modulation route', async () => {
    const session = makeRichSession();
    const { response, actions } = await callTool(session, 'modulation_route', {
      action: 'disconnect',
      trackId: session.tracks[0].id,
      modulationId: 'ghost-route',
      description: 'disconnect test',
    });
    expect(actions).toHaveLength(0);
    expect(response.error).toContain('ghost-route');
    expect(response.error).toContain('not found');
  });

  it('succeeds with valid modulatorId and target', async () => {
    const session = makeRichSession();
    const { response, actions } = await callTool(session, 'modulation_route', {
      action: 'connect',
      trackId: session.tracks[0].id,
      modulatorId: 'tides-1',
      targetKind: 'source',
      targetParam: 'morph',
      depth: 0.3,
      description: 'connect lfo to morph',
    });
    expect(actions).toHaveLength(1);
    expect(response.queued).toBe(true);
  });

  it('succeeds disconnecting an existing modulation route', async () => {
    const session = makeRichSession();
    const { response, actions } = await callTool(session, 'modulation_route', {
      action: 'disconnect',
      trackId: session.tracks[0].id,
      modulationId: 'mod-1',
      description: 'disconnect mod-1',
    });
    expect(actions).toHaveLength(1);
    expect(response.queued).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// set_surface — warnings for invalid bindings
// ---------------------------------------------------------------------------

describe('set_surface — silent failure prevention (#1416)', () => {
  it('includes warnings when region bindings reference non-existent pattern IDs', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'set_surface', {
      trackId: session.tracks[0].id,
      description: 'test surface',
      modules: [
        {
          type: 'step-grid',
          id: 'grid-1',
          label: 'Steps',
          bindings: [{ role: 'region', target: 'nonexistent-pattern-id' }],
        },
      ],
    });
    expect(actions).toHaveLength(1);
    expect(response.applied).toBe(true);
    expect(response.warnings).toBeDefined();
    expect((response.warnings as string[]).some(w => w.includes('nonexistent-pattern-id'))).toBe(true);
  });

  it('no warnings when bindings are valid', async () => {
    const session = makeSession();
    const patternId = session.tracks[0].patterns[0]?.id;
    const { response } = await callTool(session, 'set_surface', {
      trackId: session.tracks[0].id,
      description: 'test surface',
      modules: [
        {
          type: 'knob-group',
          id: 'knobs-1',
          label: 'Controls',
          bindings: [{ role: 'control', target: 'timbre' }],
        },
      ],
    });
    expect(response.applied).toBe(true);
    expect(response.warnings).toBeUndefined();
  });
});
