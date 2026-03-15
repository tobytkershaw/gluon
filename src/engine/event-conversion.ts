// src/engine/event-conversion.ts
import type { Step } from './sequencer-types';
import type { MusicalEvent, TriggerEvent, NoteEvent, ParameterEvent } from './canonical-types';
import type { SynthParamValues } from './types';

export interface ConversionOptions {
  /** Convert normalised pitch (0-1) to MIDI (0-127). If omitted, note params are dropped. */
  pitchToMidi?: (normalised: number) => number;
  /** Convert runtime param key to canonical controlId. If omitted, key is used as-is. */
  runtimeToCanonical?: (paramKey: string) => string;
}

export interface InverseConversionOptions {
  /** Convert MIDI pitch (0-127) to normalised (0-1). If omitted, NoteEvent pitch is dropped. */
  midiToPitch?: (midi: number) => number;
  /** Convert canonical controlId to runtime param key. If omitted, controlId is used as-is. */
  canonicalToRuntime?: (controlId: string) => string;
}

/**
 * Convert Step[] to MusicalEvent[].
 * Structural conversion: gates -> TriggerEvent, param locks -> ParameterEvent.
 * Pitch and control-ID conversion are opt-in via injected functions.
 */
export function stepsToEvents(steps: Step[], options?: ConversionOptions): MusicalEvent[] {
  const events: MusicalEvent[] = [];
  const toCanonical = options?.runtimeToCanonical ?? ((k: string) => k);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    if (step.gate) {
      // Note param with pitch converter -> NoteEvent; otherwise TriggerEvent
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
    }

    // Param locks -> ParameterEvents (skip 'note' -- handled above or dropped)
    // Emitted for both gated and ungated steps to preserve automation on silent steps.
    if (step.params) {
      for (const [key, value] of Object.entries(step.params)) {
        if (key === 'note') continue;
        const paramEvent: ParameterEvent = {
          kind: 'parameter',
          at: i,
          controlId: toCanonical(key),
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
 * Inverse of stepsToEvents. Pitch and control-ID conversion are opt-in.
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
  const toRuntime = options?.canonicalToRuntime ?? ((k: string) => k);

  for (const event of events) {
    const idx = Math.floor(event.at);
    if (idx < 0 || idx >= stepCount) continue;

    switch (event.kind) {
      case 'trigger':
        // velocity=0 is the "ungated" sentinel — trigger exists to preserve
        // accent state but should not produce a gate in the step grid.
        if (event.velocity === 0) break;
        steps[idx].gate = true;
        if (event.accent) steps[idx].accent = true;
        if (event.velocity !== undefined && event.velocity >= 0.95) steps[idx].accent = true;
        break;

      case 'note':
        // velocity=0 is the "ungated" sentinel — note exists to preserve
        // pitch/duration state but should not produce a gate in the step grid.
        if (event.velocity === 0) break;
        steps[idx].gate = true;
        if (event.velocity >= 0.95) steps[idx].accent = true;
        if (options?.midiToPitch) {
          if (!steps[idx].params) steps[idx].params = {} as Partial<SynthParamValues>;
          steps[idx].params!.note = options.midiToPitch(event.pitch);
        }
        break;

      case 'parameter': {
        if (!steps[idx].params) steps[idx].params = {} as Partial<SynthParamValues>;
        const runtimeKey = toRuntime(event.controlId);
        (steps[idx].params as Record<string, unknown>)[runtimeKey] = event.value;
        break;
      }
    }

    // Populate micro from fractional part of event position (trigger/note only —
    // parameter events must not overwrite groove displacement).
    if (event.kind === 'trigger' || event.kind === 'note') {
      const micro = event.at - Math.floor(event.at);
      if (micro > 0) steps[idx].micro = micro;
    }
  }

  return steps;
}
