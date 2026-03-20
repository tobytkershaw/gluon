// tests/ai/state-compression.test.ts
import { describe, it, expect } from 'vitest';
import { compressState, stepToPosition, recogniseChord } from '../../src/ai/state-compression';
import { createSession, addTrack, setApproval, setTrackImportance, addReaction, addDecision } from '../../src/engine/session';
import { toggleStepGate, toggleStepAccent, setStepParamLock } from '../../src/engine/pattern-primitives';
import type { Reaction, OpenDecision, PreservationReport, ApprovalLevel, Session, UserSelection } from '../../src/engine/types';
import { resolveTrackId, getTrackOrdinalLabel } from '../../src/engine/track-labels';
import { getTrackKind, updateTrack } from '../../src/engine/types';

/** Create a session with legacy engine assignments for tests that check engine-specific labels. */
function createLegacySession(): Session {
  let s = createSession();
  // Default session now starts with 1 track; add 3 more for legacy tests
  s = addTrack(s)!;
  s = addTrack(s)!;
  s = addTrack(s)!;
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
    expect(result.tracks).toHaveLength(2); // 1 audio + 1 master bus
    // Default tracks are empty (no engine)
    expect(result.tracks[0].model).toBe('no_source');
    expect(result.transport).toEqual({ bpm: 120, swing: 0, playing: false, mode: 'pattern', loop: true, time_signature: '4/4' });
    expect(result.activeTrackId).toBe(session.activeTrackId);
    // Master bus should be compressed with kind: 'bus'
    const masterTrack = result.tracks.find((t: Record<string, unknown>) => t.id === 'master-bus');
    expect(masterTrack).toBeDefined();
    expect(masterTrack!.kind).toBe('bus');
  });

  it('includes sequence automation summaries in compressed track state', () => {
    const session = createSession();
    const track = session.tracks[0];
    track.patterns = [
      { ...track.patterns[0], id: 'pat-a', duration: 16, events: [] },
      { ...track.patterns[0], id: 'pat-b', duration: 16, events: [] },
    ];
    track.sequence = [
      { patternId: 'pat-a' },
      {
        patternId: 'pat-b',
        automation: [{ controlId: 'timbre', points: [{ at: 0, value: 0.4 }, { at: 16, value: 0.8 }] }],
      },
    ];

    const result = compressState(session);
    expect(result.tracks[0].sequence).toEqual([
      { index: 0, patternId: 'pat-a', length: 16 },
      {
        index: 1,
        patternId: 'pat-b',
        length: 16,
        automation: [{ controlId: 'timbre', point_count: 2, points: [{ at: 0, value: 0.4 }, { at: 16, value: 0.8 }] }],
      },
    ]);
  });

  it('caps long automation previews while keeping the full point count', () => {
    const session = createSession();
    const track = session.tracks[0];
    track.sequence = [{
      patternId: track.patterns[0].id,
      automation: [{
        controlId: 'timbre',
        points: Array.from({ length: 12 }, (_, index) => ({ at: index, value: index / 11 })),
      }],
    }];

    const result = compressState(session);
    const lane = result.tracks[0].sequence?.[0]?.automation?.[0];
    expect(lane?.point_count).toBe(12);
    expect(lane?.points).toHaveLength(8);
    expect(lane?.points[0]).toEqual({ at: 0, value: 0 });
    expect(lane?.points.at(-1)).toEqual({ at: 11, value: 1 });
  });

  it('compresses pattern with note events (empty tracks are pitched by default)', () => {
    let s = createSession();
    const vid = s.tracks[0].id;
    s = toggleStepGate(s, vid, 0);
    s = toggleStepGate(s, vid, 4);
    s = toggleStepGate(s, vid, 8);
    s = toggleStepGate(s, vid, 12);

    const result = compressState(s);
    const pattern = result.tracks[0].pattern;
    // Monophonic notes without triggers → detected as bass role
    expect(pattern.event_count).toBe(4);
    expect('role' in pattern && pattern.role).toBe('bass');
    expect('trackerRows' in pattern).toBe(true);
    expect(pattern.density).toBeGreaterThan(0);
  });

  it('compresses accented steps', () => {
    let s = createSession();
    const vid = s.tracks[0].id;
    s = toggleStepGate(s, vid, 0);
    s = toggleStepAccent(s, vid, 0);

    const result = compressState(s);
    const pattern = result.tracks[0].pattern;
    // Monophonic note → bass role, accent appears as ! suffix in trackerRows
    expect('role' in pattern && pattern.role).toBe('bass');
    expect('trackerRows' in pattern && (pattern as { trackerRows: string }).trackerRows).toMatch(/!/);
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
    const paramKeys = Object.keys(result.tracks[0].params!);
    expect(paramKeys).toEqual(['timbre', 'harmonics', 'morph', 'frequency']);
  });

  it('bus tracks do not have params key (#1102)', () => {
    const session = createSession();
    const result = compressState(session);
    const masterTrack = result.tracks.find(t => t.id === 'master-bus');
    expect(masterTrack).toBeDefined();
    expect('params' in masterTrack!).toBe(false);
  });

  it('sequence is omitted when empty (#1105)', () => {
    const session = createSession();
    // Clear the sequence on the first track
    session.tracks[0].sequence = [];
    const result = compressState(session);
    expect('sequence' in result.tracks[0]).toBe(false);
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
    expect('triggers' in pattern).toBe(false);
    expect('notes' in pattern).toBe(false);
    expect('accents' in pattern).toBe(false);
    expect('param_locks' in pattern).toBe(false);
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

  it('NoteEvent produces entry in bass trackerRows (monophonic)', () => {
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
    expect('role' in pattern && pattern.role).toBe('bass');
    expect(pattern.event_count).toBe(2);
    // trackerRows should contain both notes
    const rows = 'trackerRows' in pattern ? (pattern as { trackerRows: string }).trackerRows : '';
    expect(rows).toContain('C4@');
    expect(rows).toContain('C5@');
    // C5 has velocity 0.99 (≥0.95) → accent marker
    expect(rows).toMatch(/C5@.*!/);
    // C5 has duration 0.5 → should show duration
    expect(rows).toMatch(/C5@.*\(0\.5\)/);
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
    expect(pattern.triggers).toEqual([{ at: 0.33, vel: 0.7 }, { at: 1.67, vel: 0.9 }]);
    expect(pattern.notes).toEqual([{ at: 3.25, pitch: 'C3', vel: 0.6, dur: 0.5 }]);
  });

  it('includes live audio metrics when provided', () => {
    const session = createSession();
    const result = compressState(session, undefined, undefined, {
      capturedAt: 1234,
      master: { rms: -12.3, peak: -3.2, centroid: 2400, crest: 9.1, onsetDensity: 1.5 },
      tracks: {
        v0: { rms: -18.1, peak: -9.5, centroid: 180, crest: 8.6, onsetDensity: 4.2 },
      },
    });

    expect(result.audioMetrics).toEqual({
      master: { rms: -12.3, peak: -3.2, centroid: 2400, crest: 9.1, onsetDensity: 1.5 },
      tracks: {
        v0: { rms: -18.1, peak: -9.5, centroid: 180, crest: 8.6, onsetDensity: 4.2 },
      },
    });
  });

  it('includes mix warnings and recent auto diffs when provided', () => {
    const session = createSession();
    const result = compressState(
      session,
      undefined,
      undefined,
      undefined,
      [
        {
          type: 'clipping',
          severity: 1,
          trackId: 'master-bus',
          trackLabel: 'Master Bus',
          peak: -0.1,
          message: 'Master Bus is clipping at -0.1 dBFS.',
        },
      ],
      [
        {
          trackId: 'v0',
          summary: 'Brighter and louder.',
          confidence: 0.82,
        },
      ],
    );

    expect(result.mixWarnings).toEqual([
      {
        type: 'clipping',
        severity: 1,
        trackId: 'master-bus',
        trackLabel: 'Master Bus',
        peak: -0.1,
        message: 'Master Bus is clipping at -0.1 dBFS.',
      },
    ]);
    expect(result.recentAutoDiffs).toEqual([
      {
        trackId: 'v0',
        summary: 'Brighter and louder.',
        confidence: 0.82,
      },
    ]);
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
  /** Create a session with 4 audio tracks for ordinal resolution tests. */
  function createMultiTrackSession() {
    let s = createSession();
    s = addTrack(s)!;
    s = addTrack(s)!;
    s = addTrack(s)!;
    return s;
  }

  it('resolves internal IDs directly', () => {
    const session = createMultiTrackSession();
    expect(resolveTrackId('v0', session)).toBe('v0');
    expect(resolveTrackId('v1', session)).toBe('v1');
    expect(resolveTrackId('master-bus', session)).toBe('master-bus');
  });

  it('resolves "Track 1" to first audio track', () => {
    const session = createMultiTrackSession();
    expect(resolveTrackId('Track 1', session)).toBe('v0');
    expect(resolveTrackId('Track 2', session)).toBe('v1');
    expect(resolveTrackId('Track 3', session)).toBe('v2');
    expect(resolveTrackId('Track 4', session)).toBe('v3');
  });

  it('resolves case-insensitive "track 1"', () => {
    const session = createMultiTrackSession();
    expect(resolveTrackId('track 1', session)).toBe('v0');
    expect(resolveTrackId('TRACK 2', session)).toBe('v1');
  });

  it('resolves bare ordinal "1"', () => {
    const session = createMultiTrackSession();
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
    let session = createSession();
    // Default session now starts with 1 track; add more to test ordinals
    session = addTrack(session)!;
    session = addTrack(session)!;
    session = addTrack(session)!;
    // Audio tracks are v0-v3, master-bus is not counted in ordinals
    const audioTracks = session.tracks.filter(t => getTrackKind(t) !== 'bus');
    expect(audioTracks).toHaveLength(4);
    // Track 1 should be the first audio track regardless of bus position
    expect(resolveTrackId('Track 1', session)).toBe(audioTracks[0].id);
    expect(resolveTrackId('Track 4', session)).toBe(audioTracks[3].id);
  });

  // --- vN fallback (#939) ---

  it('falls back vN pattern to Nth audio track when ID does not exist', () => {
    // Simulate a session where track IDs are UUIDs, not v0/v1/v2
    let session = createSession();
    session = addTrack(session)!;
    session = addTrack(session)!;
    // Rename IDs to simulate non-sequential IDs (e.g. after delete+re-add)
    const audioTracks = session.tracks.filter(t => getTrackKind(t) !== 'bus');
    audioTracks[0].id = 'uuid-aaa';
    audioTracks[1].id = 'uuid-bbb';
    audioTracks[2].id = 'uuid-ccc';
    // "v0" doesn't exist, so fallback maps v0 → 1st audio track
    expect(resolveTrackId('v0', session)).toBe('uuid-aaa');
    expect(resolveTrackId('v1', session)).toBe('uuid-bbb');
    expect(resolveTrackId('v2', session)).toBe('uuid-ccc');
  });

  it('vN fallback returns null for out-of-range index', () => {
    let session = createSession();
    // Session has 1 audio track (v0). Rename it so v0 doesn't match directly.
    const audioTracks = session.tracks.filter(t => getTrackKind(t) !== 'bus');
    audioTracks[0].id = 'uuid-only';
    // v0 should resolve (index 0, 1 track exists)
    expect(resolveTrackId('v0', session)).toBe('uuid-only');
    // v1 should not resolve (only 1 audio track)
    expect(resolveTrackId('v1', session)).toBeNull();
  });

  it('prefers direct ID match over vN fallback', () => {
    // When "v1" IS a real track ID, it should resolve directly, not via fallback
    const session = createMultiTrackSession();
    expect(resolveTrackId('v1', session)).toBe('v1');
  });
});

// ---------------------------------------------------------------------------
// Processor/modulator default params in compressed state (#773)
// ---------------------------------------------------------------------------

describe('Processor default params in compressed state', () => {
  it('newly-added processor with empty params emits empty params (all at default)', () => {
    const session = createSession();
    const track = session.tracks[0];
    track.processors = [{
      id: 'clouds-123',
      type: 'clouds',
      model: 0,
      params: {},
    }];
    const result = compressState(session);
    const proc = result.tracks[0].processors[0];
    expect(proc.type).toBe('clouds');
    // All params are at default, so nothing should be emitted
    expect(Object.keys(proc.params).length).toBe(0);
  });

  it('only non-default param values are emitted', () => {
    const session = createSession();
    const track = session.tracks[0];
    track.processors = [{
      id: 'clouds-456',
      type: 'clouds',
      model: 0,
      params: { position: 0.9, size: 0.1 },
    }];
    const result = compressState(session);
    const proc = result.tracks[0].processors[0];
    expect(proc.params.position).toBe(0.9);
    expect(proc.params.size).toBe(0.1);
    // Default params should NOT be included
    expect(proc.params).not.toHaveProperty('dry-wet');
  });

  it('rings processor with empty params emits empty params', () => {
    const session = createSession();
    const track = session.tracks[0];
    track.processors = [{
      id: 'rings-789',
      type: 'rings',
      model: 0,
      params: {},
    }];
    const result = compressState(session);
    const proc = result.tracks[0].processors[0];
    expect(Object.keys(proc.params).length).toBe(0);
  });

  it('unknown processor type with empty params stays empty', () => {
    const session = createSession();
    const track = session.tracks[0];
    track.processors = [{
      id: 'unknown-1',
      type: 'nonexistent' as never,
      model: 0,
      params: {},
    }];
    const result = compressState(session);
    const proc = result.tracks[0].processors[0];
    expect(Object.keys(proc.params).length).toBe(0);
  });
});

describe('Modulator default params in compressed state', () => {
  it('newly-added modulator with empty params emits empty params (all at default)', () => {
    const session = createSession();
    const track = session.tracks[0];
    track.modulators = [{
      id: 'tides-123',
      type: 'tides',
      model: 1, // default Looping mode
      params: {},
    }];
    const result = compressState(session);
    const mod = result.tracks[0].modulators[0];
    expect(mod.type).toBe('tides');
    // All params are at default, so nothing should be emitted
    expect(Object.keys(mod.params).length).toBe(0);
  });

  it('only non-default modulator param values are emitted', () => {
    const session = createSession();
    const track = session.tracks[0];
    track.modulators = [{
      id: 'tides-456',
      type: 'tides',
      model: 1,
      params: { frequency: 0.7 },
    }];
    const result = compressState(session);
    const mod = result.tracks[0].modulators[0];
    expect(mod.params.frequency).toBe(0.7);
    // Default params should NOT be included
    expect(mod.params).not.toHaveProperty('shape');
  });
});

// ---------------------------------------------------------------------------
// User selection context (#778)
// ---------------------------------------------------------------------------

describe('User selection in compressed state', () => {
  it('userSelection is omitted when not provided', () => {
    const session = createSession();
    const result = compressState(session);
    expect('userSelection' in result).toBe(false);
  });

  it('userSelection is omitted when undefined', () => {
    const session = createSession();
    const result = compressState(session, undefined, undefined);
    expect('userSelection' in result).toBe(false);
  });

  it('userSelection is omitted when eventIndices is empty', () => {
    const session = createSession();
    const selection: UserSelection = {
      trackId: 'v0',
      stepRange: [0, 3],
      eventIndices: [],
    };
    const result = compressState(session, undefined, selection);
    expect('userSelection' in result).toBe(false);
  });

  it('userSelection appears when selection has events', () => {
    const session = createSession();
    const selection: UserSelection = {
      trackId: 'v0',
      stepRange: [4, 8],
      eventIndices: [2, 3, 4, 5],
    };
    const result = compressState(session, undefined, selection);
    expect(result.userSelection).toBeDefined();
    expect(result.userSelection!.trackId).toBe('v0');
    expect(result.userSelection!.stepRange).toEqual([4, 8]);
    expect(result.userSelection!.eventCount).toBe(4);
  });

  it('userSelection does not leak raw eventIndices (only eventCount)', () => {
    const session = createSession();
    const selection: UserSelection = {
      trackId: 'v0',
      stepRange: [0, 15],
      eventIndices: [0, 1, 2],
    };
    const result = compressState(session, undefined, selection);
    expect(result.userSelection).toBeDefined();
    // Should have eventCount, not eventIndices
    expect(result.userSelection).toHaveProperty('eventCount');
    expect(result.userSelection).not.toHaveProperty('eventIndices');
  });
});

// ---------------------------------------------------------------------------
// Role-aware compression (#1098)
// ---------------------------------------------------------------------------

describe('Role-aware compression: bass detection', () => {
  it('detects bass role for monophonic note pattern', () => {
    const session = createSession();
    const track = session.tracks[0];
    track.patterns[0].events = [
      { kind: 'note', at: 0, pitch: 41, velocity: 0.8, duration: 2 },
      { kind: 'note', at: 4, pitch: 44, velocity: 0.7, duration: 1.5 },
      { kind: 'note', at: 8, pitch: 39, velocity: 0.85, duration: 3 },
    ];
    const result = compressState(session);
    const pattern = result.tracks[0].pattern;
    expect('role' in pattern && pattern.role).toBe('bass');
    expect('trackerRows' in pattern).toBe(true);
    expect(pattern.event_count).toBe(3);
    expect(pattern.density).toBeGreaterThan(0);
  });

  it('bass trackerRows format: pitch, position, duration, velocity markers', () => {
    const session = createSession();
    const track = session.tracks[0];
    track.patterns[0].events = [
      { kind: 'note', at: 0, pitch: 41, velocity: 0.8, duration: 0.5 },   // F2, normal vel, dur 0.5
      { kind: 'note', at: 4, pitch: 44, velocity: 0.3, duration: 1 },     // G#2, low vel (outside 0.6-0.9)
      { kind: 'note', at: 8, pitch: 39, velocity: 0.97, duration: 2 },    // D#2, accent (>=0.95)
      { kind: 'note', at: 12, pitch: 48, velocity: 0.75, duration: 1 },   // C3, normal vel, dur=1 (omit)
    ];
    const result = compressState(session);
    const pattern = result.tracks[0].pattern as { trackerRows: string; role: string };
    expect(pattern.role).toBe('bass');
    const rows = pattern.trackerRows;

    // F2@1.1.1(0.5) — dur shown, vel normal → omitted
    expect(rows).toContain('F2@1.1.1(0.5)');
    // G#2@1.2.1 — dur=1 omitted, vel 0.3 outside range → v0.3
    expect(rows).toContain('G#2@1.2.1v0.3');
    // D#2@1.3.1(2) — dur shown, accent → !
    expect(rows).toContain('D#2@1.3.1(2)!');
    // C3@1.4.1 — dur=1 omitted, vel normal → nothing extra
    expect(rows).toMatch(/C3@1\.4\.1(?!\()/);
  });
});

describe('Role-aware compression: pad detection', () => {
  it('detects pad role for polyphonic long-duration pattern', () => {
    const session = createSession();
    const track = session.tracks[0];
    // Fm chord voicing — 5 notes at same position, long duration
    track.patterns[0].events = [
      { kind: 'note', at: 0, pitch: 41, velocity: 0.7, duration: 16 },  // F2
      { kind: 'note', at: 0, pitch: 44, velocity: 0.7, duration: 16 },  // G#2 = Ab2
      { kind: 'note', at: 0, pitch: 48, velocity: 0.7, duration: 16 },  // C3
      { kind: 'note', at: 0, pitch: 51, velocity: 0.7, duration: 16 },  // D#3 = Eb3
      { kind: 'note', at: 0, pitch: 55, velocity: 0.7, duration: 16 },  // G3
    ];
    const result = compressState(session);
    const pattern = result.tracks[0].pattern;
    expect('role' in pattern && pattern.role).toBe('pad');
    expect('chordBlocks' in pattern).toBe(true);
  });

  it('pad chord recognition: identifies Fm', () => {
    const session = createSession();
    const track = session.tracks[0];
    // F minor: F, Ab, C
    track.patterns[0].events = [
      { kind: 'note', at: 0, pitch: 41, velocity: 0.7, duration: 16 },  // F2
      { kind: 'note', at: 0, pitch: 44, velocity: 0.7, duration: 16 },  // G#2
      { kind: 'note', at: 0, pitch: 48, velocity: 0.7, duration: 16 },  // C3
    ];
    const result = compressState(session);
    const pattern = result.tracks[0].pattern as { chordBlocks: string; role: string };
    expect(pattern.role).toBe('pad');
    expect(pattern.chordBlocks).toContain('Fm');
  });

  it('pad chord recognition: identifies Cmaj7', () => {
    // C major 7: C, E, G, B
    expect(recogniseChord([48, 52, 55, 59])).toBe('Cmaj7');
  });

  it('pad chord recognition: identifies Dm7', () => {
    // D minor 7: D, F, A, C
    expect(recogniseChord([50, 53, 57, 60])).toBe('Dm7');
  });

  it('pad fallback: unrecognised chord grouping shows note list', () => {
    const session = createSession();
    const track = session.tracks[0];
    // Cluster that doesn't match any chord: C, C#, D
    track.patterns[0].events = [
      { kind: 'note', at: 0, pitch: 48, velocity: 0.7, duration: 16 },  // C3
      { kind: 'note', at: 0, pitch: 49, velocity: 0.7, duration: 16 },  // C#3
      { kind: 'note', at: 0, pitch: 50, velocity: 0.7, duration: 16 },  // D3
    ];
    const result = compressState(session);
    const pattern = result.tracks[0].pattern as { chordBlocks: string; role: string };
    expect(pattern.role).toBe('pad');
    // Should fall back to note list — no chord name before the bracket
    expect(pattern.chordBlocks).toMatch(/^\[C3,C#3,D3\]@1\.1\.1\(16\)$/);
  });

  it('pad chord blocks use | separator between chords', () => {
    const session = createSession();
    const track = session.tracks[0];
    track.patterns[0].duration = 32;
    // Two chords: Fm at step 0, Eb at step 16
    track.patterns[0].events = [
      { kind: 'note', at: 0, pitch: 41, velocity: 0.7, duration: 16 },
      { kind: 'note', at: 0, pitch: 44, velocity: 0.7, duration: 16 },
      { kind: 'note', at: 0, pitch: 48, velocity: 0.7, duration: 16 },
      { kind: 'note', at: 16, pitch: 39, velocity: 0.7, duration: 16 },  // D#2 = Eb2
      { kind: 'note', at: 16, pitch: 43, velocity: 0.7, duration: 16 },  // G2
      { kind: 'note', at: 16, pitch: 46, velocity: 0.7, duration: 16 },  // A#2 = Bb2
    ];
    const result = compressState(session);
    const pattern = result.tracks[0].pattern as { chordBlocks: string; role: string };
    expect(pattern.role).toBe('pad');
    expect(pattern.chordBlocks).toContain(' | ');
  });
});

describe('Role-aware compression: generic fallback', () => {
  it('pattern with both triggers and notes uses generic format (no role)', () => {
    const session = createSession();
    const track = session.tracks[0];
    track.patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.9 },
      { kind: 'note', at: 4, pitch: 60, velocity: 0.8, duration: 1 },
    ];
    const result = compressState(session);
    const pattern = result.tracks[0].pattern;
    expect('role' in pattern).toBe(false);
    expect('triggers' in pattern).toBe(true);
    expect('notes' in pattern).toBe(true);
  });

  it('empty pattern returns minimal format (no role)', () => {
    const session = createSession();
    const track = session.tracks[0];
    track.patterns[0].events = [];
    const result = compressState(session);
    const pattern = result.tracks[0].pattern;
    expect('role' in pattern).toBe(false);
    expect(pattern.event_count).toBe(0);
    expect(pattern.density).toBe(0);
  });

  it('polyphonic notes with short avg duration uses generic format', () => {
    const session = createSession();
    const track = session.tracks[0];
    // 3 simultaneous notes but avg duration < 4 → not pad
    track.patterns[0].events = [
      { kind: 'note', at: 0, pitch: 60, velocity: 0.7, duration: 1 },
      { kind: 'note', at: 0, pitch: 64, velocity: 0.7, duration: 1 },
      { kind: 'note', at: 0, pitch: 67, velocity: 0.7, duration: 1 },
    ];
    const result = compressState(session);
    const pattern = result.tracks[0].pattern;
    expect('role' in pattern).toBe(false);
    expect('notes' in pattern).toBe(true);
  });
});

describe('stepToPosition helper', () => {
  it('converts step 0 to 1.1.1', () => {
    expect(stepToPosition(0)).toBe('1.1.1');
  });

  it('converts step 4 to 1.2.1', () => {
    expect(stepToPosition(4)).toBe('1.2.1');
  });

  it('converts step 16 to 2.1.1', () => {
    expect(stepToPosition(16)).toBe('2.1.1');
  });

  it('converts step 7 to 1.2.4', () => {
    expect(stepToPosition(7)).toBe('1.2.4');
  });

  it('converts step 15 to 1.4.4', () => {
    expect(stepToPosition(15)).toBe('1.4.4');
  });
});

describe('recogniseChord', () => {
  it('recognises C major', () => {
    expect(recogniseChord([48, 52, 55])).toBe('C');
  });

  it('recognises F minor', () => {
    expect(recogniseChord([41, 44, 48])).toBe('Fm');
  });

  it('recognises G7', () => {
    expect(recogniseChord([43, 47, 50, 53])).toBe('G7');
  });

  it('recognises Amaj7', () => {
    expect(recogniseChord([45, 49, 52, 56])).toBe('Amaj7');
  });

  it('recognises Dsus4', () => {
    expect(recogniseChord([50, 55, 57])).toBe('Dsus4');
  });

  it('recognises Bdim', () => {
    expect(recogniseChord([47, 50, 53])).toBe('Bdim');
  });

  it('returns null for unrecognised cluster', () => {
    // C, C#, D — no chord match
    expect(recogniseChord([48, 49, 50])).toBeNull();
  });

  it('returns null for single note', () => {
    expect(recogniseChord([60])).toBeNull();
  });

  it('handles octave-duplicated pitches', () => {
    // C major with octave doubling: C3, E3, G3, C4
    expect(recogniseChord([48, 52, 55, 60])).toBe('C');
  });
});

// ---------------------------------------------------------------------------
// Regression tests for review findings
// ---------------------------------------------------------------------------

describe('Role-aware compression: param_locks preserved (P1 regression)', () => {
  it('bass pattern includes param_locks when present', () => {
    const session = createSession();
    const track = session.tracks[0];
    track.patterns[0].events = [
      { kind: 'note', at: 0, pitch: 41, velocity: 0.8, duration: 2 },
      { kind: 'parameter', at: 0, controlId: 'timbre', value: 0.9 },
    ];
    const result = compressState(session);
    const pattern = result.tracks[0].pattern;
    expect('role' in pattern && pattern.role).toBe('bass');
    expect('param_locks' in pattern).toBe(true);
    expect((pattern as { param_locks: unknown[] }).param_locks).toEqual([
      { at: 0, params: { timbre: 0.9 } },
    ]);
  });

  it('pad pattern includes param_locks when present', () => {
    const session = createSession();
    const track = session.tracks[0];
    track.patterns[0].events = [
      { kind: 'note', at: 0, pitch: 41, velocity: 0.7, duration: 16 },
      { kind: 'note', at: 0, pitch: 44, velocity: 0.7, duration: 16 },
      { kind: 'note', at: 0, pitch: 48, velocity: 0.7, duration: 16 },
      { kind: 'parameter', at: 4, controlId: 'morph', value: 0.5 },
    ];
    const result = compressState(session);
    const pattern = result.tracks[0].pattern;
    expect('role' in pattern && pattern.role).toBe('pad');
    expect('param_locks' in pattern).toBe(true);
    expect((pattern as { param_locks: unknown[] }).param_locks).toEqual([
      { at: 4, params: { morph: 0.5 } },
    ]);
  });

  it('bass pattern omits param_locks when none exist', () => {
    const session = createSession();
    const track = session.tracks[0];
    track.patterns[0].events = [
      { kind: 'note', at: 0, pitch: 41, velocity: 0.8, duration: 2 },
    ];
    const result = compressState(session);
    const pattern = result.tracks[0].pattern;
    expect('role' in pattern && pattern.role).toBe('bass');
    expect('param_locks' in pattern).toBe(false);
  });
});

describe('Role-aware compression: fractional step positions (P2 regression)', () => {
  it('stepToPosition handles fractional steps with offset', () => {
    // Step 2.5 → 1.1.3+0.5
    expect(stepToPosition(2.5)).toBe('1.1.3+0.5');
    // Step 6.33 → 1.2.3+0.33
    expect(stepToPosition(6.33)).toBe('1.2.3+0.33');
    // Integer step — no offset
    expect(stepToPosition(4)).toBe('1.2.1');
  });

  it('bass tracker rows show fractional timing correctly', () => {
    const session = createSession();
    const track = session.tracks[0];
    track.patterns[0].events = [
      { kind: 'note', at: 2.5, pitch: 48, velocity: 0.8, duration: 1 },
    ];
    const result = compressState(session);
    const pattern = result.tracks[0].pattern as { trackerRows: string; role: string };
    expect(pattern.role).toBe('bass');
    expect(pattern.trackerRows).toContain('C3@1.1.3+0.5');
  });
});

describe('Role-aware compression: intra-bar pad chord timing (P3 regression)', () => {
  it('pad chords at different positions within same bar show distinct positions', () => {
    const session = createSession();
    const track = session.tracks[0];
    track.patterns[0].events = [
      // Chord at step 0
      { kind: 'note', at: 0, pitch: 41, velocity: 0.7, duration: 4 },
      { kind: 'note', at: 0, pitch: 44, velocity: 0.7, duration: 4 },
      { kind: 'note', at: 0, pitch: 48, velocity: 0.7, duration: 4 },
      // Chord at step 4
      { kind: 'note', at: 4, pitch: 43, velocity: 0.7, duration: 4 },
      { kind: 'note', at: 4, pitch: 47, velocity: 0.7, duration: 4 },
      { kind: 'note', at: 4, pitch: 50, velocity: 0.7, duration: 4 },
      // Chord at step 12
      { kind: 'note', at: 12, pitch: 39, velocity: 0.7, duration: 4 },
      { kind: 'note', at: 12, pitch: 43, velocity: 0.7, duration: 4 },
      { kind: 'note', at: 12, pitch: 46, velocity: 0.7, duration: 4 },
    ];
    const result = compressState(session);
    const pattern = result.tracks[0].pattern as { chordBlocks: string; role: string };
    expect(pattern.role).toBe('pad');
    // Each chord should have a distinct position, not all @1
    expect(pattern.chordBlocks).toContain('@1.1.1(');
    expect(pattern.chordBlocks).toContain('@1.2.1(');
    expect(pattern.chordBlocks).toContain('@1.4.1(');
  });
});
