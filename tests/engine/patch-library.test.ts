import { describe, it, expect } from 'vitest';
import {
  savePatch,
  findPatch,
  getAllPatches,
  listPatches,
  BUILT_IN_PATCHES,
  BUILT_IN_PATCH_NAMES,
} from '../../src/engine/patch-library';
import type { Patch } from '../../src/engine/patch-library';
import type { Track } from '../../src/engine/types';
import { getRegisteredProcessorTypes, getProcessorControlIds } from '../../src/audio/instrument-registry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-1',
    name: 'Test Track',
    engine: 'plaits',
    model: 0,
    params: { harmonics: 0.5, timbre: 0.6, morph: 0.4, note: 0.5 },
    agency: 'ON',
    stepGrid: [],
    patterns: [{ id: 'p1', name: 'Pattern 1', duration: 16, events: [] }],
    sequence: [{ patternId: 'p1' }],
    muted: false,
    solo: false,
    volume: 0.8,
    pan: 0.0,
    surface: {
      modules: [],
      thumbprint: { type: 'static-color' },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Built-in patches validation
// ---------------------------------------------------------------------------

describe('BUILT_IN_PATCHES', () => {
  const validProcessorTypes = getRegisteredProcessorTypes();

  it('contains at least 5 patches', () => {
    expect(BUILT_IN_PATCHES.length).toBeGreaterThanOrEqual(5);
  });

  it('BUILT_IN_PATCH_NAMES matches patch count', () => {
    expect(BUILT_IN_PATCH_NAMES.length).toBe(BUILT_IN_PATCHES.length);
  });

  it('every patch has required fields', () => {
    for (const patch of BUILT_IN_PATCHES) {
      expect(patch.id).toBeTruthy();
      expect(patch.name).toBeTruthy();
      expect(patch.engine).toBe('plaits');
      expect(patch.model).toBeGreaterThanOrEqual(0);
      expect(patch.model).toBeLessThan(16);
      expect(patch.params).toBeDefined();
      expect(patch.builtIn).toBe(true);
    }
  });

  it('every patch has unique id and name', () => {
    const ids = BUILT_IN_PATCHES.map(p => p.id);
    const names = BUILT_IN_PATCHES.map(p => p.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every patch has tags', () => {
    for (const patch of BUILT_IN_PATCHES) {
      expect(patch.tags).toBeDefined();
      expect(patch.tags!.length).toBeGreaterThan(0);
    }
  });

  it('every patch processor type is valid', () => {
    for (const patch of BUILT_IN_PATCHES) {
      for (const proc of patch.processors ?? []) {
        expect(validProcessorTypes, `Patch "${patch.name}": invalid processor type "${proc.type}"`).toContain(proc.type);
      }
    }
  });

  it('every patch processor has valid param keys', () => {
    for (const patch of BUILT_IN_PATCHES) {
      for (const proc of patch.processors ?? []) {
        const validIds = getProcessorControlIds(proc.type);
        for (const paramKey of Object.keys(proc.params)) {
          expect(validIds, `Patch "${patch.name}": processor "${proc.type}" has unknown param "${paramKey}"`).toContain(paramKey);
        }
      }
    }
  });

  it('every patch processor param is in 0-1 range', () => {
    for (const patch of BUILT_IN_PATCHES) {
      for (const proc of patch.processors ?? []) {
        for (const [key, val] of Object.entries(proc.params)) {
          expect(val, `Patch "${patch.name}" proc "${proc.type}" param "${key}"`).toBeGreaterThanOrEqual(0);
          expect(val, `Patch "${patch.name}" proc "${proc.type}" param "${key}"`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('every patch source param is in 0-1 range', () => {
    for (const patch of BUILT_IN_PATCHES) {
      for (const [key, val] of Object.entries(patch.params)) {
        expect(val, `Patch "${patch.name}" param "${key}"`).toBeGreaterThanOrEqual(0);
        expect(val, `Patch "${patch.name}" param "${key}"`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('covers key roles: kick, snare, bass, pad, lead', () => {
    const allTags = BUILT_IN_PATCHES.flatMap(p => p.tags ?? []);
    expect(allTags).toContain('kick');
    expect(allTags).toContain('snare');
    expect(allTags).toContain('bass');
    expect(allTags).toContain('pad');
    expect(allTags).toContain('lead');
  });
});

// ---------------------------------------------------------------------------
// savePatch
// ---------------------------------------------------------------------------

describe('savePatch', () => {
  it('extracts sound config from track', () => {
    const track = makeTrack({
      engine: 'plaits',
      model: 2,
      params: { harmonics: 0.7, timbre: 0.8, morph: 0.3, note: 0.5 },
      processors: [
        { id: 'rings-1', type: 'rings', model: 0, params: { structure: 0.5, brightness: 0.6, damping: 0.3, position: 0.5 } },
      ],
    });

    const patch = savePatch(track, 'My Sound', ['lead', 'bright']);

    expect(patch.name).toBe('My Sound');
    expect(patch.tags).toEqual(['lead', 'bright']);
    expect(patch.builtIn).toBe(false);
    expect(patch.engine).toBe('plaits');
    expect(patch.model).toBe(2);
    expect(patch.params.harmonics).toBe(0.7);
    expect(patch.processors).toHaveLength(1);
    expect(patch.processors![0].type).toBe('rings');
    expect(patch.id).toMatch(/^patch-/);
    expect(patch.createdAt).toBeGreaterThan(0);
  });

  it('deep copies params (no shared references)', () => {
    const track = makeTrack();
    const patch = savePatch(track, 'Test');

    // Mutate original track params — patch should not be affected
    track.params.harmonics = 0.99;
    expect(patch.params.harmonics).toBe(0.5);
  });

  it('handles track with no processors/modulators/modulations', () => {
    const track = makeTrack({
      processors: undefined,
      modulators: undefined,
      modulations: undefined,
    });
    const patch = savePatch(track, 'Clean');
    expect(patch.processors).toBeUndefined();
    expect(patch.modulators).toBeUndefined();
    expect(patch.modulations).toBeUndefined();
  });

  it('captures modulators and modulations', () => {
    const track = makeTrack({
      modulators: [{ id: 'tides-1', type: 'tides', model: 0, params: { frequency: 0.3, shape: 0.5 } }],
      modulations: [{
        id: 'mod-1',
        modulatorId: 'tides-1',
        target: { kind: 'source', param: 'timbre' },
        depth: 0.2,
      }],
    });

    const patch = savePatch(track, 'Modulated');
    expect(patch.modulators).toHaveLength(1);
    expect(patch.modulations).toHaveLength(1);
    expect(patch.modulations![0].depth).toBe(0.2);
  });
});

// ---------------------------------------------------------------------------
// findPatch
// ---------------------------------------------------------------------------

describe('findPatch', () => {
  it('finds by exact id', () => {
    const result = findPatch(BUILT_IN_PATCHES, BUILT_IN_PATCHES[0].id);
    expect(result).toBe(BUILT_IN_PATCHES[0]);
  });

  it('finds by name (case-insensitive)', () => {
    const result = findPatch(BUILT_IN_PATCHES, 'deep sub kick');
    expect(result).toBeDefined();
    expect(result!.name).toBe('Deep Sub Kick');
  });

  it('returns undefined for unknown', () => {
    expect(findPatch(BUILT_IN_PATCHES, 'nonexistent')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// listPatches
// ---------------------------------------------------------------------------

describe('listPatches', () => {
  it('returns all patches without filter', () => {
    const result = listPatches(BUILT_IN_PATCHES);
    expect(result.length).toBe(BUILT_IN_PATCHES.length);
  });

  it('filters by tag (case-insensitive)', () => {
    const kicks = listPatches(BUILT_IN_PATCHES, 'kick');
    expect(kicks.length).toBeGreaterThan(0);
    for (const p of kicks) {
      expect(p.tags).toContain('kick');
    }
  });

  it('returns empty for unknown tag', () => {
    const result = listPatches(BUILT_IN_PATCHES, 'nonexistent-tag');
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getAllPatches
// ---------------------------------------------------------------------------

describe('getAllPatches', () => {
  it('combines built-in and user patches', () => {
    const userPatch: Patch = {
      id: 'user-1',
      name: 'User Patch',
      engine: 'plaits',
      model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
      createdAt: Date.now(),
    };

    const all = getAllPatches([userPatch]);
    expect(all.length).toBe(BUILT_IN_PATCHES.length + 1);
    expect(all).toContain(userPatch);
  });
});
