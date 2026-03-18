// tests/ai/circuit-breaker.test.ts — Circuit breaker unit tests
import { describe, it, expect } from 'vitest';
import {
  createCircuitBreaker,
  recordStep,
  isBlocked,
  isRepeatedFailure,
  callHash,
} from '../../src/ai/circuit-breaker';

describe('circuit breaker', () => {
  it('starts unblocked', () => {
    const breaker = createCircuitBreaker();
    expect(isBlocked(breaker).blocked).toBe(false);
  });

  it('callHash is deterministic and order-independent for args', () => {
    expect(callHash('move', { a: 1, b: 2 })).toBe(callHash('move', { b: 2, a: 1 }));
    expect(callHash('move', { a: 1 })).not.toBe(callHash('sketch', { a: 1 }));
  });

  it('blocks after maxConsecutiveFailures all-fail steps', () => {
    let breaker = createCircuitBreaker({ maxConsecutiveFailures: 3 });

    // 3 consecutive all-fail steps
    for (let i = 0; i < 3; i++) {
      breaker = recordStep(breaker, {
        calls: [{ name: 'move', args: { param: `p${i}` }, errored: true }],
      });
    }

    const check = isBlocked(breaker);
    expect(check.blocked).toBe(true);
    expect(check.reason).toContain('consecutive steps failed');
  });

  it('resets consecutive failure count on a successful step', () => {
    let breaker = createCircuitBreaker({ maxConsecutiveFailures: 3 });

    // 2 failures
    breaker = recordStep(breaker, {
      calls: [{ name: 'move', args: { param: 'a' }, errored: true }],
    });
    breaker = recordStep(breaker, {
      calls: [{ name: 'move', args: { param: 'b' }, errored: true }],
    });
    expect(breaker.consecutiveAllFailSteps).toBe(2);

    // 1 success resets
    breaker = recordStep(breaker, {
      calls: [{ name: 'move', args: { param: 'c' }, errored: false }],
    });
    expect(breaker.consecutiveAllFailSteps).toBe(0);
    expect(isBlocked(breaker).blocked).toBe(false);
  });

  it('blocks after maxTotalCalls', () => {
    let breaker = createCircuitBreaker({ maxTotalCalls: 5 });

    // 3 calls + 2 calls = 5 total
    breaker = recordStep(breaker, {
      calls: [
        { name: 'move', args: { param: 'a' }, errored: false },
        { name: 'sketch', args: { trackId: 'v0' }, errored: false },
        { name: 'move', args: { param: 'b' }, errored: false },
      ],
    });
    expect(isBlocked(breaker).blocked).toBe(false);

    breaker = recordStep(breaker, {
      calls: [
        { name: 'move', args: { param: 'c' }, errored: false },
        { name: 'move', args: { param: 'd' }, errored: false },
      ],
    });
    const check = isBlocked(breaker);
    expect(check.blocked).toBe(true);
    expect(check.reason).toContain('tool call limit');
  });

  it('tracks failed call hashes', () => {
    let breaker = createCircuitBreaker();

    breaker = recordStep(breaker, {
      calls: [
        { name: 'move', args: { param: 'timbre', target: 0.5 }, errored: true },
        { name: 'sketch', args: { trackId: 'v0' }, errored: false },
      ],
    });

    // The failed call hash should be tracked
    const failedHash = callHash('move', { param: 'timbre', target: 0.5 });
    expect(breaker.failedCallHashes.has(failedHash)).toBe(true);

    // The successful call should not be tracked
    const successHash = callHash('sketch', { trackId: 'v0' });
    expect(breaker.failedCallHashes.has(successHash)).toBe(false);
  });

  it('does not block when a step has mixed success and failure', () => {
    let breaker = createCircuitBreaker({ maxConsecutiveFailures: 2 });

    // Step with one success + one failure — not an all-fail step
    breaker = recordStep(breaker, {
      calls: [
        { name: 'move', args: { param: 'a' }, errored: true },
        { name: 'sketch', args: { trackId: 'v0' }, errored: false },
      ],
    });
    expect(breaker.consecutiveAllFailSteps).toBe(0);
  });

  it('treats empty call list as non-failure', () => {
    let breaker = createCircuitBreaker({ maxConsecutiveFailures: 1 });
    breaker = recordStep(breaker, { calls: [] });
    expect(breaker.consecutiveAllFailSteps).toBe(0);
    expect(isBlocked(breaker).blocked).toBe(false);
  });

  it('uses custom config', () => {
    const breaker = createCircuitBreaker({
      maxTotalCalls: 2,
      maxConsecutiveFailures: 1,
    });
    expect(breaker.config.maxTotalCalls).toBe(2);
    expect(breaker.config.maxConsecutiveFailures).toBe(1);
  });

  it('detects repeated failing calls', () => {
    let breaker = createCircuitBreaker();

    // No failure recorded yet — not a repeat
    expect(isRepeatedFailure(breaker, 'move', { param: 'timbre', target: 0.5 })).toBe(false);

    // Record a failed call
    breaker = recordStep(breaker, {
      calls: [{ name: 'move', args: { param: 'timbre', target: 0.5 }, errored: true }],
    });

    // Same call is now a repeated failure
    expect(isRepeatedFailure(breaker, 'move', { param: 'timbre', target: 0.5 })).toBe(true);

    // Different args — not a repeat
    expect(isRepeatedFailure(breaker, 'move', { param: 'timbre', target: 0.8 })).toBe(false);

    // Different name — not a repeat
    expect(isRepeatedFailure(breaker, 'sketch', { param: 'timbre', target: 0.5 })).toBe(false);
  });

  it('does not flag successful calls as repeated failures', () => {
    let breaker = createCircuitBreaker();

    // Record a successful call
    breaker = recordStep(breaker, {
      calls: [{ name: 'move', args: { param: 'timbre', target: 0.5 }, errored: false }],
    });

    // Successful calls are not tracked as failures
    expect(isRepeatedFailure(breaker, 'move', { param: 'timbre', target: 0.5 })).toBe(false);
  });
});
