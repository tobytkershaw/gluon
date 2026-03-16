import { describe, expect, it } from 'vitest';
import { createSession, addTrack } from '../../src/engine/session';
import { buildRenderSpec } from '../../src/audio/render-spec';

describe('buildRenderSpec', () => {
  it('respects solo state and includes master mix state', () => {
    let base = createSession();
    base = addTrack(base)!;
    const session = {
      ...base,
      master: { volume: 0.42, pan: -0.25 },
      tracks: base.tracks.map((track, index) => ({
        ...track,
        solo: index === 1,
      })),
    };

    const spec = buildRenderSpec(session, undefined, 2);

    expect(spec.tracks).toHaveLength(1);
    expect(spec.tracks[0].id).toBe(session.tracks[1].id);
    expect(spec.master).toEqual({ volume: 0.42, pan: -0.25 });
  });

  it('preserves micro-timing offsets in beatTime from fractional event.at', () => {
    const session = createSession();
    const track = session.tracks[0];
    const spec = buildRenderSpec({
      ...session,
      tracks: [
        {
          ...track,
          patterns: [{
            id: 'r1',
            kind: 'pattern' as const,
                        duration: 16,
                        events: [
              { kind: 'trigger' as const, at: 0, velocity: 0.8 },
              { kind: 'trigger' as const, at: 2.3, velocity: 0.8 },  // micro-timed: 0.3 steps late
              { kind: 'note' as const, at: 4.5, pitch: 60, velocity: 0.8, duration: 1 },
            ],
          }],
        },
        ...session.tracks.slice(1),
      ],
    }, [track.id], 1);

    const triggerEvents = spec.tracks[0].events.filter(e => e.type === 'trigger');
    // First trigger at beat 0
    expect(triggerEvents[0].beatTime).toBe(0);
    // Second trigger at beat 2.3 (micro-timed)
    expect(triggerEvents[1].beatTime).toBeCloseTo(2.3, 5);
    // Note trigger at beat 4.5 (micro-timed)
    expect(triggerEvents[2].beatTime).toBeCloseTo(4.5, 5);

    // Gate-on and gate-off should also preserve micro offset
    const gateOns = spec.tracks[0].events.filter(e => e.type === 'gate-on');
    expect(gateOns[1].beatTime).toBeCloseTo(2.3, 5);

    const gateOffs = spec.tracks[0].events.filter(e => e.type === 'gate-off');
    // Gate-off for the micro-timed trigger: 2.3 + default gate (1) = 3.3
    expect(gateOffs[1].beatTime).toBeCloseTo(3.3, 5);
    // Gate-off for the note: 4.5 + duration (1) = 5.5
    expect(gateOffs[2].beatTime).toBeCloseTo(5.5, 5);
  });

  it('includes supported tides modulators and routes with source target remapping', () => {
    const session = createSession();
    const track = session.tracks[0];
    const spec = buildRenderSpec({
      ...session,
      tracks: [
        {
          ...track,
          modulators: [
            {
              id: 'mod-1',
              type: 'tides',
              model: 1,
              params: { frequency: 0.6, shape: 0.2, slope: 0.8, smoothness: 0.4 },
            },
          ],
          processors: [
            {
              id: 'proc-1',
              type: 'rings',
              model: 0,
              params: { structure: 0.5, brightness: 0.5, damping: 0.6, position: 0.7 },
            },
          ],
          modulations: [
            {
              id: 'route-1',
              modulatorId: 'mod-1',
              target: { kind: 'source', param: 'timbre' },
              depth: 0.35,
            },
            {
              id: 'route-2',
              modulatorId: 'mod-1',
              target: { kind: 'processor', processorId: 'proc-1', param: 'brightness' },
              depth: -0.2,
            },
          ],
        },
        ...session.tracks.slice(1),
      ],
    }, [track.id], 2);

    expect(spec.tracks[0].modulators).toEqual([
      {
        id: 'mod-1',
        type: 'tides',
        model: 1,
        params: { frequency: 0.6, shape: 0.2, slope: 0.8, smoothness: 0.4 },
        extendedParams: { shift: 0.0, output_mode: 1, range: 0 },
      },
    ]);
    expect(spec.tracks[0].modulations).toEqual([
      {
        id: 'route-1',
        modulatorId: 'mod-1',
        target: { kind: 'source', param: 'timbre' },
        depth: 0.35,
      },
      {
        id: 'route-2',
        modulatorId: 'mod-1',
        target: { kind: 'processor', processorId: 'proc-1', param: 'brightness' },
        depth: -0.2,
      },
    ]);
  });
});
