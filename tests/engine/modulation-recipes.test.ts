import { describe, it, expect } from 'vitest';
import {
  getModulationRecipe,
  getModulationRecipeList,
  resolveModulationRecipe,
  MODULATION_RECIPE_NAMES,
} from '../../src/engine/modulation-recipes';
import { getModulatorControlIds, getModulatorInstrument } from '../../src/audio/instrument-registry';

describe('modulation-recipes', () => {
  it('MODULATION_RECIPE_NAMES is non-empty', () => {
    expect(MODULATION_RECIPE_NAMES.length).toBeGreaterThan(0);
  });

  it('getModulationRecipe returns undefined for unknown recipe', () => {
    expect(getModulationRecipe('nonexistent')).toBeUndefined();
  });

  it('getModulationRecipe returns a recipe for each known name', () => {
    for (const name of MODULATION_RECIPE_NAMES) {
      const recipe = getModulationRecipe(name);
      expect(recipe).toBeDefined();
      expect(recipe!.name).toBe(name);
    }
  });

  it('every recipe uses a valid modulator type', () => {
    for (const name of MODULATION_RECIPE_NAMES) {
      const recipe = getModulationRecipe(name)!;
      const inst = getModulatorInstrument(recipe.modulatorType);
      expect(inst, `Recipe "${name}": unknown modulator type "${recipe.modulatorType}"`).toBeDefined();
    }
  });

  it('every recipe has a valid model index', () => {
    for (const name of MODULATION_RECIPE_NAMES) {
      const recipe = getModulationRecipe(name)!;
      const inst = getModulatorInstrument(recipe.modulatorType)!;
      expect(recipe.modulatorModel).toBeGreaterThanOrEqual(0);
      expect(recipe.modulatorModel).toBeLessThan(inst.engines.length);
    }
  });

  it('every recipe has valid modulator param keys', () => {
    for (const name of MODULATION_RECIPE_NAMES) {
      const recipe = getModulationRecipe(name)!;
      const validIds = getModulatorControlIds(recipe.modulatorType);
      for (const paramKey of Object.keys(recipe.modulatorParams)) {
        expect(validIds, `Recipe "${name}": unknown modulator param "${paramKey}"`).toContain(paramKey);
      }
    }
  });

  it('every recipe has modulator params in 0-1 range', () => {
    for (const name of MODULATION_RECIPE_NAMES) {
      const recipe = getModulationRecipe(name)!;
      for (const [key, val] of Object.entries(recipe.modulatorParams)) {
        expect(val, `Recipe "${name}" param "${key}"`).toBeGreaterThanOrEqual(0);
        expect(val, `Recipe "${name}" param "${key}"`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('every recipe has routeDepth in valid range', () => {
    for (const name of MODULATION_RECIPE_NAMES) {
      const recipe = getModulationRecipe(name)!;
      expect(recipe.routeDepth).toBeGreaterThanOrEqual(-1);
      expect(recipe.routeDepth).toBeLessThanOrEqual(1);
    }
  });

  it('every recipe has valid routeTargetType', () => {
    for (const name of MODULATION_RECIPE_NAMES) {
      const recipe = getModulationRecipe(name)!;
      expect(['source', 'processor']).toContain(recipe.routeTargetType);
    }
  });

  it('processor-targeted recipes specify routeTargetProcessorType', () => {
    for (const name of MODULATION_RECIPE_NAMES) {
      const recipe = getModulationRecipe(name)!;
      if (recipe.routeTargetType === 'processor') {
        expect(recipe.routeTargetProcessorType, `Recipe "${name}": processor target must specify routeTargetProcessorType`).toBeTruthy();
      }
    }
  });

  it('every recipe has non-empty description', () => {
    for (const name of MODULATION_RECIPE_NAMES) {
      const recipe = getModulationRecipe(name)!;
      expect(recipe.description.length).toBeGreaterThan(0);
    }
  });

  it('getModulationRecipeList returns all recipes', () => {
    const list = getModulationRecipeList();
    expect(list.length).toBe(MODULATION_RECIPE_NAMES.length);
    for (const entry of list) {
      expect(entry.name).toBeTruthy();
      expect(entry.description).toBeTruthy();
    }
  });

  it('includes expected recipes', () => {
    expect(getModulationRecipe('vibrato')).toBeDefined();
    expect(getModulationRecipe('slow_filter_sweep')).toBeDefined();
    expect(getModulationRecipe('fast_filter_sweep')).toBeDefined();
    expect(getModulationRecipe('tremolo')).toBeDefined();
    expect(getModulationRecipe('wobble')).toBeDefined();
    expect(getModulationRecipe('wobble_bass')).toBeDefined();
    expect(getModulationRecipe('pulsing_pad')).toBeDefined();
    expect(getModulationRecipe('auto_wah')).toBeDefined();
    expect(getModulationRecipe('ducking_sidechain')).toBeDefined();
    expect(getModulationRecipe('drift')).toBeDefined();
  });

  it('ducking_sidechain uses AD envelope (model 0)', () => {
    const recipe = getModulationRecipe('ducking_sidechain')!;
    expect(recipe.modulatorModel).toBe(0);
    expect(recipe.routeDepth).toBeLessThan(0); // negative depth for ducking
  });
});

describe('resolveModulationRecipe', () => {
  it('returns undefined for unknown recipe', () => {
    expect(resolveModulationRecipe('nonexistent')).toBeUndefined();
  });

  it('returns unmodified recipe when no overrides', () => {
    const base = getModulationRecipe('vibrato')!;
    const resolved = resolveModulationRecipe('vibrato')!;
    expect(resolved.routeDepth).toBe(base.routeDepth);
    expect(resolved.modulatorParams.frequency).toBe(base.modulatorParams.frequency);
  });

  it('overrides depth', () => {
    const resolved = resolveModulationRecipe('vibrato', { depth: 0.5 })!;
    expect(resolved.routeDepth).toBe(0.5);
    // Other params unchanged
    const base = getModulationRecipe('vibrato')!;
    expect(resolved.modulatorParams.frequency).toBe(base.modulatorParams.frequency);
  });

  it('overrides rate (maps to frequency)', () => {
    const resolved = resolveModulationRecipe('tremolo', { rate: 0.8 })!;
    expect(resolved.modulatorParams.frequency).toBe(0.8);
  });

  it('overrides shape', () => {
    const resolved = resolveModulationRecipe('wobble', { shape: 0.9 })!;
    expect(resolved.modulatorParams.shape).toBe(0.9);
  });

  it('overrides smoothness', () => {
    const resolved = resolveModulationRecipe('drift', { smoothness: 0.3 })!;
    expect(resolved.modulatorParams.smoothness).toBe(0.3);
  });

  it('overrides target control ID', () => {
    const resolved = resolveModulationRecipe('vibrato', { target: 'harmonics' })!;
    expect(resolved.routeTarget).toBe('harmonics');
  });

  it('overrides targetType', () => {
    const resolved = resolveModulationRecipe('slow_filter_sweep', { targetType: 'source' })!;
    expect(resolved.routeTargetType).toBe('source');
    expect(resolved.routeTargetProcessorType).toBeUndefined();
  });

  it('clamps depth to valid range', () => {
    const resolved = resolveModulationRecipe('vibrato', { depth: 5.0 })!;
    expect(resolved.routeDepth).toBe(1.0);
    const resolved2 = resolveModulationRecipe('vibrato', { depth: -3.0 })!;
    expect(resolved2.routeDepth).toBe(-1.0);
  });

  it('clamps rate to valid range', () => {
    const resolved = resolveModulationRecipe('vibrato', { rate: 2.0 })!;
    expect(resolved.modulatorParams.frequency).toBe(1.0);
    const resolved2 = resolveModulationRecipe('vibrato', { rate: -1.0 })!;
    expect(resolved2.modulatorParams.frequency).toBe(0.0);
  });

  it('applies multiple overrides simultaneously', () => {
    const resolved = resolveModulationRecipe('wobble', {
      depth: 0.9,
      rate: 0.7,
      shape: 0.1,
      smoothness: 0.2,
    })!;
    expect(resolved.routeDepth).toBe(0.9);
    expect(resolved.modulatorParams.frequency).toBe(0.7);
    expect(resolved.modulatorParams.shape).toBe(0.1);
    expect(resolved.modulatorParams.smoothness).toBe(0.2);
    // slope should be unchanged from recipe default
    const base = getModulationRecipe('wobble')!;
    expect(resolved.modulatorParams.slope).toBe(base.modulatorParams.slope);
  });

  it('does not mutate the original recipe', () => {
    const before = getModulationRecipe('vibrato')!;
    const originalDepth = before.routeDepth;
    resolveModulationRecipe('vibrato', { depth: 0.99 });
    const after = getModulationRecipe('vibrato')!;
    expect(after.routeDepth).toBe(originalDepth);
  });
});
