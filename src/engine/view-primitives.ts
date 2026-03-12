// src/engine/view-primitives.ts
import type { Session, SequencerViewKind, SequencerViewConfig } from './types';
import { updateVoice, getVoice } from './types';

let viewCounter = 0;

function nextViewId(kind: SequencerViewKind): string {
  return `${kind}-${++viewCounter}`;
}

/** Add a sequencer view to a voice. Presentation state only — no undo snapshot. */
export function addView(session: Session, voiceId: string, kind: SequencerViewKind): Session {
  const voice = getVoice(session, voiceId);
  const views = voice.views ?? [];
  const newView: SequencerViewConfig = { kind, id: nextViewId(kind) };
  return updateVoice(session, voiceId, { views: [...views, newView] });
}

/** Remove a sequencer view from a voice by ID. Presentation state only — no undo snapshot. */
export function removeView(session: Session, voiceId: string, viewId: string): Session {
  const voice = getVoice(session, voiceId);
  const views = voice.views ?? [];
  const filtered = views.filter(v => v.id !== viewId);
  if (filtered.length === views.length) return session; // nothing matched
  return updateVoice(session, voiceId, { views: filtered });
}
