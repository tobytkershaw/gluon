// tests/ai/state-compression.test.ts
import { describe, it, expect } from 'vitest';
import { compressState } from '../../src/ai/state-compression';
import { createSession, setApproval, setTrackImportance, addReaction, addDecision } from '../../src/engine/session';
import { toggleStepGate, toggleStepAccent, setStepParamLock } from '../../src/engine/pattern-primitives';
import type { Reaction, OpenDecision, PreservationReport, ApprovalLevel, Session } from '../../src/engine/types';
import { resolveTrackId, getTrackOrdinalLabel } from '../../src/engine/track-labels';
import { getTrackKind, updateTrack } from '../../src/engine/types';

/** Create a session with legacy engine assignments for tests that check engine-specific labels. */
function createLegacySession(): Session {
  let s = createSession();
  s = updateTrack(s, 'v0', { model: 13, engine: 'plaits:analog_bass_drum', name: undefined });
  s = updateTrack(s, 'v1', { model: 0, engine: 'plaits:virtual_analog', name: undefined });
  s = updateTrack(s, 'v2', { model: 2, engine: 'plaits:fm', name: undefined });
  s = updateTrack(s, 'v3', { model: 4, engine: 'plaits:harmonic', name: undefined });
  return s;
}

describe('State Compression (Phase 2)', () => {
  it('compresses multi-track session', () => {
    const session = createSession();
    const result = compressState(session);
    expect(result.tracks).toHaveLength(5); // 4 audio + 1 master bus
    // Default tracks are empty (no engine)
    expect(result.tracks[0].model).toBe('unknown_-1');
    expect(result.transport).toEqual({ bpm: 120, swing: 0, playing: false, time_signature: '4/4' });
    expect(result.activeTrackId).toBe(session.activeTrackId);
    // Master bus should be compressed with kind: 'bus'
    const masterTrack = result.tracks.find((t: Record<string, unknown>) => t.id === 'master-bus');
    expect(masterTrack).toBeDefined();
    expect(masterTrack!.kind).toBe('bus');
  });

  it('compresses pattern with note events (empty tracks are pitched by default)', () => {
    let s = createSession();
    const vid = s.tracks[0].id;
    s = toggleStepGate(s, vid, 0);
    s = toggleStepGate(s, vid, 4);
    s = toggleStepGate(s, vid, 8);
    s = toggleStepGate(s, vid, 12);

    const result = compressState(s);
    // Empty tracks (model -1) are treated as pitched, producing NoteEvents
    expect(result.tracks[0].pattern.notes).toHaveLength(4);
    expect(result.tracks[0].pattern.event_count).toBe(4);
    expect(result.tracks[0].pattern.triggers).toEqual([]);
    expect(result.tracks[0].pattern.density).toBeGreaterThan(0);
  });

  it('compresses accented steps', () => {
    let s = createSession();
    const vid = s.tracks[0].id;
    s = toggleStepGate(s, vid, 0);
    s = toggleStepAccent(s, vid, 0);

    const result = compressState(s);
    expect(result.tracks[0].pattern.accents).toEqual([0]);
  });

  it('compresses parameter locks with semantic names', () => {
    let s = createSession();
    const vid = s.tracks[0].id;
    s = setStepParamLock(s, vid, 5, { timbre: 0.8 });

    const result = compressState(s);
    expect(result.tracks[0].pattern.param_locks).toEqual([
      { at: 5, params: { timbre: 0.8 } },
    ]);
  });

  it('uses semantic param names for track params', () => {
    const session = createSession();
    const result = compressState(session);
    const paramKeys = Object.keys(result.tracks[0].params);
    expect(paramKeys).toEqual(['timbre', 'harmonics', 'morph', 'frequency']);
  });

  it('preserves structured recent human actions', () => {
    const session = createSession();
    const now = Date.now();
    session.recentHumanActions = [
      { trackId: 'v0', param: 'timbre', from: 0.3, to: 0.7, timestamp: now - 2000 },
      { trackId: 'v1', param: 'harmonics', from: 0.5, to: 0.1, timestamp: now - 500 },
    ];
    const result = compressState(session);
    expect(result.recent_human_actions).toHaveLength(2);
    expect(result.recent_human_actions[0].trackId).toBe('v0');
    expect(result.recent_human_actions[0].param).toBe('timbre');
    expect(result.recent_human_actions[0].from).toBe(0.3);
    expect(result.recent_human_actions[0].to).toBe(0.7);
    expect(result.recent_human_actions[0].age_ms).toBeGreaterThan(1500);
    expect(result.recent_human_actions[1].param).toBe('harmonics');
  });

  it('does not include human_message field', () => {
    const session = createSession();
    const result = compressState(session);
    expect(result).not.toHaveProperty('human_message');
  });

  it('empty region produces correct empty format', () => {
    const session = createSession();
    // Clear events from the first track's region
    const track = session.tracks[0];
    if (track.patterns[0]) {
      track.patterns[0].events = [];
    }
    const result = compressState(session);
    const pattern = result.tracks[0].pattern;
    expect(pattern.event_count).toBe(0);
    expect(pattern.triggers).toEqual([]);
    expect(pattern.notes).toEqual([]);
    expect(pattern.accents).toEqual([]);
    expect(pattern.param_locks).toEqual([]);
    expect(pattern.density).toBe(0);
  });

  it('includes observed_patterns and restraint_level fields', () => {
    const session = createSession();
    const result = compressState(session);
    expect(result.observed_patterns).toEqual([]);
    expect(result.restraint_level).toBe('moderate');
  });

  it('derives observed_patterns from reaction history', () => {
    const session = createSession();
    session.reactionHistory = [
      { actionGroupIndex: 0, verdict: 'rejected', timestamp: Date.now() },
      { actionGroupIndex: 1, verdict: 'rejected', timestamp: Date.now() },
      { actionGroupIndex: 2, verdict: 'rejected', timestamp: Date.now() },
      { actionGroupIndex: 3, verdict: 'rejected', timestamp: Date.now() },
    ];
    const result = compressState(session);
    expect(result.observed_patterns.length).toBeGreaterThan(0);
    expect(result.restraint_level).toBe('conservative');
  });

  it('derives adventurous restraint from mostly-approved reactions', () => {
    const session = createSession();
    session.reactionHistory = [
      { actionGroupIndex: 0, verdict: 'approved', timestamp: Date.now() },
      { actionGroupIndex: 1, verdict: 'approved', timestamp: Date.now() },
      { actionGroupIndex: 2, verdict: 'approved', timestamp: Date.now() },
      { actionGroupIndex: 3, verdict: 'neutral', timestamp: Date.now() },
    ];
    const result = compressState(session);
    expect(result.restraint_level).toBe('adventurous');
  });

  it('NoteEvent produces entry in notes array', () => {
    const session = createSession();
    const track = session.tracks[0];
    if (track.patterns[0]) {
      track.patterns[0].events = [
        { kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 1 },
        { kind: 'note', at: 2.5, pitch: 72, velocity: 0.99, duration: 0.5 },
      ];
    }
    const result = compressState(session);
    const pattern = result.tracks[0].pattern;
    expect(pattern.notes).toEqual([
      { at: 0, pitch: 60, vel: 0.8 },
      { at: 2.5, pitch: 72, vel: 0.99 },
    ]);
    expect(pattern.event_count).toBe(2);
    // High velocity note should appear in accents
    expect(pattern.accents).toEqual([2.5]);
  });

  it('events with fractional positions show in triggers and notes', () => {
    const session = createSession();
    const track = session.tracks[0];
    if (track.patterns[0]) {
      track.patterns[0].events = [
        { kind: 'trigger', at: 0.33, velocity: 0.7 },
        { kind: 'trigger', at: 1.67, velocity: 0.9 },
        { kind: 'note', at: 3.25, pitch: 48, velocity: 0.6, duration: 0.5 },
      ];
    }
    const result = compressState(session);
    const pattern = result.tracks[0].pattern;
    expect(pattern.triggers).toEqual([0.33, 1.67]);
    expect(pattern.notes).toEqual([{ at: 3.25, pitch: 48, vel: 0.6 }]);
  });
});

// ---------------------------------------------------------------------------
// M6 Compression Features
// ---------------------------------------------------------------------------

describe('Track approval in compressed output', () => {
  it('approval field appears on every compressed track', () => {
    const session = createSession();
    const result = compressState(session);
    for (const track of result.tracks) {
      expect(track).toHaveProperty('approval');
      expect(track.approval).toBe('exploratory'); // default
    }
  });

  it("non-default approval ('anchor') is correctly compressed", () => {
    let session = createSession();
    const trackId = session.tracks[0].id;
    session = setApproval(session, trackId, 'anchor');
    const result = compressState(session);
    expect(result.tracks[0].approval).toBe('anchor');
    // Other tracks remain at default
    expect(result.tracks[1].approval).toBe('exploratory');
  });
});

describe('Importance/musicalRole conditional inclusion', () => {
  it('importance is OMITTED when undefined on source track', () => {
    const session = createSession();
    const result = compressState(session);
    // importance should not be present as a key when undefined
    expect('importance' in result.tracks[0]).toBe(false);
  });

  it('importance appears when set (e.g., 0.7)', () => {
    let session = createSession();
    const trackId = session.tracks[0].id;
    session = setTrackImportance(session, trackId, 0.7);
    const result = compressState(session);
    expect(result.tracks[0].importance).toBe(0.7);
  });

  it('musicalRole is OMITTED when undefined', () => {
    const session = createSession();
    const result = compressState(session);
    expect('musicalRole' in result.tracks[0]).toBe(false);
  });

  it('musicalRole appears when set (e.g., "driving rhythm")', () => {
    let session = createSession();
    const trackId = session.tracks[0].id;
    session = setTrackImportance(session, trackId, 0.8, 'driving rhythm');
    const result = compressState(session);
    expect(result.tracks[0].musicalRole).toBe('driving rhythm');
  });
});

describe('Open decisions compression', () => {
  function makeDecision(id: string, opts?: Partial<OpenDecision>): OpenDecision {
    return {
      id,
      question: `Question for ${id}`,
      raisedAt: Date.now(),
      ...opts,
    };
  }

  it('only unresolved decisions appear', () => {
    let session = createSession();
    session = addDecision(session, makeDecision('d1'));
    session = addDecision(session, makeDecision('d2', { resolved: true }));
    session = addDecision(session, makeDecision('d3'));
    // Note: addDecision prunes resolved decisions, so d2 won't persist.
    // But let's also test with a manually set resolved decision to ensure
    // compressState itself filters.
    session = { ...session, openDecisions: [
      makeDecision('d1'),
      makeDecision('d2', { resolved: true }),
      makeDecision('d3'),
    ]};
    const result = compressState(session);
    expect(result.open_decisions.map(d => d.id)).toEqual(['d1', 'd3']);
  });

  it('max 5 decisions in output', () => {
    let session = createSession();
    for (let i = 0; i < 8; i++) {
      session = addDecision(session, makeDecision(`d${i}`));
    }
    const result = compressState(session);
    expect(result.open_decisions.length).toBeLessThanOrEqual(5);
  });

  it('decision fields: id, question, context truncated to 200, options, trackIds', () => {
    const longContext = 'a'.repeat(300);
    let session = createSession();
    session = addDecision(session, makeDecision('d1', {
      context: longContext,
      options: ['option A', 'option B'],
      trackIds: ['v0', 'v1'],
    }));
    const result = compressState(session);
    const d = result.open_decisions[0];
    expect(d.id).toBe('d1');
    expect(d.question).toBe('Question for d1');
    expect(d.context).toHaveLength(200);
    expect(d.options).toEqual(['option A', 'option B']);
    expect(d.trackIds).toEqual(['v0', 'v1']);
  });
});

describe('Recent reactions compression', () => {
  function makeReaction(index: number, verdict: 'approved' | 'rejected' | 'neutral' = 'approved', rationale?: string): Reaction {
    return { actionGroupIndex: index, verdict, timestamp: Date.now() - (20 - index) * 1000, rationale };
  }

  it('last 10 reactions are included (not all 50)', () => {
    let session = createSession();
    for (let i = 0; i < 30; i++) {
      session = addReaction(session, makeReaction(i));
    }
    const result = compressState(session);
    expect(result.recent_reactions).toHaveLength(10);
    // Should be the last 10, so starting from index 20
    expect(result.recent_reactions[0].actionGroupIndex).toBe(20);
    expect(result.recent_reactions[9].actionGroupIndex).toBe(29);
  });

  it('age_ms is computed correctly (positive number)', () => {
    const now = Date.now();
    let session = createSession();
    session = addReaction(session, { actionGroupIndex: 0, verdict: 'approved', timestamp: now - 5000 });
    const result = compressState(session);
    const age = result.recent_reactions[0].age_ms;
    // Should be approximately 5000ms, but allow some slack for execution time
    expect(age).toBeGreaterThanOrEqual(4900);
    expect(age).toBeLessThan(10000);
  });

  it('rationale is included when present, omitted when absent', () => {
    let session = createSession();
    session = addReaction(session, makeReaction(0, 'approved', 'Great groove'));
    session = addReaction(session, makeReaction(1, 'rejected'));
    const result = compressState(session);
    expect(result.recent_reactions[0].rationale).toBe('Great groove');
    expect('rationale' in result.recent_reactions[1]).toBe(false);
  });
});

describe('Recent preservation reports', () => {
  const sampleReport: PreservationReport = {
    trackId: 'v0',
    preserved: { rhythmPositions: true, eventCount: true, pitchContour: false },
    changed: ['2 velocity values modified'],
    approvalLevel: 'liked',
  };

  it('recent_preservation appears when reports provided', () => {
    const session = createSession();
    const result = compressState(session, [sampleReport]);
    expect(result.recent_preservation).toBeDefined();
    expect(result.recent_preservation).toHaveLength(1);
    expect(result.recent_preservation![0].trackId).toBe('v0');
    expect(result.recent_preservation![0].approval).toBe('liked');
    expect(result.recent_preservation![0].preserved).toEqual(['rhythm', 'event_count']);
    expect(result.recent_preservation![0].changed).toEqual(['2 velocity values modified']);
  });

  it('recent_preservation is omitted when no reports (undefined key, not empty array)', () => {
    const session = createSession();
    const result = compressState(session);
    expect('recent_preservation' in result).toBe(false);
  });

  it('recent_preservation is omitted when reports array is empty', () => {
    const session = createSession();
    const result = compressState(session, []);
    expect('recent_preservation' in result).toBe(false);
  });
});

describe('Time signature in compressed state', () => {
  it('includes time_signature in transport (default 4/4)', () => {
    const session = createSession();
    const result = compressState(session);
    expect(result.transport.time_signature).toBe('4/4');
  });

  it('reflects non-default time signature', () => {
    const session = createSession();
    session.transport.timeSignature = { numerator: 3, denominator: 4 };
    const result = compressState(session);
    expect(result.transport.time_signature).toBe('3/4');
  });

  it('handles 6/8 time signature', () => {
    const session = createSession();
    session.transport.timeSignature = { numerator: 6, denominator: 8 };
    const result = compressState(session);
    expect(result.transport.time_signature).toBe('6/8');
  });
});

// ---------------------------------------------------------------------------
// Ordinal track labels (#515)
// ---------------------------------------------------------------------------

describe('Ordinal track labels in compressed state', () => {
  it('audio tracks get 1-indexed ordinal labels', () => {
    const session = createLegacySession();
    const result = compressState(session);
    const audioTracks = result.tracks.filter(t => !('kind' in t && t.kind === 'bus'));
    expect(audioTracks[0].label).toBe('Track 1 (Kick)');
    expect(audioTracks[1].label).toBe('Track 2 (VA)');
    expect(audioTracks[2].label).toBe('Track 3 (FM)');
    expect(audioTracks[3].label).toBe('Track 4 (Harmonic)');
  });

  it('master bus gets "Master Bus" label', () => {
    const session = createSession();
    const result = compressState(session);
    const masterTrack = result.tracks.find(t => t.id === 'master-bus');
    expect(masterTrack!.label).toBe('Master Bus');
  });

  it('user-assigned name appears in ordinal label', () => {
    const session = createSession();
    session.tracks[0].name = 'My Kick';
    const result = compressState(session);
    expect(result.tracks[0].label).toBe('Track 1 (My Kick)');
  });
});

// ---------------------------------------------------------------------------
// resolveTrackId (#515)
// ---------------------------------------------------------------------------

describe('resolveTrackId', () => {
  it('resolves internal IDs directly', () => {
    const session = createSession();
    expect(resolveTrackId('v0', session)).toBe('v0');
    expect(resolveTrackId('v1', session)).toBe('v1');
    expect(resolveTrackId('master-bus', session)).toBe('master-bus');
  });

  it('resolves "Track 1" to first audio track', () => {
    const session = createSession();
    expect(resolveTrackId('Track 1', session)).toBe('v0');
    expect(resolveTrackId('Track 2', session)).toBe('v1');
    expect(resolveTrackId('Track 3', session)).toBe('v2');
    expect(resolveTrackId('Track 4', session)).toBe('v3');
  });

  it('resolves case-insensitive "track 1"', () => {
    const session = createSession();
    expect(resolveTrackId('track 1', session)).toBe('v0');
    expect(resolveTrackId('TRACK 2', session)).toBe('v1');
  });

  it('resolves bare ordinal "1"', () => {
    const session = createSession();
    expect(resolveTrackId('1', session)).toBe('v0');
    expect(resolveTrackId('4', session)).toBe('v3');
  });

  it('returns null for out-of-range ordinal', () => {
    const session = createSession();
    expect(resolveTrackId('Track 0', session)).toBeNull();
    expect(resolveTrackId('Track 99', session)).toBeNull();
    expect(resolveTrackId('0', session)).toBeNull();
  });

  it('returns null for unknown string', () => {
    const session = createSession();
    expect(resolveTrackId('nonexistent', session)).toBeNull();
  });

  it('resolves "Master Bus"', () => {
    const session = createSession();
    expect(resolveTrackId('Master Bus', session)).toBe('master-bus');
    expect(resolveTrackId('master bus', session)).toBe('master-bus');
    expect(resolveTrackId('master-bus', session)).toBe('master-bus');
  });

  it('ordinal numbering skips bus tracks', () => {
    const session = createSession();
    // Audio tracks are v0-v3, master-bus is not counted in ordinals
    const audioTracks = session.tracks.filter(t => getTrackKind(t) !== 'bus');
    expect(audioTracks).toHaveLength(4);
    // Track 1 should be the first audio track regardless of bus position
    expect(resolveTrackId('Track 1', session)).toBe(audioTracks[0].id);
    expect(resolveTrackId('Track 4', session)).toBe(audioTracks[3].id);
  });
});
