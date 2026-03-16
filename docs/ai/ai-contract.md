# AI Contract

What the AI agent needs at inference time to interact with Gluon's canonical musical model.

**Architecture:** The AI uses Gemini native function calling. The model receives compressed session state with each turn, reasons about the request, and invokes tools to make changes. Tool calls are validated against live session state before the model sees a success response. Actions are collected and dispatched after the tool loop completes.

---

## Tools

The AI has fifteen tools, declared as Gemini function declarations.

### Programming

Change what the instrument sounds like — parameters, patterns, and transformations. **Requires voice agency ON.**

#### `move`

Change a control parameter value on a voice source, processor, or modulator.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `param` | string | yes | Control ID. Voice: `brightness`, `richness`, `texture`, `pitch`. Processor (Rings): `structure`, `brightness`, `damping`, `position`. Processor (Clouds): `position`, `size`, `density`, `feedback`. Modulator (Tides): `frequency`, `shape`, `slope`, `smoothness`. |
| `target` | object | yes | `{ absolute: number }` (0.0–1.0) or `{ relative: number }` (-1.0 to 1.0) |
| `trackId` | string | no | Target voice (`v0`–`v15`). Defaults to active voice. |
| `processorId` | string | no | Processor ID to target. When provided, moves a control on the processor instead of the voice source. |
| `modulatorId` | string | no | Modulator ID to target. When provided, moves a control on the modulator (e.g. LFO rate). |
| `over` | number | no | Smooth transition duration in milliseconds |

#### `sketch`

Apply a rhythmic or melodic pattern to a voice using musical events.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target voice ID |
| `description` | string | yes | Short human-readable summary |
| `events` | array | yes | Sparse list of musical events (see below) |

**Event kinds:**
- `trigger` — percussion hit. Fields: `at` (step index, 0-based), `velocity` (0.0–1.0), `accent` (boolean)
- `note` — melodic note. Fields: `at`, `pitch` (MIDI 0–127), `velocity`, `duration` (always 0.25)
- `parameter` — per-step param lock. Fields: `at`, `controlId` (semantic name), `value` (0.0–1.0)

Fractional `at` values are supported for microtiming (e.g., `4.3` places an event slightly after step 4).

#### `transform`

Transform an existing pattern structurally rather than rewriting it.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target voice ID |
| `operation` | string | yes | `rotate`, `transpose`, `reverse`, or `duplicate` |
| `steps` | integer | no | For `rotate`: number of steps to shift (positive=forward, negative=backward). Required for rotate, rejected for other operations. |
| `semitones` | integer | no | For `transpose`: semitones to shift (positive=up, negative=down). Required for transpose, rejected for other operations. |
| `description` | string | yes | Short description of the transform intent |

### Observation

#### `listen`

Render audio offline and evaluate how it sounds. Works whether or not the transport is playing.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `question` | string | yes | What to evaluate (e.g. "how does the kick sound?") |
| `trackIds` | string[] | no | Voice IDs to render in isolation (e.g. `["v0", "v1"]`). Default: all unmuted voices. |
| `bars` | integer | no | Number of bars to render (1-16). Default: 2. |

Renders audio offline from the current project state (no transport dependency), converts to WAV, and sends it with a critique prompt to the model. Returns a text critique. Voice isolation is built into the render — only the requested voices are included. Changes made in the same turn aren't audible yet — listen in a follow-up turn to hear edits.

### Transport

#### `set_transport`

Change tempo, swing, or play/stop state. At least one parameter must be provided. **No agency gate** — transport is global.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `bpm` | number | no | Tempo (60–200) |
| `swing` | number | no | Swing amount (0.0–1.0, 0 = straight) |
| `playing` | boolean | no | true to start, false to stop |

### Structure

Change what the instrument is — its modules, signal chain, and configuration. **Requires voice agency ON.**

#### `set_model`

Switch the mode of a module. Without `processorId`/`modulatorId`, changes the voice synthesis engine. With `processorId`, changes the processor's mode. With `modulatorId`, changes the modulator's mode.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target voice ID |
| `model` | string | yes | Model/mode ID. Voice: `virtual-analog`, `waveshaping`, `fm`, `grain-formant`, `harmonic`, `wavetable`, `chords`, `vowel-speech`, `swarm`, `filtered-noise`, `particle-dust`, `inharmonic-string`, `modal-resonator`, `analog-bass-drum`, `analog-snare`, `analog-hi-hat`. Rings: `modal`, `sympathetic-string`, `string`, `fm-voice`, `sympathetic-quantized`, `string-and-reverb`. Clouds: `granular`, `pitch-shifter`, `looping-delay`, `spectral`. Tides: `ad`, `looping`, `ar`. |
| `processorId` | string | no | Processor ID to target. When provided, switches the processor's mode instead of the voice's synthesis engine. |
| `modulatorId` | string | no | Modulator ID to target. When provided, switches the modulator's mode (e.g. AD, Looping, AR for Tides). |

#### `add_processor`

Add a processor module to a voice's signal chain. Max 2 processors per voice.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target voice ID |
| `moduleType` | string | yes | Processor type. Available: `rings` (Mutable Instruments Rings resonator — 6 models, 4 controls), `clouds` (Mutable Instruments Clouds granular processor — 4 models, 4 controls). |
| `description` | string | yes | Short description |

Returns `{ processorId }` so the AI can reference the new processor in later same-turn calls (e.g., to set its parameters or model).

#### `remove_processor`

Remove a processor module from a voice's signal chain.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target voice ID |
| `processorId` | string | yes | The processor ID to remove (visible in project state) |
| `description` | string | yes | Short description |

#### `replace_processor`

Atomically swap one processor for another type in a voice's signal chain. Keeps the same chain position.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target voice ID |
| `processorId` | string | yes | The processor ID to replace |
| `newModuleType` | string | yes | New processor type (`rings` or `clouds`) |
| `description` | string | yes | Short description |

Returns `{ newProcessorId }` for same-turn configuration.

#### `add_modulator`

Add a modulator module (LFO/envelope) to a voice. Max 2 modulators per voice. Use `connect_modulator` to wire it up after adding.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target voice ID |
| `moduleType` | string | yes | Modulator type. Available: `tides` (Mutable Instruments Tides — function generator with LFO/envelope modes). |
| `description` | string | yes | Short description |

Returns `{ modulatorId }` for same-turn configuration.

#### `remove_modulator`

Remove a modulator module from a voice. Also disconnects all routings from this modulator.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target voice ID |
| `modulatorId` | string | yes | The modulator ID to remove |
| `description` | string | yes | Short description |

#### `connect_modulator`

Route a modulator's output to a target parameter. Idempotent: calling again with the same modulator + target updates the depth instead of creating a duplicate.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target voice ID |
| `modulatorId` | string | yes | The modulator ID to route from |
| `targetKind` | string | yes | `"source"` for the voice's Plaits source, or `"processor"` for a processor module |
| `processorId` | string | no | Required when `targetKind` is `"processor"`. The processor ID to target. |
| `targetParam` | string | yes | The parameter to modulate. Source: `brightness`, `richness`, `texture` (pitch excluded). Processor: depends on type. |
| `depth` | number | yes | Modulation depth (-1.0 to 1.0). Negative depth inverts the modulation. |
| `description` | string | yes | Short description |

Returns `{ modulationId }` for same-turn disconnect if needed. When updating an existing route, returns `{ modulationId, created: false, previousDepth }`.

**Modulation semantics:** Human sets center (knob position), modulation adds/subtracts around it. Multiple routings to the same parameter sum additively. Effective value is clamped to 0–1.

#### `disconnect_modulator`

Remove a modulation routing by its ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target voice ID |
| `modulationId` | string | yes | The modulation routing ID to disconnect (visible in project state) |
| `description` | string | yes | Short description |

### UI Curation

Changes to what the human sees, not what the instrument plays. **No agency gate** — the AI should be able to help the human inspect any voice regardless of agency.

#### `add_view`

Add a sequencer view to a voice.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target voice ID |
| `viewKind` | string | yes | View type: `step-grid` |
| `description` | string | yes | Short description |

#### `remove_view`

Remove a sequencer view from a voice.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target voice ID |
| `viewId` | string | yes | The view ID to remove |
| `description` | string | yes | Short description |

---

## Tool Loop

The AI runs in a multi-round tool loop (up to 5 rounds per turn):

1. Model receives compressed state + human message
2. Model responds with text and/or function calls
3. Each function call is **pre-validated** against live session state
4. Tool responses report success or rejection with a reason
5. Model sees the tool responses and may make additional calls
6. Loop ends when the model responds with no function calls, or after 5 rounds

All accepted actions are collected and dispatched together after the loop completes.

---

## Serialised State Format

Each turn, the AI receives compressed session state as JSON:

```json
{
  "voices": [
    {
      "id": "v0",
      "model": "analog_bass_drum",
      "params": { "brightness": 0.65, "richness": 0.30, "texture": 0.20, "pitch": 0.40 },
      "agency": "ON",
      "muted": false,
      "solo": false,
      "pattern": {
        "length": 16,
        "event_count": 4,
        "triggers": [0, 4, 8, 12],
        "notes": [],
        "accents": [0, 8],
        "param_locks": [],
        "density": 0.25
      },
      "views": ["step-grid:step-grid-v0"],
      "processors": [
        {
          "id": "rings-1710342000000",
          "type": "rings",
          "model": "modal",
          "params": { "structure": 0.50, "brightness": 0.50, "damping": 0.70, "position": 0.50 }
        }
      ],
      "modulators": [
        {
          "id": "tides-1710342000000",
          "type": "tides",
          "model": "looping",
          "params": { "frequency": 0.30, "shape": 0.50, "slope": 0.50, "smoothness": 0.50 }
        }
      ],
      "modulations": [
        {
          "id": "mod-1710342000000",
          "modulatorId": "tides-1710342000000",
          "target": "source:brightness",
          "depth": 0.3
        }
      ]
    }
  ],
  "activeTrackId": "v0",
  "transport": { "bpm": 120, "swing": 0.00, "playing": true },
  "context": { "energy": 0.50, "density": 0.30 },
  "undo_depth": 2,
  "redo_depth": 1,
  "recent_human_actions": [
    { "trackId": "v0", "param": "brightness", "from": 0.80, "to": 0.65, "age_ms": 3200 }
  ]
}
```

Fields:
- **voices[]** — each voice's current state (1–16 tracks, variable), parameters (semantic names), agency, pattern, views, processor chain, modulators, and modulation routings
- **activeTrackId** — the voice the human currently has selected
- **pattern** — canonical event summary with trigger positions, notes, accents, param locks, and density
- **views** — list of active sequencer views (`kind:id` format)
- **processors** — processor chain with IDs, types, models, and current parameter values
- **modulators** — modulator modules with IDs, types, current mode names, and parameter values
- **modulations** — modulation routings with IDs, source modulator, target (e.g. `"source:brightness"` or `"processor:rings-xxx:position"`), and depth
- **transport** — tempo, swing, and playing state
- **context** — global energy and density (0.0–1.0)
- **undo_depth** — how many action groups can be undone
- **redo_depth** — how many action groups can be redone (Cmd+Shift+Z)
- **recent_human_actions** — last 5 parameter changes with voice, semantic param name, values, and age

---

## Semantic Controls

### Voice source (Plaits)

Four controls, all 0.0–1.0:

| Control        | Meaning                                 | Maps to Plaits |
|---------------|----------------------------------------|----------------|
| **brightness** | Spectral content. Dark to bright.      | `timbre`       |
| **richness**   | Harmonic complexity. Simple to dense.  | `harmonics`    |
| **texture**    | Surface character. Smooth to textured. | `morph`        |
| **pitch**      | Fundamental pitch. Low to high.        | `note`         |

### Processor (Rings)

Four controls, all 0.0–1.0:

| Control        | Meaning                                 |
|---------------|----------------------------------------|
| **structure**  | Geometric structure of the resonator.  |
| **brightness** | Spectral content of the resonance.     |
| **damping**    | Decay time. Low = long ring, high = short. |
| **position**   | Excitation position on the resonator.  |

### Processor (Clouds)

Four controls, all 0.0–1.0:

| Control      | Meaning                                               |
|-------------|-------------------------------------------------------|
| **position** | Where in the recording buffer to read.                |
| **size**     | Grain size or texture scale. Small = glitchy, large = smooth. |
| **density**  | Grain generation rate. Low = sparse, high = dense.    |
| **feedback** | Wet signal recirculation. High = evolving textures.   |

### Modulator (Tides)

Four controls, all 0.0–1.0:

| Control         | Meaning                                                    |
|----------------|-----------------------------------------------------------|
| **frequency**   | Rate of the modulation cycle. Low = slow sweeps, high = fast oscillation. |
| **shape**       | Waveform character. Blends between sine, triangle, saw, square-like. |
| **slope**       | Attack/decay symmetry. Low = fast attack, high = slow attack. |
| **smoothness**  | Waveform smoothing. Low = sharp edges, high = rounded curves. |

The compressed state and tool parameters use semantic names. The runtime handles the mapping to engine parameters internally.

For note events in sketches, pitch is specified as MIDI (0–127), not normalised.

---

## Validation Invariants

Hard rules. The runtime enforces these; violating them means the action is rejected with an error in the tool response.

1. All param values are **0.0–1.0**.
2. `trackId` must reference an existing voice (`v0`–`v15`, up to 16 tracks).
3. Agency must be **ON** for the target voice (programming, structure, and modulation tools). UI curation tools (`add_view`, `remove_view`) do not require agency.
4. `at` in events is a **0-based step index** (fractional values allowed for microtiming).
5. MIDI pitch in note events is **0–127**.
6. `duration` in note events is always **0.25**.
7. `controlId` in parameter events must be a known semantic control.
8. `listen` works regardless of transport state (offline render).
9. `set_transport` requires at least one of `bpm`, `swing`, or `playing`.
10. `processorId` in `move`, `set_model`, `remove_processor`, and `replace_processor` must reference an existing processor on the target voice.
11. `moduleType` in `add_processor` must be a registered processor type (`rings`, `clouds`).
12. `modulatorId` in `move`, `set_model`, and `remove_modulator` must reference an existing modulator on the target voice.
13. `moduleType` in `add_modulator` must be a registered modulator type (`tides`).
14. Max **2 processors** and **2 modulators** per voice.
15. Modulation depth must be **-1.0 to 1.0**.
16. Modulation targets must be valid controls on the target module. Source targets: `brightness`, `richness`, `texture` (pitch is excluded). Processor targets: all controls for that processor type.
17. One route per `(modulatorId, target)` pair — `connect_modulator` is idempotent.
18. Invalid tool calls get error responses; valid calls in the same round are unaffected.

---

## Undo

- All actions (human and AI) push undo snapshots in LIFO order
- AI actions are grouped per turn into a single undo entry; human edits push individual snapshots
- Transport, model, view, processor, and modulator changes are included in the undo group
- The human can undo with Cmd+Z; one press reverts the most recent action or action group
- The human can redo with Cmd+Shift+Z; one press re-applies the most recently undone action
- New actions clear the redo stack
- `undo_depth` in the state tells the model how many groups can be undone
- `redo_depth` in the state tells the model how many groups can be redone

---

## Worked Examples

### Example 1: "Make the kick darker"

The model calls:
```
move({ param: "brightness", trackId: "v0", target: { absolute: 0.25 } })
```

Tool response: `{ queued: true, param: "brightness", trackId: "v0", target: { absolute: 0.25 } }`

Model follows up with text: "Pulled the kick's brightness way down — should sit deeper now."

### Example 2: "Write a four-on-the-floor kick pattern"

The model calls:
```
sketch({
  trackId: "v0",
  description: "Four-on-the-floor kick",
  events: [
    { kind: "trigger", at: 0, velocity: 1.0, accent: true },
    { kind: "trigger", at: 4, velocity: 0.85 },
    { kind: "trigger", at: 8, velocity: 0.9, accent: true },
    { kind: "trigger", at: 12, velocity: 0.85 }
  ]
})
```

### Example 3: "Add some resonance to the lead"

The model calls:
```
add_processor({ trackId: "v1", moduleType: "rings", description: "Add Rings for metallic resonance" })
```

Tool response: `{ queued: true, processorId: "rings-1710342000000" }`

The model can then configure the processor in the same turn:
```
move({ trackId: "v1", processorId: "rings-1710342000000", param: "brightness", target: { absolute: 0.7 } })
set_model({ trackId: "v1", processorId: "rings-1710342000000", model: "sympathetic-string" })
```

### Example 4: "Tell me how it sounds"

The model calls one tool:
```
listen({ question: "How does the overall mix sound?" })
```

The `listen` tool renders 2 bars offline and returns a text critique that the model incorporates into its response. No transport state change is needed — listen works whether or not the transport is playing.

### Example 5: "Shift the hi-hat pattern forward by 2 steps"

```
transform({ trackId: "v3", operation: "rotate", steps: 2, description: "Shift hats forward for syncopation" })
```

### Example 6: "Add slow movement to the pad"

The model chains three tools in one turn:
```
add_modulator({ trackId: "v1", moduleType: "tides", description: "Add Tides LFO for slow brightness sweep" })
```

Tool response: `{ queued: true, modulatorId: "tides-1710342000000" }`

```
connect_modulator({ trackId: "v1", modulatorId: "tides-1710342000000", targetKind: "source", targetParam: "brightness", depth: 0.25, description: "Route LFO to brightness for gentle sweep" })
move({ trackId: "v1", modulatorId: "tides-1710342000000", param: "frequency", target: { absolute: 0.15 } })
```

### Example 7: "Swap Rings for Clouds on the lead"

```
replace_processor({ trackId: "v1", processorId: "rings-1710342000000", newModuleType: "clouds", description: "Replace Rings with Clouds for granular texture" })
```

Tool response: `{ queued: true, newProcessorId: "clouds-1710342100000" }`

The model can then configure Clouds in the same turn:
```
set_model({ trackId: "v1", processorId: "clouds-1710342100000", model: "spectral" })
move({ trackId: "v1", processorId: "clouds-1710342100000", param: "size", target: { absolute: 0.7 } })
```

---

## Positive Instructions

- Be musical, not mechanical. Patterns should groove, not just fill slots.
- Prefer small changes over wholesale rewrites. Nudge a parameter rather than replacing an entire pattern.
- When sketching patterns, think in terms of groove and dynamics — vary velocity, use accents for emphasis.
- Combine tool calls in one turn when it makes sense: sketch + move, add_processor + set_model + move, add_modulator + connect_modulator + move.
- Keep text responses short — one or two sentences. The human is listening, not reading an essay.
- When unsure, ask. A short clarifying question is better than a wrong guess.
- After adding a processor or modulator, configure it in the same turn.
- After sketching a percussion pattern, consider adding a step-grid view so the human can see it.
- For modulation, prefer shallow depth (0.1–0.3) before aggressive values. Common useful routings: Tides → brightness for filter sweeps, Tides → texture for evolving character, Tides → Clouds position for granular scrubbing.
