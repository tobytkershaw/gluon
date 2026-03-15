// src/ai/providers/gemini-planner.ts — PlannerProvider for Google Gemini.

import { GoogleGenAI, createPartFromFunctionResponse, FunctionCallingConfigMode } from '@google/genai';
import type { Content, Part } from '@google/genai';
import type { PlannerProvider, GenerateResult, FunctionResponse, ToolSchema, NeutralFunctionCall } from '../types';
import { ProviderError } from '../types';
import { toGeminiDeclarations } from './schema-converters';

const MODEL = 'gemini-2.5-flash';

interface BackoffState {
  until: number;
  delay: number;
}

interface ExchangeBoundary {
  contentCount: number;
}

export class GeminiPlannerProvider implements PlannerProvider {
  readonly name = 'gemini';
  private ai: GoogleGenAI | null;
  private backoff: BackoffState = { until: 0, delay: 0 };

  private permanentContents: Content[] = [];
  private pendingContents: Content[] = [];
  private exchangeBoundaries: ExchangeBoundary[] = [];

  constructor(apiKey: string) {
    this.ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
  }

  isConfigured(): boolean {
    return this.ai !== null;
  }

  async startTurn(opts: {
    systemPrompt: string;
    userMessage: string;
    tools: ToolSchema[];
  }): Promise<GenerateResult> {
    const userContent: Content = { role: 'user', parts: [{ text: opts.userMessage }] };
    this.pendingContents = [userContent];

    return this.generate(opts.systemPrompt, opts.tools);
  }

  async continueTurn(opts: {
    systemPrompt: string;
    tools: ToolSchema[];
    functionResponses: FunctionResponse[];
  }): Promise<GenerateResult> {
    const parts: Part[] = opts.functionResponses.map(fr =>
      createPartFromFunctionResponse(fr.id, fr.name, fr.result),
    );
    this.pendingContents.push({ role: 'user', parts });

    return this.generate(opts.systemPrompt, opts.tools);
  }

  commitTurn(): void {
    if (this.pendingContents.length === 0) return;
    this.permanentContents.push(...this.pendingContents);
    this.exchangeBoundaries.push({ contentCount: this.pendingContents.length });
    this.pendingContents = [];
  }

  discardTurn(): void {
    this.pendingContents = [];
  }

  trimHistory(maxExchanges: number): void {
    if (this.exchangeBoundaries.length <= maxExchanges) return;

    const toDrop = this.exchangeBoundaries.length - maxExchanges;
    let contentsToDrop = 0;
    for (let i = 0; i < toDrop; i++) {
      contentsToDrop += this.exchangeBoundaries[i].contentCount;
    }

    this.permanentContents = this.permanentContents.slice(contentsToDrop);
    this.exchangeBoundaries = this.exchangeBoundaries.slice(toDrop);
  }

  clearHistory(): void {
    this.permanentContents = [];
    this.pendingContents = [];
    this.exchangeBoundaries = [];
    this.backoff = { until: 0, delay: 0 };
  }

  private async generate(systemPrompt: string, tools: ToolSchema[]): Promise<GenerateResult> {
    if (!this.ai) throw new ProviderError('API not configured.', 'auth');

    const now = Date.now();
    if (now < this.backoff.until) {
      throw new ProviderError('Rate limited — backing off.', 'rate_limited', this.backoff.until - now);
    }

    const contents = [...this.permanentContents, ...this.pendingContents];
    const geminiDeclarations = toGeminiDeclarations(tools);

    let response;
    try {
      response = await this.ai.models.generateContent({
        model: MODEL,
        contents: [...contents],
        config: {
          systemInstruction: systemPrompt,
          maxOutputTokens: 2048,
          tools: [{ functionDeclarations: geminiDeclarations }],
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.AUTO,
            },
          },
        },
      });
    } catch (error) {
      throw this.translateError(error);
    }

    this.backoff = { until: 0, delay: 0 };

    const candidate = response.candidates?.[0];
    const rawContent = candidate?.content;

    if (!rawContent || !Array.isArray(rawContent.parts) || rawContent.parts.length === 0) {
      return { textParts: [], functionCalls: [] };
    }

    const modelContent: Content = {
      role: rawContent.role ?? 'model',
      parts: rawContent.parts,
    };
    this.pendingContents.push(modelContent);

    const textParts: string[] = [];
    const functionCalls: NeutralFunctionCall[] = [];

    for (const part of modelContent.parts) {
      if (part.text && !('thought' in part && part.thought)) {
        textParts.push(part.text);
      }
    }

    if (response.functionCalls) {
      for (const fc of response.functionCalls) {
        functionCalls.push({
          id: fc.id ?? '',
          name: fc.name ?? '',
          args: (fc.args ?? {}) as Record<string, unknown>,
        });
      }
    }

    return { textParts, functionCalls };
  }

  private translateError(error: unknown): ProviderError {
    const msg = error instanceof Error ? error.message : String(error);
    const status = (error as { status?: number }).status
      ?? (error as { httpStatusCode?: number }).httpStatusCode;

    if (status === 429 || /rate.limit|quota|resource.exhausted/i.test(msg)) {
      const delay = Math.min(this.backoff.delay ? this.backoff.delay * 2 : 5_000, 120_000);
      this.backoff = { until: Date.now() + delay, delay };
      return new ProviderError(`Rate limited — backing off for ${Math.round(delay / 1000)}s.`, 'rate_limited', delay);
    }

    if (status === 401 || status === 403 || /api.key|unauthorized|forbidden/i.test(msg)) {
      return new ProviderError('API key invalid or missing permissions.', 'auth');
    }

    if (status && status >= 500) {
      const delay = 10_000;
      this.backoff = { until: Date.now() + delay, delay };
      return new ProviderError('API error — retrying shortly.', 'server', delay);
    }

    return new ProviderError(msg, 'unknown');
  }
}
