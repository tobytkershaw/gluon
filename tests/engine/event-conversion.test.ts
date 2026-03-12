import { describe, it, expect } from 'vitest';
import { stepsToEvents, eventsToSteps } from '../../src/engine/event-conversion';
import type { Step } from '../../src/engine/sequencer-types';
import type { MusicalEvent, TriggerEvent, ParameterEvent, NoteEvent } from '../../src/engine/canonical-types';
import { runtimeParamToControlId, controlIdToRuntimeParam } from '../../src/audio/instrument-registry';

// Plaits-specific mappers for tests that use Plaits param names
const plaitsOptions = {
  runtimeToCanonical: (k: string) => runtimeParamToControlId[k] ?? k,
};
const plaitsInverseOptions = {
  canonicalToRuntime: (k: string) => controlIdToRuntimeParam[k] ?? k,
};

describe('event-conversion', () => {
  describe('stepsToEvents', () => {
    it('converts gate steps to trigger events', () => {
      const steps: Step[] = [
        { gate: true, accent: false, micro: 0 },
        { gate: false, accent: false, micro: 0 },
        { gate: false, accent: false, micro: 0 },
        { gate: false, accent: false, micro: 0 },
        { gate: true, accent: true, micro: 0 },
      ];
      const events = stepsToEvents(steps);
      expect(events).toHaveLength(2);
      expect(events[0].kind).toBe('trigger');
      expect((events[0] as TriggerEvent).at).toBe(0);
      expect((events[0] as TriggerEvent).accent).toBe(false);
      expect(events[1].kind).toBe('trigger');
      expect((events[1] as TriggerEvent).at).toBe(4);
      expect((events[1] as TriggerEvent).accent).toBe(true);
      expect((events[1] as TriggerEvent).velocity).toBe(1.0);
    });

    it('converts param locks to parameter events with injected mapping', () => {
      const steps: Step[] = [
        { gate: true, accent: false, micro: 0, params: { timbre: 0.8 } },
        { gate: false, accent: false, micro: 0 },
      ];
      const events = stepsToEvents(steps, plaitsOptions);
      expect(events).toHaveLength(2); // trigger + parameter
      const paramEvent = events.find(e => e.kind === 'parameter') as ParameterEvent;
      expect(paramEvent).toBeDefined();
      expect(paramEvent.controlId).toBe('brightness'); // timbre → brightness
      expect(paramEvent.value).toBe(0.8);
    });

    it('drops note params without pitch converter', () => {
      const steps: Step[] = [
        { gate: true, accent: false, micro: 0, params: { note: 0.47 } },
      ];
      const events = stepsToEvents(steps);
      // Should produce a trigger (not a note event) since no pitch converter
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('trigger');
    });

    it('converts note params to NoteEvent with pitch converter', () => {
      const steps: Step[] = [
        { gate: true, accent: false, micro: 0, params: { note: 0.47 } },
      ];
      const events = stepsToEvents(steps, {
        pitchToMidi: (n) => Math.round(n * 127),
      });
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('note');
      expect((events[0] as NoteEvent).pitch).toBe(60); // 0.47 * 127 ≈ 60
    });

    it('returns empty for all-off steps without params', () => {
      const steps: Step[] = [
        { gate: false, accent: false, micro: 0 },
        { gate: false, accent: false, micro: 0 },
      ];
      expect(stepsToEvents(steps)).toHaveLength(0);
    });

    it('emits ParameterEvents for ungated steps with param locks', () => {
      const steps: Step[] = [
        { gate: false, accent: false, micro: 0, params: { timbre: 0.9 } },
        { gate: true, accent: false, micro: 0 },
      ];
      const events = stepsToEvents(steps, plaitsOptions);
      // Step 0: ungated but has param → 1 ParameterEvent
      // Step 1: gated → 1 TriggerEvent
      expect(events).toHaveLength(2);
      const paramEvent = events.find(e => e.kind === 'parameter') as ParameterEvent;
      expect(paramEvent).toBeDefined();
      expect(paramEvent.at).toBe(0);
      expect(paramEvent.controlId).toBe('brightness');
      expect(paramEvent.value).toBe(0.9);
    });
  });

  describe('eventsToSteps', () => {
    it('converts trigger events to gate steps', () => {
      const events: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.8, accent: false },
        { kind: 'trigger', at: 4, velocity: 1.0, accent: true },
      ];
      const steps = eventsToSteps(events, 8);
      expect(steps[0].gate).toBe(true);
      expect(steps[0].accent).toBe(false);
      expect(steps[4].gate).toBe(true);
      expect(steps[4].accent).toBe(true);
      expect(steps[1].gate).toBe(false);
    });

    it('converts note events with pitch converter', () => {
      const events: MusicalEvent[] = [
        { kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 0.25 },
      ];
      const steps = eventsToSteps(events, 4, {
        midiToPitch: (midi) => midi / 127,
      });
      expect(steps[0].gate).toBe(true);
      expect(steps[0].params?.note).toBeCloseTo(60 / 127);
    });

    it('drops note pitch without converter', () => {
      const events: MusicalEvent[] = [
        { kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 0.25 },
      ];
      const steps = eventsToSteps(events, 4);
      expect(steps[0].gate).toBe(true);
      expect(steps[0].params?.note).toBeUndefined();
    });

    it('converts parameter events to param locks with injected mapping', () => {
      const events: MusicalEvent[] = [
        { kind: 'parameter', at: 2, controlId: 'brightness', value: 0.9 },
      ];
      const steps = eventsToSteps(events, 4, plaitsInverseOptions);
      expect(steps[2].params).toBeDefined();
      expect((steps[2].params as Record<string, unknown>)['timbre']).toBe(0.9);
    });

    it('uses raw controlId when no mapping injected', () => {
      const events: MusicalEvent[] = [
        { kind: 'parameter', at: 0, controlId: 'brightness', value: 0.5 },
      ];
      const steps = eventsToSteps(events, 2);
      expect((steps[0].params as Record<string, unknown>)['brightness']).toBe(0.5);
    });

    it('ignores out-of-range events', () => {
      const events: MusicalEvent[] = [
        { kind: 'trigger', at: 99, velocity: 0.8, accent: false },
      ];
      const steps = eventsToSteps(events, 4);
      expect(steps.every(s => !s.gate)).toBe(true);
    });
  });

  describe('round-trips', () => {
    it('structural round-trip: gates and accents', () => {
      const original: Step[] = [
        { gate: true, accent: true, micro: 0 },
        { gate: false, accent: false, micro: 0 },
        { gate: false, accent: false, micro: 0 },
        { gate: false, accent: false, micro: 0 },
        { gate: true, accent: false, micro: 0 },
        { gate: false, accent: false, micro: 0 },
        { gate: false, accent: false, micro: 0 },
        { gate: false, accent: false, micro: 0 },
      ];
      const events = stepsToEvents(original);
      const result = eventsToSteps(events, 8);
      for (let i = 0; i < 8; i++) {
        expect(result[i].gate).toBe(original[i].gate);
        expect(result[i].accent).toBe(original[i].accent);
      }
    });

    it('structural round-trip: param locks (non-note)', () => {
      const original: Step[] = [
        { gate: true, accent: false, micro: 0, params: { timbre: 0.3 } },
        { gate: false, accent: false, micro: 0 },
        { gate: true, accent: false, micro: 0, params: { morph: 0.7 } },
        { gate: false, accent: false, micro: 0 },
      ];
      const events = stepsToEvents(original);
      const result = eventsToSteps(events, 4);
      expect(result[0].gate).toBe(true);
      expect((result[0].params as Record<string, unknown>)['timbre']).toBe(0.3);
      expect(result[2].gate).toBe(true);
      expect((result[2].params as Record<string, unknown>)['morph']).toBe(0.7);
    });

    it('pitched round-trip with converters', () => {
      const original: Step[] = [
        { gate: true, accent: false, micro: 0, params: { note: 0.47 } },
        { gate: false, accent: false, micro: 0 },
      ];
      const pitchToMidi = (n: number) => Math.round(n * 127);
      const midiToPitch = (m: number) => m / 127;
      const events = stepsToEvents(original, { pitchToMidi });
      const result = eventsToSteps(events, 2, { midiToPitch });
      expect(result[0].gate).toBe(true);
      expect(result[0].params?.note).toBeCloseTo(0.47, 1);
    });

    it('round-trip: ungated param locks preserved', () => {
      const original: Step[] = [
        { gate: false, accent: false, micro: 0, params: { timbre: 0.6 } },
        { gate: true, accent: false, micro: 0 },
        { gate: false, accent: false, micro: 0, params: { morph: 0.4 } },
        { gate: false, accent: false, micro: 0 },
      ];
      const events = stepsToEvents(original);
      const result = eventsToSteps(events, 4);
      // Step 0: ungated with param lock
      expect(result[0].gate).toBe(false);
      expect((result[0].params as Record<string, unknown>)['timbre']).toBe(0.6);
      // Step 1: gated, no params
      expect(result[1].gate).toBe(true);
      // Step 2: ungated with param lock
      expect(result[2].gate).toBe(false);
      expect((result[2].params as Record<string, unknown>)['morph']).toBe(0.4);
    });

    it('round-trip with Plaits mappings: runtime → canonical → runtime', () => {
      const original: Step[] = [
        { gate: true, accent: false, micro: 0, params: { timbre: 0.3 } },
        { gate: false, accent: false, micro: 0 },
      ];
      const events = stepsToEvents(original, plaitsOptions);
      // Events should use canonical controlId
      const paramEvent = events.find(e => e.kind === 'parameter') as ParameterEvent;
      expect(paramEvent.controlId).toBe('brightness');
      // Convert back with inverse mapping
      const result = eventsToSteps(events, 2, plaitsInverseOptions);
      expect((result[0].params as Record<string, unknown>)['timbre']).toBe(0.3);
    });
  });
});
