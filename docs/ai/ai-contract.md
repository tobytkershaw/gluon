# AI Contract

What the AI agent needs at inference time to interact with Gluon's canonical musical model.

**Architecture:** The AI uses multi-provider function calling (OpenAI, Gemini, Anthropic). The model receives compressed session state with each turn, reasons about the request, and invokes tools to make changes. Tool calls are validated against live session state before the model sees a success response. Actions are collected and dispatched after the tool loop completes.

---

## Tools

The AI has twenty-six tools, declared as neutral JSON Schema and adapted per provider.

### Programming

Change what the instrument sounds like — parameters, patterns, and transformations. **Requires track agency ON.**

#### `move`

Change a control parameter value on a track source, processor, or modulator.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `param` | string | yes | Control ID. Track source (Plaits): `frequency`, `harmonics`, `timbre`, `morph`, `timbre-mod-amount`, `fm-amount`, `morph-mod-amount`, `decay`, `lpg-colour`. Processor (Rings): `structure`, `brightness`, `damping`, `position`, `fine-tune`, `internal-exciter`, `polyphony`. Processor (Clouds): `position`, `size`, `pitch`, `density`, `texture`, `dry-wet`, `feedback`, `stereo-spread`, `reverb`, `freeze`. Modulator (Tides): `frequency`, `shape`, `slope`, `smoothness`, `shift`, `output-mode`, `range`. |
| `target` | object | yes | `{ absolute: number }` (0.0–1.0) or `{ relative: number }` (-1.0 to 1.0) |
| `trackId` | string | no | Target track — ordinal ("Track 1") or internal ID ("v0"). Defaults to active track. |
| `processorId` | string | no | Processor ID to target. When provided, moves a control on the processor instead of the track source. |
| `modulatorId` | string | no | Modulator ID to target. When provided, moves a control on the modulator (e.g. LFO rate). |
| `over` | number | no | Smooth transition duration in milliseconds |

#### `sketch`

Apply a rhythmic or melodic pattern to a track using musical events.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target track ID |
| `description` | string | yes | Short human-readable summary |
| `events` | array | yes | Sparse list of musical events (see below) |

**Event kinds:**
- `trigger` — percussion hit. Fields: `at` (step index, 0-based), `velocity` (0.0–1.0), `accent` (boolean)
- `note` — melodic note. Fields: `at`, `pitch` (MIDI 0–127), `velocity`, `duration` (always 0.25)
- `parameter` — per-step param lock. Fields: `at`, `controlId` (control name), `value` (0.0–1.0)

Fractional `at` values are supported for microtiming (e.g., `4.3` places an event slightly after step 4).

#### `edit_pattern`

Non-destructively add, remove, or modify individual events in a pattern without replacing the whole thing. Use for surgical edits (adding a ghost hit, tweaking one velocity, adding a param lock to one step). For writing a whole new pattern, use `sketch` instead.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target track ID |
| `patternId` | string | no | Pattern ID to edit. Defaults to active pattern if omitted. |
| `operations` | array | yes | Batch of add/remove/modify operations (see below). All applied as one undo group. |
| `description` | string | yes | Short description of the edit (e.g. "add ghost hit on step 7") |

**Operation fields:**
- `action` — `add`, `remove`, or `modify`
- `step` — step index (0-based)
- `event` — (optional) gate event: `{ type: "trigger"|"note", pitch?, velocity?, accent?, duration? }`
- `params` — (optional) parameter locks: `[{ controlId, value }]`

**Semantics:**
- `add`: inserts event at step. Triggers overwrite existing triggers; notes stack up to 4.
- `remove`: removes event at step by type, or all gate events if no type specified.
- `modify`: changes properties on existing events in place (velocity, accent, pitch, duration).
- Parameter locks are added/modified on `add`/`modify`, removed on `remove`.

#### `transform`

Transform an existing pattern structurally rather than rewriting it.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target track ID |
| `operation` | string | yes | `rotate`, `transpose`, `reverse`, or `duplicate` |
| `steps` | integer | no | For `rotate`: number of steps to shift (positive=forward, negative=backward). Required for rotate, rejected for other operations. |
| `semitones` | integer | no | For `transpose`: semitones to shift (positive=up, negative=down). Required for transpose, rejected for other operations. |
| `description` | string | yes | Short description of the transform intent |

### Observation

#### `listen`

Render audio offline and evaluate how it sounds. Works whether or not the transport is playing. Supports focused evaluation via `lens`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `question` | string | yes | What to evaluate (e.g. "how does the kick sound?") |
| `trackIds` | string[] | no | Track IDs to render in isolation (e.g. `["Track 1", "Track 2"]` or `["v0", "v1"]`). Default: all unmuted tracks. |
| `bars` | integer | no | Number of bars to render (1-16). Default: 2. |
| `lens` | string | no | Focus the evaluation on a specific aspect. One of: `full-mix`, `low-end`, `rhythm`, `harmony`, `texture`, `dynamics`. |
| `compare` | object | no | Request comparative evaluation. Contains `beforeSessionIndex` and `question`. **Note:** true before/after rendering is not yet implemented — the runtime currently renders only the current state and uses the compare prompt to frame evaluation as comparative. |

Renders audio offline from the current project state (no transport dependency), converts to WAV, and sends it with a critique prompt to the model. Returns a text critique. Track isolation is built into the render — only the requested tracks are included. Changes made in the same turn aren't audible yet — listen in a follow-up turn to hear edits.

#### `render`

Capture an audio snapshot with explicit scope. Returns a `snapshotId` that can be passed to `analyze` or `listen`. Cheap — use freely before analysis tools. Changes made in this turn aren't audible yet — render in a follow-up turn to capture edits.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `scope` | string or string[] | no | Track reference ("Track 1" or "v0"), array of references, or omit for full mix. |
| `bars` | integer | no | Duration to render in bars (1-16, default 2). |

#### `analyze`

Run deterministic audio analysis on a rendered snapshot. Supports spectral, dynamics, and rhythm analysis in a single call. Use `render` first to capture a snapshot, then `analyze` for quantitative measurement.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `snapshotId` | string | yes | Snapshot ID from a previous `render` call. |
| `types` | string[] | yes | Analysis types: `spectral` (centroid, rolloff, flatness, bandwidth, pitch), `dynamics` (LUFS, RMS, peak, crest factor), `rhythm` (tempo estimate, onsets, density, swing). |

### Transport

#### `set_transport`

Change tempo, swing, time signature, or play/stop state. At least one parameter must be provided. **No agency gate** — transport is global.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `bpm` | number | no | Tempo (20-300) |
| `swing` | number | no | Swing amount (0.0–1.0, 0 = straight) |
| `playing` | boolean | no | true to start, false to stop |
| `timeSignatureNumerator` | number | no | Beats per bar (1-16). E.g. 3 for 3/4 time. |
| `timeSignatureDenominator` | number | no | Beat unit (2, 4, 8, or 16). E.g. 4 for quarter-note beats. |

### Structure

Change what the instrument is — its modules, signal chain, and configuration. **Requires track agency ON** (except `manage_track` add, which creates a new track).

#### `manage_track`

Add or remove a track. Audio tracks produce sound; bus tracks receive audio via sends. Adding does not require agency. Removing requires agency ON and the track must not have anchor approval.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | yes | `add` or `remove` |
| `kind` | string | no | Required for add. `audio` or `bus`. |
| `trackId` | string | no | Required for remove. The track ID to remove. |
| `label` | string | no | Optional display name for the new track. |
| `description` | string | yes | Short description of the operation. |

#### `set_model`

Switch the mode of a module. Without `processorId`/`modulatorId`, changes the track synthesis engine. With `processorId`, changes the processor's mode. With `modulatorId`, changes the modulator's mode.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target track ID |
| `model` | string | yes | Model/mode ID. Track: `virtual-analog`, `waveshaping`, `fm`, `grain-formant`, `harmonic`, `wavetable`, `chords`, `vowel-speech`, `swarm`, `filtered-noise`, `particle-dust`, `inharmonic-string`, `modal-resonator`, `analog-bass-drum`, `analog-snare`, `analog-hi-hat`. Rings: `modal`, `sympathetic-string`, `string`, `fm-voice`, `sympathetic-quantized`, `string-and-reverb`. Clouds: `granular`, `pitch-shifter`, `looping-delay`, `spectral`. Tides: `ad`, `looping`, `ar`. |
| `processorId` | string | no | Processor ID to target. When provided, switches the processor's mode instead of the track's synthesis engine. |
| `modulatorId` | string | no | Modulator ID to target. When provided, switches the modulator's mode (e.g. AD, Looping, AR for Tides). |

#### `manage_processor`

Add, remove, replace, or bypass a processor module in a track's signal chain. Max 2 processors per track.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | yes | `add`, `remove`, `replace`, or `bypass`. |
| `trackId` | string | yes | Target track — ordinal ("Track 1") or internal ID ("v0"). |
| `moduleType` | string | no | Required for `add` and `replace`. Available: `rings` (Mutable Instruments Rings resonator), `clouds` (Mutable Instruments Clouds granular processor). |
| `processorId` | string | no | Required for `remove`, `replace`, and `bypass`. The processor ID to target (visible in project state). |
| `enabled` | boolean | no | For `bypass`: false to bypass (audio skips it), true to re-enable. For `add`: add in bypassed state. |
| `description` | string | yes | Short description (e.g. "add Rings resonator for metallic texture"). |

#### `manage_modulator`

Add or remove a modulator module (LFO/envelope) on a track. Max 2 modulators per track. Use `modulation_route` to wire it up after adding.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | yes | `add` or `remove`. |
| `trackId` | string | yes | Target track — ordinal ("Track 1") or internal ID ("v0"). |
| `moduleType` | string | no | Required for `add`. Available: `tides` (Mutable Instruments Tides — function generator with LFO/envelope modes). |
| `modulatorId` | string | no | Required for `remove`. The modulator ID to remove (visible in project state). |
| `description` | string | yes | Short description (e.g. "add Tides LFO for slow timbre sweep"). |

#### `modulation_route`

Connect or disconnect a modulation routing. Connect routes a modulator's output to a target parameter (idempotent: same modulator + target updates depth). Disconnect removes a routing by ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | yes | `connect` or `disconnect`. |
| `trackId` | string | yes | Target track — ordinal ("Track 1") or internal ID ("v0"). |
| `modulatorId` | string | no | Required for `connect`. The modulator ID to route from. |
| `modulationId` | string | no | Required for `disconnect`. The modulation routing ID to remove (visible in project state). |
| `targetKind` | string | no | Required for `connect`. `"source"` for the track's Plaits source, or `"processor"` for a processor module. |
| `processorId` | string | no | Required for `connect` when `targetKind` is `"processor"`. The processor ID to target. |
| `targetParam` | string | no | Required for `connect`. The parameter to modulate. Source: `timbre`, `harmonics`, `morph`, `frequency`. Processor: depends on type. |
| `depth` | number | no | Required for `connect`. Modulation depth (-1.0 to 1.0). Prefer shallow values (0.1-0.3). Negative inverts. |
| `description` | string | yes | Short description (e.g. "route Tides to timbre for slow sweep"). |

**Modulation semantics:** Human sets center (knob position), modulation adds/subtracts around it. Multiple routings to the same parameter sum additively. Effective value is clamped to 0–1.

### Mixing

#### `manage_send`

Add, remove, or set the level of a post-fader send from a track to a bus track.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | yes | `add`, `remove`, or `set_level`. |
| `trackId` | string | yes | Source track — ordinal ("Track 1") or internal ID ("v0"). |
| `busId` | string | yes | Target bus track ID (e.g. "bus-v3" or "master-bus"). |
| `level` | number | no | Send level (0.0-1.0). Required for `add` and `set_level`. |

#### `set_master`

Set master channel volume and/or pan.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `volume` | number | no | Master volume (0.0-1.0, linear gain). |
| `pan` | number | no | Master pan (-1.0 left to 1.0 right). |

At least one of `volume` or `pan` must be provided.

### Arrangement

#### `manage_pattern`

Add, remove, duplicate, rename, set active, set length, or clear a pattern on a track. **Requires track agency ON.**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | yes | `add`, `remove`, `duplicate`, `rename`, `set_active`, `set_length`, or `clear`. |
| `trackId` | string | yes | Target track — ordinal ("Track 1") or internal ID ("v0"). |
| `patternId` | string | no | Required for `remove`, `duplicate`, `rename`, `set_active`. The pattern ID to target. |
| `name` | string | no | Required for `rename`. New pattern name. |
| `length` | integer | no | Required for `set_length`. Pattern length in steps (1-64). |
| `description` | string | yes | Short description of the operation. |

#### `manage_sequence`

Manage the arrangement sequence on a track: append a pattern reference, remove a reference by index, or reorder references. **Requires track agency ON.**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | yes | `append`, `remove`, or `reorder`. |
| `trackId` | string | yes | Target track — ordinal ("Track 1") or internal ID ("v0"). |
| `patternId` | string | no | Required for `append`. The pattern ID to add to the sequence. |
| `sequenceIndex` | integer | no | Required for `remove` and `reorder` (as fromIndex). Index into the sequence array. |
| `toIndex` | integer | no | Required for `reorder`. Destination index. |
| `description` | string | yes | Short description of the operation. |

### UI Curation

Changes to what the human sees, not what the instrument plays. **No agency gate** — the AI should be able to help the human inspect any track regardless of agency.

#### `manage_view`

Add or remove a sequencer view on a track.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | yes | `add` or `remove`. |
| `trackId` | string | yes | Target track — ordinal ("Track 1") or internal ID ("v0"). |
| `viewKind` | string | no | Required for `add`. View type: `step-grid`. |
| `viewId` | string | no | Required for `remove`. The view ID to remove. |
| `description` | string | yes | Short description (e.g. "show kick pattern in step grid"). |

#### `set_surface`

Define semantic controls for a track's UI surface. Semantic controls are virtual knobs that blend multiple underlying parameters. Does not require agency.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target track — ordinal ("Track 1") or internal ID ("v0"). |
| `semanticControls` | array | yes | Array of semantic control definitions. Each has `name` (label), `weights` (array of `{ moduleId, controlId, weight, transform? }`), and optional `range`. Weights must sum to 1.0. |
| `xyAxes` | object | no | Optional XY pad axis labels: `{ x, y }`. |
| `description` | string | yes | Short description of the surface configuration. |

#### `pin_control`

Pin or unpin a raw module control on the track's surface. Max 4 pins per track. Does not require agency.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | yes | `pin` or `unpin`. |
| `trackId` | string | yes | Target track ID (e.g. "v0"). |
| `moduleId` | string | yes | `"source"` for track params, or a processor ID. |
| `controlId` | string | yes | The control to pin or unpin (e.g. "timbre", "structure"). |

#### `label_axes`

Set semantic labels for the track's XY pad axes. Does not require agency.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target track ID (e.g. "v0"). |
| `x` | string | yes | X-axis semantic label (e.g. "Brightness"). |
| `y` | string | yes | Y-axis semantic label (e.g. "Texture"). |

### Track Metadata

#### `set_track_meta`

Set track metadata: muted, solo, approval level, importance, and/or musical role in a single call. At least one field required. Approval requires agency ON and a reason.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target track — ordinal ("Track 1") or internal ID ("v0"). |
| `muted` | boolean | no | Set the track muted state. true = muted (silent), false = unmuted. |
| `solo` | boolean | no | Set the track solo state. true = solo (only this track audible), false = unsolo. |
| `approval` | string | no | Approval level: `exploratory`, `liked`, `approved`, `anchor`. |
| `importance` | number | no | How important this track is to the mix (0.0-1.0). |
| `musicalRole` | string | no | Brief description of the track's musical role (e.g. "driving rhythm"). |
| `reason` | string | no | Required when setting approval. Why this approval level is appropriate. |

### Decision

#### `raise_decision`

Flag an unresolved question or choice that needs human input. Use when you encounter a subjective choice you should not make alone.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `question` | string | yes | The question or decision that needs human input. |
| `context` | string | no | Why this decision matters for the current session. |
| `options` | string[] | no | Possible options the AI sees, if any. |
| `trackIds` | string[] | no | Which track(s) this decision relates to, if any. |

#### `report_bug`

Report a bug or issue encountered during operation. Use sparingly, only for things that seem genuinely broken (silent tool failures, unexpected audio, state inconsistencies).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `summary` | string | yes | One-line description of the issue. |
| `category` | string | yes | Issue category: `audio`, `state`, `tool`, `ui`, `other`. |
| `details` | string | yes | What happened and what was expected. |
| `severity` | string | yes | `low` (cosmetic), `medium` (functional with workaround), `high` (blocks workflow). |
| `context` | string | no | Relevant state at the time (e.g. track config, parameter values, tool args). |

Duplicate detection: reports with identical summaries within the same session are rejected.

#### `explain_chain`

Generate a musical-language description of a track's signal chain. Read-only — does not modify state.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target track — ordinal (e.g. "Track 1") or internal ID (e.g. "v0"). |

Returns a text description of the track's source engine, processors (type, mode, params, bypass state), modulators, and modulation routings.

#### `simplify_chain`

Analyze a track's signal chain for redundant or no-op processors and suggest removals. Read-only — does not modify state.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target track — ordinal (e.g. "Track 1") or internal ID (e.g. "v0"). |

Checks for: bypassed processors, default-valued processors (no knobs moved), duplicate processor types, unrouted modulators. Returns suggestions without modifying session state.

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
  "tracks": [
    {
      "id": "v0",
      "label": "Track 1 (Kick)",
      "model": "analog_bass_drum",
      "params": { "timbre": 0.65, "harmonics": 0.30, "morph": 0.20, "frequency": 0.40 },
      "agency": "ON",
      "approval": "exploratory",
      "muted": false,
      "solo": false,
      "volume": 0.80,
      "pan": 0.50,
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
          "params": { "structure": 0.50, "brightness": 0.50, "damping": 0.70, "position": 0.50 },
          "enabled": true
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
          "target": "source:timbre",
          "depth": 0.3
        }
      ],
      "importance": 0.8,
      "musicalRole": "driving rhythm"
    }
  ],
  "activeTrackId": "v0",
  "transport": { "bpm": 120, "swing": 0.00, "playing": true, "time_signature": "4/4" },
  "context": { "energy": 0.50, "density": 0.30 },
  "undo_depth": 2,
  "redo_depth": 1,
  "recent_human_actions": [
    { "trackId": "v0", "param": "timbre", "from": 0.80, "to": 0.65, "age_ms": 3200 }
  ],
  "recent_reactions": [
    { "actionGroupIndex": 3, "verdict": "approved", "age_ms": 15000 }
  ],
  "observed_patterns": ["Human has approved 7 of last 10 AI actions — generally receptive"],
  "restraint_level": "adventurous",
  "open_decisions": []
}
```

Fields:
- **tracks[]** — each track's current state (1–16 tracks, variable), with a human-readable `label` (e.g. "Track 1 (Kick)"), parameters (control IDs), agency, approval, pattern, views, processor chain, modulators, modulation routings, importance, and musical role
- **label** — 1-indexed ordinal label with engine or user-assigned name (e.g. "Track 1 (Kick)", "Track 2 (My Lead)"). Bus tracks show "Master Bus" or "Bus".
- **params** — track source parameters using control IDs: `timbre`, `harmonics`, `morph`, `frequency`
- **approval** — track approval level: `exploratory`, `liked`, `approved`, `anchor`
- **volume** / **pan** — track mix levels (0.0–1.0)
- **pattern** — canonical event summary with trigger positions, notes, accents, param locks, and density
- **activeTrackId** — the track the human currently has selected
- **views** — list of active sequencer views (`kind:id` format)
- **processors** — processor chain with IDs, types, models, current parameter values, and enabled state
- **modulators** — modulator modules with IDs, types, current mode names, and parameter values
- **modulations** — modulation routings with IDs, source modulator, target (e.g. `"source:timbre"` or `"processor:rings-xxx:position"`), and depth
- **transport** — tempo, swing, playing state, and time signature (e.g. "4/4")
- **context** — global energy and density (0.0–1.0)
- **undo_depth** — how many action groups can be undone
- **redo_depth** — how many action groups can be redone (Cmd+Shift+Z)
- **recent_human_actions** — last 5 parameter changes with track, control ID, values, and age
- **recent_reactions** — last 10 reaction verdicts (approved/rejected/neutral) with rationale and age
- **observed_patterns** — derived natural-language patterns from reaction history (e.g. approval streaks, recurring rationale keywords)
- **restraint_level** — derived from reactions: `conservative`, `moderate`, or `adventurous`
- **open_decisions** — unresolved decisions raised by `raise_decision` (id, question, context, options, trackIds)
- **recent_preservation** — (optional) preservation reports from recent edits to approved/anchor tracks
- **importance** — (optional per track) advisory mix priority (0.0–1.0)
- **musicalRole** — (optional per track) brief description of the track's musical role
- **surface_semantic** — (optional per track) list of semantic control names when set_surface has been used
- **surface_xy** — (optional per track) XY pad axis labels (e.g. "Brightness x Texture")
- **surface_pinned** — (optional per track) list of pinned controls (e.g. "source:timbre")
- **sends** — (optional per track) bus send levels

---

## Controls

### Track source (Plaits)

Nine controls, all 0.0–1.0:

| Control              | Meaning                                         | Plaits parameter   |
|---------------------|------------------------------------------------|-------------------|
| **frequency**        | Fundamental pitch. Low to high.                 | `note`            |
| **harmonics**        | Harmonic complexity. Simple to dense.            | `harmonics`       |
| **timbre**           | Spectral content. Dark to bright.                | `timbre`          |
| **morph**            | Surface character. Smooth to textured.           | `morph`           |
| **timbre-mod-amount**| Internal envelope → timbre modulation depth.     | `timbre_mod_amount`|
| **fm-amount**        | Internal envelope → pitch modulation depth.      | `fm_amount`       |
| **morph-mod-amount** | Internal envelope → morph modulation depth.      | `morph_mod_amount` |
| **decay**            | LPG decay time.                                  | `decay`           |
| **lpg-colour**       | LPG response character (VCA to filter).          | `lpg_colour`      |

### Processor (Rings)

Seven controls (polyphony is discrete 1–4, internal-exciter is boolean, rest 0.0–1.0):

| Control              | Meaning                                         |
|---------------------|------------------------------------------------|
| **structure**        | Geometric structure of the resonator.            |
| **brightness**       | Spectral content of the resonance.               |
| **damping**          | Decay time. Low = long ring, high = short.       |
| **position**         | Excitation position on the resonator.            |
| **fine-tune**        | Fine pitch offset. 0.5 = centered, +/- 1 semitone. |
| **internal-exciter** | Use internal excitation vs external input (boolean). |
| **polyphony**        | Number of simultaneous voices (discrete, 1–4).   |

### Processor (Clouds)

Ten controls, all 0.0–1.0 (freeze is boolean):

| Control           | Meaning                                                         |
|------------------|-----------------------------------------------------------------|
| **position**      | Where in the recording buffer to read.                          |
| **size**          | Grain size or texture scale. Small = glitchy, large = smooth.   |
| **pitch**         | Grain transposition. 0.5 = no shift.                            |
| **density**       | Grain generation rate. Low = sparse, high = dense.              |
| **texture**       | Grain envelope shape / window function.                         |
| **dry-wet**       | Blend between dry input and processed wet signal.               |
| **feedback**      | Wet signal recirculation. High = evolving textures.             |
| **stereo-spread** | Stereo image width. 0 = mono, 1 = full spread.                 |
| **reverb**        | Built-in reverb amount.                                         |
| **freeze**        | Freeze the recording buffer (boolean).                          |

### Modulator (Tides)

Seven controls (output-mode and range are discrete, rest 0.0–1.0):

| Control         | Meaning                                                    |
|----------------|-----------------------------------------------------------|
| **frequency**   | Rate of the modulation cycle. Low = slow sweeps, high = fast oscillation. |
| **shape**       | Waveform character. Blends between sine, triangle, saw, square-like. |
| **slope**       | Attack/decay symmetry. Low = fast attack, high = slow attack. |
| **smoothness**  | Waveform smoothing. Low = sharp edges, high = rounded curves. |
| **shift**       | Multi-channel phase spread between output channels.        |
| **output-mode** | Output signal type: gates (0), amplitude (1), slope/phase (2), frequency (3). |
| **range**       | Operating range: control rate (0) for LFO, audio rate (1) for oscillator. |

The compressed state and tool parameters use control IDs directly. For note events in sketches, pitch is specified as MIDI (0–127), not normalised.

---

## Validation Invariants

Hard rules. The runtime enforces these; violating them means the action is rejected with an error in the tool response.

1. All param values are **0.0–1.0**.
2. `trackId` must reference an existing track — accepts ordinal ("Track 1", "1") or internal ID ("v0"–"v15").
3. Agency must be **ON** for the target track (programming, structure, and modulation tools). UI curation tools (`manage_view`, `set_surface`, `pin_control`, `label_axes`) do not require agency.
4. `at` in events is a **0-based step index** (fractional values allowed for microtiming).
5. MIDI pitch in note events is **0–127**.
6. `duration` in note events is always **0.25**.
7. `controlId` in parameter events must be a known control.
8. `listen` works regardless of transport state (offline render).
9. `set_transport` requires at least one of `bpm`, `swing`, `playing`, `timeSignatureNumerator`, or `timeSignatureDenominator`.
10. `processorId` in `move`, `set_model`, and `manage_processor` (remove/replace/bypass) must reference an existing processor on the target track.
11. `moduleType` in `manage_processor` (add/replace) must be a registered processor type (`rings`, `clouds`).
12. `modulatorId` in `move`, `set_model`, and `manage_modulator` (remove) must reference an existing modulator on the target track.
13. `moduleType` in `manage_modulator` (add) must be a registered modulator type (`tides`).
14. Max **2 processors** and **2 modulators** per track.
15. Modulation depth must be **-1.0 to 1.0**.
16. Modulation targets must be valid controls on the target module. Source targets: `timbre`, `harmonics`, `morph`, `frequency`. Processor targets: all controls for that processor type. Frequency modulation depth guidance: 0.01–0.05 for vibrato, up to ~0.2 for pitch sweeps; beyond 0.2 artifacts are likely.
17. One route per `(modulatorId, target)` pair — `modulation_route`(connect) is idempotent.
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
move({ param: "timbre", trackId: "v0", target: { absolute: 0.25 } })
```

Tool response: `{ queued: true, param: "timbre", trackId: "v0", target: { absolute: 0.25 } }`

Model follows up with text: "Pulled the kick's timbre way down — should sit deeper now."

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
manage_processor({ action: "add", trackId: "v1", moduleType: "rings", description: "Add Rings for metallic resonance" })
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
manage_modulator({ action: "add", trackId: "v1", moduleType: "tides", description: "Add Tides LFO for slow timbre sweep" })
```

Tool response: `{ queued: true, modulatorId: "tides-1710342000000" }`

```
modulation_route({ action: "connect", trackId: "v1", modulatorId: "tides-1710342000000", targetKind: "source", targetParam: "timbre", depth: 0.25, description: "Route LFO to timbre for gentle sweep" })
move({ trackId: "v1", modulatorId: "tides-1710342000000", param: "frequency", target: { absolute: 0.15 } })
```

### Example 7: "Swap Rings for Clouds on the lead"

```
manage_processor({ action: "replace", trackId: "v1", processorId: "rings-1710342000000", moduleType: "clouds", description: "Replace Rings with Clouds for granular texture" })
```

Tool response: `{ queued: true, newProcessorId: "clouds-1710342100000" }`

The model can then configure Clouds in the same turn:
```
set_model({ trackId: "v1", processorId: "clouds-1710342100000", model: "spectral" })
move({ trackId: "v1", processorId: "clouds-1710342100000", param: "size", target: { absolute: 0.7 } })
```

### Example 8: "Measure the spectral balance of the kick"

The model chains two tools:
```
render({ scope: "Track 1", bars: 2 })
```

Tool response: `{ snapshotId: "snap-1710342000000" }`

```
analyze({ snapshotId: "snap-1710342000000", types: ["spectral", "dynamics"] })
```

### Example 9: "Mark the bass as important"

```
set_track_meta({ trackId: "v0", importance: 0.9, musicalRole: "driving bass", approval: "liked", reason: "Human is happy with the bass sound" })
```

---

## Positive Instructions

- Be musical, not mechanical. Patterns should groove, not just fill slots.
- Prefer small changes over wholesale rewrites. Nudge a parameter rather than replacing an entire pattern.
- When sketching patterns, think in terms of groove and dynamics — vary velocity, use accents for emphasis.
- Combine tool calls in one turn when it makes sense: sketch + move, manage_processor(add) + set_model + move, manage_modulator(add) + modulation_route(connect) + move.
- Keep text responses short — one or two sentences. The human is listening, not reading an essay.
- When unsure, ask. A short clarifying question is better than a wrong guess.
- After adding a processor or modulator, configure it in the same turn.
- After sketching a percussion pattern, consider adding a step-grid view with manage_view so the human can see it.
- For modulation, prefer shallow depth (0.1–0.3) before aggressive values. Common useful routings: Tides → timbre for filter sweeps, Tides → morph for evolving character, Tides → Clouds position for granular scrubbing.
- Use render + analyze for quantitative measurement, listen for qualitative AI evaluation.
- Use raise_decision for subjective choices where multiple valid approaches exist.
