import type { Track } from '../engine/types';
import { controlIdToRuntimeParam } from '../audio/instrument-registry';

export interface SourceParamHandlers {
  onParamChange: (timbre: number, morph: number) => void;
  onNoteChange: (note: number) => void;
  onHarmonicsChange: (harmonics: number) => void;
  onExtendedSourceParamChange: (runtimeParam: string, value: number) => void;
}

export function routeSourceModuleParam(
  controlId: string,
  value: number,
  track: Track,
  handlers: SourceParamHandlers,
): void {
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
