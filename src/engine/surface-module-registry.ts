/**
 * Surface module registry: definitions for composable UI modules on the Surface.
 *
 * Each SurfaceModuleDef describes a module type — its required/optional bindings,
 * size constraints, and metadata. The registry provides lookup and validation.
 */

export interface SurfaceModuleDef {
  type: string;
  name: string;
  description: string;
  requiredBindings: { role: string; description: string }[];
  optionalBindings?: { role: string; description: string }[];
  defaultSize: { w: number; h: number };
  minSize?: { w: number; h: number };
  maxSize?: { w: number; h: number };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const moduleDefs: SurfaceModuleDef[] = [
  {
    type: 'knob-group',
    name: 'Knob Group',
    description: 'Bank of labelled rotary knobs bound to control IDs.',
    requiredBindings: [{ role: 'control', description: 'Parameter to control (one per knob)' }],
    defaultSize: { w: 4, h: 2 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 12, h: 4 },
  },
  {
    type: 'macro-knob',
    name: 'Macro Knob',
    description: 'Single knob with weighted multi-parameter mapping. Config contains SemanticControlDef shape.',
    requiredBindings: [{ role: 'control', description: 'Weighted parameter mapping (via config)' }],
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 1, h: 2 },
    maxSize: { w: 3, h: 3 },
  },
  {
    type: 'xy-pad',
    name: 'XY Pad',
    description: 'Two-dimensional continuous control bound to two control IDs.',
    requiredBindings: [
      { role: 'x-axis', description: 'Parameter bound to X axis' },
      { role: 'y-axis', description: 'Parameter bound to Y axis' },
    ],
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 6, h: 6 },
  },
  {
    type: 'step-grid',
    name: 'Step Grid',
    description: 'TR-style gate/velocity/accent row bound to region events.',
    requiredBindings: [{ role: 'region', description: 'Region to display/edit events for' }],
    defaultSize: { w: 12, h: 3 },
    minSize: { w: 6, h: 2 },
    maxSize: { w: 12, h: 4 },
  },
  {
    type: 'chain-strip',
    name: 'Chain Strip',
    description: 'Signal flow diagram with bypass toggles for the processor chain.',
    requiredBindings: [{ role: 'chain', description: 'Track whose processor chain to display' }],
    defaultSize: { w: 12, h: 2 },
    minSize: { w: 6, h: 2 },
    maxSize: { w: 12, h: 3 },
  },
  {
    type: 'piano-roll',
    name: 'Piano Roll',
    description: 'Pitch × time note editor bound to region events (melodic content).',
    requiredBindings: [{ role: 'region', description: 'Region to display/edit note events for' }],
    defaultSize: { w: 8, h: 4 },
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 6 },
  },
];

const moduleDefMap = new Map<string, SurfaceModuleDef>(
  moduleDefs.map(d => [d.type, d]),
);

/**
 * Look up a module definition by type.
 */
export function getModuleDef(type: string): SurfaceModuleDef | undefined {
  return moduleDefMap.get(type);
}

/**
 * Get all registered module definitions.
 */
export function getAllModuleDefs(): readonly SurfaceModuleDef[] {
  return moduleDefs;
}

/**
 * Check if a module type exists in the registry.
 */
export function isValidModuleType(type: string): boolean {
  return moduleDefMap.has(type);
}

// ---------------------------------------------------------------------------
// Binding validation
// ---------------------------------------------------------------------------

/**
 * Validate that a SurfaceModule's bindings satisfy its definition's requirements.
 * Returns null if valid, or an error string describing the problem.
 */
export function validateModuleBindings(
  module: { type: string; bindings: { role: string }[] },
): string | null {
  const def = getModuleDef(module.type);
  if (!def) return `Unknown module type: ${module.type}`;

  for (const req of def.requiredBindings) {
    const hasBinding = module.bindings.some(b => b.role === req.role);
    if (!hasBinding) {
      return `Module type '${module.type}' requires binding with role '${req.role}'`;
    }
  }

  return null;
}
