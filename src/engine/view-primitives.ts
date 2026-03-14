// src/engine/view-primitives.ts
import type { Session, SequencerViewKind, SequencerViewConfig, ViewSnapshot } from './types';
import { updateTrack, getTrack } from './types';

function nextViewId(kind: SequencerViewKind): string {
  return `${kind}-${crypto.randomUUID()}`;
}

/** Add a sequencer view to a track. Pushes ViewSnapshot for undo. */
export function addView(session: Session, trackId: string, kind: SequencerViewKind): Session {
  const track = getTrack(session, trackId);
  const views = track.views ?? [];
  const snapshot: ViewSnapshot = {
    kind: 'view',
    trackId,
    prevViews: [...views],
    timestamp: Date.now(),
    description: `Add ${kind} view`,
  };
  const newView: SequencerViewConfig = { kind, id: nextViewId(kind) };
  const result = updateTrack(session, trackId, { views: [...views, newView] });
  return { ...result, undoStack: [...result.undoStack, snapshot] };
}

/** Remove a sequencer view from a track by ID. Pushes ViewSnapshot for undo. */
export function removeView(session: Session, trackId: string, viewId: string): Session {
  const track = getTrack(session, trackId);
  const views = track.views ?? [];
  const filtered = views.filter(v => v.id !== viewId);
  if (filtered.length === views.length) return session; // nothing matched
  const snapshot: ViewSnapshot = {
    kind: 'view',
    trackId,
    prevViews: [...views],
    timestamp: Date.now(),
    description: `Remove view`,
  };
  const result = updateTrack(session, trackId, { views: filtered });
  return { ...result, undoStack: [...result.undoStack, snapshot] };
}
