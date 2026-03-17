// src/engine/primitives.ts
import type {
  Session, ParamSnapshot, PatternSnapshot, Snapshot, UndoEntry,
  SynthParamValues, ActionGroupSnapshot,
} from './types';
import { getTrack, getActivePattern, updateTrack } from './types';
import type { StepGridSketch, Step } from './sequencer-types';
import { reprojectTrackStepGrid } from './region-projection';
import { stepsToEvents } from './event-conversion';
import { normalizePatternEvents } from './region-helpers';
import { runtimeParamToControlId } from '../audio/instrument-registry';

function clampParam(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function applyMove(
  session: Session,
  trackId: string,
  param: string,
  target: { absolute: number } | { relative: number },
): Session {
  const track = getTrack(session, trackId);
  const currentValue = track.params[param] ?? 0;
  const newValue = 'absolute' in target ? target.absolute : currentValue + target.relative;
  const clamped = clampParam(newValue);

  const snapshot: ParamSnapshot = {
    kind: 'param',
    trackId,
    prevValues: { [param]: currentValue },
    aiTargetValues: { [param]: clamped },
    timestamp: Date.now(),
    description: `AI move: ${param} ${currentValue.toFixed(2)} -> ${clamped.toFixed(2)}`,
  };

  return {
    ...updateTrack(session, trackId, {
      params: { ...track.params, [param]: clamped },
    }),
    undoStack: [...session.undoStack, snapshot],
  };
}

export function applyMoveGroup(
  session: Session,
  trackId: string,
  moves: { param: string; target: { absolute: number } | { relative: number } }[],
): Session {
  const track = getTrack(session, trackId);
  const prevValues: Partial<SynthParamValues> = {};
  const aiTargetValues: Partial<SynthParamValues> = {};
  const descriptions: string[] = [];

  for (const move of moves) {
    const cur = track.params[move.param] ?? 0;
    prevValues[move.param] = cur;
    const nv = clampParam('absolute' in move.target ? move.target.absolute : cur + move.target.relative);
    aiTargetValues[move.param] = nv;
    descriptions.push(`${move.param} ${cur.toFixed(2)} -> ${nv.toFixed(2)}`);
  }

  const snapshot: ParamSnapshot = {
    kind: 'param',
    trackId,
    prevValues,
    aiTargetValues,
    timestamp: Date.now(),
    description: `AI group: ${descriptions.join(', ')}`,
  };

  const newParams = { ...track.params };
  for (const move of moves) {
    const currentValue = newParams[move.param] ?? 0;
    const newValue = 'absolute' in move.target ? move.target.absolute : currentValue + move.target.relative;
    newParams[move.param] = clampParam(newValue);
  }

  return {
    ...updateTrack(session, trackId, { params: newParams }),
    undoStack: [...session.undoStack, snapshot],
  };
}

export function applyParamDirect(
  session: Session,
  trackId: string,
  param: string,
  value: number,
): Session {
  const track = getTrack(session, trackId);
  return updateTrack(session, trackId, {
    params: { ...track.params, [param]: clampParam(value) },
  });
}

export function applySketch(
  session: Session,
  trackId: string,
  description: string,
  sketch: StepGridSketch,
): Session {
  const track = getTrack(session, trackId);
  const prevSteps: { index: number; step: Step }[] = [];
  const newSteps = [...track.stepGrid.steps];
  let newLength = track.stepGrid.length;
  const prevLength = sketch.length !== undefined && sketch.length !== track.stepGrid.length
    ? track.stepGrid.length
    : undefined;

  if (sketch.length !== undefined) {
    const clamped = Math.max(1, Math.min(64, sketch.length));
    newLength = clamped;
    while (newSteps.length < clamped) {
      newSteps.push({ gate: false, accent: false, micro: 0 });
    }
  }

  for (const stepSketch of sketch.steps) {
    if (stepSketch.index < 0 || stepSketch.index >= newSteps.length) continue;
    prevSteps.push({ index: stepSketch.index, step: { ...newSteps[stepSketch.index] } });
    const existing = newSteps[stepSketch.index];
    newSteps[stepSketch.index] = {
      gate: stepSketch.gate ?? existing.gate,
      accent: stepSketch.accent ?? existing.accent,
      micro: stepSketch.micro ?? existing.micro,
      params: stepSketch.params !== undefined
        ? { ...existing.params, ...stepSketch.params }
        : existing.params,
    };
  }

  const snapshot: PatternSnapshot = {
    kind: 'pattern',
    trackId,
    prevSteps,
    prevLength,
    // Capture region events so undo can fully restore them (#209, #214)
    prevEvents: track.patterns.length > 0 ? [...getActivePattern(track).events] : undefined,
    prevHiddenEvents: track._hiddenEvents ? [...track._hiddenEvents] : undefined,
    timestamp: Date.now(),
    description,
  };

  const newPattern = { steps: newSteps, length: newLength };
  let updated = updateTrack(session, trackId, { stepGrid: newPattern });

  // Project pattern steps to canonical events in the active region
  const updatedTrack = getTrack(updated, trackId);
  if (updatedTrack.patterns.length > 0) {
    const activeReg = getActivePattern(updatedTrack);
    const events = stepsToEvents(newSteps.slice(0, newLength), {
      runtimeToCanonical: (k) => runtimeParamToControlId[k] ?? k,
    });
    const region = normalizePatternEvents({
      ...activeReg,
      events,
      duration: newLength,
    });
    updated = updateTrack(updated, trackId, {
      patterns: updatedTrack.patterns.map(r => r.id === activeReg.id ? region : r),
      _patternDirty: true,
    });
  }

  return {
    ...updated,
    undoStack: [...updated.undoStack, snapshot],
  };
}

function revertSnapshot(session: Session, snapshot: Snapshot): Session {
  if (snapshot.kind === 'transport') {
    return { ...session, transport: snapshot.prevTransport };
  }

  if (snapshot.kind === 'model') {
    return updateTrack(session, snapshot.trackId, { model: snapshot.prevModel, engine: snapshot.prevEngine });
  }

  if (snapshot.kind === 'view') {
    return updateTrack(session, snapshot.trackId, { views: snapshot.prevViews });
  }

  if (snapshot.kind === 'processor') {
    return updateTrack(session, snapshot.trackId, { processors: snapshot.prevProcessors });
  }

  if (snapshot.kind === 'processor-state') {
    const track = getTrack(session, snapshot.trackId);
    const processors = (track.processors ?? []).map(p =>
      p.id === snapshot.processorId
        ? { ...p, params: { ...snapshot.prevParams }, model: snapshot.prevModel }
        : p,
    );
    return updateTrack(session, snapshot.trackId, { processors });
  }

  if (snapshot.kind === 'modulator') {
    return updateTrack(session, snapshot.trackId, {
      modulators: snapshot.prevModulators,
      modulations: snapshot.prevModulations,
    });
  }

  if (snapshot.kind === 'modulator-state') {
    const track = getTrack(session, snapshot.trackId);
    const modulators = (track.modulators ?? []).map(m =>
      m.id === snapshot.modulatorId
        ? { ...m, params: { ...snapshot.prevParams }, model: snapshot.prevModel }
        : m,
    );
    return updateTrack(session, snapshot.trackId, { modulators });
  }

  if (snapshot.kind === 'modulation-routing') {
    return updateTrack(session, snapshot.trackId, {
      modulations: snapshot.prevModulations,
    });
  }

  if (snapshot.kind === 'master') {
    return { ...session, master: snapshot.prevMaster };
  }

  if (snapshot.kind === 'surface') {
    return updateTrack(session, snapshot.trackId, { surface: snapshot.prevSurface });
  }

  if (snapshot.kind === 'approval') {
    return updateTrack(session, snapshot.trackId, { approval: snapshot.prevApproval });
  }

  if (snapshot.kind === 'send') {
    return updateTrack(session, snapshot.trackId, { sends: snapshot.prevSends });
  }

  if (snapshot.kind === 'track-property') {
    return updateTrack(session, snapshot.trackId, snapshot.prevProps);
  }

  if (snapshot.kind === 'ab-restore') {
    return {
      ...session,
      tracks: snapshot.prevTracks,
      transport: snapshot.prevTransport,
      master: snapshot.prevMaster,
      context: snapshot.prevContext,
      activeTrackId: snapshot.prevActiveTrackId,
    };
  }

  if (snapshot.kind === 'pattern-crud') {
    const track = getTrack(session, snapshot.trackId);
    if (snapshot.action === 'add' || snapshot.action === 'duplicate') {
      // Undo add/duplicate: remove the added region and restore sequence
      const newRegions = track.patterns.filter(r => r.id !== snapshot.addedPatternId);
      return updateTrack(session, snapshot.trackId, {
        patterns: newRegions,
        activePatternId: snapshot.prevActivePatternId,
        ...(snapshot.prevSequence ? { sequence: snapshot.prevSequence } : {}),
        _patternDirty: true,
      });
    }
    if (snapshot.action === 'remove' && snapshot.removedPattern != null && snapshot.removedIndex != null) {
      // Undo remove: re-insert the removed region at its original position and restore sequence
      const newRegions = [...track.patterns];
      const insertAt = Math.min(snapshot.removedIndex, newRegions.length);
      newRegions.splice(insertAt, 0, snapshot.removedPattern);
      return updateTrack(session, snapshot.trackId, {
        patterns: newRegions,
        activePatternId: snapshot.prevActivePatternId,
        ...(snapshot.prevSequence ? { sequence: snapshot.prevSequence } : {}),
        _patternDirty: true,
      });
    }
    if (snapshot.action === 'rename' && snapshot.patternId != null) {
      // Undo rename: restore the previous name
      return updateTrack(session, snapshot.trackId, {
        patterns: track.patterns.map(r =>
          r.id === snapshot.patternId ? { ...r, name: snapshot.previousName } : r,
        ),
      });
    }
    return session;
  }

  if (snapshot.kind === 'track-add') {
    // Undo an add: remove the track
    const newTracks = session.tracks.filter(t => t.id !== snapshot.trackId);
    let newActiveTrackId = session.activeTrackId;
    if (session.activeTrackId === snapshot.trackId && newTracks.length > 0) {
      newActiveTrackId = newTracks[Math.max(0, newTracks.length - 1)].id;
    }
    return { ...session, tracks: newTracks, activeTrackId: newActiveTrackId };
  }

  if (snapshot.kind === 'track-remove') {
    // Undo a remove: re-insert the track at its original position
    let newTracks = [...session.tracks];
    const insertAt = Math.min(snapshot.removedIndex, newTracks.length);
    newTracks.splice(insertAt, 0, snapshot.removedTrack);
    // Restore sends on other tracks that were stripped when the bus was removed
    if (snapshot.affectedSends) {
      for (const { trackId, prevSends } of snapshot.affectedSends) {
        newTracks = newTracks.map(t => t.id === trackId ? { ...t, sends: prevSends } : t);
      }
    }
    return { ...session, tracks: newTracks, activeTrackId: snapshot.prevActiveTrackId };
  }

  if (snapshot.kind === 'pattern-edit') {
    const track = getTrack(session, snapshot.trackId);
    if (track.patterns.length === 0) return session;
    // Find the target region by patternId, or fall back to the active region
    const targetRegionId = snapshot.patternId;
    const targetRegion = targetRegionId
      ? track.patterns.find(r => r.id === targetRegionId) ?? getActivePattern(track)
      : getActivePattern(track);
    const restoredRegion = {
      ...targetRegion,
      events: snapshot.prevEvents,
      ...(snapshot.prevDuration !== undefined ? { duration: snapshot.prevDuration } : {}),
    };
    const updatedTrack = reprojectTrackStepGrid({
      ...track,
      patterns: track.patterns.map(r => r.id === targetRegion.id ? restoredRegion : r),
    });
    const updates: Partial<import('./types').Track> = {
      patterns: updatedTrack.patterns,
      stepGrid: updatedTrack.stepGrid,
      _patternDirty: true,
    };
    if ('prevHiddenEvents' in snapshot) {
      updates._hiddenEvents = snapshot.prevHiddenEvents;
    }
    return updateTrack(session, snapshot.trackId, updates);
  }

  if (snapshot.kind === 'pattern') {
    const track = getTrack(session, snapshot.trackId);
    const newSteps = [...track.stepGrid.steps];
    for (const { index, step } of snapshot.prevSteps) {
      if (index < newSteps.length) {
        newSteps[index] = step;
      }
    }
    const newLength = snapshot.prevLength ?? track.stepGrid.length;
    const updates: Partial<import('./types').Track> = {
      stepGrid: { steps: newSteps, length: newLength },
    };

    // Restore region events if they were captured (#209, #214)
    if (snapshot.prevEvents && track.patterns.length > 0) {
      const activeReg = getActivePattern(track);
      const restoredRegion = {
        ...activeReg,
        events: snapshot.prevEvents,
        ...(snapshot.prevLength !== undefined ? { duration: newLength } : {}),
      };
      const updatedTrack = reprojectTrackStepGrid({
        ...track,
        patterns: track.patterns.map(r => r.id === activeReg.id ? restoredRegion : r),
      });
      updates.patterns = updatedTrack.patterns;
      updates.stepGrid = updatedTrack.stepGrid;
      updates._patternDirty = true;
    } else if (track.patterns.length > 0) {
      // Old snapshot without prevEvents: best-effort region sync from restored steps.
      const activeReg = getActivePattern(track);
      const events = stepsToEvents(newSteps.slice(0, newLength), {
        runtimeToCanonical: (k) => runtimeParamToControlId[k] ?? k,
      });
      const region = normalizePatternEvents({
        ...activeReg,
        events,
        ...(snapshot.prevLength !== undefined ? { duration: newLength } : {}),
      });
      updates.patterns = track.patterns.map(r => r.id === activeReg.id ? region : r);
      updates._patternDirty = true;
    }

    // Restore hidden events if captured (#210)
    if ('prevHiddenEvents' in snapshot) {
      updates._hiddenEvents = snapshot.prevHiddenEvents;
    }

    return updateTrack(session, snapshot.trackId, updates);
  }

  // ParamSnapshot
  const track = getTrack(session, snapshot.trackId);
  const newParams = { ...track.params };
  for (const [param, prevValue] of Object.entries(snapshot.prevValues)) {
    const aiTarget = snapshot.aiTargetValues[param];
    const currentValue = newParams[param];
    if (aiTarget !== undefined && Math.abs(currentValue - aiTarget) < 0.001) {
      newParams[param] = prevValue as number;
    }
  }

  const updates: Partial<import('./types').Track> = { params: newParams };
  if (snapshot.prevProvenance && track.controlProvenance) {
    const restoredProvenance = Object.fromEntries(
      Object.entries({
        ...track.controlProvenance,
        ...snapshot.prevProvenance,
      }).filter(([, value]) => value !== undefined),
    ) as import('./canonical-types').ControlState;
    updates.controlProvenance = {
      ...restoredProvenance,
    };
  }

  return updateTrack(session, snapshot.trackId, updates);
}

/**
 * Capture a reverse snapshot: given a snapshot about to be reverted,
 * record the current state so we can redo (re-apply) it later.
 * The reverse snapshot has the same kind/description but stores
 * the current values as prev* fields.
 */
function captureReverseSnapshot(session: Session, snapshot: Snapshot): Snapshot {
  const now = Date.now();

  if (snapshot.kind === 'param') {
    const track = getTrack(session, snapshot.trackId);
    const prevValues: Partial<SynthParamValues> = {};
    const aiTargetValues: Partial<SynthParamValues> = {};
    for (const param of Object.keys(snapshot.prevValues)) {
      prevValues[param] = track.params[param] ?? 0;
      aiTargetValues[param] = track.params[param] ?? 0;  // current value = what the AI set
    }
    return { ...snapshot, prevValues, aiTargetValues, timestamp: now };
  }

  if (snapshot.kind === 'pattern') {
    const track = getTrack(session, snapshot.trackId);
    const prevSteps = snapshot.prevSteps.map(({ index }) => ({
      index,
      step: { ...track.stepGrid.steps[index] },
    }));
    return {
      ...snapshot,
      prevSteps,
      prevLength: snapshot.prevLength !== undefined ? track.stepGrid.length : undefined,
      prevEvents: track.patterns.length > 0 ? [...getActivePattern(track).events] : undefined,
      prevHiddenEvents: track._hiddenEvents ? [...track._hiddenEvents] : undefined,
      timestamp: now,
    };
  }

  if (snapshot.kind === 'pattern-edit') {
    const track = getTrack(session, snapshot.trackId);
    if (track.patterns.length === 0) return { ...snapshot, timestamp: now };
    // Use the region targeted by the snapshot, not the active region
    const targetRegion = snapshot.patternId
      ? track.patterns.find(r => r.id === snapshot.patternId) ?? getActivePattern(track)
      : getActivePattern(track);
    return {
      ...snapshot,
      prevEvents: [...targetRegion.events],
      prevDuration: targetRegion.duration,
      prevHiddenEvents: track._hiddenEvents ? [...track._hiddenEvents] : undefined,
      timestamp: now,
    };
  }

  if (snapshot.kind === 'transport') {
    return { ...snapshot, prevTransport: { ...session.transport }, timestamp: now };
  }

  if (snapshot.kind === 'model') {
    const track = getTrack(session, snapshot.trackId);
    return { ...snapshot, prevModel: track.model, prevEngine: track.engine, timestamp: now };
  }

  if (snapshot.kind === 'view') {
    const track = getTrack(session, snapshot.trackId);
    return { ...snapshot, prevViews: [...(track.views ?? [])], timestamp: now };
  }

  if (snapshot.kind === 'processor') {
    const track = getTrack(session, snapshot.trackId);
    return { ...snapshot, prevProcessors: [...(track.processors ?? [])], timestamp: now };
  }

  if (snapshot.kind === 'processor-state') {
    const track = getTrack(session, snapshot.trackId);
    const proc = (track.processors ?? []).find(p => p.id === snapshot.processorId);
    return {
      ...snapshot,
      prevParams: proc ? { ...proc.params } : { ...snapshot.prevParams },
      prevModel: proc ? proc.model : snapshot.prevModel,
      timestamp: now,
    };
  }

  if (snapshot.kind === 'modulator') {
    const track = getTrack(session, snapshot.trackId);
    return {
      ...snapshot,
      prevModulators: [...(track.modulators ?? [])],
      prevModulations: [...(track.modulations ?? [])],
      timestamp: now,
    };
  }

  if (snapshot.kind === 'modulator-state') {
    const track = getTrack(session, snapshot.trackId);
    const mod = (track.modulators ?? []).find(m => m.id === snapshot.modulatorId);
    return {
      ...snapshot,
      prevParams: mod ? { ...mod.params } : { ...snapshot.prevParams },
      prevModel: mod ? mod.model : snapshot.prevModel,
      timestamp: now,
    };
  }

  if (snapshot.kind === 'modulation-routing') {
    const track = getTrack(session, snapshot.trackId);
    return { ...snapshot, prevModulations: [...(track.modulations ?? [])], timestamp: now };
  }

  if (snapshot.kind === 'master') {
    return { ...snapshot, prevMaster: { ...session.master }, timestamp: now };
  }

  if (snapshot.kind === 'surface') {
    const track = getTrack(session, snapshot.trackId);
    return { ...snapshot, prevSurface: { ...track.surface }, timestamp: now };
  }

  if (snapshot.kind === 'approval') {
    const track = getTrack(session, snapshot.trackId);
    return { ...snapshot, prevApproval: track.approval ?? 'exploratory', timestamp: now };
  }

  if (snapshot.kind === 'send') {
    const track = getTrack(session, snapshot.trackId);
    return { ...snapshot, prevSends: [...(track.sends ?? [])], timestamp: now };
  }

  if (snapshot.kind === 'track-property') {
    const track = getTrack(session, snapshot.trackId);
    const prevProps: Partial<import('./types').Track> = {};
    for (const key of Object.keys(snapshot.prevProps)) {
      (prevProps as Record<string, unknown>)[key] = (track as Record<string, unknown>)[key];
    }
    return { ...snapshot, prevProps, timestamp: now };
  }

  if (snapshot.kind === 'ab-restore') {
    return {
      ...snapshot,
      prevTracks: session.tracks,
      prevTransport: { ...session.transport },
      prevMaster: { ...session.master },
      prevContext: { ...session.context },
      prevActiveTrackId: session.activeTrackId,
      timestamp: now,
    };
  }

  if (snapshot.kind === 'pattern-crud') {
    const track = getTrack(session, snapshot.trackId);
    if (snapshot.action === 'add' || snapshot.action === 'duplicate') {
      // Reverse of add is remove
      const addedRegion = track.patterns.find(r => r.id === snapshot.addedPatternId);
      const addedIndex = track.patterns.findIndex(r => r.id === snapshot.addedPatternId);
      return {
        ...snapshot,
        action: 'remove' as const,
        removedPattern: addedRegion ? { ...addedRegion, events: addedRegion.events.map(e => ({ ...e })) } : undefined,
        removedIndex: addedIndex >= 0 ? addedIndex : undefined,
        addedPatternId: undefined,
        prevActivePatternId: track.activePatternId,
        prevSequence: [...track.sequence],
        timestamp: now,
      };
    }
    if (snapshot.action === 'remove') {
      // Reverse of remove is add
      return {
        ...snapshot,
        action: 'add' as const,
        addedPatternId: snapshot.removedPattern?.id,
        removedPattern: undefined,
        removedIndex: undefined,
        prevActivePatternId: track.activePatternId,
        prevSequence: [...track.sequence],
        timestamp: now,
      };
    }
    if (snapshot.action === 'rename' && snapshot.patternId) {
      // Reverse of rename: capture current name so redo can restore it
      const region = track.patterns.find(r => r.id === snapshot.patternId);
      return {
        ...snapshot,
        previousName: region?.name,
        timestamp: now,
      };
    }
    return { ...snapshot, timestamp: now };
  }

  if (snapshot.kind === 'track-add') {
    // Reverse of add is remove — capture the added track so redo can re-add it
    const track = session.tracks.find(t => t.id === snapshot.trackId);
    if (track) {
      const idx = session.tracks.findIndex(t => t.id === snapshot.trackId);
      return {
        kind: 'track-remove' as const,
        removedTrack: { ...track },
        removedIndex: idx,
        prevActiveTrackId: session.activeTrackId,
        timestamp: now,
        description: snapshot.description,
      };
    }
    return { ...snapshot, timestamp: now };
  }

  if (snapshot.kind === 'track-remove') {
    // Reverse of remove is add — the trackId is enough to know what to remove on redo
    return {
      kind: 'track-add' as const,
      trackId: snapshot.removedTrack.id,
      timestamp: now,
      description: snapshot.description,
    };
  }

  return { ...snapshot, timestamp: now };
}

function captureReverseEntry(session: Session, entry: UndoEntry): UndoEntry {
  if (entry.kind === 'group') {
    return {
      ...entry,
      snapshots: entry.snapshots.map(s => captureReverseSnapshot(session, s)),
      timestamp: Date.now(),
    };
  }
  return captureReverseSnapshot(session, entry);
}

export function applyUndo(session: Session): Session {
  if (session.undoStack.length === 0) return session;

  const newStack = [...session.undoStack];
  const entry = newStack.pop()!;

  // Capture reverse entry before reverting so redo can restore current state
  const reverseEntry = captureReverseEntry(session, entry);

  if (entry.kind === 'group') {
    let result = session;
    // Revert in reverse order
    for (let i = entry.snapshots.length - 1; i >= 0; i--) {
      result = revertSnapshot(result, entry.snapshots[i]);
    }
    return { ...result, undoStack: newStack, redoStack: [...session.redoStack, reverseEntry] };
  }

  return { ...revertSnapshot(session, entry), undoStack: newStack, redoStack: [...session.redoStack, reverseEntry] };
}

export function applyRedo(session: Session): Session {
  if (session.redoStack.length === 0) return session;

  const newRedoStack = [...session.redoStack];
  const entry = newRedoStack.pop()!;

  // Capture reverse entry before reverting so undo can restore current state
  const reverseEntry = captureReverseEntry(session, entry);

  if (entry.kind === 'group') {
    let result = session;
    for (let i = entry.snapshots.length - 1; i >= 0; i--) {
      result = revertSnapshot(result, entry.snapshots[i]);
    }
    return { ...result, undoStack: [...session.undoStack, reverseEntry], redoStack: newRedoStack };
  }

  return { ...revertSnapshot(session, entry), undoStack: [...session.undoStack, reverseEntry], redoStack: newRedoStack };
}
