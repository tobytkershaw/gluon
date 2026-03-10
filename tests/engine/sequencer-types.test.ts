// tests/engine/sequencer-types.test.ts
import { describe, it, expect } from 'vitest';
import { createDefaultStep, createDefaultPattern } from '../../src/engine/sequencer-helpers';

describe('createDefaultStep', () => {
  it('creates a step with gate off, no accent, no micro-timing', () => {
    const step = createDefaultStep();
    expect(step.gate).toBe(false);
    expect(step.accent).toBe(false);
    expect(step.micro).toBe(0);
    expect(step.params).toBeUndefined();
  });
});

describe('createDefaultPattern', () => {
  it('creates a 16-step pattern by default', () => {
    const pattern = createDefaultPattern();
    expect(pattern.length).toBe(16);
    expect(pattern.steps).toHaveLength(16);
    expect(pattern.steps.every(s => !s.gate)).toBe(true);
  });

  it('creates a pattern with custom length', () => {
    const pattern = createDefaultPattern(32);
    expect(pattern.length).toBe(32);
    expect(pattern.steps).toHaveLength(32);
  });

  it('clamps length to 1-64', () => {
    expect(createDefaultPattern(0).length).toBe(1);
    expect(createDefaultPattern(100).length).toBe(64);
  });
});
