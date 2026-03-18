// src/ai/types.ts — Neutral provider interfaces for multi-model AI stack.

import type { ChatMessage } from '../engine/types';

/** Standard JSON Schema (draft-compatible subset used by OpenAI function calling). */
export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  description?: string;
  enum?: (string | number | boolean | null)[];
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  nullable?: boolean;
  default?: unknown;
  [key: string]: unknown;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: JsonSchema;
}

// ---------------------------------------------------------------------------
// Provider error model
// ---------------------------------------------------------------------------

export type ProviderErrorKind = 'rate_limited' | 'auth' | 'server' | 'unknown';

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: ProviderErrorKind,
    public readonly retryAfterMs: number = 0,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

// ---------------------------------------------------------------------------
// Planner interface
// ---------------------------------------------------------------------------

export interface GenerateResult {
  textParts: string[];
  functionCalls: NeutralFunctionCall[];
  truncated?: boolean;
}

export interface NeutralFunctionCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface FunctionResponse {
  id: string;
  name: string;
  result: Record<string, unknown>;
}

/** Called with each text chunk as it arrives from the model during streaming. */
export type StreamTextCallback = (chunk: string) => void;

export interface PlannerProvider {
  readonly name: string;
  isConfigured(): boolean;

  startTurn(opts: {
    systemPrompt: string;
    userMessage: string;
    tools: ToolSchema[];
    onStreamText?: StreamTextCallback;
  }): Promise<GenerateResult>;

  continueTurn(opts: {
    systemPrompt: string;
    tools: ToolSchema[];
    functionResponses: FunctionResponse[];
    onStreamText?: StreamTextCallback;
  }): Promise<GenerateResult>;

  commitTurn(): void;
  discardTurn(): void;
  trimHistory(maxExchanges: number): void;
  clearHistory(): void;

  /**
   * Restore conversational context from persisted chat messages.
   * Called on project load to reconstruct the provider's in-memory history
   * from the ChatMessage array stored in IndexedDB. Only the most recent
   * exchanges are restored to avoid context bloat.
   * Optional — providers that don't support it simply don't implement it.
   */
  restoreHistory?(messages: ChatMessage[]): void;

  /**
   * Consume any restored conversation context as a text prefix.
   * Used by providers (like OpenAI) that can't replay exchanges but can
   * prepend a summary to the first user message. Returns null if none.
   */
  consumeConversationContext?(): string | null;
}

// ---------------------------------------------------------------------------
// Listener interface
// ---------------------------------------------------------------------------

export interface ListenerProvider {
  readonly name: string;
  isConfigured(): boolean;

  evaluate(opts: {
    systemPrompt: string;
    stateJson: string;
    question: string;
    audioData: Blob;
    mimeType: string;
  }): Promise<string>;
}
