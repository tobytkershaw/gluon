// src/engine/view-primitives.ts
import type { Session, SequencerViewKind, SequencerViewConfig, ViewSnapshot } from './types';
import { updateVoice, getVoice } from './types';

let viewCounter = 0;

function nextViewId(kind: SequencerViewKind): string {
  return `${kind}-${++viewCounter}`;
}

/** Add a sequencer view to a voice. Pushes ViewSnapshot for undo. */
export function addView(session: Session, voiceId: string, kind: SequencerViewKind): Session {
  const voice = getVoice(session, voiceId);
  const views = voice.views ?? [];
  const snapshot: ViewSnapshot = {
    kind: 'view',
    voiceId,
    prevViews: [...views],
    timestamp: Date.now(),
    description: `Add ${kind} view`,
  };
  const newView: SequencerViewConfig = { kind, id: nextViewId(kind) };
  const result = updateVoice(session, voiceId, { views: [...views, newView] });
  return { ...result, undoStack: [...result.undoStack, snapshot] };
}

/** Remove a sequencer view from a voice by ID. Pushes ViewSnapshot for undo. */
export function removeView(session: Session, voiceId: string, viewId: string): Session {
  const voice = getVoice(session, voiceId);
  const views = voice.views ?? [];
  const filtered = views.filter(v => v.id !== viewId);
  if (filtered.length === views.length) return session; // nothing matched
  const snapshot: ViewSnapshot = {
    kind: 'view',
    voiceId,
    prevViews: [...views],
    timestamp: Date.now(),
    description: `Remove view`,
  };
  const result = updateVoice(session, voiceId, { views: filtered });
  return { ...result, undoStack: [...result.undoStack, snapshot] };
}
