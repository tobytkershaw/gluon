// tests/engine/session.test.ts
import { describe, it, expect } from 'vitest';
import {
  createSession, setAgency, updateTrackParams, setModel,
  setActiveTrack, toggleMute, toggleSolo, setTransportBpm, setTransportSwing, playTransport, pauseTransport, stopTransport,
  setApproval, addReaction, addDecision, resolveDecision, setTrackImportance, setMaster, renameTrack,
  MAX_REACTION_HISTORY, MAX_OPEN_DECISIONS,
} from '../../src/engine/session';
import type { Reaction, OpenDecision, ApprovalLevel, Session } from '../../src/engine/types';

describe('Session (Phase 2)', () => {
  it('creates a session with 4 tracks', () => {
    const session = createSession();
    expect(session.tracks).toHaveLength(4);
    expect(session.activeTrackId).toBe(session.tracks[0].id);
    expect(session.transport).toEqual({ status: 'stopped', playing: false, bpm: 120, swing: 0 });
  });

  it('track 0 is model 13 (kick), track 1 is model 0 (bass), track 2 is model 2 (lead), track 3 is model 4 (pad)', () => {
    const session = createSession();
    expect(session.tracks[0].model).toBe(13);
    expect(session.tracks[1].model).toBe(0);
    expect(session.tracks[2].model).toBe(2);
    expect(session.tracks[3].model).toBe(4);
  });

  it('each track has a 16-step default pattern', () => {
    const session = createSession();
    for (const track of session.tracks) {
      expect(track.pattern.length).toBe(16);
      expect(track.pattern.steps).toHaveLength(16);
      expect(track.muted).toBe(false);
      expect(track.solo).toBe(false);
    }
  });

  it('creates tracks with agency ON by default', () => {
    const s = createSession();
    for (const track of s.tracks) {
      expect(track.agency).toBe('ON');
    }
  });

  it('sets agency on active track', () => {
    let s = createSession();
    s = setAgency(s, s.activeTrackId, 'OFF');
    const track = s.tracks.find(v => v.id === s.activeTrackId)!;
    expect(track.agency).toBe('OFF');
  });

  it('updates track params by trackId', () => {
    const s1 = createSession();
    const vid = s1.tracks[1].id;
    const s2 = updateTrackParams(s1, vid, { timbre: 0.8 });
    expect(s2.tracks.find(v => v.id === vid)!.params.timbre).toBe(0.8);
    expect(s1.tracks.find(v => v.id === vid)!.params.timbre).toBe(0.5);
  });

  it('sets model by trackId', () => {
    const s1 = createSession();
    const vid = s1.tracks[0].id;
    const s2 = setModel(s1, vid, 5);
    expect(s2.tracks.find(v => v.id === vid)!.model).toBe(5);
  });

  it('switches active track', () => {
    const s1 = createSession();
    const s2 = setActiveTrack(s1, s1.tracks[2].id);
    expect(s2.activeTrackId).toBe(s1.tracks[2].id);
  });

  it('toggles mute', () => {
    const s1 = createSession();
    const vid = s1.tracks[0].id;
    const s2 = toggleMute(s1, vid);
    expect(s2.tracks.find(v => v.id === vid)!.muted).toBe(true);
    const s3 = toggleMute(s2, vid);
    expect(s3.tracks.find(v => v.id === vid)!.muted).toBe(false);
  });

  it('toggles solo', () => {
    const s1 = createSession();
    const vid = s1.tracks[1].id;
    const s2 = toggleSolo(s1, vid);
    expect(s2.tracks.find(v => v.id === vid)!.solo).toBe(true);
  });

  it('sets transport BPM clamped to 20-300', () => {
    let s = createSession();
    s = setTransportBpm(s, 140);
    expect(s.transport.bpm).toBe(140);
    s = setTransportBpm(s, 10);
    expect(s.transport.bpm).toBe(20);
    s = setTransportBpm(s, 400);
    expect(s.transport.bpm).toBe(300);
    s = setTransportBpm(s, 120.5);
    expect(s.transport.bpm).toBe(120.5);
  });

  it('sets transport swing clamped to 0-1', () => {
    let s = createSession();
    s = setTransportSwing(s, 0.5);
    expect(s.transport.swing).toBe(0.5);
    s = setTransportSwing(s, -1);
    expect(s.transport.swing).toBe(0);
  });

  it('sets explicit transport states', () => {
    let s = createSession();
    s = playTransport(s);
    expect(s.transport.playing).toBe(true);
    expect(s.transport.status).toBe('playing');
    s = pauseTransport(s);
    expect(s.transport.playing).toBe(false);
    expect(s.transport.status).toBe('paused');
    s = stopTransport(s);
    expect(s.transport.playing).toBe(false);
    expect(s.transport.status).toBe('stopped');
  });

});

// ---------------------------------------------------------------------------
// M6 Session Helpers
// ---------------------------------------------------------------------------

describe('setApproval', () => {
  it('creates an ApprovalSnapshot on undoStack', () => {
    const s1 = createSession();
    const trackId = s1.tracks[0].id;
    const s2 = setApproval(s1, trackId, 'liked');
    expect(s2.undoStack.length).toBe(1);
    const snap = s2.undoStack[0];
    expect(snap.kind).toBe('approval');
    if (snap.kind === 'approval') {
      expect(snap.trackId).toBe(trackId);
      expect(snap.prevApproval).toBe('exploratory');
    }
    expect(s2.tracks.find(t => t.id === trackId)!.approval).toBe('liked');
  });

  it('no-op when level === existing level', () => {
    const s1 = createSession();
    const trackId = s1.tracks[0].id;
    // Default approval is 'exploratory'
    const s2 = setApproval(s1, trackId, 'exploratory');
    expect(s2).toBe(s1); // same reference — no change
  });

  it('returns unchanged session for missing trackId', () => {
    const s1 = createSession();
    const s2 = setApproval(s1, 'nonexistent', 'anchor');
    expect(s2).toBe(s1);
  });

  it('description defaults to "Set approval: X → Y"', () => {
    const s1 = createSession();
    const trackId = s1.tracks[0].id;
    const s2 = setApproval(s1, trackId, 'anchor');
    const snap = s2.undoStack[0];
    expect(snap.description).toBe('Set approval: exploratory → anchor');
  });

  it('uses custom description when provided', () => {
    const s1 = createSession();
    const trackId = s1.tracks[0].id;
    const s2 = setApproval(s1, trackId, 'liked', 'Human liked the groove');
    expect(s2.undoStack[0].description).toBe('Human liked the groove');
  });
});

describe('addReaction', () => {
  function makeReaction(index: number, verdict: 'approved' | 'rejected' | 'neutral' = 'approved'): Reaction {
    return { actionGroupIndex: index, verdict, timestamp: Date.now() + index };
  }

  it('appends reaction to reactionHistory', () => {
    let s = createSession();
    const r = makeReaction(0);
    s = addReaction(s, r);
    expect(s.reactionHistory).toHaveLength(1);
    expect(s.reactionHistory![0]).toBe(r);
  });

  it('bounds history to MAX_REACTION_HISTORY (50)', () => {
    let s = createSession();
    for (let i = 0; i < 52; i++) {
      s = addReaction(s, makeReaction(i));
    }
    expect(s.reactionHistory).toHaveLength(MAX_REACTION_HISTORY);
    // oldest 2 (index 0, 1) should be gone; first remaining should be index 2
    expect(s.reactionHistory![0].actionGroupIndex).toBe(2);
    expect(s.reactionHistory![49].actionGroupIndex).toBe(51);
  });

  it('works when reactionHistory is undefined (pre-M6 session)', () => {
    const s1 = createSession();
    // Ensure reactionHistory is undefined
    expect(s1.reactionHistory).toBeUndefined();
    const s2 = addReaction(s1, makeReaction(0));
    expect(s2.reactionHistory).toHaveLength(1);
  });
});

describe('addDecision', () => {
  function makeDecision(id: string, resolved = false): OpenDecision {
    return { id, question: `Question ${id}`, raisedAt: Date.now(), resolved };
  }

  it('appends decision to openDecisions', () => {
    let s = createSession();
    const d = makeDecision('d1');
    s = addDecision(s, d);
    expect(s.openDecisions).toHaveLength(1);
    expect(s.openDecisions![0].id).toBe('d1');
  });

  it('prunes resolved decisions before adding new one', () => {
    let s = createSession();
    s = { ...s, openDecisions: [makeDecision('d1', true), makeDecision('d2', false)] };
    s = addDecision(s, makeDecision('d3'));
    // d1 was resolved, should be pruned; d2 and d3 remain
    expect(s.openDecisions).toHaveLength(2);
    expect(s.openDecisions!.map(d => d.id)).toEqual(['d2', 'd3']);
  });

  it('enforces MAX_OPEN_DECISIONS (20) bound', () => {
    let s = createSession();
    for (let i = 0; i < 22; i++) {
      s = addDecision(s, makeDecision(`d${i}`));
    }
    expect(s.openDecisions).toHaveLength(MAX_OPEN_DECISIONS);
    // oldest 2 should be gone
    expect(s.openDecisions![0].id).toBe('d2');
    expect(s.openDecisions![19].id).toBe('d21');
  });

  it('works when openDecisions is undefined', () => {
    const s1 = createSession();
    expect(s1.openDecisions).toBeUndefined();
    const s2 = addDecision(s1, makeDecision('d1'));
    expect(s2.openDecisions).toHaveLength(1);
  });
});

describe('resolveDecision', () => {
  function makeDecision(id: string, resolved = false): OpenDecision {
    return { id, question: `Question ${id}`, raisedAt: Date.now(), resolved };
  }

  it('marks the correct decision as resolved and prunes it', () => {
    let s = createSession();
    s = { ...s, openDecisions: [makeDecision('d1'), makeDecision('d2'), makeDecision('d3')] };
    s = resolveDecision(s, 'd2');
    // Resolved decisions are pruned — only unresolved remain
    expect(s.openDecisions).toHaveLength(2);
    expect(s.openDecisions!.map(d => d.id)).toEqual(['d1', 'd3']);
  });

  it('no-op for unknown decisionId', () => {
    let s = createSession();
    s = { ...s, openDecisions: [makeDecision('d1')] };
    const s2 = resolveDecision(s, 'nonexistent');
    expect(s2.openDecisions).toHaveLength(1);
    expect(s2.openDecisions![0].id).toBe('d1');
  });

  it('works when openDecisions is undefined', () => {
    const s1 = createSession();
    expect(s1.openDecisions).toBeUndefined();
    const s2 = resolveDecision(s1, 'd1');
    expect(s2.openDecisions).toEqual([]);
  });
});

describe('setTrackImportance', () => {
  it('clamps importance to 0-1 (test with -0.5)', () => {
    const s1 = createSession();
    const trackId = s1.tracks[0].id;
    const s2 = setTrackImportance(s1, trackId, -0.5);
    expect(s2.tracks.find(t => t.id === trackId)!.importance).toBe(0);
  });

  it('clamps importance to 0-1 (test with 1.5)', () => {
    const s1 = createSession();
    const trackId = s1.tracks[0].id;
    const s2 = setTrackImportance(s1, trackId, 1.5);
    expect(s2.tracks.find(t => t.id === trackId)!.importance).toBe(1);
  });

  it('sets musicalRole when provided', () => {
    const s1 = createSession();
    const trackId = s1.tracks[0].id;
    const s2 = setTrackImportance(s1, trackId, 0.7, 'driving rhythm');
    const track = s2.tracks.find(t => t.id === trackId)!;
    expect(track.importance).toBe(0.7);
    expect(track.musicalRole).toBe('driving rhythm');
  });

  it('does NOT clear musicalRole when omitted', () => {
    const s1 = createSession();
    const trackId = s1.tracks[0].id;
    // First set importance with a role
    const s2 = setTrackImportance(s1, trackId, 0.7, 'driving rhythm');
    // Then update importance without specifying musicalRole
    const s3 = setTrackImportance(s2, trackId, 0.9);
    const track = s3.tracks.find(t => t.id === trackId)!;
    expect(track.importance).toBe(0.9);
    expect(track.musicalRole).toBe('driving rhythm');
  });

  it('returns unchanged session for missing trackId', () => {
    const s1 = createSession();
    const s2 = setTrackImportance(s1, 'nonexistent', 0.5);
    // updateTrack creates a new object even when no track matches,
    // so we verify no track gained an importance field
    for (const track of s2.tracks) {
      expect(track.importance).toBeUndefined();
    }
  });
});

describe('setMaster', () => {
  it('creates MasterSnapshot on undoStack', () => {
    const s1 = createSession();
    const s2 = setMaster(s1, { volume: 0.5 });
    expect(s2.undoStack.length).toBe(1);
    const snap = s2.undoStack[0];
    expect(snap.kind).toBe('master');
    if (snap.kind === 'master') {
      expect(snap.prevMaster.volume).toBe(0.8); // default
      expect(snap.prevMaster.pan).toBe(0.0);
    }
  });

  it('clamps volume to 0-1', () => {
    const s1 = createSession();
    const s2 = setMaster(s1, { volume: 1.5 });
    expect(s2.master.volume).toBe(1);
    const s3 = setMaster(s1, { volume: -0.5 });
    expect(s3.master.volume).toBe(0);
  });

  it('clamps pan to -1 to 1', () => {
    const s1 = createSession();
    const s2 = setMaster(s1, { pan: 2 });
    expect(s2.master.pan).toBe(1);
    const s3 = setMaster(s1, { pan: -3 });
    expect(s3.master.pan).toBe(-1);
  });

  it('partial update — only volume', () => {
    const s1 = createSession();
    const s2 = setMaster(s1, { volume: 0.3 });
    expect(s2.master.volume).toBe(0.3);
    expect(s2.master.pan).toBe(0.0); // unchanged
  });

  it('partial update — only pan', () => {
    const s1 = createSession();
    const s2 = setMaster(s1, { pan: -0.5 });
    expect(s2.master.pan).toBe(-0.5);
    expect(s2.master.volume).toBe(0.8); // unchanged
  });
});

describe('renameTrack', () => {
  it('sets name on the correct track', () => {
    const s1 = createSession();
    const trackId = s1.tracks[1].id;
    const s2 = renameTrack(s1, trackId, 'Bass Line');
    const track = s2.tracks.find(t => t.id === trackId)!;
    expect(track.name).toBe('Bass Line');
    // Other tracks should be unaffected
    expect(s2.tracks.find(t => t.id === s1.tracks[0].id)!.name).toBeUndefined();
  });
});
