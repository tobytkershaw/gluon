import { describe, it, expect } from 'vitest';
import { deriveScopeTracks } from '../../src/ui/ChatMessages';
import type { ActionLogEntry, Track } from '../../src/engine/types';

function makeTrack(id: string, name: string): Track {
  return {
    id,
    name,
    mute: false,
    solo: false,
    pan: 0.5,
    volume: 0.8,
    sourceType: 'plaits',
    params: {},
    patterns: [],
    chain: [],
  } as unknown as Track;
}

function makeLogEntry(trackId: string, trackLabel: string): ActionLogEntry {
  return { trackId, trackLabel, description: 'set param' };
}

describe('deriveScopeTracks', () => {
  it('returns empty array when no log entries', () => {
    expect(deriveScopeTracks([], [])).toEqual([]);
  });

  it('derives scope from a single log entry with matching track', () => {
    const tracks = [makeTrack('t1', 'kick')];
    const entries = [makeLogEntry('t1', 'kick')];
    expect(deriveScopeTracks(entries, tracks)).toEqual([
      { trackId: 't1', name: 'kick' },
    ]);
  });

  it('deduplicates multiple entries for the same track', () => {
    const tracks = [makeTrack('t1', 'kick')];
    const entries = [
      makeLogEntry('t1', 'kick'),
      makeLogEntry('t1', 'kick'),
      makeLogEntry('t1', 'kick'),
    ];
    const result = deriveScopeTracks(entries, tracks);
    expect(result).toHaveLength(1);
    expect(result[0].trackId).toBe('t1');
  });

  it('includes multiple tracks preserving insertion order', () => {
    const tracks = [
      makeTrack('t1', 'kick'),
      makeTrack('t2', 'bass'),
      makeTrack('t3', 'hats'),
    ];
    const entries = [
      makeLogEntry('t2', 'bass'),
      makeLogEntry('t3', 'hats'),
      makeLogEntry('t1', 'kick'),
    ];
    const result = deriveScopeTracks(entries, tracks);
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe('bass');
    expect(result[1].name).toBe('hats');
    expect(result[2].name).toBe('kick');
  });

  it('falls back to trackLabel when track not found', () => {
    const entries = [makeLogEntry('gone', 'deleted-track')];
    const result = deriveScopeTracks(entries, []);
    expect(result).toEqual([
      { trackId: 'gone', name: 'deleted-track' },
    ]);
  });

  it('falls back to trackId when both track and label are missing', () => {
    const entries = [{ trackId: 'x', trackLabel: '', description: 'test' }];
    const result = deriveScopeTracks(entries, []);
    // Empty string is falsy, so falls through to trackId
    expect(result[0].name).toBe('x');
  });
});
