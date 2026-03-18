// src/ai/providers/gemini-planner.ts — PlannerProvider for Google Gemini.

import { GoogleGenAI, createPartFromFunctionResponse, FunctionCallingConfigMode } from '@google/genai';
import type { Content, Part } from '@google/genai';
import type { PlannerProvider, GenerateResult, FunctionResponse, ToolSchema, NeutralFunctionCall, StreamTextCallback } from '../types';
import { ProviderError } from '../types';
import type { ChatMessage } from '../../engine/types';
import { toGeminiDeclarations } from './schema-converters';

const MODEL = 'gemini-3.1-pro-preview-customtools';

/** Token budget ceiling — stay under the 200K Gemini pricing threshold. */
const TOKEN_BUDGET = 170_000;

interface BackoffState {
  until: number;
  delay: number;
}

interface ExchangeBoundary {
  contentCount: number;
}

interface TokenUsage {
  promptTokens: number;
  outputTokens: number;
}

export class GeminiPlannerProvider implements PlannerProvider {
  readonly name = 'gemini';
  private ai: GoogleGenAI | null;
  private backoff: BackoffState = { until: 0, delay: 0 };

  private permanentContents: Content[] = [];
  private pendingContents: Content[] = [];
  private exchangeBoundaries: ExchangeBoundary[] = [];
  private lastUsage: TokenUsage | null = null;

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

  restoreHistory(messages: ChatMessage[]): void {
    this.clearHistory();

    const MAX_RESTORED = 20;
    const pairs: Array<{ human: string; ai: string }> = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === 'human') {
        const aiMsg = messages.slice(i + 1).find(m => m.role === 'ai');
        if (aiMsg) {
          pairs.push({ human: msg.text, ai: aiMsg.text });
        }
      }
    }

    const recent = pairs.slice(-MAX_RESTORED);
    for (const pair of recent) {
      const userContent: Content = { role: 'user', parts: [{ text: pair.human }] };
      const modelContent: Content = { role: 'model', parts: [{ text: pair.ai }] };
      this.permanentContents.push(userContent, modelContent);
      this.exchangeBoundaries.push({ contentCount: 2 });
    }
  }

  // ---------------------------------------------------------------------------
  // Token-budget-aware context management (Phase 1a, #785)
  // ---------------------------------------------------------------------------

  async countContextTokens(systemPrompt: string, tools: ToolSchema[]): Promise<number> {
    if (!this.ai) throw new ProviderError('API not configured.', 'auth');

    const contents = [...this.permanentContents, ...this.pendingContents];
    const geminiDeclarations = toGeminiDeclarations(tools);

    // Count system prompt tokens separately — the countTokens endpoint on the
    // Gemini Developer API does not support the systemInstruction config param.
    const sysResult = await this.ai.models.countTokens({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
    });

    // On the first turn, contents is empty — Gemini's countTokens API requires
    // at least one content entry (#917). Only system prompt tokens matter here.
    if (contents.length === 0) {
      return sysResult.totalTokens ?? 0;
    }

    const msgResult = await this.ai.models.countTokens({
      model: MODEL,
      contents,
      config: {
        tools: [{ functionDeclarations: geminiDeclarations }],
      },
    });

    return (sysResult.totalTokens ?? 0) + (msgResult.totalTokens ?? 0);
  }

  getTokenBudget(): number {
    return TOKEN_BUDGET;
  }

  getLastTokenUsage(): TokenUsage | null {
    return this.lastUsage;
  }

  getExchangeCount(): number {
    return this.exchangeBoundaries.length;
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
        maxOutputTokens: 16384,
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
    // Raw parts from the model response, preserved exactly as received.
    // Gemini 3.1+ attaches thoughtSignature properties to functionCall parts;
    // these must be echoed back verbatim in conversation history.
    const rawModelParts: Part[] = [];

    let truncated = false;

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
      let lastFinishReason: string | undefined;
      let lastUsageMetadata: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;

      try {
        for await (const chunk of stream) {
          const candidate = chunk.candidates?.[0];
          if (candidate?.finishReason) {
            lastFinishReason = candidate.finishReason as string;
          }
          // usageMetadata typically arrives on the final chunk
          if (chunk.usageMetadata) {
            lastUsageMetadata = chunk.usageMetadata;
          }
          const parts = candidate?.content?.parts;
          if (!parts) continue;

          for (const part of parts) {
            // Preserve every raw part for history (includes thoughtSignature etc.)
            rawModelParts.push(part);

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
            } else if (part.functionCall) {
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

      if (lastFinishReason === 'MAX_TOKENS') {
        truncated = true;
      }

      // Track token usage from streaming response
      if (lastUsageMetadata) {
        this.lastUsage = {
          promptTokens: lastUsageMetadata.promptTokenCount ?? 0,
          outputTokens: lastUsageMetadata.candidatesTokenCount ?? 0,
        };
        console.debug(
          `[gluon-ai] token usage: prompt=${this.lastUsage.promptTokens}, output=${this.lastUsage.outputTokens}`,
        );
      }
    } else {
      // Non-streaming path
      let response;
      try {
        response = await this.ai.models.generateContent(requestConfig);
      } catch (error) {
        throw this.translateError(error);
      }

      this.backoff = { until: 0, delay: 0 };

      // Track token usage from non-streaming response
      if (response.usageMetadata) {
        this.lastUsage = {
          promptTokens: response.usageMetadata.promptTokenCount ?? 0,
          outputTokens: response.usageMetadata.candidatesTokenCount ?? 0,
        };
        console.debug(
          `[gluon-ai] token usage: prompt=${this.lastUsage.promptTokens}, output=${this.lastUsage.outputTokens}`,
        );
      }

      const candidate = response.candidates?.[0];
      if (candidate?.finishReason === 'MAX_TOKENS') {
        truncated = true;
      }
      const rawContent = candidate?.content;

      if (!rawContent || !Array.isArray(rawContent.parts) || rawContent.parts.length === 0) {
        return { textParts: [], functionCalls: [], truncated };
      }

      // Preserve all raw parts verbatim for history (thoughtSignature etc.)
      rawModelParts.push(...rawContent.parts);

      for (const part of rawContent.parts) {
        if (part.text && !('thought' in part && part.thought)) {
          textParts.push(part.text);
        } else if (part.functionCall) {
          const fc = part.functionCall;
          functionCalls.push({
            id: (fc as { id?: string }).id ?? '',
            name: fc.name ?? '',
            args: (fc.args ?? {}) as Record<string, unknown>,
          });
        }
      }
    }

    // Store raw model parts in pending history exactly as received.
    // This preserves thoughtSignature and other opaque properties that
    // Gemini 3.1+ requires to be echoed back for multi-turn function calling.
    if (rawModelParts.length > 0) {
      this.pendingContents.push({ role: 'model', parts: rawModelParts });
    }

    // Deduplicate identical function calls (Gemini sometimes returns duplicates)
    const dedupedCalls = deduplicateFunctionCalls(functionCalls);

    return { textParts, functionCalls: dedupedCalls, truncated };
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
      return new ProviderError('API error — please try again.', 'server', delay);
    }

    return new ProviderError(msg, 'unknown');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Remove exact-duplicate function calls (same name + same args via JSON key). */
export function deduplicateFunctionCalls(calls: NeutralFunctionCall[]): NeutralFunctionCall[] {
  const seen = new Set<string>();
  const deduped = calls.filter(fc => {
    const key = JSON.stringify({ name: fc.name, args: fc.args });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (deduped.length < calls.length) {
    console.debug(
      `[gluon-ai] deduplicated ${calls.length - deduped.length} identical function call(s)`,
    );
  }
  return deduped;
}
