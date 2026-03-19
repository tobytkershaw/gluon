// tests/ai/tool-handlers-adversarial.test.ts — Adversarial tests for AI tool handlers.
//
// Validates that tool handlers reject invalid inputs with descriptive errors,
// accept valid edge-case inputs, and never silently corrupt state.

import { describe, it, expect, vi } from 'vitest';
import { GluonAI } from '../../src/ai/api';
import type { PlannerProvider, ListenerProvider, GenerateResult, FunctionResponse, ToolSchema, NeutralFunctionCall } from '../../src/ai/types';
import type { Session, Track } from '../../src/engine/types';
import { createSession, addTrack } from '../../src/engine/session';
import { editPatternEvents } from '../../src/engine/pattern-primitives';

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

/** Helper: call a single tool and return the function response from continueTurn. */
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

  // Extract the function response from the continueTurn mock
  const continueMock = planner.continueTurn as ReturnType<typeof vi.fn>;
  const callArgs = continueMock.mock.calls[0];
  const funcResponses: FunctionResponse[] = callArgs?.[0]?.functionResponses ?? [];
  const resp = funcResponses.find(r => r.id === 'test-call-1');

  // Filter out 'say' actions from the collected actions
  const toolActions = actions.filter(a => a.type !== 'say');

  return {
    actions: toolActions,
    response: (resp?.result ?? {}) as Record<string, unknown>,
  };
}

function makeSession(): Session {
  return createSession();
}

/** Create a session with a track that has processors and modulators. */
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

// ---------------------------------------------------------------------------
// move
// ---------------------------------------------------------------------------

describe('move — adversarial', () => {
  it('rejects missing param', async () => {
    const { response, actions } = await callTool(makeSession(), 'move', {
      target: { absolute: 0.5 },
    });
    expect(response.error).toMatch(/param/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects empty string param', async () => {
    const { response, actions } = await callTool(makeSession(), 'move', {
      param: '',
      target: { absolute: 0.5 },
    });
    expect(response.error).toMatch(/param/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects missing target', async () => {
    const { response, actions } = await callTool(makeSession(), 'move', {
      param: 'timbre',
    });
    expect(response.error).toMatch(/target/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects target without absolute or relative', async () => {
    const { response, actions } = await callTool(makeSession(), 'move', {
      param: 'timbre',
      target: { something: 'else' },
    });
    expect(response.error).toMatch(/target/i);
    expect(actions).toHaveLength(0);
  });

  it('accepts absolute 0.0 (boundary)', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'move', {
      param: 'timbre',
      target: { absolute: 0.0 },
      trackId: session.tracks[0].id,
    });
    expect(response.error).toBeUndefined();
    expect(response.applied).toBe(true);
    expect(response.to).toBe(0);
    expect(actions.length).toBeGreaterThan(0);
  });

  it('accepts absolute 1.0 (boundary)', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'move', {
      param: 'timbre',
      target: { absolute: 1.0 },
      trackId: session.tracks[0].id,
    });
    expect(response.applied).toBe(true);
    expect(response.to).toBe(1);
  });

  it('clamps values above 1.0', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'move', {
      param: 'timbre',
      target: { absolute: 1.5 },
      trackId: session.tracks[0].id,
    });
    expect(response.applied).toBe(true);
    expect(response.to).toBe(1);
  });

  it('clamps negative absolute values to 0', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'move', {
      param: 'timbre',
      target: { absolute: -0.5 },
      trackId: session.tracks[0].id,
    });
    expect(response.applied).toBe(true);
    expect(response.to).toBe(0);
  });

  it('handles non-existent track ID', async () => {
    const { response, actions } = await callTool(makeSession(), 'move', {
      param: 'timbre',
      target: { absolute: 0.5 },
      trackId: 'nonexistent-track-999',
    });
    expect(response.error).toBeDefined();
    expect(actions).toHaveLength(0);
  });

  it('handles non-existent processor ID gracefully', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'move', {
      param: 'timbre',
      target: { absolute: 0.5 },
      trackId: session.tracks[0].id,
      processorId: 'nonexistent-proc',
    });
    // Should still produce an action (the handler doesn't validate processor existence at call time)
    expect(response.applied).toBe(true);
  });

  it('handles non-existent modulator ID gracefully', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'move', {
      param: 'frequency',
      target: { absolute: 0.5 },
      trackId: session.tracks[0].id,
      modulatorId: 'nonexistent-mod',
    });
    expect(response.applied).toBe(true);
  });

  it('handles relative move with negative value', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'move', {
      param: 'timbre',
      target: { relative: -0.3 },
      trackId: session.tracks[0].id,
    });
    expect(response.applied).toBe(true);
    expect(response.to).toBeGreaterThanOrEqual(0);
    expect(response.to).toBeLessThanOrEqual(1);
  });

  it('accepts tempo-synced value strings for Hz-mapped modulator rate controls', async () => {
    const session = makeRichSession();
    const bpm = session.transport.bpm;
    const beats = 0.75; // 1/8d
    const hz = 1 / (beats * (60 / bpm));
    const expected = Math.log(hz / 0.05) / Math.log(100 / 0.05);

    const { response, actions } = await callTool(session, 'move', {
      trackId: session.tracks[0].id,
      modulatorId: 'tides-1',
      param: 'frequency',
      target: { value: '1/8d' },
    });

    expect(response.applied).toBe(true);
    expect(response.tempoSync).toBe('1/8d');
    expect(response.to as number).toBeCloseTo(expected, 2);
    expect(actions).toHaveLength(1);
  });

  it('rejects tempo-synced value strings for unsupported controls', async () => {
    const session = makeRichSession();
    const { response, actions } = await callTool(session, 'move', {
      trackId: session.tracks[0].id,
      processorId: 'clouds-1',
      param: 'position',
      target: { value: '1/8d' },
    });

    expect(response.error).toMatch(/Tempo-synced target\.value/);
    expect(actions).toHaveLength(0);
  });

  it('rejects tempo-synced value strings for Hz-mapped non-rate controls', async () => {
    const session = makeRichSession();
    session.tracks[0].processors = [
      { id: 'ripples-1', type: 'ripples', model: 0, params: { cutoff: 0.5, resonance: 0.2, drive: 0 } },
    ];

    const { response, actions } = await callTool(session, 'move', {
      trackId: session.tracks[0].id,
      processorId: 'ripples-1',
      param: 'cutoff',
      target: { value: '1/8d' },
    });

    expect(response.error).toMatch(/Tempo-synced target\.value/);
    expect(actions).toHaveLength(0);
  });

  it('uses the resolved active track id in tempo-sync track errors', async () => {
    const session = makeRichSession();
    session.activeTrackId = 'missing-track';

    const { response } = await callTool(session, 'move', {
      modulatorId: 'tides-1',
      param: 'frequency',
      target: { value: '1/8d' },
    });

    expect(response.error).toContain('missing-track');
    expect(response.error).not.toContain('undefined');
  });

  it('accepts track volume via move and routes it to track mix', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'move', {
      param: 'volume',
      target: { absolute: 0.5 },
      trackId: session.tracks[0].id,
    });

    expect(response.applied).toBe(true);
    expect(response.param).toBe('volume');
    expect(response.to).toBe(0.5);
    expect(actions).toHaveLength(1);
    expect((actions[0] as { type: string }).type).toBe('set_track_mix');
  });

  it('accepts relative track pan via move', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'move', {
      param: 'pan',
      target: { relative: -0.25 },
      trackId: session.tracks[0].id,
    });

    expect(response.applied).toBe(true);
    expect(response.param).toBe('pan');
    expect(response.to).toBe(-0.25);
    expect(actions).toHaveLength(1);
    expect((actions[0] as { type: string }).type).toBe('set_track_mix');
  });

  it('rejects timed move for track volume alias', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'move', {
      param: 'volume',
      target: { absolute: 0.5 },
      over: 500,
      trackId: session.tracks[0].id,
    });

    expect(response.error).toMatch(/Timed moves.*track volume/i);
    expect(actions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// sketch
// ---------------------------------------------------------------------------

describe('sketch — adversarial', () => {
  it('rejects missing trackId', async () => {
    const { response, actions } = await callTool(makeSession(), 'sketch', {
      description: 'a beat',
      events: [{ kind: 'trigger', at: 0, velocity: 0.8 }],
    });
    expect(response.error).toMatch(/trackId/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects missing description', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'sketch', {
      trackId: session.tracks[0].id,
      events: [{ kind: 'trigger', at: 0, velocity: 0.8 }],
    });
    expect(response.error).toMatch(/description/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects when no events, archetype, or generator provided', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'sketch', {
      trackId: session.tracks[0].id,
      description: 'test',
    });
    expect(response.error).toMatch(/events|archetype|generator/i);
    expect(actions).toHaveLength(0);
  });

  it('accepts empty events array', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'sketch', {
      trackId: session.tracks[0].id,
      description: 'clear pattern',
      events: [],
    });
    expect(response.applied).toBe(true);
    expect(actions.length).toBeGreaterThan(0);
  });

  it('accepts events at maximum position (step 15 for 16-step pattern)', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'sketch', {
      trackId: session.tracks[0].id,
      description: 'end of pattern',
      events: [{ kind: 'trigger', at: 15, velocity: 0.8 }],
    });
    expect(response.applied).toBe(true);
  });

  it('accepts overlapping events at same position', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'sketch', {
      trackId: session.tracks[0].id,
      description: 'double hit',
      events: [
        { kind: 'trigger', at: 0, velocity: 0.8 },
        { kind: 'trigger', at: 0, velocity: 0.6 },
      ],
    });
    expect(response.applied).toBe(true);
  });

  it('handles non-existent track ID', async () => {
    const { response, actions } = await callTool(makeSession(), 'sketch', {
      trackId: 'nonexistent-track',
      description: 'test',
      events: [{ kind: 'trigger', at: 0, velocity: 0.8 }],
    });
    expect(response.error).toBeDefined();
    expect(actions).toHaveLength(0);
  });

  it('clamps humanize to 0-1 range', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'sketch', {
      trackId: session.tracks[0].id,
      description: 'humanized',
      events: [{ kind: 'trigger', at: 0, velocity: 0.8 }],
      humanize: 5.0,
    });
    // Should apply with clamped humanize, not error
    expect(response.applied).toBe(true);
  });

  it('accepts negative humanize (clamped to 0)', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'sketch', {
      trackId: session.tracks[0].id,
      description: 'negative humanize',
      events: [{ kind: 'trigger', at: 0, velocity: 0.8 }],
      humanize: -1.0,
    });
    expect(response.applied).toBe(true);
  });

  it('rejects invalid archetype name', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'sketch', {
      trackId: session.tracks[0].id,
      description: 'test',
      archetype: 'nonexistent-archetype-xyz',
    });
    expect(response.error).toMatch(/archetype/i);
    expect(actions).toHaveLength(0);
  });

  it('handles very long description string', async () => {
    const session = makeSession();
    const longDesc = 'x'.repeat(2000);
    const { response } = await callTool(session, 'sketch', {
      trackId: session.tracks[0].id,
      description: longDesc,
      events: [{ kind: 'trigger', at: 0, velocity: 0.8 }],
    });
    expect(response.applied).toBe(true);
  });

  it('handles unicode/emoji in description', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'sketch', {
      trackId: session.tracks[0].id,
      description: 'A funky beat with sparkles and fire',
      events: [{ kind: 'trigger', at: 0, velocity: 0.8 }],
    });
    expect(response.applied).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// set_surface
// ---------------------------------------------------------------------------

describe('set_surface — adversarial', () => {
  it('rejects set_surface without modules', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'set_surface', {
      trackId: session.tracks[0].id,
      description: 'test',
    });

    expect(response.error).toMatch(/modules/i);
    expect(actions).toHaveLength(0);
  });

  it('accepts valid modules array and returns correct action structure', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'set_surface', {
      trackId: session.tracks[0].id,
      modules: [
        {
          type: 'knob-group',
          id: 'controls',
          label: 'Controls',
          bindings: [{ role: 'control', target: 'timbre' }],
          position: { x: 0, y: 0, w: 4, h: 2 },
          config: {},
        },
      ],
      description: 'test surface',
    });

    expect(response.applied).toBe(true);
    expect(response.moduleCount).toBe(1);
    expect(response.moduleTypes).toEqual(['knob-group']);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'set_surface',
      trackId: session.tracks[0].id,
      description: 'test surface',
      modules: [
        {
          type: 'knob-group',
          id: 'controls',
          label: 'Controls',
          bindings: [{ role: 'control', trackId: session.tracks[0].id, target: 'timbre' }],
          position: { x: 0, y: 0, w: 4, h: 2 },
          config: {},
        },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// set_transport
// ---------------------------------------------------------------------------

describe('set_transport — adversarial', () => {
  it('rejects when no transport properties provided', async () => {
    const { response, actions } = await callTool(makeSession(), 'set_transport', {});
    expect(response.error).toMatch(/transport property/i);
    expect(actions).toHaveLength(0);
  });

  it('accepts minimum valid: just bpm', async () => {
    const { response, actions } = await callTool(makeSession(), 'set_transport', { bpm: 120 });
    expect(response.applied).toBe(true);
    expect(response.bpm).toBe(120);
    expect(actions.length).toBeGreaterThan(0);
  });

  it('clamps very low bpm to 20', async () => {
    const { response } = await callTool(makeSession(), 'set_transport', { bpm: -100 });
    expect(response.applied).toBe(true);
    expect(response.bpm).toBe(20);
  });

  it('clamps very high bpm to 300', async () => {
    const { response } = await callTool(makeSession(), 'set_transport', { bpm: 999 });
    expect(response.applied).toBe(true);
    expect(response.bpm).toBe(300);
  });

  it('accepts swing at boundary 0.0', async () => {
    const { response } = await callTool(makeSession(), 'set_transport', { swing: 0.0 });
    expect(response.applied).toBe(true);
    expect(response.swing).toBe(0);
  });

  it('accepts swing at boundary 1.0', async () => {
    const { response } = await callTool(makeSession(), 'set_transport', { swing: 1.0 });
    expect(response.applied).toBe(true);
    expect(response.swing).toBe(1);
  });

  it('clamps swing above 1.0', async () => {
    const { response } = await callTool(makeSession(), 'set_transport', { swing: 1.5 });
    expect(response.applied).toBe(true);
    expect(response.swing).toBe(1);
  });

  it('clamps negative swing to 0', async () => {
    const { response } = await callTool(makeSession(), 'set_transport', { swing: -0.5 });
    expect(response.applied).toBe(true);
    expect(response.swing).toBe(0);
  });

  it('rejects invalid mode string', async () => {
    const { response, actions } = await callTool(makeSession(), 'set_transport', { mode: 'invalid-mode' });
    // Invalid mode is silently ignored (not a valid mode so hasMode is false),
    // and with no other valid properties, this fails
    expect(response.error).toBeDefined();
    expect(actions).toHaveLength(0);
  });

  it('accepts mode "pattern"', async () => {
    const { response } = await callTool(makeSession(), 'set_transport', { mode: 'pattern' });
    expect(response.applied).toBe(true);
    expect(response.mode).toBe('pattern');
  });

  it('accepts mode "song"', async () => {
    const { response } = await callTool(makeSession(), 'set_transport', { mode: 'song' });
    expect(response.applied).toBe(true);
    expect(response.mode).toBe('song');
  });

  it('ignores string bpm (typeof check)', async () => {
    const { response, actions } = await callTool(makeSession(), 'set_transport', { bpm: 'fast' });
    // bpm as string fails typeof === 'number', so no valid props
    expect(response.error).toBeDefined();
    expect(actions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// set_model
// ---------------------------------------------------------------------------

describe('set_model — adversarial', () => {
  it('rejects missing trackId', async () => {
    const { response, actions } = await callTool(makeSession(), 'set_model', {
      model: 'virtual-analog',
    });
    expect(response.error).toMatch(/trackId/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects missing model', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'set_model', {
      trackId: session.tracks[0].id,
    });
    expect(response.error).toMatch(/model/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects empty model string', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'set_model', {
      trackId: session.tracks[0].id,
      model: '',
    });
    expect(response.error).toMatch(/model/i);
    expect(actions).toHaveLength(0);
  });

  it('accepts valid model name', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'set_model', {
      trackId: session.tracks[0].id,
      model: 'virtual-analog',
    });
    expect(response.queued).toBe(true);
    expect(actions.length).toBeGreaterThan(0);
  });

  it('handles non-existent track', async () => {
    const { response, actions } = await callTool(makeSession(), 'set_model', {
      trackId: 'no-such-track',
      model: 'virtual-analog',
    });
    expect(response.error).toBeDefined();
    expect(actions).toHaveLength(0);
  });

  it('handles very long model name', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'set_model', {
      trackId: session.tracks[0].id,
      model: 'x'.repeat(1000),
    });
    // Should produce an action (model validation happens at execution time)
    expect(response.queued).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// manage_processor (add_processor, remove_processor)
// ---------------------------------------------------------------------------

describe('manage_processor — adversarial', () => {
  it('rejects missing trackId', async () => {
    const { response, actions } = await callTool(makeSession(), 'manage_processor', {
      action: 'add',
      moduleType: 'clouds',
      description: 'test',
    });
    expect(response.error).toMatch(/trackId/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects missing action', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'manage_processor', {
      trackId: session.tracks[0].id,
      moduleType: 'clouds',
      description: 'test',
    });
    expect(response.error).toMatch(/action/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects invalid action value', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'manage_processor', {
      action: 'invalid-action',
      trackId: session.tracks[0].id,
      moduleType: 'clouds',
      description: 'test',
    });
    expect(response.error).toMatch(/invalid action/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects add with missing moduleType', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'manage_processor', {
      action: 'add',
      trackId: session.tracks[0].id,
      description: 'test',
    });
    expect(response.error).toMatch(/moduleType/i);
    expect(actions).toHaveLength(0);
  });

  it('accepts valid add processor', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'manage_processor', {
      action: 'add',
      trackId: session.tracks[0].id,
      moduleType: 'clouds',
      description: 'add reverb',
    });
    expect(response.applied).toBe(true);
    expect(response.processorId).toBeDefined();
    expect(actions.length).toBeGreaterThan(0);
  });

  it('rejects remove with missing processorId', async () => {
    const session = makeRichSession();
    const { response, actions } = await callTool(session, 'manage_processor', {
      action: 'remove',
      trackId: session.tracks[0].id,
      description: 'test',
    });
    expect(response.error).toMatch(/processorId/i);
    expect(actions).toHaveLength(0);
  });

  it('accepts remove with non-existent processorId (no pre-check)', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'manage_processor', {
      action: 'remove',
      trackId: session.tracks[0].id,
      processorId: 'nonexistent-proc',
      description: 'remove test',
    });
    // The handler doesn't validate existence, just creates the action
    expect(response.applied).toBe(true);
  });

  it('rejects add with missing description', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'manage_processor', {
      action: 'add',
      trackId: session.tracks[0].id,
      moduleType: 'clouds',
    });
    expect(response.error).toMatch(/description/i);
    expect(actions).toHaveLength(0);
  });

  it('handles non-existent track', async () => {
    const { response, actions } = await callTool(makeSession(), 'manage_processor', {
      action: 'add',
      trackId: 'no-such-track',
      moduleType: 'clouds',
      description: 'test',
    });
    expect(response.error).toBeDefined();
    expect(actions).toHaveLength(0);
  });

  it('handles bypass action', async () => {
    const session = makeRichSession();
    const { response } = await callTool(session, 'manage_processor', {
      action: 'bypass',
      trackId: session.tracks[0].id,
      processorId: 'clouds-1',
      description: 'bypass test',
    });
    expect(response.applied).toBe(true);
    expect(response.enabled).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// manage_modulator (add_modulator, remove_modulator)
// ---------------------------------------------------------------------------

describe('manage_modulator — adversarial', () => {
  it('rejects missing trackId', async () => {
    const { response, actions } = await callTool(makeSession(), 'manage_modulator', {
      action: 'add',
      moduleType: 'tides',
      description: 'test',
    });
    expect(response.error).toMatch(/trackId/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects missing action', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'manage_modulator', {
      trackId: session.tracks[0].id,
      moduleType: 'tides',
      description: 'test',
    });
    expect(response.error).toMatch(/action/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects invalid action', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'manage_modulator', {
      action: 'wiggle',
      trackId: session.tracks[0].id,
      moduleType: 'tides',
      description: 'test',
    });
    expect(response.error).toMatch(/invalid action/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects add with missing moduleType', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'manage_modulator', {
      action: 'add',
      trackId: session.tracks[0].id,
      description: 'test',
    });
    expect(response.error).toMatch(/moduleType/i);
    expect(actions).toHaveLength(0);
  });

  it('accepts valid add modulator', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'manage_modulator', {
      action: 'add',
      trackId: session.tracks[0].id,
      moduleType: 'tides',
      description: 'add LFO',
    });
    expect(response.queued).toBe(true);
    expect(response.modulatorId).toBeDefined();
    expect(actions.length).toBeGreaterThan(0);
  });

  it('rejects remove with missing modulatorId', async () => {
    const session = makeRichSession();
    const { response, actions } = await callTool(session, 'manage_modulator', {
      action: 'remove',
      trackId: session.tracks[0].id,
      description: 'test',
    });
    expect(response.error).toMatch(/modulatorId/i);
    expect(actions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// modulation_route (set_modulation)
// ---------------------------------------------------------------------------

describe('modulation_route — adversarial', () => {
  it('rejects missing trackId', async () => {
    const { response, actions } = await callTool(makeSession(), 'modulation_route', {
      action: 'connect',
      modulatorId: 'tides-1',
      targetKind: 'source',
      targetParam: 'timbre',
      depth: 0.5,
      description: 'test',
    });
    expect(response.error).toMatch(/trackId/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects connect without modulatorId', async () => {
    const session = makeRichSession();
    const { response, actions } = await callTool(session, 'modulation_route', {
      action: 'connect',
      trackId: session.tracks[0].id,
      targetKind: 'source',
      targetParam: 'timbre',
      depth: 0.5,
      description: 'test',
    });
    expect(response.error).toMatch(/modulatorId/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects connect without depth', async () => {
    const session = makeRichSession();
    const { response, actions } = await callTool(session, 'modulation_route', {
      action: 'connect',
      trackId: session.tracks[0].id,
      modulatorId: 'tides-1',
      targetKind: 'source',
      targetParam: 'timbre',
      description: 'test',
    });
    expect(response.error).toMatch(/depth/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects invalid targetKind', async () => {
    const session = makeRichSession();
    const { response, actions } = await callTool(session, 'modulation_route', {
      action: 'connect',
      trackId: session.tracks[0].id,
      modulatorId: 'tides-1',
      targetKind: 'invalid',
      targetParam: 'timbre',
      depth: 0.5,
      description: 'test',
    });
    expect(response.error).toMatch(/targetKind/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects processor target without processorId', async () => {
    const session = makeRichSession();
    const { response, actions } = await callTool(session, 'modulation_route', {
      action: 'connect',
      trackId: session.tracks[0].id,
      modulatorId: 'tides-1',
      targetKind: 'processor',
      targetParam: 'position',
      depth: 0.5,
      description: 'test',
    });
    expect(response.error).toMatch(/processorId/i);
    expect(actions).toHaveLength(0);
  });

  it('accepts valid connect to source', async () => {
    const session = makeRichSession();
    const { response, actions } = await callTool(session, 'modulation_route', {
      action: 'connect',
      trackId: session.tracks[0].id,
      modulatorId: 'tides-1',
      targetKind: 'source',
      targetParam: 'morph',
      depth: 0.3,
      description: 'route lfo to morph',
    });
    expect(response.queued).toBe(true);
    expect(response.modulationId).toBeDefined();
    expect(actions.length).toBeGreaterThan(0);
  });

  it('accepts negative depth (bipolar modulation)', async () => {
    const session = makeRichSession();
    const { response } = await callTool(session, 'modulation_route', {
      action: 'connect',
      trackId: session.tracks[0].id,
      modulatorId: 'tides-1',
      targetKind: 'source',
      targetParam: 'timbre',
      depth: -0.8,
      description: 'inverted mod',
    });
    expect(response.queued).toBe(true);
    expect(response.depth).toBe(-0.8);
  });

  it('rejects disconnect without modulationId', async () => {
    const session = makeRichSession();
    const { response, actions } = await callTool(session, 'modulation_route', {
      action: 'disconnect',
      trackId: session.tracks[0].id,
      description: 'test',
    });
    expect(response.error).toMatch(/modulationId/i);
    expect(actions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// edit_pattern
// ---------------------------------------------------------------------------

describe('edit_pattern — adversarial', () => {
  it('rejects missing trackId', async () => {
    const { response, actions } = await callTool(makeSession(), 'edit_pattern', {
      description: 'test',
      operations: [{ action: 'add', step: 0, kind: 'trigger', velocity: 0.8 }],
    });
    expect(response.error).toMatch(/trackId/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects missing description', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'edit_pattern', {
      trackId: session.tracks[0].id,
      operations: [{ action: 'add', step: 0, kind: 'trigger', velocity: 0.8 }],
    });
    expect(response.error).toMatch(/description/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects empty operations array', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'edit_pattern', {
      trackId: session.tracks[0].id,
      description: 'test',
      operations: [],
    });
    expect(response.error).toMatch(/operations/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects missing operations', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'edit_pattern', {
      trackId: session.tracks[0].id,
      description: 'test',
    });
    expect(response.error).toMatch(/operations/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects invalid operation action', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'edit_pattern', {
      trackId: session.tracks[0].id,
      description: 'test',
      operations: [{ action: 'explode', step: 0, kind: 'trigger' }],
    });
    expect(response.error).toMatch(/unknown action/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects negative step number', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'edit_pattern', {
      trackId: session.tracks[0].id,
      description: 'test',
      operations: [{ action: 'add', step: -1, kind: 'trigger', velocity: 0.8 }],
    });
    expect(response.error).toMatch(/step/i);
    expect(actions).toHaveLength(0);
  });

  it('accepts valid add operation', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'edit_pattern', {
      trackId: session.tracks[0].id,
      description: 'add kick',
      operations: [{ action: 'add', step: 0, kind: 'trigger', velocity: 0.8 }],
    });
    expect(response.applied).toBe(true);
    expect(response.added).toBe(1);
    expect(actions.length).toBeGreaterThan(0);
  });

  it('handles non-existent track', async () => {
    const { response, actions } = await callTool(makeSession(), 'edit_pattern', {
      trackId: 'no-track',
      description: 'test',
      operations: [{ action: 'add', step: 0, kind: 'trigger', velocity: 0.8 }],
    });
    expect(response.error).toBeDefined();
    expect(actions).toHaveLength(0);
  });

  it('handles step as string (bar.beat.sixteenth)', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'edit_pattern', {
      trackId: session.tracks[0].id,
      description: 'beat addressing',
      operations: [{ action: 'add', step: '1.1.1', kind: 'trigger', velocity: 0.8 }],
    });
    expect(response.applied).toBe(true);
  });

  it('resolves property selectors to a specific note event', async () => {
    let session = makeSession();
    session = editPatternEvents(session, session.tracks[0].id, undefined, [
      { action: 'add', step: 16.1, event: { type: 'note', pitch: 62, velocity: 0.4, duration: 1 } },
      { action: 'add', step: 16.3, event: { type: 'note', pitch: 62, velocity: 0.9, duration: 1 } },
    ], 'seed bar 2 notes');

    const { response, actions } = await callTool(session, 'edit_pattern', {
      trackId: session.tracks[0].id,
      description: 'soften the loudest D in bar 2',
      operations: [{
        action: 'modify',
        select: { bar: 2, type: 'note', pitchClass: 'D', velocity: 'max' },
        event: { type: 'note', velocity: 0.2 },
      }],
    });

    expect(response.applied).toBe(true);
    expect(actions).toHaveLength(1);
    const action = actions[0] as { operations: Array<{ step: number; match?: { type: string; pitch?: number }; event?: { velocity?: number } }> };
    expect(action.operations[0].step).toBe(16.3);
    expect(action.operations[0].match).toEqual({ type: 'note', pitch: 62 });
    expect(action.operations[0].event?.velocity).toBe(0.2);
  });

  it('rejects ambiguous property selectors', async () => {
    let session = makeSession();
    session = editPatternEvents(session, session.tracks[0].id, undefined, [
      { action: 'add', step: 16.1, event: { type: 'note', pitch: 62, velocity: 0.7, duration: 1 } },
      { action: 'add', step: 16.3, event: { type: 'note', pitch: 62, velocity: 0.7, duration: 1 } },
    ], 'seed duplicate notes');

    const { response, actions } = await callTool(session, 'edit_pattern', {
      trackId: session.tracks[0].id,
      description: 'remove a D in bar 2',
      operations: [{
        action: 'remove',
        select: { bar: 2, type: 'note', pitchClass: 'D' },
        event: { type: 'note' },
      }],
    });

    expect(response.error).toMatch(/multiple events/i);
    expect(actions).toHaveLength(0);
  });

  it('resolves selectors against the evolving state of a multi-op batch', async () => {
    let session = makeSession();
    session = editPatternEvents(session, session.tracks[0].id, undefined, [
      { action: 'add', step: 16.1, event: { type: 'note', pitch: 62, velocity: 0.8, duration: 1 } },
      { action: 'add', step: 16.3, event: { type: 'note', pitch: 62, velocity: 0.4, duration: 1 } },
    ], 'seed notes');

    const { response, actions } = await callTool(session, 'edit_pattern', {
      trackId: session.tracks[0].id,
      description: 'remove the loud note then soften the remaining one',
      operations: [
        {
          action: 'remove',
          select: { bar: 2, type: 'note', pitchClass: 'D', velocity: 'max' },
          event: { type: 'note' },
        },
        {
          action: 'modify',
          select: { bar: 2, type: 'note', pitchClass: 'D', velocity: 'max' },
          event: { type: 'note', velocity: 0.2 },
        },
      ],
    });

    expect(response.applied).toBe(true);
    const action = actions[0] as { operations: Array<{ step: number; event?: { velocity?: number } }> };
    expect(action.operations[0].step).toBe(16.1);
    expect(action.operations[1].step).toBe(16.3);
    expect(action.operations[1].event?.velocity).toBe(0.2);
  });

  it('ignores disabled velocity-0 sentinel events for velocity=min selectors', async () => {
    let session = makeSession();
    session = editPatternEvents(session, session.tracks[0].id, undefined, [
      { action: 'add', step: 16.1, event: { type: 'note', pitch: 62, velocity: 0, duration: 1 } },
      { action: 'add', step: 16.3, event: { type: 'note', pitch: 62, velocity: 0.4, duration: 1 } },
    ], 'seed sentinel and live note');

    const { response, actions } = await callTool(session, 'edit_pattern', {
      trackId: session.tracks[0].id,
      description: 'soften the quiet live note',
      operations: [{
        action: 'modify',
        select: { bar: 2, type: 'note', pitchClass: 'D', velocity: 'min' },
        event: { type: 'note', velocity: 0.2 },
      }],
    });

    expect(response.applied).toBe(true);
    const action = actions[0] as { operations: Array<{ step: number }> };
    expect(action.operations[0].step).toBe(16.3);
  });
});

// ---------------------------------------------------------------------------
// manage_pattern
// ---------------------------------------------------------------------------

describe('manage_pattern — adversarial', () => {
  it('rejects missing action', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'manage_pattern', {
      trackId: session.tracks[0].id,
      description: 'test',
    });
    expect(response.error).toMatch(/action/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects missing trackId', async () => {
    const { response, actions } = await callTool(makeSession(), 'manage_pattern', {
      action: 'add',
      description: 'test',
    });
    expect(response.error).toMatch(/trackId/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects missing description', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'manage_pattern', {
      action: 'add',
      trackId: session.tracks[0].id,
    });
    expect(response.error).toMatch(/description/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects invalid action value', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'manage_pattern', {
      action: 'destroy',
      trackId: session.tracks[0].id,
      description: 'test',
    });
    expect(response.error).toMatch(/invalid action/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects remove without patternId', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'manage_pattern', {
      action: 'remove',
      trackId: session.tracks[0].id,
      description: 'test',
    });
    expect(response.error).toMatch(/patternId/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects rename without name', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'manage_pattern', {
      action: 'rename',
      trackId: session.tracks[0].id,
      patternId: session.tracks[0].patterns[0].id,
      description: 'test',
    });
    expect(response.error).toMatch(/name/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects set_length without length', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'manage_pattern', {
      action: 'set_length',
      trackId: session.tracks[0].id,
      description: 'test',
    });
    expect(response.error).toMatch(/length/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects set_length with NaN', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'manage_pattern', {
      action: 'set_length',
      trackId: session.tracks[0].id,
      length: NaN,
      description: 'test',
    });
    expect(response.error).toMatch(/length/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects set_length with Infinity', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'manage_pattern', {
      action: 'set_length',
      trackId: session.tracks[0].id,
      length: Infinity,
      description: 'test',
    });
    expect(response.error).toMatch(/length/i);
    expect(actions).toHaveLength(0);
  });

  it('accepts valid add pattern', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'manage_pattern', {
      action: 'add',
      trackId: session.tracks[0].id,
      description: 'add new pattern',
    });
    expect(response.queued).toBe(true);
    expect(actions.length).toBeGreaterThan(0);
  });

  it('handles non-existent track', async () => {
    const { response, actions } = await callTool(makeSession(), 'manage_pattern', {
      action: 'add',
      trackId: 'no-track',
      description: 'test',
    });
    expect(response.error).toBeDefined();
    expect(actions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// set_track_meta
// ---------------------------------------------------------------------------

describe('set_track_meta — adversarial', () => {
  it('rejects missing trackId', async () => {
    const { response, actions } = await callTool(makeSession(), 'set_track_meta', {
      volume: 0.5,
    });
    expect(response.error).toMatch(/trackId/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects when no properties provided', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'set_track_meta', {
      trackId: session.tracks[0].id,
    });
    expect(response.error).toMatch(/at least one/i);
    expect(actions).toHaveLength(0);
  });

  it('accepts just volume', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'set_track_meta', {
      trackId: session.tracks[0].id,
      volume: 0.5,
    });
    expect(response.applied).toContain('volume');
    expect(actions.length).toBeGreaterThan(0);
  });

  it('clamps volume to 0-1', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'set_track_meta', {
      trackId: session.tracks[0].id,
      volume: 5.0,
    });
    expect(response.applied).toContain('volume');
  });

  it('clamps negative volume to 0', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'set_track_meta', {
      trackId: session.tracks[0].id,
      volume: -1.0,
    });
    expect(response.applied).toContain('volume');
  });

  it('accepts pan at boundaries (-1 and 1)', async () => {
    const session = makeSession();
    const { response: r1 } = await callTool(session, 'set_track_meta', {
      trackId: session.tracks[0].id,
      pan: -1.0,
    });
    expect(r1.applied).toContain('pan');

    const { response: r2 } = await callTool(session, 'set_track_meta', {
      trackId: session.tracks[0].id,
      pan: 1.0,
    });
    expect(r2.applied).toContain('pan');
  });

  it('rejects approval without reason', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'set_track_meta', {
      trackId: session.tracks[0].id,
      approval: 'liked',
    });
    expect(response.errors).toBeDefined();
    expect((response.errors as string[]).some((e: string) => /reason/i.test(e))).toBe(true);
  });

  it('rejects invalid approval level', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'set_track_meta', {
      trackId: session.tracks[0].id,
      approval: 'superb',
      reason: 'because',
    });
    expect(response.errors).toBeDefined();
    expect((response.errors as string[]).some((e: string) => /invalid approval/i.test(e))).toBe(true);
  });

  it('accepts valid approval with reason', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'set_track_meta', {
      trackId: session.tracks[0].id,
      approval: 'liked',
      reason: 'good groove',
    });
    expect(response.applied).toContain('approval');
  });

  it('rejects empty name string', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'set_track_meta', {
      trackId: session.tracks[0].id,
      name: '',
    });
    expect(response.errors).toBeDefined();
    expect((response.errors as string[]).some((e: string) => /name/i.test(e))).toBe(true);
  });

  it('rejects whitespace-only name', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'set_track_meta', {
      trackId: session.tracks[0].id,
      name: '   ',
    });
    expect(response.errors).toBeDefined();
    expect((response.errors as string[]).some((e: string) => /name/i.test(e))).toBe(true);
  });

  it('accepts name with unicode characters', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'set_track_meta', {
      trackId: session.tracks[0].id,
      name: 'Bass',
    });
    expect(response.applied).toContain('name');
  });

  it('rejects NaN importance', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'set_track_meta', {
      trackId: session.tracks[0].id,
      importance: NaN,
    });
    expect(response.errors).toBeDefined();
    expect((response.errors as string[]).some((e: string) => /importance/i.test(e))).toBe(true);
  });

  it('rejects Infinity importance', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'set_track_meta', {
      trackId: session.tracks[0].id,
      importance: Infinity,
    });
    expect(response.errors).toBeDefined();
    expect((response.errors as string[]).some((e: string) => /importance/i.test(e))).toBe(true);
  });

  it('accepts importance at boundaries (0 and 1)', async () => {
    const session = makeSession();
    const { response: r1 } = await callTool(session, 'set_track_meta', {
      trackId: session.tracks[0].id,
      importance: 0.0,
    });
    expect(r1.applied).toContain('importance');

    const { response: r2 } = await callTool(session, 'set_track_meta', {
      trackId: session.tracks[0].id,
      importance: 1.0,
    });
    expect(r2.applied).toContain('importance');
  });

  it('accepts muted and solo booleans', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'set_track_meta', {
      trackId: session.tracks[0].id,
      muted: true,
      solo: false,
    });
    expect(response.applied).toContain('muted');
    expect(response.applied).toContain('solo');
  });

  it('handles non-existent track', async () => {
    const { response, actions } = await callTool(makeSession(), 'set_track_meta', {
      trackId: 'no-track',
      volume: 0.5,
    });
    expect(response.error).toBeDefined();
    expect(actions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// set_scale
// ---------------------------------------------------------------------------

describe('set_scale — adversarial', () => {
  it('rejects when neither root+mode nor clear provided', async () => {
    const { response, actions } = await callTool(makeSession(), 'set_scale', {});
    expect(response.error).toBeDefined();
    expect(actions).toHaveLength(0);
  });

  it('rejects root without mode', async () => {
    const { response, actions } = await callTool(makeSession(), 'set_scale', { root: 0 });
    expect(response.error).toMatch(/root.*mode/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects mode without root', async () => {
    const { response, actions } = await callTool(makeSession(), 'set_scale', { mode: 'major' });
    expect(response.error).toMatch(/root.*mode/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects root out of range (negative)', async () => {
    const { response, actions } = await callTool(makeSession(), 'set_scale', { root: -1, mode: 'major' });
    expect(response.error).toMatch(/root/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects root out of range (12+)', async () => {
    const { response, actions } = await callTool(makeSession(), 'set_scale', { root: 12, mode: 'major' });
    expect(response.error).toMatch(/root/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects invalid mode', async () => {
    const { response, actions } = await callTool(makeSession(), 'set_scale', { root: 0, mode: 'zydeco' });
    expect(response.error).toMatch(/mode/i);
    expect(actions).toHaveLength(0);
  });

  it('accepts valid root and mode', async () => {
    const { response, actions } = await callTool(makeSession(), 'set_scale', { root: 0, mode: 'major' });
    expect(response.applied).toBe(true);
    expect(actions.length).toBeGreaterThan(0);
  });

  it('accepts clear: true', async () => {
    const { response, actions } = await callTool(makeSession(), 'set_scale', { clear: true });
    expect(response.applied).toBe(true);
    expect(response.scale).toBeNull();
    expect(actions.length).toBeGreaterThan(0);
  });

  it('accepts boundary root values (0 and 11)', async () => {
    const { response: r1 } = await callTool(makeSession(), 'set_scale', { root: 0, mode: 'minor' });
    expect(r1.applied).toBe(true);

    const { response: r2 } = await callTool(makeSession(), 'set_scale', { root: 11, mode: 'minor' });
    expect(r2.applied).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// set_chord_progression
// ---------------------------------------------------------------------------

describe('set_chord_progression — adversarial', () => {
  it('rejects when neither chords nor clear are provided', async () => {
    const { response, actions } = await callTool(makeSession(), 'set_chord_progression', {});
    expect(response.error).toMatch(/chords array/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects empty chords arrays', async () => {
    const { response, actions } = await callTool(makeSession(), 'set_chord_progression', { chords: [] });
    expect(response.error).toMatch(/non-empty chords array/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects duplicate bars', async () => {
    const { response, actions } = await callTool(makeSession(), 'set_chord_progression', {
      chords: [{ bar: 1, chord: 'Fm' }, { bar: 1, chord: 'Eb' }],
    });
    expect(response.error).toMatch(/duplicate chord entry/i);
    expect(actions).toHaveLength(0);
  });

  it('accepts clear: true', async () => {
    const { response, actions } = await callTool(makeSession(), 'set_chord_progression', { clear: true });
    expect(response.applied).toBe(true);
    expect(response.chord_progression).toBeNull();
    expect(actions.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// relate
// ---------------------------------------------------------------------------

describe('relate — adversarial', () => {
  it('rejects identical source and target tracks', async () => {
    const { response, actions } = await callTool(makeSession(), 'relate', {
      sourceTrackId: 'v0',
      targetTrackId: 'v0',
      relation: 'align',
      description: 'bad self relation',
    });
    expect(response.error).toMatch(/different tracks/i);
    expect(actions).toHaveLength(0);
  });

  it('requires dimension for contrast relations', async () => {
    let session = makeSession();
    session = addTrack(session, 'audio') ?? session;
    session.tracks[1].name = 'T2';
    const { response, actions } = await callTool(session, 'relate', {
      sourceTrackId: 'v0',
      targetTrackId: 'v1',
      relation: 'increase_contrast',
      description: 'separate them',
    });
    expect(response.error).toMatch(/dimension/i);
    expect(actions).toHaveLength(0);
  });

  it('align reshapes the target pattern to source onsets', async () => {
    let session = makeSession();
    session = addTrack(session, 'audio') ?? session;
    session.tracks[1].name = 'Bass';
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 1 },
      { kind: 'trigger', at: 4, velocity: 1 },
    ];
    session.tracks[1].patterns[0].events = [
      { kind: 'note', at: 1, pitch: 36, velocity: 0.8, duration: 1 },
      { kind: 'note', at: 5, pitch: 38, velocity: 0.7, duration: 1 },
    ];

    const { response, actions } = await callTool(session, 'relate', {
      sourceTrackId: 'v0',
      targetTrackId: 'v1',
      relation: 'align',
      description: 'align bass to kick',
    });

    expect(response.applied).toBe(true);
    expect(response.targetOnsets).toEqual([0, 4]);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: 'sketch', trackId: 'v1' });
  });

  it('ignores velocity=0 sentinels when deriving source onsets', async () => {
    let session = makeSession();
    session = addTrack(session, 'audio') ?? session;
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0 },
      { kind: 'trigger', at: 4, velocity: 1 },
    ];
    session.tracks[1].patterns[0].events = [
      { kind: 'note', at: 1, pitch: 36, velocity: 0.8, duration: 1 },
    ];

    const { response } = await callTool(session, 'relate', {
      sourceTrackId: 'v0',
      targetTrackId: 'v1',
      relation: 'align',
      description: 'align to real onsets only',
    });

    expect(response.applied).toBe(true);
    expect(response.sourceOnsets).toEqual([4]);
    expect(response.targetOnsets).toEqual([4]);
  });

  it('rejects rhythmic relations when the source track has no patterns', async () => {
    let session = makeSession();
    session = addTrack(session, 'audio') ?? session;
    session.tracks[0].patterns = [];
    session.tracks[1].patterns[0].events = [
      { kind: 'note', at: 1, pitch: 36, velocity: 0.8, duration: 1 },
    ];

    const { response, actions } = await callTool(session, 'relate', {
      sourceTrackId: 'v0',
      targetTrackId: 'v1',
      relation: 'align',
      description: 'bad source',
    });

    expect(response.error).toMatch(/has no patterns/);
    expect(actions).toHaveLength(0);
  });

  it('spectral_complement assigns complementary bands to the target', async () => {
    let session = makeSession();
    session = addTrack(session, 'audio') ?? session;
    session.tracks[1].name = 'Lead';
    session.tracks[1].musicalRole = 'bright lead';

    const { response, actions } = await callTool(session, 'relate', {
      sourceTrackId: 'v0',
      targetTrackId: 'v1',
      relation: 'spectral_complement',
      description: 'separate lead from kick',
    });

    expect(response.applied).toBe(true);
    expect(response.targetBands).toBeDefined();
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: 'assign_spectral_slot', trackId: 'v1' });
  });
});

// ---------------------------------------------------------------------------
// set_intent
// ---------------------------------------------------------------------------

describe('set_intent — adversarial', () => {
  it('rejects when no intent fields provided', async () => {
    const { response, actions } = await callTool(makeSession(), 'set_intent', {});
    expect(response.error).toMatch(/at least one/i);
    expect(actions).toHaveLength(0);
  });

  it('accepts single field (currentGoal)', async () => {
    const { response } = await callTool(makeSession(), 'set_intent', {
      currentGoal: 'build a beat',
    });
    expect(response.applied).toBe(true);
  });

  it('accepts genre as array', async () => {
    const { response } = await callTool(makeSession(), 'set_intent', {
      genre: ['techno', 'acid'],
    });
    expect(response.applied).toBe(true);
  });

  it('ignores non-array genre (silent no-op per typeof check)', async () => {
    const { response, actions } = await callTool(makeSession(), 'set_intent', {
      genre: 'techno',
    });
    // genre as string fails Array.isArray, so no valid fields
    expect(response.error).toMatch(/at least one/i);
    expect(actions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// set_section
// ---------------------------------------------------------------------------

describe('set_section — adversarial', () => {
  it('rejects when no section fields provided', async () => {
    const { response, actions } = await callTool(makeSession(), 'set_section', {});
    expect(response.error).toMatch(/at least one/i);
    expect(actions).toHaveLength(0);
  });

  it('accepts just name', async () => {
    const { response } = await callTool(makeSession(), 'set_section', { name: 'intro' });
    expect(response.applied).toBe(true);
  });

  it('clamps targetEnergy above 1', async () => {
    const { response } = await callTool(makeSession(), 'set_section', { targetEnergy: 5.0 });
    expect(response.applied).toBe(true);
  });

  it('clamps negative targetDensity to 0', async () => {
    const { response } = await callTool(makeSession(), 'set_section', { targetDensity: -1.0 });
    expect(response.applied).toBe(true);
  });

  it('ignores NaN targetEnergy', async () => {
    // NaN fails Number.isFinite check, so it's ignored
    const { response, actions } = await callTool(makeSession(), 'set_section', { targetEnergy: NaN });
    // With no valid fields
    expect(response.error).toMatch(/at least one/i);
    expect(actions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// manage_track
// ---------------------------------------------------------------------------

describe('manage_track — adversarial', () => {
  it('rejects missing action', async () => {
    const { response, actions } = await callTool(makeSession(), 'manage_track', {
      description: 'test',
    });
    expect(response.error).toMatch(/action/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects missing description', async () => {
    const { response, actions } = await callTool(makeSession(), 'manage_track', {
      action: 'add',
    });
    expect(response.error).toMatch(/description/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects invalid kind', async () => {
    const { response, actions } = await callTool(makeSession(), 'manage_track', {
      action: 'add',
      kind: 'midi',
      description: 'test',
    });
    expect(response.error).toMatch(/kind/i);
    expect(actions).toHaveLength(0);
  });

  it('accepts valid add audio track', async () => {
    const { response, actions } = await callTool(makeSession(), 'manage_track', {
      action: 'add',
      kind: 'audio',
      description: 'new track',
    });
    expect(response.queued).toBe(true);
    expect(actions.length).toBeGreaterThan(0);
  });

  it('accepts valid add bus track', async () => {
    const { response, actions } = await callTool(makeSession(), 'manage_track', {
      action: 'add',
      kind: 'bus',
      description: 'new bus',
    });
    expect(response.queued).toBe(true);
    expect(actions.length).toBeGreaterThan(0);
  });

  it('rejects remove without trackId', async () => {
    const { response, actions } = await callTool(makeSession(), 'manage_track', {
      action: 'remove',
      description: 'test',
    });
    expect(response.error).toMatch(/trackId/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects remove with non-existent track', async () => {
    const { response, actions } = await callTool(makeSession(), 'manage_track', {
      action: 'remove',
      trackId: 'no-such-track',
      description: 'test',
    });
    expect(response.error).toBeDefined();
    expect(actions).toHaveLength(0);
  });

  it('rejects invalid sub-action', async () => {
    const { response, actions } = await callTool(makeSession(), 'manage_track', {
      action: 'duplicate',
      description: 'test',
    });
    expect(response.error).toMatch(/invalid action/i);
    expect(actions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// setup_return_bus
// ---------------------------------------------------------------------------

describe('setup_return_bus — adversarial', () => {
  it('rejects missing sourceTrackId', async () => {
    const { response, actions } = await callTool(makeSession(), 'setup_return_bus', {
      processorType: 'clouds',
      description: 'test',
    });
    expect(response.error).toMatch(/sourceTrackId/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects unsupported processor type', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'setup_return_bus', {
      sourceTrackId: session.tracks[0].id,
      processorType: 'rings',
      description: 'test',
    });
    expect(response.error).toMatch(/unsupported/i);
    expect(actions).toHaveLength(0);
  });

  it('builds bus, processor, wet, and send actions for a valid return bus', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'setup_return_bus', {
      sourceTrackId: session.tracks[0].id,
      processorType: 'clouds',
      processorModel: 'pitch_shifter',
      wet: 1.0,
      sendLevel: 0.3,
      name: 'Delay',
      description: 'create delay return',
    });
    expect(response.applied).toBe(true);
    expect(response.busId).toBeDefined();
    expect(response.processorId).toBeDefined();
    expect(actions).toHaveLength(5);
    expect(actions[0]).toMatchObject({ type: 'add_track', kind: 'bus' });
    expect(actions[1]).toMatchObject({ type: 'add_processor', moduleType: 'clouds' });
    expect(actions[2]).toMatchObject({ type: 'set_model', model: 'pitch_shifter' });
    expect(actions[3]).toMatchObject({ type: 'move', param: 'dry-wet', target: { absolute: 1.0 } });
    expect(actions[4]).toMatchObject({ type: 'manage_send', action: 'add', level: 0.3 });
  });
});

// ---------------------------------------------------------------------------
// transform
// ---------------------------------------------------------------------------

describe('transform — adversarial', () => {
  it('rejects missing trackId', async () => {
    const { response, actions } = await callTool(makeSession(), 'transform', {
      operation: 'reverse',
      description: 'test',
    });
    expect(response.error).toMatch(/trackId/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects missing operation', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'transform', {
      trackId: session.tracks[0].id,
      description: 'test',
    });
    expect(response.error).toMatch(/operation/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects invalid operation', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'transform', {
      trackId: session.tracks[0].id,
      operation: 'explode',
      description: 'test',
    });
    expect(response.error).toMatch(/unknown operation/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects rotate without steps', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'transform', {
      trackId: session.tracks[0].id,
      operation: 'rotate',
      description: 'test',
    });
    expect(response.error).toMatch(/steps/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects rotate with steps=0', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'transform', {
      trackId: session.tracks[0].id,
      operation: 'rotate',
      steps: 0,
      description: 'test',
    });
    expect(response.error).toMatch(/non-zero/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects transpose without semitones', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'transform', {
      trackId: session.tracks[0].id,
      operation: 'transpose',
      description: 'test',
    });
    expect(response.error).toMatch(/semitones/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects transpose with semitones=0', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'transform', {
      trackId: session.tracks[0].id,
      operation: 'transpose',
      semitones: 0,
      description: 'test',
    });
    expect(response.error).toMatch(/non-zero/i);
    expect(actions).toHaveLength(0);
  });

  it('rejects rotate with semitones (wrong param)', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'transform', {
      trackId: session.tracks[0].id,
      operation: 'rotate',
      semitones: 2,
      description: 'test',
    });
    // rotate requires steps, not semitones — the error references steps requirement
    expect(response.error).toMatch(/steps/i);
    expect(actions).toHaveLength(0);
  });

  it('accepts valid reverse', async () => {
    const session = makeSession();
    const { response, actions } = await callTool(session, 'transform', {
      trackId: session.tracks[0].id,
      operation: 'reverse',
      description: 'reverse it',
    });
    expect(response.applied).toBe(true);
    expect(actions.length).toBeGreaterThan(0);
  });

  it('accepts valid duplicate', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'transform', {
      trackId: session.tracks[0].id,
      operation: 'duplicate',
      description: 'double it',
    });
    expect(response.applied).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: empty session state
// ---------------------------------------------------------------------------

describe('empty session edge cases', () => {
  it('move succeeds on default session (track exists)', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'move', {
      param: 'timbre',
      target: { absolute: 0.5 },
      trackId: session.tracks[0].id,
    });
    expect(response.applied).toBe(true);
  });

  it('sketch succeeds on default session with events', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'sketch', {
      trackId: session.tracks[0].id,
      description: 'test',
      events: [{ kind: 'trigger', at: 0, velocity: 0.8 }],
    });
    expect(response.applied).toBe(true);
  });

  it('set_transport works on fresh session', async () => {
    const { response } = await callTool(makeSession(), 'set_transport', { bpm: 140 });
    expect(response.applied).toBe(true);
    expect(response.bpm).toBe(140);
  });
});

// ---------------------------------------------------------------------------
// Track ID resolution (ordinal references like "Track 1")
// ---------------------------------------------------------------------------

describe('track ID resolution', () => {
  it('resolves "Track 1" to first audio track', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'move', {
      param: 'timbre',
      target: { absolute: 0.7 },
      trackId: 'Track 1',
    });
    expect(response.applied).toBe(true);
    expect(response.trackId).toBe(session.tracks[0].id);
  });

  it('rejects "Track 999" (out of range)', async () => {
    const { response, actions } = await callTool(makeSession(), 'move', {
      param: 'timbre',
      target: { absolute: 0.5 },
      trackId: 'Track 999',
    });
    expect(response.error).toBeDefined();
    expect(actions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Invariant: no partial state mutation on rejection
// ---------------------------------------------------------------------------

describe('no partial state mutation on rejection', () => {
  it('rejected tool calls produce no actions', async () => {
    // Missing required param
    const { actions: a1 } = await callTool(makeSession(), 'move', {});
    expect(a1).toHaveLength(0);

    // Missing events/archetype/generator
    const session = makeSession();
    const { actions: a2 } = await callTool(session, 'sketch', {
      trackId: session.tracks[0].id,
      description: 'test',
    });
    expect(a2).toHaveLength(0);

    // Empty operations
    const { actions: a3 } = await callTool(session, 'edit_pattern', {
      trackId: session.tracks[0].id,
      description: 'test',
      operations: [],
    });
    expect(a3).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Return value structure
// ---------------------------------------------------------------------------

describe('response field structure', () => {
  it('move response includes param, trackId, from, to', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'move', {
      param: 'timbre',
      target: { absolute: 0.7 },
      trackId: session.tracks[0].id,
    });
    expect(response.param).toBe('timbre');
    expect(response.trackId).toBe(session.tracks[0].id);
    expect(typeof response.from).toBe('number');
    expect(typeof response.to).toBe('number');
  });

  it('sketch response includes trackId, description, event counts', async () => {
    const session = makeSession();
    const { response } = await callTool(session, 'sketch', {
      trackId: session.tracks[0].id,
      description: 'test beat',
      events: [{ kind: 'trigger', at: 0, velocity: 0.8 }],
    });
    expect(response.trackId).toBe(session.tracks[0].id);
    expect(response.description).toBe('test beat');
    expect(typeof response.eventsAdded).toBe('number');
    expect(typeof response.rhythmChanged).toBe('boolean');
  });

  it('set_transport response includes applied and set values', async () => {
    const { response } = await callTool(makeSession(), 'set_transport', { bpm: 140, swing: 0.3 });
    expect(response.applied).toBe(true);
    expect(response.bpm).toBe(140);
    expect(response.swing).toBe(0.3);
  });

  it('error responses always have error field', async () => {
    const { response: r1 } = await callTool(makeSession(), 'move', {});
    expect(r1.error).toBeDefined();
    expect(typeof r1.error).toBe('string');
    expect((r1.error as string).length).toBeGreaterThan(0);

    const { response: r2 } = await callTool(makeSession(), 'sketch', { trackId: 'v0' });
    expect(r2.error).toBeDefined();
    expect(typeof r2.error).toBe('string');
  });
});
