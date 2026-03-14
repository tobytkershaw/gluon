// tests/ai/tool-declarations.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the @google/genai module
const mockGenerateContent = vi.fn();
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = { generateContent: mockGenerateContent };
    },
    Type: {
      STRING: 'STRING',
      NUMBER: 'NUMBER',
      INTEGER: 'INTEGER',
      BOOLEAN: 'BOOLEAN',
      ARRAY: 'ARRAY',
      OBJECT: 'OBJECT',
    },
    FunctionCallingConfigMode: {
      AUTO: 'AUTO',
    },
    createPartFromFunctionResponse: (id: string, name: string, response: Record<string, unknown>) => ({
      functionResponse: { id, name, response },
    }),
  };
});

import { GluonAI } from '../../src/ai/api';
import { GLUON_TOOLS } from '../../src/ai/tool-declarations';
import { createSession } from '../../src/engine/session';

describe('Tool Declarations', () => {
  it('exports fifteen tool declarations', () => {
    expect(GLUON_TOOLS).toHaveLength(15);
  });

  it('declares all expected tools', () => {
    const names = GLUON_TOOLS.map(t => t.name);
    expect(names).toContain('move');
    expect(names).toContain('sketch');
    expect(names).toContain('listen');
    expect(names).toContain('set_model');
    expect(names).toContain('set_transport');
    expect(names).toContain('transform');
    expect(names).toContain('add_view');
    expect(names).toContain('remove_view');
    expect(names).toContain('add_processor');
    expect(names).toContain('remove_processor');
    expect(names).toContain('replace_processor');
    expect(names).toContain('add_modulator');
    expect(names).toContain('remove_modulator');
    expect(names).toContain('connect_modulator');
    expect(names).toContain('disconnect_modulator');
  });

  it('all tools have description and name', () => {
    for (const tool of GLUON_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
    }
  });

  it('move tool requires param and target', () => {
    const move = GLUON_TOOLS.find(t => t.name === 'move')!;
    expect(move.parameters?.required).toEqual(['param', 'target']);
  });

  it('sketch tool requires trackId, description, events', () => {
    const sketch = GLUON_TOOLS.find(t => t.name === 'sketch')!;
    expect(sketch.parameters?.required).toEqual(['trackId', 'description', 'events']);
  });

  it('listen tool requires question', () => {
    const listen = GLUON_TOOLS.find(t => t.name === 'listen')!;
    expect(listen.parameters?.required).toEqual(['question']);
  });

  it('set_transport tool has no required params', () => {
    const transport = GLUON_TOOLS.find(t => t.name === 'set_transport')!;
    expect(transport.parameters?.required).toBeUndefined();
  });
});

describe('Function Call Execution', () => {
  let ai: GluonAI;

  beforeEach(() => {
    vi.clearAllMocks();
    ai = new GluonAI();
    ai.setApiKey('test-key');
  });

  function mockFunctionCallResponse(functionCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>) {
    const parts = functionCalls.map(fc => ({ functionCall: fc }));
    return {
      text: undefined,
      functionCalls,
      candidates: [{ content: { role: 'model', parts } }],
    };
  }

  function mockTextResponse(text: string) {
    return {
      text,
      functionCalls: undefined,
      candidates: [{ content: { role: 'model', parts: [{ text }] } }],
    };
  }

  it('converts move function call to AIMoveAction', async () => {
    mockGenerateContent
      .mockResolvedValueOnce(mockFunctionCallResponse([{
        id: 'call-1', name: 'move', args: { param: 'brightness', target: { absolute: 0.7 }, trackId: 'v0' },
      }]))
      .mockResolvedValueOnce(mockTextResponse('Done.'));

    const session = createSession();
    const actions = await ai.ask(session, 'brighten the kick');

    const moveActions = actions.filter(a => a.type === 'move');
    expect(moveActions).toHaveLength(1);
    expect(moveActions[0]).toMatchObject({
      type: 'move',
      param: 'brightness',
      target: { absolute: 0.7 },
      trackId: 'v0',
    });
  });

  it('converts sketch function call to AISketchAction', async () => {
    mockGenerateContent
      .mockResolvedValueOnce(mockFunctionCallResponse([{
        id: 'call-1', name: 'sketch', args: {
          trackId: 'v0', description: 'four on the floor',
          events: [
            { kind: 'trigger', at: 0, velocity: 1.0, accent: true },
            { kind: 'trigger', at: 4, velocity: 0.8 },
          ],
        },
      }]))
      .mockResolvedValueOnce(mockTextResponse('Here you go.'));

    const session = createSession();
    const actions = await ai.ask(session, 'make a kick pattern');

    const sketchActions = actions.filter(a => a.type === 'sketch');
    expect(sketchActions).toHaveLength(1);
    if (sketchActions[0].type === 'sketch') {
      expect(sketchActions[0].trackId).toBe('v0');
      expect(sketchActions[0].events).toHaveLength(2);
    }
  });

  it('converts set_transport function call to AITransportAction', async () => {
    mockGenerateContent
      .mockResolvedValueOnce(mockFunctionCallResponse([{
        id: 'call-1', name: 'set_transport', args: { bpm: 140, swing: 0.3 },
      }]))
      .mockResolvedValueOnce(mockTextResponse('Speeded up.'));

    const session = createSession();
    const actions = await ai.ask(session, 'speed it up');

    const transportActions = actions.filter(a => a.type === 'set_transport');
    expect(transportActions).toHaveLength(1);
    expect(transportActions[0]).toMatchObject({
      type: 'set_transport',
      bpm: 140,
      swing: 0.3,
    });
  });

  it('collects text-only responses as AISayAction', async () => {
    mockGenerateContent.mockResolvedValueOnce(mockTextResponse('Water is indeed wet.'));

    const session = createSession();
    const actions = await ai.ask(session, 'water is wet');

    const sayActions = actions.filter(a => a.type === 'say');
    expect(sayActions).toHaveLength(1);
    if (sayActions[0].type === 'say') {
      expect(sayActions[0].text).toBe('Water is indeed wet.');
    }
  });

  it('handles multiple tool calls in one turn', async () => {
    mockGenerateContent
      .mockResolvedValueOnce(mockFunctionCallResponse([
        { id: 'c1', name: 'move', args: { param: 'brightness', target: { absolute: 0.3 } } },
        { id: 'c2', name: 'set_transport', args: { bpm: 90 } },
      ]))
      .mockResolvedValueOnce(mockTextResponse('Darkened and slowed.'));

    const session = createSession();
    const actions = await ai.ask(session, 'darken and slow down');

    expect(actions.filter(a => a.type === 'move')).toHaveLength(1);
    expect(actions.filter(a => a.type === 'set_transport')).toHaveLength(1);
    expect(actions.filter(a => a.type === 'say')).toHaveLength(1);
  });

  it('respects MAX_TOOL_ROUNDS limit', async () => {
    // Always return function calls — should stop after 5 rounds
    mockGenerateContent.mockResolvedValue(mockFunctionCallResponse([
      { id: 'c1', name: 'move', args: { param: 'brightness', target: { absolute: 0.5 } } },
    ]));

    const session = createSession();
    const actions = await ai.ask(session, 'keep going');

    // 5 rounds of move calls
    expect(actions.filter(a => a.type === 'move')).toHaveLength(5);
    expect(mockGenerateContent).toHaveBeenCalledTimes(5);
  });

  it('passes tools and toolConfig in API calls', async () => {
    mockGenerateContent.mockResolvedValueOnce(mockTextResponse('ok'));

    const session = createSession();
    await ai.ask(session, 'test');

    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.config.tools).toBeDefined();
    expect(call.config.tools[0].functionDeclarations).toBeDefined();
    expect(call.config.toolConfig.functionCallingConfig.mode).toBe('AUTO');
  });

  it('cancellation prevents further API calls', async () => {
    let stale = false;
    mockGenerateContent
      .mockResolvedValueOnce(mockFunctionCallResponse([
        { id: 'c1', name: 'move', args: { param: 'brightness', target: { absolute: 0.5 } } },
      ]));

    const session = createSession();
    const actions = await ai.ask(session, 'test', {
      isStale: () => {
        // Become stale after first call
        const wasStale = stale;
        stale = true;
        return wasStale;
      },
    });

    // First round proceeds, second round is cancelled
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(actions.filter(a => a.type === 'move')).toHaveLength(1);
  });

  it('stale request does not store exchange in history', async () => {
    // First normal call to populate history
    mockGenerateContent.mockResolvedValueOnce(mockTextResponse('first reply'));
    const session = createSession();
    await ai.ask(session, 'hello');

    // Second call becomes stale immediately — isStale() returns true before
    // the first API call, so the loop never fires callWithTools
    await ai.ask(session, 'stale message', { isStale: () => true });
    // Only 1 API call happened (first ask), stale ask made 0
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);

    // Third call — check that history only has the first exchange
    mockGenerateContent.mockResolvedValueOnce(mockTextResponse('ok'));
    await ai.ask(session, 'third');

    // Second API call (index 1) is from the third ask()
    const thirdCall = mockGenerateContent.mock.calls[1][0];
    const contents = thirdCall.contents;

    // Should have: 1 exchange (user + model) + 1 current turn = 3
    // NOT 2 exchanges (5 entries) — the stale one should be absent
    expect(contents).toHaveLength(3);
    expect(contents[0].parts[0].text).toBe('hello');
  });

  it('returns error response for move with missing param', async () => {
    mockGenerateContent
      .mockResolvedValueOnce(mockFunctionCallResponse([
        { id: 'c1', name: 'move', args: { target: { absolute: 0.5 } } },
      ]))
      .mockResolvedValueOnce(mockTextResponse('Sorry about that.'));

    const session = createSession();
    const actions = await ai.ask(session, 'move something');

    // No move action collected — validation failed
    expect(actions.filter(a => a.type === 'move')).toHaveLength(0);
    // Model got error response and replied with text
    expect(actions.filter(a => a.type === 'say')).toHaveLength(1);
  });

  it('returns error response for move with missing target', async () => {
    mockGenerateContent
      .mockResolvedValueOnce(mockFunctionCallResponse([
        { id: 'c1', name: 'move', args: { param: 'brightness' } },
      ]))
      .mockResolvedValueOnce(mockTextResponse('I need a target value.'));

    const session = createSession();
    const actions = await ai.ask(session, 'brighten');

    expect(actions.filter(a => a.type === 'move')).toHaveLength(0);
  });

  it('returns error response for sketch with missing trackId', async () => {
    mockGenerateContent
      .mockResolvedValueOnce(mockFunctionCallResponse([
        { id: 'c1', name: 'sketch', args: { description: 'kick', events: [] } },
      ]))
      .mockResolvedValueOnce(mockTextResponse('Which track?'));

    const session = createSession();
    const actions = await ai.ask(session, 'make a pattern');

    expect(actions.filter(a => a.type === 'sketch')).toHaveLength(0);
  });

  it('returns error response for sketch with non-array events', async () => {
    mockGenerateContent
      .mockResolvedValueOnce(mockFunctionCallResponse([
        { id: 'c1', name: 'sketch', args: { trackId: 'v0', description: 'kick', events: 'not-array' } },
      ]))
      .mockResolvedValueOnce(mockTextResponse('Let me fix that.'));

    const session = createSession();
    const actions = await ai.ask(session, 'make a kick');

    expect(actions.filter(a => a.type === 'sketch')).toHaveLength(0);
  });

  it('returns error response for set_transport with no valid fields', async () => {
    mockGenerateContent
      .mockResolvedValueOnce(mockFunctionCallResponse([
        { id: 'c1', name: 'set_transport', args: {} },
      ]))
      .mockResolvedValueOnce(mockTextResponse('What should I change?'));

    const session = createSession();
    const actions = await ai.ask(session, 'change transport');

    expect(actions.filter(a => a.type === 'set_transport')).toHaveLength(0);
  });

  it('validateAction rejection prevents action collection and returns error to model', async () => {
    mockGenerateContent
      .mockResolvedValueOnce(mockFunctionCallResponse([
        { id: 'c1', name: 'move', args: { param: 'brightness', target: { absolute: 0.7 }, trackId: 'v0' } },
      ]))
      .mockResolvedValueOnce(mockTextResponse('That track has agency off, sorry.'));

    const session = createSession();
    const actions = await ai.ask(session, 'brighten the kick', {
      validateAction: () => 'Track v0 has agency OFF',
    });

    // Move was NOT collected — validator rejected it
    expect(actions.filter(a => a.type === 'move')).toHaveLength(0);
    // Model got the error and replied with text
    expect(actions.filter(a => a.type === 'say')).toHaveLength(1);
  });

  it('validateAction null allows action to be collected', async () => {
    mockGenerateContent
      .mockResolvedValueOnce(mockFunctionCallResponse([
        { id: 'c1', name: 'move', args: { param: 'brightness', target: { absolute: 0.7 }, trackId: 'v0' } },
      ]))
      .mockResolvedValueOnce(mockTextResponse('Done.'));

    const session = createSession();
    const actions = await ai.ask(session, 'brighten the kick', {
      validateAction: () => null,
    });

    expect(actions.filter(a => a.type === 'move')).toHaveLength(1);
  });

  it('validateAction rejection on sketch prevents collection', async () => {
    mockGenerateContent
      .mockResolvedValueOnce(mockFunctionCallResponse([
        { id: 'c1', name: 'sketch', args: {
          trackId: 'v0', description: 'kick pattern',
          events: [{ kind: 'trigger', at: 0, velocity: 1.0 }],
        } },
      ]))
      .mockResolvedValueOnce(mockTextResponse('Cannot edit that track.'));

    const session = createSession();
    const actions = await ai.ask(session, 'make a kick pattern', {
      validateAction: (a) => a.type === 'sketch' ? 'Track v0 has agency OFF' : null,
    });

    expect(actions.filter(a => a.type === 'sketch')).toHaveLength(0);
    expect(actions.filter(a => a.type === 'say')).toHaveLength(1);
  });
});
