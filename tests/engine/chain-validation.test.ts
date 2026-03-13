// tests/engine/chain-validation.test.ts
// Tests for #101: Chain Validation Layer

import { describe, it, expect } from 'vitest';
import { validateChain, validateChainMutation, validateProcessorTarget } from '../../src/engine/chain-validation';
import type { Voice, ProcessorConfig } from '../../src/engine/types';

function makeVoice(processors: ProcessorConfig[] = []): Voice {
  return {
    id: 'v0',
    engine: 'plaits:virtual_analog',
    model: 0,
    params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
    agency: 'ON',
    pattern: { steps: [], length: 16 },
    regions: [],
    muted: false,
    solo: false,
    processors,
  };
}

function makeRingsProcessor(id: string, model = 0): ProcessorConfig {
  return {
    id,
    type: 'rings',
    model,
    params: { structure: 0.5, brightness: 0.5, damping: 0.7, position: 0.5 },
  };
}

describe('validateChain', () => {
  it('accepts empty chain', () => {
    const result = validateChain(makeVoice([]));
    expect(result.valid).toBe(true);
  });

  it('accepts 1 processor', () => {
    const result = validateChain(makeVoice([makeRingsProcessor('r1')]));
    expect(result.valid).toBe(true);
  });

  it('accepts 2 processors', () => {
    const result = validateChain(makeVoice([makeRingsProcessor('r1'), makeRingsProcessor('r2')]));
    expect(result.valid).toBe(true);
  });

  it('rejects 3 processors', () => {
    const result = validateChain(makeVoice([
      makeRingsProcessor('r1'),
      makeRingsProcessor('r2'),
      makeRingsProcessor('r3'),
    ]));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('3 processors');
    expect(result.errors[0]).toContain('max 2');
  });

  it('rejects unknown processor type', () => {
    const result = validateChain(makeVoice([{ id: 'x1', type: 'unknown', model: 0, params: {} }]));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Unknown processor type: unknown');
  });

  it('rejects duplicate processor IDs', () => {
    const result = validateChain(makeVoice([makeRingsProcessor('dup'), makeRingsProcessor('dup')]));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Duplicate processor ID: dup');
  });
});

describe('validateChainMutation', () => {
  it('accepts adding to empty chain', () => {
    const result = validateChainMutation(makeVoice([]), { kind: 'add', type: 'rings' });
    expect(result.valid).toBe(true);
  });

  it('accepts adding second processor', () => {
    const result = validateChainMutation(
      makeVoice([makeRingsProcessor('r1')]),
      { kind: 'add', type: 'rings' },
    );
    expect(result.valid).toBe(true);
  });

  it('rejects adding 3rd processor', () => {
    const result = validateChainMutation(
      makeVoice([makeRingsProcessor('r1'), makeRingsProcessor('r2')]),
      { kind: 'add', type: 'rings' },
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('already has 2 processors');
  });

  it('rejects adding unknown type', () => {
    const result = validateChainMutation(makeVoice([]), { kind: 'add', type: 'nonexistent' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Unknown processor type');
    expect(result.errors[0]).toContain('rings');
  });

  it('accepts removing existing processor', () => {
    const result = validateChainMutation(
      makeVoice([makeRingsProcessor('r1')]),
      { kind: 'remove', processorId: 'r1' },
    );
    expect(result.valid).toBe(true);
  });

  it('rejects removing nonexistent processor', () => {
    const result = validateChainMutation(
      makeVoice([makeRingsProcessor('r1')]),
      { kind: 'remove', processorId: 'nonexistent' },
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Processor not found');
  });
});

describe('validateProcessorTarget', () => {
  it('accepts valid processor with no param/model check', () => {
    const result = validateProcessorTarget(
      makeVoice([makeRingsProcessor('r1')]),
      'r1',
    );
    expect(result.valid).toBe(true);
  });

  it('rejects nonexistent processor', () => {
    const result = validateProcessorTarget(makeVoice([]), 'nonexistent');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Processor not found');
  });

  it('accepts valid param name', () => {
    const result = validateProcessorTarget(
      makeVoice([makeRingsProcessor('r1')]),
      'r1',
      { param: 'brightness' },
    );
    expect(result.valid).toBe(true);
  });

  it('rejects invalid param name', () => {
    const result = validateProcessorTarget(
      makeVoice([makeRingsProcessor('r1')]),
      'r1',
      { param: 'invalid' },
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Unknown rings control: invalid');
  });

  it('accepts valid model name', () => {
    const result = validateProcessorTarget(
      makeVoice([makeRingsProcessor('r1')]),
      'r1',
      { model: 'string' },
    );
    expect(result.valid).toBe(true);
  });

  it('rejects invalid model name', () => {
    const result = validateProcessorTarget(
      makeVoice([makeRingsProcessor('r1')]),
      'r1',
      { model: 'nonexistent' },
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Unknown rings model: nonexistent');
  });

  it('validates both param and model together', () => {
    const result = validateProcessorTarget(
      makeVoice([makeRingsProcessor('r1')]),
      'r1',
      { param: 'invalid', model: 'nonexistent' },
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
});
