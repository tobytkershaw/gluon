import { describe, it, expect } from 'vitest';
import {
  getArrangementArchetype,
  expandArchetype,
  getDensityConfig,
  ARRANGEMENT_ARCHETYPE_NAMES,
  getArrangementArchetypeList,
} from '../../src/engine/arrangement-archetypes';
import type { DensityLevel } from '../../src/engine/arrangement-archetypes';

describe('arrangement-archetypes', () => {
  describe('ARRANGEMENT_ARCHETYPE_NAMES', () => {
    it('contains at least 4 archetypes', () => {
      expect(ARRANGEMENT_ARCHETYPE_NAMES.length).toBeGreaterThanOrEqual(4);
    });

    it('includes expected archetypes', () => {
      expect(ARRANGEMENT_ARCHETYPE_NAMES).toContain('techno_64bar');
      expect(ARRANGEMENT_ARCHETYPE_NAMES).toContain('house_32bar');
      expect(ARRANGEMENT_ARCHETYPE_NAMES).toContain('dnb_64bar');
      expect(ARRANGEMENT_ARCHETYPE_NAMES).toContain('ambient_32bar');
    });
  });

  describe('getArrangementArchetype', () => {
    it('returns undefined for unknown archetype', () => {
      expect(getArrangementArchetype('nonexistent')).toBeUndefined();
    });

    it('returns archetype for known name', () => {
      const arch = getArrangementArchetype('techno_64bar');
      expect(arch).toBeDefined();
      expect(arch!.name).toBe('techno_64bar');
      expect(arch!.totalBars).toBe(64);
    });
  });

  describe('archetype definitions are valid', () => {
    for (const name of ARRANGEMENT_ARCHETYPE_NAMES) {
      describe(name, () => {
        const arch = getArrangementArchetype(name)!;

        it('has a non-empty name matching the key', () => {
          expect(arch.name).toBe(name);
        });

        it('has a non-empty description', () => {
          expect(arch.description.length).toBeGreaterThan(0);
        });

        it('has at least one genre', () => {
          expect(arch.genre.length).toBeGreaterThan(0);
        });

        it('has at least 2 sections', () => {
          expect(arch.sections.length).toBeGreaterThanOrEqual(2);
        });

        it('section bars sum to totalBars (no gaps or overlaps)', () => {
          const sum = arch.sections.reduce((acc, s) => acc + s.bars, 0);
          expect(sum).toBe(arch.totalBars);
        });

        it('all sections have positive bar counts', () => {
          for (const section of arch.sections) {
            expect(section.bars).toBeGreaterThan(0);
          }
        });

        it('all sections have valid density levels', () => {
          const validLevels: DensityLevel[] = ['silent', 'sparse', 'rising', 'full', 'minimal', 'dissolving'];
          for (const section of arch.sections) {
            expect(validLevels).toContain(section.density);
          }
        });

        it('all sections have energy in 0.0-1.0', () => {
          for (const section of arch.sections) {
            expect(section.energy).toBeGreaterThanOrEqual(0.0);
            expect(section.energy).toBeLessThanOrEqual(1.0);
          }
        });

        it('each section has a non-empty name', () => {
          for (const section of arch.sections) {
            expect(section.name.length).toBeGreaterThan(0);
          }
        });
      });
    }
  });

  describe('getDensityConfig', () => {
    const levels: DensityLevel[] = ['silent', 'sparse', 'rising', 'full', 'minimal', 'dissolving'];

    for (const level of levels) {
      it(`returns valid config for ${level}`, () => {
        const config = getDensityConfig(level);
        expect(config.eventDensity).toBeGreaterThanOrEqual(0.0);
        expect(config.eventDensity).toBeLessThanOrEqual(1.0);
        expect(config.velocityBase).toBeGreaterThanOrEqual(0.0);
        expect(config.velocityBase).toBeLessThanOrEqual(1.0);
        expect(config.velocityRange).toBeGreaterThanOrEqual(0.0);
        expect(config.energy).toBeGreaterThanOrEqual(0.0);
        expect(config.energy).toBeLessThanOrEqual(1.0);
      });
    }

    it('silent has zero event density', () => {
      expect(getDensityConfig('silent').eventDensity).toBe(0.0);
    });

    it('full has highest event density', () => {
      const full = getDensityConfig('full');
      const sparse = getDensityConfig('sparse');
      expect(full.eventDensity).toBeGreaterThan(sparse.eventDensity);
    });
  });

  describe('expandArchetype', () => {
    it('expands techno_64bar into correct sections', () => {
      const arch = getArrangementArchetype('techno_64bar')!;
      const sections = expandArchetype(arch);

      expect(sections.length).toBe(arch.sections.length);

      // First section starts at bar 1
      expect(sections[0].startBar).toBe(1);

      // Each section's startBar follows the previous endBar
      for (let i = 1; i < sections.length; i++) {
        expect(sections[i].startBar).toBe(sections[i - 1].endBar + 1);
      }

      // Last section's endBar equals totalBars
      expect(sections[sections.length - 1].endBar).toBe(arch.totalBars);
    });

    it('computes lengthSteps as bars * 16', () => {
      const arch = getArrangementArchetype('house_32bar')!;
      const sections = expandArchetype(arch);

      for (const section of sections) {
        expect(section.lengthSteps).toBe(section.bars * 16);
      }
    });

    it('includes density config', () => {
      const arch = getArrangementArchetype('ambient_32bar')!;
      const sections = expandArchetype(arch);

      for (const section of sections) {
        const expected = getDensityConfig(section.density);
        expect(section.densityConfig).toEqual(expected);
      }
    });

    it('propagates hasFill flag', () => {
      const arch = getArrangementArchetype('techno_64bar')!;
      const sections = expandArchetype(arch);

      // Build section has hasFill = true
      const build = sections.find(s => s.name === 'Build');
      expect(build?.hasFill).toBe(true);

      // Intro section has hasFill = false (default)
      const intro = sections.find(s => s.name === 'Intro');
      expect(intro?.hasFill).toBe(false);
    });
  });

  describe('getArrangementArchetypeList', () => {
    it('returns a list with all archetypes', () => {
      const list = getArrangementArchetypeList();
      expect(list.length).toBe(ARRANGEMENT_ARCHETYPE_NAMES.length);
      for (const entry of list) {
        expect(entry.name).toBeTruthy();
        expect(entry.description).toBeTruthy();
        expect(entry.totalBars).toBeGreaterThan(0);
      }
    });
  });
});
