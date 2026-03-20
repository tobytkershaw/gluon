# Gluon RFC: Canonical Musical Model

## Status

**Partially Implemented.** MusicalEvent (NoteEvent/TriggerEvent/ParameterEvent), Pattern, ControlSchema, and SourceAdapter interface are all implemented in `src/engine/canonical-types.ts`. Voice/Region from the RFC diverged to Track/Pattern in implementation. North-star Target abstraction remains deferred.

Supersedes `rfc-musical-data-model.md` and `gluon-canonical-musical-model-rfc.md`.

Related docs:

- `docs/gluon-interaction-protocol-v05.md`
- `docs/gluon-architecture.md`
- `docs/rfcs/phase4a.md`
- `docs/briefs/modular-roadmap.md`
- `docs/ai/ai-musical-environment.md`

---

## Product Thesis

Gluon's product is the contract between a human and an AI agent over a shared musical representation. The canonical model defined in this RFC *is* that contract. Adapters, synthesis engines, hardware integrations, and DAW connections are features that plug into it — they are not the product.

The primary design constraint is **legibility and actionability for the AI agent**. Every type, field, and semantic annotation exists to help the agent understand what it's looking at and express what it wants to do. The quality ceiling of AI-human music collaboration is set by how well the agent comprehends the state it receives and how precisely it can articulate intent back. A brilliant model with a confusing state representation will make bad music. A mediocre model with a clear, semantically rich state representation will surprise you.

This has a practical consequence: getting the canonical model right — semantic controls, event abstraction, provenance-aware state, validation invariants — matters more than adding the next synth engine or the next hardware integration. Each new adapter is a feature launch. The model is the platform they all stand on.

### This RFC produces two outputs

**This document** is the human-facing architectural specification. Engineers read it, debate it, build from it. It contains rationale, migration strategy, the architectural north star, and design principles — context that humans need and that the AI agent should never see.

**An AI-facing contract document** (separate, generated from this RFC and the instrument registry) is what actually goes into the system prompt or gets retrieved as context. It should contain only:

- The type definitions for the build-now layer
- The serialised state format the agent will receive
- Worked examples of valid and invalid operations, including complete round-trips (state in → reasoning → operation out)
- Semantic role guidance with musical grounding (not just "brightness exists" but "brightness at 0.1–0.3 is dark and warm, 0.7–0.9 is harsh and cutting")
- The validation invariants stated as hard rules
- Positive instructions for what the agent should do, not just what it shouldn't

No rationale, no migration plan, no north star, no persuasion. The north-star section of this RFC must never appear in the agent's context — LLMs are bad at respecting "don't use this yet" when the definitions are right there, and the agent will start emitting `Target`, `Route`, and `move_control` vocabulary that doesn't correspond to anything implemented.

The instrument registry already generates prompt content (see Step 2 of the migration plan). Extend that principle: **this RFC generates the AI contract, not the other way around.**

---

## How to Read This Document

This RFC has two layers:

**The implementation plan (Part 1)** — what to build now. Centered on Voice, semantic controls, event abstraction, and an adapter interface. This is the working model for Phase 3 polish through Phase 4A.

**The architectural north star (Part 2)** — where the model is headed. Centered on a generalised Target abstraction that replaces Voice when Gluon outgrows "things that make sound" as its only editable object. This layer is explicitly labelled and deferred until a forcing function demands it.

The implementation plan is designed so that every piece of it migrates cleanly into the north-star architecture when the time comes. Nothing built now needs to be thrown away.

---

## Design Principles

### 1. The abstraction earns its place

Every layer of indirection must solve a real problem that exists today, not a problem that might exist later. If the current concrete model works for a use case, don't abstract it until extension demands it. Migration is incremental — no flag-day rewrites. No building a DAW data model before you have a DAW.

This is the most important principle. It governs all the others. When in doubt, build the simpler thing.

### 2. The AI reasons about music, not implementations

The AI should think "this voice is bright, I'll darken it by reducing spectral content" — not "I'll set Plaits timbre to 0.3" or "I'll send MIDI CC 74 value 30." The mapping from musical intent to specific parameters is the adapter's job.

### 3. One abstraction across all backends

A synth voice controlled by Plaits WASM, a MIDI-controlled hardware synth, and an Ableton track should all look the same to the AI, the undo system, and the protocol. The runtime doesn't leak into the model.

### 4. Controls carry musical meaning and concrete capability

A control has both a semantic role (what it means musically) and a concrete specification (type, range, valid values). The AI needs both to reason well. Neither freeform strings nor bare floats are sufficient alone.

### 5. Musical time is representation-agnostic

"Note at beat 2 with velocity 0.8" is the musical fact. Whether it renders as step 8 in a 16-step grid, row 32 in a tracker, a rectangle in a piano roll, or a MIDI note-on message is a rendering concern. Time containers (regions) are separated from their content (events).

### 6. Editors are views, not foundations

A step sequencer, tracker, piano roll, and clip launcher are editing surfaces over shared content, not separate source-of-truth models. New editing views should be projections over the canonical data, not parallel state systems.

### 7. Runtime details belong behind adapters

DSP wrappers, CC numbers, API calls, and node graphs do not leak into the AI-facing model unless explicitly surfaced as capabilities.

### 8. The human's hands still win

This RFC does not change arbitration, undo, or per-voice AI permissions. It only defines what kind of objects those rules apply to.

---

## State Ownership

All persisted project state falls into one of five categories. This classification governs what gets saved, what gets sent to the AI, what gets undone, and what gets derived at runtime. The boundaries matter because mixing categories leads to over-persisting noise, under-modelling important state, or exposing implementation details to the AI.

| Category | What it contains | Persisted | Sent to AI | Undoable | Example |
|----------|-----------------|-----------|------------|----------|---------|
| **Canonical musical state** | The musical content and instrument configuration. Voices, regions, events, parameters, processor chains, models, transport, agency. This is the source of truth for what the instrument *is* and what it *plays*. | Yes | Yes (compressed) | Yes | `voice.regions[0].events`, `voice.params`, `voice.processors`, `transport.bpm` |
| **Provenance state** | Who set each value (human, AI, or default) and when. Drives undo source attribution and UI feedback. Not used for arbitration (which has its own runtime system). | Yes | No (internal) | Yes (restored alongside values) | `voice.controlProvenance` |
| **Persistent presentation state** | What the human sees. Sequencer views, surface configurations (future), pinned controls (future), XY axis bindings (future). Persisted because losing your UI layout across sessions is bad UX, but not part of musical content. | Yes | Yes (compressed) | Yes | `voice.views`, `TrackSurface` (future) |
| **Collaboration state** (future) | Project phase, approved directions, rejected directions, preserved material, active brief. The shared understanding between human and AI about where the project is and what has been decided. Not yet implemented — defined in [ai-musical-environment.md](../ai/ai-musical-environment.md). | Yes (when implemented) | Yes | Yes | `project.phase`, `project.approved_directions` |
| **Ephemeral state** | Derived at runtime, never persisted. Undo stack (contains closures), recent human actions (short-lived), activity pulse, thumbprint colour, hover/focus state, arbitration cooldowns. | No | Partial (`undo_depth`, `recent_human_actions`) | N/A | `session.undoStack`, `session.recentHumanActions` |

### What this means in practice

- **`voice.pattern`** is derived (projected from `voice.regions`), not canonical. It is not persisted as authoritative. On load, it is always re-projected from regions.
- **`voice.views`** is persistent presentation state. It rides on the Voice type for convenience but is not musical state — removing a step-grid view doesn't change the pattern.
- **The AI sees compressed canonical state + compressed presentation state + selected ephemeral state** (`undo_depth`, `recent_human_actions`). It does not see provenance, raw engine parameters, or runtime arbitration state.
- **Collaboration state does not exist yet.** When it does, it will be persisted, sent to the AI, and undoable — following the same rules as musical state. The migration path from "no collaboration state" to "collaboration state exists" should not require restructuring the existing state model.

---

## Part 1: Implementation Plan (Build Now)

This is what to build. The central abstraction is **Voice** — the same concept that exists in the current codebase, extended with semantic controls, an event model, and an adapter boundary.

### Voice

The central musical object. A voice is a thing that makes sound and has controllable parameters.

```ts
interface Voice {
  id: string;
  label: string;                      // "kick", "bass", "lead", "pad"
  source: SoundSource;                // what makes the sound
  chain: Processor[];                 // signal processing (0 to N, ordered)
  controls: ControlSchema[];          // what the AI can read and write
  controlState: ControlState;         // current values with provenance
  regions: Region[];                  // temporal musical content
  agency: 'OFF' | 'ON';
  muted: boolean;
  solo: boolean;
}
```

The AI sees `voice.controls` to understand what it can change, `voice.controlState` to read current values, and `voice.regions` to read and write temporal content. It doesn't need to know whether `source` is a WASM module, a MIDI channel, or an Ableton track.

### Sound Source

What produces the sound. This is the adapter boundary.

```ts
interface SoundSource {
  type: string;                       // "plaits", "midi-out", "ableton-track", "sampler"
  engine: string;                     // "virtual-analog", "digitone-ch1", "operator"
  adapterId: string;                  // which adapter owns this source
}
```

The `type` tells the runtime how to produce sound. The `engine` is the specific instrument or configuration. The adapter handles all translation.

### Processor

An optional signal processing stage in the voice's chain.

```ts
interface Processor {
  id: string;
  type: string;                       // "rings", "clouds", "ripples"
  label: string;                      // "Resonator", "Granular", "Filter"
  enabled: boolean;
  controls: ControlSchema[];          // what's controllable on this processor
  controlState: ControlState;
  adapterId: string;
}
```

Phase 4A introduces processors. The data model supports them from the start, but `chain: []` is the default and the current product doesn't use them.

### Control Schema

A control is a typed, semantically-described musical handle. This is the most important part of the abstraction — it's where the AI gets musical understanding.

```ts
type ControlKind = 'continuous' | 'discrete' | 'enum' | 'boolean' | 'trigger';

type SemanticRole =
  | 'pitch'
  | 'brightness'
  | 'richness'
  | 'texture'
  | 'decay'
  | 'attack'
  | 'body'
  | 'noise'
  | 'resonance'
  | 'movement_rate'
  | 'mod_depth'
  | 'space'
  | 'drive'
  | 'stability'
  | 'density'
  | 'level'
  | 'pan';

// Note: swing is intentionally absent from SemanticRole. It is currently
// global-only (TransportState.swing). Per-voice swing (especially useful for
// drum voices) is a real musical feature but is deferred until the product
// needs it. When added, it should become a SemanticRole on voice controls
// rather than remaining solely a transport property.

interface ControlSchema {
  id: string;                         // stable identifier: "brightness", "decay"
  name: string;                       // human-readable: "Brightness", "Decay Time"
  kind: ControlKind;
  semanticRole: SemanticRole | null;  // null for controls with no shared meaning
  description: string;                // musical meaning for the AI
  readable: boolean;
  writable: boolean;
  range?: {
    min: number;                      // normalised 0–1 at the Gluon layer
    max: number;
    default: number;
    recommendedMin?: number;          // useful subset of the range
    recommendedMax?: number;
  };
  enumValues?: string[];              // for enum controls
  group?: string;                     // optional grouping: "timbre", "envelope", "filter"
  binding: ControlBinding;            // how this maps to the adapter
}

interface ControlBinding {
  adapterId: string;
  path: string;                       // adapter-specific path: "params.timbre", "cc.74"
}
```

**Why typed roles over freeform strings**: A curated `SemanticRole` union gives the AI and validation system reliable cross-instrument handles. The AI can reason "reduce brightness" across any instrument that exposes a `brightness` role, without parsing description strings. The set should stay small and grow only when a new role is needed by multiple instruments.

Controls that don't map to a shared role use `semanticRole: null` and rely on their `description` for AI understanding.

### Control State (with Provenance)

The schema describes what a control is. State stores the current value and who set it.

```ts
interface ControlValue {
  value: number | string | boolean;
  source: 'human' | 'ai' | 'default';   // who set this value
  updatedAt?: number;                     // timestamp, optional
}

type ControlState = Record<string, ControlValue>;   // controlId → current state
```

**Why provenance matters**: Gluon's arbitration model says the human's hands always win. Knowing whether a value was set by the human or the AI is essential for:

- **Arbitration**: When both human and AI touch the same parameter, the human's value takes precedence. Provenance tells the system whose value is current.
- **Undo**: The undo system reverses all actions (human and AI) in LIFO order. Provenance tells it which values to restore.
- **UI feedback**: The interface can show which parameters the AI changed in its last action.

### Examples

**Plaits Virtual Analog:**

```ts
const plaitsControls: ControlSchema[] = [
  {
    id: 'brightness', name: 'Brightness', kind: 'continuous',
    semanticRole: 'brightness',
    description: 'Spectral content of the oscillator, low = dark, high = bright.',
    readable: true, writable: true,
    range: { min: 0, max: 1, default: 0.5 },
    group: 'timbre',
    binding: { adapterId: 'plaits-wasm', path: 'params.timbre' },
  },
  {
    id: 'texture', name: 'Texture', kind: 'continuous',
    semanticRole: 'texture',
    description: 'Surface quality and movement of the sound.',
    readable: true, writable: true,
    range: { min: 0, max: 1, default: 0.5 },
    group: 'timbre',
    binding: { adapterId: 'plaits-wasm', path: 'params.morph' },
  },
  {
    id: 'richness', name: 'Richness', kind: 'continuous',
    semanticRole: 'richness',
    description: 'Harmonic density of the oscillator.',
    readable: true, writable: true,
    range: { min: 0, max: 1, default: 0.5 },
    group: 'timbre',
    binding: { adapterId: 'plaits-wasm', path: 'params.harmonics' },
  },
];
```

**Digitone via MIDI:**

```ts
const digitoneControls: ControlSchema[] = [
  {
    id: 'brightness', name: 'Brightness', kind: 'continuous',
    semanticRole: 'brightness',
    description: 'Low-pass filter cutoff, controls brightness.',
    readable: true, writable: true,
    range: { min: 0, max: 1, default: 0.5 },
    group: 'filter',
    binding: { adapterId: 'digitone-midi', path: 'cc.74' },
  },
  {
    id: 'fm-depth', name: 'FM Amount', kind: 'continuous',
    semanticRole: null,
    description: 'Frequency modulation depth, adds metallic/bell-like harmonics.',
    readable: true, writable: true,
    range: { min: 0, max: 1, default: 0.0 },
    group: 'timbre',
    binding: { adapterId: 'digitone-midi', path: 'cc.46' },
  },
];
```

The AI can reason about both using the same vocabulary: "reduce brightness to darken the sound." The adapter maps `brightness` to Plaits `timbre` in one case and MIDI CC 74 in the other.

### Region

A region is a named time span containing musical content.

```ts
type RegionKind = 'pattern' | 'clip' | 'automation_lane';

interface Region {
  id: string;
  kind: RegionKind;
  start: number;                      // position in beats
  duration: number;                   // length in beats
  loop: boolean;
  name?: string;
  events: MusicalEvent[];             // the content
}
```

A voice can own multiple regions (verse pattern, chorus pattern, fills, automation lanes). For now, most voices will have a single looping pattern region. When a voice is instantiated, it is created with one default region: a looping pattern region spanning one bar. When an AI `sketch` operation omits `regionId`, it targets this default region. The current `Pattern` type (steps with gate/accent/params) becomes an adapter that reads and writes the default region for the step-grid renderer.

#### Automation Lane Regions

An `automation_lane` region contains only `ParameterEvent`s for a single `controlId`. This separates continuous automation curves (filter sweeps, volume swells) from per-step parameter locks that live inline with notes in the pattern region.

**Composition rules at playback:**

```
At any given step:
  if inline_param_lock exists for (trackId, controlId, step):
    use inline_param_lock.value            // most specific
  else if automation_lane exists for (trackId, controlId):
    interpolate automation_lane at position // continuous curve
  else:
    use track.params[controlId]            // base value
```

This follows the Renoise hybrid model where inline effect commands and graphical automation envelopes coexist on the same parameter. See `docs/rfcs/parameter-automation-research.md` for full research and #463 for implementation tracking.

### Musical Event

Events are the atomic time-based content within regions.

```ts
type EventKind = 'note' | 'trigger' | 'parameter';

interface BaseEvent {
  at: number;                         // position in beats from region start
  kind: EventKind;
}

interface NoteEvent extends BaseEvent {
  kind: 'note';
  pitch: number;                      // MIDI note number (0–127)
  velocity: number;                   // 0–1
  duration: number;                   // length in beats
}

interface TriggerEvent extends BaseEvent {
  kind: 'trigger';
  velocity?: number;                  // 0–1
  accent?: boolean;
}

interface ParameterEvent extends BaseEvent {
  kind: 'parameter';
  controlId: string;
  value: number | string | boolean;
  interpolation?: 'step' | 'linear' | 'curve';  // default: 'step'
  tension?: number;                     // -1.0 to 1.0, curve shape (0 = linear). Only meaningful when interpolation is 'curve'.
}

type MusicalEvent = NoteEvent | TriggerEvent | ParameterEvent;
```

This abstraction backs step sequencers, trackers, piano rolls, MIDI clips, and arrangement automation. The `tension` field follows Reaper's per-point curvature model — a single scalar that shapes the curve between two breakpoints without requiring full bezier control points. See #408 for interpolation implementation.

### Project

The top-level container. This is what the AI sees as "the current state."

```ts
interface Project {
  tracks: Voice[];
  transport: TransportState;
  context: MusicalContext;
  messages: ChatMessage[];
  undoStack: UndoEntry[];
}

interface TransportState {
  playing: boolean;
  bpm: number;
  swing: number;
  timeSignature: [number, number];
}

interface MusicalContext {
  key: string | null;
  scale: string | null;
  energy: number;       // 0–1
  density: number;      // 0–1
}
```

---

## Instrument Registry

A registry of known instruments and their specifications. Shared between the AI (for prompt construction), the UI (for control rendering), and validation.

```ts
interface InstrumentDef {
  type: string;                       // "plaits", "digitone", "operator"
  label: string;                      // "Plaits Virtual Analog", "Elektron Digitone"
  adapterId: string;                  // "plaits-wasm", "digitone-midi"
  engines: EngineDef[];               // available engines/presets/models
}

interface EngineDef {
  id: string;                         // "virtual-analog", "fm", "analog-bass-drum"
  label: string;
  description: string;                // musical description for the AI
  controls: ControlSchema[];
}
```

For Plaits, this replaces the hardcoded model list in the system prompt with a machine-readable registry. The system prompt is generated from the registry, not hand-written.

For hardware, this is the "hardware profile" described in the architecture doc, formalised as the same data structure.

---

## Adapter Architecture

Each runtime implements an adapter that bridges the musical model and the concrete system.

```ts
interface SourceAdapter {
  id: string;
  name: string;

  // --- Write path (model → runtime) ---

  // Translate semantic control IDs to implementation params
  mapControl(controlId: string): { path: string };

  // Apply control value changes to the runtime
  applyControlChanges(changes: { controlId: string; value: number | string | boolean }[]): void;

  // Translate musical events to the runtime's native format
  mapEvents(events: MusicalEvent[]): NativeEvents;

  // --- Read path (runtime → model) ---

  // Read current control values from the runtime
  readControlState(): ControlState;

  // Read current regions/events from the runtime (if applicable)
  readRegions(): Region[];

  // --- Schema and validation ---

  // Provide the control schemas for a given engine
  getControlSchemas(engineId: string): ControlSchema[];

  // Validate an operation before it executes
  validateOperation(op: AIOperation): { valid: boolean; reason?: string };
}
```

The read path matters because not all state originates in Gluon. A MIDI device may have knobs the user turns directly; an Ableton session has state that changes outside Gluon's control. The adapter is responsible for reading that state back into the canonical model so the AI sees the truth. For the Plaits WASM adapter the read path is trivial (state lives in memory), but formalising it now prevents the interface from assuming write-only adapters.

### Planned Adapters

| Adapter | Adapter ID | Maps to |
|---------|-----------|---------|
| Plaits WASM | `plaits-wasm` | AudioWorklet params, Plaits model index |
| Rings WASM | `rings-wasm` | AudioWorklet params (processor) |
| Clouds WASM | `clouds-wasm` | AudioWorklet params (processor) |
| MIDI hardware | `midi-out` | MIDI CC, note-on/off, program change |
| Ableton Live | `ableton-live` | Live API calls, clip writing, automation |

Only `plaits-wasm` exists today. Others are built when needed.

---

## AI Operation Vocabulary

The AI's actions stay close to the current protocol, extended for processors.

### Core Operations

```ts
type AIOperation =
  | MoveOp
  | SketchOp
  | AddProcessorOp
  | RemoveProcessorOp
  | SetProcessorParamOp
  | SayOp;

// Set a control on a voice
interface MoveOp {
  type: 'move';
  trackId: string;
  controlId: string;
  target: { absolute: number } | { relative: number };
  overMs?: number;
}

// Write musical events to a voice's region
interface SketchOp {
  type: 'sketch';
  trackId: string;
  regionId?: string;                  // omit for default region
  mode: 'replace' | 'merge';
  events: MusicalEvent[];
  description: string;
}

// Add a processor to a voice's chain
interface AddProcessorOp {
  type: 'add_processor';
  trackId: string;
  processorType: string;
  position?: number;
}

// Remove a processor from a voice's chain
interface RemoveProcessorOp {
  type: 'remove_processor';
  trackId: string;
  processorId: string;
}

// Set a control on a processor
interface SetProcessorParamOp {
  type: 'set_processor_param';
  trackId: string;
  processorId: string;
  controlId: string;
  value: number;
}

// Communicate
interface SayOp {
  type: 'say';
  text: string;
}
```

### Mapping from Current Protocol

```
Current           →  This RFC
──────────────────────────────────
move              →  move (controlId replaces param name)
sketch            →  sketch (events replace steps)
say               →  say (unchanged)
(new in 4A)       →  add_processor / remove_processor / set_processor_param
```

The rename from `param` to `controlId` in `move` is the only breaking change to the current action vocabulary. The AI still says `move` and `sketch` — the semantic meaning is identical.

### What the AI Does NOT Do

The AI does not:
- Reference implementation-specific identifiers (Plaits model numbers, MIDI CC numbers, Web Audio node names)
- Know what runtime is producing the sound
- Emit raw MIDI messages or Web Audio commands
- Manipulate the rendering representation (step indices, tracker rows) — it writes musical events

---

## Validation Invariants

These are engineering commitments that hold regardless of which adapter or UI is active.

1. **Every writable AI operation must target a known voice, processor, or region.** Operations targeting nonexistent entities fail cleanly with no partial mutation.
2. **Every control write must reference a declared control schema.** The AI cannot write to controls that the adapter hasn't exposed.
3. **Adapter validation runs before side effects.** The adapter's `validateOperation` is called before any state mutation. Invalid operations are rejected, not partially applied.
4. **Agency is enforced at the model layer, not only in adapters.** A voice with `agency: 'OFF'` rejects all AI operations regardless of the adapter.
5. **Undo snapshots are generated from validated operations.** The undo system captures the inverse of each operation, not opaque full-state snapshots (where possible).

---

## How This Relates to Phase 4A

The Phase 4A RFC's constrained patch-chain model maps directly onto this architecture:

```
Phase 4A Concept          →  This RFC
────────────────────────────────────────────
PatchChain.source         →  Voice.source
PatchChain.processors     →  Voice.chain (Processor[])
ModuleInstance.params     →  ControlSchema[] + ControlState
ModuleSpec (registry)     →  InstrumentDef / EngineDef
PatchOp (AI operations)   →  add_processor / remove_processor / set_processor_param
ModulationAssignment      →  Deferred to Phase 4B
```

Phase 4A becomes: "add the first Processor implementations (Rings, Clouds, Ripples) and the first processor operations." The data model is already there.

---

## Migration Strategy

Incremental. The existing codebase continues to work at every step.

### Step 1: Define types

Add the types (`ControlSchema`, `SemanticRole`, `ControlState`, `Region`, `MusicalEvent`, `InstrumentDef`, etc.) alongside the existing types. No runtime changes. No behaviour changes.

### Step 2: Build the Plaits instrument registry

Define `InstrumentDef` and `EngineDef` for all Plaits models. Use the registry to generate the system prompt's model reference and parameter sections instead of hand-writing them. Existing runtime param names (`timbre`, `morph`, `harmonics`) remain — the registry adds semantic metadata on top via `ControlBinding`.

### Step 3: Introduce event abstraction

Build the `Region` + `MusicalEvent` ↔ `Step[]` bidirectional conversion in the sketch action path. The AI starts writing events; the adapter converts to steps for the sequencer. The step grid UI doesn't change.

### Step 4: Add semantic control IDs

Add the mapping layer in the Plaits adapter: `brightness` ↔ `timbre`, `texture` ↔ `morph`, `richness` ↔ `harmonics`. The AI sees semantic names; the runtime uses Plaits names. This is a thin translation, not a rewrite.

### Step 5: Add control-state provenance

Extend the existing param state to track `source` (human/AI/default). Wire this into the arbitration and undo systems.

### Step 6: Add processors (Phase 4A)

Voices gain `chain: Processor[]`. The adapter layer and control schema system are already in place for processor params.

### Step 7: Add second adapter

When MIDI output or another backend is added, a new adapter maps the same `ControlSchema` / `MusicalEvent` abstractions to the new runtime. No changes to the AI layer, protocol, undo system, or UI framework. **This is the proof that the abstraction works.** Do not declare the model proven until a second genuinely different adapter exists.

---

## Part 2: Architectural North Star (Build Later)

This section describes where the model is headed when Gluon outgrows voices as its only editable object. **Do not build this yet.** It is documented here so the implementation plan doesn't accidentally preclude it, and so there's a shared reference when these capabilities are needed.

### Voice → Target

When Gluon needs to address things that aren't voices — standalone effect sends, mixer channels, clip launchers, arrangement tracks, macro controllers, external devices — `Voice` generalises to `Target`.

```ts
type TargetKind =
  | 'instrument'        // current Voice
  | 'processor'         // standalone effect (not in a voice's chain)
  | 'modulator'         // standalone modulation source
  | 'mixer_channel'
  | 'external_device'
  | 'clip_launcher'
  | 'arrangement_track';

interface Target {
  id: string;
  kind: TargetKind;
  name: string;
  role?: string;
  agency: 'OFF' | 'ON';
  adapterId: string;
  controls: ControlSchema[];
  controlState: ControlState;
  children?: string[];                // ordered child target IDs
  muted: boolean;
  solo: boolean;
  metadata?: Record<string, string | number | boolean>;
}

// A voice is still a voice
type Voice = Target & { kind: 'instrument' };
```

**Promotion trigger**: Build this when the first non-instrument target is needed. The likely forcing functions are: standalone effect sends (Phase 4B), MIDI hardware as a first-class target, or Ableton track integration.

### Voice.chain → Routes

When Gluon needs signal flow beyond linear chains — parallel paths, sends, modulation routing, sidechain — the implicit `chain` ordering is replaced by explicit `Route[]` at the project level.

```ts
type RouteKind = 'audio' | 'control' | 'modulation';

interface Route {
  id: string;
  kind: RouteKind;
  sourceTargetId: string;
  destinationTargetId: string;
  metadata?: Record<string, string | number | boolean>;
}
```

**Promotion trigger**: Build this when Phase 4B introduces modulation assignments or parallel signal paths.

### Regions → Project-Level Regions

When Gluon needs clip launching, arrangement editing, or regions that span multiple voices, regions move from being owned by a voice to being a project-level concept with explicit target associations.

**Promotion trigger**: Build this when arrangement editing or clip launching is designed.

### Project Policies

When per-voice agency isn't sufficient — e.g. locking tempo, protecting certain targets from AI editing, allowing the AI to edit only a subset of the project — a formal policy layer is introduced.

```ts
interface ProjectPolicies {
  protectedVoiceIds: string[];
  tempoLocked?: boolean;
  keyLocked?: boolean;
  scaleLocked?: boolean;
}
```

**Promotion trigger**: Build this when a concrete use case demands more than per-voice `agency: 'OFF' | 'ON'`.

### Operation Vocabulary Evolution

When the `Target` abstraction is adopted, the AI operation vocabulary generalises:

```
Implementation (now)      →  North Star (later)
──────────────────────────────────────────────────
move (trackId)            →  move_control (targetId)
sketch (trackId)          →  write_events (targetId)
add_processor (trackId)   →  add_target (parentTargetId)
remove_processor          →  remove_target
set_processor_param       →  move_control (targetId = processorId)
say                       →  say
(not yet needed)          →  add_route / remove_route
```

This is a mechanical rename, not an architectural change. The semantics are identical.

---

## What This Does Not Define

**UI rendering** — How controls are displayed (sliders, XY pads, knobs) is a UI concern. The data model provides metadata; the UI decides presentation.

**AI reasoning quality** — Whether the AI makes good musical decisions is a function of the model, the prompt, and the control descriptions — not the data model.

**Audio evaluation** — How the AI listens to its own work. That's orthogonal.

**Specific instrument catalogues** — Which hardware profiles, VSTs, or Ableton devices are supported. Those are content, not architecture.

**System prompt wording** — The prompt is generated from the registry, but its exact wording is a separate concern.

---

## Acceptance Criteria

### Implementation plan (build now)

1. The repo has types for `ControlSchema`, `SemanticRole`, `ControlState`, `Region`, `MusicalEvent`, and the adapter interface.
2. The current Plaits voice can be represented through the new control and event model.
3. The system prompt is generated from the instrument registry, not hand-written.
4. An AI-facing contract document exists, generated from this RFC and the registry, containing only what the agent needs at inference time: type definitions, serialised state format, worked round-trip examples, semantic role guidance with musical grounding, and validation rules as hard constraints. No rationale, no north star.
5. The step sequencer continues to work unchanged while the AI writes abstract events.
6. Control state tracks provenance (human vs AI) and the arbitration system uses it.
7. Phase 4A processors slot into `Voice.chain` without new abstractions.

### North star (prove later)

7. Adding a new instrument type (MIDI, Ableton, sampler) requires only a new adapter and registry entry — no changes to the AI layer, protocol, undo system, or UI framework.
8. At least one non-Plaits adapter can be represented without changing the AI operation vocabulary.
9. A new editing surface (tracker, piano roll) can be added as a projection over regions and events rather than inventing a separate state model.

---

## Resolved Decisions

**Undo granularity**: One undo entry per AI action group. If the AI responds to "darken the bass and add more swing" with three `move` operations, they form a single undoable group. Per-control undo within an action group is both confusing to the user and complex to implement. This is consistent with the existing undo model and is what validation invariant 5 depends on.

**Pitch representation**: MIDI note numbers (0–127) at the canonical layer. Adapters that need normalised pitch convert at the boundary. This avoids every consumer of `NoteEvent` needing to handle two representations.

---

## Open Questions

1. Which semantic roles are essential in v1, and which are too vague to be reliable? The initial set should be validated against the Plaits parameter space and at least one hypothetical MIDI instrument.
2. How much adapter-specific metadata should be exposed to the AI by default?
3. Should human gesture history live in the canonical model or in a derived interaction layer?

These questions are important but do not block the core direction.

---

## Relationship to Other Documents

- **Protocol (v0.5.0)**: This RFC extends the protocol's voice model with semantic controls and abstract events. The protocol's principles (human wins, AI acts when asked, undo is one action away) are unchanged.
- **Phase 4A RFC**: The patch-chain model fits inside this RFC's voice model. Phase 4A implementation uses this as its data model foundation.
- **Modular roadmap**: The long-term vision (Phases 4B–6) is enabled by this abstraction layer. The north-star section of this RFC maps directly onto the modular roadmap's later phases.
- **Architecture doc**: The hardware profiles section already describes semantic parameter mapping for MIDI devices. This RFC formalises that into a shared registry covering all source types.
