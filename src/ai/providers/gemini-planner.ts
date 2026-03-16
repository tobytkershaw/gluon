// src/ai/providers/gemini-planner.ts — PlannerProvider for Google Gemini.

import { GoogleGenAI, createPartFromFunctionResponse, FunctionCallingConfigMode } from '@google/genai';
import type { Content, Part } from '@google/genai';
import type { PlannerProvider, GenerateResult, FunctionResponse, ToolSchema, NeutralFunctionCall, StreamTextCallback } from '../types';
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
    onStreamText?: StreamTextCallback;
  }): Promise<GenerateResult> {
    const userContent: Content = { role: 'user', parts: [{ text: opts.userMessage }] };
    this.pendingContents = [userContent];

    return this.generate(opts.systemPrompt, opts.tools, opts.onStreamText);
  }

  async continueTurn(opts: {
    systemPrompt: string;
    tools: ToolSchema[];
    functionResponses: FunctionResponse[];
    onStreamText?: StreamTextCallback;
  }): Promise<GenerateResult> {
    const parts: Part[] = opts.functionResponses.map(fr =>
      createPartFromFunctionResponse(fr.id, fr.name, fr.result),
    );
    this.pendingContents.push({ role: 'user', parts });

    return this.generate(opts.systemPrompt, opts.tools, opts.onStreamText);
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

  private async generate(systemPrompt: string, tools: ToolSchema[], onStreamText?: StreamTextCallback): Promise<GenerateResult> {
    if (!this.ai) throw new ProviderError('API not configured.', 'auth');

    const now = Date.now();
    if (now < this.backoff.until) {
      throw new ProviderError('Rate limited — backing off.', 'rate_limited', this.backoff.until - now);
    }

    const contents = [...this.permanentContents, ...this.pendingContents];
    const geminiDeclarations = toGeminiDeclarations(tools);

    const requestConfig = {
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
    };

    const textParts: string[] = [];
    const functionCalls: NeutralFunctionCall[] = [];
    const allParts: Part[] = [];

    if (onStreamText) {
      // Streaming path — emit text chunks as they arrive
      let stream: AsyncGenerator<import('@google/genai').GenerateContentResponse>;
      try {
        stream = await this.ai.models.generateContentStream(requestConfig);
      } catch (error) {
        throw this.translateError(error);
      }

      this.backoff = { until: 0, delay: 0 };

      // Track accumulated text parts for building the final array.
      // Each chunk may contribute to an existing text part or start a new one.
      let currentTextPartIndex = -1;

      try {
        for await (const chunk of stream) {
          const candidate = chunk.candidates?.[0];
          const parts = candidate?.content?.parts;
          if (!parts) continue;

          for (const part of parts) {
            allParts.push(part);

            if (part.text && !('thought' in part && part.thought)) {
              // Stream each text chunk immediately
              onStreamText(part.text);

              // Accumulate: each streamed chunk is a separate text fragment,
              // but they form a single logical text part within one response.
              if (currentTextPartIndex < 0) {
                textParts.push(part.text);
                currentTextPartIndex = textParts.length - 1;
              } else {
                textParts[currentTextPartIndex] += part.text;
              }
            }

            if (part.functionCall) {
              const fc = part.functionCall;
              functionCalls.push({
                id: (fc as { id?: string }).id ?? '',
                name: fc.name ?? '',
                args: (fc.args ?? {}) as Record<string, unknown>,
              });
              // After a function call, the next text (if any) starts a new text part
              currentTextPartIndex = -1;
            }
          }
        }
      } catch (error) {
        throw this.translateError(error);
      }
    } else {
      // Non-streaming path — unchanged behavior
      let response;
      try {
        response = await this.ai.models.generateContent(requestConfig);
      } catch (error) {
        throw this.translateError(error);
      }

      this.backoff = { until: 0, delay: 0 };

      const candidate = response.candidates?.[0];
      const rawContent = candidate?.content;

      if (!rawContent || !Array.isArray(rawContent.parts) || rawContent.parts.length === 0) {
        return { textParts: [], functionCalls: [] };
      }

      allParts.push(...rawContent.parts);

      for (const part of rawContent.parts) {
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
    }

    // Store the full model response in pending history
    if (allParts.length > 0) {
      const modelContent: Content = {
        role: 'model',
        parts: allParts,
      };
      this.pendingContents.push(modelContent);
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
