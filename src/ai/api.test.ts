import { describe, expect, it } from 'vitest';
import { GluonAI } from './api';
import { createSession } from '../engine/session';
import type {
  FunctionResponse,
  GenerateResult,
  PlannerProvider,
  StreamTextCallback,
  ToolSchema,
  StepExecutor,
} from './types';

class StubPlanner implements PlannerProvider {
  readonly name = 'stub';
  continueTurnStreamCallback: StreamTextCallback | undefined;

  isConfigured(): boolean {
    return true;
  }

  async startTurn(opts: {
    systemPrompt: string;
    userMessage: string;
    tools: ToolSchema[];
    onStreamText?: StreamTextCallback;
  }): Promise<GenerateResult> {
    opts.onStreamText?.('first');
    return {
      textParts: [],
      functionCalls: [
        {
          id: 'call-1',
          name: 'move',
          args: { param: 'timbre', target: { absolute: 0.7 } },
        },
      ],
    };
  }

  async continueTurn(opts: {
    systemPrompt: string;
    tools: ToolSchema[];
    functionResponses: FunctionResponse[];
    onStreamText?: StreamTextCallback;
  }): Promise<GenerateResult> {
    this.continueTurnStreamCallback = opts.onStreamText;
    opts.onStreamText?.('continued');
    return {
      textParts: ['done'],
      functionCalls: [],
    };
  }

  commitTurn(): void {}
  discardTurn(): void {}
  trimHistory(): void {}
  clearHistory(): void {}
}

const noopExecutor: StepExecutor = (session, actions) => ({
  session,
  accepted: actions,
  rejected: [],
  log: [],
  sayTexts: [],
  resolvedParams: new Map(),
  preservationReports: [],
});

describe('GluonAI streaming', () => {
  it('passes the stream callback into continueTurn rounds', async () => {
    const planner = new StubPlanner();
    const ai = new GluonAI(planner, { name: 'listener', isConfigured: () => true, evaluate: async () => '' });
    const chunks: string[] = [];

    await ai.askStreaming(
      createSession(),
      'make it brighter',
      { onStreamText: (chunk) => chunks.push(chunk) },
      noopExecutor,
    );

    expect(planner.continueTurnStreamCallback).toBeTypeOf('function');
    expect(chunks).toEqual(['first', 'continued']);
  });
});
