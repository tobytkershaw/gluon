// src/engine/event-conversion.ts
import type { Step } from './sequencer-types';
import type { MusicalEvent, TriggerEvent, NoteEvent, ParameterEvent } from './canonical-types';
import type { SynthParamValues } from './types';
import { runtimeParamToControlId, controlIdToRuntimeParam } from '../audio/instrument-registry';

export interface ConversionOptions {
  /** Convert normalised pitch (0–1) to MIDI (0–127). If omitted, note params are dropped. */
  pitchToMidi?: (normalised: number) => number;
}

export interface InverseConversionOptions {
  /** Convert MIDI pitch (0–127) to normalised (0–1). If omitted, NoteEvent pitch is dropped. */
  midiToPitch?: (midi: number) => number;
}

/**
 * Convert Step[] to MusicalEvent[].
 * Structural conversion: gates → TriggerEvent, param locks → ParameterEvent.
 * Pitch conversion is opt-in via pitchToMidi.
 */
export function stepsToEvents(steps: Step[], options?: ConversionOptions): MusicalEvent[] {
  const events: MusicalEvent[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step.gate) continue;

    // Note param with pitch converter → NoteEvent; otherwise TriggerEvent
    const noteValue = step.params?.note;
    if (noteValue !== undefined && options?.pitchToMidi) {
      const noteEvent: NoteEvent = {
        kind: 'note',
        at: i,
        pitch: options.pitchToMidi(noteValue),
        velocity: step.accent ? 1.0 : 0.8,
        duration: 0.25,
      };
      events.push(noteEvent);
    } else {
      const trigger: TriggerEvent = {
        kind: 'trigger',
        at: i,
        velocity: step.accent ? 1.0 : 0.8,
        accent: step.accent,
      };
      events.push(trigger);
    }

    // Param locks → ParameterEvents (skip 'note' — handled above or dropped)
    if (step.params) {
      for (const [key, value] of Object.entries(step.params)) {
        if (key === 'note') continue;
        const controlId = runtimeParamToControlId[key] ?? key;
        const paramEvent: ParameterEvent = {
          kind: 'parameter',
          at: i,
          controlId,
          value: value as number,
        };
        events.push(paramEvent);
      }
    }
  }

  return events;
}

/**
 * Convert MusicalEvent[] to Step[].
 * Inverse of stepsToEvents. Pitch conversion is opt-in via midiToPitch.
 */
export function eventsToSteps(
  events: MusicalEvent[],
  stepCount: number,
  options?: InverseConversionOptions,
): Step[] {
  const steps: Step[] = Array.from({ length: stepCount }, () => ({
    gate: false,
    accent: false,
    micro: 0,
  }));

  for (const event of events) {
    const idx = Math.round(event.at);
    if (idx < 0 || idx >= stepCount) continue;

    switch (event.kind) {
      case 'trigger':
        steps[idx].gate = true;
        if (event.accent) steps[idx].accent = true;
        if (event.velocity !== undefined && event.velocity >= 0.95) steps[idx].accent = true;
        break;

      case 'note':
        steps[idx].gate = true;
        if (event.velocity >= 0.95) steps[idx].accent = true;
        if (options?.midiToPitch) {
          if (!steps[idx].params) steps[idx].params = {} as Partial<SynthParamValues>;
          steps[idx].params!.note = options.midiToPitch(event.pitch);
        }
        break;

      case 'parameter': {
        if (!steps[idx].params) steps[idx].params = {} as Partial<SynthParamValues>;
        const runtimeKey = controlIdToRuntimeParam[event.controlId] ?? event.controlId;
        (steps[idx].params as Record<string, unknown>)[runtimeKey] = event.value;
        break;
      }
    }
  }

  return steps;
}
