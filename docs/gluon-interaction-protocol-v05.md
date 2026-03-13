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
  voices: [Voice]
  transport: Transport
  undo_stack: [Snapshot]
  messages: [ChatMessage]
}
```

### Voice

A thing that makes sound. A voice is a signal chain of one or more modules, with normalised parameters, sequencing content, and optional UI configuration.

```
Voice {
  id: VoiceID
  chain: Chain                     // Signal path through modules
  params: Map<ControlID, f32>     // Normalised 0.0-1.0, semantic names
  agency: Agency
  regions: [Region]                // Sequencing content (source of truth)
  pattern: Pattern                 // Derived step-grid cache (never authoritative)
  views: [SequencerViewConfig]     // Active sequencer projections
  modulators: [ModulatorConfig]    // LFO/envelope modules (e.g. Tides)
  modulations: [ModulationRouting] // Modulator → param routings
  muted: bool
  solo: bool
}
```

Parameters use semantic control IDs (`brightness`, `richness`, `texture`, `pitch`) that map to engine-specific runtime parameters through an adapter layer. The AI reasons about semantic names; the adapter handles translation.

### Module

A sound source or sound processor. Modules are the building blocks that get glued together into voices.

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

The signal path through a voice's modules. Source first, then processors in order.

```
Chain {
  source: Module
  processors: [Module]      // Signal flows left to right
}
```

A simple voice has a chain with just a source and no processors. A complex voice might be `Plaits(Wavetable) → Rings → Clouds`. The chain determines what parameters exist on the voice and how they aggregate into semantic controls.

When the chain changes (a module is added, removed, or replaced), the voice's parameter set changes with it. This is a structural change, not a parameter change — it's building the instrument, not playing it.

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

The adapter is what makes Gluon's promise real: the AI reasons about semantic parameters and canonical events, and the adapter handles everything below that boundary. A Eurorack Rings module and a WASM Rings module present the same interface to the AI. The human's Elektron Digitone and a software FM synth both look like "a voice with parameters" from the protocol's perspective.

### Agency

What the AI is allowed to do to a voice. Set per-voice by the human.

```
enum Agency {
  OFF    // AI may not modify this voice. May still observe it.
  ON     // AI may modify this voice when asked by the human.
}
```

Agency gates **programming** and **structure** operations. It does not gate **observation** (listen) or **UI curation** (add_view, remove_view). OFF means "don't change my sound or my instrument," not "don't help me look at this voice."

### Transport

Global playback state shared across all voices.

```
Transport {
  bpm: f32          // 60-200
  swing: f32        // 0.0-1.0 (0 = straight)
  playing: bool
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

Currently each voice has one region. Multi-region composition is deferred.

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

A UI projection over a voice's region. Views are presentation state — they change what the human sees, not what the instrument plays.

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
- "Add Rings to the lead voice"
- "Patch the LFO into the filter cutoff"
- "Listen to the mix — is the kick cutting through?"
- "Show me the kick pattern in a step grid"

The AI reads the full project state and responds with structured changes.

### `undo`

Reverse the most recent action or action group. If the AI made a coordinated change across three voices, undo reverses all three at once. Multiple undos walk back through the stack.

---

## What the AI Does

All AI actions are in response to a human `ask`. The AI never acts unsolicited.

The AI's actions fall into five categories. The categories matter because they have different rules about agency, approval, and what they affect.

### Program

Set up what the instrument plays and how it sounds — patterns, parameters, transformations. **Requires voice agency ON.** Immediately audible. Undoable.

#### `move`

Change a control parameter on a voice.

```
move {
  param: ControlID
  target: { absolute: f32 } | { relative: f32 }
  voiceId: VoiceID?          // Defaults to active voice
  over: ms?                  // Smooth transition duration
}
```

#### `sketch`

Write a rhythmic or melodic pattern as canonical musical events.

```
sketch {
  voiceId: VoiceID
  description: string
  events: [MusicalEvent]     // Sparse event list
}
```

Events use `kind: "trigger"` for percussion and `kind: "note"` (with MIDI pitch) for melodic content. Parameter events (`kind: "parameter"`) create per-step control locks.

#### `transform`

Structurally modify an existing pattern without rewriting it.

```
transform {
  voiceId: VoiceID
  operation: "rotate" | "transpose" | "reverse" | "duplicate"
  steps: int?                // For rotate (positive=forward, negative=backward)
  semitones: int?            // For transpose (positive=up, negative=down)
  description: string
}
```

### Structure

Change what the instrument is — its modules, signal chain, and configuration. **Requires voice agency ON.** Changes the instrument's topology, not just its current state. Undoable.

#### `set_model`

Change the mode of a module. Without `processorId`/`modulatorId`, changes the voice synthesis engine. With `processorId`, changes the processor's mode. With `modulatorId`, changes the modulator's mode.

```
set_model {
  voiceId: VoiceID
  model: EngineID
  processorId: ProcessorID?    // Target a processor's mode
  modulatorId: ModulatorID?    // Target a modulator's mode
}
```

#### `add_processor`

Add a processor module to a voice's chain. Max 2 per voice.

```
add_processor {
  voiceId: VoiceID
  moduleType: ModuleType     // "rings", "clouds"
  description: string
}
```

Returns `{ processorId }` so the AI can reference the new processor in later same-turn calls.

#### `remove_processor`

Remove a processor module from a voice's chain.

```
remove_processor {
  voiceId: VoiceID
  processorId: ProcessorID
  description: string
}
```

#### `replace_processor`

Atomically swap one processor for another type. Keeps chain position.

```
replace_processor {
  voiceId: VoiceID
  processorId: ProcessorID     // Existing processor to replace
  newModuleType: ModuleType    // "rings", "clouds"
  description: string
}
```

Returns `{ newProcessorId }` for same-turn configuration.

#### `add_modulator`

Add a modulator module (LFO/envelope) to a voice. Max 2 per voice. Use `connect_modulator` to wire it to parameters.

```
add_modulator {
  voiceId: VoiceID
  moduleType: ModuleType     // "tides"
  description: string
}
```

Returns `{ modulatorId }` for same-turn configuration.

#### `remove_modulator`

Remove a modulator from a voice. Cascades: all routings from this modulator are also removed.

```
remove_modulator {
  voiceId: VoiceID
  modulatorId: ModulatorID
  description: string
}
```

#### `connect_modulator`

Route a modulator's output to a target parameter. Idempotent — calling with the same modulator + target updates the depth.

```
connect_modulator {
  voiceId: VoiceID
  modulatorId: ModulatorID
  targetKind: "source" | "processor"
  processorId: ProcessorID?    // Required when targetKind is "processor"
  targetParam: ControlID       // e.g. "brightness", "position"
  depth: f32                   // -1.0 to 1.0 (bipolar)
  description: string
}
```

Returns `{ modulationId }` for same-turn disconnect. Human sets center, modulation adds around it. Multiple routings to the same param sum additively.

#### `disconnect_modulator`

Remove a modulation routing by its ID.

```
disconnect_modulator {
  voiceId: VoiceID
  modulationId: ModulationID
  description: string
}
```

#### `create_voice` (future)

Add a new voice to the session.

```
create_voice {
  source: ModuleType         // Initial source module
  label: string              // "KICK", "PAD", etc.
  description: string
}
```

Structure operations trigger downstream effects: adding a module changes the available parameters, which may invalidate the current semantic surface, which triggers a surface re-curation flow (see the curated surfaces RFC).

### Transport

Global playback control. **No agency gate** — transport is shared, not per-voice. Undoable.

#### `set_transport`

Change tempo, swing, or play/stop state.

```
set_transport {
  bpm: f32?          // 60-200
  swing: f32?        // 0.0-1.0
  playing: bool?
}
```

### Observation

Inspect the current state without changing anything. **No agency gate.** Not undoable (nothing to undo).

#### `listen`

Capture a few bars of audio and evaluate how it sounds.

```
listen {
  question: string    // "How does the kick sound?", "Is the mix balanced?"
}
```

Renders what's currently playing, sends the audio to a multimodal model, and returns a musical critique. Changes made in the same turn aren't audible yet — listen in a follow-up turn to hear edits.

### UI Curation

Changes to what the human sees, not what the instrument plays. **No agency gate** — the AI should be able to help the human inspect any voice regardless of agency. No sound change. Undoable. Persistent.

#### `add_view`

Add a sequencer view to a voice.

```
add_view {
  voiceId: VoiceID
  viewKind: SequencerViewKind
  description: string
}
```

#### `remove_view`

Remove a sequencer view from a voice.

```
remove_view {
  voiceId: VoiceID
  viewId: string
  description: string
}
```

#### Future UI curation operations

The curated surfaces RFC defines additional operations for when voices have multi-module chains:

- **`set_surface`** — set semantic control aggregation across chain modules (e.g., "Brightness" maps to Plaits timbre + Rings brightness + Clouds feedback). Immediate and undoable, like all other AI actions.
- **`pin`** / **`unpin`** — surface or remove a raw module control for direct access
- **`label_axes`** — set XY pad axis bindings

These follow the same pattern as all other AI operations: immediate, undoable, no approval gate. The human undoes if they don't like the result.

### Communication

#### `say`

Talk back to the human. Explain what you did, answer questions, describe what you hear. Be concise — changes speak louder than words.

---

## Action Groups

When the AI makes a coordinated change across multiple parameters or voices, those individual actions are bundled into an action group. An action group is the unit of undo: one undo reverses the whole group.

The AI should group actions when they are musically related. "Make it darker" might touch controls on three voices — that's one undo group.

UI curation actions (add_view, remove_view, set_surface, pin, unpin, label_axes) are grouped with other operations from the same AI response into a single undo entry, following the standard action group pattern.

---

## Arbitration

When human and AI both want to control the same parameter, the human wins. Always. Instantly.

If the human touches a parameter, the AI's value is overwritten. If the human undoes while the AI's changes are being applied, the changes are cancelled.

---

## Timescale

The AI operates at a single timescale: **conversational**. The human asks, the AI responds within a few seconds. There is no reactive timescale, no continuous parameter modulation, no reflex responses.

The AI can make multiple changes in a single response (moving parameters, sketching a pattern, adding a module, configuring a view, and explaining the changes), so complex operations don't require multiple round-trips. The AI can also call `listen` within a multi-step turn to evaluate before continuing.

---

## State the AI Sees

The AI receives a compressed, semantically-named representation of the session. This is optimised for reasoning, not for mirroring internals.

Per voice:
- Identity: id, label, agency state
- Chain: source module and processors, in signal order
- Modulators: LFO/envelope modules with current parameters and mode
- Modulations: routing connections from modulators to parameters, with depth
- Controls: semantic parameter values (brightness, richness, texture, pitch)
- Pattern summary: event count, trigger positions, note pitches, accent positions, density
- Views: active sequencer projections
- Status: muted, solo

Global:
- Transport: bpm, swing, playing
- Musical context: energy, density (inferred)
- Undo depth
- Recent human actions (what the human just touched, for context)

The AI uses semantic control IDs throughout — `brightness` not `timbre`, `richness` not `harmonics`. The adapter layer translates at the boundary.

---

## The Adapter Boundary

Gluon's core promise is that you can glue different instruments onto the same AI-legible core. The adapter is where that happens.

Everything above the adapter is canonical: semantic control IDs, normalised 0-1 values, canonical musical events, regions, voices. This is the world the AI reasons about.

Everything below the adapter is native: CC numbers, voltage ranges, VST parameter indices, MIDI channels, sample rates. This is the world of specific hardware and software.

The adapter translates bidirectionally:

- **Canonical → native**: the AI moves `brightness` to 0.7 → the adapter sends CC 74 value 89 on MIDI channel 1
- **Native → canonical**: the human turns a hardware knob → the adapter reports that `brightness` changed to 0.65

This boundary is what makes the protocol instrument-agnostic. The AI doesn't need to know whether it's programming a WASM DSP module, a Eurorack rack, or an Ableton track. It sees voices with parameters. The adapter handles the rest.

### What adapters exist for

- **Native modules** (Plaits, Rings, Clouds compiled to WASM): thin mapping, mostly renaming params
- **Hardware synths** (Elektron, Eurorack): MIDI/OSC/CV bridge with device profiles
- **DAW integration** (Ableton, Bitwig): host adapter for track/clip/device control
- **External instruments** (anything with MIDI): generic MIDI profile with CC mappings

A hardware voice and a native voice look the same to the AI. That's the point.

### Undo across the adapter boundary

Undo for native modules is exact — restore previous parameter values. Undo for hardware is best-effort — re-send previous CC values, but analogue circuits don't always return to the same sound from the same numbers. That's fine. It's hardware.

---

## What This Does Not Define

**Visual design.** How the parameter space is visualised, where controls live, animation curves. That's design work.

**AI behaviour.** How the AI decides what changes to make, what "darker" means in parameter terms. That's the intelligence layer. This protocol defines what the AI can do, not how it thinks.

**Taste and memory.** Whether the AI remembers preferences across sessions.

**Module implementation.** How a specific module works internally. The protocol cares that modules have parameters and roles, not how they generate or process sound.

**Transport and networking.** How messages are serialised. Could be in-process calls, WebSocket, OSC, whatever.

**Surface curation details.** Semantic control aggregation, pinning, chain-aware surfaces. See the AI-curated surfaces RFC.

---

## The Whole Thing on One Page

A Gluon session has **voices** (things that make sound). Each voice is a **chain** of **modules** (sources, processors, and modulators) with **agency** (OFF / ON), **regions** (canonical sequencing content), **modulation routings** (LFO/envelope connections to parameters), and optional **views** (UI projections over that content). **Adapters** bridge between the canonical model and native instruments — hardware, software, or anything with parameters.

The human **plays** (direct manipulation), **asks** (natural language), and **undoes**.

The AI's tools fall into five categories:

| Category | Tools | Agency? | Changes sound? |
|----------|-------|---------|----------------|
| **Program** | move, sketch, transform | Yes | Yes |
| **Structure** | set_model, add/remove/replace_processor, add/remove_modulator, connect/disconnect_modulator | Yes | Yes |
| **Transport** | set_transport | No | Yes |
| **Observation** | listen | No | No |
| **UI curation** | add_view, remove_view | No | No |

Plus **say** — talk back to the human.

Every AI action is applied immediately and is undoable. The AI only acts when asked, and only modifies voices with agency ON (except observation and UI curation). When human and AI collide on the same parameter, the human wins. Always. Instantly.

That's Gluon: the Claude Code of music, built around an AI-legible musical core that you can glue any instrument onto.
