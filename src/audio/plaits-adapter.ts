// src/audio/plaits-adapter.ts
import type {
  SourceAdapter, ControlBinding, ControlState, ControlSchema,
  Region, MusicalEvent, AIOperation,
} from '../engine/canonical-types';
import {
  controlIdToRuntimeParam, runtimeParamToControlId,
  getEngineControlSchemas,
} from './instrument-registry';
import { midiToNote } from './synth-interface';
import { eventsToSteps } from '../engine/event-conversion';

const KNOWN_CONTROL_IDS = new Set(Object.keys(controlIdToRuntimeParam));

export function createPlaitsAdapter(): SourceAdapter {
  return {
    id: 'plaits-wasm',
    name: 'Plaits WASM',

    mapControl(controlId: string): ControlBinding {
      const param = controlIdToRuntimeParam[controlId];
      return {
        adapterId: 'plaits-wasm',
        path: param ? `params.${param}` : controlId,
      };
    },

    mapRuntimeParamKey(paramKey: string): string | null {
      return runtimeParamToControlId[paramKey] ?? null;
    },

    applyControlChanges(changes) {
      // No-op: audio engine is driven by session state sync in App.tsx
      void changes;
    },

    mapEvents(events: MusicalEvent[]) {
      return eventsToSteps(events, 16, {
        midiToPitch: midiToNormalisedPitch,
        canonicalToRuntime: (id) => controlIdToRuntimeParam[id] ?? id,
      });
    },

    readControlState(): ControlState {
      return {};
    },

    readRegions(): Region[] {
      return [];
    },

    getControlSchemas(engineId: string): ControlSchema[] {
      return getEngineControlSchemas(engineId);
    },

    validateOperation(op: AIOperation): { valid: boolean; reason?: string } {
      if (op.type === 'move') {
        // Check control is known (by controlId or runtime param)
        const isCanonical = KNOWN_CONTROL_IDS.has(op.controlId);
        const isRuntime = runtimeParamToControlId[op.controlId] !== undefined;
        if (!isCanonical && !isRuntime) {
          return { valid: false, reason: `Unknown control: ${op.controlId}` };
        }
        // Check value range for absolute targets
        if ('absolute' in op.target) {
          const v = op.target.absolute;
          if (typeof v !== 'number' || v < 0 || v > 1) {
            return { valid: false, reason: `Value out of range: ${v}` };
          }
        }
      }
      return { valid: true };
    },

    midiToNormalisedPitch,
    normalisedPitchToMidi,
  };
}

function midiToNormalisedPitch(midi: number): number {
  return midiToNote(midi);
}

function normalisedPitchToMidi(normalised: number): number {
  return Math.round(Math.max(0, Math.min(127, normalised * 127)));
}
