import { describe, expect, it } from 'vitest';
import { createSession, addTrack, addSend } from '../../src/engine/session';
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

  it('primes note events with sequence automation values at fractional positions', () => {
    const session = createSession();
    const track = session.tracks[0];
    const spec = buildRenderSpec({
      ...session,
      transport: { ...session.transport, mode: 'song' },
      tracks: [
        {
          ...track,
          patterns: [{
            id: 'pat-a',
            kind: 'pattern' as const,
            duration: 8,
            events: [
              { kind: 'note' as const, at: 4.5, pitch: 60, velocity: 0.8, duration: 1 },
            ],
          }],
          sequence: [{
            patternId: 'pat-a',
            automation: [{
              controlId: 'timbre',
              points: [
                { at: 0, value: 0.2, interpolation: 'linear' as const },
                { at: 8, value: 0.6 },
              ],
            }],
          }],
        },
        ...session.tracks.slice(1),
      ],
    }, [track.id], 1);

    const eventsAtNoteTime = spec.tracks[0].events.filter(event => Math.abs(event.beatTime - 4.5) < 0.0001);
    const automationPatch = eventsAtNoteTime.find(event =>
      event.type === 'set-patch'
      && event.patch?.timbre !== undefined
      && event.patch?.harmonics !== undefined
      && event.patch?.morph !== undefined
    );
    expect(automationPatch).toBeDefined();
    expect(automationPatch).toMatchObject({
      beatTime: 4.5,
      type: 'set-patch',
      patch: { harmonics: 0.5, morph: 0.5 },
    });
    expect(automationPatch?.patch?.timbre).toBeCloseTo(0.425, 5);
    expect(eventsAtNoteTime.some(event => event.type === 'trigger')).toBe(true);
  });

  it('applies sequence automation in pattern mode', () => {
    const session = createSession();
    const track = session.tracks[0];
    const patternId = track.patterns[0].id;
    const spec = buildRenderSpec({
      ...session,
      transport: { ...session.transport, mode: 'pattern' },
      tracks: [
        {
          ...track,
          patterns: [{
            id: patternId,
            kind: 'pattern' as const,
            duration: 16,
            events: [
              { kind: 'trigger' as const, at: 0, velocity: 0.8 },
            ],
          }],
          sequence: [{
            patternId,
            automation: [{
              controlId: 'timbre',
              points: [{ at: 0, value: 0.9 }],
            }],
          }],
        },
        ...session.tracks.slice(1),
      ],
    }, [track.id], 1);

    // The set-patch at beat 0 should have timbre=0.9 from sequence automation
    const patchEvents = spec.tracks[0].events.filter(e => e.type === 'set-patch' && Math.abs(e.beatTime) < 0.001);
    expect(patchEvents.length).toBeGreaterThanOrEqual(1);
    expect(patchEvents[0].patch?.timbre).toBeCloseTo(0.9, 2);
  });

  it('emits automation events in pattern mode for automation-only patterns', () => {
    const session = createSession();
    const track = session.tracks[0];
    const patternId = track.patterns[0].id;
    const spec = buildRenderSpec({
      ...session,
      transport: { ...session.transport, mode: 'pattern' },
      tracks: [
        {
          ...track,
          patterns: [{
            id: patternId,
            kind: 'pattern' as const,
            duration: 16,
            events: [],
          }],
          sequence: [{
            patternId,
            automation: [{
              controlId: 'timbre',
              points: [{ at: 0, value: 0.7 }],
            }],
          }],
        },
        ...session.tracks.slice(1),
      ],
    }, [track.id], 1);

    // Should have automation parameter events even with no musical events
    const paramEvents = spec.tracks[0].events.filter(e => e.type === 'set-patch');
    expect(paramEvents.length).toBeGreaterThanOrEqual(1);
    expect(paramEvents[0].patch?.timbre).toBeCloseTo(0.7, 2);
  });

  it('rejects offline render when selected tracks rely on non-master return buses (#1132)', () => {
    let session = createSession();
    session = addTrack(session, 'bus')!;
    const returnBus = session.tracks.find(track => track.kind === 'bus' && track.id !== 'master-bus')!;
    session = addSend(session, session.tracks[0].id, returnBus.id, 0.5)!;

    expect(() => buildRenderSpec(session, undefined, 2)).toThrow(
      `Offline render does not support send-return bus routing yet: track "${session.tracks[0].id}" sends to bus "${returnBus.id}".`,
    );
  });

  it('still allows offline render for selected tracks that do not use return buses', () => {
    let session = createSession();
    session = addTrack(session)!;
    session = addTrack(session, 'bus')!;
    const audioTracks = session.tracks.filter(track => track.kind !== 'bus');
    const returnBus = session.tracks.find(track => track.kind === 'bus' && track.id !== 'master-bus')!;
    session = addSend(session, audioTracks[0].id, returnBus.id, 0.5)!;

    const spec = buildRenderSpec(session, [audioTracks[1].id], 2);

    expect(spec.tracks).toHaveLength(1);
    expect(spec.tracks[0].id).toBe(audioTracks[1].id);
  });
});
