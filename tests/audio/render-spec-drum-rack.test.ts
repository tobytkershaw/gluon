// tests/audio/render-spec-drum-rack.test.ts
//
// Tests that drum-rack tracks are correctly handled by the render spec builder:
// per-pad source descriptors, padId preservation on events, and choke group info.

import { describe, it, expect } from 'vitest';
import { createSession } from '../../src/engine/session';
import { buildRenderSpec } from '../../src/audio/render-spec';
import type { Track } from '../../src/engine/types';
import type { DrumRackConfig, DrumPad } from '../../src/engine/types';

function makeDrumPad(overrides: Partial<DrumPad> & { id: string; name: string }): DrumPad {
  return {
    level: 0.8,
    pan: 0.5,
    source: {
      engine: 'plaits',
      model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
    },
    ...overrides,
  };
}

function makeDrumRackTrack(session: ReturnType<typeof createSession>): {
  session: ReturnType<typeof createSession>;
  trackId: string;
} {
  const baseTrack = session.tracks[0];
  const pads: DrumPad[] = [
    makeDrumPad({
      id: 'kick',
      name: 'Kick',
      source: { engine: 'plaits', model: 0, params: { harmonics: 0.3, timbre: 0.2, morph: 0.1, note: 0.3 } },
      level: 0.9,
      pan: 0.5,
    }),
    makeDrumPad({
      id: 'snare',
      name: 'Snare',
      source: { engine: 'plaits', model: 5, params: { harmonics: 0.6, timbre: 0.7, morph: 0.4, note: 0.5 } },
      level: 0.8,
      pan: 0.5,
      chokeGroup: 1,
    }),
    makeDrumPad({
      id: 'hat',
      name: 'Hi-Hat',
      source: { engine: 'plaits', model: 7, params: { harmonics: 0.9, timbre: 0.8, morph: 0.6, note: 0.7 } },
      level: 0.7,
      pan: 0.6,
      chokeGroup: 1,
    }),
  ];

  const drumRack: DrumRackConfig = { pads };

  const drumTrack: Track = {
    ...baseTrack,
    engine: 'drum-rack',
    drumRack,
    patterns: [{
      id: 'pat-1',
      kind: 'pattern' as const,
      duration: 16,
      events: [
        { kind: 'trigger' as const, at: 0, velocity: 0.9, padId: 'kick' },
        { kind: 'trigger' as const, at: 4, velocity: 0.8, padId: 'snare' },
        { kind: 'trigger' as const, at: 8, velocity: 0.7, padId: 'kick' },
        { kind: 'trigger' as const, at: 10, velocity: 0.6, padId: 'hat' },
        { kind: 'trigger' as const, at: 12, velocity: 0.85, padId: 'snare' },
      ],
    }],
  };

  const updatedSession = {
    ...session,
    tracks: [drumTrack, ...session.tracks.slice(1)],
  };

  return { session: updatedSession, trackId: baseTrack.id };
}

describe('buildRenderSpec — drum-rack tracks', () => {
  it('sets isDrumRack and populates pads array', () => {
    const session = createSession();
    const { session: drumSession, trackId } = makeDrumRackTrack(session);
    const spec = buildRenderSpec(drumSession, [trackId], 1);

    const trackSpec = spec.tracks[0];
    expect(trackSpec.isDrumRack).toBe(true);
    expect(trackSpec.pads).toHaveLength(3);
  });

  it('builds per-pad specs with correct model offsets and params', () => {
    const session = createSession();
    const { session: drumSession, trackId } = makeDrumRackTrack(session);
    const spec = buildRenderSpec(drumSession, [trackId], 1);

    const pads = spec.tracks[0].pads!;

    // Kick: model 0 + offset 8 = 8
    expect(pads[0].id).toBe('kick');
    expect(pads[0].model).toBe(8); // 0 + 8 offset
    expect(pads[0].params.harmonics).toBe(0.3);
    expect(pads[0].params.timbre).toBe(0.2);
    expect(pads[0].level).toBe(0.9);

    // Snare: model 5 + offset 8 = 13
    expect(pads[1].id).toBe('snare');
    expect(pads[1].model).toBe(13); // 5 + 8 offset
    expect(pads[1].params.harmonics).toBe(0.6);
    expect(pads[1].chokeGroup).toBe(1);

    // Hat: model 7 + offset 8 = 15
    expect(pads[2].id).toBe('hat');
    expect(pads[2].model).toBe(15);
    expect(pads[2].pan).toBe(0.6);
    expect(pads[2].chokeGroup).toBe(1);
  });

  it('preserves padId on trigger, gate-on, and gate-off render events', () => {
    const session = createSession();
    const { session: drumSession, trackId } = makeDrumRackTrack(session);
    const spec = buildRenderSpec(drumSession, [trackId], 1);

    const events = spec.tracks[0].events;

    // Find kick events at beat 0
    const kickTrigger = events.find(e => e.type === 'trigger' && e.beatTime === 0 && e.padId === 'kick');
    expect(kickTrigger).toBeDefined();
    expect(kickTrigger!.accentLevel).toBeCloseTo(0.9, 5);

    const kickGateOn = events.find(e => e.type === 'gate-on' && e.beatTime === 0 && e.padId === 'kick');
    expect(kickGateOn).toBeDefined();

    const kickGateOff = events.find(e => e.type === 'gate-off' && e.beatTime === 1 && e.padId === 'kick');
    expect(kickGateOff).toBeDefined();

    // Find snare events at beat 4
    const snareTrigger = events.find(e => e.type === 'trigger' && e.beatTime === 4 && e.padId === 'snare');
    expect(snareTrigger).toBeDefined();

    // Find hat events at beat 10
    const hatTrigger = events.find(e => e.type === 'trigger' && e.beatTime === 10 && e.padId === 'hat');
    expect(hatTrigger).toBeDefined();
  });

  it('does not set padId on non-drum-rack track events', () => {
    const session = createSession();
    const track = session.tracks[0];
    const spec = buildRenderSpec({
      ...session,
      tracks: [{
        ...track,
        patterns: [{
          id: 'r1',
          kind: 'pattern' as const,
          duration: 16,
          events: [
            { kind: 'trigger' as const, at: 0, velocity: 0.8 },
          ],
        }],
      }],
    }, [track.id], 1);

    const events = spec.tracks[0].events;
    expect(events.some(e => e.padId !== undefined)).toBe(false);
    expect(spec.tracks[0].isDrumRack).toBeUndefined();
    expect(spec.tracks[0].pads).toBeUndefined();
  });

  it('populates extended params per pad with defaults', () => {
    const session = createSession();
    const { session: drumSession, trackId } = makeDrumRackTrack(session);
    const spec = buildRenderSpec(drumSession, [trackId], 1);

    const pad = spec.tracks[0].pads![0]; // kick
    expect(pad.extendedParams).toEqual({
      fm_amount: 0.0,
      timbre_mod_amount: 0.0,
      morph_mod_amount: 0.0,
      decay: 0.5,
      lpg_colour: 0.5,
    });
  });

  it('populates extended params per pad with custom values', () => {
    const session = createSession();
    const baseTrack = session.tracks[0];
    const pad = makeDrumPad({
      id: 'kick',
      name: 'Kick',
      source: {
        engine: 'plaits',
        model: 0,
        params: {
          harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5,
          fm_amount: 0.3, decay: 0.8, lpg_colour: 0.2,
        },
      },
    });

    const drumTrack: Track = {
      ...baseTrack,
      engine: 'drum-rack',
      drumRack: { pads: [pad] },
      patterns: [{ id: 'p1', kind: 'pattern' as const, duration: 16, events: [] }],
    };

    const spec = buildRenderSpec(
      { ...session, tracks: [drumTrack] },
      [baseTrack.id],
      1,
    );

    expect(spec.tracks[0].pads![0].extendedParams.fm_amount).toBe(0.3);
    expect(spec.tracks[0].pads![0].extendedParams.decay).toBe(0.8);
    expect(spec.tracks[0].pads![0].extendedParams.lpg_colour).toBe(0.2);
  });

  it('handles drum-rack track with empty drumRack (no pads)', () => {
    const session = createSession();
    const baseTrack = session.tracks[0];
    const drumTrack: Track = {
      ...baseTrack,
      engine: 'drum-rack',
      drumRack: { pads: [] },
      patterns: [{ id: 'p1', kind: 'pattern' as const, duration: 16, events: [] }],
    };

    const spec = buildRenderSpec(
      { ...session, tracks: [drumTrack] },
      [baseTrack.id],
      1,
    );

    expect(spec.tracks[0].isDrumRack).toBe(true);
    expect(spec.tracks[0].pads).toEqual([]);
  });

  it('handles drum-rack in song mode with sequence', () => {
    const session = createSession();
    const baseTrack = session.tracks[0];
    const pads = [makeDrumPad({ id: 'kick', name: 'Kick' })];
    const drumTrack: Track = {
      ...baseTrack,
      engine: 'drum-rack',
      drumRack: { pads },
      patterns: [{
        id: 'pat-a',
        kind: 'pattern' as const,
        duration: 8,
        events: [
          { kind: 'trigger' as const, at: 0, velocity: 0.8, padId: 'kick' },
          { kind: 'trigger' as const, at: 4, velocity: 0.7, padId: 'kick' },
        ],
      }],
      sequence: [{ patternId: 'pat-a' }, { patternId: 'pat-a' }],
    };

    const spec = buildRenderSpec(
      { ...session, transport: { ...session.transport, mode: 'song' }, tracks: [drumTrack] },
      [baseTrack.id],
      2,
    );

    const events = spec.tracks[0].events;
    // First instance: kick at 0 and 4
    const kickTriggersFirst = events.filter(e => e.type === 'trigger' && e.padId === 'kick' && e.beatTime < 8);
    expect(kickTriggersFirst).toHaveLength(2);

    // Second instance: kick at 8 and 12
    const kickTriggersSecond = events.filter(e => e.type === 'trigger' && e.padId === 'kick' && e.beatTime >= 8);
    expect(kickTriggersSecond).toHaveLength(2);
    expect(kickTriggersSecond[0].beatTime).toBe(8);
    expect(kickTriggersSecond[1].beatTime).toBe(12);
  });
});
