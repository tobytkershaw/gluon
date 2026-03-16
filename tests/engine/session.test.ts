// tests/engine/session.test.ts
import { describe, it, expect } from 'vitest';
import {
  createSession, setAgency, updateTrackParams, setModel,
  setActiveTrack, toggleMute, toggleSolo, setTransportBpm, setTransportSwing, playTransport, pauseTransport, stopTransport,
  setApproval, addReaction, addDecision, resolveDecision, setTrackImportance, setMaster, renameTrack,
  setTimeSignature, setTransportMode,
  captureABSnapshot, restoreABSnapshot,
  MAX_REACTION_HISTORY, MAX_OPEN_DECISIONS,
} from '../../src/engine/session';
import type { Reaction, OpenDecision, ApprovalLevel, Session } from '../../src/engine/types';

describe('Session (Phase 2)', () => {
  it('creates a session with 4 audio tracks plus a master bus', () => {
    const session = createSession();
    expect(session.tracks).toHaveLength(5); // 4 audio + 1 master bus
    expect(session.activeTrackId).toBe(session.tracks[0].id);
    expect(session.transport).toEqual({ status: 'stopped', playing: false, bpm: 120, swing: 0, metronome: { enabled: false, volume: 0.5 }, timeSignature: { numerator: 4, denominator: 4 } });
    // Master bus is last
    const masterBus = session.tracks[session.tracks.length - 1];
    expect(masterBus.id).toBe('master-bus');
    expect(masterBus.kind).toBe('bus');
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
      expect(track.stepGrid.length).toBe(16);
      expect(track.stepGrid.steps).toHaveLength(16);
      expect(track.muted).toBe(false);
      expect(track.solo).toBe(false);
    }
  });

  it('creates audio tracks with agency ON by default (bus tracks have agency OFF)', () => {
    const s = createSession();
    for (const track of s.tracks) {
      if (track.kind === 'bus') {
        expect(track.agency).toBe('OFF');
      } else {
        expect(track.agency).toBe('ON');
      }
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

describe('Transport mode helpers', () => {
  it('setTransportMode sets pattern or song mode', () => {
    const s1 = createSession();
    expect(s1.transport.mode).toBeUndefined();
    const s2 = setTransportMode(s1, 'song');
    expect(s2.transport.mode).toBe('song');
    const s3 = setTransportMode(s2, 'pattern');
    expect(s3.transport.mode).toBe('pattern');
  });

  // --- Time Signature ---

  it('time signature defaults to 4/4', () => {
    const s = createSession();
    expect(s.transport.timeSignature).toEqual({ numerator: 4, denominator: 4 });
  });

  it('setTimeSignature changes numerator and denominator', () => {
    let s = createSession();
    s = setTimeSignature(s, 3, 4);
    expect(s.transport.timeSignature).toEqual({ numerator: 3, denominator: 4 });
  });

  it('setTimeSignature clamps numerator to 1-16', () => {
    let s = createSession();
    s = setTimeSignature(s, 0, 4);
    expect(s.transport.timeSignature.numerator).toBe(1);
    s = setTimeSignature(s, 20, 4);
    expect(s.transport.timeSignature.numerator).toBe(16);
  });

  it('setTimeSignature rejects invalid denominators (falls back to 4)', () => {
    let s = createSession();
    s = setTimeSignature(s, 4, 3); // 3 is not a valid denominator
    expect(s.transport.timeSignature.denominator).toBe(4);
    s = setTimeSignature(s, 4, 8); // 8 is valid
    expect(s.transport.timeSignature.denominator).toBe(8);
  });

  it('setTimeSignature accepts all valid denominators (2, 4, 8, 16)', () => {
    let s = createSession();
    for (const d of [2, 4, 8, 16]) {
      s = setTimeSignature(s, 4, d);
      expect(s.transport.timeSignature.denominator).toBe(d);
    }
  });
});

// ---------------------------------------------------------------------------
// A/B Comparison
// ---------------------------------------------------------------------------

describe('A/B comparison', () => {
  it('captureABSnapshot captures tracks, transport, master, context', () => {
    let s = createSession();
    s = setTransportBpm(s, 140);
    const snap = captureABSnapshot(s);
    expect(snap.tracks).toHaveLength(s.tracks.length);
    expect(snap.transport.bpm).toBe(140);
    expect(snap.master).toEqual(s.master);
    expect(snap.context).toEqual(s.context);
  });

  it('captureABSnapshot deep-copies tracks (mutations do not leak)', () => {
    const s = createSession();
    const snap = captureABSnapshot(s);
    snap.tracks[0].params.timbre = 0.99;
    expect(s.tracks[0].params.timbre).toBe(0.5); // original unchanged
  });

  it('restoreABSnapshot swaps musical state back', () => {
    let s = createSession();
    const snap = captureABSnapshot(s);
    // Modify session after capture
    s = setTransportBpm(s, 200);
    s = updateTrackParams(s, s.tracks[0].id, { timbre: 0.1 });
    // Restore
    const restored = restoreABSnapshot(s, snap);
    expect(restored.transport.bpm).toBe(120); // original BPM
    expect(restored.tracks[0].params.timbre).toBe(0.5); // original param
  });

  it('restoreABSnapshot preserves playing state during switch (#509)', () => {
    let s = createSession();
    // Capture snapshot while stopped
    const snap = captureABSnapshot(s);
    expect(snap.transport.playing).toBe(false);
    expect(snap.transport.status).toBe('stopped');

    // Start playing, change BPM
    s = playTransport(s);
    s = setTransportBpm(s, 200);
    expect(s.transport.playing).toBe(true);
    expect(s.transport.status).toBe('playing');

    // Restore the snapshot — playing state must be preserved
    const restored = restoreABSnapshot(s, snap);
    expect(restored.transport.playing).toBe(true);
    expect(restored.transport.status).toBe('playing');
    // Musical config should be restored from snapshot
    expect(restored.transport.bpm).toBe(120);
  });

  it('restoreABSnapshot preserves paused state during switch', () => {
    let s = createSession();
    s = playTransport(s);
    const snap = captureABSnapshot(s); // captured while playing
    s = pauseTransport(s);
    s = setTransportBpm(s, 180);

    const restored = restoreABSnapshot(s, snap);
    expect(restored.transport.playing).toBe(false);
    expect(restored.transport.status).toBe('paused');
    // BPM comes from snapshot (which was captured at 120)
    expect(restored.transport.bpm).toBe(120);
  });

  it('restoreABSnapshot clears playFromStep when playing (avoids stale restart)', () => {
    let s = createSession();
    const snap = captureABSnapshot(s);
    s = playTransport(s, 8); // play from step 8
    expect(s.transport.playFromStep).toBe(8);

    const restored = restoreABSnapshot(s, snap);
    // While playing, playFromStep is cleared to prevent scheduler restarting at stale position
    expect(restored.transport.playFromStep).toBeUndefined();
  });

  it('restoreABSnapshot preserves activeTrackId when track exists in snapshot', () => {
    let s = createSession();
    s = setActiveTrack(s, s.tracks[2].id);
    const snap = captureABSnapshot(s);
    // Restore into a session where activeTrackId is track 1
    s = setActiveTrack(s, s.tracks[1].id);
    const restored = restoreABSnapshot(s, snap);
    // Should preserve current session's activeTrackId since it exists in snapshot
    expect(restored.activeTrackId).toBe(s.tracks[1].id);
  });

  it('restoreABSnapshot preserves undo/redo stacks and messages', () => {
    let s = createSession();
    s = setTransportBpm(s, 140);
    const snap = captureABSnapshot(s);
    // Add something to undo stack
    s = setMaster(s, { volume: 0.5 });
    expect(s.undoStack.length).toBe(1);

    const restored = restoreABSnapshot(s, snap);
    // Undo stack should be preserved (non-musical state)
    expect(restored.undoStack.length).toBe(1);
  });

  it('restoreABSnapshot swaps transport mode (not preserved) (#520)', () => {
    let s = createSession();
    // Capture with mode='pattern'
    s = setTransportMode(s, 'pattern');
    const snap = captureABSnapshot(s);
    expect(snap.transport.mode).toBe('pattern');

    // Change to mode='song' after capture
    s = setTransportMode(s, 'song');
    expect(s.transport.mode).toBe('song');

    // Restore — mode should revert to 'pattern' from the snapshot
    const restored = restoreABSnapshot(s, snap);
    expect(restored.transport.mode).toBe('pattern');
  });

  it('restoreABSnapshot falls back activeTrackId to snapshot tracks[0] when current track missing (#520)', () => {
    let s = createSession();
    const snap = captureABSnapshot(s);
    // Simulate activeTrackId pointing to a track that doesn't exist in the snapshot
    // (e.g. a track added after snapshot was captured)
    s = { ...s, activeTrackId: 'v999' };
    expect(snap.tracks.some(t => t.id === 'v999')).toBe(false);

    const restored = restoreABSnapshot(s, snap);
    // Should fall back to the first track in the snapshot
    expect(restored.activeTrackId).toBe(snap.tracks[0].id);
  });

  it('restoreABSnapshot clears playFromStep when playing to avoid stale restart (#520)', () => {
    let s = createSession();
    // Play from step 8, then capture snapshot
    s = playTransport(s, 8);
    const snap = captureABSnapshot(s);

    // Still playing — playFromStep should be cleared on restore
    const restored = restoreABSnapshot(s, snap);
    expect(restored.transport.status).toBe('playing');
    expect(restored.transport.playFromStep).toBeUndefined();
  });

  it('restoreABSnapshot preserves playFromStep when paused', () => {
    let s = createSession();
    s = playTransport(s, 4);
    s = pauseTransport(s);
    // playFromStep is preserved from the playing call, status is now paused
    expect(s.transport.playFromStep).toBe(4);
    expect(s.transport.status).toBe('paused');

    const snap = captureABSnapshot(s);
    const restored = restoreABSnapshot(s, snap);
    // Paused — playFromStep should be preserved
    expect(restored.transport.playFromStep).toBe(4);
  });
});
