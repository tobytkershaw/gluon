import { describe, expect, it, beforeEach } from 'vitest';
import {
  storeSnapshot,
  getSnapshot,
  clearSnapshots,
  snapshotCount,
  nextSnapshotId,
  type AudioSnapshot,
} from '../../src/audio/snapshot-store';

describe('snapshot-store', () => {
  beforeEach(() => {
    clearSnapshots();
  });

  it('stores and retrieves a snapshot', () => {
    const snapshot: AudioSnapshot = {
      id: 'test-1',
      pcm: new Float32Array([0.1, 0.2, 0.3]),
      sampleRate: 48000,
      scope: ['v0'],
      bars: 2,
    };

    storeSnapshot(snapshot);
    const retrieved = getSnapshot('test-1');

    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe('test-1');
    expect(retrieved!.pcm).toEqual(new Float32Array([0.1, 0.2, 0.3]));
    expect(retrieved!.sampleRate).toBe(48000);
    expect(retrieved!.scope).toEqual(['v0']);
    expect(retrieved!.bars).toBe(2);
  });

  it('returns undefined for missing snapshots', () => {
    expect(getSnapshot('nonexistent')).toBeUndefined();
  });

  it('clears all snapshots', () => {
    storeSnapshot({
      id: 'a',
      pcm: new Float32Array(1),
      sampleRate: 48000,
      scope: [],
      bars: 2,
    });
    storeSnapshot({
      id: 'b',
      pcm: new Float32Array(1),
      sampleRate: 48000,
      scope: [],
      bars: 2,
    });

    expect(snapshotCount()).toBe(2);
    clearSnapshots();
    expect(snapshotCount()).toBe(0);
    expect(getSnapshot('a')).toBeUndefined();
  });

  it('generates incrementing snapshot IDs', () => {
    const id1 = nextSnapshotId();
    const id2 = nextSnapshotId();

    expect(id1).toMatch(/^snapshot_\d+$/);
    expect(id2).toMatch(/^snapshot_\d+$/);
    expect(id1).not.toBe(id2);
  });
});
