// tests/engine/metadata-undo.test.ts
// Contract tests: AI track-metadata actions (set_importance) must be undoable.
// Human-UI importance/role changes must also be undoable.
// These tests must FAIL if metadata writes stop participating in undo.
import { describe, it, expect, vi } from 'vitest';
import { executeOperations } from '../../src/engine/operation-executor';
import { applyUndo } from '../../src/engine/primitives';
import { createSession, setTrackImportance } from '../../src/engine/session';
import { Arbitrator } from '../../src/engine/arbitration';
import type { AIAction, Snapshot, ActionGroupSnapshot, TrackPropertySnapshot } from '../../src/engine/types';
import type { SourceAdapter } from '../../src/engine/canonical-types';

function createTestAdapter(): SourceAdapter {
  return {
    id: 'test',
    name: 'Test Adapter',
    mapControl(controlId: string) {
      const map: Record<string, string> = { frequency: 'note' };
      return { adapterId: 'test', path: `params.${map[controlId] ?? controlId}` };
    },
    mapRuntimeParamKey(paramKey: string) {
      const map: Record<string, string> = { note: 'frequency' };
      const known = new Set(['timbre', 'harmonics', 'morph']);
      if (map[paramKey]) return map[paramKey];
      if (known.has(paramKey)) return paramKey;
      return null;
    },
    applyControlChanges() {},
    mapEvents() { return []; },
    readControlState() { return {}; },
    readRegions() { return []; },
    getControlSchemas() { return []; },
    validateOperation() { return { valid: true }; },
    midiToNormalisedPitch(midi: number) { return midi / 127; },
    normalisedPitchToMidi(n: number) { return Math.round(n * 127); },
  };
}

const adapter = createTestAdapter();

function makeArbitrator() {
  const arb = new Arbitrator();
  vi.spyOn(arb, 'canAIAct').mockReturnValue(true);
  return arb;
}

function setupSession() {
  return createSession();
}

/** Helper: extract flat snapshots from an undo entry (handles groups). */
function flatSnapshots(entry: Snapshot | ActionGroupSnapshot): Snapshot[] {
  if (entry.kind === 'group') return (entry as ActionGroupSnapshot).snapshots;
  return [entry as Snapshot];
}

describe('AI track-metadata undo contract', () => {
  // --- Undoable ---

  it('set_importance pushes an undo snapshot', () => {
    const session = setupSession();
    const actions: AIAction[] = [
      { type: 'set_importance', trackId: 'v0', importance: 0.9 },
    ];
    const report = executeOperations(session, actions, adapter, makeArbitrator());
    expect(report.accepted).toHaveLength(1);

    // Must have pushed exactly one new undo entry
    const newEntries = report.session.undoStack.length - session.undoStack.length;
    expect(newEntries).toBeGreaterThanOrEqual(1);
  });

  it('undo reverts importance to previous value', () => {
    const session = setupSession();
    const track = session.tracks.find(t => t.id === 'v0')!;
    const originalImportance = track.importance; // undefined initially

    const actions: AIAction[] = [
      { type: 'set_importance', trackId: 'v0', importance: 0.8 },
    ];
    const report = executeOperations(session, actions, adapter, makeArbitrator());
    expect(report.session.tracks.find(t => t.id === 'v0')!.importance).toBe(0.8);

    const undone = applyUndo(report.session);
    expect(undone.tracks.find(t => t.id === 'v0')!.importance).toBe(originalImportance);
  });

  it('undo reverts musicalRole to previous value', () => {
    const session = setupSession();
    const track = session.tracks.find(t => t.id === 'v0')!;
    const originalRole = track.musicalRole; // undefined initially

    const actions: AIAction[] = [
      { type: 'set_importance', trackId: 'v0', importance: 0.7, musicalRole: 'driving bass' },
    ];
    const report = executeOperations(session, actions, adapter, makeArbitrator());
    const updated = report.session.tracks.find(t => t.id === 'v0')!;
    expect(updated.importance).toBe(0.7);
    expect(updated.musicalRole).toBe('driving bass');

    const undone = applyUndo(report.session);
    const reverted = undone.tracks.find(t => t.id === 'v0')!;
    expect(reverted.importance).toBe(originalRole); // both were undefined
    expect(reverted.musicalRole).toBe(originalRole);
  });

  it('undo reverts importance after multiple set_importance calls', () => {
    let session = setupSession();

    // First set
    const actions1: AIAction[] = [
      { type: 'set_importance', trackId: 'v0', importance: 0.5, musicalRole: 'pad' },
    ];
    const report1 = executeOperations(session, actions1, adapter, makeArbitrator());
    session = report1.session;

    // Second set
    const actions2: AIAction[] = [
      { type: 'set_importance', trackId: 'v0', importance: 0.9, musicalRole: 'lead' },
    ];
    const report2 = executeOperations(session, actions2, adapter, makeArbitrator());
    session = report2.session;

    expect(session.tracks.find(t => t.id === 'v0')!.importance).toBe(0.9);
    expect(session.tracks.find(t => t.id === 'v0')!.musicalRole).toBe('lead');

    // Undo second set
    session = applyUndo(session);
    expect(session.tracks.find(t => t.id === 'v0')!.importance).toBe(0.5);
    expect(session.tracks.find(t => t.id === 'v0')!.musicalRole).toBe('pad');

    // Undo first set
    session = applyUndo(session);
    expect(session.tracks.find(t => t.id === 'v0')!.importance).toBeUndefined();
    expect(session.tracks.find(t => t.id === 'v0')!.musicalRole).toBeUndefined();
  });

  // --- Grouped with other actions ---

  it('set_importance groups with other actions in a single undo entry', () => {
    const session = setupSession();
    const actions: AIAction[] = [
      { type: 'set_importance', trackId: 'v0', importance: 0.6 },
      { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.5 } },
    ];
    const report = executeOperations(session, actions, adapter, makeArbitrator());
    expect(report.accepted).toHaveLength(2);

    // Should be grouped into a single undo entry
    const newEntries = report.session.undoStack.length - session.undoStack.length;
    expect(newEntries).toBe(1);
    expect(report.session.undoStack[report.session.undoStack.length - 1].kind).toBe('group');

    // Undo should revert both
    const undone = applyUndo(report.session);
    expect(undone.tracks.find(t => t.id === 'v0')!.importance).toBeUndefined();
  });

  // --- Bounded ---

  it('set_importance clamps value to 0-1 range', () => {
    const session = setupSession();

    const overActions: AIAction[] = [
      { type: 'set_importance', trackId: 'v0', importance: 1.5 },
    ];
    const overReport = executeOperations(session, overActions, adapter, makeArbitrator());
    expect(overReport.session.tracks.find(t => t.id === 'v0')!.importance).toBe(1);

    const underActions: AIAction[] = [
      { type: 'set_importance', trackId: 'v0', importance: -0.5 },
    ];
    const underReport = executeOperations(session, underActions, adapter, makeArbitrator());
    expect(underReport.session.tracks.find(t => t.id === 'v0')!.importance).toBe(0);
  });

  // --- Consistency with mark_approved ---

  it('mark_approved and set_importance both produce undo snapshots', () => {
    const session = setupSession();
    const actions: AIAction[] = [
      { type: 'mark_approved', trackId: 'v0', level: 'liked', reason: 'test' },
      { type: 'set_importance', trackId: 'v0', importance: 0.8 },
    ];
    const report = executeOperations(session, actions, adapter, makeArbitrator());
    expect(report.accepted).toHaveLength(2);

    // Both should be undoable in a single group
    const top = report.session.undoStack[report.session.undoStack.length - 1];
    const snaps = flatSnapshots(top);
    // At least 2 snapshots: one for approval, one for importance
    expect(snaps.length).toBeGreaterThanOrEqual(2);

    // Undo should revert both
    const undone = applyUndo(report.session);
    // mark_approved stores prevApproval as track.approval ?? 'exploratory', so undo restores 'exploratory'
    expect(undone.tracks.find(t => t.id === 'v0')!.approval).toBe('exploratory');
    expect(undone.tracks.find(t => t.id === 'v0')!.importance).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Human-UI importance/role undo contract
// ---------------------------------------------------------------------------
// These tests simulate the same undo pattern used by App.tsx handleSetImportance
// and handleSetMusicalRole: push a TrackPropertySnapshot, then call setTrackImportance.

/** Simulate the human-UI handler: capture prev, mutate, push snapshot. */
function humanSetImportance(session: ReturnType<typeof createSession>, trackId: string, importance: number) {
  const track = session.tracks.find(t => t.id === trackId)!;
  const clamped = Math.max(0, Math.min(1, importance));
  const snapshot: TrackPropertySnapshot = {
    kind: 'track-property',
    trackId,
    prevProps: { importance: track.importance, musicalRole: track.musicalRole },
    timestamp: Date.now(),
    description: `Set importance: ${track.importance ?? 'unset'} → ${clamped}`,
  };
  const next = setTrackImportance(session, trackId, importance);
  return { ...next, undoStack: [...next.undoStack, snapshot] };
}

function humanSetMusicalRole(session: ReturnType<typeof createSession>, trackId: string, role: string) {
  const track = session.tracks.find(t => t.id === trackId)!;
  const snapshot: TrackPropertySnapshot = {
    kind: 'track-property',
    trackId,
    prevProps: { importance: track.importance, musicalRole: track.musicalRole },
    timestamp: Date.now(),
    description: `Set musical role: ${track.musicalRole ?? 'unset'} → ${role}`,
  };
  const next = setTrackImportance(session, trackId, undefined, role);
  return { ...next, undoStack: [...next.undoStack, snapshot] };
}

describe('Human-UI importance/role undo contract', () => {
  it('human importance change pushes an undo snapshot', () => {
    const session = setupSession();
    const stackBefore = session.undoStack.length;
    const after = humanSetImportance(session, 'v0', 0.75);
    expect(after.undoStack.length).toBe(stackBefore + 1);
    expect(after.tracks.find(t => t.id === 'v0')!.importance).toBe(0.75);
  });

  it('undo reverts human importance change', () => {
    const session = setupSession();
    const after = humanSetImportance(session, 'v0', 0.8);
    expect(after.tracks.find(t => t.id === 'v0')!.importance).toBe(0.8);

    const undone = applyUndo(after);
    expect(undone.tracks.find(t => t.id === 'v0')!.importance).toBeUndefined();
  });

  it('human musical role change pushes an undo snapshot', () => {
    const session = setupSession();
    const stackBefore = session.undoStack.length;
    const after = humanSetMusicalRole(session, 'v0', 'bass');
    expect(after.undoStack.length).toBe(stackBefore + 1);
    expect(after.tracks.find(t => t.id === 'v0')!.musicalRole).toBe('bass');
  });

  it('undo reverts human musical role change', () => {
    const session = setupSession();
    const after = humanSetMusicalRole(session, 'v0', 'lead');
    expect(after.tracks.find(t => t.id === 'v0')!.musicalRole).toBe('lead');

    const undone = applyUndo(after);
    expect(undone.tracks.find(t => t.id === 'v0')!.musicalRole).toBeUndefined();
  });

  it('undo reverts multiple sequential human changes in LIFO order', () => {
    let session = setupSession();

    session = humanSetImportance(session, 'v0', 0.5);
    session = humanSetMusicalRole(session, 'v0', 'pad');
    session = humanSetImportance(session, 'v0', 0.9);

    expect(session.tracks.find(t => t.id === 'v0')!.importance).toBe(0.9);

    // Undo third change (importance 0.9 -> 0.5)
    session = applyUndo(session);
    expect(session.tracks.find(t => t.id === 'v0')!.importance).toBe(0.5);
    expect(session.tracks.find(t => t.id === 'v0')!.musicalRole).toBe('pad');

    // Undo second change (role 'pad' -> undefined)
    session = applyUndo(session);
    expect(session.tracks.find(t => t.id === 'v0')!.musicalRole).toBeUndefined();
    expect(session.tracks.find(t => t.id === 'v0')!.importance).toBe(0.5);

    // Undo first change (importance 0.5 -> undefined)
    session = applyUndo(session);
    expect(session.tracks.find(t => t.id === 'v0')!.importance).toBeUndefined();
  });

  it('human importance change clamps to 0-1 range', () => {
    const session = setupSession();
    const over = humanSetImportance(session, 'v0', 1.5);
    expect(over.tracks.find(t => t.id === 'v0')!.importance).toBe(1);

    const under = humanSetImportance(session, 'v0', -0.3);
    expect(under.tracks.find(t => t.id === 'v0')!.importance).toBe(0);
  });
});
