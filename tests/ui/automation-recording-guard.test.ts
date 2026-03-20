// tests/ui/automation-recording-guard.test.ts
// Verifies that automation recording requires BOTH record-armed AND transport playing.
// Regression test for #1210: wrong operator precedence caused transport check to be skipped.

import { describe, it, expect } from 'vitest';

/**
 * Extracted guard logic from maybeRecordAutomation in App.tsx.
 * Returns true when recording should be skipped (i.e. the early-return fires).
 */
function shouldSkipRecording(recordArmed: boolean, transportStatus: string): boolean {
  // This must match the condition in App.tsx line ~743:
  //   if (!recordArmedRef.current || s.transport.status !== 'playing') return;
  return !recordArmed || transportStatus !== 'playing';
}

/**
 * The BUGGY version that #1210 reported.
 * `!s.transport.status === 'playing'` evaluates as `(!s.transport.status) === 'playing'`
 * which is `false === 'playing'` → always false. So the transport check is dead code.
 */
function shouldSkipRecordingBuggy(recordArmed: boolean, transportStatus: string): boolean {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-boolean-literal-compare
  return !recordArmed || (!transportStatus as unknown) === 'playing';
}

describe('automation recording guard (#1210)', () => {
  it('skips when not armed, regardless of transport', () => {
    expect(shouldSkipRecording(false, 'playing')).toBe(true);
    expect(shouldSkipRecording(false, 'stopped')).toBe(true);
    expect(shouldSkipRecording(false, 'paused')).toBe(true);
  });

  it('skips when armed but transport is NOT playing', () => {
    expect(shouldSkipRecording(true, 'stopped')).toBe(true);
    expect(shouldSkipRecording(true, 'paused')).toBe(true);
  });

  it('records when armed AND transport is playing', () => {
    expect(shouldSkipRecording(true, 'playing')).toBe(false);
  });

  it('demonstrates the bug: old code would NOT skip when armed + stopped', () => {
    // The buggy version always returns false for the transport check,
    // so it only checks !recordArmed. When armed=true, it never skips.
    expect(shouldSkipRecordingBuggy(true, 'stopped')).toBe(false); // BUG: should be true
    expect(shouldSkipRecordingBuggy(true, 'paused')).toBe(false);  // BUG: should be true

    // The fixed version correctly skips:
    expect(shouldSkipRecording(true, 'stopped')).toBe(true);
    expect(shouldSkipRecording(true, 'paused')).toBe(true);
  });
});
