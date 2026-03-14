/**
 * Surface template registry: baseline semantic surfaces for known chain configurations.
 *
 * When a track's processor chain changes, the system looks up a template matching
 * the new chain signature and auto-applies it to the track's surface. This gives
 * the human meaningful aggregate controls without AI intervention for common chains.
 *
 * Templates use generic module references ('source', 'processor-0', 'processor-1')
 * that are resolved to actual track module IDs at application time.
 */

import type { SemanticControlDef, TrackSurface, Track } from './types';

// ---------------------------------------------------------------------------
// Chain signature
// ---------------------------------------------------------------------------

export interface ChainSurfaceTemplate {
  chainSignature: string;
  semanticControls: SemanticControlDef[];
  xyAxes: { x: string; y: string };
}

/**
 * Generate a chain signature from a track's engine + processor types.
 * e.g. 'plaits', 'plaits:rings', 'plaits:rings:clouds'
 */
export function getChainSignature(track: Track): string {
  const parts = [track.engine.split('-')[0] === 'analog' ? 'plaits' : 'plaits'];
  for (const proc of track.processors ?? []) {
    parts.push(proc.type);
  }
  return parts.join(':');
}

// ---------------------------------------------------------------------------
// Template registry
// ---------------------------------------------------------------------------

const templates: ChainSurfaceTemplate[] = [
  // Single module — no semantic controls (raw params suffice)
  {
    chainSignature: 'plaits',
    semanticControls: [],
    xyAxes: { x: 'brightness', y: 'texture' },
  },

  // Plaits + Rings — 2 semantic controls
  {
    chainSignature: 'plaits:rings',
    semanticControls: [
      {
        id: 'brightness',
        name: 'Brightness',
        semanticRole: 'brightness',
        description: 'Combined timbral brightness across source and resonator',
        weights: [
          { moduleId: 'source', controlId: 'brightness', weight: 0.5, transform: 'linear' },
          { moduleId: 'processor-0', controlId: 'brightness', weight: 0.5, transform: 'linear' },
        ],
        range: { min: 0, max: 1, default: 0.5 },
      },
      {
        id: 'resonance',
        name: 'Resonance',
        semanticRole: null,
        description: 'Resonator character — structure vs damping',
        weights: [
          { moduleId: 'processor-0', controlId: 'structure', weight: 0.6, transform: 'linear' },
          { moduleId: 'processor-0', controlId: 'damping', weight: 0.4, transform: 'inverse' },
        ],
        range: { min: 0, max: 1, default: 0.5 },
      },
    ],
    xyAxes: { x: 'brightness', y: 'resonance' },
  },

  // Plaits + Clouds — 2 semantic controls
  {
    chainSignature: 'plaits:clouds',
    semanticControls: [
      {
        id: 'brightness',
        name: 'Brightness',
        semanticRole: 'brightness',
        description: 'Timbral brightness balanced against granular feedback',
        weights: [
          { moduleId: 'source', controlId: 'brightness', weight: 0.6, transform: 'linear' },
          { moduleId: 'processor-0', controlId: 'feedback', weight: 0.4, transform: 'inverse' },
        ],
        range: { min: 0, max: 1, default: 0.5 },
      },
      {
        id: 'space',
        name: 'Space',
        semanticRole: null,
        description: 'Spatial depth — granular density and buffer size',
        weights: [
          { moduleId: 'processor-0', controlId: 'size', weight: 0.5, transform: 'linear' },
          { moduleId: 'processor-0', controlId: 'density', weight: 0.5, transform: 'linear' },
        ],
        range: { min: 0, max: 1, default: 0.5 },
      },
    ],
    xyAxes: { x: 'brightness', y: 'space' },
  },

  // Plaits + Rings + Clouds — 3 semantic controls
  {
    chainSignature: 'plaits:rings:clouds',
    semanticControls: [
      {
        id: 'brightness',
        name: 'Brightness',
        semanticRole: 'brightness',
        description: 'Combined brightness across source, resonator, and granular processor',
        weights: [
          { moduleId: 'source', controlId: 'brightness', weight: 0.4, transform: 'linear' },
          { moduleId: 'processor-0', controlId: 'brightness', weight: 0.3, transform: 'linear' },
          { moduleId: 'processor-1', controlId: 'feedback', weight: 0.3, transform: 'inverse' },
        ],
        range: { min: 0, max: 1, default: 0.5 },
      },
      {
        id: 'space',
        name: 'Space',
        semanticRole: null,
        description: 'Spatial depth from granular processing',
        weights: [
          { moduleId: 'processor-1', controlId: 'size', weight: 0.5, transform: 'linear' },
          { moduleId: 'processor-1', controlId: 'density', weight: 0.3, transform: 'linear' },
          { moduleId: 'processor-1', controlId: 'position', weight: 0.2, transform: 'linear' },
        ],
        range: { min: 0, max: 1, default: 0.5 },
      },
      {
        id: 'resonance',
        name: 'Resonance',
        semanticRole: null,
        description: 'Resonator character — structure vs damping',
        weights: [
          { moduleId: 'processor-0', controlId: 'structure', weight: 0.5, transform: 'linear' },
          { moduleId: 'processor-0', controlId: 'damping', weight: 0.5, transform: 'inverse' },
        ],
        range: { min: 0, max: 1, default: 0.5 },
      },
    ],
    xyAxes: { x: 'brightness', y: 'space' },
  },
];

/**
 * Look up a template by exact chain signature match.
 */
export function getTemplateForChain(signature: string): ChainSurfaceTemplate | null {
  return templates.find(t => t.chainSignature === signature) ?? null;
}

// ---------------------------------------------------------------------------
// Module ID resolution
// ---------------------------------------------------------------------------

/**
 * Resolve generic template moduleIds ('source', 'processor-0', 'processor-1')
 * to actual track module IDs.
 */
function resolveModuleId(genericId: string, track: Track): string {
  if (genericId === 'source') return 'source';
  const match = genericId.match(/^processor-(\d+)$/);
  if (match) {
    const idx = parseInt(match[1], 10);
    const proc = (track.processors ?? [])[idx];
    return proc?.id ?? genericId;
  }
  return genericId;
}

/**
 * Resolve all generic moduleIds in a semantic control def to actual track module IDs.
 */
function resolveSemanticControl(def: SemanticControlDef, track: Track): SemanticControlDef {
  return {
    ...def,
    weights: def.weights.map(w => ({
      ...w,
      moduleId: resolveModuleId(w.moduleId, track),
    })),
  };
}

// ---------------------------------------------------------------------------
// Template application
// ---------------------------------------------------------------------------

/**
 * Apply a surface template to a track, resolving generic module references.
 * Returns a new TrackSurface, or null if no template matches.
 */
export function applySurfaceTemplate(track: Track): TrackSurface | null {
  const signature = getChainSignature(track);
  const template = getTemplateForChain(signature);
  if (!template) return null;

  const resolvedControls = template.semanticControls.map(sc => resolveSemanticControl(sc, track));

  // Skip if the surface wouldn't actually change
  const currentIds = track.surface.semanticControls.map(sc => sc.id).join(',');
  const newIds = resolvedControls.map(sc => sc.id).join(',');
  const axesMatch = track.surface.xyAxes.x === template.xyAxes.x && track.surface.xyAxes.y === template.xyAxes.y;
  if (currentIds === newIds && axesMatch) return null;

  return {
    ...track.surface,
    semanticControls: resolvedControls,
    xyAxes: template.xyAxes,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const WEIGHT_SUM_TOLERANCE = 0.01;

/**
 * Validate a TrackSurface against a track's current chain.
 * Returns null if valid, or an error string describing the first problem found.
 */
export function validateSurface(surface: TrackSurface, track: Track): string | null {
  const validModuleIds = new Set<string>(['source']);
  for (const proc of track.processors ?? []) {
    validModuleIds.add(proc.id);
  }

  for (const sc of surface.semanticControls) {
    if (sc.weights.length === 0) {
      return `Semantic control '${sc.id}' has no weights`;
    }

    const weightSum = sc.weights.reduce((sum, w) => sum + w.weight, 0);
    if (Math.abs(weightSum - 1.0) > WEIGHT_SUM_TOLERANCE) {
      return `Semantic control '${sc.id}' weights sum to ${weightSum.toFixed(3)}, expected 1.0`;
    }

    for (const w of sc.weights) {
      if (!validModuleIds.has(w.moduleId)) {
        return `Semantic control '${sc.id}' references unknown module '${w.moduleId}'`;
      }
    }
  }

  for (const pin of surface.pinnedControls) {
    if (!validModuleIds.has(pin.moduleId)) {
      return `Pinned control references unknown module '${pin.moduleId}'`;
    }
  }

  return null;
}
