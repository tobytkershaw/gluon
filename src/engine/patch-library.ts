// src/engine/patch-library.ts — Save and load complete instrument configurations (patches).
//
// A patch captures a track's sound configuration:
//   source engine + model + params + processor chain + modulator chain + modulation routings.
// It does NOT capture pattern data, track identity, or mix settings.
//
// Two sources: built-in patches (curated starting points) and user/AI-saved patches (from sessions).

import type {
  Track,
  SynthParamValues,
  ProcessorConfig,
  ModulatorConfig,
  ModulationRouting,
} from './types';

export interface Patch {
  id: string;
  name: string;
  tags?: string[];
  builtIn?: boolean;
  // Sound configuration snapshot
  engine: string;
  model: number;
  params: SynthParamValues;
  processors?: ProcessorConfig[];
  modulators?: ModulatorConfig[];
  modulations?: ModulationRouting[];
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Built-in patches — curated starting points for common electronic music roles
// ---------------------------------------------------------------------------
//
// Plaits model indices (from ENGINE_DATA):
//  0 = virtual-analog    4 = harmonic         8 = swarm            12 = modal-resonator
//  1 = waveshaping        5 = wavetable        9 = filtered-noise   13 = analog-bass-drum
//  2 = fm                 6 = chords          10 = particle-dust    14 = analog-snare
//  3 = grain-formant      7 = vowel-speech    11 = inharmonic-string 15 = analog-hi-hat

export const BUILT_IN_PATCHES: Patch[] = [
  {
    id: 'builtin-deep-sub-kick',
    name: 'Deep Sub Kick',
    tags: ['kick', 'deep', 'techno'],
    builtIn: true,
    engine: 'plaits',
    model: 13, // analog-bass-drum
    params: {
      harmonics: 0.3,  // low harmonics — more sub, less click
      timbre: 0.2,     // dark tone
      morph: 0.4,      // moderate body
      frequency: 0.3,       // low pitch
    },
    processors: [
      {
        id: 'builtin-kick-comp',
        type: 'compressor',
        model: 2, // bus compressor
        params: { threshold: 0.4, ratio: 0.4, attack: 0.15, release: 0.3, makeup: 0.3, mix: 1.0 },
      },
    ],
    createdAt: 0,
  },
  {
    id: 'builtin-acid-bass',
    name: 'Acid Bass',
    tags: ['bass', 'acid', 'bright'],
    builtIn: true,
    engine: 'plaits',
    model: 0, // virtual-analog
    params: {
      harmonics: 0.7,  // rich harmonics
      timbre: 0.8,     // bright, resonant
      morph: 0.3,      // saw-ish shape
      frequency: 0.35,      // bass register
    },
    processors: [
      {
        id: 'builtin-acid-filter',
        type: 'ripples',
        model: 1, // lp4
        params: { cutoff: 0.45, resonance: 0.7, drive: 0.3 },
      },
      {
        id: 'builtin-acid-dist',
        type: 'distortion',
        model: 0,
        params: { drive: 0.4, tone: 0.6, mix: 0.5 },
      },
    ],
    createdAt: 0,
  },
  {
    id: 'builtin-warm-pad',
    name: 'Warm Pad',
    tags: ['pad', 'warm', 'ambient'],
    builtIn: true,
    engine: 'plaits',
    model: 5, // wavetable
    params: {
      harmonics: 0.4,
      timbre: 0.3,     // mellow tone
      morph: 0.6,      // slow evolving wavetable
      frequency: 0.5,       // mid register
    },
    processors: [
      {
        id: 'builtin-pad-filter',
        type: 'ripples',
        model: 1, // lp4
        params: { cutoff: 0.35, resonance: 0.4, drive: 0.1 },
      },
      {
        id: 'builtin-pad-clouds',
        type: 'clouds',
        model: 0, // granular
        params: {
          position: 0.5, size: 0.8, pitch: 0.5,
          density: 0.6, texture: 0.7, feedback: 0.35,
          reverb: 0.65, 'dry-wet': 0.45,
        },
      },
    ],
    createdAt: 0,
  },
  {
    id: 'builtin-crisp-snare',
    name: 'Crisp Snare',
    tags: ['snare', 'crisp', 'percussion'],
    builtIn: true,
    engine: 'plaits',
    model: 14, // analog-snare
    params: {
      harmonics: 0.5,  // balanced tone/noise mix
      timbre: 0.6,     // brighter snap
      morph: 0.45,     // medium body
      frequency: 0.45,      // tuned mid-range
    },
    processors: [
      {
        id: 'builtin-snare-eq',
        type: 'eq',
        model: 0,
        params: {
          'low-gain': 0.4, 'low-freq': 0.3,
          'mid1-gain': 0.6, 'mid1-freq': 0.55, 'mid1-q': 0.4,
          'mid2-gain': 0.5, 'mid2-freq': 0.6, 'mid2-q': 0.3,
          'high-gain': 0.65, 'high-freq': 0.75,
        },
      },
    ],
    createdAt: 0,
  },
  {
    id: 'builtin-digital-lead',
    name: 'Digital Lead',
    tags: ['lead', 'bright', 'digital'],
    builtIn: true,
    engine: 'plaits',
    model: 2, // fm
    params: {
      harmonics: 0.6,  // moderate harmonics
      timbre: 0.7,     // bright FM tone
      morph: 0.5,      // balanced feedback
      frequency: 0.55,      // slightly above mid
    },
    processors: [
      {
        id: 'builtin-lead-comp',
        type: 'compressor',
        model: 0, // clean
        params: { threshold: 0.45, ratio: 0.35, attack: 0.15, release: 0.3, makeup: 0.25, mix: 1.0 },
      },
    ],
    createdAt: 0,
  },
  {
    id: 'builtin-metallic-hat',
    name: 'Metallic Hi-Hat',
    tags: ['hat', 'metallic', 'percussion'],
    builtIn: true,
    engine: 'plaits',
    model: 15, // analog-hi-hat
    params: {
      harmonics: 0.6,  // metallic character
      timbre: 0.7,     // bright
      morph: 0.3,      // tight decay
      frequency: 0.6,       // high pitch
    },
    processors: [
      {
        id: 'builtin-hat-eq',
        type: 'eq',
        model: 0,
        params: {
          'low-gain': 0.15, 'low-freq': 0.5,
          'mid1-gain': 0.5, 'mid1-freq': 0.5, 'mid1-q': 0.3,
          'mid2-gain': 0.5, 'mid2-freq': 0.6, 'mid2-q': 0.3,
          'high-gain': 0.7, 'high-freq': 0.8,
        },
      },
    ],
    createdAt: 0,
  },
  {
    id: 'builtin-swarm-texture',
    name: 'Swarm Texture',
    tags: ['texture', 'ambient', 'dark'],
    builtIn: true,
    engine: 'plaits',
    model: 8, // swarm
    params: {
      harmonics: 0.5,  // moderate spread
      timbre: 0.4,     // dark tone
      morph: 0.7,      // wide detuning
      frequency: 0.45,      // mid-low register
    },
    processors: [
      {
        id: 'builtin-swarm-clouds',
        type: 'clouds',
        model: 3, // spectral
        params: {
          position: 0.5, size: 0.6, pitch: 0.5,
          density: 0.5, texture: 0.8, feedback: 0.5,
          reverb: 0.7, 'dry-wet': 0.4,
        },
      },
    ],
    createdAt: 0,
  },
  {
    id: 'builtin-bell',
    name: 'Resonant Bell',
    tags: ['bell', 'metallic', 'melodic'],
    builtIn: true,
    engine: 'plaits',
    model: 12, // modal-resonator
    params: {
      harmonics: 0.55, // slightly inharmonic
      timbre: 0.6,     // bright resonance
      morph: 0.4,      // moderate damping
      frequency: 0.6,       // high register
    },
    createdAt: 0,
  },
];

/** All built-in patch names. */
export const BUILT_IN_PATCH_NAMES = BUILT_IN_PATCHES.map(p => p.name);

// ---------------------------------------------------------------------------
// Extract / Apply — pure functions
// ---------------------------------------------------------------------------

/**
 * Extract the sound configuration from a track into a Patch object.
 * Captures engine, model, params, processors, modulators, modulations.
 * Does NOT capture pattern data, track identity, agency, or mix settings.
 */
export function savePatch(track: Track, name: string, tags?: string[]): Patch {
  return {
    id: `patch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    tags,
    builtIn: false,
    engine: track.engine,
    model: track.model,
    params: { ...track.params },
    processors: track.processors
      ? track.processors.map(p => ({
          ...p,
          params: { ...p.params },
        }))
      : undefined,
    modulators: track.modulators
      ? track.modulators.map(m => ({
          ...m,
          params: { ...m.params },
        }))
      : undefined,
    modulations: track.modulations
      ? track.modulations.map(r => ({
          ...r,
          target: { ...r.target } as typeof r.target,
        }))
      : undefined,
    createdAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// IndexedDB persistence for user patches
// ---------------------------------------------------------------------------

const DB_NAME = 'gluon-patch-library';
const DB_VERSION = 1;
const STORE_NAME = 'patches';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Save a user patch to IndexedDB. */
export async function persistPatch(patch: Patch): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(patch);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Load all user patches from IndexedDB. */
export async function loadUserPatches(): Promise<Patch[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as Patch[]);
    req.onerror = () => reject(req.error);
  });
}

/** Delete a user patch from IndexedDB by ID. */
export async function deleteUserPatch(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * Find a patch by ID or name from a combined list of built-in + user patches.
 * Name matching is case-insensitive.
 */
export function findPatch(patches: Patch[], idOrName: string): Patch | undefined {
  return patches.find(p => p.id === idOrName) ??
    patches.find(p => p.name.toLowerCase() === idOrName.toLowerCase());
}

/** Get all available patches (built-in + user). */
export function getAllPatches(userPatches: Patch[]): Patch[] {
  return [...BUILT_IN_PATCHES, ...userPatches];
}

/** List patches with optional tag filter. */
export function listPatches(
  patches: Patch[],
  tagFilter?: string,
): { id: string; name: string; tags?: string[]; builtIn?: boolean }[] {
  let filtered = patches;
  if (tagFilter) {
    const lower = tagFilter.toLowerCase();
    filtered = patches.filter(p =>
      p.tags?.some(t => t.toLowerCase() === lower),
    );
  }
  return filtered.map(p => ({
    id: p.id,
    name: p.name,
    tags: p.tags,
    builtIn: p.builtIn,
  }));
}
