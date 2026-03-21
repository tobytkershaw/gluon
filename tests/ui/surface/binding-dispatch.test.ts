import { describe, it, expect, vi } from 'vitest';
import { canDispatch, dispatchMutations } from '../../../src/ui/surface/binding-dispatch';
import type { BindingTarget, ParamMutation } from '../../../src/engine/types';

describe('dispatchMutations', () => {
  it('dispatches sourceParam to onParamChange', () => {
    const onParamChange = vi.fn();
    const mutations: ParamMutation[] = [
      { kind: 'sourceParam', param: 'timbre', value: 0.7 },
    ];
    dispatchMutations(mutations, { onParamChange });
    expect(onParamChange).toHaveBeenCalledWith('timbre', 0.7);
  });

  it('dispatches processorParam to onProcessorParamChange', () => {
    const onProcessorParamChange = vi.fn();
    const mutations: ParamMutation[] = [
      { kind: 'processorParam', processorId: 'reverb', param: 'decay', value: 0.5 },
    ];
    dispatchMutations(mutations, { onProcessorParamChange });
    expect(onProcessorParamChange).toHaveBeenCalledWith('reverb', 'decay', 0.5);
  });

  it('dispatches multiple mutations', () => {
    const onParamChange = vi.fn();
    const onProcessorParamChange = vi.fn();
    const mutations: ParamMutation[] = [
      { kind: 'sourceParam', param: 'harmonics', value: 0.3 },
      { kind: 'processorParam', processorId: 'eq', param: 'frequency', value: 0.8 },
      { kind: 'sourceParam', param: 'morph', value: 0.1 },
    ];
    dispatchMutations(mutations, { onParamChange, onProcessorParamChange });
    expect(onParamChange).toHaveBeenCalledTimes(2);
    expect(onProcessorParamChange).toHaveBeenCalledTimes(1);
  });

  it('silently drops mutations without matching callbacks', () => {
    const mutations: ParamMutation[] = [
      { kind: 'modulatorParam', modulatorId: 'lfo1', param: 'rate', value: 0.5 },
      { kind: 'mixParam', param: 'volume', value: 0.8 },
      { kind: 'drumPadParam', padId: 'kick', param: 'level', value: 0.6 },
    ];
    // No callbacks provided — should not throw
    expect(() => dispatchMutations(mutations, {})).not.toThrow();
  });

  it('handles empty mutations array', () => {
    const onParamChange = vi.fn();
    dispatchMutations([], { onParamChange });
    expect(onParamChange).not.toHaveBeenCalled();
  });
});

describe('canDispatch', () => {
  it('returns true for source targets', () => {
    expect(canDispatch({ kind: 'source', param: 'timbre' })).toBe(true);
  });

  it('returns true for processor targets', () => {
    expect(canDispatch({ kind: 'processor', processorId: 'reverb', param: 'decay' })).toBe(true);
  });

  it('returns false for modulator targets', () => {
    expect(canDispatch({ kind: 'modulator', modulatorId: 'lfo1', param: 'rate' })).toBe(false);
  });

  it('returns false for mix targets', () => {
    expect(canDispatch({ kind: 'mix', param: 'volume' })).toBe(false);
  });

  it('returns false for drumPad targets', () => {
    expect(canDispatch({ kind: 'drumPad', padId: 'kick', param: 'level' })).toBe(false);
  });

  it('returns true for weighted targets with only source/processor mappings', () => {
    const target: BindingTarget = {
      kind: 'weighted',
      mappings: [
        { target: { kind: 'source', param: 'timbre' }, weight: 0.5 },
        { target: { kind: 'processor', processorId: 'eq', param: 'freq' }, weight: 0.5 },
      ],
    };
    expect(canDispatch(target)).toBe(true);
  });

  it('returns false for weighted targets containing undispatchable mappings', () => {
    const target: BindingTarget = {
      kind: 'weighted',
      mappings: [
        { target: { kind: 'source', param: 'timbre' }, weight: 0.5 },
        { target: { kind: 'mix', param: 'volume' }, weight: 0.5 },
      ],
    };
    expect(canDispatch(target)).toBe(false);
  });
});
