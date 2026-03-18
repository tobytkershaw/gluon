import { describe, it, expect } from 'vitest';
import { getModulationRecipe, getModulationRecipeList, MODULATION_RECIPE_NAMES } from '../../src/engine/modulation-recipes';
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
    expect(getModulationRecipe('drift')).toBeDefined();
  });
});
