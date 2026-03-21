// tests/ai/surface-position-lock.test.ts — Verify position lock enforcement for set_surface (#1108)

import { describe, it, expect } from 'vitest';
import { enforcePositionLocks } from '../../src/ai/api';
import type { SurfaceModule } from '../../src/engine/types';

function makeModule(overrides: Partial<SurfaceModule> & { id: string }): SurfaceModule {
  return {
    type: 'knob-group',
    label: 'Module',
    bindings: [],
    position: { x: 0, y: 0, w: 4, h: 2 },
    config: {},
    ...overrides,
  };
}

describe('enforcePositionLocks (#1108)', () => {
  it('preserves position/size of locked modules and emits warning', () => {
    const existing: SurfaceModule[] = [
      makeModule({ id: 'mod-1', label: 'Locked', position: { x: 0, y: 0, w: 4, h: 2 }, locked: true }),
    ];
    const incoming: SurfaceModule[] = [
      makeModule({ id: 'mod-1', label: 'Locked Renamed', position: { x: 6, y: 4, w: 8, h: 3 } }),
    ];

    const { modules, warnings } = enforcePositionLocks(incoming, existing);

    expect(modules[0].position).toEqual({ x: 0, y: 0, w: 4, h: 2 });
    expect(modules[0].locked).toBe(true);
    expect(modules[0].label).toBe('Locked Renamed'); // label still updated
    // Original input should not be mutated
    expect(incoming[0].position).toEqual({ x: 6, y: 4, w: 8, h: 3 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('position-locked');
  });

  it('does not modify unlocked modules', () => {
    const existing: SurfaceModule[] = [
      makeModule({ id: 'mod-1', label: 'Unlocked', position: { x: 0, y: 0, w: 4, h: 2 } }),
    ];
    const incoming: SurfaceModule[] = [
      makeModule({ id: 'mod-1', label: 'Moved', position: { x: 6, y: 4, w: 8, h: 3 } }),
    ];

    const { modules, warnings } = enforcePositionLocks(incoming, existing);

    expect(modules[0].position).toEqual({ x: 6, y: 4, w: 8, h: 3 });
    expect(modules[0].locked).toBeUndefined();
    expect(warnings).toHaveLength(0);
  });

  it('does not lock new modules without matching existing ID', () => {
    const existing: SurfaceModule[] = [
      makeModule({ id: 'mod-1', label: 'Old', locked: true, position: { x: 0, y: 0, w: 4, h: 2 } }),
    ];
    const incoming: SurfaceModule[] = [
      makeModule({ id: 'mod-new', label: 'New', position: { x: 2, y: 2, w: 3, h: 2 } }),
    ];

    const { modules, warnings } = enforcePositionLocks(incoming, existing);

    expect(modules[0].position).toEqual({ x: 2, y: 2, w: 3, h: 2 });
    expect(modules[0].locked).toBeUndefined();
    expect(warnings).toHaveLength(0);
  });

  it('handles mixed locked and unlocked modules', () => {
    const existing: SurfaceModule[] = [
      makeModule({ id: 'mod-1', label: 'Locked', position: { x: 0, y: 0, w: 4, h: 2 }, locked: true }),
      makeModule({ id: 'mod-2', label: 'Unlocked', position: { x: 4, y: 0, w: 4, h: 2 } }),
    ];
    const incoming: SurfaceModule[] = [
      makeModule({ id: 'mod-1', label: 'Locked Renamed', position: { x: 8, y: 8, w: 6, h: 3 } }),
      makeModule({ id: 'mod-2', label: 'Unlocked Moved', position: { x: 8, y: 8, w: 6, h: 3 } }),
    ];

    const { modules, warnings } = enforcePositionLocks(incoming, existing);

    // Locked module: position preserved
    expect(modules[0].position).toEqual({ x: 0, y: 0, w: 4, h: 2 });
    expect(modules[0].locked).toBe(true);

    // Unlocked module: position updated
    expect(modules[1].position).toEqual({ x: 8, y: 8, w: 6, h: 3 });
    expect(modules[1].locked).toBeUndefined();

    expect(warnings).toHaveLength(1);
  });

  it('handles empty existing modules gracefully', () => {
    const incoming: SurfaceModule[] = [
      makeModule({ id: 'mod-1', label: 'New', position: { x: 2, y: 2, w: 3, h: 2 } }),
    ];

    const { modules, warnings } = enforcePositionLocks(incoming, []);

    expect(modules[0].position).toEqual({ x: 2, y: 2, w: 3, h: 2 });
    expect(warnings).toHaveLength(0);
  });
});
