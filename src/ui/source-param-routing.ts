import type { Track } from '../engine/types';
import { controlIdToRuntimeParam } from '../audio/instrument-registry';

export interface SourceParamHandlers {
  onParamChange: (timbre: number, morph: number) => void;
  onNoteChange: (note: number) => void;
  onHarmonicsChange: (harmonics: number) => void;
  onExtendedSourceParamChange: (runtimeParam: string, value: number) => void;
  /** Handle portamento changes (track-level fields, not params entries). */
  onPortamentoChange?: (field: 'portamentoTime' | 'portamentoMode', value: number | string) => void;
}

/** Control IDs that map to track-level portamento fields, not track.params. */
const PORTAMENTO_CONTROL_IDS: Record<string, 'portamentoTime' | 'portamentoMode'> = {
  'portamento-time': 'portamentoTime',
  'portamento-mode': 'portamentoMode',
};

export function routeSourceModuleParam(
  controlId: string,
  value: number,
  track: Track,
  handlers: SourceParamHandlers,
): void {
  // Portamento controls are track-level fields, not params entries
  const portaField = PORTAMENTO_CONTROL_IDS[controlId];
  if (portaField) {
    handlers.onPortamentoChange?.(portaField, value);
    return;
  }

  const runtimeParam = controlIdToRuntimeParam[controlId] ?? controlId;
  if (runtimeParam === 'timbre') {
    handlers.onParamChange(value, track.params.morph);
  } else if (runtimeParam === 'morph') {
    handlers.onParamChange(track.params.timbre, value);
  } else if (runtimeParam === 'note') {
    handlers.onNoteChange(value);
  } else if (runtimeParam === 'harmonics') {
    handlers.onHarmonicsChange(value);
  } else {
    handlers.onExtendedSourceParamChange(runtimeParam, value);
  }
}
