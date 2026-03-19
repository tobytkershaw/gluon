import { describe, it, expect } from 'vitest';
import { getPhaseLabel } from '../../src/ui/ChatMessages';

describe('getPhaseLabel', () => {
  it('returns listening label when isListening is true', () => {
    expect(getPhaseLabel(false, true, 0)).toBe('Listening \u2014 evaluating audio');
  });

  it('returns listening label even when log entries exist (listening takes priority)', () => {
    expect(getPhaseLabel(true, true, 3)).toBe('Listening \u2014 evaluating audio');
  });

  it('returns applying changes label with count when log entries exist', () => {
    expect(getPhaseLabel(true, false, 5)).toBe('Applying 5 changes');
  });

  it('uses singular "change" for count of 1', () => {
    expect(getPhaseLabel(true, false, 1)).toBe('Applying 1 change');
  });

  it('returns thinking label when isThinking is true with no log entries', () => {
    expect(getPhaseLabel(true, false, 0)).toBe('Thinking\u2026');
  });

  it('returns null when AI turn is done (no flags set)', () => {
    expect(getPhaseLabel(false, false, 0)).toBeNull();
  });
});
