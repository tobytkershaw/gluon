// src/ai/tool-schemas.ts — Tool declarations in neutral JSON Schema format.

import type { ToolSchema } from './types';
import {
  plaitsInstrument,
  ringsInstrument,
  cloudsInstrument,
  compressorInstrument,
  stereoInstrument,
  chorusInstrument,
  distortionInstrument,
  warpsInstrument,
  elementsInstrument,
  beadsInstrument,
  tidesInstrument,
  ripplesInstrument,
  eqInstrument,
} from '../audio/instrument-registry';
import { RECIPE_NAMES } from '../engine/chain-recipes';
import { ROLE_NAMES } from '../engine/mix-roles';
import { MODULATION_RECIPE_NAMES } from '../engine/modulation-recipes';
import { FREQUENCY_BANDS } from '../engine/spectral-slots';

// ---------------------------------------------------------------------------
// Derive param lists from the instrument registry so descriptions stay in sync
// ---------------------------------------------------------------------------

function controlIds(inst: { engines: { controls: { id: string }[] }[] }): string[] {
  return inst.engines[0]?.controls.map(c => c.id) ?? [];
}

function quoted(ids: string[]): string {
  return ids.map(id => `"${id}"`).join(', ');
}

const plaitsParamIds = controlIds(plaitsInstrument);
const ringsParamIds = controlIds(ringsInstrument);
const cloudsParamIds = controlIds(cloudsInstrument);
const compressorParamIds = controlIds(compressorInstrument);
const stereoParamIds = controlIds(stereoInstrument);
const chorusParamIds = controlIds(chorusInstrument);
const distortionParamIds = controlIds(distortionInstrument);
const warpsParamIds = controlIds(warpsInstrument);
const elementsParamIds = controlIds(elementsInstrument);
const beadsParamIds = controlIds(beadsInstrument);
const ripplesParamIds = controlIds(ripplesInstrument);
const eqParamIds = controlIds(eqInstrument);
const tidesParamIds = controlIds(tidesInstrument);

/** Exported for test use — the canonical control ID lists used in tool descriptions. */
export const REGISTRY_CONTROL_IDS = {
  plaits: plaitsParamIds,
  rings: ringsParamIds,
  clouds: cloudsParamIds,
  compressor: compressorParamIds,
  stereo: stereoParamIds,
  chorus: chorusParamIds,
  distortion: distortionParamIds,
  warps: warpsParamIds,
  elements: elementsParamIds,
  beads: beadsParamIds,
  ripples: ripplesParamIds,
  eq: eqParamIds,
  tides: tidesParamIds,
} as const;

const moveTool: ToolSchema = {
  name: 'move',
  description:
    'Move a normalized control to a target value. Targets a track source control by default, or a processor control when processorId is provided, or a modulator control when modulatorId is provided. Immediately audible. Takes effect after this response.',
  parameters: {
    type: 'object',
    properties: {
      param: {
        type: 'string',
        description:
          `The control ID to change. ` +
          `For track (Plaits): ${quoted(plaitsParamIds)}. ` +
          `For processors: depends on type (Rings: ${quoted(ringsParamIds)}; Clouds: ${quoted(cloudsParamIds)}; Ripples: ${quoted(ripplesParamIds)}; EQ: ${quoted(eqParamIds)}; Compressor: ${quoted(compressorParamIds)}; Stereo: ${quoted(stereoParamIds)}; Chorus: ${quoted(chorusParamIds)}; Distortion: ${quoted(distortionParamIds)}; Warps: ${quoted(warpsParamIds)}; Elements: ${quoted(elementsParamIds)}; Beads: ${quoted(beadsParamIds)}). ` +
          `For Tides modulator: ${quoted(tidesParamIds)}.`,
      },
      target: {
        type: 'object',
        description: 'Target value — use absolute (0.0-1.0) or relative (-1.0 to 1.0).',
        properties: {
          absolute: { type: 'number', description: 'Absolute value (0.0-1.0).' },
          relative: { type: 'number', description: 'Relative offset (-1.0 to 1.0).' },
        },
      },
      trackId: {
        type: 'string',
        description: 'Target track — use ordinal label (e.g. "Track 1") or internal ID. Defaults to active track if omitted.',
      },
      processorId: {
        type: 'string',
        description: 'Processor ID to target (e.g. "rings-1710342000000"). When provided, moves a control on the processor instead of the track source.',
      },
      modulatorId: {
        type: 'string',
        description: 'Modulator ID to target (e.g. "tides-1710342000000"). When provided, moves a control on the modulator (e.g. LFO rate).',
      },
      over: {
        type: 'number',
        description: 'Smooth transition duration in milliseconds (e.g. 2000 for 2s drift).',
      },
    },
    required: ['param', 'target'],
  },
};

const sketchTool: ToolSchema = {
  name: 'sketch',
  description:
    'Apply a rhythmic/melodic pattern to a track using musical events. Takes effect after this response. ' +
    'IMPORTANT: Events must fit within the current pattern length (default 16 steps = 1 bar). ' +
    'For multi-bar patterns, call manage_pattern with set_length FIRST to extend the pattern before sketching.',
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: 'Target track — use ordinal label (e.g. "Track 1") or internal ID.',
      },
      description: {
        type: 'string',
        description: 'Short description of the pattern (e.g. "four on the floor kick").',
      },
      events: {
        type: 'array',
        description:
          'Sparse list of musical events. Only include steps you want to set. ' +
          'For drums/percussion, use "trigger" events. For melodic tracks, use "note" events with MIDI pitches. ' +
          'For chords, place multiple "note" events at the same step with different pitches (up to 4 simultaneous notes). ' +
          'Fractional "at" values enable microtiming — e.g. at:4.1 pushes an event slightly late for groove. Use sparingly for humanization.',
        items: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              description: '"trigger" for percussion, "note" for melodic, "parameter" for per-step param lock.',
            },
            at: {
              description: 'Step position (number or string). Accepts either a 0-based step number (e.g. 4, supports fractional values like 4.1 for microtiming) or a "bar.beat.sixteenth" string (e.g. "1.1.1" = step 0, "3.2.1" = step 36, "2.1.3" = step 18). Bar, beat, and sixteenth are all 1-based. Prefer bar.beat.sixteenth for multi-bar patterns — it eliminates mental arithmetic.',
            },
            velocity: {
              type: 'number',
              description: 'Velocity (0.0-1.0). Applies to trigger and note events.',
            },
            accent: {
              type: 'boolean',
              description: 'Accent flag. Applies to trigger events.',
            },
            pitch: {
              type: 'integer',
              description: 'MIDI pitch (0-127). Required for note events.',
            },
            duration: {
              type: 'number',
              description: 'Note duration in steps. Controls gate length: 0.25 = staccato (short gate), 0.5 = normal, 1.0 = legato (full step), 2.0+ = sustained/tied. Required for note events.',
            },
            controlId: {
              type: 'string',
              description: 'Control ID for parameter lock events.',
            },
            value: {
              type: 'number',
              description: 'Parameter value for parameter lock events.',
            },
          },
          required: ['kind', 'at'],
        },
      },
      humanize: {
        type: 'number',
        description:
          'Humanize amount (0.0-1.0). Adds subtle velocity and timing jitter to events so they don\'t sound mechanical. ' +
          '0.3 is a good default for natural feel. Saves a separate transform step.',
      },
      groove: {
        type: 'string',
        description:
          'Groove template name (straight, mpc_swing, 808_shuffle, garage, techno_drive, laid_back, dnb_break, dilla). ' +
          'Applies systematic per-instrument micro-timing for authentic feel. Choose based on genre intent.',
      },
      groove_amount: {
        type: 'number',
        description: 'Groove intensity 0.0-1.0. Default 0.7. Higher values apply stronger timing offsets.',
      },
      archetype: {
        type: 'string',
        description:
          'Pattern archetype name — generates events from a built-in library instead of specifying them manually. ' +
          'Drums: four_on_the_floor, two_and_four, offbeat_hat, 16th_hat, breakbeat, halftime, dnb_break. ' +
          'Bass: root_eighth, octave_bounce, walking_bass, syncopated_sub. ' +
          'Melodic: arp_up, arp_down, arp_updown, stab. ' +
          'When set, overrides the events array. Groove and humanize are still applied on top.',
      },
      generator: {
        type: 'object',
        description:
          'Composable pattern generator — produces events algorithmically. Base types: ' +
          '"pulse" (Euclidean: steps + pulses + rotation), "sequence" (explicit hit positions), ' +
          '"probability" (density 0-1), "archetype" (named archetype). ' +
          'Layers are applied in order: velocity_cycle, accent, skip_every, swing, humanize, ' +
          'pitch_pattern, ghost_notes, density_ramp. When set, overrides events and archetype.',
        properties: {
          base: {
            type: 'object',
            description: 'Base pattern generator.',
            properties: {
              type: { type: 'string', description: '"pulse", "sequence", "probability", or "archetype".' },
              steps: { type: 'integer', description: 'Total steps for pulse (Euclidean).' },
              pulses: { type: 'integer', description: 'Number of pulses for pulse (Euclidean).' },
              rotation: { type: 'integer', description: 'Rotation offset for pulse.' },
              hits: { type: 'array', items: { type: 'number' }, description: 'Step positions for sequence base.' },
              density: { type: 'number', description: 'Hit probability (0-1) for probability base.' },
              name: { type: 'string', description: 'Archetype name for archetype base.' },
            },
            required: ['type'],
          },
          layers: {
            type: 'array',
            description: 'Transformation layers applied in order.',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', description: 'Layer type.' },
                values: { type: 'array', items: { type: 'number' }, description: 'Values for velocity_cycle.' },
                positions: { type: 'array', items: { type: 'number' }, description: 'Step positions for accent.' },
                amount: { type: 'number', description: 'Amount for accent or swing.' },
                n: { type: 'integer', description: 'Skip interval for skip_every.' },
                offset: { type: 'integer', description: 'Offset for skip_every.' },
                timing: { type: 'number', description: 'Timing jitter (0-1) for humanize.' },
                velocity: { type: 'number', description: 'Velocity jitter (0-1) for humanize or ghost velocity.' },
                notes: { type: 'array', items: { type: 'integer' }, description: 'MIDI pitches for pitch_pattern.' },
                mode: { type: 'string', description: '"cycle" or "random" for pitch_pattern.' },
                probability: { type: 'number', description: 'Probability (0-1) for ghost_notes.' },
                from: { type: 'number', description: 'Start density for density_ramp.' },
                to: { type: 'number', description: 'End density for density_ramp.' },
              },
              required: ['type'],
            },
          },
          bars: { type: 'integer', description: 'Number of bars (default 1).' },
        },
        required: ['base', 'layers'],
      },
      dynamic: {
        type: 'string',
        description:
          'Dynamic shape name — applies a velocity contour as post-processing. ' +
          'Options: accent_downbeats, accent_backbeat, accent_offbeats, crescendo, decrescendo, ' +
          'ghost_verse, push_pull, swell. Applied after archetype/generator/groove/humanize.',
      },
    },
    required: ['trackId', 'description'],
  },
};

const editPatternTool: ToolSchema = {
  name: 'edit_pattern',
  description:
    'Non-destructively add, remove, or modify individual events in a pattern without replacing the whole thing. ' +
    'Use this for surgical edits (adding a ghost hit, tweaking one velocity, adding a param lock to one step). ' +
    'For writing a whole new pattern, use sketch instead. Takes effect after this response.',
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: 'Target track — use ordinal label (e.g. "Track 1") or internal ID.',
      },
      patternId: {
        type: 'string',
        description: 'Pattern ID to edit. Defaults to active pattern if omitted.',
      },
      operations: {
        type: 'array',
        description: 'Batch of add/remove/modify operations. All applied as one undo group.',
        items: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['add', 'remove', 'modify'],
              description: '"add" inserts an event, "remove" deletes it, "modify" changes properties in place.',
            },
            step: {
              description: 'Step position (number or string). Accepts either a 0-based step number (e.g. 4, supports fractional values like 4.1 for microtiming) or a "bar.beat.sixteenth" string (e.g. "1.1.1" = step 0, "3.2.1" = step 36). For remove/modify, matches the nearest event within tolerance (0.001). Prefer bar.beat.sixteenth for multi-bar patterns.',
            },
            event: {
              type: 'object',
              description: 'Gate event to add/remove/modify. Omit to only affect parameter locks.',
              properties: {
                type: {
                  type: 'string',
                  enum: ['trigger', 'note'],
                  description: '"trigger" for percussion, "note" for melodic.',
                },
                pitch: {
                  type: 'integer',
                  description: 'MIDI pitch (0-127). For note events.',
                },
                velocity: {
                  type: 'number',
                  description: 'Velocity (0.0-1.0).',
                },
                accent: {
                  type: 'boolean',
                  description: 'Accent flag (trigger events only).',
                },
                duration: {
                  type: 'number',
                  description: 'Note duration in steps. Controls gate length: 0.25 = staccato, 0.5 = normal, 1.0 = legato, 2.0+ = sustained. For note events.',
                },
              },
            },
            params: {
              type: 'array',
              description: 'Parameter locks to add/modify/remove at this step.',
              items: {
                type: 'object',
                properties: {
                  controlId: {
                    type: 'string',
                    description: 'Control ID for the parameter lock.',
                  },
                  value: {
                    type: 'number',
                    description: 'Parameter value (0.0-1.0).',
                  },
                },
                required: ['controlId', 'value'],
              },
            },
          },
          required: ['action', 'step'],
        },
      },
      description: {
        type: 'string',
        description: 'Short description of the edit (e.g. "add ghost hit on step 7").',
      },
    },
    required: ['trackId', 'operations', 'description'],
  },
};

const listenTool: ToolSchema = {
  name: 'listen',
  description:
    'Render audio offline and send to an evaluator for qualitative judgment. ' +
    'Works whether or not the transport is playing. ' +
    'Changes you make in this turn aren\'t audible yet — listen in a follow-up turn to hear your edits. ' +
    'Key modes: (1) basic — ask a question about the current sound, (2) lens — focus on low-end, rhythm, harmony, texture, or dynamics, ' +
    '(3) compare — render before/after audio to evaluate an edit (e.g. "did the bass get warmer?"). ' +
    'Compare mode is the recommended way to verify your changes improved the sound.',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'What to evaluate (e.g. "how does the kick sound?", "is the mix balanced?").',
      },
      bars: {
        type: 'integer',
        description: 'Number of bars to render (1-16, default 2).',
      },
      trackIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional tracks to render in isolation (e.g. ["Track 1", "Track 2"]). Omit to hear all unmuted tracks.',
      },
      lens: {
        type: 'string',
        enum: ['full-mix', 'low-end', 'rhythm', 'harmony', 'texture', 'dynamics'],
        description: 'Focus the evaluation on a specific aspect of the audio.',
      },
      compare: {
        type: 'object',
        description: 'Before/after comparison. Renders audio from a previous session state and the current state, concatenates them with silence, and sends both to the evaluator. Use after making edits to hear whether they improved things. Example: { beforeSessionIndex: 0, question: "did adding Rings make the texture richer?" }.',
        properties: {
          beforeSessionIndex: {
            type: 'integer',
            description: 'Index into the undo stack for the "before" state. Use 0 for the state before the most recent action group.',
          },
          question: {
            type: 'string',
            description: 'What to compare (e.g. "did the bass get warmer?", "which groove is tighter?", "is the new pattern better?").',
          },
        },
      },
      rubric: {
        type: 'boolean',
        description: 'When true, returns structured scores (groove, clarity, energy, coherence, space) on a 1-5 scale plus actionable suggestions. Use for systematic evaluation rather than open-ended critique.',
      },
    },
    required: ['question'],
  },
};

const setTransportTool: ToolSchema = {
  name: 'set_transport',
  description:
    'Change tempo, swing, time signature, or transport mode (pattern/song). Takes effect after this response.',
  parameters: {
    type: 'object',
    properties: {
      bpm: {
        type: 'number',
        description: 'Tempo in beats per minute (20-300).',
      },
      swing: {
        type: 'number',
        description: 'Swing amount (0.0-1.0, where 0 is straight).',
      },
      mode: {
        type: 'string',
        enum: ['pattern', 'song'],
        description: 'Transport mode. "pattern" loops the active pattern; "song" plays through the sequence.',
      },
      timeSignatureNumerator: {
        type: 'number',
        description: 'Beats per bar (1-16). E.g. 3 for 3/4 time.',
      },
      timeSignatureDenominator: {
        type: 'number',
        description: 'Beat unit (2, 4, 8, or 16). E.g. 4 for quarter-note beats.',
      },
    },
  },
};

const setModelTool: ToolSchema = {
  name: 'set_model',
  description:
    'Switch the mode of a module. Without processorId/modulatorId, changes the track synthesis engine. With processorId, changes the processor\'s mode. With modulatorId, changes the modulator\'s mode. Takes effect after this response.',
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: 'Target track — use ordinal label (e.g. "Track 1") or internal ID.',
      },
      model: {
        type: 'string',
        description:
          'Model/mode ID. For track: virtual-analog, waveshaping, fm, grain-formant, harmonic, wavetable, ' +
          'chords, vowel-speech, swarm, filtered-noise, particle-dust, ' +
          'inharmonic-string, modal-resonator, analog-bass-drum, analog-snare, analog-hi-hat. ' +
          'For Rings processor: modal, sympathetic-string, string, fm-voice, sympathetic-quantized, string-and-reverb. ' +
          'For Clouds processor: granular, pitch-shifter, looping-delay, spectral. ' +
          'For Tides modulator: ad, looping, ar.',
      },
      processorId: {
        type: 'string',
        description: 'Processor ID to target. When provided, switches the processor\'s mode instead of the track\'s synthesis engine.',
      },
      modulatorId: {
        type: 'string',
        description: 'Modulator ID to target. When provided, switches the modulator\'s mode (e.g. ad, looping, ar for Tides).',
      },
    },
    required: ['trackId', 'model'],
  },
};

const transformTool: ToolSchema = {
  name: 'transform',
  description:
    'Transform an existing pattern on a track. Use this to modify patterns structurally (rotate, transpose, reverse, duplicate) rather than rewriting them.',
  parameters: {
    type: 'object',
    properties: {
      trackId: { type: 'string', description: 'Target track — use ordinal label (e.g. "Track 1") or internal ID.' },
      operation: { type: 'string', description: 'Transform operation: "rotate" (shift events in time), "transpose" (shift pitch), "reverse" (mirror positions), "duplicate" (repeat pattern), "humanize" (velocity/timing jitter), "euclidean" (generate Euclidean rhythm), "ghost_notes" (add low-velocity hits around accents), "swing" (delay off-beats), "thin" (probabilistically remove events), "densify" (fill empty steps).' },
      steps: { type: 'integer', description: 'For rotate: number of steps to shift (positive=forward, negative=backward). Required for rotate, rejected for other operations.' },
      semitones: { type: 'integer', description: 'For transpose: semitones to shift (positive=up, negative=down). Required for transpose, rejected for other operations.' },
      velocity_amount: { type: 'number', description: 'For humanize: velocity jitter amount (0-1). Default 0.3.' },
      timing_amount: { type: 'number', description: 'For humanize: timing jitter amount (0-1). Default 0.1.' },
      hits: { type: 'integer', description: 'For euclidean: number of hits to distribute across the pattern length.' },
      rotation: { type: 'integer', description: 'For euclidean: rotation offset (0 to steps-1). Default 0.' },
      velocity: { type: 'number', description: 'For euclidean/ghost_notes/densify: velocity of generated events (0-1).' },
      probability: { type: 'number', description: 'For ghost_notes/thin/densify: probability (0-1). Controls how likely each candidate position is affected.' },
      amount: { type: 'number', description: 'For swing: swing amount (0-1). 0=straight, 1=maximum triplet feel.' },
      description: { type: 'string', description: 'Short description of the transform intent.' },
    },
    required: ['trackId', 'operation', 'description'],
  },
};

// --- Merged CRUD tools ---

const manageProcessorTool: ToolSchema = {
  name: 'manage_processor',
  description:
    'Add, remove, or replace a processor module in a track\'s signal chain. Takes effect after this response.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'remove', 'replace', 'bypass'],
        description: 'Operation to perform. "bypass" toggles the processor enabled/disabled state.',
      },
      trackId: {
        type: 'string',
        description: 'Target track — use ordinal label (e.g. "Track 1") or internal ID.',
      },
      moduleType: {
        type: 'string',
        description: 'Required for add and replace. Available: "rings" (Mutable Instruments Rings resonator), "clouds" (Mutable Instruments Clouds granular processor), "ripples" (Mutable Instruments Ripples analog filter — LP/BP/HP), "eq" (parametric EQ — 4-band and 8-band mixing), "compressor" (dynamics compressor with character modes), "stereo" (stereo width and spatial effects), "chorus" (chorus, flanger, and phaser), "distortion" (overdrive, saturation, and bitcrusher), "warps" (signal combiner — ring mod, wavefolder, freq shift), "elements" (Mutable Instruments Elements physical modeling synthesizer — exciter + resonator), "beads" (Mutable Instruments Beads — granular, delay, reverb; Clouds successor).',
      },
      processorId: {
        type: 'string',
        description: 'Required for remove and replace. The processor ID to target (visible in project state).',
      },
      enabled: {
        type: 'boolean',
        description: 'Set to false to bypass the processor (audio skips it). Set to true to re-enable. Only valid with action "add" (to add bypassed) or as a standalone toggle when processorId is given.',
      },
      description: {
        type: 'string',
        description: 'Short description (e.g. "add Rings resonator for metallic texture").',
      },
    },
    required: ['action', 'trackId', 'description'],
  },
};

const manageModulatorTool: ToolSchema = {
  name: 'manage_modulator',
  description:
    'Add or remove a modulator module (LFO/envelope) on a track. Use modulation_route to wire it up after adding. Takes effect after this response.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'remove'],
        description: 'Operation to perform.',
      },
      trackId: {
        type: 'string',
        description: 'Target track — use ordinal label (e.g. "Track 1") or internal ID.',
      },
      moduleType: {
        type: 'string',
        description: 'Required for add. Available: "tides" (Mutable Instruments Tides — function generator with LFO/envelope modes).',
      },
      modulatorId: {
        type: 'string',
        description: 'Required for remove. The modulator ID to remove (visible in project state).',
      },
      description: {
        type: 'string',
        description: 'Short description (e.g. "add Tides LFO for slow timbre sweep").',
      },
    },
    required: ['action', 'trackId', 'description'],
  },
};

const modulationRouteTool: ToolSchema = {
  name: 'modulation_route',
  description:
    'Connect or disconnect a modulation routing. Connect routes a modulator\'s output to a target parameter (idempotent: same modulator + target updates depth). Disconnect removes a routing by ID. Takes effect after this response.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['connect', 'disconnect'],
        description: 'Operation to perform.',
      },
      trackId: {
        type: 'string',
        description: 'Target track — use ordinal label (e.g. "Track 1") or internal ID.',
      },
      modulatorId: {
        type: 'string',
        description: 'Required for connect. The modulator ID to route from.',
      },
      modulationId: {
        type: 'string',
        description: 'Required for disconnect. The modulation routing ID to remove (visible in project state).',
      },
      targetKind: {
        type: 'string',
        description: 'Required for connect. "source" for the track\'s Plaits source, or "processor" for a processor module.',
      },
      processorId: {
        type: 'string',
        description: 'Required for connect when targetKind is "processor". The processor ID to target.',
      },
      targetParam: {
        type: 'string',
        description:
          `Required for connect. The parameter to modulate. ` +
          `Source (Plaits): ${quoted(plaitsParamIds)}. ` +
          `Processor: depends on type (Rings: ${quoted(ringsParamIds)}; Clouds: ${quoted(cloudsParamIds)}; Ripples: ${quoted(ripplesParamIds)}; EQ: ${quoted(eqParamIds)}; Compressor: ${quoted(compressorParamIds)}; Stereo: ${quoted(stereoParamIds)}; Chorus: ${quoted(chorusParamIds)}; Distortion: ${quoted(distortionParamIds)}; Warps: ${quoted(warpsParamIds)}; Elements: ${quoted(elementsParamIds)}; Beads: ${quoted(beadsParamIds)}).`,
      },
      depth: {
        type: 'number',
        description: 'Required for connect. Modulation depth (-1.0 to 1.0). Prefer shallow values (0.1-0.3). Negative inverts.',
      },
      description: {
        type: 'string',
        description: 'Short description (e.g. "route Tides to timbre for slow sweep").',
      },
    },
    required: ['action', 'trackId', 'description'],
  },
};

const manageViewTool: ToolSchema = {
  name: 'manage_view',
  description:
    'Add or remove a sequencer view on a track. Use after sketching a pattern to make it visible.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'remove'],
        description: 'Operation to perform.',
      },
      trackId: {
        type: 'string',
        description: 'Target track — use ordinal label (e.g. "Track 1") or internal ID.',
      },
      viewKind: {
        type: 'string',
        description: 'Required for add. View type: "step-grid".',
      },
      viewId: {
        type: 'string',
        description: 'Required for remove. The view ID to remove.',
      },
      description: {
        type: 'string',
        description: 'Short description (e.g. "show kick pattern in step grid").',
      },
    },
    required: ['action', 'trackId', 'description'],
  },
};

const setSurfaceTool: ToolSchema = {
  name: 'set_surface',
  description:
    'Define semantic controls for a track\'s UI surface. Semantic controls are virtual knobs that blend multiple underlying parameters. Does not require agency. Takes effect after this response.',
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: 'Target track — use ordinal label (e.g. "Track 1") or internal ID.',
      },
      semanticControls: {
        type: 'array',
        description: 'Array of semantic control definitions. Each control blends one or more underlying parameters via weighted sums.',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Human-readable label for the control (e.g. "Warmth", "Attack").',
            },
            weights: {
              type: 'array',
              description: 'Weighted parameter mappings. Weights must sum to 1.0.',
              items: {
                type: 'object',
                properties: {
                  moduleId: { type: 'string', description: '"source" for track params, or a processor ID.' },
                  controlId: { type: 'string', description: 'The parameter to blend (e.g. "timbre", "structure").' },
                  weight: { type: 'number', description: 'Blend weight (0.0-1.0). All weights in one control must sum to 1.0.' },
                  transform: { type: 'string', description: 'Transform: "linear" (default), "inverse", or "bipolar".' },
                },
                required: ['moduleId', 'controlId', 'weight'],
              },
            },
            range: {
              type: 'object',
              description: 'Optional value range override.',
              properties: {
                min: { type: 'number' },
                max: { type: 'number' },
                default: { type: 'number' },
              },
            },
          },
          required: ['name', 'weights'],
        },
      },
      xyAxes: {
        type: 'object',
        description: 'Optional axis labels for the XY pad.',
        properties: {
          x: { type: 'string', description: 'X-axis semantic label.' },
          y: { type: 'string', description: 'Y-axis semantic label.' },
        },
        required: ['x', 'y'],
      },
      description: {
        type: 'string',
        description: 'Short description of the surface configuration.',
      },
    },
    required: ['trackId', 'semanticControls', 'description'],
  },
};

const pinControlTool: ToolSchema = {
  name: 'pin_control',
  description:
    'Pin or unpin a raw module control on the track\'s surface. Max 4 pins per track. Does not require agency.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['pin', 'unpin'],
        description: 'Operation to perform.',
      },
      trackId: { type: 'string', description: 'Target track — use ordinal label (e.g. "Track 1") or internal ID.' },
      moduleId: { type: 'string', description: '"source" for track params, or a processor ID.' },
      controlId: { type: 'string', description: 'The control to pin or unpin (e.g. "timbre", "structure").' },
    },
    required: ['action', 'trackId', 'moduleId', 'controlId'],
  },
};

const labelAxesTool: ToolSchema = {
  name: 'label_axes',
  description:
    'Set semantic labels for the track\'s XY pad axes. Does not require agency.',
  parameters: {
    type: 'object',
    properties: {
      trackId: { type: 'string', description: 'Target track — use ordinal label (e.g. "Track 1") or internal ID.' },
      x: { type: 'string', description: 'X-axis semantic label (e.g. "Brightness").' },
      y: { type: 'string', description: 'Y-axis semantic label (e.g. "Texture").' },
    },
    required: ['trackId', 'x', 'y'],
  },
};

const manageSendTool: ToolSchema = {
  name: 'manage_send',
  description:
    'Add, remove, or set the level of a post-fader send from a track to a bus track. Takes effect after this response.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'remove', 'set_level'],
        description: 'Operation to perform.',
      },
      trackId: {
        type: 'string',
        description: 'Source track — use ordinal label (e.g. "Track 1") or internal ID.',
      },
      busId: {
        type: 'string',
        description: 'Target bus track ID (e.g. "bus-1710342000000" or "master-bus").',
      },
      level: {
        type: 'number',
        description: 'Send level (0.0-1.0). Required for add and set_level.',
      },
    },
    required: ['action', 'trackId', 'busId'],
  },
};

const setMasterTool: ToolSchema = {
  name: 'set_master',
  description:
    'Set master channel volume and/or pan. Takes effect after this response.',
  parameters: {
    type: 'object',
    properties: {
      volume: {
        type: 'number',
        description: 'Master volume (0.0-1.0, linear gain).',
      },
      pan: {
        type: 'number',
        description: 'Master pan (-1.0 left to 1.0 right).',
      },
    },
  },
};

const managePatternTool: ToolSchema = {
  name: 'manage_pattern',
  description:
    'Add, remove, duplicate, rename, set active, set length, or clear a pattern on a track. Takes effect after this response.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'remove', 'duplicate', 'rename', 'set_active', 'set_length', 'clear'],
        description: 'Operation to perform.',
      },
      trackId: {
        type: 'string',
        description: 'Target track — use ordinal label (e.g. "Track 1") or internal ID.',
      },
      patternId: {
        type: 'string',
        description: 'Pattern ID to target. Required for remove, duplicate, rename, set_active.',
      },
      name: {
        type: 'string',
        description: 'New pattern name. Required for rename.',
      },
      length: {
        type: 'integer',
        description: 'Pattern length in steps (1-64). Required for set_length.',
      },
      description: {
        type: 'string',
        description: 'Short description of the operation.',
      },
    },
    required: ['action', 'trackId', 'description'],
  },
};

const manageSequenceTool: ToolSchema = {
  name: 'manage_sequence',
  description:
    'Manage the arrangement sequence on a track: append a pattern reference, remove a reference by index, or reorder references. Takes effect after this response.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['append', 'remove', 'reorder'],
        description: 'Operation to perform.',
      },
      trackId: {
        type: 'string',
        description: 'Target track — use ordinal label (e.g. "Track 1") or internal ID.',
      },
      patternId: {
        type: 'string',
        description: 'Pattern ID to append. Required for append.',
      },
      sequenceIndex: {
        type: 'integer',
        description: 'Index into the sequence array. Required for remove and reorder (as fromIndex).',
      },
      toIndex: {
        type: 'integer',
        description: 'Destination index. Required for reorder.',
      },
      description: {
        type: 'string',
        description: 'Short description of the operation.',
      },
    },
    required: ['action', 'trackId', 'description'],
  },
};

const setTrackMetaTool: ToolSchema = {
  name: 'set_track_meta',
  description:
    'Set track metadata and mix properties in a single call: name (rename), volume, pan, muted, solo, approval (editability), importance (mix priority 0-1), and/or musicalRole (e.g. "driving rhythm", "ambient pad"). ' +
    'Example: set_track_meta(trackId: "Track 1", name: "Kick", volume: 0.85) or set_track_meta(trackId: "Track 1", importance: 0.8, musicalRole: "main kick"). Approval requires agency ON and a reason.',
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: 'Target track — use ordinal label (e.g. "Track 1") or internal ID.',
      },
      name: {
        type: 'string',
        description: 'Display name for the track (e.g. "Kick", "Hi-Hat", "Bass", "Reverb Bus").',
      },
      volume: {
        type: 'number',
        description: 'Track volume (0.0-1.0, linear gain).',
      },
      pan: {
        type: 'number',
        description: 'Track pan (-1.0 left to 1.0 right, 0.0 center).',
      },
      approval: {
        type: 'string',
        enum: ['exploratory', 'liked', 'approved', 'anchor'],
        description: 'Approval level. exploratory=freely editable, liked=preserve unless asked, approved=preserve during expansion, anchor=core identity.',
      },
      importance: {
        type: 'number',
        description: 'How important this track is to the mix (0.0-1.0). Higher = more essential.',
      },
      musicalRole: {
        type: 'string',
        description: 'Brief description of the track\'s musical role (e.g. "driving rhythm", "ambient pad").',
      },
      muted: {
        type: 'boolean',
        description: 'Set the track muted state. true = muted (silent), false = unmuted.',
      },
      solo: {
        type: 'boolean',
        description: 'Set the track solo state. true = solo (only this track audible), false = unsolo.',
      },
      reason: {
        type: 'string',
        description: 'Required when setting approval. Why this approval level is appropriate.',
      },
    },
    required: ['trackId'],
  },
};

const renderTool: ToolSchema = {
  name: 'render',
  description:
    'Capture an audio snapshot. Returns a snapshotId for use with analyze. ' +
    'Cheap — use freely. Scope to specific tracks for isolation (e.g. scope: "Track 1") or omit for full mix. ' +
    'Changes you make in this turn aren\'t audible yet — render in a follow-up turn to capture your edits.',
  parameters: {
    type: 'object',
    properties: {
      scope: {
        description: 'Track reference (e.g. "Track 1"), array of references (["Track 1", "Track 2"]), or omit for full mix. Use the narrowest scope that answers your question.',
      },
      bars: {
        type: 'integer',
        description: 'Duration to render in bars (1-16, default 2). Spectral: 1-2 bars. Dynamics/rhythm: 2-4 bars.',
      },
    },
  },
};

const analyzeTool: ToolSchema = {
  name: 'analyze',
  description:
    'Run deterministic audio analysis on a rendered snapshot. Supports spectral (timbral), dynamics (loudness/range), rhythm (onset/tempo), masking (cross-track frequency conflicts), and diff (before/after comparison) in a single call. ' +
    'Use render first to capture a snapshot, then analyze for quantitative measurement. ' +
    'For masking analysis, render each track separately first, then pass all snapshot IDs via snapshotIds. ' +
    'For diff analysis, pass snapshotId (after) and compareSnapshotId (before) to compare two snapshots. ' +
    'For qualitative AI evaluation, use listen instead.',
  parameters: {
    type: 'object',
    properties: {
      snapshotId: {
        type: 'string',
        description: 'Snapshot ID from a previous render call. Used for spectral, dynamics, rhythm, and diff (as the "after" snapshot) analysis.',
      },
      compareSnapshotId: {
        type: 'string',
        description: 'Snapshot ID for the "before" state in diff analysis. When type includes "diff", both snapshotId (after) and compareSnapshotId (before) are required.',
      },
      snapshotIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Multiple snapshot IDs for cross-track analysis (masking). Render each track separately, then pass all IDs here. Each snapshot must have a single-track scope.',
      },
      types: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['spectral', 'dynamics', 'rhythm', 'masking', 'diff'],
        },
        description: 'Analysis types to run. Spectral: centroid, rolloff, flatness, bandwidth, pitch. Dynamics: LUFS, RMS, peak, crest factor. Rhythm: tempo estimate, onsets, density, swing. Masking: cross-track frequency conflict detection (requires snapshotIds). Diff: before/after comparison with structured deltas (requires snapshotId + compareSnapshotId).',
      },
    },
    required: ['types'],
  },
};

const explainChainTool: ToolSchema = {
  name: 'explain_chain',
  description:
    'Describe a track\'s signal chain in musical language (source → processors → modulators → routings). Read-only. Use to understand what a track does before modifying it.',
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: 'Target track — use ordinal label (e.g. "Track 1") or internal ID.',
      },
    },
    required: ['trackId'],
  },
};

const simplifyChainTool: ToolSchema = {
  name: 'simplify_chain',
  description:
    'Analyze a track\'s signal chain for redundant or no-op processors and suggest removals. Read-only. Use when a chain feels cluttered or you want to reduce latency.',
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: 'Target track — use ordinal label (e.g. "Track 1") or internal ID.',
      },
    },
    required: ['trackId'],
  },
};

const manageTrackTool: ToolSchema = {
  name: 'manage_track',
  description:
    'Add or remove a track. Audio tracks produce sound; bus tracks receive audio via sends. Takes effect after this response.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'remove'],
        description: 'Operation to perform.',
      },
      kind: {
        type: 'string',
        enum: ['audio', 'bus'],
        description: 'Required for add. Type of track to create.',
      },
      trackId: {
        type: 'string',
        description: 'Required for remove. The track ID to remove (visible in project state).',
      },
      label: {
        type: 'string',
        description: 'Optional display name for the new track (e.g. "Kick", "Reverb Bus").',
      },
      description: {
        type: 'string',
        description: 'Short description (e.g. "add audio track for bass line").',
      },
    },
    required: ['action', 'description'],
  },
};

const raiseDecisionTool: ToolSchema = {
  name: 'raise_decision',
  description:
    'Flag an unresolved question or choice that needs human input. Use when you encounter a subjective choice you should not make alone.',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The question or decision that needs human input.',
      },
      context: {
        type: 'string',
        description: 'Why this decision matters for the current session.',
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Possible options the AI sees, if any.',
      },
      trackIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Which track(s) this decision relates to, if any.',
      },
    },
    required: ['question'],
  },
};

const reportBugTool: ToolSchema = {
  name: 'report_bug',
  description:
    'Report a bug or issue encountered during operation. Use sparingly — only for things that seem genuinely broken (silent tool failures, unexpected audio output, state inconsistencies). Not for subjective preferences or feature requests.',
  parameters: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'One-line description of the issue.',
      },
      category: {
        type: 'string',
        enum: ['audio', 'state', 'tool', 'ui', 'other'],
        description: 'Issue category: audio (unexpected sound/silence), state (data inconsistency), tool (tool failure/wrong result), ui (display issue), other.',
      },
      details: {
        type: 'string',
        description: 'What happened and what was expected.',
      },
      severity: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'low = cosmetic/minor, medium = functional issue with workaround, high = blocks workflow.',
      },
      context: {
        type: 'string',
        description: 'Optional: relevant state at the time (e.g. track config, parameter values, tool args).',
      },
    },
    required: ['summary', 'category', 'details', 'severity'],
  },
};

const setIntentTool: ToolSchema = {
  name: 'set_intent',
  description:
    'Set or update the session-level creative intent. Use this to record the genre, references, mood, things to avoid, and the current creative goal. ' +
    'Updates are merged: fields you provide overwrite previous values, fields you omit are preserved. ' +
    'Call this early in a session when you understand the direction, and update it as the session evolves.',
  parameters: {
    type: 'object',
    properties: {
      genre: {
        type: 'array',
        items: { type: 'string' },
        description: 'Genre tags (e.g. ["dubstep", "hyperdub", "uk bass"]).',
      },
      references: {
        type: 'array',
        items: { type: 'string' },
        description: 'Artist or track references (e.g. ["Kode9", "Burial"]).',
      },
      mood: {
        type: 'array',
        items: { type: 'string' },
        description: 'Mood descriptors (e.g. ["dark", "sparse", "roomy"]).',
      },
      avoid: {
        type: 'array',
        items: { type: 'string' },
        description: 'Things to avoid (e.g. ["busy hats", "four-on-floor"]).',
      },
      currentGoal: {
        type: 'string',
        description: 'The current creative objective (e.g. "build a half-step beat").',
      },
    },
  },
};

const setScaleTool: ToolSchema = {
  name: 'set_scale',
  description:
    'Set the global scale/key constraint. When set, note pitches in sketch and edit_pattern are auto-quantized to the nearest in-scale degree. ' +
    'Set to null for chromatic/atonal work. Updates are atomic — the entire scale is replaced.',
  parameters: {
    type: 'object',
    properties: {
      root: {
        type: 'integer',
        description: 'Root note as pitch class: 0=C, 1=C#, 2=D, 3=D#, 4=E, 5=F, 6=F#, 7=G, 8=G#, 9=A, 10=A#, 11=B.',
      },
      mode: {
        type: 'string',
        enum: [
          'major', 'minor', 'dorian', 'phrygian', 'lydian',
          'mixolydian', 'aeolian', 'locrian',
          'harmonic-minor', 'melodic-minor',
          'pentatonic', 'minor-pentatonic', 'blues',
          'chromatic', 'whole-tone',
        ],
        description: 'Scale mode.',
      },
      clear: {
        type: 'boolean',
        description: 'Set to true to clear the scale constraint (chromatic/atonal). When true, root and mode are ignored.',
      },
    },
  },
};

const setSectionTool: ToolSchema = {
  name: 'set_section',
  description:
    'Set or update the current section metadata. Describes what part of the arrangement you\'re working in and its target character. ' +
    'Updates are merged: fields you provide overwrite previous values, fields you omit are preserved.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Section name (e.g. "intro", "groove", "breakdown", "drop").',
      },
      intent: {
        type: 'string',
        description: 'Section character intent (e.g. "sparse and tense", "peak energy").',
      },
      targetEnergy: {
        type: 'number',
        description: 'Target energy level for this section (0.0-1.0).',
      },
      targetDensity: {
        type: 'number',
        description: 'Target rhythmic density for this section (0.0-1.0).',
      },
    },
  },
};

const applyChainRecipeTool: ToolSchema = {
  name: 'apply_chain_recipe',
  description:
    'Apply a pre-configured signal chain recipe. Clears existing processors and adds the recipe\'s chain with optimized settings. ' +
    'Use this for quick setup of common mixing/sound design chains instead of manually adding processors one by one.',
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: 'Target track — use ordinal label (e.g. "Track 1") or internal ID.',
      },
      recipe: {
        type: 'string',
        description: 'Recipe name.',
        enum: RECIPE_NAMES,
      },
    },
    required: ['trackId', 'recipe'],
  },
};

const setMixRoleTool: ToolSchema = {
  name: 'set_mix_role',
  description:
    'Apply a mix role preset to a track. Sets volume and pan to role-appropriate defaults. ' +
    'Use this to quickly establish mix balance across tracks.',
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: 'Target track — use ordinal label (e.g. "Track 1") or internal ID.',
      },
      role: {
        type: 'string',
        description: 'Mix role name.',
        enum: ROLE_NAMES,
      },
    },
    required: ['trackId', 'role'],
  },
};

const applyModulationTool: ToolSchema = {
  name: 'apply_modulation',
  description:
    'Apply a pre-configured modulation recipe. Adds a Tides modulator with preset parameters and connects it to the appropriate target. ' +
    'For recipes that target a processor (e.g. filter sweep), a matching processor must already exist on the track, or provide processorId to target a specific one.',
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: 'Target track — use ordinal label (e.g. "Track 1") or internal ID.',
      },
      recipe: {
        type: 'string',
        description: 'Modulation recipe name.',
        enum: MODULATION_RECIPE_NAMES,
      },
      processorId: {
        type: 'string',
        description: 'Optional: specific processor ID to target for processor-targeted recipes. If omitted, auto-finds the first matching processor type.',
      },
    },
    required: ['trackId', 'recipe'],
  },
};

import { getTimbralDirections } from '../engine/timbral-vocabulary';

const shapeTimbreTool: ToolSchema = {
  name: 'shape_timbre',
  description:
    'Move a track\'s timbre in a musical direction. Translates musical descriptors ' +
    '(darker, brighter, thicker, etc.) to appropriate parameter changes for the active ' +
    'synthesis model. Applies to the source synth and optionally to processors in the chain.',
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: 'Track to shape. Use "Track N" (1-indexed) or internal ID.',
      },
      direction: {
        type: 'string',
        enum: getTimbralDirections(),
        description: 'Musical direction to move the timbre.',
      },
      amount: {
        type: 'number',
        description: 'Scale factor (0.0-1.0, default 0.3). Higher values produce more dramatic changes.',
      },
    },
    required: ['trackId', 'direction'],
  },
};

const assignSpectralSlotTool: ToolSchema = {
  name: 'assign_spectral_slot',
  description:
    'Assign a track to frequency bands with a priority. Prevents frequency collisions: ' +
    'when multiple tracks share a band, lower-priority tracks receive gentle EQ attenuation suggestions. ' +
    'Returns collision info and EQ adjustments to apply via move or manage_processor.',
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: 'Target track — use ordinal label (e.g. "Track 1") or internal ID.',
      },
      bands: {
        type: 'array',
        description: `Frequency bands this track should occupy. Available bands: ${FREQUENCY_BANDS.map(b => `"${b}"`).join(', ')}.`,
        items: { type: 'string' },
      },
      priority: {
        type: 'integer',
        description: 'Priority (0-10). Higher priority wins shared bands. Kick=10, bass=8, lead=7, pad=3, texture=1.',
      },
    },
    required: ['trackId', 'bands', 'priority'],
  },
};

export const GLUON_TOOLS: ToolSchema[] = [
  moveTool,
  sketchTool,
  editPatternTool,
  transformTool,
  listenTool,
  setTransportTool,
  setModelTool,
  manageProcessorTool,
  manageModulatorTool,
  modulationRouteTool,
  manageViewTool,
  setSurfaceTool,
  pinControlTool,
  labelAxesTool,
  manageSendTool,
  setMasterTool,
  managePatternTool,
  manageSequenceTool,
  renderTool,
  analyzeTool,
  setTrackMetaTool,
  explainChainTool,
  simplifyChainTool,
  manageTrackTool,
  raiseDecisionTool,
  reportBugTool,
  setIntentTool,
  setSectionTool,
  setScaleTool,
  applyChainRecipeTool,
  setMixRoleTool,
  applyModulationTool,
  shapeTimbreTool,
  assignSpectralSlotTool,
];
