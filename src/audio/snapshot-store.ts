// src/audio/snapshot-store.ts — Ephemeral storage for rendered audio snapshots.
// Snapshots persist within a tool loop so the AI can render once and analyse many ways.

export interface AudioSnapshot {
  id: string;
  pcm: Float32Array;
  sampleRate: number;
  scope: string[];       // track IDs rendered (empty = full mix)
  bars: number;
}

let counter = 0;
const store = new Map<string, AudioSnapshot>();

/** Generate a fresh snapshot ID. */
export function nextSnapshotId(): string {
  return `snapshot_${++counter}`;
}

/** Store a snapshot. Returns the snapshot. */
export function storeSnapshot(snapshot: AudioSnapshot): AudioSnapshot {
  store.set(snapshot.id, snapshot);
  return snapshot;
}

/** Retrieve a snapshot by ID. Returns undefined if not found. */
export function getSnapshot(id: string): AudioSnapshot | undefined {
  return store.get(id);
}

/** Clear all snapshots (call at the end of a tool loop). */
export function clearSnapshots(): void {
  store.clear();
}

/** Number of stored snapshots (mainly for testing). */
export function snapshotCount(): number {
  return store.size;
}
