// src/ai/tool-declarations.ts
// Gemini function calling tool declarations for Gluon.

import type { FunctionDeclaration } from '@google/genai';
import { Type } from '@google/genai';

const moveTool: FunctionDeclaration = {
  name: 'move',
  description:
    'Change a control parameter value on a voice. Immediately audible. Takes effect after this response.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      param: {
        type: Type.STRING,
        description: 'The control ID to change (e.g. "brightness", "richness", "note").',
      },
      target: {
        type: Type.OBJECT,
        description: 'Target value — use absolute (0.0-1.0) or relative (-1.0 to 1.0).',
        properties: {
          absolute: { type: Type.NUMBER, description: 'Absolute value (0.0-1.0).' },
          relative: { type: Type.NUMBER, description: 'Relative offset (-1.0 to 1.0).' },
        },
      },
      voiceId: {
        type: Type.STRING,
        description: 'Target voice ID (e.g. "v0"). Defaults to active voice if omitted.',
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
    'Apply a rhythmic/melodic pattern to a voice using musical events. Takes effect after this response.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      voiceId: {
        type: Type.STRING,
        description: 'Target voice ID (e.g. "v0").',
      },
      description: {
        type: Type.STRING,
        description: 'Short description of the pattern (e.g. "four on the floor kick").',
      },
      events: {
        type: Type.ARRAY,
        description:
          'Sparse list of musical events. Only include steps you want to set. ' +
          'For drums/percussion, use "trigger" events. For melodic voices, use "note" events with MIDI pitches.',
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
    required: ['voiceId', 'description', 'events'],
  },
};

const listenTool: FunctionDeclaration = {
  name: 'listen',
  description:
    'Capture a few bars of audio and evaluate how it sounds. ' +
    'Captures what\'s currently playing. Changes you make in this turn aren\'t audible yet — listen in a follow-up turn to hear your edits.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      question: {
        type: Type.STRING,
        description: 'What to evaluate (e.g. "how does the kick sound?", "is the mix balanced?").',
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
    'Change the synthesis engine/model for a voice. Takes effect after this response.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      voiceId: {
        type: Type.STRING,
        description: 'Target voice ID (e.g. "v0").',
      },
      model: {
        type: Type.STRING,
        description:
          'Engine ID to switch to. Available: ' +
          'virtual-analog, waveshaping, fm, grain-formant, harmonic, wavetable, ' +
          'chords, vowel-speech, swarm, filtered-noise, particle-dust, ' +
          'inharmonic-string, modal-resonator, analog-bass-drum, analog-snare, analog-hi-hat.',
      },
    },
    required: ['voiceId', 'model'],
  },
};

const transformTool: FunctionDeclaration = {
  name: 'transform',
  description:
    'Transform an existing pattern on a voice. Use this to modify patterns structurally (rotate, transpose, reverse, duplicate) rather than rewriting them.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      voiceId: { type: Type.STRING, description: 'Target voice ID (e.g. "v0").' },
      operation: { type: Type.STRING, description: 'Transform operation: "rotate" (shift events in time), "transpose" (shift pitch), "reverse" (mirror positions), "duplicate" (repeat pattern).' },
      steps: { type: Type.INTEGER, description: 'For rotate: number of steps to shift (positive=forward, negative=backward). Required for rotate, rejected for other operations.' },
      semitones: { type: Type.INTEGER, description: 'For transpose: semitones to shift (positive=up, negative=down). Required for transpose, rejected for other operations.' },
      description: { type: Type.STRING, description: 'Short description of the transform intent.' },
    },
    required: ['voiceId', 'operation', 'description'],
  },
};

const addViewTool: FunctionDeclaration = {
  name: 'add_view',
  description:
    'Add a sequencer view to a voice. Use after sketching a pattern to make it visible in the appropriate editor.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      voiceId: {
        type: Type.STRING,
        description: 'Target voice ID (e.g. "v0").',
      },
      viewKind: {
        type: Type.STRING,
        description: 'View type: "step-grid" or "piano-roll".',
      },
      description: {
        type: Type.STRING,
        description: 'Short description (e.g. "show kick pattern in step grid").',
      },
    },
    required: ['voiceId', 'viewKind', 'description'],
  },
};

const removeViewTool: FunctionDeclaration = {
  name: 'remove_view',
  description:
    'Remove a sequencer view from a voice by its ID.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      voiceId: {
        type: Type.STRING,
        description: 'Target voice ID (e.g. "v0").',
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
    required: ['voiceId', 'viewId', 'description'],
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
];
