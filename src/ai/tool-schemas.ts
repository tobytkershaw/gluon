// src/ai/tool-schemas.ts — Tool declarations in neutral JSON Schema format.

import type { ToolSchema } from './types';

const moveTool: ToolSchema = {
  name: 'move',
  description:
    'Move a normalized control to a target value. Targets a track source control by default, or a processor control when processorId is provided, or a modulator control when modulatorId is provided. Immediately audible. Takes effect after this response.',
  parameters: {
    type: 'object',
    properties: {
      param: {
        type: 'string',
        description: 'The control ID to change. For track: "timbre", "harmonics", "morph", "frequency". For processors: depends on type (Rings: "structure", "brightness", "damping", "position", "polyphony", "internal-exciter"; Clouds: "position", "size", "density", "feedback", "freeze"). For Tides modulator: "frequency", "shape", "slope", "smoothness".',
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
        description: 'Target track — ordinal (e.g. "Track 1") or internal ID (e.g. "v0"). Defaults to active track if omitted.',
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
    'Apply a rhythmic/melodic pattern to a track using musical events. Takes effect after this response.',
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: 'Target track — ordinal (e.g. "Track 1") or internal ID (e.g. "v0").',
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
          'For chords, place multiple "note" events at the same step with different pitches (up to 4 simultaneous notes).',
        items: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              description: '"trigger" for percussion, "note" for melodic, "parameter" for per-step param lock.',
            },
            at: {
              type: 'integer',
              description: 'Step index (0-based, 16 steps per bar).',
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
              description: 'Note duration as fraction of a step (always 0.25). Required for note events.',
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
    },
    required: ['trackId', 'description', 'events'],
  },
};

const listenTool: ToolSchema = {
  name: 'listen',
  description:
    'Render audio offline and evaluate how it sounds. ' +
    'Works whether or not the transport is playing. ' +
    'Changes you make in this turn aren\'t audible yet — listen in a follow-up turn to hear your edits. ' +
    'Supports focused evaluation via lens and before/after comparison via compare.',
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
        description: 'Optional tracks to render in isolation (e.g. ["Track 1", "Track 2"] or ["v0", "v1"]). Omit to hear all unmuted tracks.',
      },
      lens: {
        type: 'string',
        enum: ['full-mix', 'low-end', 'rhythm', 'harmony', 'texture', 'dynamics'],
        description: 'Focus the evaluation on a specific aspect of the audio.',
      },
      compare: {
        type: 'object',
        description: 'Compare two snapshots (before/after an edit). Renders the before state from the previous session snapshot and the current state, concatenates them with a brief silence, and sends to the evaluator.',
        properties: {
          beforeSessionIndex: {
            type: 'integer',
            description: 'Index into the undo stack for the "before" state. Use 0 for the state before the most recent action group.',
          },
          question: {
            type: 'string',
            description: 'What to compare (e.g. "did the bass get warmer?", "which groove is tighter?").',
          },
        },
      },
    },
    required: ['question'],
  },
};

const setTransportTool: ToolSchema = {
  name: 'set_transport',
  description:
    'Change tempo, swing, time signature, or play/stop state. Takes effect after this response.',
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
        description: 'Target track — ordinal (e.g. "Track 1") or internal ID (e.g. "v0").',
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
      trackId: { type: 'string', description: 'Target track ID (e.g. "v0").' },
      operation: { type: 'string', description: 'Transform operation: "rotate" (shift events in time), "transpose" (shift pitch), "reverse" (mirror positions), "duplicate" (repeat pattern).' },
      steps: { type: 'integer', description: 'For rotate: number of steps to shift (positive=forward, negative=backward). Required for rotate, rejected for other operations.' },
      semitones: { type: 'integer', description: 'For transpose: semitones to shift (positive=up, negative=down). Required for transpose, rejected for other operations.' },
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
        description: 'Target track — ordinal (e.g. "Track 1") or internal ID (e.g. "v0").',
      },
      moduleType: {
        type: 'string',
        description: 'Required for add and replace. Available: "rings" (Mutable Instruments Rings resonator), "clouds" (Mutable Instruments Clouds granular processor).',
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
        description: 'Target track — ordinal (e.g. "Track 1") or internal ID (e.g. "v0").',
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
        description: 'Target track — ordinal (e.g. "Track 1") or internal ID (e.g. "v0").',
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
        description: 'Required for connect. The parameter to modulate. Source: "timbre", "harmonics", "morph". Processor: depends on type.',
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
        description: 'Target track — ordinal (e.g. "Track 1") or internal ID (e.g. "v0").',
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
        description: 'Target track — ordinal (e.g. "Track 1") or internal ID (e.g. "v0").',
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
      trackId: { type: 'string', description: 'Target track ID (e.g. "v0").' },
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
      trackId: { type: 'string', description: 'Target track ID (e.g. "v0").' },
      x: { type: 'string', description: 'X-axis semantic label (e.g. "Brightness").' },
      y: { type: 'string', description: 'Y-axis semantic label (e.g. "Texture").' },
    },
    required: ['trackId', 'x', 'y'],
  },
};

const setTrackMetaTool: ToolSchema = {
  name: 'set_track_meta',
  description:
    'Set track metadata: approval level, importance, and/or musical role in a single call. At least one field required. Approval requires agency ON and a reason.',
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: 'Target track — ordinal (e.g. "Track 1") or internal ID (e.g. "v0").',
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
    'Capture an audio snapshot with explicit scope. Returns a snapshotId that can be passed to analyze or listen. ' +
    'Cheap — use freely before analysis tools. ' +
    'Changes you make in this turn aren\'t audible yet — render in a follow-up turn to capture your edits.',
  parameters: {
    type: 'object',
    properties: {
      scope: {
        description: 'Track reference ("Track 1" or "v0"), array of references (["Track 1", "Track 2"]), or omit for full mix. Use the narrowest scope that answers your question.',
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
    'Run deterministic audio analysis on a rendered snapshot. Supports spectral (timbral), dynamics (loudness/range), and rhythm (onset/tempo) in a single call. ' +
    'Use render first to capture a snapshot, then analyze for quantitative measurement. ' +
    'For qualitative AI evaluation, use listen instead.',
  parameters: {
    type: 'object',
    properties: {
      snapshotId: {
        type: 'string',
        description: 'Snapshot ID from a previous render call.',
      },
      types: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['spectral', 'dynamics', 'rhythm'],
        },
        description: 'Analysis types to run. Spectral: centroid, rolloff, flatness, bandwidth, pitch. Dynamics: LUFS, RMS, peak, crest factor. Rhythm: tempo estimate, onsets, density, swing.',
      },
    },
    required: ['snapshotId', 'types'],
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

export const GLUON_TOOLS: ToolSchema[] = [
  moveTool,
  sketchTool,
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
  renderTool,
  analyzeTool,
  setTrackMetaTool,
  raiseDecisionTool,
];
