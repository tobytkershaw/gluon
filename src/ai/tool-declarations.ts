// src/ai/tool-declarations.ts
// Gemini function calling tool declarations for Gluon.

import type { FunctionDeclaration } from '@google/genai';
import { Type } from '@google/genai';

const moveTool: FunctionDeclaration = {
  name: 'move',
  description:
    'Move a normalized control to a target value. Targets a track source control by default, or a processor control when processorId is provided, or a modulator control when modulatorId is provided. Immediately audible. Takes effect after this response.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      param: {
        type: Type.STRING,
        description: 'The control ID to change. For track: "brightness", "richness", "texture", "pitch". For processors: depends on type (Rings: "structure", "brightness", "damping", "position"; Clouds: "position", "size", "density", "feedback"). For Tides modulator: "frequency", "shape", "slope", "smoothness".',
      },
      target: {
        type: Type.OBJECT,
        description: 'Target value — use absolute (0.0-1.0) or relative (-1.0 to 1.0).',
        properties: {
          absolute: { type: Type.NUMBER, description: 'Absolute value (0.0-1.0).' },
          relative: { type: Type.NUMBER, description: 'Relative offset (-1.0 to 1.0).' },
        },
      },
      trackId: {
        type: Type.STRING,
        description: 'Target track ID (e.g. "v0"). Defaults to active track if omitted.',
      },
      processorId: {
        type: Type.STRING,
        description: 'Processor ID to target (e.g. "rings-1710342000000"). When provided, moves a control on the processor instead of the track source.',
      },
      modulatorId: {
        type: Type.STRING,
        description: 'Modulator ID to target (e.g. "tides-1710342000000"). When provided, moves a control on the modulator (e.g. LFO rate).',
      },
      over: {
        type: Type.NUMBER,
        description: 'Smooth transition duration in milliseconds (e.g. 2000 for 2s drift).',
      },
    },
    required: ['param', 'target'],
  },
};

const sketchTool: FunctionDeclaration = {
  name: 'sketch',
  description:
    'Apply a rhythmic/melodic pattern to a track using musical events. Takes effect after this response.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      trackId: {
        type: Type.STRING,
        description: 'Target track ID (e.g. "v0").',
      },
      description: {
        type: Type.STRING,
        description: 'Short description of the pattern (e.g. "four on the floor kick").',
      },
      events: {
        type: Type.ARRAY,
        description:
          'Sparse list of musical events. Only include steps you want to set. ' +
          'For drums/percussion, use "trigger" events. For melodic tracks, use "note" events with MIDI pitches.',
        items: {
          type: Type.OBJECT,
          properties: {
            kind: {
              type: Type.STRING,
              description: '"trigger" for percussion, "note" for melodic, "parameter" for per-step param lock.',
            },
            at: {
              type: Type.INTEGER,
              description: 'Step index (0-based, 16 steps per bar).',
            },
            velocity: {
              type: Type.NUMBER,
              description: 'Velocity (0.0-1.0). Applies to trigger and note events.',
            },
            accent: {
              type: Type.BOOLEAN,
              description: 'Accent flag. Applies to trigger events.',
            },
            pitch: {
              type: Type.INTEGER,
              description: 'MIDI pitch (0-127). Required for note events.',
            },
            duration: {
              type: Type.NUMBER,
              description: 'Note duration as fraction of a step (always 0.25). Required for note events.',
            },
            controlId: {
              type: Type.STRING,
              description: 'Control ID for parameter lock events.',
            },
            value: {
              type: Type.NUMBER,
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

const listenTool: FunctionDeclaration = {
  name: 'listen',
  description:
    'Render audio offline and evaluate how it sounds. ' +
    'Works whether or not the transport is playing. ' +
    'Changes you make in this turn aren\'t audible yet — listen in a follow-up turn to hear your edits.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      question: {
        type: Type.STRING,
        description: 'What to evaluate (e.g. "how does the kick sound?", "is the mix balanced?").',
      },
      bars: {
        type: Type.INTEGER,
        description: 'Number of bars to render (1-16, default 2).',
      },
      trackIds: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'Optional track IDs to render in isolation (e.g. ["v0", "v1"]). Omit to hear all unmuted tracks.',
      },
    },
    required: ['question'],
  },
};

const setTransportTool: FunctionDeclaration = {
  name: 'set_transport',
  description:
    'Change tempo, swing, or play/stop state. Takes effect after this response.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      bpm: {
        type: Type.NUMBER,
        description: 'Tempo in beats per minute (60-200).',
      },
      swing: {
        type: Type.NUMBER,
        description: 'Swing amount (0.0-1.0, where 0 is straight).',
      },
      playing: {
        type: Type.BOOLEAN,
        description: 'True to start playback, false to stop.',
      },
    },
  },
};

const setModelTool: FunctionDeclaration = {
  name: 'set_model',
  description:
    'Switch the mode of a module. Without processorId/modulatorId, changes the track synthesis engine. With processorId, changes the processor\'s mode. With modulatorId, changes the modulator\'s mode. Takes effect after this response.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      trackId: {
        type: Type.STRING,
        description: 'Target track ID (e.g. "v0").',
      },
      model: {
        type: Type.STRING,
        description:
          'Model/mode ID. For track: virtual-analog, waveshaping, fm, grain-formant, harmonic, wavetable, ' +
          'chords, vowel-speech, swarm, filtered-noise, particle-dust, ' +
          'inharmonic-string, modal-resonator, analog-bass-drum, analog-snare, analog-hi-hat. ' +
          'For Rings processor: modal, sympathetic-string, string, fm-track, sympathetic-quantized, string-and-reverb. ' +
          'For Clouds processor: granular, pitch-shifter, looping-delay, spectral. ' +
          'For Tides modulator: ad, looping, ar.',
      },
      processorId: {
        type: Type.STRING,
        description: 'Processor ID to target. When provided, switches the processor\'s mode instead of the track\'s synthesis engine.',
      },
      modulatorId: {
        type: Type.STRING,
        description: 'Modulator ID to target. When provided, switches the modulator\'s mode (e.g. ad, looping, ar for Tides).',
      },
    },
    required: ['trackId', 'model'],
  },
};

const transformTool: FunctionDeclaration = {
  name: 'transform',
  description:
    'Transform an existing pattern on a track. Use this to modify patterns structurally (rotate, transpose, reverse, duplicate) rather than rewriting them.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      trackId: { type: Type.STRING, description: 'Target track ID (e.g. "v0").' },
      operation: { type: Type.STRING, description: 'Transform operation: "rotate" (shift events in time), "transpose" (shift pitch), "reverse" (mirror positions), "duplicate" (repeat pattern).' },
      steps: { type: Type.INTEGER, description: 'For rotate: number of steps to shift (positive=forward, negative=backward). Required for rotate, rejected for other operations.' },
      semitones: { type: Type.INTEGER, description: 'For transpose: semitones to shift (positive=up, negative=down). Required for transpose, rejected for other operations.' },
      description: { type: Type.STRING, description: 'Short description of the transform intent.' },
    },
    required: ['trackId', 'operation', 'description'],
  },
};

const addViewTool: FunctionDeclaration = {
  name: 'add_view',
  description:
    'Add a sequencer view to a track. Use after sketching a pattern to make it visible in the appropriate editor.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      trackId: {
        type: Type.STRING,
        description: 'Target track ID (e.g. "v0").',
      },
      viewKind: {
        type: Type.STRING,
        description: 'View type: "step-grid".',
      },
      description: {
        type: Type.STRING,
        description: 'Short description (e.g. "show kick pattern in step grid").',
      },
    },
    required: ['trackId', 'viewKind', 'description'],
  },
};

const removeViewTool: FunctionDeclaration = {
  name: 'remove_view',
  description:
    'Remove a sequencer view from a track by its ID.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      trackId: {
        type: Type.STRING,
        description: 'Target track ID (e.g. "v0").',
      },
      viewId: {
        type: Type.STRING,
        description: 'The view ID to remove.',
      },
      description: {
        type: Type.STRING,
        description: 'Short description (e.g. "remove step grid").',
      },
    },
    required: ['trackId', 'viewId', 'description'],
  },
};

const addProcessorTool: FunctionDeclaration = {
  name: 'add_processor',
  description:
    'Add a processor module to a track\'s signal chain (e.g. Rings resonator). The processor processes the track\'s audio output. Takes effect after this response.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      trackId: {
        type: Type.STRING,
        description: 'Target track ID (e.g. "v0").',
      },
      moduleType: {
        type: Type.STRING,
        description: 'Processor type to add. Available: "rings" (Mutable Instruments Rings resonator), "clouds" (Mutable Instruments Clouds granular processor).',
      },
      description: {
        type: Type.STRING,
        description: 'Short description (e.g. "add Rings resonator for metallic texture").',
      },
    },
    required: ['trackId', 'moduleType', 'description'],
  },
};

const removeProcessorTool: FunctionDeclaration = {
  name: 'remove_processor',
  description:
    'Remove a processor module from a track\'s signal chain by its ID. Takes effect after this response.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      trackId: {
        type: Type.STRING,
        description: 'Target track ID (e.g. "v0").',
      },
      processorId: {
        type: Type.STRING,
        description: 'The processor ID to remove (visible in project state).',
      },
      description: {
        type: Type.STRING,
        description: 'Short description (e.g. "remove Rings from kick track").',
      },
    },
    required: ['trackId', 'processorId', 'description'],
  },
};

const replaceProcessorTool: FunctionDeclaration = {
  name: 'replace_processor',
  description:
    'Atomically swap one processor for another type in a track\'s signal chain. Keeps the same chain position. Takes effect after this response.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      trackId: {
        type: Type.STRING,
        description: 'Target track ID (e.g. "v0").',
      },
      processorId: {
        type: Type.STRING,
        description: 'The processor ID to replace (visible in project state).',
      },
      newModuleType: {
        type: Type.STRING,
        description: 'New processor type. Available: "rings", "clouds".',
      },
      description: {
        type: Type.STRING,
        description: 'Short description (e.g. "swap Rings for Clouds on kick track").',
      },
    },
    required: ['trackId', 'processorId', 'newModuleType', 'description'],
  },
};

const addModulatorTool: FunctionDeclaration = {
  name: 'add_modulator',
  description:
    'Add a modulator module (LFO/envelope) to a track. The modulator generates control-rate signals that can be routed to parameters on the source or processors. Use connect_modulator to wire it up after adding. Takes effect after this response.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      trackId: {
        type: Type.STRING,
        description: 'Target track ID (e.g. "v0").',
      },
      moduleType: {
        type: Type.STRING,
        description: 'Modulator type to add. Available: "tides" (Mutable Instruments Tides — function generator with LFO/envelope modes).',
      },
      description: {
        type: Type.STRING,
        description: 'Short description (e.g. "add Tides LFO for slow brightness sweep").',
      },
    },
    required: ['trackId', 'moduleType', 'description'],
  },
};

const removeModulatorTool: FunctionDeclaration = {
  name: 'remove_modulator',
  description:
    'Remove a modulator module from a track by its ID. Also disconnects all routings from this modulator. Takes effect after this response.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      trackId: {
        type: Type.STRING,
        description: 'Target track ID (e.g. "v0").',
      },
      modulatorId: {
        type: Type.STRING,
        description: 'The modulator ID to remove (visible in project state).',
      },
      description: {
        type: Type.STRING,
        description: 'Short description (e.g. "remove LFO from kick track").',
      },
    },
    required: ['trackId', 'modulatorId', 'description'],
  },
};

const connectModulatorTool: FunctionDeclaration = {
  name: 'connect_modulator',
  description:
    'Route a modulator\'s output to a target parameter. Idempotent: calling again with the same modulator + target updates the depth. Human sets center, modulation adds around it. Multiple routings to the same target sum (additive). Strong combined modulation saturates at 0/1 boundaries. Takes effect after this response.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      trackId: {
        type: Type.STRING,
        description: 'Target track ID (e.g. "v0").',
      },
      modulatorId: {
        type: Type.STRING,
        description: 'The modulator ID to route from.',
      },
      targetKind: {
        type: Type.STRING,
        description: 'Target type: "source" for the track\'s Plaits source, or "processor" for a processor module.',
      },
      processorId: {
        type: Type.STRING,
        description: 'Required when targetKind is "processor". The processor ID to target.',
      },
      targetParam: {
        type: Type.STRING,
        description: 'The parameter to modulate. Source: "brightness", "richness", "texture" (pitch excluded). Processor: depends on type (Rings: "structure", "brightness", "damping", "position"; Clouds: "position", "size", "density", "feedback").',
      },
      depth: {
        type: Type.NUMBER,
        description: 'Modulation depth (-1.0 to 1.0). Prefer shallow values (0.1-0.3) before aggressive ones. Negative depth inverts the modulation.',
      },
      description: {
        type: Type.STRING,
        description: 'Short description (e.g. "route Tides to brightness for slow sweep").',
      },
    },
    required: ['trackId', 'modulatorId', 'targetKind', 'targetParam', 'depth', 'description'],
  },
};

const disconnectModulatorTool: FunctionDeclaration = {
  name: 'disconnect_modulator',
  description:
    'Remove a modulation routing by its ID. Takes effect after this response.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      trackId: {
        type: Type.STRING,
        description: 'Target track ID (e.g. "v0").',
      },
      modulationId: {
        type: Type.STRING,
        description: 'The modulation routing ID to disconnect (visible in project state).',
      },
      description: {
        type: Type.STRING,
        description: 'Short description (e.g. "disconnect brightness modulation").',
      },
    },
    required: ['trackId', 'modulationId', 'description'],
  },
};

const setSurfaceTool: FunctionDeclaration = {
  name: 'set_surface',
  description:
    'Define semantic controls for a track\'s UI surface. Semantic controls are virtual knobs that blend multiple underlying parameters. Does not require agency. Takes effect after this response.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      trackId: {
        type: Type.STRING,
        description: 'Target track ID (e.g. "v0").',
      },
      semanticControls: {
        type: Type.ARRAY,
        description: 'Array of semantic control definitions. Each control blends one or more underlying parameters via weighted sums.',
        items: {
          type: Type.OBJECT,
          properties: {
            name: {
              type: Type.STRING,
              description: 'Human-readable label for the control (e.g. "Warmth", "Attack").',
            },
            weights: {
              type: Type.ARRAY,
              description: 'Weighted parameter mappings. Weights must sum to 1.0.',
              items: {
                type: Type.OBJECT,
                properties: {
                  moduleId: { type: Type.STRING, description: '"source" for track params, or a processor ID.' },
                  controlId: { type: Type.STRING, description: 'The parameter to blend (e.g. "brightness", "structure").' },
                  weight: { type: Type.NUMBER, description: 'Blend weight (0.0-1.0). All weights in one control must sum to 1.0.' },
                  transform: { type: Type.STRING, description: 'Transform: "linear" (default), "inverse", or "bipolar".' },
                },
                required: ['moduleId', 'controlId', 'weight'],
              },
            },
            range: {
              type: Type.OBJECT,
              description: 'Optional value range override.',
              properties: {
                min: { type: Type.NUMBER },
                max: { type: Type.NUMBER },
                default: { type: Type.NUMBER },
              },
            },
          },
          required: ['name', 'weights'],
        },
      },
      xyAxes: {
        type: Type.OBJECT,
        description: 'Optional axis labels for the XY pad.',
        properties: {
          x: { type: Type.STRING, description: 'X-axis semantic label.' },
          y: { type: Type.STRING, description: 'Y-axis semantic label.' },
        },
        required: ['x', 'y'],
      },
      description: {
        type: Type.STRING,
        description: 'Short description of the surface configuration.',
      },
    },
    required: ['trackId', 'semanticControls', 'description'],
  },
};

const pinTool: FunctionDeclaration = {
  name: 'pin',
  description:
    'Pin a raw module control to the track\'s surface for direct access. Max 4 pins per track. Does not require agency.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      trackId: { type: Type.STRING, description: 'Target track ID (e.g. "v0").' },
      moduleId: { type: Type.STRING, description: '"source" for track params, or a processor ID.' },
      controlId: { type: Type.STRING, description: 'The control to pin (e.g. "brightness", "structure").' },
    },
    required: ['trackId', 'moduleId', 'controlId'],
  },
};

const unpinTool: FunctionDeclaration = {
  name: 'unpin',
  description:
    'Remove a pinned control from the track\'s surface. Does not require agency.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      trackId: { type: Type.STRING, description: 'Target track ID (e.g. "v0").' },
      moduleId: { type: Type.STRING, description: '"source" for track params, or a processor ID.' },
      controlId: { type: Type.STRING, description: 'The control to unpin.' },
    },
    required: ['trackId', 'moduleId', 'controlId'],
  },
};

const labelAxesTool: FunctionDeclaration = {
  name: 'label_axes',
  description:
    'Set semantic labels for the track\'s XY pad axes. Does not require agency.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      trackId: { type: Type.STRING, description: 'Target track ID (e.g. "v0").' },
      x: { type: Type.STRING, description: 'X-axis semantic label (e.g. "Brightness").' },
      y: { type: Type.STRING, description: 'Y-axis semantic label (e.g. "Texture").' },
    },
    required: ['trackId', 'x', 'y'],
  },
};

export const GLUON_TOOLS: FunctionDeclaration[] = [
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
];
