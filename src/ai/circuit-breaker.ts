// src/ai/circuit-breaker.ts — Circuit breaker for agentic tool-call loops.
//
// Detects and blocks:
// - Repeated identical failing tool calls (same name + args hash)
// - Consecutive all-failure steps (model stuck in error loop)
// - Total call count exceeding budget

import type { NeutralFunctionCall } from './types';

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

export interface CircuitBreakerState {
  /** Hashes of calls that returned errors. */
  failedCallHashes: Set<string>;
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
    consecutiveAllFailSteps: 0,
    totalCalls: 0,
    config: { ...DEFAULT_CONFIG, ...config },
  };
}

/**
 * Check whether a set of calls should be blocked BEFORE execution.
 * Returns per-call verdicts: blocked calls get a synthetic error message,
 * unblocked calls get null.
 */
export function preCheckCalls(
  state: CircuitBreakerState,
  calls: NeutralFunctionCall[],
): Map<string, string | null> {
  const verdicts = new Map<string, string | null>();
  for (const call of calls) {
    const hash = callHash(call.name, call.args);
    if (state.failedCallHashes.has(hash)) {
      verdicts.set(
        call.id,
        `This operation already failed with these exact arguments. Try a different approach.`,
      );
    } else {
      verdicts.set(call.id, null);
    }
  }
  return verdicts;
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
  let allFailed = outcome.calls.length > 0; // vacuously false if no calls

  for (const call of outcome.calls) {
    if (call.errored) {
      failedCallHashes.add(callHash(call.name, call.args));
    } else {
      allFailed = false;
    }
  }

  return {
    ...state,
    failedCallHashes,
    consecutiveAllFailSteps: allFailed
      ? state.consecutiveAllFailSteps + 1
      : 0,
    totalCalls: state.totalCalls + outcome.calls.length,
  };
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
