// tests/engine/motif.test.ts — MotifLibrary tests
import { describe, it, expect, beforeEach } from 'vitest';
import { MotifLibrary } from '../../src/engine/motif';
import type { Motif } from '../../src/engine/motif';
import type { NoteEvent, TriggerEvent } from '../../src/engine/canonical-types';

function makeMotif(overrides: Partial<Motif> = {}): Motif {
  return {
    id: 'test-motif',
    name: 'Test Motif',
    events: [
      { kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 1 } as NoteEvent,
      { kind: 'note', at: 1, pitch: 64, velocity: 0.7, duration: 1 } as NoteEvent,
      { kind: 'note', at: 2, pitch: 67, velocity: 0.9, duration: 1 } as NoteEvent,
    ],
    rootPitch: 60,
    duration: 4,
    ...overrides,
  };
}

describe('MotifLibrary', () => {
  let lib: MotifLibrary;

  beforeEach(() => {
    lib = new MotifLibrary();
  });

  it('starts empty', () => {
    expect(lib.size).toBe(0);
    expect(lib.list()).toEqual([]);
  });

  it('registers and recalls a motif', () => {
    const motif = makeMotif();
    lib.register(motif);
    expect(lib.size).toBe(1);
    expect(lib.recall('test-motif')).toBe(motif);
  });

  it('returns undefined for unknown ID', () => {
    expect(lib.recall('nope')).toBeUndefined();
  });

  it('overwrites on duplicate register', () => {
    lib.register(makeMotif({ name: 'V1' }));
    lib.register(makeMotif({ name: 'V2' }));
    expect(lib.size).toBe(1);
    expect(lib.recall('test-motif')!.name).toBe('V2');
  });

  it('findByName is case-insensitive', () => {
    const motif = makeMotif({ name: 'Bass Riff' });
    lib.register(motif);
    expect(lib.findByName('bass riff')).toBe(motif);
    expect(lib.findByName('BASS RIFF')).toBe(motif);
    expect(lib.findByName('Bass Riff')).toBe(motif);
  });

  it('findByName returns undefined for no match', () => {
    lib.register(makeMotif());
    expect(lib.findByName('nope')).toBeUndefined();
  });

  it('lists all motifs', () => {
    lib.register(makeMotif({ id: 'a', name: 'A' }));
    lib.register(makeMotif({ id: 'b', name: 'B' }));
    const list = lib.list();
    expect(list).toHaveLength(2);
    expect(list.map(m => m.id).sort()).toEqual(['a', 'b']);
  });

  it('removes a motif', () => {
    lib.register(makeMotif());
    expect(lib.remove('test-motif')).toBe(true);
    expect(lib.size).toBe(0);
    expect(lib.recall('test-motif')).toBeUndefined();
  });

  it('remove returns false for missing ID', () => {
    expect(lib.remove('nope')).toBe(false);
  });

  it('clears all motifs', () => {
    lib.register(makeMotif({ id: 'a' }));
    lib.register(makeMotif({ id: 'b' }));
    lib.clear();
    expect(lib.size).toBe(0);
  });

  it('motif with triggers only', () => {
    const motif = makeMotif({
      events: [
        { kind: 'trigger', at: 0, velocity: 1.0 } as TriggerEvent,
        { kind: 'trigger', at: 2, velocity: 0.5 } as TriggerEvent,
      ],
    });
    lib.register(motif);
    expect(lib.recall('test-motif')!.events).toHaveLength(2);
  });
});
