// src/audio/render-spec.ts
// Converts session state into a serializable RenderSpec for the offline render Worker.

import type { Session, Voice, ProcessorConfig } from '../engine/types';
import type { SynthParamValues } from '../engine/types';
import type { MusicalEvent, NoteEvent, TriggerEvent, ParameterEvent } from '../engine/canonical-types';
import { controlIdToRuntimeParam } from './instrument-registry';

// ---------------------------------------------------------------------------
// Types — all plain data, safe to postMessage to a Worker
// ---------------------------------------------------------------------------

export interface RenderSpec {
  sampleRate: number;       // always 48000
  bpm: number;
  bars: number;
  voices: RenderVoiceSpec[];
}

export interface RenderVoiceSpec {
  id: string;
  /** Plaits engine index (already offset by +8 for the Plaits C ABI). */
  model: number;
  params: RenderSynthPatch;
  events: RenderEvent[];
  processors: RenderProcessorSpec[];
}

export interface RenderSynthPatch {
  harmonics: number;
  timbre: number;
  morph: number;
  note: number;
}

export interface RenderProcessorSpec {
  type: 'rings' | 'clouds';
  model: number;
  params: Record<string, number>;
}

export interface RenderEvent {
  /** Absolute beat position (0-based, in steps — 16ths). */
  beatTime: number;
  type: 'trigger' | 'gate-on' | 'gate-off' | 'set-patch' | 'set-note';
  accentLevel?: number;
  patch?: Partial<RenderSynthPatch>;
  note?: number;   // normalised 0-1 pitch for set-note
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GLUON_TO_PLAITS_ENGINE_OFFSET = 8;
const STEPS_PER_BAR = 16;
const NOTE_DURATION_STEPS = 0.25;  // default gate length for note events

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a RenderSpec from the current session state.
 *
 * @param session  Current session
 * @param voiceIds Optional subset of voices to render. If omitted, all unmuted voices.
 * @param bars     Number of bars to render (default 2)
 */
export function buildRenderSpec(
  session: Session,
  voiceIds?: string[],
  bars = 2,
): RenderSpec {
  const selectedVoices = selectVoices(session, voiceIds);

  return {
    sampleRate: 48000,
    bpm: session.transport.bpm,
    bars,
    voices: selectedVoices.map(v => buildVoiceSpec(v, bars)),
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function selectVoices(session: Session, voiceIds?: string[]): Voice[] {
  if (voiceIds && voiceIds.length > 0) {
    const idSet = new Set(voiceIds);
    return session.voices.filter(v => idSet.has(v.id));
  }
  // Default: all unmuted voices
  return session.voices.filter(v => !v.muted);
}

function buildVoiceSpec(voice: Voice, bars: number): RenderVoiceSpec {
  const params: RenderSynthPatch = {
    harmonics: voice.params.harmonics,
    timbre: voice.params.timbre,
    morph: voice.params.morph,
    note: voice.params.note,
  };

  const events = collectEvents(voice, bars);
  const processors = (voice.processors ?? []).map(buildProcessorSpec);

  return {
    id: voice.id,
    model: clampModel(voice.model) + GLUON_TO_PLAITS_ENGINE_OFFSET,
    params,
    events,
    processors,
  };
}

function clampModel(model: number): number {
  return Math.max(0, Math.min(15, model));
}

function buildProcessorSpec(proc: ProcessorConfig): RenderProcessorSpec {
  return {
    type: proc.type as 'rings' | 'clouds',
    model: proc.model,
    params: { ...proc.params },
  };
}

/**
 * Collect render events from a voice's regions, unrolled across the requested
 * number of bars. Looping regions repeat; non-looping regions play once.
 */
function collectEvents(voice: Voice, bars: number): RenderEvent[] {
  const totalSteps = bars * STEPS_PER_BAR;
  const events: RenderEvent[] = [];

  for (const region of voice.regions) {
    if (region.events.length === 0) continue;

    // How many times does this region repeat within the render window?
    if (region.loop) {
      const regionDuration = region.duration; // in steps
      if (regionDuration <= 0) continue;

      let offset = region.start;
      while (offset < totalSteps) {
        for (const ev of region.events) {
          const beatTime = offset + ev.at;
          if (beatTime >= totalSteps) break; // events are sorted ascending
          if (beatTime >= 0) {
            pushMusicalEvent(events, ev, beatTime, voice.params);
          }
        }
        offset += regionDuration;
      }
    } else {
      // Non-looping: play once
      for (const ev of region.events) {
        const beatTime = region.start + ev.at;
        if (beatTime >= totalSteps) break;
        if (beatTime >= 0) {
          pushMusicalEvent(events, ev, beatTime, voice.params);
        }
      }
    }
  }

  // Sort by beat time for the Worker's event scheduling
  events.sort((a, b) => a.beatTime - b.beatTime);
  return events;
}

/**
 * Convert a canonical MusicalEvent into one or more RenderEvents.
 */
function pushMusicalEvent(
  out: RenderEvent[],
  event: MusicalEvent,
  beatTime: number,
  baseParams: SynthParamValues,
): void {
  switch (event.kind) {
    case 'trigger': {
      const te = event as TriggerEvent;
      out.push({
        beatTime,
        type: 'trigger',
        accentLevel: te.accent ? 1.0 : (te.velocity ?? 0.8),
      });
      out.push({ beatTime, type: 'gate-on' });
      out.push({ beatTime: beatTime + NOTE_DURATION_STEPS, type: 'gate-off' });
      break;
    }
    case 'note': {
      const ne = event as NoteEvent;
      // Convert MIDI pitch to normalised 0-1
      const normPitch = Math.max(0, Math.min(1, ne.pitch / 127));
      out.push({
        beatTime,
        type: 'set-note',
        note: normPitch,
      });
      out.push({
        beatTime,
        type: 'set-patch',
        patch: { note: normPitch },
      });
      out.push({
        beatTime,
        type: 'trigger',
        accentLevel: ne.velocity ?? 0.8,
      });
      out.push({ beatTime, type: 'gate-on' });
      out.push({ beatTime: beatTime + (ne.duration ?? NOTE_DURATION_STEPS), type: 'gate-off' });
      break;
    }
    case 'parameter': {
      const pe = event as ParameterEvent;
      // Map semantic control ID to runtime param name
      const runtimeParam = controlIdToRuntimeParam[pe.controlId] ?? pe.controlId;
      if (typeof pe.value === 'number') {
        out.push({
          beatTime,
          type: 'set-patch',
          patch: { [runtimeParam]: pe.value } as Partial<RenderSynthPatch>,
        });
      }
      break;
    }
  }
}
