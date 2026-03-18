import { describe, it, expect } from 'vitest';
import {
  getArchetype,
  getArchetypeList,
  generateArchetypeEvents,
  ARCHETYPE_NAMES,
} from '../../src/engine/pattern-archetypes';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe('pattern archetype registry', () => {
  it('has at least 15 built-in archetypes', () => {
    expect(ARCHETYPE_NAMES.length).toBeGreaterThanOrEqual(15);
  });

  it('includes drum archetypes', () => {
    const drums = ['four_on_the_floor', 'two_and_four', 'offbeat_hat', '16th_hat', 'breakbeat', 'halftime', 'dnb_break'];
    for (const name of drums) {
      expect(getArchetype(name), `missing archetype: ${name}`).toBeDefined();
    }
  });

  it('includes bass archetypes', () => {
    const bass = ['root_eighth', 'octave_bounce', 'walking_bass', 'syncopated_sub'];
    for (const name of bass) {
      expect(getArchetype(name), `missing archetype: ${name}`).toBeDefined();
    }
  });

  it('includes melodic archetypes', () => {
    const melodic = ['arp_up', 'arp_down', 'arp_updown', 'stab'];
    for (const name of melodic) {
      expect(getArchetype(name), `missing archetype: ${name}`).toBeDefined();
    }
  });

  it('returns undefined for unknown archetype', () => {
    expect(getArchetype('nonexistent')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getArchetypeList
// ---------------------------------------------------------------------------

describe('getArchetypeList', () => {
  it('returns entries with name, description, and instrumentHint', () => {
    const list = getArchetypeList();
    expect(list.length).toBeGreaterThan(0);
    for (const entry of list) {
      expect(entry.name).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(entry.instrumentHint).toBeTruthy();
    }
  });

  it('has unique names', () => {
    const names = getArchetypeList().map(e => e.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ---------------------------------------------------------------------------
// Event generation
// ---------------------------------------------------------------------------

describe('generateArchetypeEvents', () => {
  it('returns empty array for unknown archetype', () => {
    expect(generateArchetypeEvents('nonexistent')).toEqual([]);
  });

  it.each(ARCHETYPE_NAMES)('archetype "%s" produces valid events', (name) => {
    const events = generateArchetypeEvents(name);
    expect(events.length).toBeGreaterThan(0);

    for (const e of events) {
      expect(e.at).toBeGreaterThanOrEqual(0);
      expect(e.kind).toBeTruthy();

      if (e.kind === 'trigger') {
        if (e.velocity !== undefined) {
          expect(e.velocity).toBeGreaterThanOrEqual(0);
          expect(e.velocity).toBeLessThanOrEqual(1);
        }
      }
      if (e.kind === 'note') {
        expect(e.pitch).toBeGreaterThanOrEqual(0);
        expect(e.pitch).toBeLessThanOrEqual(127);
        expect(e.velocity).toBeGreaterThanOrEqual(0);
        expect(e.velocity).toBeLessThanOrEqual(1);
        expect(e.duration).toBeGreaterThan(0);
      }
    }
  });

  it('four_on_the_floor has 4 events at beats', () => {
    const events = generateArchetypeEvents('four_on_the_floor');
    expect(events.length).toBe(4);
    expect(events.map(e => e.at)).toEqual([0, 4, 8, 12]);
  });

  it('16th_hat has 16 events', () => {
    const events = generateArchetypeEvents('16th_hat');
    expect(events.length).toBe(16);
  });

  it('stab has chord events (multiple notes at same position)', () => {
    const events = generateArchetypeEvents('stab');
    const atZero = events.filter(e => e.at === 0);
    expect(atZero.length).toBe(3); // triad
  });

  it('dnb_break spans 2 bars', () => {
    const arch = getArchetype('dnb_break')!;
    expect(arch.bars).toBe(2);
    const events = generateArchetypeEvents('dnb_break');
    const maxAt = Math.max(...events.map(e => e.at));
    expect(maxAt).toBeGreaterThan(16); // extends beyond 1 bar
  });
});

// ---------------------------------------------------------------------------
// Rescaling
// ---------------------------------------------------------------------------

describe('archetype rescaling', () => {
  it('rescales events to different stepsPerBar', () => {
    const events16 = generateArchetypeEvents('four_on_the_floor', { stepsPerBar: 16 });
    const events32 = generateArchetypeEvents('four_on_the_floor', { stepsPerBar: 32 });

    // Same number of events
    expect(events32.length).toBe(events16.length);
    // Positions are doubled
    expect(events32.map(e => e.at)).toEqual([0, 8, 16, 24]);
  });

  it('tiles events when requesting more bars', () => {
    const events1 = generateArchetypeEvents('four_on_the_floor', { bars: 1 });
    const events2 = generateArchetypeEvents('four_on_the_floor', { bars: 2 });

    expect(events2.length).toBe(events1.length * 2);
    // Second bar starts at step 16
    const secondBarEvents = events2.filter(e => e.at >= 16);
    expect(secondBarEvents.length).toBe(4);
  });
});
