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

/**
 * Executes a batch of AI actions against real session state.
 * Provided by the UI/host to askStreaming so GluonAI can apply actions
 * without depending on engine internals (adapter, arbitrator).
 */
export type StepExecutor = (
  session: import('../engine/types').Session,
  actions: import('../engine/types').AIAction[],
) => import('../engine/operation-executor').StepExecutionReport;

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

  // ---------------------------------------------------------------------------
  // Token-budget-aware context management (Phase 1a, #785)
  // ---------------------------------------------------------------------------

  /**
   * Count the total input tokens for the current context: system prompt,
   * tools, committed history, and pending contents. Uses the provider's
   * native token counting API (e.g. Gemini countTokens).
   * Optional — providers that don't support it fall back to exchange-count trimming.
   */
  countContextTokens?(systemPrompt: string, tools: ToolSchema[], upcomingUserMessage?: string): Promise<number>;

  /**
   * Provider-specific token budget ceiling. Should stay under pricing thresholds
   * (e.g. 200K for Gemini where input cost doubles).
   */
  getTokenBudget?(): number;

  /**
   * Return token usage from the most recent generate() call, if available.
   */
  getLastTokenUsage?(): { promptTokens: number; outputTokens: number; cachedTokens: number } | null;

  /**
   * Return the current number of committed exchanges in the provider's history.
   */
  getExchangeCount?(): number;

  // ---------------------------------------------------------------------------
  // LLM-summarized context trimming (Phase 2, #785)
  // ---------------------------------------------------------------------------

  /**
   * Summarize exchanges about to be dropped, then trim history.
   * Provider owns the LLM call (has SDK access). Summary stored internally.
   * Optional — providers without support fall back to plain trimHistory.
   */
  summarizeBeforeTrim?(droppedMessages: ChatMessage[], keepCount: number): Promise<void>;

  /** Retrieve the current context summary for injection into user messages. */
  getContextSummary?(): string | null;
}

// ---------------------------------------------------------------------------
// Step-based execution types (#945)
// ---------------------------------------------------------------------------

/** Tool-call callback signature (fired for each tool invocation). */
export type ToolCallCallback = (name: string, args: Record<string, unknown>) => void;

/** Result of one step (one model round) in the agentic loop. Immutable once created. */
export interface StepResult {
  /** Text parts from this round (displayed as streaming say text). */
  textParts: string[];
  /** All actions produced by this step (including 'say'). */
  actions: import('../engine/types').AIAction[];
  /** Execution report from applying actionable (non-say) actions, or null if none. */
  executionReport: import('../engine/operation-executor').StepExecutionReport | null;
  /** Function responses to pass back to the planner for continueTurn. */
  functionResponses: FunctionResponse[];
  /** True when the model returned no function calls (natural completion). */
  done: boolean;
  /** True if the model response was truncated due to length limits. */
  truncated: boolean;
  /** AI-suggested contextual reaction chips from this step (via suggest_reactions tool). */
  suggestedReactions?: string[];
}

/**
 * Callback invoked after each step so the UI can render progress.
 * GluonAI owns the session state — the callback receives an immutable
 * snapshot of the updated session for rendering purposes only.
 */
export type OnStepCallback = (
  stepResult: StepResult,
  updatedSession: import('../engine/types').Session,
) => void;

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
