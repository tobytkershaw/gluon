import { describe, it, expect } from 'vitest';
import type { TriggerEvent, NoteEvent } from '../../src/engine/canonical-types';
import {
  eventsToGrid,
  gridToEvents,
  eventsToKit,
  kitToEvents,
  gridLength,
  velocityToGridChar,
  formatLegend,
  DEFAULT_LEGEND,
  DRUM_NOTE_DEFAULT_PITCH,
} from '../../src/engine/drum-grid';

describe('drum-grid', () => {
  describe('velocityToGridChar', () => {
    it('maps accent velocity to x', () => {
      expect(velocityToGridChar(0.95)).toBe('x');
      expect(velocityToGridChar(1.0)).toBe('x');
      expect(velocityToGridChar(0.90)).toBe('x');
    });

    it('maps loud velocity to H', () => {
      expect(velocityToGridChar(0.88)).toBe('H');
      expect(velocityToGridChar(0.84)).toBe('H');
      expect(velocityToGridChar(0.89)).toBe('H');
    });

    it('maps open velocity to O', () => {
      expect(velocityToGridChar(0.80)).toBe('O');
      expect(velocityToGridChar(0.77)).toBe('O');
      expect(velocityToGridChar(0.83)).toBe('O');
    });

    it('maps normal velocity to o', () => {
      expect(velocityToGridChar(0.75)).toBe('o');
      expect(velocityToGridChar(0.60)).toBe('o');
      expect(velocityToGridChar(0.76)).toBe('o');
    });

    it('maps soft velocity to h', () => {
      expect(velocityToGridChar(0.50)).toBe('h');
      expect(velocityToGridChar(0.40)).toBe('h');
    });

    it('maps ghost velocity to g', () => {
      expect(velocityToGridChar(0.30)).toBe('g');
      expect(velocityToGridChar(0.20)).toBe('g');
    });

    it('maps sub-ghost velocity to rest', () => {
      expect(velocityToGridChar(0.19)).toBe('.');
      expect(velocityToGridChar(0)).toBe('.');
    });
  });

  describe('eventsToGrid', () => {
    it('serialises a basic four-on-the-floor (1 bar)', () => {
      const events: TriggerEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.95, padId: 'kick' },
        { kind: 'trigger', at: 4, velocity: 0.75, padId: 'kick' },
        { kind: 'trigger', at: 8, velocity: 0.95, padId: 'kick' },
        { kind: 'trigger', at: 12, velocity: 0.75, padId: 'kick' },
      ];
      expect(eventsToGrid(events, 16)).toBe('x...o...x...o...');
    });

    it('serialises a 2-bar pattern with bar lines', () => {
      const events: TriggerEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.95, padId: 'kick' },
        { kind: 'trigger', at: 16, velocity: 0.95, padId: 'kick' },
      ];
      expect(eventsToGrid(events, 32)).toBe('x...............|x...............');
    });

    it('handles empty patterns', () => {
      expect(eventsToGrid([], 16)).toBe('................');
    });

    it('handles single bar patterns', () => {
      const events: TriggerEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.95, padId: 'kick' },
      ];
      expect(eventsToGrid(events, 8, 8)).toBe('x.......');
    });

    it('handles patterns shorter than one bar', () => {
      const events: TriggerEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.75, padId: 'kick' },
      ];
      expect(eventsToGrid(events, 4, 16)).toBe('o...');
    });

    it('skips events with velocity=0 sentinel', () => {
      const events: TriggerEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.95, padId: 'kick' },
        { kind: 'trigger', at: 4, velocity: 0, padId: 'kick' },
      ];
      expect(eventsToGrid(events, 8, 8)).toBe('x.......');
    });

    it('skips out-of-range events', () => {
      const events: TriggerEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.95, padId: 'kick' },
        { kind: 'trigger', at: 20, velocity: 0.75, padId: 'kick' },
      ];
      expect(eventsToGrid(events, 16)).toBe('x...............');
    });

    it('serialises NoteEvents with padId (new format)', () => {
      const events: NoteEvent[] = [
        { kind: 'note', at: 0, pitch: 60, velocity: 0.95, duration: 1, padId: 'kick' },
        { kind: 'note', at: 4, pitch: 60, velocity: 0.75, duration: 1, padId: 'kick' },
      ];
      expect(eventsToGrid(events, 8, 8)).toBe('x...o...');
    });
  });

  describe('gridToEvents', () => {
    it('parses a basic grid string into NoteEvents', () => {
      const events = gridToEvents('x...o...x...o...', 'kick');
      expect(events).toHaveLength(4);
      expect(events[0]).toEqual({ kind: 'note', at: 0, pitch: DRUM_NOTE_DEFAULT_PITCH, velocity: 0.95, duration: 1, padId: 'kick' });
      expect(events[1]).toEqual({ kind: 'note', at: 4, pitch: DRUM_NOTE_DEFAULT_PITCH, velocity: 0.75, duration: 1, padId: 'kick' });
      expect(events[2]).toEqual({ kind: 'note', at: 8, pitch: DRUM_NOTE_DEFAULT_PITCH, velocity: 0.95, duration: 1, padId: 'kick' });
      expect(events[3]).toEqual({ kind: 'note', at: 12, pitch: DRUM_NOTE_DEFAULT_PITCH, velocity: 0.75, duration: 1, padId: 'kick' });
    });

    it('parses a grid string with bar lines', () => {
      const events = gridToEvents('x...o...|x...o...', 'kick');
      expect(events).toHaveLength(4);
      expect(events[0].at).toBe(0);
      expect(events[1].at).toBe(4);
      expect(events[2].at).toBe(8);
      expect(events[3].at).toBe(12);
    });

    it('handles empty patterns', () => {
      const events = gridToEvents('................', 'kick');
      expect(events).toHaveLength(0);
    });

    it('handles ghost notes', () => {
      const events = gridToEvents('g...', 'hat');
      expect(events).toHaveLength(1);
      expect(events[0].velocity).toBe(0.30);
      expect(events[0].padId).toBe('hat');
      expect(events[0].kind).toBe('note');
      expect(events[0].pitch).toBe(DRUM_NOTE_DEFAULT_PITCH);
    });

    it('handles all velocity categories', () => {
      const events = gridToEvents('xHOogh', 'test');
      expect(events).toHaveLength(6);
      expect(events.map(e => e.velocity)).toEqual([0.95, 0.88, 0.80, 0.75, 0.30, 0.50]);
    });

    it('ignores unknown characters', () => {
      const events = gridToEvents('x.?.o', 'kick');
      // '?' is unknown, treated as step but no event
      expect(events).toHaveLength(2);
      expect(events[0].at).toBe(0);
      expect(events[1].at).toBe(4);
    });

    it('accepts custom legend', () => {
      const legend = { 'X': { velocity: 1.0, label: 'max' } };
      const events = gridToEvents('X...', 'kick', legend);
      expect(events).toHaveLength(1);
      expect(events[0].velocity).toBe(1.0);
    });
  });

  describe('round-trip: eventsToGrid → gridToEvents', () => {
    it('preserves event positions through round-trip', () => {
      const original: TriggerEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.95, padId: 'kick' },
        { kind: 'trigger', at: 4, velocity: 0.75, padId: 'kick' },
        { kind: 'trigger', at: 8, velocity: 0.30, padId: 'kick' },
        { kind: 'trigger', at: 12, velocity: 0.50, padId: 'kick' },
      ];
      const grid = eventsToGrid(original, 16);
      const parsed = gridToEvents(grid, 'kick');

      expect(parsed).toHaveLength(original.length);
      for (let i = 0; i < original.length; i++) {
        expect(parsed[i].at).toBe(original[i].at);
        expect(parsed[i].padId).toBe('kick');
        // Round-tripped events are now NoteEvents
        expect(parsed[i].kind).toBe('note');
      }
    });

    it('maps velocities to categorical midpoints (lossy but consistent)', () => {
      // Velocity 0.95 → 'x' → 0.95 (round-trips exactly for category midpoints)
      const original: TriggerEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.95, padId: 'kick' },
        { kind: 'trigger', at: 4, velocity: 0.75, padId: 'kick' },
      ];
      const grid = eventsToGrid(original, 8, 8);
      const parsed = gridToEvents(grid, 'kick');

      expect(parsed[0].velocity).toBe(DEFAULT_LEGEND['x'].velocity);
      expect(parsed[1].velocity).toBe(DEFAULT_LEGEND['o'].velocity);
    });

    it('round-trips H and O characters (RFC hat pattern)', () => {
      // This is the RFC's example: "hHh.hHh." — must survive serialise→parse→serialise
      const grid = 'hHh.hHh.';
      const parsed = gridToEvents(grid, 'hat');
      const reSerialized = eventsToGrid(parsed, 8, 8);
      expect(reSerialized).toBe(grid);
    });

    it('round-trips all legend characters', () => {
      const grid = 'xHOogh..';
      const parsed = gridToEvents(grid, 'test');
      const reSerialized = eventsToGrid(parsed, 8, 8);
      expect(reSerialized).toBe(grid);
    });

    it('round-trips a 2-bar pattern', () => {
      const original: TriggerEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.95, padId: 'snare' },
        { kind: 'trigger', at: 4, velocity: 0.75, padId: 'snare' },
        { kind: 'trigger', at: 16, velocity: 0.95, padId: 'snare' },
        { kind: 'trigger', at: 20, velocity: 0.30, padId: 'snare' },
      ];
      const grid = eventsToGrid(original, 32);
      const parsed = gridToEvents(grid, 'snare');

      expect(parsed).toHaveLength(4);
      expect(parsed.map(e => e.at)).toEqual([0, 4, 16, 20]);
    });
  });

  describe('eventsToKit / kitToEvents', () => {
    it('serialises a multi-pad kit (legacy TriggerEvents)', () => {
      const events: TriggerEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.95, padId: 'kick' },
        { kind: 'trigger', at: 4, velocity: 0.95, padId: 'snare' },
        { kind: 'trigger', at: 8, velocity: 0.95, padId: 'kick' },
        { kind: 'trigger', at: 12, velocity: 0.95, padId: 'snare' },
      ];
      const kit = eventsToKit(events, ['kick', 'snare'], 16);

      expect(kit['kick']).toBe('x.......x.......');
      expect(kit['snare']).toBe('....x.......x...');
    });

    it('serialises a multi-pad kit (NoteEvents)', () => {
      const events: NoteEvent[] = [
        { kind: 'note', at: 0, pitch: 60, velocity: 0.95, duration: 1, padId: 'kick' },
        { kind: 'note', at: 4, pitch: 60, velocity: 0.95, duration: 1, padId: 'snare' },
      ];
      const kit = eventsToKit(events, ['kick', 'snare'], 8, 8);

      expect(kit['kick']).toBe('x.......');
      expect(kit['snare']).toBe('....x...');
    });

    it('includes empty lanes for pads with no events', () => {
      const events: TriggerEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.95, padId: 'kick' },
      ];
      const kit = eventsToKit(events, ['kick', 'hat'], 16);

      expect(kit['hat']).toBe('................');
    });

    it('round-trips a full kit', () => {
      const original: TriggerEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.95, padId: 'kick' },
        { kind: 'trigger', at: 4, velocity: 0.75, padId: 'kick' },
        { kind: 'trigger', at: 8, velocity: 0.95, padId: 'kick' },
        { kind: 'trigger', at: 12, velocity: 0.75, padId: 'kick' },
        { kind: 'trigger', at: 4, velocity: 0.95, padId: 'snare' },
        { kind: 'trigger', at: 12, velocity: 0.95, padId: 'snare' },
        { kind: 'trigger', at: 0, velocity: 0.50, padId: 'hat' },
        { kind: 'trigger', at: 2, velocity: 0.88, padId: 'hat' },
        { kind: 'trigger', at: 4, velocity: 0.50, padId: 'hat' },
        { kind: 'trigger', at: 6, velocity: 0.88, padId: 'hat' },
      ];
      const kit = eventsToKit(original, ['kick', 'snare', 'hat'], 16);
      const parsed = kitToEvents(kit);

      // Verify all events round-trip (sorted by at)
      expect(parsed).toHaveLength(10);
      // All padIds preserved
      expect(parsed.filter(e => e.padId === 'kick')).toHaveLength(4);
      expect(parsed.filter(e => e.padId === 'snare')).toHaveLength(2);
      expect(parsed.filter(e => e.padId === 'hat')).toHaveLength(4);
      // Round-tripped events are NoteEvents
      expect(parsed.every(e => e.kind === 'note')).toBe(true);
    });

    it('kitToEvents returns events sorted by at', () => {
      const kit = {
        'kick': 'x...',
        'snare': '.x..',
        'hat': 'hh..',
      };
      const events = kitToEvents(kit);
      for (let i = 1; i < events.length; i++) {
        expect(events[i].at).toBeGreaterThanOrEqual(events[i - 1].at);
      }
    });
  });

  describe('gridLength', () => {
    it('counts steps excluding bar lines', () => {
      expect(gridLength('x...o...x...o...')).toBe(16);
      expect(gridLength('x...o...|x...o...')).toBe(16);
      expect(gridLength('x...')).toBe(4);
      expect(gridLength('x...|o...|g...')).toBe(12);
    });

    it('handles empty string', () => {
      expect(gridLength('')).toBe(0);
    });
  });

  describe('formatLegend', () => {
    it('formats the default legend with rest and bar', () => {
      const legend = formatLegend();
      expect(legend).toContain('x=accent');
      expect(legend).toContain('o=hit');
      expect(legend).toContain('g=ghost');
      expect(legend).toContain('H=loud');
      expect(legend).toContain('O=open');
      expect(legend).toContain('.=rest');
      expect(legend).toContain('|=bar');
    });
  });
});
