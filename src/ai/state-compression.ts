import type { Session } from '../engine/types';

export interface CompressedState {
  voice: {
    engine: string;
    model: number;
    params: Record<string, number>;
    agency: string;
  };
  leash: number;
  context: {
    energy: number;
    density: number;
  };
  pending_count: number;
  undo_depth: number;
  recent_human_actions: string[];
  human_message?: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function compressState(session: Session, humanMessage?: string): CompressedState {
  const result: CompressedState = {
    voice: {
      engine: session.voice.engine,
      model: session.voice.model,
      params: {
        harmonics: round2(session.voice.params.harmonics),
        timbre: round2(session.voice.params.timbre),
        morph: round2(session.voice.params.morph),
        note: round2(session.voice.params.note),
      },
      agency: session.voice.agency,
    },
    leash: round2(session.leash),
    context: {
      energy: round2(session.context.energy),
      density: round2(session.context.density),
    },
    pending_count: session.pending.length,
    undo_depth: session.undoStack.length,
    recent_human_actions: session.recentHumanActions.slice(-5).map(
      (a) => `${a.param}: ${a.from.toFixed(2)} -> ${a.to.toFixed(2)}`
    ),
  };

  if (humanMessage) {
    result.human_message = humanMessage;
  }

  return result;
}
