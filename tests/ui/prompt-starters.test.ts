import { describe, it, expect } from 'vitest';
import { selectStarters } from '../../src/ui/PromptStarters';
import type { Track, ChatMessage } from '../../src/engine/types';

/** Minimal track stub for testing. */
function makeTrack(id: string): Track {
  return {
    id,
    name: id,
    kind: 'audio',
    source: { type: 'plaits', params: {} },
    processors: [],
    volume: 0.8,
    pan: 0.5,
    mute: false,
    solo: false,
    agency: 'off',
    events: [],
    sequences: [],
    activeSequenceId: undefined,
    sends: [],
  } as unknown as Track;
}

function makeMessage(role: 'human' | 'ai', text: string): ChatMessage {
  return { role, text };
}

describe('selectStarters', () => {
  it('returns empty-project starters when no tracks and no messages', () => {
    const result = selectStarters([], []);
    expect(result.state).toBe('empty');
    expect(result.starters.length).toBeGreaterThanOrEqual(3);
    expect(result.starters).toContain('What can you do?');
  });

  it('returns tracks-exist starters when tracks exist but no messages', () => {
    const tracks = [makeTrack('kick')];
    const result = selectStarters(tracks, []);
    expect(result.state).toBe('tracks-exist');
    expect(result.starters.length).toBeGreaterThanOrEqual(3);
    expect(result.starters.some(s => s.toLowerCase().includes('listen'))).toBe(true);
  });

  it('returns resume starters when messages exist', () => {
    const messages = [makeMessage('human', 'hello'), makeMessage('ai', 'hi')];
    const result = selectStarters([], messages);
    expect(result.state).toBe('resume');
    expect(result.starters).toContain('Remind me where we left off');
  });

  it('resume takes priority over tracks-exist when both have content', () => {
    const tracks = [makeTrack('kick')];
    const messages = [makeMessage('human', 'hello')];
    const result = selectStarters(tracks, messages);
    expect(result.state).toBe('resume');
  });

  it('tracks-exist starters include track-aware prompts', () => {
    const tracks = [makeTrack('kick'), makeTrack('bass')];
    const result = selectStarters(tracks, []);
    expect(result.state).toBe('tracks-exist');
    expect(result.starters.some(s => s.toLowerCase().includes('mix'))).toBe(true);
  });
});
