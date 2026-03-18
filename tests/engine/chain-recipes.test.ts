import { describe, it, expect } from 'vitest';
import { getChainRecipe, getChainRecipeList, RECIPE_NAMES } from '../../src/engine/chain-recipes';
import { getRegisteredProcessorTypes, getProcessorControlIds } from '../../src/audio/instrument-registry';

describe('chain-recipes', () => {
  const validProcessorTypes = getRegisteredProcessorTypes();

  it('RECIPE_NAMES is non-empty', () => {
    expect(RECIPE_NAMES.length).toBeGreaterThan(0);
  });

  it('getChainRecipe returns undefined for unknown recipe', () => {
    expect(getChainRecipe('nonexistent')).toBeUndefined();
  });

  it('getChainRecipe returns a recipe for each known name', () => {
    for (const name of RECIPE_NAMES) {
      const recipe = getChainRecipe(name);
      expect(recipe).toBeDefined();
      expect(recipe!.name).toBe(name);
    }
  });

  it('every recipe has valid processor types', () => {
    for (const name of RECIPE_NAMES) {
      const recipe = getChainRecipe(name)!;
      for (const proc of recipe.processors) {
        expect(validProcessorTypes).toContain(proc.type);
      }
    }
  });

  it('every recipe processor has valid param keys', () => {
    for (const name of RECIPE_NAMES) {
      const recipe = getChainRecipe(name)!;
      for (const proc of recipe.processors) {
        const validIds = getProcessorControlIds(proc.type);
        for (const paramKey of Object.keys(proc.params)) {
          expect(validIds, `Recipe "${name}": processor "${proc.type}" has unknown param "${paramKey}"`).toContain(paramKey);
        }
      }
    }
  });

  it('every recipe processor param is in 0-1 range', () => {
    for (const name of RECIPE_NAMES) {
      const recipe = getChainRecipe(name)!;
      for (const proc of recipe.processors) {
        for (const [key, val] of Object.entries(proc.params)) {
          expect(val, `Recipe "${name}" proc "${proc.type}" param "${key}"`).toBeGreaterThanOrEqual(0);
          expect(val, `Recipe "${name}" proc "${proc.type}" param "${key}"`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('every recipe has non-empty description and role', () => {
    for (const name of RECIPE_NAMES) {
      const recipe = getChainRecipe(name)!;
      expect(recipe.description.length).toBeGreaterThan(0);
      expect(recipe.role.length).toBeGreaterThan(0);
    }
  });

  it('getChainRecipeList returns all recipes', () => {
    const list = getChainRecipeList();
    expect(list.length).toBe(RECIPE_NAMES.length);
    for (const entry of list) {
      expect(entry.name).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(entry.role).toBeTruthy();
    }
  });

  it('includes expected recipes', () => {
    expect(getChainRecipe('techno_kick')).toBeDefined();
    expect(getChainRecipe('deep_bass')).toBeDefined();
    expect(getChainRecipe('crispy_hat')).toBeDefined();
    expect(getChainRecipe('ambient_pad')).toBeDefined();
    expect(getChainRecipe('aggressive_lead')).toBeDefined();
    expect(getChainRecipe('mix_bus')).toBeDefined();
  });
});
