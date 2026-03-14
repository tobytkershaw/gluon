# RFC: Gluon Musical Data Model

## Status

Draft. For discussion before Phase 3 completion and Phase 4A implementation.

---

## Problem

The current data model is coupled to implementation details. The AI reasons about Plaits-specific parameter names (`timbre`, `morph`, `harmonics`), a fixed step-sequencer grid, and a single synthesis runtime. This works for the current product but prevents extension to:

- Patch chains and modular signal flow (Phase 4A)
- Hardware synths via MIDI
- Alternative sequencing paradigms (tracker, piano roll, clip launcher)
- DAW integration (Ableton, Bitwig)
- Additional synthesis engines beyond Plaits

The Phase 4A RFC proposes new types (`ModuleInstance`, `PatchChain`, `PatchOp`) but these are designed around the specific Mutable Instruments patch-chain use case. If we build them as-is, we'll have a second implementation-specific layer on top of the first one, and the same problem at the next expansion.

The question is: what abstraction does the AI agent actually need to reason musically, independent of what's underneath?

---

## Design Principles

### 1. The AI reasons about music, not implementations

The AI should think "this voice is bright, I'll darken it by reducing spectral content" — not "I'll set Plaits timbre to 0.3" or "I'll send MIDI CC 74 value 30". The mapping from musical intent to specific parameters is the adapter's job.

### 2. One voice model for all backends

A voice controlled by Plaits WASM, a voice controlled by MIDI CC messages to a Digitone, and a voice controlled by Ableton automation should all look the same to the AI and the undo system. The protocol doesn't care what makes the sound.

### 3. Parameters carry musical meaning

A parameter isn't just a name and a float. It has a semantic description that tells the AI what it does musically. This is what lets the AI generalise across instruments it has never seen before.

### 4. Temporal structure is representation-agnostic

"Note at beat 2 with velocity 0.8" is the musical fact. Whether it renders as step 8 in a 16-step grid, row 32 in a tracker, a rectangle in a piano roll, or a MIDI note-on message is a rendering concern.

### 5. The abstraction earns its place

Every layer of indirection must solve a real problem. If the current concrete model works for a use case, don't abstract it until extension demands it. This RFC defines the target model; migration is incremental.

---

## The Model

### Voice

The central abstraction. A voice is a thing that makes sound and has controllable parameters.

```typescript
interface Voice {
  id: string;
  label: string;                    // "kick", "bass", "lead", "pad"
  source: SoundSource;              // what makes the sound
  chain: Processor[];               // signal processing (0 to N, ordered)
  params: ParamState;               // flattened parameter state for the AI
  events: EventSequence;            // temporal structure
  agency: 'OFF' | 'ON';
  muted: boolean;
  solo: boolean;
}
```

The AI sees `voice.params` — a flat map of semantically-named parameters — and `voice.events` — a list of musical events in time. It doesn't need to know whether `source` is a WASM module, a MIDI channel, or an Ableton track.

### Sound Source

What produces the sound. This is the adapter boundary.

```typescript
interface SoundSource {
  type: string;                     // "plaits", "midi-out", "ableton-track", "sampler"
  engine: string;                   // "analog-bass-drum", "digitone-ch1", "operator"
  params: ParamSpec[];              // what's controllable
}
```

The `type` tells the runtime how to produce sound. The `engine` is the specific instrument or configuration. The `params` array describes what the AI can control and what each parameter means musically.

### ParamSpec and ParamState

This is the key piece. Parameters carry musical semantics, not just names and numbers.

```typescript
interface ParamSpec {
  id: string;                       // stable identifier: "brightness", "decay", "pitch"
  label: string;                    // human-readable: "Brightness", "Decay Time"
  semantic: string;                 // musical meaning: "spectral content, low=dark high=bright"
  range: [number, number];          // normalised [0, 1] at the Gluon layer
  default: number;
  group?: string;                   // optional grouping: "timbre", "envelope", "filter"
}

// Runtime state: just the values
type ParamState = Record<string, number>;   // param.id → current value
```

The AI reads `ParamSpec` to understand what it can control and what each parameter does. It reads and writes `ParamState` to get and set values.

**Example — Plaits Virtual Analog:**

```typescript
params: [
  { id: 'brightness', label: 'Brightness', semantic: 'spectral content of the oscillator', range: [0, 1], default: 0.5, group: 'timbre' },
  { id: 'texture', label: 'Texture', semantic: 'surface quality and movement', range: [0, 1], default: 0.5, group: 'timbre' },
  { id: 'richness', label: 'Richness', semantic: 'harmonic density', range: [0, 1], default: 0.5, group: 'timbre' },
  { id: 'pitch', label: 'Pitch', semantic: 'fundamental frequency', range: [0, 1], default: 0.5, group: 'pitch' },
]
```

**Example — Digitone via MIDI:**

```typescript
params: [
  { id: 'brightness', label: 'Filter Cutoff', semantic: 'lowpass filter frequency, controls brightness', range: [0, 1], default: 0.5, group: 'filter' },
  { id: 'resonance', label: 'Filter Resonance', semantic: 'filter emphasis, adds nasal/ringing quality', range: [0, 1], default: 0.0, group: 'filter' },
  { id: 'fm-depth', label: 'FM Amount', semantic: 'frequency modulation depth, adds metallic/bell-like harmonics', range: [0, 1], default: 0.0, group: 'timbre' },
]
```

The AI can reason about both using the same vocabulary: "reduce brightness to darken the sound." The adapter maps `brightness` to Plaits `timbre` in one case and MIDI CC 74 in the other.

### Processor

An optional signal processing stage in the voice's chain.

```typescript
interface Processor {
  id: string;
  type: string;                     // "rings", "clouds", "vst-reverb", "ableton-effect"
  label: string;                    // "Resonator", "Granular", "Reverb"
  enabled: boolean;
  params: ParamSpec[];
}
```

Phase 4A introduces processors. The data model supports them from the start, but `chain: []` is the default and the current product doesn't use them.

### EventSequence

Temporal musical structure. This is where step sequencer, tracker, piano roll, and MIDI all converge.

```typescript
interface EventSequence {
  type: string;                     // "step-grid", "tracker", "piano-roll", "live"
  length: number;                   // in beats (e.g. 4 = one bar of 4/4)
  events: MusicalEvent[];
  resolution?: number;              // ticks per beat, if quantised
}

interface MusicalEvent {
  time: number;                     // position in beats from start of sequence
  duration: number;                 // length in beats (0 for triggers/one-shots)
  pitch: number;                    // normalised 0-1 or MIDI note number
  velocity: number;                 // 0-1
  accent?: boolean;
  params?: Record<string, number>;  // per-event parameter overrides (param locks)
}
```

The AI writes events in this abstract form. The rendering layer decides how to display and execute them:

- **Step sequencer**: Quantise events to grid positions, render as steps with gates/accents
- **Tracker**: Render as rows with note/instrument/volume/effect columns
- **Piano roll**: Render as horizontal bars on a pitch×time grid
- **MIDI output**: Convert to note-on/note-off messages with timing
- **Ableton**: Write as clip notes via API

The current `Pattern` type (steps with gate/accent/params) becomes an adapter that reads and writes `EventSequence` for the step-grid renderer.

### Project

The top-level container. This is what the AI sees as "the current state."

```typescript
interface Project {
  tracks: Voice[];
  transport: Transport;
  context: MusicalContext;
  messages: ChatMessage[];          // conversation history (UI transcript)
  undoStack: UndoEntry[];
}

interface Transport {
  playing: boolean;
  bpm: number;
  swing: number;
  timeSignature: [number, number];  // [4, 4] default
}

interface MusicalContext {
  key: string | null;
  scale: string | null;
  energy: number;                   // 0-1
  density: number;                  // 0-1
}
```

---

## AI Operation Vocabulary

The AI's actions should work at the musical abstraction level, not the implementation level.

### Current actions (unchanged semantically)

```typescript
// Set a parameter on a voice
{ type: 'move', trackId: string, param: string, target: { absolute: number } | { relative: number }, over?: number }

// Describe / communicate
{ type: 'say', text: string }

// Write temporal events for a voice
{ type: 'sketch', trackId: string, description: string, events: MusicalEvent[] }
```

### Extended actions (Phase 4A+)

```typescript
// Add a processor to a voice's chain
{ type: 'add_processor', trackId: string, processorType: string, position?: number }

// Remove a processor
{ type: 'remove_processor', trackId: string, processorId: string }

// Set a parameter on a processor (not the voice source)
{ type: 'set_processor_param', trackId: string, processorId: string, param: string, value: number }
```

The `move` action targets voice source parameters by default. Processor parameters use a separate action to keep the intent explicit.

### What the AI does NOT do

The AI does not:
- Reference implementation-specific identifiers (Plaits model numbers, MIDI CC numbers, Web Audio node names)
- Know what runtime is producing the sound
- Emit raw MIDI messages or Web Audio commands
- Manipulate the rendering representation (step indices, tracker rows) — it writes musical events

---

## Adapter Layer

Each runtime implements an adapter that translates between the musical abstraction and the concrete system.

```typescript
interface SourceAdapter {
  // Translate abstract param IDs to implementation params
  mapParam(paramId: string): ImplementationParam;

  // Translate musical events to the runtime's native format
  mapEvents(events: MusicalEvent[]): NativeEvents;

  // Provide the ParamSpec array for this instrument
  getParamSpecs(): ParamSpec[];
}
```

### Planned adapters

| Adapter | Source type | Maps to |
|---------|-----------|---------|
| `PlaitsAdapter` | `plaits` | WASM AudioWorklet params, Plaits model index |
| `MIDIAdapter` | `midi-out` | MIDI CC messages, note-on/off, program change |
| `AbletonAdapter` | `ableton-track` | Ableton API calls, clip writing, automation |
| `SamplerAdapter` | `sampler` | Audio buffer playback, pitch/loop params |

Only `PlaitsAdapter` exists today. The others are built when needed.

### Instrument Registry

A registry of known instruments and their parameter specs. This is shared between the AI (for prompt construction), the UI (for control rendering), and validation.

```typescript
interface InstrumentDef {
  type: string;                     // "plaits", "digitone", "operator"
  label: string;                    // "Plaits Virtual Analog", "Elektron Digitone"
  sourceType: string;               // "plaits", "midi-out", "ableton-track"
  engines: EngineDef[];             // available engines/presets/models
}

interface EngineDef {
  id: string;                       // "virtual-analog", "fm", "analog-bass-drum"
  label: string;
  description: string;              // musical description for the AI
  params: ParamSpec[];
}
```

For Plaits, this replaces the hardcoded model list in the system prompt with a machine-readable registry. The system prompt is generated from the registry, not hand-written.

For hardware, this is the "hardware profile" already described in the architecture doc, formalised as the same data structure.

---

## What This Changes About Phase 4A

The Phase 4A RFC's `PatchChain` model maps cleanly onto this:

```
Phase 4A PatchChain          →   This RFC
─────────────────────────────────────────────
PatchChain.source            →   Voice.source
PatchChain.processors        →   Voice.chain
ModuleInstance.params        →   ParamSpec[] + ParamState
ModuleSpec (registry)        →   InstrumentDef / EngineDef
PatchOp (AI operations)      →   Extended AI actions
```

The difference is that this RFC's voice model isn't specific to Mutable Instruments modules. A `Voice` with a `midi-out` source and no processors is a MIDI-controlled hardware synth. A `Voice` with an `ableton-track` source is an Ableton channel. The processor chain, event model, and AI operations work the same way for all of them.

Phase 4A becomes: "add the first `Processor` implementations (Rings, Clouds, Ripples) and the first extended AI actions (add/remove processor)." The data model is already there.

---

## What This Changes About the Current Codebase

### Immediate (before Phase 4A)

1. **Instrument registry**: Define `InstrumentDef` and `EngineDef` for Plaits. Generate the system prompt's model reference and parameter space sections from the registry instead of hand-writing them.

2. **Semantic param IDs**: Add a mapping layer in the Plaits adapter: `brightness` ↔ `timbre`, `texture` ↔ `morph`, `richness` ↔ `harmonics`. The AI sees semantic names; the runtime uses Plaits names. This is a thin translation, not a rewrite.

3. **Event abstraction**: Define `MusicalEvent` and build a bidirectional adapter between it and the current `Step[]` pattern format. The step grid UI and sequencer continue to work with steps internally; the AI writes events; the adapter converts.

### Deferred (built when needed)

- `MIDIAdapter` — when MIDI output is implemented
- `AbletonAdapter` — when DAW integration is implemented
- `SamplerAdapter` — when sample playback is implemented
- Alternative event renderers (tracker, piano roll) — when those UIs are built

---

## Migration Strategy

This is not a flag-day rewrite. The migration is incremental:

**Step 1**: Define the types (`ParamSpec`, `MusicalEvent`, `InstrumentDef`, etc.) alongside the existing types. No runtime changes.

**Step 2**: Build the Plaits instrument registry and use it to generate the system prompt. Existing param names (`timbre`, `morph`, `harmonics`) remain in the runtime; the registry adds semantic metadata on top.

**Step 3**: Introduce `MusicalEvent` ↔ `Step[]` conversion in the sketch action path. The AI starts writing events; the adapter converts to steps for the sequencer. The step grid UI doesn't change.

**Step 4**: When Phase 4A begins, `Voice.chain` (currently always `[]`) gets its first entries. The adapter layer is already in place.

**Step 5**: When MIDI output is added, a new adapter maps the same `ParamSpec` / `MusicalEvent` abstractions to MIDI messages. No changes to the AI layer or protocol.

At each step, the existing codebase continues to work. New abstractions are added alongside, not instead of, existing code. Old code is collapsed only after the new path is proven.

---

## What This Does Not Define

**UI rendering**: How parameters are displayed (sliders, XY pads, knobs) is a UI concern. The data model provides the metadata; the UI decides the presentation.

**AI reasoning quality**: Whether the AI makes good musical decisions is a function of the model, the prompt, and the parameter descriptions — not the data model. But the data model makes it possible to give the AI better information.

**Audio evaluation**: How the AI listens to its own work. That's orthogonal to the data model.

**Specific instrument catalogues**: Which hardware profiles, VSTs, or Ableton devices are supported. Those are content, not architecture.

**Transport and sync**: MIDI clock, Ableton Link, or other sync mechanisms. The transport model is minimal by design.

---

## Success Criteria

1. The AI can control a Plaits voice and a hypothetical MIDI voice using the same action vocabulary
2. The system prompt is generated from the instrument registry, not hand-written
3. The step sequencer continues to work unchanged while the AI writes abstract events
4. Phase 4A processors slot into the voice model without new abstractions
5. Adding a new instrument type (MIDI, Ableton, sampler) requires only a new adapter and registry entry — no changes to the AI layer, protocol, undo system, or UI framework

---

## Relationship to Other Documents

- **Protocol (v0.4.0)**: This RFC extends the protocol's voice model with semantic parameters and abstract events. The protocol's principles (human wins, AI acts when asked, undo is one action away) are unchanged.
- **Phase 3 build doc**: Current work. This RFC doesn't block Phase 3 completion but should inform the instrument registry work in Phase 3 polish.
- **Phase 4A RFC**: The patch-chain model fits inside this RFC's voice model. Phase 4A implementation should use this as its data model foundation.
- **Modular roadmap**: The long-term vision (Phases 4B–6) is enabled by this abstraction layer. Without it, each expansion requires reworking the AI's understanding of the system.
- **Architecture doc**: The hardware profiles section already describes semantic parameter mapping for MIDI devices. This RFC formalises that into a shared registry that covers all source types.
