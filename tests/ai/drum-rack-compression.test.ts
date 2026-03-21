// tests/ai/drum-rack-compression.test.ts
import { describe, it, expect } from 'vitest';
import { compressState } from '../../src/ai/state-compression';
import { createSession } from '../../src/engine/session';
import { updateTrack, getActivePattern } from '../../src/engine/types';
import type { Session, Track, DrumPad, DrumRackConfig } from '../../src/engine/types';
import type { TriggerEvent, MusicalEvent } from '../../src/engine/canonical-types';
import { kitToEvents, eventsToKit, gridToEvents, formatLegend } from '../../src/engine/drum-grid';

// --- Helpers ---

/** Create a drum pad with reasonable defaults. */
function makePad(id: string, name: string, model: number, opts?: Partial<DrumPad>): DrumPad {
  return {
    id,
    name,
    source: { engine: 'plaits', model, params: {} },
    level: opts?.level ?? 0.8,
    pan: opts?.pan ?? 0.0,
    ...(opts?.chokeGroup != null ? { chokeGroup: opts.chokeGroup } : {}),
  };
}

/** Create a session with a drum rack track and given events. */
function createDrumRackSession(
  pads: DrumPad[],
  events: MusicalEvent[],
  patternLength = 32,
): Session {
  let session = createSession();
  const trackId = session.tracks[0].id;

  // Configure as drum rack
  const drumRack: DrumRackConfig = { pads };
  session = updateTrack(session, trackId, {
    engine: 'drum-rack',
    model: 0,
    drumRack,
    name: 'Drums',
  });

  // Set pattern events and length
  const track = session.tracks.find(t => t.id === trackId)!;
  track.patterns[0] = {
    ...track.patterns[0],
    duration: patternLength,
    events,
  };

  return session;
}

// --- Tests ---

describe('Drum Rack State Compression', () => {
  describe('pad metadata (4b)', () => {
    it('compresses pad metadata with model name, level, pan, and choke group', () => {
      const pads = [
        makePad('kick', 'Kick', 13, { level: 0.8, pan: 0.0 }),
        makePad('snare', 'Snare', 14, { level: 0.75, pan: 0.0 }),
        makePad('hat', 'Hat', 15, { level: 0.6, pan: -0.2, chokeGroup: 1 }),
        makePad('open-hat', 'Open Hat', 15, { level: 0.5, pan: -0.2, chokeGroup: 1 }),
      ];

      const session = createDrumRackSession(pads, []);
      const result = compressState(session);
      const drumTrack = result.tracks[0];

      expect(drumTrack.model).toBe('drum-rack');
      expect(drumTrack.pads).toBeDefined();
      expect(drumTrack.pads).toHaveLength(4);

      // Check kick pad
      expect(drumTrack.pads![0]).toEqual({
        id: 'kick',
        model: 'analog_bass_drum',
        level: 0.8,
        pan: 'C',
      });

      // Check snare pad — model name comes from Plaits label "Analog Snare Drum"
      expect(drumTrack.pads![1]).toEqual({
        id: 'snare',
        model: 'analog_snare_drum',
        level: 0.75,
        pan: 'C',
      });

      // Check hat with choke group — model name preserves hyphens ("Analog Hi-Hat" → "analog_hi-hat")
      expect(drumTrack.pads![2]).toEqual({
        id: 'hat',
        model: 'analog_hi-hat',
        level: 0.6,
        pan: 'L20',
        chokeGroup: 1,
      });

      // Check open-hat with choke group
      expect(drumTrack.pads![3]).toEqual({
        id: 'open-hat',
        model: 'analog_hi-hat',
        level: 0.5,
        pan: 'L20',
        chokeGroup: 1,
      });
    });

    it('does not include params for drum rack tracks', () => {
      const pads = [makePad('kick', 'Kick', 13)];
      const session = createDrumRackSession(pads, []);
      const result = compressState(session);
      const drumTrack = result.tracks[0];

      // Drum rack tracks should not have source params
      expect(drumTrack.params).toBeUndefined();
    });

    it('formats pan correctly for left, right, and center', () => {
      const pads = [
        makePad('left', 'Left', 13, { pan: -1.0 }),
        makePad('center', 'Center', 13, { pan: 0.0 }),
        makePad('right', 'Right', 13, { pan: 1.0 }),
        makePad('slight-left', 'Slight Left', 13, { pan: -0.3 }),
      ];

      const session = createDrumRackSession(pads, []);
      const result = compressState(session);
      const drumTrack = result.tracks[0];

      expect(drumTrack.pads![0].pan).toBe('L100');
      expect(drumTrack.pads![1].pan).toBe('C');
      expect(drumTrack.pads![2].pan).toBe('R100');
      expect(drumTrack.pads![3].pan).toBe('L30');
    });
  });

  describe('grid lane compression (4a)', () => {
    it('compresses events into per-pad grid strings', () => {
      const pads = [
        makePad('kick', 'Kick', 13),
        makePad('snare', 'Snare', 14),
      ];

      const events: TriggerEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.95, padId: 'kick' },
        { kind: 'trigger', at: 4, velocity: 0.75, padId: 'snare' },
        { kind: 'trigger', at: 8, velocity: 0.75, padId: 'kick' },
        { kind: 'trigger', at: 12, velocity: 0.75, padId: 'snare' },
      ];

      const session = createDrumRackSession(pads, events, 16);
      const result = compressState(session);
      const pattern = result.tracks[0].pattern as { lanes: Record<string, string> };

      expect(pattern.lanes).toBeDefined();
      // 16-step pattern, single bar = no bar lines
      expect(pattern.lanes.kick).toBe('x.......o.......');  // hit at 0 (accent), hit at 8 (normal)
      expect(pattern.lanes.snare).toBe('....o.......o...');  // hit at 4, hit at 12
    });

    it('includes bar lines for multi-bar patterns', () => {
      const pads = [makePad('kick', 'Kick', 13)];
      const events: TriggerEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.95, padId: 'kick' },
        { kind: 'trigger', at: 16, velocity: 0.75, padId: 'kick' },
      ];

      const session = createDrumRackSession(pads, events, 32);
      const result = compressState(session);
      const pattern = result.tracks[0].pattern as { lanes: Record<string, string> };

      expect(pattern.lanes.kick).toBe('x...............|o...............');
    });

    it('handles empty pattern', () => {
      const pads = [makePad('kick', 'Kick', 13)];
      const session = createDrumRackSession(pads, [], 16);
      const result = compressState(session);
      const pattern = result.tracks[0].pattern as { lanes: Record<string, string>; event_count: number };

      expect(pattern.lanes.kick).toBe('................');
      expect(pattern.event_count).toBe(0);
      expect(pattern.density).toBe(0);
    });

    it('computes density correctly', () => {
      const pads = [makePad('kick', 'Kick', 13)];
      const events: TriggerEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.95, padId: 'kick' },
        { kind: 'trigger', at: 4, velocity: 0.75, padId: 'kick' },
        { kind: 'trigger', at: 8, velocity: 0.75, padId: 'kick' },
        { kind: 'trigger', at: 12, velocity: 0.75, padId: 'kick' },
      ];

      const session = createDrumRackSession(pads, events, 16);
      const result = compressState(session);
      const pattern = result.tracks[0].pattern as { density: number };

      expect(pattern.density).toBe(0.25); // 4 events / 16 steps
    });
  });

  describe('legend and detail map (4c)', () => {
    it('includes legend in compressed output', () => {
      const pads = [makePad('kick', 'Kick', 13)];
      const session = createDrumRackSession(pads, [], 16);
      const result = compressState(session);
      const pattern = result.tracks[0].pattern as { legend: string };

      expect(pattern.legend).toBe(formatLegend());
      expect(pattern.legend).toContain('x=accent');
      expect(pattern.legend).toContain('.=rest');
      expect(pattern.legend).toContain('|=bar');
    });

    it('includes detail map for events with micro-timing offsets', () => {
      const pads = [makePad('hat', 'Hat', 15)];
      const events: TriggerEvent[] = [
        { kind: 'trigger', at: 2.05, velocity: 0.50, padId: 'hat' },  // soft hit with offset
        { kind: 'trigger', at: 6, velocity: 0.50, padId: 'hat' },     // soft hit, no offset
      ];

      const session = createDrumRackSession(pads, events, 16);
      const result = compressState(session);
      const pattern = result.tracks[0].pattern as { detail?: Record<string, Record<string, number>> };

      expect(pattern.detail).toBeDefined();
      // Step 2 = bar 1, beat 1, sixteenth 3 (1-based: 1.1.3)
      expect(pattern.detail!['hat@1.1.3']).toBeDefined();
      expect(pattern.detail!['hat@1.1.3'].offset).toBe(0.05);
    });

    it('omits detail map when no events need it', () => {
      const pads = [makePad('kick', 'Kick', 13)];
      const events: TriggerEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.95, padId: 'kick' },  // accent, default vel for 'x'
        { kind: 'trigger', at: 4, velocity: 0.75, padId: 'kick' },  // normal, default vel for 'o'
      ];

      const session = createDrumRackSession(pads, events, 16);
      const result = compressState(session);
      const pattern = result.tracks[0].pattern as { detail?: unknown };

      expect(pattern.detail).toBeUndefined();
    });

    it('includes detail entries for velocity deviations', () => {
      const pads = [makePad('kick', 'Kick', 13)];
      const events: TriggerEvent[] = [
        // This velocity (0.72) maps to 'o' (threshold 0.60), but default 'o' vel is 0.75
        // Deviation = 0.03 which is < 0.05, so no detail entry
        { kind: 'trigger', at: 0, velocity: 0.72, padId: 'kick' },
        // This velocity (0.65) maps to 'o' (threshold 0.60), deviation from 0.75 = 0.10 > 0.05
        { kind: 'trigger', at: 4, velocity: 0.65, padId: 'kick' },
      ];

      const session = createDrumRackSession(pads, events, 16);
      const result = compressState(session);
      const pattern = result.tracks[0].pattern as { detail?: Record<string, Record<string, number>> };

      // Step 4 = bar 1, beat 2, sixteenth 1 → "kick@1.2.1"
      expect(pattern.detail).toBeDefined();
      expect(pattern.detail!['kick@1.2.1']).toBeDefined();
      expect(pattern.detail!['kick@1.2.1'].vel).toBe(0.65);
    });
  });

  describe('round-trip: compress → parse → events match (4f)', () => {
    it('round-trips a basic 4-pad kit', () => {
      const pads = [
        makePad('kick', 'Kick', 13),
        makePad('snare', 'Snare', 14),
        makePad('hat', 'Hat', 15),
        makePad('open-hat', 'Open Hat', 15),
      ];

      const originalEvents: TriggerEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.95, padId: 'kick' },
        { kind: 'trigger', at: 4, velocity: 0.75, padId: 'snare' },
        { kind: 'trigger', at: 8, velocity: 0.95, padId: 'kick' },
        { kind: 'trigger', at: 12, velocity: 0.75, padId: 'snare' },
        { kind: 'trigger', at: 0, velocity: 0.50, padId: 'hat' },
        { kind: 'trigger', at: 2, velocity: 0.88, padId: 'hat' },
        { kind: 'trigger', at: 4, velocity: 0.50, padId: 'hat' },
        { kind: 'trigger', at: 6, velocity: 0.88, padId: 'hat' },
        { kind: 'trigger', at: 14, velocity: 0.80, padId: 'open-hat' },
      ];

      const session = createDrumRackSession(pads, originalEvents, 16);
      const result = compressState(session);
      const pattern = result.tracks[0].pattern as { lanes: Record<string, string> };

      // Parse grid strings back to events
      const roundTrippedEvents = kitToEvents(pattern.lanes);

      // Verify the same number of events round-trip
      expect(roundTrippedEvents).toHaveLength(originalEvents.length);

      // Verify each original event has a matching round-tripped event at the same position and pad
      for (const original of originalEvents) {
        const matching = roundTrippedEvents.find(
          e => e.at === Math.floor(original.at) && e.padId === original.padId
        );
        expect(matching).toBeDefined();
        expect(matching!.padId).toBe(original.padId);
      }
    });

    it('round-trips a 2-bar pattern preserving positions across bars', () => {
      const pads = [makePad('kick', 'Kick', 13)];
      const originalEvents: TriggerEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.95, padId: 'kick' },
        { kind: 'trigger', at: 8, velocity: 0.75, padId: 'kick' },
        { kind: 'trigger', at: 16, velocity: 0.95, padId: 'kick' },
        { kind: 'trigger', at: 24, velocity: 0.75, padId: 'kick' },
      ];

      const session = createDrumRackSession(pads, originalEvents, 32);
      const result = compressState(session);
      const pattern = result.tracks[0].pattern as { lanes: Record<string, string> };

      const roundTrippedEvents = kitToEvents(pattern.lanes);
      expect(roundTrippedEvents).toHaveLength(4);
      expect(roundTrippedEvents.map(e => e.at)).toEqual([0, 8, 16, 24]);
    });

    it('preserves velocity categories through round-trip', () => {
      const pads = [makePad('perc', 'Perc', 13)];
      const originalEvents: TriggerEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.95, padId: 'perc' },  // x (accent)
        { kind: 'trigger', at: 1, velocity: 0.88, padId: 'perc' },  // H (loud)
        { kind: 'trigger', at: 2, velocity: 0.80, padId: 'perc' },  // O (open)
        { kind: 'trigger', at: 3, velocity: 0.75, padId: 'perc' },  // o (hit)
        { kind: 'trigger', at: 4, velocity: 0.50, padId: 'perc' },  // h (soft)
        { kind: 'trigger', at: 5, velocity: 0.30, padId: 'perc' },  // g (ghost)
      ];

      const session = createDrumRackSession(pads, originalEvents, 16);
      const result = compressState(session);
      const pattern = result.tracks[0].pattern as { lanes: Record<string, string> };

      // Verify grid characters
      const gridChars = pattern.lanes.perc.replace(/\|/g, '');
      expect(gridChars[0]).toBe('x');  // accent
      expect(gridChars[1]).toBe('H');  // loud
      expect(gridChars[2]).toBe('O');  // open
      expect(gridChars[3]).toBe('o');  // hit
      expect(gridChars[4]).toBe('h');  // soft
      expect(gridChars[5]).toBe('g');  // ghost

      // Round-trip
      const roundTrippedEvents = kitToEvents(pattern.lanes);
      expect(roundTrippedEvents).toHaveLength(6);

      // Verify positions match
      for (let i = 0; i < originalEvents.length; i++) {
        expect(roundTrippedEvents[i].at).toBe(originalEvents[i].at);
      }
    });

    it('round-trips empty pads (no events for a pad)', () => {
      const pads = [
        makePad('kick', 'Kick', 13),
        makePad('snare', 'Snare', 14),
      ];
      const events: TriggerEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.95, padId: 'kick' },
      ];

      const session = createDrumRackSession(pads, events, 16);
      const result = compressState(session);
      const pattern = result.tracks[0].pattern as { lanes: Record<string, string> };

      // Snare lane should be all rests
      expect(pattern.lanes.snare).toBe('................');

      // Round-trip should only produce kick events
      const roundTrippedEvents = kitToEvents(pattern.lanes);
      expect(roundTrippedEvents).toHaveLength(1);
      expect(roundTrippedEvents[0].padId).toBe('kick');
    });
  });

  describe('non-drum-rack tracks unaffected', () => {
    it('regular tracks still use standard compression format', () => {
      const session = createSession();
      const result = compressState(session);
      const track = result.tracks[0];

      // Standard tracks have params, not pads
      expect(track.params).toBeDefined();
      expect(track.pads).toBeUndefined();

      // Pattern should have standard format (not drum rack lanes)
      expect(track.pattern).toHaveProperty('event_count');
      expect(track.pattern).toHaveProperty('density');
      expect(track.pattern).not.toHaveProperty('lanes');
    });
  });

  describe('pattern metadata', () => {
    it('includes bars, steps, and length in drum rack pattern', () => {
      const pads = [makePad('kick', 'Kick', 13)];
      const session = createDrumRackSession(pads, [], 32);
      const result = compressState(session);
      const pattern = result.tracks[0].pattern as { length: number; bars: number; steps: number };

      expect(pattern.length).toBe(32);
      expect(pattern.bars).toBe(2);
      expect(pattern.steps).toBe(32);
    });
  });
});
