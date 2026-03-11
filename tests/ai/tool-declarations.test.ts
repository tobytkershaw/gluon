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
  it('exports four tool declarations', () => {
    expect(GLUON_TOOLS).toHaveLength(4);
  });

  it('declares move, sketch, listen, set_transport', () => {
    const names = GLUON_TOOLS.map(t => t.name);
    expect(names).toContain('move');
    expect(names).toContain('sketch');
    expect(names).toContain('listen');
    expect(names).toContain('set_transport');
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

  it('sketch tool requires voiceId, description, events', () => {
    const sketch = GLUON_TOOLS.find(t => t.name === 'sketch')!;
    expect(sketch.parameters?.required).toEqual(['voiceId', 'description', 'events']);
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
        id: 'call-1', name: 'move', args: { param: 'brightness', target: { absolute: 0.7 }, voiceId: 'v0' },
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
      voiceId: 'v0',
    });
  });

  it('converts sketch function call to AISketchAction', async () => {
    mockGenerateContent
      .mockResolvedValueOnce(mockFunctionCallResponse([{
        id: 'call-1', name: 'sketch', args: {
          voiceId: 'v0', description: 'four on the floor',
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
      expect(sketchActions[0].voiceId).toBe('v0');
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
    expect(call.tools).toBeDefined();
    expect(call.tools[0].functionDeclarations).toBeDefined();
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
});
