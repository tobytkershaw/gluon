// src/ai/types.ts — Neutral provider interfaces for multi-model AI stack.

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

export interface PlannerProvider {
  readonly name: string;
  isConfigured(): boolean;

  startTurn(opts: {
    systemPrompt: string;
    userMessage: string;
    tools: ToolSchema[];
  }): Promise<GenerateResult>;

  continueTurn(opts: {
    systemPrompt: string;
    tools: ToolSchema[];
    functionResponses: FunctionResponse[];
  }): Promise<GenerateResult>;

  commitTurn(): void;
  discardTurn(): void;
  trimHistory(maxExchanges: number): void;
  clearHistory(): void;
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
