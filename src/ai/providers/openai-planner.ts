// src/ai/providers/openai-planner.ts — PlannerProvider for OpenAI (Responses API).

import OpenAI from 'openai';
import type { Response, ResponseInput, ResponseInputItem, ResponseOutputItem, ResponseFunctionToolCall } from 'openai/resources/responses/responses';
import type { PlannerProvider, GenerateResult, FunctionResponse, ToolSchema, NeutralFunctionCall } from '../types';
import { ProviderError } from '../types';
import { toOpenAITools } from './schema-converters';

const MODEL = 'gpt-5.4';

interface BackoffState {
  until: number;
  delay: number;
}

/** One committed exchange: the user input items + the model's response output. */
interface StoredExchange {
  /** Input items sent for this exchange (user message at minimum). */
  inputItems: ResponseInput;
  /** Output items returned by the model (messages, function calls, etc.). */
  outputItems: ResponseOutputItem[];
  /** Response ID — used for chaining when the history is unbroken. */
  responseId: string;
}

export class OpenAIPlannerProvider implements PlannerProvider {
  readonly name = 'openai';
  private client: OpenAI | null;
  private backoff: BackoffState = { until: 0, delay: 0 };

  // Committed exchange history with full content for replay after trimming.
  private exchanges: StoredExchange[] = [];
  // When true, the next request must replay stored exchanges as input
  // rather than chaining via previous_response_id (because trimHistory
  // broke the chain by dropping older exchanges).
  private chainBroken = false;

  private pendingResponseId: string | null = null;
  // Accumulated input items for the current in-flight turn.
  private pendingInput: ResponseInput = [];
  // Accumulated output items from model responses in the current turn.
  private pendingOutputItems: ResponseOutputItem[] = [];

  constructor(apiKey: string) {
    this.client = apiKey
      ? new OpenAI({ apiKey, dangerouslyAllowBrowser: true })
      : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async startTurn(opts: {
    systemPrompt: string;
    userMessage: string;
    tools: ToolSchema[];
  }): Promise<GenerateResult> {
    this.pendingInput = [
      { role: 'user', content: opts.userMessage },
    ];
    this.pendingResponseId = null;
    this.pendingOutputItems = [];

    return this.generate(opts.systemPrompt, opts.tools);
  }

  async continueTurn(opts: {
    systemPrompt: string;
    tools: ToolSchema[];
    functionResponses: FunctionResponse[];
  }): Promise<GenerateResult> {
    // Build new input items but don't mutate pendingInput until after the
    // API call succeeds. This keeps continueTurn atomic — on error, no
    // function_call_output items are left in pendingInput to be duplicated
    // if the caller retries.
    const newItems: ResponseInput = opts.functionResponses.map(fr => ({
      type: 'function_call_output',
      call_id: fr.id,
      output: JSON.stringify(fr.result),
    } as ResponseInputItem.FunctionCallOutput));

    return this.generate(opts.systemPrompt, opts.tools, newItems);
  }

  commitTurn(): void {
    if (this.pendingResponseId === null) return;
    this.exchanges.push({
      inputItems: [...this.pendingInput],
      outputItems: [...this.pendingOutputItems],
      responseId: this.pendingResponseId,
    });
    // After committing, the chain is valid from this new exchange.
    // If chainBroken was set, the successful commit re-establishes
    // a valid chain starting from this response.
    this.chainBroken = false;
    this.pendingResponseId = null;
    this.pendingInput = [];
    this.pendingOutputItems = [];
  }

  discardTurn(): void {
    this.pendingResponseId = null;
    this.pendingInput = [];
    this.pendingOutputItems = [];
  }

  trimHistory(maxExchanges: number): void {
    if (this.exchanges.length <= maxExchanges) return;
    this.exchanges = this.exchanges.slice(-maxExchanges);
    // The server-side chain from the oldest surviving exchange still
    // references the full prior history. We must break the chain and
    // replay only the surviving exchanges as input on the next request.
    this.chainBroken = true;
  }

  clearHistory(): void {
    this.exchanges = [];
    this.chainBroken = false;
    this.pendingResponseId = null;
    this.pendingInput = [];
    this.pendingOutputItems = [];
    this.backoff = { until: 0, delay: 0 };
  }

  private async generate(systemPrompt: string, tools: ToolSchema[], extraInput: ResponseInput = []): Promise<GenerateResult> {
    if (!this.client) throw new ProviderError('API not configured.', 'auth');

    const now = Date.now();
    if (now < this.backoff.until) {
      throw new ProviderError('Rate limited — backing off.', 'rate_limited', this.backoff.until - now);
    }

    const openaiTools = toOpenAITools(tools);
    let input: ResponseInput;
    let previousId: string | undefined;

    if (this.chainBroken || this.exchanges.length === 0) {
      // Replay stored exchanges as input items (bounded suffix).
      // No previous_response_id — we're reconstructing context from scratch.
      const replayItems: ResponseInput = [];
      for (const ex of this.exchanges) {
        replayItems.push(...ex.inputItems);
        // Output items (messages, function calls) are valid ResponseInputItems
        // and must be replayed to reconstruct the conversation.
        replayItems.push(...(ex.outputItems as unknown as ResponseInput));
      }
      input = [...replayItems, ...this.pendingInput, ...extraInput];
      // Chain from pending response if mid-turn, otherwise no chain.
      previousId = this.pendingResponseId ?? undefined;
    } else {
      // Chain from the last committed or in-flight response.
      previousId = this.pendingResponseId ?? this.exchanges.at(-1)?.responseId ?? undefined;
      input = [...this.pendingInput, ...extraInput];
    }

    let response: Response;
    try {
      response = await this.client.responses.create({
        model: MODEL,
        instructions: systemPrompt,
        input,
        tools: openaiTools,
        max_output_tokens: 2048,
        ...(previousId ? { previous_response_id: previousId } : {}),
      });
    } catch (error) {
      throw this.translateError(error);
    }

    // Only commit state after a successful API call.
    this.backoff = { until: 0, delay: 0 };
    this.pendingResponseId = response.id;
    // Accumulate all input and output items for this turn so commitTurn
    // can store the full exchange.
    this.pendingInput = [...this.pendingInput, ...extraInput];
    this.pendingOutputItems.push(...response.output);

    const textParts: string[] = [];
    const functionCalls: NeutralFunctionCall[] = [];

    for (const item of response.output) {
      if (item.type === 'message') {
        for (const content of item.content) {
          if (content.type === 'output_text' && content.text) {
            textParts.push(content.text);
          }
        }
      } else if (item.type === 'function_call') {
        const fc = item as ResponseFunctionToolCall;
        functionCalls.push({
          id: fc.call_id,
          name: fc.name,
          args: JSON.parse(fc.arguments),
        });
      }
    }

    return { textParts, functionCalls };
  }

  private translateError(error: unknown): ProviderError {
    if (error instanceof OpenAI.RateLimitError) {
      const delay = Math.min(this.backoff.delay ? this.backoff.delay * 2 : 5_000, 120_000);
      this.backoff = { until: Date.now() + delay, delay };
      return new ProviderError(
        `Rate limited — backing off for ${Math.round(delay / 1000)}s.`,
        'rate_limited',
        delay,
      );
    }

    if (error instanceof OpenAI.AuthenticationError) {
      return new ProviderError('API key invalid or missing permissions.', 'auth');
    }

    if (error instanceof OpenAI.InternalServerError) {
      const delay = 10_000;
      this.backoff = { until: Date.now() + delay, delay };
      return new ProviderError('API error — retrying shortly.', 'server', delay);
    }

    const msg = error instanceof Error ? error.message : String(error);
    return new ProviderError(msg, 'unknown');
  }
}
