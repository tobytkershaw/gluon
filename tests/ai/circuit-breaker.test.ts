// tests/ai/circuit-breaker.test.ts — Circuit breaker unit tests
import { describe, it, expect } from 'vitest';
import {
  createCircuitBreaker,
  recordStep,
  isBlocked,
  isRepeatedFailure,
  isRepeatedSuccess,
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

  // --- Repeated success detection (issue #918) ---

  it('detects repeated successful mutation calls', () => {
    let breaker = createCircuitBreaker();

    // Not a repeat yet
    expect(isRepeatedSuccess(breaker, 'processor', { action: 'add', trackId: 'v0', moduleType: 'eq' })).toBe(false);

    // Record a successful processor add
    breaker = recordStep(breaker, {
      calls: [{ name: 'processor', args: { action: 'add', trackId: 'v0', moduleType: 'eq' }, errored: false }],
    });

    // Same call is now a repeated success
    expect(isRepeatedSuccess(breaker, 'processor', { action: 'add', trackId: 'v0', moduleType: 'eq' })).toBe(true);

    // Different args — not a repeat
    expect(isRepeatedSuccess(breaker, 'processor', { action: 'add', trackId: 'v0', moduleType: 'compressor' })).toBe(false);

    // Different tool name — not a repeat
    expect(isRepeatedSuccess(breaker, 'modulator', { action: 'add', trackId: 'v0', moduleType: 'eq' })).toBe(false);
  });

  it('does not flag read-only tools as repeated successes', () => {
    let breaker = createCircuitBreaker();

    // Record a successful listen call
    breaker = recordStep(breaker, {
      calls: [{ name: 'listen', args: { trackIds: ['v0'] }, errored: false }],
    });

    // Read-only tools should never be flagged
    expect(isRepeatedSuccess(breaker, 'listen', { trackIds: ['v0'] })).toBe(false);
  });

  it('does not flag read-only tools as repeated successes (render)', () => {
    let breaker = createCircuitBreaker();

    breaker = recordStep(breaker, {
      calls: [{ name: 'render', args: { scope: 'v0' }, errored: false }],
    });

    expect(isRepeatedSuccess(breaker, 'render', { scope: 'v0' })).toBe(false);
  });

  it('does not flag failed calls as repeated successes', () => {
    let breaker = createCircuitBreaker();

    // Record a failed call
    breaker = recordStep(breaker, {
      calls: [{ name: 'processor', args: { action: 'add', trackId: 'v0', moduleType: 'eq' }, errored: true }],
    });

    // Failed calls should not appear in the success set
    expect(isRepeatedSuccess(breaker, 'processor', { action: 'add', trackId: 'v0', moduleType: 'eq' })).toBe(false);
  });

  it('tracks both add and remove processor calls independently', () => {
    let breaker = createCircuitBreaker();

    // Record successful add
    breaker = recordStep(breaker, {
      calls: [{ name: 'processor', args: { action: 'add', trackId: 'v0', moduleType: 'eq' }, errored: false }],
    });

    // Record successful remove (different args)
    breaker = recordStep(breaker, {
      calls: [{ name: 'processor', args: { action: 'remove', trackId: 'v0', processorId: 'eq-123' }, errored: false }],
    });

    // Both should be detected as repeated if called again
    expect(isRepeatedSuccess(breaker, 'processor', { action: 'add', trackId: 'v0', moduleType: 'eq' })).toBe(true);
    expect(isRepeatedSuccess(breaker, 'processor', { action: 'remove', trackId: 'v0', processorId: 'eq-123' })).toBe(true);

    // But not with different args
    expect(isRepeatedSuccess(breaker, 'processor', { action: 'add', trackId: 'v0', moduleType: 'compressor' })).toBe(false);
  });
});
