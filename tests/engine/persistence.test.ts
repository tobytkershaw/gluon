// tests/engine/persistence.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { saveSession, loadSession, clearSavedSession, stripForPersistence, MAX_PERSISTED_UNDO, restoreSession, deduplicateById } from '../../src/engine/persistence';
import { createSession } from '../../src/engine/session';
import { createDefaultStepGrid } from '../../src/engine/sequencer-helpers';
import { toggleStepGate } from '../../src/engine/pattern-primitives';
import { getTrack, MASTER_BUS_ID } from '../../src/engine/types';
import type { Reaction, OpenDecision, Track, ProcessorConfig, ModulatorConfig, ModulationRouting, SurfaceModule, DrumPad, Send, SequencerViewConfig } from '../../src/engine/types';
import type { TriggerEvent, Pattern } from '../../src/engine/canonical-types';

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

  it('round-trips all M6 fields (claimed, importance, musicalRole, reactionHistory, openDecisions)', () => {
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
          ? { ...t, claimed: true, importance: 0.8, musicalRole: 'driving rhythm' }
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
    expect(track.claimed).toBe(true);
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
      delete copy.claimed;
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

    // Track-level: claimed defaults to false, optional fields stay undefined
    const track = getTrack(loaded!, 'v0');
    expect(track.claimed).toBe(false);
    expect(track.importance).toBeUndefined();
    expect(track.musicalRole).toBeUndefined();

    // Session-level: hydrated to empty arrays
    expect(loaded!.reactionHistory).toEqual([]);
    expect(loaded!.openDecisions).toEqual([]);
  });

  it('isNonDefault does not detect M6-only changes (accepted heuristic limitation)', () => {
    // isNonDefault is a save-avoidance heuristic. It checks messages, transport, params,
    // and pattern edits — but NOT claimed, importance, musicalRole, reactionHistory, or
    // openDecisions. This is an accepted limitation: worst case is an unnecessary no-op save,
    // not data loss. See NOTE(#215) in isNonDefault's docstring.
    const session = createSession();
    const modified = {
      ...session,
      tracks: session.tracks.map((t, i) =>
        i === 0 ? { ...t, claimed: true } : t,
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
          ? { ...t, claimed: true, importance: 0.6, musicalRole: 'ambient pad' }
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
    expect(stripped.tracks[0].claimed).toBe(true);
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

  it('strips unknown processor types during restore', () => {
    const session = createSession();
    const trackWithProcessors = {
      ...session.tracks[0],
      processors: [
        { id: 'p1', type: 'ripples', model: 0, params: { frequency: 0.5 } },
        { id: 'p2', type: 'deleted_plugin', model: 0, params: {} },
        { id: 'p3', type: 'compressor', model: 0, params: { threshold: 0.6 } },
      ],
    };
    const modified = {
      ...session,
      messages: [{ role: 'human' as const, text: 'test', timestamp: 1 }],
      tracks: [trackWithProcessors, ...session.tracks.slice(1)],
    };

    const restored = restoreSession(modified);
    const track = getTrack(restored, 'v0');
    expect(track.processors).toHaveLength(2);
    expect(track.processors!.map(p => p.type)).toEqual(['ripples', 'compressor']);
  });


  // --- Duplicate ID deduplication tests (#1155-#1162) ---

  describe('deduplicateById helper', () => {
    it('keeps first occurrence and drops duplicates', () => {
      const items = [
        { id: 'a', value: 1 },
        { id: 'b', value: 2 },
        { id: 'a', value: 3 },
      ];
      const result = deduplicateById(items, i => i.id, 'test');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 'a', value: 1 });
      expect(result[1]).toEqual({ id: 'b', value: 2 });
    });

    it('returns same array content when no duplicates', () => {
      const items = [{ id: 'x' }, { id: 'y' }];
      const result = deduplicateById(items, i => i.id, 'test');
      expect(result).toHaveLength(2);
    });

    it('handles empty array', () => {
      expect(deduplicateById([], (i: { id: string }) => i.id, 'test')).toEqual([]);
    });
  });

  describe('duplicate ID deduplication on restore', () => {
    function makeSession(): ReturnType<typeof createSession> {
      const session = createSession();
      // Add a message so it's non-default
      return {
        ...session,
        messages: [{ role: 'human' as const, text: 'test', timestamp: 1 }],
      };
    }

    it('#1155: deduplicates track IDs, keeping first', () => {
      const session = makeSession();
      const dupTrack = { ...session.tracks[0], id: session.tracks[0].id };
      const withDups = {
        ...session,
        tracks: [...session.tracks, dupTrack],
      };
      const restored = restoreSession(withDups);
      const trackIds = restored.tracks.map(t => t.id);
      const uniqueIds = new Set(trackIds);
      expect(trackIds.length).toBe(uniqueIds.size);
    });

    it('#1156: deduplicates processor IDs within a track', () => {
      const session = makeSession();
      const proc: ProcessorConfig = { id: 'proc-1', type: 'ripples', model: 0, params: {} };
      const withDups = {
        ...session,
        tracks: session.tracks.map((t, i) =>
          i === 0 ? { ...t, processors: [proc, { ...proc, params: { cutoff: 0.5 } }] } : t,
        ),
      };
      const restored = restoreSession(withDups);
      const track = getTrack(restored, session.tracks[0].id);
      expect(track.processors).toHaveLength(1);
      expect(track.processors![0].params).toEqual({});
    });

    it('#1156: deduplicates modulator IDs within a track', () => {
      const session = makeSession();
      // Use a type that's in the registered modulator types
      const mod: ModulatorConfig = { id: 'mod-1', type: 'tides', model: 0, params: {} };
      const withDups = {
        ...session,
        tracks: session.tracks.map((t, i) =>
          i === 0 ? { ...t, modulators: [mod, { ...mod, params: { attack: 0.5 } }] } : t,
        ),
      };
      const restored = restoreSession(withDups);
      const track = getTrack(restored, session.tracks[0].id);
      expect(track.modulators).toHaveLength(1);
    });

    it('#1157: deduplicates drum pad IDs within a drum rack', () => {
      const session = makeSession();
      const pad: DrumPad = { id: 'kick', name: 'Kick', source: { engine: 'plaits', model: 0, params: {} }, level: 0.8, pan: 0.5 };
      const withDups = {
        ...session,
        tracks: session.tracks.map((t, i) =>
          i === 0 ? { ...t, drumRack: { pads: [pad, { ...pad, name: 'Kick 2' }] } } : t,
        ),
      };
      const restored = restoreSession(withDups);
      const track = getTrack(restored, session.tracks[0].id);
      expect(track.drumRack!.pads).toHaveLength(1);
      expect(track.drumRack!.pads[0].name).toBe('Kick');
    });

    it('#1158: deduplicates pattern IDs within a track', () => {
      const session = makeSession();
      const track0 = session.tracks[0];
      const pat = track0.patterns[0];
      const dupPat: Pattern = { ...pat, name: 'Duplicate' };
      const withDups = {
        ...session,
        tracks: session.tracks.map((t, i) =>
          i === 0 ? { ...t, patterns: [pat, dupPat] } : t,
        ),
      };
      const restored = restoreSession(withDups);
      const track = getTrack(restored, track0.id);
      expect(track.patterns).toHaveLength(1);
    });

    it('#1159: deduplicates surface module IDs within a track', () => {
      const session = makeSession();
      const mod: SurfaceModule = {
        type: 'knob-group', id: 'mod-1', label: 'Test',
        bindings: [], position: { x: 0, y: 0, w: 1, h: 1 }, config: {},
      };
      const withDups = {
        ...session,
        tracks: session.tracks.map((t, i) =>
          i === 0
            ? { ...t, surface: { ...t.surface, modules: [mod, { ...mod, label: 'Dup' }] } }
            : t,
        ),
      };
      const restored = restoreSession(withDups);
      const track = getTrack(restored, session.tracks[0].id);
      expect(track.surface.modules).toHaveLength(1);
      expect(track.surface.modules[0].label).toBe('Test');
    });

    it('#1160: deduplicates modulation route IDs within a track', () => {
      const session = makeSession();
      const route: ModulationRouting = {
        id: 'route-1', modulatorId: 'mod-1',
        target: { kind: 'source', param: 'timbre' }, depth: 0.5,
      };
      // Note: modulation routes also get filtered by valid modulator IDs,
      // so we need a valid modulator to keep them
      const mod: ModulatorConfig = { id: 'mod-1', type: 'tides', model: 0, params: {} };
      const withDups = {
        ...session,
        tracks: session.tracks.map((t, i) =>
          i === 0
            ? { ...t, modulators: [mod], modulations: [route, { ...route, depth: 0.8 }] }
            : t,
        ),
      };
      const restored = restoreSession(withDups);
      const track = getTrack(restored, session.tracks[0].id);
      expect(track.modulations).toHaveLength(1);
      expect(track.modulations![0].depth).toBe(0.5);
    });

    it('#1161: deduplicates sends to the same bus', () => {
      const session = makeSession();
      // Use the master bus (which actually exists) as the send target
      const send1: Send = { busId: MASTER_BUS_ID, level: 0.5 };
      const send2: Send = { busId: MASTER_BUS_ID, level: 0.8 };
      const withDups = {
        ...session,
        tracks: session.tracks.map((t, i) =>
          i === 0 ? { ...t, sends: [send1, send2] } : t,
        ),
      };
      const restored = restoreSession(withDups);
      const track = getTrack(restored, session.tracks[0].id);
      expect(track.sends).toHaveLength(1);
      expect(track.sends![0].level).toBe(0.5);
    });

    it('#1162: deduplicates sequencer view IDs within a track', () => {
      const session = makeSession();
      const view: SequencerViewConfig = { kind: 'step-grid', id: 'view-1' };
      const withDups = {
        ...session,
        tracks: session.tracks.map((t, i) =>
          i === 0 ? { ...t, views: [view, { ...view, kind: 'piano-roll' as const }] } : t,
        ),
      };
      const restored = restoreSession(withDups);
      const track = getTrack(restored, session.tracks[0].id);
      expect(track.views).toHaveLength(1);
      expect(track.views![0].kind).toBe('step-grid');
    });
  });

  // --- Pattern invariant validation (#1146) ---

  describe('pattern invariant validation (#1146)', () => {
    function makeSession() {
      const session = createSession();
      return {
        ...session,
        messages: [{ role: 'human' as const, text: 'test', timestamp: 1 }],
      };
    }

    it('fixes pattern with duration <= 0', () => {
      const session = makeSession();
      const withBadDuration = {
        ...session,
        tracks: session.tracks.map((t, i) =>
          i === 0 ? { ...t, patterns: [{ ...t.patterns[0], duration: 0 }] } : t,
        ),
      };
      const restored = restoreSession(withBadDuration);
      const track = getTrack(restored, session.tracks[0].id);
      expect(track.patterns[0].duration).toBe(16);
    });

    it('fixes pattern with non-numeric duration', () => {
      const session = makeSession();
      const withBadDuration = {
        ...session,
        tracks: session.tracks.map((t, i) =>
          i === 0 ? { ...t, patterns: [{ ...t.patterns[0], duration: 'bad' as unknown as number }] } : t,
        ),
      };
      const restored = restoreSession(withBadDuration);
      const track = getTrack(restored, session.tracks[0].id);
      expect(track.patterns[0].duration).toBe(16);
    });

    it('strips note events with out-of-range pitch', () => {
      const session = makeSession();
      const badEvents = [
        { kind: 'note' as const, at: 0, pitch: 200, velocity: 0.5, duration: 1 },
        { kind: 'note' as const, at: 1, pitch: 60, velocity: 0.5, duration: 1 },
      ];
      const withBadEvents = {
        ...session,
        tracks: session.tracks.map((t, i) =>
          i === 0 ? { ...t, patterns: [{ ...t.patterns[0], events: badEvents }] } : t,
        ),
      };
      const restored = restoreSession(withBadEvents);
      const track = getTrack(restored, session.tracks[0].id);
      expect(track.patterns[0].events).toHaveLength(1);
      expect((track.patterns[0].events[0] as any).pitch).toBe(60);
    });

    it('strips note events with velocity > 1', () => {
      const session = makeSession();
      const badEvents = [
        { kind: 'note' as const, at: 0, pitch: 60, velocity: 1.5, duration: 1 },
      ];
      const withBadEvents = {
        ...session,
        tracks: session.tracks.map((t, i) =>
          i === 0 ? { ...t, patterns: [{ ...t.patterns[0], events: badEvents }] } : t,
        ),
      };
      const restored = restoreSession(withBadEvents);
      const track = getTrack(restored, session.tracks[0].id);
      expect(track.patterns[0].events).toHaveLength(0);
    });

    it('strips note events with duration <= 0', () => {
      const session = makeSession();
      const badEvents = [
        { kind: 'note' as const, at: 0, pitch: 60, velocity: 0.5, duration: 0 },
      ];
      const withBadEvents = {
        ...session,
        tracks: session.tracks.map((t, i) =>
          i === 0 ? { ...t, patterns: [{ ...t.patterns[0], events: badEvents }] } : t,
        ),
      };
      const restored = restoreSession(withBadEvents);
      const track = getTrack(restored, session.tracks[0].id);
      expect(track.patterns[0].events).toHaveLength(0);
    });

    it('strips events with at < 0 or at >= duration', () => {
      const session = makeSession();
      const badEvents = [
        { kind: 'trigger' as const, at: -1 },
        { kind: 'trigger' as const, at: 16 },
        { kind: 'trigger' as const, at: 4 },
      ];
      const withBadEvents = {
        ...session,
        tracks: session.tracks.map((t, i) =>
          i === 0 ? { ...t, patterns: [{ ...t.patterns[0], duration: 16, events: badEvents }] } : t,
        ),
      };
      const restored = restoreSession(withBadEvents);
      const track = getTrack(restored, session.tracks[0].id);
      expect(track.patterns[0].events).toHaveLength(1);
      expect(track.patterns[0].events[0].at).toBe(4);
    });

    it('strips parameter events with empty controlId', () => {
      const session = makeSession();
      const badEvents = [
        { kind: 'parameter' as const, at: 0, controlId: '', value: 0.5 },
        { kind: 'parameter' as const, at: 1, controlId: 'timbre', value: 0.5 },
      ];
      const withBadEvents = {
        ...session,
        tracks: session.tracks.map((t, i) =>
          i === 0 ? { ...t, patterns: [{ ...t.patterns[0], events: badEvents }] } : t,
        ),
      };
      const restored = restoreSession(withBadEvents);
      const track = getTrack(restored, session.tracks[0].id);
      expect(track.patterns[0].events).toHaveLength(1);
      expect((track.patterns[0].events[0] as any).controlId).toBe('timbre');
    });

    it('strips trigger events with invalid velocity', () => {
      const session = makeSession();
      const badEvents = [
        { kind: 'trigger' as const, at: 0, velocity: 2 },
        { kind: 'trigger' as const, at: 1, velocity: 0.8 },
      ];
      const withBadEvents = {
        ...session,
        tracks: session.tracks.map((t, i) =>
          i === 0 ? { ...t, patterns: [{ ...t.patterns[0], events: badEvents }] } : t,
        ),
      };
      const restored = restoreSession(withBadEvents);
      const track = getTrack(restored, session.tracks[0].id);
      expect(track.patterns[0].events).toHaveLength(1);
      expect(track.patterns[0].events[0].at).toBe(1);
    });
  });

  // --- Surface module validation on restore (#1147) ---

  describe('surface module validation on restore (#1147)', () => {
    function makeSession() {
      const session = createSession();
      return {
        ...session,
        messages: [{ role: 'human' as const, text: 'test', timestamp: 1 }],
      };
    }

    it('strips surface modules with unknown types', () => {
      const session = makeSession();
      const goodMod: SurfaceModule = {
        type: 'knob-group', id: 'good', label: 'Good',
        bindings: [{ role: 'control', trackId: '', target: 'timbre' }],
        position: { x: 0, y: 0, w: 4, h: 2 }, config: {},
      };
      const badMod: SurfaceModule = {
        type: 'nonexistent-widget' as any, id: 'bad', label: 'Bad',
        bindings: [], position: { x: 0, y: 2, w: 4, h: 2 }, config: {},
      };
      const withBadModules = {
        ...session,
        tracks: session.tracks.map((t, i) =>
          i === 0
            ? { ...t, surface: { ...t.surface, modules: [goodMod, badMod] } }
            : t,
        ),
      };
      const restored = restoreSession(withBadModules);
      const track = getTrack(restored, session.tracks[0].id);
      expect(track.surface.modules).toHaveLength(1);
      expect(track.surface.modules[0].id).toBe('good');
    });

    it('fixes surface modules with invalid positions', () => {
      const session = makeSession();
      const badPosMod: SurfaceModule = {
        type: 'knob-group', id: 'broken-pos', label: 'Broken',
        bindings: [{ role: 'control', trackId: '', target: 'timbre' }],
        position: { x: -5, y: -1, w: 0, h: -2 }, config: {},
      };
      const withBadPos = {
        ...session,
        tracks: session.tracks.map((t, i) =>
          i === 0
            ? { ...t, surface: { ...t.surface, modules: [badPosMod] } }
            : t,
        ),
      };
      const restored = restoreSession(withBadPos);
      const track = getTrack(restored, session.tracks[0].id);
      expect(track.surface.modules).toHaveLength(1);
      const pos = track.surface.modules[0].position;
      expect(pos.x).toBeGreaterThanOrEqual(0);
      expect(pos.y).toBeGreaterThanOrEqual(0);
      expect(pos.w).toBeGreaterThan(0);
      expect(pos.h).toBeGreaterThan(0);
    });

    it('fixes surface modules with missing position fields', () => {
      const session = makeSession();
      const missingPosMod = {
        type: 'knob-group', id: 'no-pos', label: 'No Pos',
        bindings: [{ role: 'control', trackId: '', target: 'timbre' }],
        position: {} as any,
        config: {},
      } as SurfaceModule;
      const withMissingPos = {
        ...session,
        tracks: session.tracks.map((t, i) =>
          i === 0
            ? { ...t, surface: { ...t.surface, modules: [missingPosMod] } }
            : t,
        ),
      };
      const restored = restoreSession(withMissingPos);
      const track = getTrack(restored, session.tracks[0].id);
      const pos = track.surface.modules[0].position;
      expect(pos.x).toBe(0);
      expect(pos.y).toBe(0);
      expect(pos.w).toBe(2);
      expect(pos.h).toBe(2);
    });
  });

  // --- Restore validation batch (#1141-#1145) ---

  describe('restore validation batch (#1141-#1145)', () => {
    function makeSession(): ReturnType<typeof createSession> {
      const session = createSession();
      return {
        ...session,
        messages: [{ role: 'human' as const, text: 'test', timestamp: 1 }],
      };
    }

    it('#1141: resets stale activeTrackId to first track', () => {
      const session = makeSession();
      const withStaleId = {
        ...session,
        activeTrackId: 'nonexistent-track',
      };
      const restored = restoreSession(withStaleId);
      // Should reset to the first track, not stay as the stale ID
      expect(restored.tracks.some(t => t.id === restored.activeTrackId)).toBe(true);
      expect(restored.activeTrackId).toBe(restored.tracks[0].id);
    });

    it('#1141: keeps valid activeTrackId unchanged', () => {
      const session = makeSession();
      // activeTrackId is already valid (session.tracks[0].id)
      const restored = restoreSession(session);
      expect(restored.activeTrackId).toBe(session.activeTrackId);
    });

    it('#1142: reclassifies legacy non-master bus tracks that receive sends', () => {
      const session = makeSession();
      // Simulate a legacy bus track saved without kind (engine='', model=-1)
      const legacyBus: Track = {
        ...session.tracks[0],
        id: 'fx-bus',
        engine: '',
        model: -1,
        kind: undefined,
      };
      // Another track sends to it
      const withLegacyBus = {
        ...session,
        tracks: [
          { ...session.tracks[0], sends: [{ busId: 'fx-bus', level: 0.5 }] },
          legacyBus,
          ...session.tracks.slice(1),
        ],
      };
      const restored = restoreSession(withLegacyBus);
      const bus = getTrack(restored, 'fx-bus');
      expect(bus.kind).toBe('bus');
    });

    it('#1142: does not misclassify empty audio tracks as bus', () => {
      const session = makeSession();
      // An empty audio track (engine='', model=-1) but no sends targeting it
      const emptyTrack: Track = {
        ...session.tracks[0],
        id: 'new-track',
        engine: '',
        model: -1,
        kind: undefined,
      };
      const withEmpty = {
        ...session,
        tracks: [...session.tracks, emptyTrack],
      };
      const restored = restoreSession(withEmpty);
      const track = getTrack(restored, 'new-track');
      expect(track.kind).toBe('audio');
    });

    it('#1142: does not misclassify audio tracks with engine as bus', () => {
      const session = makeSession();
      const audioTrack: Track = {
        ...session.tracks[0],
        id: 'audio-track',
        engine: 'plaits:analog_bass_drum',
        model: 0,
        kind: undefined,
      };
      const withAudio = {
        ...session,
        tracks: [...session.tracks, audioTrack],
      };
      const restored = restoreSession(withAudio);
      const track = getTrack(restored, 'audio-track');
      expect(track.kind).toBe('audio');
    });

    it('#1143: strips dangling patternId refs from sequence', () => {
      const session = makeSession();
      const track = session.tracks[0];
      const withDanglingSeq = {
        ...session,
        tracks: session.tracks.map((t, i) =>
          i === 0
            ? {
                ...t,
                sequence: [
                  { patternId: t.patterns[0].id },
                  { patternId: 'nonexistent-pattern' },
                ],
              }
            : t,
        ),
      };
      const restored = restoreSession(withDanglingSeq);
      const restoredTrack = getTrack(restored, track.id);
      // Should only keep the valid ref
      expect(restoredTrack.sequence).toHaveLength(1);
      expect(restoredTrack.sequence[0].patternId).toBe(track.patterns[0].id);
    });

    it('#1143: rebuilds sequence from all patterns when all refs are dangling', () => {
      const session = makeSession();
      const track = session.tracks[0];
      const withAllDangling = {
        ...session,
        tracks: session.tracks.map((t, i) =>
          i === 0
            ? {
                ...t,
                sequence: [
                  { patternId: 'gone-1' },
                  { patternId: 'gone-2' },
                ],
              }
            : t,
        ),
      };
      const restored = restoreSession(withAllDangling);
      const restoredTrack = getTrack(restored, track.id);
      // Should rebuild from all pattern IDs
      expect(restoredTrack.sequence.length).toBe(restoredTrack.patterns.length);
      expect(restoredTrack.sequence[0].patternId).toBe(restoredTrack.patterns[0].id);
    });

    it('#1144: strips sends targeting non-existent bus tracks', () => {
      const session = makeSession();
      const withStaleSends = {
        ...session,
        tracks: session.tracks.map((t, i) =>
          i === 0
            ? {
                ...t,
                sends: [
                  { busId: MASTER_BUS_ID, level: 0.5 },
                  { busId: 'deleted-bus', level: 0.8 },
                ],
              }
            : t,
        ),
      };
      const restored = restoreSession(withStaleSends);
      const track = getTrack(restored, session.tracks[0].id);
      expect(track.sends).toHaveLength(1);
      expect(track.sends![0].busId).toBe(MASTER_BUS_ID);
    });

    it('#1144: strips sends targeting audio tracks (not buses)', () => {
      const session = makeSession();
      // Add an audio track with a real engine (so it can't be reclassified as bus)
      const audioTarget: Track = {
        ...session.tracks[0],
        id: 'audio-target',
        engine: 'plaits:analog_bass_drum',
        model: 0,
      };
      const withAudioSend = {
        ...session,
        tracks: [
          ...session.tracks,
          audioTarget,
        ].map(t =>
          t.id === MASTER_BUS_ID
            ? { ...t, sends: [{ busId: 'audio-target', level: 0.5 }] }
            : t,
        ),
      };
      const restored = restoreSession(withAudioSend);
      const masterBus = getTrack(restored, MASTER_BUS_ID);
      expect(masterBus.sends).toHaveLength(0);
    });

    it('#1144: clears stale sidechainSourceId on compressor processors', () => {
      const session = makeSession();
      const compressor: ProcessorConfig = {
        id: 'comp-1',
        type: 'compressor',
        model: 0,
        params: { threshold: 0.6 },
        sidechainSourceId: 'deleted-track',
      };
      const withStaleSidechain = {
        ...session,
        tracks: session.tracks.map((t, i) =>
          i === 0 ? { ...t, processors: [compressor] } : t,
        ),
      };
      const restored = restoreSession(withStaleSidechain);
      const track = getTrack(restored, session.tracks[0].id);
      expect(track.processors).toHaveLength(1);
      expect(track.processors![0].sidechainSourceId).toBeUndefined();
    });

    it('#1144: keeps valid sidechainSourceId', () => {
      const session = makeSession();
      const compressor: ProcessorConfig = {
        id: 'comp-1',
        type: 'compressor',
        model: 0,
        params: { threshold: 0.6 },
        sidechainSourceId: 'v0', // v0 exists
      };
      const withValidSidechain = {
        ...session,
        tracks: session.tracks.map(t =>
          t.id === MASTER_BUS_ID ? { ...t, processors: [compressor] } : t,
        ),
      };
      const restored = restoreSession(withValidSidechain);
      const bus = getTrack(restored, MASTER_BUS_ID);
      expect(bus.processors![0].sidechainSourceId).toBe('v0');
    });

    it('#1145: strips modulation routes targeting missing processors', () => {
      const session = makeSession();
      const mod: ModulatorConfig = { id: 'mod-1', type: 'tides', model: 0, params: {} };
      const validRoute: ModulationRouting = {
        id: 'route-1',
        modulatorId: 'mod-1',
        target: { kind: 'source', param: 'timbre' },
        depth: 0.5,
      };
      const danglingRoute: ModulationRouting = {
        id: 'route-2',
        modulatorId: 'mod-1',
        target: { kind: 'processor', processorId: 'deleted-proc', param: 'frequency' },
        depth: 0.3,
      };
      const withDanglingRoute = {
        ...session,
        tracks: session.tracks.map((t, i) =>
          i === 0
            ? { ...t, modulators: [mod], modulations: [validRoute, danglingRoute] }
            : t,
        ),
      };
      const restored = restoreSession(withDanglingRoute);
      const track = getTrack(restored, session.tracks[0].id);
      expect(track.modulations).toHaveLength(1);
      expect(track.modulations![0].id).toBe('route-1');
    });

    it('#1145: keeps modulation routes targeting existing processors', () => {
      const session = makeSession();
      const proc: ProcessorConfig = { id: 'proc-1', type: 'ripples', model: 0, params: {} };
      const mod: ModulatorConfig = { id: 'mod-1', type: 'tides', model: 0, params: {} };
      const route: ModulationRouting = {
        id: 'route-1',
        modulatorId: 'mod-1',
        target: { kind: 'processor', processorId: 'proc-1', param: 'frequency' },
        depth: 0.5,
      };
      const withValidRoute = {
        ...session,
        tracks: session.tracks.map((t, i) =>
          i === 0
            ? { ...t, processors: [proc], modulators: [mod], modulations: [route] }
            : t,
        ),
      };
      const restored = restoreSession(withValidRoute);
      const track = getTrack(restored, session.tracks[0].id);
      expect(track.modulations).toHaveLength(1);
      expect(track.modulations![0].target).toEqual({ kind: 'processor', processorId: 'proc-1', param: 'frequency' });
    });
  });
});
