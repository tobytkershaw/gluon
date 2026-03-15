// src/ai/providers/openai-planner.ts — PlannerProvider for OpenAI (Responses API).

import OpenAI from 'openai';
import type { Response, ResponseInput, ResponseInputItem, ResponseFunctionToolCall } from 'openai/resources/responses/responses';
import type { PlannerProvider, GenerateResult, FunctionResponse, ToolSchema, NeutralFunctionCall } from '../types';
import { ProviderError } from '../types';
import { toOpenAITools } from './schema-converters';

const MODEL = 'gpt-5.4';

interface BackoffState {
  until: number;
  delay: number;
}

export class OpenAIPlannerProvider implements PlannerProvider {
  readonly name = 'openai';
  private client: OpenAI | null;
  private backoff: BackoffState = { until: 0, delay: 0 };

  // Exchange-aware history via response ID chain.
  // Each entry is the response ID for one committed exchange.
  private responseIds: string[] = [];
  private pendingResponseId: string | null = null;

  // Pending input items for the current turn (user message + function_call_output items).
  private pendingInput: ResponseInput = [];

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
    this.responseIds.push(this.pendingResponseId);
    this.pendingResponseId = null;
    this.pendingInput = [];
  }

  discardTurn(): void {
    this.pendingResponseId = null;
    this.pendingInput = [];
  }

  trimHistory(maxExchanges: number): void {
    if (this.responseIds.length <= maxExchanges) return;
    this.responseIds = this.responseIds.slice(-maxExchanges);
  }

  clearHistory(): void {
    this.responseIds = [];
    this.pendingResponseId = null;
    this.pendingInput = [];
    this.backoff = { until: 0, delay: 0 };
  }

  private async generate(systemPrompt: string, tools: ToolSchema[], extraInput: ResponseInput = []): Promise<GenerateResult> {
    if (!this.client) throw new ProviderError('API not configured.', 'auth');

    const now = Date.now();
    if (now < this.backoff.until) {
      throw new ProviderError('Rate limited — backing off.', 'rate_limited', this.backoff.until - now);
    }

    // Chain from either the in-flight response (mid-turn continuation)
    // or the last committed exchange (new turn).
    const previousId = this.pendingResponseId ?? this.responseIds.at(-1) ?? undefined;

    const openaiTools = toOpenAITools(tools);
    const input = [...this.pendingInput, ...extraInput];

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
    // Clear pending input — extraInput items are now part of the server-side
    // chain via previous_response_id. Subsequent continueTurn calls build fresh.
    this.pendingInput = [];

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
