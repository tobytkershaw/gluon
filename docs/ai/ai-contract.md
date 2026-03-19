# AI Contract

What the AI agent needs at inference time to interact with Gluon's canonical musical model.

**Architecture:** The AI uses a multi-provider, provider-abstracted function calling architecture (currently Gemini-only: Gemini 2.5 Pro as planner, Gemini Flash as listener). The model receives compressed session state with each turn, reasons about the request, and invokes tools to make changes. Tool calls are validated against live session state before the model sees a success response. Actions are collected and dispatched after the tool loop completes.

---

## Tools

The AI has forty-three tools, declared as neutral JSON Schema and adapted per provider.

### Programming

Change what the instrument sounds like — parameters, patterns, and transformations. **Requires track agency ON.**

#### `move`

Change a control parameter value on a track source, processor, or modulator.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `param` | string | yes | Control ID. Track source (Plaits): `frequency`, `harmonics`, `timbre`, `morph`, `timbre-mod-amount`, `fm-amount`, `morph-mod-amount`, `decay`, `lpg-colour`. Processor (Rings): `structure`, `brightness`, `damping`, `position`, `fine-tune`, `internal-exciter`, `polyphony`. Processor (Clouds): `position`, `size`, `pitch`, `density`, `texture`, `dry-wet`, `feedback`, `stereo-spread`, `reverb`, `freeze`. Processor (Ripples): `cutoff`, `resonance`, `drive`. Processor (Warps): `algorithm`, `timbre`, `level`. Processor (Elements): `bow_level`, `bow_timbre`, `blow_level`, `blow_timbre`, `strike_level`, `strike_timbre`, `coarse`, `fine`, `geometry`, `brightness`, `damping`, `position`, `space`. Processor (Beads): `density`, `time`, `pitch`, `position`, `texture`, `dry-wet`. Processor (EQ): `low-freq`, `low-gain`, `mid1-freq`, `mid1-gain`, `mid1-q`, `mid2-freq`, `mid2-gain`, `mid2-q`, `high-freq`, `high-gain`. Processor (Compressor): `threshold`, `ratio`, `attack`, `release`, `makeup`, `mix`. Modulator (Tides): `frequency`, `shape`, `slope`, `smoothness`, `shift`, `output-mode`, `range`. |
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
| `humanize` | number | no | Humanize amount (0.0–1.0). Adds subtle velocity and timing jitter. 0.3 is a good default. |
| `groove` | string | no | Groove template: `straight`, `mpc_swing`, `808_shuffle`, `garage`, `techno_drive`, `laid_back`, `dnb_break`, `dilla`. Applies systematic per-instrument micro-timing. |
| `groove_amount` | number | no | Groove intensity (0.0–1.0, default 0.7). |

**Event kinds:**
- `trigger` — percussion hit. Fields: `at` (step position), `velocity` (0.0–1.0), `accent` (boolean)
- `note` — melodic note. Fields: `at`, `pitch` (MIDI 0–127), `velocity`, `duration` (gate length in steps: 0.25 = staccato, 0.5 = normal, 1.0 = legato, 2.0+ = sustained)
- `parameter` — per-step param lock. Fields: `at`, `controlId` (control name), `value` (0.0–1.0)

**Step addressing:** The `at` field accepts two formats:
- **Numeric**: 0-based step index (e.g. `0`, `4`, `36`). Fractional values for microtiming (e.g. `4.1`).
- **Bar.beat.sixteenth string**: `"bar.beat.sixteenth"` where all components are 1-based (e.g. `"1.1.1"` = step 0, `"3.2.1"` = step 36). Prefer this format for multi-bar patterns.

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
| `operation` | string | yes | `rotate`, `transpose`, `reverse`, `duplicate`, `humanize`, `euclidean`, `ghost_notes`, `swing`, `thin`, `densify` |
| `steps` | integer | no | For `rotate`: number of steps to shift (positive=forward, negative=backward). |
| `semitones` | integer | no | For `transpose`: semitones to shift (positive=up, negative=down). |
| `velocity_amount` | number | no | For `humanize`: velocity jitter amount (0–1, default 0.3). |
| `timing_amount` | number | no | For `humanize`: timing jitter amount (0–1, default 0.1). |
| `hits` | integer | no | For `euclidean`: number of hits to distribute across the pattern length. |
| `rotation` | integer | no | For `euclidean`: rotation offset (0 to steps-1, default 0). |
| `velocity` | number | no | For `euclidean`/`ghost_notes`/`densify`: velocity of generated events (0–1). |
| `probability` | number | no | For `ghost_notes`/`thin`/`densify`: probability (0–1). |
| `amount` | number | no | For `swing`: swing amount (0–1). 0=straight, 1=maximum triplet feel. |
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

Renders audio offline from the current project state (no transport dependency), converts to WAV, and sends it with a critique prompt to the model. Returns a text critique. Track isolation is built into the render — only the requested tracks are included. Within a single turn, `listen` evaluates the current projected state, including edits made earlier in the same tool loop.

#### `render`

Capture an audio snapshot with explicit scope. Returns a `snapshotId` that can be passed to `analyze` or `listen`. Cheap — use freely before analysis tools. Within a single turn, `render` captures the current projected state, including edits made earlier in the same tool loop.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `scope` | string or string[] | no | Track reference ("Track 1" or "v0"), array of references, or omit for full mix. |
| `bars` | integer | no | Duration to render in bars (1-16, default 2). |

#### `analyze`

Run deterministic audio analysis on a rendered snapshot. Supports spectral, dynamics, rhythm, masking, diff, and reference analysis in a single call. Use `render` first to capture a snapshot, then `analyze` for quantitative measurement.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `snapshotId` | string | conditional | Snapshot ID from a previous `render` call. Used for spectral, dynamics, rhythm, reference, and diff (as the "after" snapshot). |
| `compareSnapshotId` | string | no | Snapshot ID for the "before" state in diff analysis. Required when `types` includes `diff`. |
| `snapshotIds` | string[] | no | Multiple snapshot IDs for cross-track masking analysis. Render each track separately, then pass all IDs here. |
| `types` | string[] | yes | Analysis types: `spectral` (centroid, rolloff, flatness, bandwidth, pitch), `dynamics` (LUFS, RMS, peak, crest factor), `rhythm` (tempo estimate, onsets, density, swing), `masking` (cross-track frequency conflict detection — requires `snapshotIds`), `diff` (before/after comparison with structured deltas — requires `snapshotId` + `compareSnapshotId`), `reference` (compare spectral/dynamic balance against a genre profile — requires `snapshotId` + `referenceProfile`). |
| `referenceProfile` | string | no | Genre reference profile for `reference` analysis. Available: `techno_dark`, `techno_minimal`, `house_deep`, `ambient`, `dnb`, `hiphop`. Returns structured gaps (per-band spectral deltas, dynamic range deltas) with actionable suggestions. |

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
| `model` | string | yes | Model/mode ID. Track: `virtual-analog`, `waveshaping`, `fm`, `grain-formant`, `harmonic`, `wavetable`, `chords`, `vowel-speech`, `swarm`, `filtered-noise`, `particle-dust`, `inharmonic-string`, `modal-resonator`, `analog-bass-drum`, `analog-snare`, `analog-hi-hat`. Rings: `modal`, `sympathetic-string`, `string`, `fm-voice`, `sympathetic-quantized`, `string-and-reverb`. Clouds: `granular`, `pitch-shifter`, `looping-delay`, `spectral`. Warps: `crossfade`, `fold`, `ring`, `vocoder`. Elements: `modal`, `string`. Beads: `granular`, `delay`, `wavetable-synth`. Ripples: `lp2`, `lp4`, `bp2`, `hp2`. EQ: `4band`, `8band`. Compressor: `clean`, `opto`, `bus`, `limit`. Tides: `ad`, `looping`, `ar`. |
| `processorId` | string | no | Processor ID to target. When provided, switches the processor's mode instead of the track's synthesis engine. |
| `modulatorId` | string | no | Modulator ID to target. When provided, switches the modulator's mode (e.g. AD, Looping, AR for Tides). |

#### `manage_processor`

Add, remove, replace, or bypass a processor module in a track's signal chain. Max 2 processors per track.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | yes | `add`, `remove`, `replace`, or `bypass`. |
| `trackId` | string | yes | Target track — ordinal ("Track 1") or internal ID ("v0"). |
| `moduleType` | string | no | Required for `add` and `replace`. Available: `rings` (Mutable Instruments Rings resonator), `clouds` (Mutable Instruments Clouds granular processor), `beads` (Mutable Instruments Beads granular processor), `ripples` (Mutable Instruments Ripples analog filter — LP/BP/HP), `warps` (Mutable Instruments Warps waveshaper/modulator), `elements` (Mutable Instruments Elements modal synthesis), `eq` (parametric EQ — 4-band and 8-band mixing), `compressor` (dynamics compressor with character modes), `stereo` (stereo width/imaging), `chorus` (chorus/ensemble effect), `distortion` (distortion/saturation). |
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

#### `set_sidechain`

Set up audio sidechain compression: route one track's audio into a compressor's detector on another track. The compressor reacts to the source track's volume while processing the target track's audio. Set sourceTrackId to null to remove an existing sidechain.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sourceTrackId` | string or null | yes | Source track whose audio drives the detector. Null to remove. |
| `targetTrackId` | string | yes | Target track containing the compressor. |
| `processorId` | string | no | Compressor processor ID. Auto-detected when the target has exactly one compressor. |
| `description` | string | yes | Short description of the routing intent. |

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

Compose a track's UI surface from modules. Each module has a type, bindings to controls, a grid position, and optional configuration. Does not require agency.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target track — ordinal ("Track 1") or internal ID ("v0"). |
| `modules` | array | yes | Array of surface module definitions. Each has `type` (one of `knob-group`, `macro-knob`, `xy-pad`, `step-grid`, `chain-strip`), `bindings` (array of `{ moduleId, controlId }` — what controls the module exposes), `position` (`{ col, row, colSpan?, rowSpan? }` on the surface grid), and optional `config` (type-specific settings). For `macro-knob`, config contains `semanticControl` with `name` (label) and `weights` (array of `{ moduleId, controlId, weight, transform? }` — weights must sum to 1.0). For `knob-group`, config contains `label` (group name). |
| `description` | string | yes | Short description of the surface configuration. |

#### `pin_control`

Pin or unpin a raw module control on the track's surface. Creates or removes a pinned knob-group module. Max 4 pins per track. Does not require agency.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | yes | `pin` or `unpin`. |
| `trackId` | string | yes | Target track ID (e.g. "v0"). |
| `moduleId` | string | yes | `"source"` for track params, or a processor ID. |
| `controlId` | string | yes | The control to pin or unpin (e.g. "timbre", "structure"). |

#### `label_axes`

Update XY pad axis bindings. **Fails if no xy-pad module exists** on the track's surface — use `set_surface` to add one first. Does not require agency.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target track ID (e.g. "v0"). |
| `x` | string | yes | X-axis semantic label (e.g. "Brightness"). |
| `y` | string | yes | Y-axis semantic label (e.g. "Texture"). |

### Track Metadata

#### `set_track_meta`

Set track metadata: name, volume, pan, muted, solo, approval level, importance, and/or musical role in a single call. At least one field required. Approval requires agency ON and a reason.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target track — ordinal ("Track 1") or internal ID ("v0"). |
| `name` | string | no | Display name for the track (e.g. "Kick", "Lead Synth"). |
| `volume` | number | no | Track volume (0.0-1.0, linear gain). |
| `pan` | number | no | Track pan (-1.0 left to 1.0 right). |
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

### Session Context

#### `set_intent`

Set or update the session-level creative intent. Updates are merged: fields you provide overwrite previous values, fields you omit are preserved. Call early when the direction is clear, and update as the session evolves.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `genre` | string[] | no | Genre tags (e.g. `["dubstep", "hyperdub", "uk bass"]`). |
| `references` | string[] | no | Artist or track references (e.g. `["Kode9", "Burial"]`). |
| `mood` | string[] | no | Mood descriptors (e.g. `["dark", "sparse", "roomy"]`). |
| `avoid` | string[] | no | Things to avoid (e.g. `["busy hats", "four-on-floor"]`). |
| `currentGoal` | string | no | The current creative objective (e.g. "build a half-step beat"). |

At least one field must be provided.

#### `set_section`

Set or update the current section metadata. Describes what part of the arrangement is being worked on and its target character. Updates are merged: fields you provide overwrite previous values, fields you omit are preserved.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | no | Section name (e.g. "intro", "groove", "breakdown", "drop"). |
| `intent` | string | no | Section character intent (e.g. "sparse and tense", "peak energy"). |
| `targetEnergy` | number | no | Target energy level for this section (0.0-1.0). |
| `targetDensity` | number | no | Target rhythmic density for this section (0.0-1.0). |

At least one field must be provided. `targetEnergy` and `targetDensity` are clamped to 0.0-1.0.

#### `set_scale`

Set the global scale/key constraint. When set, note pitches in `sketch` and `edit_pattern` are auto-quantized to the nearest in-scale degree. Set `clear: true` for chromatic/atonal work.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `root` | integer | conditional | Root note as pitch class (0=C, 1=C#, ... 11=B). Required unless `clear` is true. |
| `mode` | string | conditional | Scale mode (major, minor, dorian, phrygian, lydian, mixolydian, aeolian, locrian, harmonic-minor, melodic-minor, pentatonic, minor-pentatonic, blues, chromatic, whole-tone). Required unless `clear` is true. |
| `clear` | boolean | no | Set to true to clear the scale constraint. When true, `root` and `mode` are ignored. |

Undoable. Produces a `ScaleSnapshot` for undo.

#### `set_tension`

Set the tension/energy curve over the arrangement timeline. Defines an arc of energy and density that the AI uses as a compositional guide. Points are interpolated linearly. Optionally map individual tracks to the curve, defining how their parameters respond to energy levels. The curve is metadata/intent — it does not directly control audio parameters.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `points` | array | yes | Tension curve points. Each has `bar` (1-based), `energy` (0.0-1.0), `density` (0.0-1.0). Sorted by bar; duplicates at the same bar overwrite. |
| `trackMappings` | array | no | Per-track mappings. Each has `trackId`, optional `activationThreshold` (0.0-1.0), and `params` array of `{ param, low, high }` defining parameter ranges by energy level. |

Not undoable (metadata-only, like `set_intent`).

#### `shape_timbre`

Move a track's timbre in a musical direction. Translates musical descriptors (darker, brighter, thicker, etc.) to appropriate parameter changes for the active synthesis model and any processors in the chain.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target track — ordinal (e.g. "Track 1") or internal ID (e.g. "v0"). |
| `direction` | string | yes | Musical direction: darker, brighter, thicker, thinner, aggressive, gentle, metallic, organic, dry, wet, open, closed, smooth, rough, hollow, full. |
| `amount` | number | no | Scale factor (0.0-1.0, default 0.3). Higher values produce more dramatic changes. |

Produces `move` actions for affected parameters. Undoable via the standard move undo path.

#### `assign_spectral_slot`

Assign a track to frequency bands with a priority. Prevents frequency collisions by computing EQ adjustments when multiple tracks share a band. Lower-priority tracks receive gentle attenuation suggestions (2-4 dB).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target track — ordinal (e.g. "Track 1") or internal ID (e.g. "v0"). |
| `bands` | string[] | yes | Frequency bands: `sub` (20-60 Hz), `low` (60-250 Hz), `low_mid` (250-500 Hz), `mid` (500-2000 Hz), `high_mid` (2-6 kHz), `high` (6-12 kHz), `air` (12-20 kHz). |
| `priority` | integer | yes | Priority (0-10). Higher priority wins shared bands. Kick=10, bass=8, lead=7, pad=3, texture=1. |

Returns slot assignment, any collisions, and suggested EQ adjustments. The AI applies adjustments via `move` or `manage_processor` tools. Proactive counterpart to masking analysis (diagnostic).

#### `manage_motif`

Register, recall, develop, or list musical motifs. Motifs are named melodic/rhythmic ideas that can be developed using classical composition techniques to create structurally coherent variations.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | yes | `register`, `recall`, `develop`, or `list`. |
| `name` | string | conditional | Human-readable name for register. |
| `motifId` | string | conditional | Motif ID or name for recall/develop. |
| `trackId` | string | conditional | Source track for register, target track for develop. |
| `stepRange` | array | no | `[start, end]` step range for register. |
| `rootPitch` | number | no | Reference pitch (MIDI 0-127). Auto-detected if omitted. |
| `tags` | array | no | Freeform tags (e.g. `["rhythmic", "melodic"]`). |
| `operations` | array | conditional | Development operations for develop (see below). |
| `description` | string | no | Human-readable description. |

**Development operations** (for `action: "develop"`):
- `transpose` — shift pitches by `semitones`
- `invert` — mirror intervals around `axisPitch` (or rootPitch)
- `retrograde` — reverse in time
- `augment` — stretch durations by `factor` (default 2)
- `diminish` — compress durations by `factor` (default 2)
- `fragment` — extract events by index range (`start`, `end`)
- `permute` — reorder segments by `order` array
- `ornament` — add passing tones between notes
- `thin` — remove events by `probability` (0.0-1.0)
- `layer` — stack with transposed copy at `semitones` interval

When `develop` includes a `trackId`, the result is written as a sketch action. Motifs persist for the session lifetime.

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

#### `apply_chain_recipe`

Apply a pre-configured signal chain recipe. Clears existing processors and adds the recipe's chain with optimized settings for common musical roles.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target track — ordinal (e.g. "Track 1") or internal ID. |
| `recipe` | string | yes | Recipe name (e.g. "techno_kick", "deep_bass", "ambient_pad", "mix_bus"). |

Compound tool — emits remove_processor, add_processor, set_model, and move actions. Undoable as an action group.

#### `set_mix_role`

Apply a mix role preset to a track. Sets volume and pan to role-appropriate defaults.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target track — ordinal (e.g. "Track 1") or internal ID. |
| `role` | string | yes | Mix role name (e.g. "lead", "pad", "rhythm_foundation", "sub", "texture", "accent"). |

Undoable via `TrackPropertySnapshot`.

#### `apply_modulation`

Apply a pre-configured modulation recipe. Adds a Tides modulator with preset parameters and connects it to the appropriate target.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target track — ordinal (e.g. "Track 1") or internal ID. |
| `recipe` | string | yes | Modulation recipe name (e.g. "vibrato", "slow_filter_sweep", "tremolo", "wobble", "drift"). |
| `processorId` | string | no | Specific processor ID for processor-targeted recipes. Auto-finds first matching type if omitted. |

Compound tool — emits add_modulator, set_model, move, and connect_modulator actions. Undoable as an action group. For processor-targeted recipes (filter sweeps, wobble), the matching processor must already exist on the track.

#### `save_patch`

Save the current track's sound configuration (synthesis model + params + processor chain + modulators + routings) as a named patch. Does NOT save pattern data, track identity, or mix settings. Use to capture a sound for reuse later or on other tracks.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Source track — ordinal (e.g. "Track 1") or internal ID. |
| `name` | string | yes | Name for the patch (e.g. "Warm Techno Bass"). |
| `tags` | array | no | Tags for categorization (e.g. `["bass", "warm"]`). |

Read-only from the session perspective — saves to the patch library (IndexedDB) but does not modify session state.

#### `load_patch`

Load a saved patch onto a track. Replaces the track's sound configuration while preserving pattern data, track identity, agency, and mix settings.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trackId` | string | yes | Target track — ordinal (e.g. "Track 1") or internal ID. |
| `patch` | string | yes | Patch name or ID. Case-insensitive name matching. |

Built-in patches: Deep Sub Kick, Acid Bass, Warm Pad, Crisp Snare, Digital Lead, Metallic Hi-Hat, Swarm Texture, Resonant Bell. User-saved patches also available. Compound tool — emits remove/add/move/set_model actions. Undoable as an action group.

#### `setup_return_bus`

Create a return bus with a wet-capable processor and route a source track to it via a send. Handles bus creation, processor insertion, optional model selection, wet level, and send routing in one call.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sourceTrackId` | string | yes | Source track — ordinal (e.g. "Track 1") or internal ID. |
| `processorType` | string | yes | Wet-capable processor type (e.g. "reverb", "delay"). |
| `description` | string | yes | Purpose description for the return bus. |
| `name` | string | no | Label for the new bus track. |
| `processorModel` | string | no | Processor model/mode to set after adding. |
| `wet` | number | no | Wet parameter level 0.0–1.0 (default 1.0). |
| `sendLevel` | number | no | Send level 0.0–1.0 (default 0.3). |

Compound tool — emits add_track, add_processor, set_model (optional), move (wet), and manage_send actions. Undoable as an action group.

#### `apply_arrangement_archetype`

Apply a genre-aware arrangement template to a track. Creates patterns for each section (intro, build, drop, breakdown, outro) with appropriate density and energy, then sketches events into each pattern.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `archetype` | string | yes | Arrangement template name (e.g. "techno_64bar", "house_32bar", "dnb_64bar", "ambient_32bar"). |
| `trackId` | string | yes | Target track — ordinal (e.g. "Track 1") or internal ID. |
| `description` | string | yes | Short description of the arrangement intent. |

Compound tool — emits manage_pattern (add, set_length, rename) and sketch actions for each section. Use `manage_sequence` afterward to arrange patterns into a song order, and `set_transport` mode: "song" to play through the arrangement. Undoable as an action group.

#### `list_patches`

List available patches (built-in and user-saved). Optionally filter by tag.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tag` | string | no | Filter by tag (e.g. "kick", "bass", "pad"). Case-insensitive. |

Read-only — does not modify session state.

#### `suggest_reactions`

Suggest 2-5 contextual musical reaction chips for the human to click. Call once at the end of your response, after all other actions. Chips appear alongside the static approve/reject/undo controls. Read-only — does not modify session state.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `reactions` | array | yes | Short musical direction labels, 2-5 items, max 20 chars each (e.g. "more tense", "brighter", "keep groove"). |

Clicking a chip records an `approved` verdict with the chip text as rationale, and sends the chip as a follow-up message. This gives the human quick one-click ways to direct iteration.

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
        "triggers": [{ "at": 0, "vel": 1.0 }, { "at": 4, "vel": 0.85 }, { "at": 8, "vel": 0.9 }, { "at": 12, "vel": 0.85 }],
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
  "track_count": 1,
  "soft_track_cap": 16,
  "activeTrackId": "v0",
  "transport": { "bpm": 120, "swing": 0.00, "playing": true, "mode": "pattern", "loop": true, "time_signature": "4/4" },
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
- **pattern** — canonical event summary with triggers (`{at, vel}`), notes (`{at, pitch, vel}`), accents, param locks, and density
- **track_count** — total number of tracks in the session
- **soft_track_cap** — maximum recommended track count (currently 16)
- **activeTrackId** — the track the human currently has selected
- **views** — list of active sequencer views (`kind:id` format)
- **processors** — processor chain with IDs, types, models, current parameter values, and enabled state
- **modulators** — modulator modules with IDs, types, current mode names, and parameter values
- **modulations** — modulation routings with IDs, source modulator, target (e.g. `"source:timbre"` or `"processor:rings-xxx:position"`), and depth
- **transport** — tempo, swing, playing state, mode (`pattern` or `song`), loop flag, and time signature (e.g. "4/4")
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
- **surface_modules** — (optional per track) list of surface module types and labels (e.g. "knob-group:Timbre", "macro-knob:Warmth", "xy-pad") when set_surface has been used
- **sends** — (optional per track) bus send levels
- **intent** — (optional) session-level creative intent: `genre`, `references`, `mood`, `avoid`, `currentGoal`. Survives context window rotation.
- **section** — (optional) current arrangement section: `name`, `intent`, `targetEnergy`, `targetDensity`. Describes what part of the arrangement is being worked on.
- **scale** — (optional) global key/scale constraint: `root` (pitch class 0–11), `mode`, `label` (e.g. "C major"), `notes` (available note names). `null` when explicitly cleared.
- **userSelection** — (optional) active Tracker selection: `trackId`, `stepRange` ([start, end]), `eventCount`. Present only when the human has selected events.

---

## Controls

### Track source (Plaits)

Nine controls, all 0.0–1.0:

| Control              | Meaning                                         | Plaits parameter   |
|---------------------|------------------------------------------------|-------------------|
| **frequency**        | Fundamental pitch. Low to high.                 | `note`            |
| **harmonics**        | Harmonic complexity. Simple to dense.            | `harmonics`       |
| **timbre**           | Spectral content. Dark to bright.                | `timbre`          |
| **morph**            | Lateral timbral variation. Different characters at same brightness. | `morph`           |
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
| **damping**          | Decay time. Low = short decay, high = long ring. |
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

### Processor (Ripples)

Three controls, all 0.0–1.0:

| Control        | Meaning                                                      |
|---------------|--------------------------------------------------------------|
| **cutoff**     | Filter cutoff frequency. Low = dark, high = open.            |
| **resonance**  | Filter resonance / Q. At maximum, self-oscillates.           |
| **drive**      | Input saturation before filtering. Adds warmth and harmonics.|

Modes: `lp2` (12dB/oct low-pass), `lp4` (24dB/oct low-pass, Moog-style), `bp2` (band-pass), `hp2` (high-pass).

### Processor (EQ)

Ten controls, all 0.0–1.0:

| Control        | Meaning                                                      |
|---------------|--------------------------------------------------------------|
| **low-freq**   | Low shelf frequency (20–500Hz).                              |
| **low-gain**   | Low shelf gain. 0.5 = unity (0dB).                           |
| **mid1-freq**  | Mid band 1 center frequency (100–8kHz).                      |
| **mid1-gain**  | Mid band 1 gain. 0.5 = unity.                                |
| **mid1-q**     | Mid band 1 bandwidth. 0 = wide, 1 = narrow.                 |
| **mid2-freq**  | Mid band 2 center frequency (100–8kHz).                      |
| **mid2-gain**  | Mid band 2 gain. 0.5 = unity.                                |
| **mid2-q**     | Mid band 2 bandwidth. 0 = wide, 1 = narrow.                 |
| **high-freq**  | High shelf frequency (1–20kHz).                              |
| **high-gain**  | High shelf gain. 0.5 = unity.                                |

Modes: `4band` (low shelf + 2 peaking mids + high shelf), `8band` (low shelf + 6 peaking mids + high shelf).

### Processor (Compressor)

Six controls, all 0.0–1.0:

| Control        | Meaning                                                      |
|---------------|--------------------------------------------------------------|
| **threshold**  | Level above which compression begins. 0 = heavy, 1 = none.  |
| **ratio**      | Compression ratio. Low = gentle, high = aggressive.          |
| **attack**     | Reaction speed. Low = fast (punchy), high = slow (transient-preserving). |
| **release**    | Recovery speed. In opto mode this is program-dependent.      |
| **makeup**     | Output gain compensation.                                     |
| **mix**        | Dry/wet blend for parallel compression.                       |

Modes: `clean` (transparent VCA), `opto` (LA-2A style), `bus` (SSL glue), `limit` (brickwall limiter).

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
3. Agency must be **ON** for the target track (programming, structure, and modulation tools). UI curation tools (`manage_view`, `set_surface`, `pin_control`, `label_axes`) do not require agency. When agency is OFF, the system raises a decision prompt asking the human to approve or deny the change. The AI receives a structured `{ blocked: true, reason: "agency_off", decisionId }` response and should wait for the human's decision before retrying. **Planned (#926):** The binary agency gate will evolve into granular permission gates with claim/protect semantics and a default blacklist.
4. `at` in events is a **0-based step index** (fractional values allowed for microtiming) or a **"bar.beat.sixteenth" string** (1-based, e.g. "1.1.1" = step 0).
5. MIDI pitch in note events is **0–127**.
6. `duration` in note events must be **> 0** (gate length in steps).
7. `controlId` in parameter events must be a known control.
8. `listen` works regardless of transport state (offline render).
9. `set_transport` requires at least one of `bpm`, `swing`, `playing`, `timeSignatureNumerator`, or `timeSignatureDenominator`.
10. `processorId` in `move`, `set_model`, and `manage_processor` (remove/replace/bypass) must reference an existing processor on the target track.
11. `moduleType` in `manage_processor` (add/replace) must be a registered processor type (`rings`, `clouds`, `beads`, `ripples`, `warps`, `elements`, `eq`, `compressor`, `stereo`, `chorus`, `distortion`).
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
