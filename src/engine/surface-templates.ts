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

import type { SemanticControlDef, TrackSurface, Track, SurfaceModule, PinnedControl, ThumbprintConfig } from './types';
<<<<<<< HEAD
import { isValidModuleType, validateModuleBindings } from './surface-module-registry';
=======
import { isValidModuleType } from './surface-module-registry';
>>>>>>> surface/1052-canvas

// ---------------------------------------------------------------------------
// Chain signature
// ---------------------------------------------------------------------------

export interface ChainSurfaceTemplate {
  chainSignature: string;
  modules: SurfaceModule[];
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
  // Single module — raw knobs + step grid
  {
    chainSignature: 'plaits',
    modules: [
      {
        type: 'knob-group',
        id: 'raw-controls',
        label: 'Controls',
        bindings: [
          { role: 'control', trackId: '', target: 'timbre' },
          { role: 'control', trackId: '', target: 'morph' },
          { role: 'control', trackId: '', target: 'harmonics' },
        ],
        position: { x: 0, y: 0, w: 4, h: 2 },
        config: {},
      },
      {
        type: 'step-grid',
        id: 'step-grid',
        label: 'Pattern',
        bindings: [{ role: 'region', trackId: '', target: 'current' }],
        position: { x: 0, y: 2, w: 12, h: 3 },
        config: {},
      },
    ],
  },

  // Plaits + Rings — Brightness + Resonance macro knobs + XY + Step Grid
  {
    chainSignature: 'plaits:rings',
    modules: [
      {
        type: 'macro-knob',
        id: 'brightness',
        label: 'Brightness',
        bindings: [{ role: 'control', trackId: '', target: 'brightness' }],
        position: { x: 0, y: 0, w: 2, h: 2 },
        config: {
          semanticControl: {
            id: 'brightness',
            name: 'Brightness',
            semanticRole: 'brightness',
            description: 'Combined timbral brightness across source and resonator',
            weights: [
              { moduleId: 'source', controlId: 'timbre', weight: 0.5, transform: 'linear' },
              { moduleId: 'processor-0', controlId: 'brightness', weight: 0.5, transform: 'linear' },
            ],
            range: { min: 0, max: 1, default: 0.5 },
          },
        },
      },
      {
        type: 'macro-knob',
        id: 'resonance',
        label: 'Resonance',
        bindings: [{ role: 'control', trackId: '', target: 'resonance' }],
        position: { x: 2, y: 0, w: 2, h: 2 },
        config: {
          semanticControl: {
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
        },
      },
      {
        type: 'xy-pad',
        id: 'xy-pad',
        label: 'XY Pad',
        bindings: [
          { role: 'x-axis', trackId: '', target: 'brightness' },
          { role: 'y-axis', trackId: '', target: 'resonance' },
        ],
        position: { x: 4, y: 0, w: 4, h: 4 },
        config: {},
      },
      {
        type: 'step-grid',
        id: 'step-grid',
        label: 'Pattern',
        bindings: [{ role: 'region', trackId: '', target: 'current' }],
        position: { x: 0, y: 4, w: 12, h: 3 },
        config: {},
      },
    ],
  },

  // Plaits + Clouds — Brightness + Space macro knobs + XY + Step Grid
  {
    chainSignature: 'plaits:clouds',
    modules: [
      {
        type: 'macro-knob',
        id: 'brightness',
        label: 'Brightness',
        bindings: [{ role: 'control', trackId: '', target: 'brightness' }],
        position: { x: 0, y: 0, w: 2, h: 2 },
        config: {
          semanticControl: {
            id: 'brightness',
            name: 'Brightness',
            semanticRole: 'brightness',
            description: 'Timbral brightness balanced against granular feedback',
            weights: [
              { moduleId: 'source', controlId: 'timbre', weight: 0.6, transform: 'linear' },
              { moduleId: 'processor-0', controlId: 'feedback', weight: 0.4, transform: 'inverse' },
            ],
            range: { min: 0, max: 1, default: 0.5 },
          },
        },
      },
      {
        type: 'macro-knob',
        id: 'space',
        label: 'Space',
        bindings: [{ role: 'control', trackId: '', target: 'space' }],
        position: { x: 2, y: 0, w: 2, h: 2 },
        config: {
          semanticControl: {
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
        },
      },
      {
        type: 'xy-pad',
        id: 'xy-pad',
        label: 'XY Pad',
        bindings: [
          { role: 'x-axis', trackId: '', target: 'brightness' },
          { role: 'y-axis', trackId: '', target: 'space' },
        ],
        position: { x: 4, y: 0, w: 4, h: 4 },
        config: {},
      },
      {
        type: 'step-grid',
        id: 'step-grid',
        label: 'Pattern',
        bindings: [{ role: 'region', trackId: '', target: 'current' }],
        position: { x: 0, y: 4, w: 12, h: 3 },
        config: {},
      },
    ],
  },

  // Plaits + Rings + Clouds — Brightness + Space + Resonance macro knobs + XY + Step Grid
  {
    chainSignature: 'plaits:rings:clouds',
    modules: [
      {
        type: 'macro-knob',
        id: 'brightness',
        label: 'Brightness',
        bindings: [{ role: 'control', trackId: '', target: 'brightness' }],
        position: { x: 0, y: 0, w: 2, h: 2 },
        config: {
          semanticControl: {
            id: 'brightness',
            name: 'Brightness',
            semanticRole: 'brightness',
            description: 'Combined brightness across source, resonator, and granular processor',
            weights: [
              { moduleId: 'source', controlId: 'timbre', weight: 0.4, transform: 'linear' },
              { moduleId: 'processor-0', controlId: 'brightness', weight: 0.3, transform: 'linear' },
              { moduleId: 'processor-1', controlId: 'feedback', weight: 0.3, transform: 'inverse' },
            ],
            range: { min: 0, max: 1, default: 0.5 },
          },
        },
      },
      {
        type: 'macro-knob',
        id: 'space',
        label: 'Space',
        bindings: [{ role: 'control', trackId: '', target: 'space' }],
        position: { x: 2, y: 0, w: 2, h: 2 },
        config: {
          semanticControl: {
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
        },
      },
      {
        type: 'macro-knob',
        id: 'resonance',
        label: 'Resonance',
        bindings: [{ role: 'control', trackId: '', target: 'resonance' }],
        position: { x: 4, y: 0, w: 2, h: 2 },
        config: {
          semanticControl: {
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
        },
      },
      {
        type: 'xy-pad',
        id: 'xy-pad',
        label: 'XY Pad',
        bindings: [
          { role: 'x-axis', trackId: '', target: 'brightness' },
          { role: 'y-axis', trackId: '', target: 'space' },
        ],
        position: { x: 6, y: 0, w: 4, h: 4 },
        config: {},
      },
      {
        type: 'step-grid',
        id: 'step-grid',
        label: 'Pattern',
        bindings: [{ role: 'region', trackId: '', target: 'current' }],
        position: { x: 0, y: 4, w: 12, h: 3 },
        config: {},
      },
    ],
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
 * Resolve all generic moduleIds in a SurfaceModule's config to actual track module IDs.
 * For macro-knob modules, resolves the semantic control weight moduleIds.
 */
function resolveModule(module: SurfaceModule, track: Track): SurfaceModule {
  if (module.type === 'macro-knob' && module.config.semanticControl) {
    const sc = module.config.semanticControl as SemanticControlDef;
    return {
      ...module,
      config: {
        ...module.config,
        semanticControl: {
          ...sc,
          weights: sc.weights.map(w => ({
            ...w,
            moduleId: resolveModuleId(w.moduleId, track),
          })),
        },
      },
    };
  }
  return module;
}

// ---------------------------------------------------------------------------
// Template application
// ---------------------------------------------------------------------------

/**
 * Apply a surface template to a track, resolving generic module references.
 * Returns a new TrackSurface, or null if no template matches or surface wouldn't change.
 */
export function applySurfaceTemplate(track: Track): TrackSurface | null {
  const signature = getChainSignature(track);
  const template = getTemplateForChain(signature);
  if (!template) return null;

  const resolvedModules = template.modules.map(m => resolveModule(m, track));

  // Skip if the surface wouldn't actually change
  const currentIds = track.surface.modules.map(m => m.id).join(',');
  const newIds = resolvedModules.map(m => m.id).join(',');
  if (currentIds === newIds) return null;

  return {
    ...track.surface,
    modules: resolvedModules,
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

  for (const mod of surface.modules) {
    if (!isValidModuleType(mod.type)) {
      return `Unknown module type: ${mod.type}`;
    }

<<<<<<< HEAD
    // Validate required bindings per registry definition
    const bindingError = validateModuleBindings(mod);
    if (bindingError) return bindingError;

=======
>>>>>>> surface/1052-canvas
    // Validate macro-knob semantic control config
    if (mod.type === 'macro-knob' && mod.config.semanticControl) {
      const sc = mod.config.semanticControl as SemanticControlDef;
      if (!sc.weights || sc.weights.length === 0) {
        return `Macro knob '${mod.id}' has no weights`;
      }
      const weightSum = sc.weights.reduce((sum, w) => sum + w.weight, 0);
      if (Math.abs(weightSum - 1.0) > WEIGHT_SUM_TOLERANCE) {
        return `Macro knob '${mod.id}' weights sum to ${weightSum.toFixed(3)}, expected 1.0`;
      }
      for (const w of sc.weights) {
        if (!validModuleIds.has(w.moduleId)) {
          return `Macro knob '${mod.id}' references unknown module '${w.moduleId}'`;
        }
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Legacy surface migration (Layer 0c)
// ---------------------------------------------------------------------------

/**
 * Migrate a legacy TrackSurface (with semanticControls/pinnedControls/xyAxes)
 * to the new module-based format. Called during session hydration.
 */
export function migrateLegacySurface(legacy: Record<string, unknown>, trackId: string): TrackSurface {
  const modules: SurfaceModule[] = [];
  let nextY = 0;

  // Convert semantic controls -> Macro Knob modules
  const semanticControls = legacy.semanticControls as SemanticControlDef[] | undefined;
  if (semanticControls && semanticControls.length > 0) {
    for (let i = 0; i < semanticControls.length; i++) {
      const sc = semanticControls[i];
      modules.push({
        type: 'macro-knob',
        id: sc.id,
        label: sc.name,
        bindings: [{ role: 'control', trackId, target: sc.id }],
        position: { x: i * 2, y: 0, w: 2, h: 2 },
        config: { semanticControl: sc },
      });
    }
    nextY = 2;
  }

  // Convert xyAxes -> XY Pad module (only if axes were set and non-empty)
  const xyAxes = legacy.xyAxes as { x: string; y: string } | undefined;
  if (xyAxes && (xyAxes.x || xyAxes.y)) {
    modules.push({
      type: 'xy-pad',
      id: 'xy-pad',
      label: 'XY Pad',
      bindings: [
        { role: 'x-axis', trackId, target: xyAxes.x || 'timbre' },
        { role: 'y-axis', trackId, target: xyAxes.y || 'morph' },
      ],
      position: { x: semanticControls ? semanticControls.length * 2 : 0, y: 0, w: 4, h: 4 },
      config: {},
    });
    nextY = Math.max(nextY, 4);
  }

  // Convert pinned controls -> Knob Group modules with { pinned: true }
  const pinnedControls = legacy.pinnedControls as PinnedControl[] | undefined;
  if (pinnedControls && pinnedControls.length > 0) {
    for (let i = 0; i < pinnedControls.length; i++) {
      const pin = pinnedControls[i];
      modules.push({
        type: 'knob-group',
        id: `pinned-${pin.moduleId}-${pin.controlId}`,
        label: `${pin.controlId}`,
        bindings: [{ role: 'control', trackId, target: `${pin.moduleId}:${pin.controlId}` }],
        position: { x: i * 2, y: nextY, w: 2, h: 2 },
        config: { pinned: true },
      });
    }
  }

  return {
    modules,
    thumbprint: (legacy.thumbprint as ThumbprintConfig) ?? { type: 'static-color' },
  };
}
