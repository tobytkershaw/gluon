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

// All valid Plaits control IDs (hardware names after #392 rename).
// Most are identity-mapped (timbre→timbre, harmonics→harmonics, morph→morph).
// Only frequency→note requires a mapping lookup.
const KNOWN_CONTROL_IDS = new Set(['timbre', 'harmonics', 'morph', 'frequency']);

export function createPlaitsAdapter(): SourceAdapter {
  return {
    id: 'plaits-wasm',
    name: 'Plaits WASM',

    mapControl(controlId: string): ControlBinding {
      const param = controlIdToRuntimeParam[controlId] ?? controlId;
      return {
        adapterId: 'plaits-wasm',
        path: `params.${param}`,
      };
    },

    mapRuntimeParamKey(paramKey: string): string | null {
      // Check explicit mapping first (note→frequency), then identity
      if (runtimeParamToControlId[paramKey] !== undefined) {
        return runtimeParamToControlId[paramKey];
      }
      // Identity-mapped params: timbre, harmonics, morph
      if (KNOWN_CONTROL_IDS.has(paramKey)) return paramKey;
      return null;
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
        // Accept both canonical controlId and legacy param field
        const id = ('controlId' in op ? op.controlId : undefined)
          ?? ('param' in op ? (op as unknown as { param: string }).param : undefined);
        if (id) {
          const isCanonical = KNOWN_CONTROL_IDS.has(id);
          const isRuntime = runtimeParamToControlId[id] !== undefined;
          if (!isCanonical && !isRuntime) {
            return { valid: false, reason: `Unknown control: ${id}` };
          }
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
