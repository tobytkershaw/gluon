# Gluon Interaction Protocol

**Version:** 0.5.0 (Draft)

---

## What This Defines

How a human musician and an AI share control of a musical instrument. The objects, the verbs, and the rules that hold the whole thing together.

---

## Principles

**1. The human's hands always win.** If you touch a parameter, the AI gets out of the way. Immediately. No negotiation.

**2. The AI programs the instrument. It does not replace it.** The AI's contributions flow through the same engines, parameters, and signal chain as the human's. What it does is exposed, tweakable, and reversible. This is not a prompt-to-track generator. It's a shared instrument.

**3. The AI acts when asked.** The human directs the AI via natural language. The AI makes structured changes to the project and reports what it did. No unsolicited actions.

**4. The AI can hear its own work.** After making changes, the AI can capture audio and evaluate whether it achieved what the human asked for. This is a discrete evaluation step, not continuous listening.

**5. Undo is always one action away.** You never need to think about how to get back. Just undo.

---

## Objects

The protocol operates on a small set of objects. These are the things the AI sees and acts on.

### Session

The top-level container. One session is one working project.

```
Session {
  tracks: [Track]
  transport: Transport
  undo_stack: [Snapshot]
  messages: [ChatMessage]
}
```

### Track

A thing that makes sound (`audio`) or routes signal (`bus`). A track has a signal chain of one or more modules, with normalised parameters, sequencing content, and optional UI configuration.

```
Track {
  id: TrackID
  kind: "audio" | "bus"            // Audio tracks produce sound; bus tracks receive via sends
  chain: Chain                     // Signal path through modules
  params: Map<ControlID, f32>     // Normalised 0.0-1.0, semantic names
  agency: Agency
  regions: [Region]                // Sequencing content (source of truth)
  patterns: [Pattern]              // Named patterns with events
  sequence: [PatternRef]           // Arrangement order for song-mode playback
  views: [SequencerViewConfig]     // Active sequencer projections
  modulators: [ModulatorConfig]    // LFO/envelope modules (e.g. Tides)
  modulations: [ModulationRouting] // Modulator → param routings
  sends: [Send]                    // Post-fader sends to bus tracks
  muted: bool
  solo: bool
}
```

Parameters use hardware-derived control IDs (`timbre`, `harmonics`, `morph`, `frequency`) that map directly to engine runtime parameters. The only non-identity mapping is `frequency` → `note` at the Plaits adapter boundary.

### Module

A sound source or sound processor. Modules are the building blocks that get glued together into tracks.

```
Module {
  id: ModuleID
  type: ModuleType          // Engine identifier (e.g., "plaits", "rings", "clouds")
  role: "source" | "processor"
  params: Map<ParamID, f32> // Module-specific raw parameters
}
```

A **source** generates sound (a Plaits engine, a sampler, an external synth via MIDI). A **processor** transforms sound (Rings resonator, Clouds granular, a filter, a delay).

The protocol doesn't care what a module actually is — it could be a compiled DSP algorithm running in a WebAssembly AudioWorklet, a hardware Eurorack module controlled via CV/Gate, or a plugin hosted in Ableton. What matters is that every module presents the same interface: an identifier, a role, and normalised parameters.

### Chain

The signal path through a track's modules. Source first, then processors in order.

```
Chain {
  source: Module
  processors: [Module]      // Signal flows left to right
}
```

A simple track has a chain with just a source and no processors. A complex track might be `Plaits(Wavetable) → Rings → Clouds`. The chain determines what parameters exist on the track and what controls surface modules can bind to.

When the chain changes (a module is added, removed, or replaced), the track's parameter set changes with it. This is a structural change, not a parameter change — it's building the instrument, not playing it.

### Adapter

The boundary between the canonical model and an external instrument. Every module type has an adapter that translates between Gluon's semantic world and the module's native interface.

```
Adapter {
  // Canonical → native
  mapControl(controlId) → binding    // "brightness" → CC 74 on ch 1
  applyChanges(changes) → void

  // Native → canonical
  readState() → ControlState
  getControlSchemas() → [ControlSchema]
}
```

For native modules (Plaits compiled to WASM), the adapter is a thin mapping layer. For external hardware, it's a MIDI/OSC/CV bridge with a device profile. For a DAW integration, it might be an Ableton Link or VST host adapter.

The adapter is what makes Gluon's promise real: the AI reasons about semantic parameters and canonical events, and the adapter handles everything below that boundary. A Eurorack Rings module and a WASM Rings module present the same interface to the AI. The human's Elektron Digitone and a software FM synth both look like "a track with parameters" from the protocol's perspective.

### Permission Gates

What the AI is allowed to modify. Currently a per-track binary gate (agency OFF/ON), set by the human.

```
enum Agency {
  OFF    // AI may not modify this track. May still observe it.
  ON     // AI may modify this track when asked by the human.
}
```

Permission gates control **programming** and **structure** operations. They do not gate **observation** (listen, render, analyze) or **UI curation** (manage_view, set_surface, pin_control, label_axes). OFF means "don't change my sound or my instrument," not "don't help me look at this track."

When a gate blocks an action, the system raises a **permission request** (decision prompt) rather than hard-rejecting. The AI receives `{ blocked: true, reason: "agency_off", decisionId }` and waits for the human to approve or deny. This allows the AI to propose changes to protected material without silently modifying it.

**Current state:** Agency is the binary per-track gate (OFF/ON). Tracks can additionally be claimed by the human via `set_track_meta(claimed: true)`, which signals the AI to ask permission before modifying. Master bus volume/pan changes require human permission by default.

### Transport

Global playback state shared across all tracks.

```
Transport {
  bpm: f32          // 20-300
  swing: f32        // 0.0-1.0 (0 = straight)
  playing: bool
  timeSignature: { numerator: int, denominator: int }
}
```

### Region

A container for canonical musical events. The sequencing source of truth.

```
Region {
  id: RegionID
  kind: "pattern" | "clip" | "automation_lane"
  start: f32
  duration: f32
  loop: bool
  events: [MusicalEvent]
}
```

Currently each track has one region. Multi-region composition is deferred.

### MusicalEvent

The atomic unit of sequencing content. Three kinds:

```
TriggerEvent {
  kind: "trigger"
  at: f32               // Position in steps (fractional, 0-based)
  velocity: f32         // 0.0-1.0
  accent: bool
}

NoteEvent {
  kind: "note"
  at: f32
  pitch: u8             // MIDI 0-127
  velocity: f32
  duration: f32         // In beats
}

ParameterEvent {
  kind: "parameter"
  at: f32
  controlId: ControlID  // Semantic control name
  value: f32 | string | bool
}
```

Events are sparse — only positions with activity are represented. Fractional `at` values support microtiming.

### SequencerView

A UI projection over a track's region. Views are presentation state — they change what the human sees, not what the instrument plays.

```
SequencerViewConfig {
  kind: SequencerViewKind    // "step-grid" | "piano-roll" (future)
  id: string
}
```

The **tracker** is always present (not in the views list) and shows exact canonical event truth. Other views are addable/removable projections that trade fidelity for task-specific convenience:

- **Step grid**: quantised slot view, good for quick percussion programming
- **Piano roll** (future): pitch × time rectangles, good for melodic editing

All views read from and write back through the same canonical region data. No view owns or duplicates musical content.

---

## What the Human Does

### `play`

Touch a parameter. Move a knob. Play a note. Toggle a step. Direct manipulation of the instrument. Always takes priority over AI changes.

### `ask`

Talk to the AI in natural language:

- "Give me a four-on-the-floor kick pattern"
- "Make the bass darker and more sub-heavy"
- "Add Rings to the lead track"
- "Patch the LFO into the filter cutoff"
- "Listen to the mix — is the kick cutting through?"
- "Show me the kick pattern in a step grid"

The AI reads the full project state and responds with structured changes.

### `undo`

Reverse the most recent action or action group. If the AI made a coordinated change across three tracks, undo reverses all three at once. Multiple undos walk back through the stack.

---

## What the AI Does

All AI actions are in response to a human `ask`. The AI never acts unsolicited.

The AI's actions fall into five categories. The categories matter because they have different rules about permission gates, approval, and what they affect.

### Program

Set up what the instrument plays and how it sounds — patterns, parameters, transformations. **Requires track agency ON.** Immediately audible. Undoable.

#### `move`

Change a control parameter on a track.

```
move {
  param: ControlID
  target: { absolute: f32 } | { relative: f32 }
  trackId: TrackID?          // Defaults to active track
  over: ms?                  // Smooth transition duration
}
```

#### `sketch`

Write a rhythmic or melodic pattern as canonical musical events.

```
sketch {
  trackId: TrackID
  description: string
  events: [MusicalEvent]     // Sparse event list
}
```

Events use `kind: "trigger"` for percussion and `kind: "note"` (with MIDI pitch) for melodic content. Parameter events (`kind: "parameter"`) create per-step control locks.

#### `transform`

Structurally modify an existing pattern without rewriting it. See [ai-contract.md](docs/ai/ai-contract.md) for the full parameter list.

```
transform {
  trackId: TrackID
  operation: "rotate" | "transpose" | "reverse" | "duplicate" | "humanize" | "euclidean" | "ghost_notes" | "swing" | "thin" | "densify"
  steps: int?                // For rotate (positive=forward, negative=backward)
  semitones: int?            // For transpose (positive=up, negative=down)
  description: string
  // Additional operation-specific parameters — see ai-contract.md
}
```

### Structure

Change what the instrument is — its modules, signal chain, and configuration. **Requires track agency ON.** Changes the instrument's topology, not just its current state. Undoable.

#### `set_model`

Change the mode of a module. Without `processorId`/`modulatorId`, changes the track synthesis engine. With `processorId`, changes the processor's mode. With `modulatorId`, changes the modulator's mode.

```
set_model {
  trackId: TrackID
  model: EngineID
  processorId: ProcessorID?    // Target a processor's mode
  modulatorId: ModulatorID?    // Target a modulator's mode
}
```

#### `manage_processor`

Add, remove, replace, or bypass a processor module in a track's chain. Max 2 per track.

```
manage_processor {
  action: "add" | "remove" | "replace" | "bypass"
  trackId: TrackID
  moduleType: ModuleType?      // Required for add/replace. "rings", "clouds"
  processorId: ProcessorID?    // Required for remove/replace/bypass
  enabled: bool?               // For bypass: false=bypass, true=re-enable
  description: string
}
```

Returns `{ processorId }` (add) or `{ newProcessorId }` (replace) for same-turn configuration.

#### `manage_modulator`

Add or remove a modulator module (LFO/envelope) on a track. Max 2 per track. Use `modulation_route` to wire it to parameters.

```
manage_modulator {
  action: "add" | "remove"
  trackId: TrackID
  moduleType: ModuleType?      // Required for add. "tides"
  modulatorId: ModulatorID?    // Required for remove
  description: string
}
```

Returns `{ modulatorId }` for same-turn configuration. Remove cascades: all routings from this modulator are also removed.

#### `modulation_route`

Connect or disconnect a modulation routing. Idempotent — calling connect with the same modulator + target updates the depth.

```
modulation_route {
  action: "connect" | "disconnect"
  trackId: TrackID
  modulatorId: ModulatorID?    // Required for connect
  modulationId: ModulationID?  // Required for disconnect
  targetKind: "source" | "processor"?  // Required for connect
  processorId: ProcessorID?    // Required when targetKind is "processor"
  targetParam: ControlID?      // Required for connect. e.g. "timbre", "position"
  depth: f32?                  // Required for connect. -1.0 to 1.0 (bipolar)
  description: string
}
```

Returns `{ modulationId }` for same-turn disconnect. Human sets center, modulation adds around it. Multiple routings to the same param sum additively.

#### `manage_track`

Add or remove a track from the session. Adding does not require agency. Removing requires agency ON.

```
manage_track {
  action: "add" | "remove"
  kind: "audio" | "bus"?     // Required for add
  trackId: TrackID?          // Required for remove
  label: string?             // Optional display name
  description: string
}
```

Structure operations trigger downstream effects: adding a module changes the available parameters, which may invalidate the current semantic surface, which triggers a surface re-curation flow (see the curated surfaces RFC).

### Transport

Global playback control. **No agency gate** — transport is shared, not per-track. Undoable.

#### `set_transport`

Change tempo, swing, time signature, or play/stop state.

```
set_transport {
  bpm: f32?                       // 20-300
  swing: f32?                     // 0.0-1.0
  playing: bool?
  timeSignatureNumerator: int?    // Beats per bar (1-16)
  timeSignatureDenominator: int?  // Beat unit (2, 4, 8, or 16)
}
```

### Observation

Inspect the current state without changing anything. **No agency gate.** Not undoable (nothing to undo).

#### `listen`

Render audio offline and evaluate how it sounds. Works whether or not the transport is playing.

```
listen {
  question: string       // "How does the kick sound?", "Is the mix balanced?"
  trackIds: [TrackID]?   // Render specific tracks in isolation. Default: all unmuted.
  bars: int?             // Number of bars to render (1-16, default 2)
  lens: string?          // Focus: "full-mix", "low-end", "rhythm", "harmony", "texture", "dynamics"
  compare: {             // Optional before/after comparison
    beforeSessionIndex: int
    question: string
  }?
}
```

Renders audio offline from the current project state, converts to WAV, and sends it with a critique prompt to the model. Returns a text critique. Within a single turn, `listen` evaluates the current projected state, including edits made earlier in the same tool loop.

#### `render`

Capture an audio snapshot with explicit scope. Returns a `snapshotId` for use with `analyze`.

```
render {
  scope: TrackID | [TrackID]?   // Track(s) to render. Omit for full mix.
  bars: int?                     // Duration in bars (1-16, default 2)
}
```

#### `analyze`

Run deterministic audio analysis on a rendered snapshot. Supports multiple analysis types in a single call. See [ai-contract.md](docs/ai/ai-contract.md) for the full parameter list including `compareSnapshotId`, `snapshotIds`, and `referenceProfile`.

```
analyze {
  snapshotId: string            // From a previous render call
  types: ["spectral" | "dynamics" | "rhythm" | "masking" | "diff" | "reference"]
  compareSnapshotId: string?    // For diff analysis (before state)
  snapshotIds: [string]?        // For masking analysis (multiple tracks)
  referenceProfile: string?     // For reference analysis (genre profile)
}
```

Spectral: centroid, rolloff, flatness, bandwidth, pitch. Dynamics: LUFS, RMS, peak, crest factor. Rhythm: tempo estimate, onsets, density, swing. Masking: cross-track frequency conflict detection. Diff: before/after comparison with structured deltas. Reference: compare against genre profiles.

### UI Curation

Changes to what the human sees, not what the instrument plays. **No agency gate** — the AI should be able to help the human inspect any track regardless of agency. No sound change. Undoable. Persistent.

#### `manage_view`

Add or remove a sequencer view on a track.

```
manage_view {
  action: "add" | "remove"
  trackId: TrackID
  viewKind: SequencerViewKind?  // Required for add. "step-grid"
  viewId: string?               // Required for remove
  description: string
}
```

#### `set_surface`

Compose a track's UI surface from modules. Each module has a type, bindings, a grid position, and optional configuration.

```
set_surface {
  trackId: TrackID
  modules: [{
    type: "knob-group" | "macro-knob" | "xy-pad" | "step-grid" | "chain-strip" | "piano-roll" | "pad-grid"
    bindings: [{
      moduleId: string        // "source" or a processor ID
      controlId: ControlID
    }]
    position: { col: int, row: int, colSpan?: int, rowSpan?: int }
    config: {                 // Type-specific (optional)
      label?: string          // For knob-group
      semanticControl?: {     // For macro-knob
        name: string
        weights: [{
          moduleId: string
          controlId: ControlID
          weight: f32          // Must sum to 1.0
          transform: string?   // "linear" (default), "inverse", "bipolar"
        }]
      }
    }?
  }]
  description: string
}
```

Module types:
- **knob-group**: bank of labelled rotary knobs bound to raw or semantic control IDs
- **macro-knob**: single knob with weighted multi-parameter mapping (physical manifestation of a semantic control)
- **xy-pad**: 2D control bound to two parameters
- **step-grid**: TR-style pattern editor
- **chain-strip**: signal flow overview with bypass toggles
- **piano-roll**: melodic event editor
- **pad-grid**: drum rack pad trigger grid

#### `pin_control`

Pin or unpin a raw module control on the track's surface. Creates or removes a pinned knob-group module with `{ pinned: true }`. Max 4 pins per track.

```
pin_control {
  action: "pin" | "unpin"
  trackId: TrackID
  moduleId: string        // "source" or a processor ID
  controlId: ControlID
}
```

#### `label_axes`

Update XY pad axis bindings. **Fails if no xy-pad module exists** on the track's surface — use `set_surface` to add one first.

```
label_axes {
  trackId: TrackID
  x: string               // e.g. "Brightness"
  y: string               // e.g. "Texture"
}
```

All surface tools follow the same pattern as other AI operations: immediate, undoable, no agency gate.

### Track Metadata

#### `set_track_meta`

Set track metadata and mix properties: name, volume, pan, swing, muted, solo, claimed (protection toggle), importance, musicalRole, portamento. At least one field required. Claim changes require a reason. See [ai-contract.md](docs/ai/ai-contract.md) for the full parameter list.

```
set_track_meta {
  trackId: TrackID
  name: string?            // Display name
  volume: f32?             // 0.0-1.0
  pan: f32?                // -1.0 to 1.0
  swing: f32?              // Per-track swing override (0.0-1.0)
  muted: bool?
  solo: bool?
  claimed: bool?           // Human claim — AI must ask before modifying claimed tracks
  importance: f32?         // 0.0-1.0, mix priority
  musicalRole: string?     // e.g. "driving rhythm"
  reason: string?          // Required when changing claim state
}
```

### Decision

#### `raise_decision`

Flag an unresolved question or choice that needs human input. Use when you encounter a subjective choice you should not make alone.

```
raise_decision {
  question: string
  context: string?
  options: [string]?
  trackIds: [TrackID]?
}
```

#### `report_bug`

Report a bug or issue encountered during operation. Use sparingly, only for things that seem genuinely broken.

```
report_bug {
  summary: string
  category: "audio" | "state" | "tool" | "ui" | "other"
  details: string
  severity: "low" | "medium" | "high"
  context: string?
}
```

### Communication

#### `say`

Talk back to the human. Explain what you did, answer questions, describe what you hear. Be concise — changes speak louder than words.

---

## Action Groups

When the AI makes a coordinated change across multiple parameters or voices, those individual actions are bundled into an action group. An action group is the unit of undo: one undo reverses the whole group.

The AI should group actions when they are musically related. "Make it darker" might touch controls on three tracks — that's one undo group.

UI curation actions (manage_view, set_surface, pin_control, label_axes) are grouped with other operations from the same AI response into a single undo entry, following the standard action group pattern.

---

## Arbitration

When human and AI both want to control the same parameter, the human wins. Always.

The runtime uses a cooldown-based arbitration system. When the human touches a parameter, AI actions targeting that track are blocked for a short cooldown period (default 500ms). While the human is actively interacting with a track (e.g. dragging a slider), all AI actions on that track are suppressed until the interaction ends and the cooldown expires. This prevents the AI from fighting the human's hands without requiring frame-level collision detection.

---

## Timescale

The AI operates at a single timescale: **conversational**. The human asks, the AI responds within a few seconds. There is no reactive timescale, no continuous parameter modulation, no reflex responses.

The AI can make multiple changes in a single response (moving parameters, sketching a pattern, adding a module, configuring a view, and explaining the changes), so complex operations don't require multiple round-trips. The AI can also call `listen` within a multi-step turn to evaluate before continuing.

---

## State the AI Sees

The AI receives a compressed, semantically-named representation of the session. This is optimised for reasoning, not for mirroring internals.

Per track:
- Identity: id, label, agency state, approval level
- Chain: source module and processors, in signal order
- Modulators: LFO/envelope modules with current parameters and mode
- Modulations: routing connections from modulators to parameters, with depth
- Controls: hardware-derived parameter values (`timbre`, `harmonics`, `morph`, `frequency`)
- Pattern summary: event count, trigger positions, note pitches, accent positions, density
- Views: active sequencer projections
- Surface: composed modules (knob-group, macro-knob, xy-pad, step-grid, chain-strip) with bindings and positions
- Status: muted, solo, volume, pan
- Metadata: importance, musical role

Global:
- Transport: bpm, swing, playing, time signature
- Musical context: energy, density (inferred)
- Undo depth, redo depth
- Recent human actions (what the human just touched, for context)
- Recent reactions: approval/rejection verdicts on AI actions
- Observed patterns: natural-language summaries derived from reaction history
- Restraint level: `conservative`, `moderate`, or `adventurous` (derived from reactions)
- Open decisions: unresolved questions raised by `raise_decision`

The AI uses hardware-derived control IDs throughout — `timbre`, `harmonics`, `morph`, `frequency`. The only non-identity adapter mapping is `frequency` → `note` at the Plaits boundary.

---

## The Adapter Boundary

Gluon's core promise is that you can glue different instruments onto the same AI-legible core. The adapter is where that happens.

Everything above the adapter is canonical: control IDs, normalised 0-1 values, canonical musical events, regions, tracks. This is the world the AI reasons about.

Everything below the adapter is native: CC numbers, voltage ranges, VST parameter indices, MIDI channels, sample rates. This is the world of specific hardware and software.

The adapter translates bidirectionally:

- **Canonical → native**: the AI moves `brightness` to 0.7 → the adapter sends CC 74 value 89 on MIDI channel 1
- **Native → canonical**: the human turns a hardware knob → the adapter reports that `brightness` changed to 0.65

This boundary is what makes the protocol instrument-agnostic. The AI doesn't need to know whether it's programming a WASM DSP module, a Eurorack rack, or an Ableton track. It sees tracks with parameters. The adapter handles the rest.

### What adapters exist for

- **Native modules** (Plaits, Rings, Clouds compiled to WASM): thin mapping, mostly renaming params
- **Hardware synths** (Elektron, Eurorack): MIDI/OSC/CV bridge with device profiles
- **DAW integration** (Ableton, Bitwig): host adapter for track/clip/device control
- **External instruments** (anything with MIDI): generic MIDI profile with CC mappings

A hardware track and a native track look the same to the AI. That's the point.

### Undo across the adapter boundary

Undo for native modules is exact — restore previous parameter values. Undo for hardware is best-effort — re-send previous CC values, but analogue circuits don't always return to the same sound from the same numbers. That's fine. It's hardware.

---

## What This Does Not Define

**Visual design.** How the parameter space is visualised, where controls live, animation curves. That's design work.

**AI behaviour.** How the AI decides what changes to make, what "darker" means in parameter terms. That's the intelligence layer. This protocol defines what the AI can do, not how it thinks.

**Taste and memory.** How the AI builds aesthetic direction. Per-project memory is implemented (`save_memory`/`recall_memories`/`forget_memory`). Cross-project taste is not yet implemented. See [aesthetic-direction.md](docs/ai/aesthetic-direction.md) and [cross-project-memory.md](docs/rfcs/cross-project-memory.md).

**Module implementation.** How a specific module works internally. The protocol cares that modules have parameters and roles, not how they generate or process sound.

**Transport and networking.** How messages are serialised. Could be in-process calls, WebSocket, OSC, whatever.

**Surface curation internals.** How surface modules are composed, macro-knob weight computation, and chain-aware defaults. See the [AI-curated surfaces RFC](docs/rfcs/ai-curated-surfaces.md) and [surface north star](docs/briefs/visual-language.md). Surface curation is implemented with 7 module types, visual identity, and human editing.

---

## The Whole Thing on One Page

A Gluon session has **tracks** (things that make sound or route signal). Each track has a **chain** of **modules** (sources, processors, and modulators) with **agency** (OFF / ON), **patterns** (named containers of musical events), **modulation routings** (LFO/envelope connections to parameters), and optional **views** (UI projections over that content). **Adapters** bridge between the canonical model and native instruments — hardware, software, or anything with parameters.

The human **plays** (direct manipulation), **asks** (natural language), and **undoes**.

The AI's tools fall into five categories:

| Category | Tools | Agency? | Changes sound? |
|----------|-------|---------|----------------|
| **Program** | move, sketch, edit_pattern, transform | Yes | Yes |
| **Structure** | set_model, manage_processor, manage_modulator, modulation_route, manage_track, manage_drum_pad | Yes | Yes |
| **Transport** | set_transport | No | Yes |
| **Observation** | listen, render, analyze | No | No |
| **Mixing** | manage_send, set_sidechain, set_master, setup_return_bus | Partial | Yes |
| **Arrangement** | manage_pattern, manage_sequence, apply_arrangement_archetype | Yes | Yes |
| **UI curation** | manage_view, set_surface, pin_control, label_axes, set_track_identity | No | No |
| **Track metadata** | set_track_meta | Partial (claim requires ON) | No |
| **Session context** | set_intent, set_section, set_scale, set_chord_progression, set_tension | No | No |
| **Decision** | raise_decision, report_bug, suggest_reactions | No | No |
| **Memory** | save_memory, recall_memories, forget_memory | No | No |
| **Recipes** | apply_chain_recipe, set_mix_role, apply_modulation, shape_timbre, assign_spectral_slot, relate, manage_motif, save_patch, load_patch, list_patches, explain_chain, simplify_chain | Partial | Varies |

51 tools total. See [ai-contract.md](docs/ai/ai-contract.md) for the full tool reference.

Plus **say** — talk back to the human.

Every AI action is applied immediately and is undoable. The AI only acts when asked, and only modifies tracks with agency ON (except observation and UI curation). When human and AI collide on the same parameter, the human wins. Always. Instantly.

That's Gluon: the Claude Code of music, built around an AI-legible musical core that you can glue any instrument onto.
