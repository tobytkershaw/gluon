import { describe, it, expect } from 'vitest';
import { ensureTypedTarget, targetLabel } from '../../../src/ui/surface/binding-helpers';
import type { ModuleBinding, BindingTarget } from '../../../src/engine/types';

describe('ensureTypedTarget', () => {
  it('returns the target directly if already typed', () => {
    const typedTarget: BindingTarget = { kind: 'source', param: 'timbre' };
    const binding: ModuleBinding = { role: 'control', trackId: 't1', target: typedTarget };
    const result = ensureTypedTarget(binding, 'knob-group', {});
    expect(result).toBe(typedTarget);
  });

  it('migrates a plain source param string', () => {
    const binding: ModuleBinding = { role: 'control', trackId: 't1', target: 'harmonics' };
    const result = ensureTypedTarget(binding, 'knob-group', {});
    expect(result).toEqual({ kind: 'source', param: 'harmonics' });
  });

  it('migrates a colon-separated processor param string', () => {
    const binding: ModuleBinding = { role: 'control', trackId: 't1', target: 'reverb:decay' };
    const result = ensureTypedTarget(binding, 'knob-group', {});
    expect(result).toEqual({ kind: 'processor', processorId: 'reverb', param: 'decay' });
  });

  it('migrates a macro-knob with semanticControl config to weighted target', () => {
    const binding: ModuleBinding = { role: 'control', trackId: 't1', target: 'macro' };
    const config = {
      semanticControl: {
        name: 'Brightness',
        description: 'Overall brightness',
        weights: [
          { moduleId: 'source', controlId: 'timbre', weight: 0.8, transform: 'linear' as const },
          { moduleId: 'eq', controlId: 'frequency', weight: 0.5, transform: 'linear' as const },
        ],
      },
    };
    const result = ensureTypedTarget(binding, 'macro-knob', config);
    expect(result.kind).toBe('weighted');
    if (result.kind === 'weighted') {
      expect(result.mappings).toHaveLength(2);
      expect(result.mappings[0].target).toEqual({ kind: 'source', param: 'timbre' });
      expect(result.mappings[1].target).toEqual({ kind: 'processor', processorId: 'eq', param: 'frequency' });
    }
  });

  it('migrates a region binding string to RegionTarget', () => {
    const binding: ModuleBinding = { role: 'region', trackId: 't1', target: 'pattern-1' };
    const result = ensureTypedTarget(binding, 'step-grid', {});
    expect(result).toEqual({ kind: 'region', patternId: 'pattern-1' });
  });
});

describe('targetLabel', () => {
  it('returns param name for source targets', () => {
    expect(targetLabel({ kind: 'source', param: 'timbre' })).toBe('timbre');
  });

  it('returns param name for processor targets', () => {
    expect(targetLabel({ kind: 'processor', processorId: 'reverb', param: 'decay' })).toBe('decay');
  });

  it('returns "macro" for weighted targets', () => {
    expect(targetLabel({ kind: 'weighted', mappings: [] })).toBe('macro');
  });

  it('returns patternId for region targets', () => {
    expect(targetLabel({ kind: 'region', patternId: 'p1' })).toBe('p1');
  });
});
