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
        description: 'The control ID to change. For track: "brightness", "richness", "texture", "pitch". For processors: depends on type (Rings: "structure", "brightness", "damping", "position"; Clouds: "position", "size", "density", "feedback"). For Tides modulator: "frequency", "shape", "slope", "smoothness".',
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
        description: 'Target track ID (e.g. "v0"). Defaults to active track if omitted.',
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
        description: 'Target track ID (e.g. "v0").',
      },
      description: {
        type: 'string',
        description: 'Short description of the pattern (e.g. "four on the floor kick").',
      },
      events: {
        type: 'array',
        description:
          'Sparse list of musical events. Only include steps you want to set. ' +
          'For drums/percussion, use "trigger" events. For melodic tracks, use "note" events with MIDI pitches.',
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
    'Changes you make in this turn aren\'t audible yet — listen in a follow-up turn to hear your edits.',
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
        description: 'Optional track IDs to render in isolation (e.g. ["v0", "v1"]). Omit to hear all unmuted tracks.',
      },
    },
    required: ['question'],
  },
};

const setTransportTool: ToolSchema = {
  name: 'set_transport',
  description:
    'Change tempo, swing, or play/stop state. Takes effect after this response.',
  parameters: {
    type: 'object',
    properties: {
      bpm: {
        type: 'number',
        description: 'Tempo in beats per minute (60-200).',
      },
      swing: {
        type: 'number',
        description: 'Swing amount (0.0-1.0, where 0 is straight).',
      },
      playing: {
        type: 'boolean',
        description: 'True to start playback, false to stop.',
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
        description: 'Target track ID (e.g. "v0").',
      },
      model: {
        type: 'string',
        description:
          'Model/mode ID. For track: virtual-analog, waveshaping, fm, grain-formant, harmonic, wavetable, ' +
          'chords, vowel-speech, swarm, filtered-noise, particle-dust, ' +
          'inharmonic-string, modal-resonator, analog-bass-drum, analog-snare, analog-hi-hat. ' +
          'For Rings processor: modal, sympathetic-string, string, fm-track, sympathetic-quantized, string-and-reverb. ' +
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

const addViewTool: ToolSchema = {
  name: 'add_view',
  description:
    'Add a sequencer view to a track. Use after sketching a pattern to make it visible in the appropriate editor.',
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: 'Target track ID (e.g. "v0").',
      },
      viewKind: {
        type: 'string',
        description: 'View type: "step-grid".',
      },
      description: {
        type: 'string',
        description: 'Short description (e.g. "show kick pattern in step grid").',
      },
    },
    required: ['trackId', 'viewKind', 'description'],
  },
};

const removeViewTool: ToolSchema = {
  name: 'remove_view',
  description:
    'Remove a sequencer view from a track by its ID.',
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: 'Target track ID (e.g. "v0").',
      },
      viewId: {
        type: 'string',
        description: 'The view ID to remove.',
      },
      description: {
        type: 'string',
        description: 'Short description (e.g. "remove step grid").',
      },
    },
    required: ['trackId', 'viewId', 'description'],
  },
};

const addProcessorTool: ToolSchema = {
  name: 'add_processor',
  description:
    'Add a processor module to a track\'s signal chain (e.g. Rings resonator). The processor processes the track\'s audio output. Takes effect after this response.',
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: 'Target track ID (e.g. "v0").',
      },
      moduleType: {
        type: 'string',
        description: 'Processor type to add. Available: "rings" (Mutable Instruments Rings resonator), "clouds" (Mutable Instruments Clouds granular processor).',
      },
      description: {
        type: 'string',
        description: 'Short description (e.g. "add Rings resonator for metallic texture").',
      },
    },
    required: ['trackId', 'moduleType', 'description'],
  },
};

const removeProcessorTool: ToolSchema = {
  name: 'remove_processor',
  description:
    'Remove a processor module from a track\'s signal chain by its ID. Takes effect after this response.',
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: 'Target track ID (e.g. "v0").',
      },
      processorId: {
        type: 'string',
        description: 'The processor ID to remove (visible in project state).',
      },
      description: {
        type: 'string',
        description: 'Short description (e.g. "remove Rings from kick track").',
      },
    },
    required: ['trackId', 'processorId', 'description'],
  },
};

const replaceProcessorTool: ToolSchema = {
  name: 'replace_processor',
  description:
    'Atomically swap one processor for another type in a track\'s signal chain. Keeps the same chain position. Takes effect after this response.',
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: 'Target track ID (e.g. "v0").',
      },
      processorId: {
        type: 'string',
        description: 'The processor ID to replace (visible in project state).',
      },
      newModuleType: {
        type: 'string',
        description: 'New processor type. Available: "rings", "clouds".',
      },
      description: {
        type: 'string',
        description: 'Short description (e.g. "swap Rings for Clouds on kick track").',
      },
    },
    required: ['trackId', 'processorId', 'newModuleType', 'description'],
  },
};

const addModulatorTool: ToolSchema = {
  name: 'add_modulator',
  description:
    'Add a modulator module (LFO/envelope) to a track. The modulator generates control-rate signals that can be routed to parameters on the source or processors. Use connect_modulator to wire it up after adding. Takes effect after this response.',
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: 'Target track ID (e.g. "v0").',
      },
      moduleType: {
        type: 'string',
        description: 'Modulator type to add. Available: "tides" (Mutable Instruments Tides — function generator with LFO/envelope modes).',
      },
      description: {
        type: 'string',
        description: 'Short description (e.g. "add Tides LFO for slow brightness sweep").',
      },
    },
    required: ['trackId', 'moduleType', 'description'],
  },
};

const removeModulatorTool: ToolSchema = {
  name: 'remove_modulator',
  description:
    'Remove a modulator module from a track by its ID. Also disconnects all routings from this modulator. Takes effect after this response.',
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: 'Target track ID (e.g. "v0").',
      },
      modulatorId: {
        type: 'string',
        description: 'The modulator ID to remove (visible in project state).',
      },
      description: {
        type: 'string',
        description: 'Short description (e.g. "remove LFO from kick track").',
      },
    },
    required: ['trackId', 'modulatorId', 'description'],
  },
};

const connectModulatorTool: ToolSchema = {
  name: 'connect_modulator',
  description:
    'Route a modulator\'s output to a target parameter. Idempotent: calling again with the same modulator + target updates the depth. Human sets center, modulation adds around it. Multiple routings to the same target sum (additive). Strong combined modulation saturates at 0/1 boundaries. Takes effect after this response.',
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: 'Target track ID (e.g. "v0").',
      },
      modulatorId: {
        type: 'string',
        description: 'The modulator ID to route from.',
      },
      targetKind: {
        type: 'string',
        description: 'Target type: "source" for the track\'s Plaits source, or "processor" for a processor module.',
      },
      processorId: {
        type: 'string',
        description: 'Required when targetKind is "processor". The processor ID to target.',
      },
      targetParam: {
        type: 'string',
        description: 'The parameter to modulate. Source: "brightness", "richness", "texture" (pitch excluded). Processor: depends on type (Rings: "structure", "brightness", "damping", "position"; Clouds: "position", "size", "density", "feedback").',
      },
      depth: {
        type: 'number',
        description: 'Modulation depth (-1.0 to 1.0). Prefer shallow values (0.1-0.3) before aggressive ones. Negative depth inverts the modulation.',
      },
      description: {
        type: 'string',
        description: 'Short description (e.g. "route Tides to brightness for slow sweep").',
      },
    },
    required: ['trackId', 'modulatorId', 'targetKind', 'targetParam', 'depth', 'description'],
  },
};

const disconnectModulatorTool: ToolSchema = {
  name: 'disconnect_modulator',
  description:
    'Remove a modulation routing by its ID. Takes effect after this response.',
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: 'Target track ID (e.g. "v0").',
      },
      modulationId: {
        type: 'string',
        description: 'The modulation routing ID to disconnect (visible in project state).',
      },
      description: {
        type: 'string',
        description: 'Short description (e.g. "disconnect brightness modulation").',
      },
    },
    required: ['trackId', 'modulationId', 'description'],
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
        description: 'Target track ID (e.g. "v0").',
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
                  controlId: { type: 'string', description: 'The parameter to blend (e.g. "brightness", "structure").' },
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

const pinTool: ToolSchema = {
  name: 'pin',
  description:
    'Pin a raw module control to the track\'s surface for direct access. Max 4 pins per track. Does not require agency.',
  parameters: {
    type: 'object',
    properties: {
      trackId: { type: 'string', description: 'Target track ID (e.g. "v0").' },
      moduleId: { type: 'string', description: '"source" for track params, or a processor ID.' },
      controlId: { type: 'string', description: 'The control to pin (e.g. "brightness", "structure").' },
    },
    required: ['trackId', 'moduleId', 'controlId'],
  },
};

const unpinTool: ToolSchema = {
  name: 'unpin',
  description:
    'Remove a pinned control from the track\'s surface. Does not require agency.',
  parameters: {
    type: 'object',
    properties: {
      trackId: { type: 'string', description: 'Target track ID (e.g. "v0").' },
      moduleId: { type: 'string', description: '"source" for track params, or a processor ID.' },
      controlId: { type: 'string', description: 'The control to unpin.' },
    },
    required: ['trackId', 'moduleId', 'controlId'],
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

const setImportanceTool: ToolSchema = {
  name: 'set_importance',
  description:
    'Set the musical importance and role of a track in the current mix. Importance is advisory metadata — it does not enforce anything, but helps you make better decisions about what to modify carefully vs. what is open for experimentation.',
  parameters: {
    type: 'object',
    properties: {
      trackId: {
        type: 'string',
        description: 'Target track ID (e.g. "v0").',
      },
      importance: {
        type: 'number',
        description: 'How important this track is to the mix (0.0-1.0). Higher = more essential.',
      },
      musicalRole: {
        type: 'string',
        description: 'Brief description of the track\'s musical role (e.g. "driving rhythm", "ambient pad", "melodic lead").',
      },
    },
    required: ['trackId', 'importance'],
  },
};

const renderTool: ToolSchema = {
  name: 'render',
  description:
    'Capture an audio snapshot with explicit scope. Returns a snapshotId that can be passed to spectral, dynamics, rhythm, or listen for analysis. ' +
    'Cheap — use freely before analysis tools. ' +
    'Changes you make in this turn aren\'t audible yet — render in a follow-up turn to capture your edits.',
  parameters: {
    type: 'object',
    properties: {
      scope: {
        description: 'Track ID ("v0"), array of track IDs (["v0", "v1"]), or omit for full mix. Use the narrowest scope that answers your question.',
      },
      bars: {
        type: 'integer',
        description: 'Duration to render in bars (1-16, default 2). Spectral: 1-2 bars. Dynamics/rhythm: 2-4 bars.',
      },
    },
  },
};

const spectralTool: ToolSchema = {
  name: 'spectral',
  description:
    'Measure timbral characteristics of a rendered audio snapshot. Returns spectral centroid (brightness), ' +
    'rolloff, flatness, bandwidth, fundamental frequency estimate, pitch stability, and signal type classification. ' +
    'Cheap — use after render to verify timbre changes, check pitch, or compare tonal character across tracks.',
  parameters: {
    type: 'object',
    properties: {
      snapshotId: {
        type: 'string',
        description: 'Snapshot ID from a previous render call.',
      },
    },
    required: ['snapshotId'],
  },
};

const dynamicsTool: ToolSchema = {
  name: 'dynamics',
  description:
    'Measure loudness and dynamic range of a rendered audio snapshot. Returns LUFS, RMS, peak level, ' +
    'crest factor, and dynamic range. Values in dB. ' +
    'Cheap — use after render to check balance between tracks, detect over-compression, or verify level changes.',
  parameters: {
    type: 'object',
    properties: {
      snapshotId: {
        type: 'string',
        description: 'Snapshot ID from a previous render call.',
      },
    },
    required: ['snapshotId'],
  },
};

const rhythmTool: ToolSchema = {
  name: 'rhythm',
  description:
    'Measure rhythmic properties of a rendered audio snapshot. Returns tempo estimate, onset count and times, ' +
    'rhythmic density, and swing estimate. ' +
    'Cheap — use after render to verify pattern density, confirm swing adjustments, or compare onset patterns.',
  parameters: {
    type: 'object',
    properties: {
      snapshotId: {
        type: 'string',
        description: 'Snapshot ID from a previous render call.',
      },
    },
    required: ['snapshotId'],
  },
};

export const GLUON_TOOLS: ToolSchema[] = [
  moveTool,
  sketchTool,
  listenTool,
  setTransportTool,
  setModelTool,
  transformTool,
  addViewTool,
  removeViewTool,
  addProcessorTool,
  removeProcessorTool,
  replaceProcessorTool,
  addModulatorTool,
  removeModulatorTool,
  connectModulatorTool,
  disconnectModulatorTool,
  setSurfaceTool,
  pinTool,
  unpinTool,
  labelAxesTool,
  setImportanceTool,
  renderTool,
  spectralTool,
  dynamicsTool,
  rhythmTool,
];
