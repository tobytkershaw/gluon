import { describe, expect, it } from 'vitest';
import { createSession } from '../../src/engine/session';
import { buildRenderSpec } from '../../src/audio/render-spec';

describe('buildRenderSpec', () => {
  it('respects solo state and includes master mix state', () => {
    const session = {
      ...createSession(),
      master: { volume: 0.42, pan: -0.25 },
      tracks: createSession().tracks.map((track, index) => ({
        ...track,
        solo: index === 1,
      })),
    };

    const spec = buildRenderSpec(session, undefined, 2);

    expect(spec.tracks).toHaveLength(1);
    expect(spec.tracks[0].id).toBe(session.tracks[1].id);
    expect(spec.master).toEqual({ volume: 0.42, pan: -0.25 });
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
