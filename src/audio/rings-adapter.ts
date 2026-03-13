// src/audio/rings-adapter.ts
import type {
  SourceAdapter, ControlBinding, ControlState, ControlSchema,
  Region, MusicalEvent, AIOperation,
} from '../engine/canonical-types';
import {
  getRingsEngineById,
  ringsInstrument,
} from './instrument-registry';

// Rings controls map 1:1 (controlId === runtime param name)
const KNOWN_CONTROL_IDS = new Set(
  ringsInstrument.engines.flatMap(e => e.controls.map(c => c.id)),
);

export function createRingsAdapter(): SourceAdapter {
  return {
    id: 'rings-wasm',
    name: 'Rings WASM',

    mapControl(controlId: string): ControlBinding {
      return {
        adapterId: 'rings-wasm',
        path: `params.${controlId}`,
      };
    },

    mapRuntimeParamKey(paramKey: string): string | null {
      // Rings controls have no canonical/runtime split — IDs are the same
      return KNOWN_CONTROL_IDS.has(paramKey) ? paramKey : null;
    },

    applyControlChanges(changes) {
      // No-op: audio engine is driven by session state sync
      void changes;
    },

    mapEvents(events: MusicalEvent[]) {
      // Rings is a processor, not a sequenced source — events are pass-through
      return events;
    },

    readControlState(): ControlState {
      return {};
    },

    readRegions(): Region[] {
      return [];
    },

    getControlSchemas(engineId: string): ControlSchema[] {
      return getRingsEngineById(engineId)?.controls ?? [];
    },

    validateOperation(op: AIOperation): { valid: boolean; reason?: string } {
      if (op.type === 'move') {
        const id = ('controlId' in op ? op.controlId : undefined)
          ?? ('param' in op ? (op as unknown as { param: string }).param : undefined);
        if (id && !KNOWN_CONTROL_IDS.has(id)) {
          return { valid: false, reason: `Unknown Rings control: ${id}` };
        }
        if ('absolute' in op.target) {
          const v = op.target.absolute;
          if (typeof v !== 'number' || v < 0 || v > 1) {
            return { valid: false, reason: `Value out of range: ${v}` };
          }
        }
      }
      return { valid: true };
    },

    midiToNormalisedPitch(midi: number): number {
      // Rings uses MIDI-like pitch directly (tonic + note offset)
      return Math.max(0, Math.min(127, midi)) / 127;
    },

    normalisedPitchToMidi(normalised: number): number {
      return Math.round(Math.max(0, Math.min(127, normalised * 127)));
    },
  };
}
