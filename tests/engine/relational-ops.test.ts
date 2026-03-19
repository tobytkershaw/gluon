import { describe, it, expect } from 'vitest';
import { resolveRhythmicRelation, planContrastDirection, inferSpectralComplementBands } from '../../src/engine/relational-ops';
import { createSession, addTrack } from '../../src/engine/session';
import { getActivePattern } from '../../src/engine/types';

describe('relational-ops', () => {
  it('align maps target events onto source onsets', () => {
    let session = createSession();
    session = addTrack(session, 'audio') ?? session;
    const source = session.tracks[0];
    const target = session.tracks[1];
    source.patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 1 },
      { kind: 'trigger', at: 4, velocity: 1 },
      { kind: 'trigger', at: 8, velocity: 1 },
    ];
    target.patterns[0].events = [
      { kind: 'note', at: 1, pitch: 36, velocity: 0.8, duration: 1 },
      { kind: 'note', at: 5, pitch: 38, velocity: 0.7, duration: 1 },
    ];

    const result = resolveRhythmicRelation(getActivePattern(source), getActivePattern(target), 'align');
    expect(result.targetOnsets).toEqual([0, 4, 8]);
    const noteEvents = result.events.filter(event => event.kind === 'note');
    expect(noteEvents.map(event => event.at)).toEqual([0, 4]);
  });

  it('complement places target events between source onsets', () => {
    let session = createSession();
    session = addTrack(session, 'audio') ?? session;
    const source = session.tracks[0];
    const target = session.tracks[1];
    source.patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 1 },
      { kind: 'trigger', at: 4, velocity: 1 },
      { kind: 'trigger', at: 8, velocity: 1 },
      { kind: 'trigger', at: 12, velocity: 1 },
    ];
    target.patterns[0].events = [
      { kind: 'trigger', at: 1, velocity: 0.8 },
      { kind: 'trigger', at: 5, velocity: 0.7 },
    ];

    const result = resolveRhythmicRelation(getActivePattern(source), getActivePattern(target), 'complement');
    expect(result.targetOnsets).toEqual([2, 6, 10, 14]);
    const triggerEvents = result.events.filter(event => event.kind === 'trigger');
    expect(triggerEvents.map(event => event.at)).toEqual([2, 6]);
  });

  it('plans contrast direction from source and target values', () => {
    let session = createSession();
    session = addTrack(session, 'audio') ?? session;
    session.tracks[0].params.timbre = 0.8;
    session.tracks[1].params.timbre = 0.3;

    const result = planContrastDirection(session.tracks[0], session.tracks[1], 'increase_contrast', 'brightness');
    expect(result.direction).toBe('darker');
  });

  it('infers complementary target bands from source role', () => {
    let session = createSession();
    session = addTrack(session, 'audio') ?? session;
    session.tracks[0].musicalRole = 'sub bass';
    session.tracks[1].musicalRole = 'lead';

    const result = inferSpectralComplementBands(session.tracks[0], session.tracks[1]);
    expect(result.sourceBand).toBe('sub');
    expect(result.targetBands).toEqual(['high']);
  });
});
