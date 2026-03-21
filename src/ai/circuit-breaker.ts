// src/ai/circuit-breaker.ts — Circuit breaker for agentic tool-call loops.
//
// Detects and blocks:
// - Repeated identical failing tool calls (same name + args hash)
// - Repeated identical successful mutation calls (same name + args hash)
// - Consecutive all-failure steps (model stuck in error loop)
// - Total call count exceeding budget

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface CircuitBreakerConfig {
  /** Max total tool calls per user request. Default 30. */
  maxTotalCalls: number;
  /** Max consecutive steps where ALL calls fail. Default 3. */
  maxConsecutiveFailures: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  maxTotalCalls: 30,
  maxConsecutiveFailures: 3,
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Tools that are read-only / observational — safe to call repeatedly with same args. */
const READ_ONLY_TOOLS = new Set([
  'listen', 'render', 'analyze', 'inspect_chain', 'report_bug', 'suggest_reactions', 'recall_memories',
]);

export interface CircuitBreakerState {
  /** Hashes of calls that returned errors. */
  failedCallHashes: Set<string>;
  /** Hashes of successful mutation calls (non-read-only tools). */
  successfulCallHashes: Set<string>;
  /** Number of consecutive steps where every call errored. */
  consecutiveAllFailSteps: number;
  /** Total tool calls executed so far. */
  totalCalls: number;
  /** Resolved config (frozen at creation). */
  config: CircuitBreakerConfig;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic hash key for a tool call (name + sorted args). */
export function callHash(name: string, args: Record<string, unknown>): string {
  // Sort keys for determinism.  JSON.stringify with sorted keys is sufficient
  // for shallow arg objects (which Gluon tools are).
  const sortedArgs = Object.keys(args)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => { acc[k] = args[k]; return acc; }, {});
  return `${name}::${JSON.stringify(sortedArgs)}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createCircuitBreaker(
  config?: Partial<CircuitBreakerConfig>,
): CircuitBreakerState {
  return {
    failedCallHashes: new Set(),
    successfulCallHashes: new Set(),
    consecutiveAllFailSteps: 0,
    totalCalls: 0,
    config: { ...DEFAULT_CONFIG, ...config },
  };
}

export interface StepOutcome {
  /** One entry per tool call in the step. */
  calls: Array<{
    name: string;
    args: Record<string, unknown>;
    errored: boolean;
  }>;
}

/**
 * Record the outcome of a completed step and return updated state.
 * Does not mutate the input state.
 */
export function recordStep(
  state: CircuitBreakerState,
  outcome: StepOutcome,
): CircuitBreakerState {
  const failedCallHashes = new Set(state.failedCallHashes);
  const successfulCallHashes = new Set(state.successfulCallHashes);
  let allFailed = outcome.calls.length > 0; // vacuously false if no calls

  for (const call of outcome.calls) {
    if (call.errored) {
      failedCallHashes.add(callHash(call.name, call.args));
    } else {
      allFailed = false;
      // Track successful mutation calls so we can detect duplicate invocations
      if (!READ_ONLY_TOOLS.has(call.name)) {
        successfulCallHashes.add(callHash(call.name, call.args));
      }
    }
  }

  return {
    ...state,
    failedCallHashes,
    successfulCallHashes,
    consecutiveAllFailSteps: allFailed
      ? state.consecutiveAllFailSteps + 1
      : 0,
    totalCalls: state.totalCalls + outcome.calls.length,
  };
}

/**
 * Check whether a specific tool call has already failed with these exact args.
 * Used to short-circuit repeated failing calls with a synthetic error.
 */
export function isRepeatedFailure(
  state: CircuitBreakerState,
  name: string,
  args: Record<string, unknown>,
): boolean {
  return state.failedCallHashes.has(callHash(name, args));
}

/**
 * Check whether a mutation tool call already succeeded with these exact args.
 * Used to short-circuit redundant add/remove loops where the model doesn't
 * realize an operation already completed (e.g. adding a processor that's
 * already on the track). Read-only tools are never flagged.
 */
export function isRepeatedSuccess(
  state: CircuitBreakerState,
  name: string,
  args: Record<string, unknown>,
): boolean {
  if (READ_ONLY_TOOLS.has(name)) return false;
  return state.successfulCallHashes.has(callHash(name, args));
}

export interface BreakerVerdict {
  blocked: boolean;
  reason?: string;
}

/**
 * Check whether the turn should be terminated after recording a step.
 */
export function isBlocked(state: CircuitBreakerState): BreakerVerdict {
  if (state.totalCalls >= state.config.maxTotalCalls) {
    return {
      blocked: true,
      reason: `Reached the tool call limit (${state.config.maxTotalCalls}). Wrapping up with what's been done so far.`,
    };
  }
  if (state.consecutiveAllFailSteps >= state.config.maxConsecutiveFailures) {
    return {
      blocked: true,
      reason: `${state.consecutiveAllFailSteps} consecutive steps failed. Stopping to avoid a loop — try a different approach.`,
    };
  }
  return { blocked: false };
}
