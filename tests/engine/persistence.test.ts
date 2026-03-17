// tests/engine/persistence.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { saveSession, loadSession, clearSavedSession, stripForPersistence, MAX_PERSISTED_UNDO, restoreSession } from '../../src/engine/persistence';
import { createSession } from '../../src/engine/session';
import { createDefaultStepGrid } from '../../src/engine/sequencer-helpers';
import { toggleStepGate } from '../../src/engine/pattern-primitives';
import { getTrack, MASTER_BUS_ID } from '../../src/engine/types';
import type { Reaction, OpenDecision } from '../../src/engine/types';
import type { TriggerEvent } from '../../src/engine/canonical-types';

// Mock localStorage for Node/Vitest environment
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  },
  writable: true,
});

describe('persistence', () => {
  beforeEach(() => {
    store.clear();
  });

  it('round-trips a modified session through save and load', () => {
    const session = createSession();
    const modified = {
      ...session,
      messages: [{ role: 'human' as const, text: 'hello', timestamp: 1 }],
      transport: { ...session.transport, bpm: 140 },
    };
    saveSession(modified);
    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.transport.bpm).toBe(140);
    expect(loaded!.messages).toHaveLength(1);
    expect(loaded!.messages[0].text).toBe('hello');
    expect(loaded!.undoStack).toEqual([]); // no undo entries were added
    expect(loaded!.transport.status).toBe('stopped');
  });

  it('restoreSession normalizes project-loaded sessions through the full shared contract', () => {
    const session = createSession();
    const withoutMaster = {
      ...session,
      tracks: session.tracks.filter(track => track.id !== MASTER_BUS_ID),
      transport: {
        ...session.transport,
        status: undefined,
        metronome: undefined,
        timeSignature: undefined,
        mode: undefined,
      },
      master: undefined,
      undoStack: undefined,
      redoStack: undefined,
      recentHumanActions: undefined,
      reactionHistory: undefined,
      openDecisions: undefined,
    };

    const restored = restoreSession(withoutMaster);
    expect(restored.tracks.some(track => track.id === MASTER_BUS_ID)).toBe(true);
    expect(restored.transport.status).toBe('stopped');
    expect(restored.transport.metronome).toEqual({ enabled: false, volume: 0.5 });
    expect(restored.transport.timeSignature).toEqual({ numerator: 4, denominator: 4 });
    expect(restored.transport.mode).toBe('pattern');
    expect(restored.master).toEqual({ volume: 0.8, pan: 0.0 });
    expect(restored.undoStack).toEqual([]);
    expect(restored.redoStack).toEqual([]);
    expect(restored.recentHumanActions).toEqual([]);
    expect(restored.reactionHistory).toEqual([]);
    expect(restored.openDecisions).toEqual([]);
  });

  it('restoreSession clears undo history for pre-v6 sessions', () => {
    const session = createSession();
    const legacySession = {
      ...session,
      undoStack: [{
        kind: 'param' as const,
        trackId: 'v0',
        prevValues: { timbre: 0.2 },
        aiTargetValues: { timbre: 0.8 },
        timestamp: 1,
        description: 'legacy',
      }],
      redoStack: [{
        kind: 'param' as const,
        trackId: 'v0',
        prevValues: { morph: 0.1 },
        aiTargetValues: { morph: 0.9 },
        timestamp: 2,
        description: 'legacy-redo',
      }],
    };

    const restored = restoreSession(legacySession, 5);
    expect(restored.undoStack).toEqual([]);
    expect(restored.redoStack).toEqual([]);
  });

  it('returns null when no saved session exists', () => {
    expect(loadSession()).toBeNull();
  });

  it('returns null for corrupt data', () => {
    store.set('gluon-session', 'not valid json{{{');
    expect(loadSession()).toBeNull();
  });

  it('returns null for wrong version', () => {
    store.set('gluon-session', JSON.stringify({ version: 999, session: {}, savedAt: 1 }));
    expect(loadSession()).toBeNull();
  });

  it('returns null for invalid session shape', () => {
    store.set('gluon-session', JSON.stringify({
      version: 1,
      session: { tracks: 'not-an-array' },
      savedAt: 1,
    }));
    expect(loadSession()).toBeNull();
  });

  it('does not save a default (unmodified) session', () => {
    const session = createSession();
    saveSession(session);
    expect(loadSession()).toBeNull();
  });

  it('clearSavedSession removes the stored data', () => {
    const session = createSession();
    const modified = {
      ...session,
      messages: [{ role: 'human' as const, text: 'test', timestamp: 1 }],
    };
    saveSession(modified);
    expect(loadSession()).not.toBeNull();
    clearSavedSession();
    expect(loadSession()).toBeNull();
  });

  it('saves session when pattern has been edited (gate enabled)', () => {
    const session = createSession();
    const modified = {
      ...session,
      tracks: session.tracks.map((v, i) =>
        i === 0
          ? {
              ...v,
              stepGrid: {
                ...v.stepGrid,
                steps: v.stepGrid.steps.map((s, j) =>
                  j === 0 ? { ...s, gate: true } : s,
                ),
              },
            }
          : v,
      ),
    };
    saveSession(modified);
    expect(loadSession()).not.toBeNull();
  });

  it('saves session when pattern has been edited (accent enabled)', () => {
    const session = createSession();
    const modified = {
      ...session,
      tracks: session.tracks.map((v, i) =>
        i === 0
          ? {
              ...v,
              stepGrid: {
                ...v.stepGrid,
                steps: v.stepGrid.steps.map((s, j) =>
                  j === 2 ? { ...s, accent: true } : s,
                ),
              },
            }
          : v,
      ),
    };
    saveSession(modified);
    expect(loadSession()).not.toBeNull();
  });

  it('saves session when pattern has non-zero micro timing', () => {
    const session = createSession();
    const modified = {
      ...session,
      tracks: session.tracks.map((v, i) =>
        i === 1
          ? {
              ...v,
              stepGrid: {
                ...v.stepGrid,
                steps: v.stepGrid.steps.map((s, j) =>
                  j === 0 ? { ...s, micro: 0.3 } : s,
                ),
              },
            }
          : v,
      ),
    };
    saveSession(modified);
    expect(loadSession()).not.toBeNull();
  });

  it('saves session when pattern length differs from default', () => {
    const session = createSession();
    const modified = {
      ...session,
      tracks: session.tracks.map((v, i) =>
        i === 0 ? { ...v, stepGrid: createDefaultStepGrid(8) } : v,
      ),
    };
    saveSession(modified);
    expect(loadSession()).not.toBeNull();
  });

  it('persists undo stack through save and load', () => {
    const session = createSession();
    const undoEntry = {
      kind: 'param' as const,
      trackId: 'v0',
      prevValues: { timbre: 0.5 },
      aiTargetValues: { timbre: 0.8 },
      timestamp: 1,
      description: 'test',
    };
    const withUndo = {
      ...session,
      messages: [{ role: 'human' as const, text: 'x', timestamp: 1 }],
      undoStack: [undoEntry],
    };
    saveSession(withUndo);
    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.undoStack).toHaveLength(1);
    expect(loaded!.undoStack[0]).toMatchObject({
      kind: 'param',
      trackId: 'v0',
      prevValues: { timbre: 0.5 },
    });
  });

  it('trims undo stack to MAX_PERSISTED_UNDO most recent entries', () => {
    const session = createSession();
    const entries = Array.from({ length: MAX_PERSISTED_UNDO + 20 }, (_, i) => ({
      kind: 'param' as const,
      trackId: 'v0',
      prevValues: { timbre: i / 100 },
      aiTargetValues: { timbre: (i + 1) / 100 },
      timestamp: i,
      description: `entry-${i}`,
    }));
    const withUndo = {
      ...session,
      messages: [{ role: 'human' as const, text: 'x', timestamp: 1 }],
      undoStack: entries,
    };
    const stripped = stripForPersistence(withUndo);
    expect(stripped.undoStack).toHaveLength(MAX_PERSISTED_UNDO);
    // Should keep the most recent (last) entries
    expect((stripped.undoStack[0] as any).description).toBe(`entry-20`);
    expect((stripped.undoStack[MAX_PERSISTED_UNDO - 1] as any).description).toBe(`entry-${MAX_PERSISTED_UNDO + 19}`);
  });

  it('round-trips undo stack through JSON serialization', () => {
    const session = createSession();
    const undoEntry = {
      kind: 'param' as const,
      trackId: 'v0',
      prevValues: { timbre: 0.5, morph: 0.3 },
      aiTargetValues: { timbre: 0.8, morph: 0.6 },
      timestamp: 42,
      description: 'round-trip test',
    };
    const withUndo = {
      ...session,
      messages: [{ role: 'human' as const, text: 'x', timestamp: 1 }],
      undoStack: [undoEntry],
    };
    const stripped = stripForPersistence(withUndo);
    const json = JSON.stringify(stripped);
    const parsed = JSON.parse(json);
    expect(parsed.undoStack).toHaveLength(1);
    expect(parsed.undoStack[0].kind).toBe('param');
    expect(parsed.undoStack[0].prevValues.timbre).toBe(0.5);
    expect(parsed.undoStack[0].prevValues.morph).toBe(0.3);
  });

  it('loads session with missing undoStack (pre-v4 data) as empty array', () => {
    const session = createSession();
    const sessionData = {
      ...session,
      messages: [{ role: 'human' as const, text: 'x', timestamp: 1 }],
    };
    // Simulate a pre-v4 save that has no undoStack property
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawSession = { ...sessionData } as any;
    delete rawSession.undoStack;
    store.set('gluon-session', JSON.stringify({
      version: 3,
      session: rawSession,
      savedAt: Date.now(),
    }));
    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.undoStack).toEqual([]);
  });

  // --- V2 Migration tests ---

  it('loads v1 session (no regions) and hydrates regions from legacy steps', () => {
    // Simulate a v1 save: session with pattern but no regions
    const session = createSession();
    const v1Track = {
      ...session.tracks[0],
      stepGrid: {
        ...session.tracks[0].stepGrid,
        steps: session.tracks[0].stepGrid.steps.map((s, j) =>
          j === 0 ? { ...s, gate: true } : j === 4 ? { ...s, gate: true, accent: true } : s,
        ),
      },
    };
    // Remove regions to simulate v1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- simulate legacy v1 data without regions
    const v1TrackNoRegions = { ...v1Track } as any;
    delete v1TrackNoRegions.patterns;

    const v1Session = {
      ...session,
      tracks: [v1TrackNoRegions, ...session.tracks.slice(1)],
    };

    store.set('gluon-session', JSON.stringify({
      version: 1,
      session: { ...v1Session, undoStack: [], recentHumanActions: [] },
      savedAt: Date.now(),
    }));

    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    const track = getTrack(loaded!, 'v0');
    // Regions should be hydrated
    expect(track.patterns).toBeDefined();
    expect(track.patterns.length).toBeGreaterThan(0);
    // Pattern should be re-projected from regions and match original gates
    expect(track.stepGrid.steps[0].gate).toBe(true);
    expect(track.stepGrid.steps[4].gate).toBe(true);
    expect(track.stepGrid.steps[4].accent).toBe(true);
  });

  it('loads v2 session: pattern is re-projected from regions, not from saved data', () => {
    // Create a session with regions containing events
    let session = createSession();
    session = toggleStepGate(session, 'v0', 0);
    session = toggleStepGate(session, 'v0', 4);

    saveSession(session);

    // Tamper with the saved pattern to prove it gets re-projected
    const raw = JSON.parse(store.get('gluon-session')!);
    raw.session.tracks[0].stepGrid.steps[0].gate = false; // corrupt pattern
    store.set('gluon-session', JSON.stringify(raw));

    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    const track = getTrack(loaded!, 'v0');
    // Pattern should be re-projected from regions (ignoring corrupted saved pattern)
    expect(track.stepGrid.steps[0].gate).toBe(true);
    expect(track.stepGrid.steps[4].gate).toBe(true);
  });

  it('round-trips v2 save: regions and projected pattern match', () => {
    let session = createSession();
    session = toggleStepGate(session, 'v0', 0);
    session = toggleStepGate(session, 'v0', 8);

    saveSession(session);
    const loaded = loadSession();
    expect(loaded).not.toBeNull();

    const track = getTrack(loaded!, 'v0');
    expect(track.patterns[0].events.length).toBe(2);
    expect(track.stepGrid.steps[0].gate).toBe(true);
    expect(track.stepGrid.steps[8].gate).toBe(true);
    expect(track.stepGrid.steps[1].gate).toBe(false);
  });

  it('saves session when regions have events (non-default check)', () => {
    let session = createSession();
    session = toggleStepGate(session, 'v0', 0);
    saveSession(session);
    expect(loadSession()).not.toBeNull();
  });

  it('recovery: regions missing but legacy pattern exists → hydrate from pattern', () => {
    const session = createSession();
    const v1Track = {
      ...session.tracks[0],
      stepGrid: {
        steps: session.tracks[0].stepGrid.steps.map((s, j) =>
          j === 2 ? { ...s, gate: true } : s,
        ),
        length: 16,
      },
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- simulate legacy v1 data
    delete v1Track.patterns;

    store.set('gluon-session', JSON.stringify({
      version: 1,
      session: {
        ...session,
        tracks: [v1Track, ...session.tracks.slice(1)],
        undoStack: [],
        recentHumanActions: [],
      },
      savedAt: Date.now(),
    }));

    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    const track = getTrack(loaded!, 'v0');
    expect(track.patterns.length).toBe(1);
    expect(track.patterns[0].events.some(e => e.kind === 'trigger' && Math.abs(e.at - 2) < 0.01)).toBe(true);
    expect(track.stepGrid.steps[2].gate).toBe(true);
  });

  // --- Views and hidden events persistence ---

  it('round-trips views through save and load', () => {
    let session = createSession();
    // Add a message so it's non-default and will save
    session = {
      ...session,
      messages: [{ role: 'human' as const, text: 'test', timestamp: 1 }],
    };
    // Verify default views are present
    const v0 = getTrack(session, 'v0');
    expect(v0.views).toEqual([{ kind: 'step-grid', id: 'step-grid-v0' }]);

    saveSession(session);
    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    const loadedTrack = getTrack(loaded!, 'v0');
    expect(loadedTrack.views).toEqual([{ kind: 'step-grid', id: 'step-grid-v0' }]);
  });

  it('persists empty views array when user removed all views', () => {
    let session = createSession();
    session = {
      ...session,
      messages: [{ role: 'human' as const, text: 'test', timestamp: 1 }],
      tracks: session.tracks.map(v =>
        v.id === 'v0' ? { ...v, views: [] } : v,
      ),
    };

    saveSession(session);
    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    const loadedTrack = getTrack(loaded!, 'v0');
    expect(loadedTrack.views).toEqual([]);
  });

  it('round-trips _hiddenEvents through save and load', () => {
    let session = createSession();
    // Toggle a gate at step 12, then shorten pattern to 8 — step 12 event becomes hidden
    session = toggleStepGate(session, 'v0', 0); // ensure non-default
    const hiddenEvent: TriggerEvent = { kind: 'trigger', at: 12, velocity: 1, accent: false };
    session = {
      ...session,
      tracks: session.tracks.map(v =>
        v.id === 'v0' ? { ...v, _hiddenEvents: [hiddenEvent] } : v,
      ),
    };

    saveSession(session);
    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    const loadedTrack = getTrack(loaded!, 'v0');
    expect(loadedTrack._hiddenEvents).toBeDefined();
    expect(loadedTrack._hiddenEvents).toHaveLength(1);
    expect(loadedTrack._hiddenEvents![0]).toMatchObject({ kind: 'trigger', at: 12 });
  });

  it('loads pre-views session and gets default views from migration', () => {
    // Simulate a session saved before views existed
    const session = createSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- simulate pre-views save data
    const preViewsTrack = { ...session.tracks[0] } as any;
    delete preViewsTrack.views;

    store.set('gluon-session', JSON.stringify({
      version: 2,
      session: {
        ...session,
        tracks: [preViewsTrack, ...session.tracks.slice(1)],
        undoStack: [],
        recentHumanActions: [],
      },
      savedAt: Date.now(),
    }));

    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    const track = getTrack(loaded!, 'v0');
    // Track should load without error — views may be undefined but track is usable
    expect(track.patterns.length).toBeGreaterThan(0);
  });

  it('recovery: neither regions nor pattern → empty default region', () => {
    const session = createSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- simulate broken legacy data
    const brokenTrack = { ...session.tracks[0] } as any;
    delete brokenTrack.patterns;
    brokenTrack.stepGrid = { steps: [], length: 0 };

    store.set('gluon-session', JSON.stringify({
      version: 1,
      session: {
        ...session,
        tracks: [brokenTrack, ...session.tracks.slice(1)],
        undoStack: [],
        recentHumanActions: [],
      },
      savedAt: Date.now(),
    }));

    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    const track = getTrack(loaded!, 'v0');
    expect(track.patterns.length).toBe(1);
    expect(track.patterns[0].events).toHaveLength(0);
  });

  // --- M6 field persistence tests ---

  it('round-trips all M6 fields (approval, importance, musicalRole, reactionHistory, openDecisions)', () => {
    const session = createSession();
    const reactions: Reaction[] = [
      { actionGroupIndex: 0, verdict: 'approved', rationale: 'nice kick', timestamp: 100 },
      { actionGroupIndex: 1, verdict: 'rejected', timestamp: 200 },
    ];
    const decisions: OpenDecision[] = [
      { id: 'd1', question: 'Should we add reverb?', context: 'track is dry', options: ['yes', 'no'], trackIds: ['v0'], raisedAt: 300 },
    ];
    const modified = {
      ...session,
      messages: [{ role: 'human' as const, text: 'test', timestamp: 1 }],
      tracks: session.tracks.map((t, i) =>
        i === 0
          ? { ...t, approval: 'anchor' as const, importance: 0.8, musicalRole: 'driving rhythm' }
          : t,
      ),
      reactionHistory: reactions,
      openDecisions: decisions,
    };

    saveSession(modified);
    const loaded = loadSession();
    expect(loaded).not.toBeNull();

    // Track-level M6 fields
    const track = getTrack(loaded!, 'v0');
    expect(track.approval).toBe('anchor');
    expect(track.importance).toBe(0.8);
    expect(track.musicalRole).toBe('driving rhythm');

    // Session-level M6 fields
    expect(loaded!.reactionHistory).toHaveLength(2);
    expect(loaded!.reactionHistory![0]).toMatchObject({ actionGroupIndex: 0, verdict: 'approved', rationale: 'nice kick' });
    expect(loaded!.reactionHistory![1]).toMatchObject({ actionGroupIndex: 1, verdict: 'rejected' });
    expect(loaded!.openDecisions).toHaveLength(1);
    expect(loaded!.openDecisions![0]).toMatchObject({ id: 'd1', question: 'Should we add reverb?', trackIds: ['v0'] });
  });

  it('loads pre-M6 session (v4, no M6 fields) with correct defaults', () => {
    const session = createSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- simulate pre-M6 save data
    const rawSession = {
      ...session,
      messages: [{ role: 'human' as const, text: 'x', timestamp: 1 }],
      undoStack: [],
      recentHumanActions: [],
    } as any;

    // Strip M6 fields from tracks
    rawSession.tracks = rawSession.tracks.map((t: any) => {
      const copy = { ...t };
      delete copy.approval;
      delete copy.importance;
      delete copy.musicalRole;
      return copy;
    });

    // Strip M6 session-level fields
    delete rawSession.reactionHistory;
    delete rawSession.openDecisions;

    store.set('gluon-session', JSON.stringify({
      version: 4,
      session: rawSession,
      savedAt: Date.now(),
    }));

    const loaded = loadSession();
    expect(loaded).not.toBeNull();

    // Track-level: approval migrated to 'exploratory', optional fields stay undefined
    const track = getTrack(loaded!, 'v0');
    expect(track.approval).toBe('exploratory');
    expect(track.importance).toBeUndefined();
    expect(track.musicalRole).toBeUndefined();

    // Session-level: hydrated to empty arrays
    expect(loaded!.reactionHistory).toEqual([]);
    expect(loaded!.openDecisions).toEqual([]);
  });

  it('isNonDefault does not detect M6-only changes (accepted heuristic limitation)', () => {
    // isNonDefault is a save-avoidance heuristic. It checks messages, transport, params,
    // and pattern edits — but NOT approval, importance, musicalRole, reactionHistory, or
    // openDecisions. This is an accepted limitation: worst case is an unnecessary no-op save,
    // not data loss. See NOTE(#215) in isNonDefault's docstring.
    const session = createSession();
    const modified = {
      ...session,
      tracks: session.tracks.map((t, i) =>
        i === 0 ? { ...t, approval: 'anchor' as const } : t,
      ),
    };
    // No messages, no pattern changes — isNonDefault should return false
    saveSession(modified);
    expect(loadSession()).toBeNull(); // save was skipped, so load returns null
  });

  it('stripForPersistence preserves M6 fields', () => {
    const session = createSession();
    const reactions: Reaction[] = [
      { actionGroupIndex: 0, verdict: 'neutral', timestamp: 50 },
    ];
    const decisions: OpenDecision[] = [
      { id: 'd2', question: 'Key?', raisedAt: 60 },
    ];
    const modified = {
      ...session,
      messages: [{ role: 'human' as const, text: 'hi', timestamp: 1 }],
      tracks: session.tracks.map((t, i) =>
        i === 0
          ? { ...t, approval: 'liked' as const, importance: 0.6, musicalRole: 'ambient pad' }
          : t,
      ),
      reactionHistory: reactions,
      openDecisions: decisions,
    };

    const stripped = stripForPersistence(modified);

    // Session-level M6 fields preserved
    expect(stripped.reactionHistory).toEqual(reactions);
    expect(stripped.openDecisions).toEqual(decisions);

    // Track-level M6 fields preserved
    expect(stripped.tracks[0].approval).toBe('liked');
    expect(stripped.tracks[0].importance).toBe(0.6);
    expect(stripped.tracks[0].musicalRole).toBe('ambient pad');
  });

  it('hydrates missing timeSignature to 4/4 on load', () => {
    // Simulate a legacy session without timeSignature
    const session = createSession();
    const modified = {
      ...session,
      tracks: session.tracks.map((v, i) =>
        i === 0 ? { ...v, params: { ...v.params, timbre: 0.8 } } : v,
      ),
    };
    // Strip timeSignature to simulate legacy save
    const { timeSignature: _, ...transportWithoutTs } = modified.transport;
    const legacy = { ...modified, transport: transportWithoutTs as typeof modified.transport };
    saveSession(legacy);
    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.transport.timeSignature).toEqual({ numerator: 4, denominator: 4 });
  });

  it('preserves custom timeSignature through save/load', () => {
    const session = createSession();
    const modified = {
      ...session,
      transport: {
        ...session.transport,
        timeSignature: { numerator: 3, denominator: 4 },
      },
      tracks: session.tracks.map((v, i) =>
        i === 0 ? { ...v, params: { ...v.params, timbre: 0.8 } } : v,
      ),
    };
    saveSession(modified);
    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.transport.timeSignature).toEqual({ numerator: 3, denominator: 4 });
  });
});
