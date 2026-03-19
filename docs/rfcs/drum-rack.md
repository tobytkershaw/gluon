# Gluon RFC: Drum Rack

## Status

Draft RFC. Addresses #729 (drum kit abstraction) and provides a foundation for the Surface view's drum-specific modules.

Related docs:

- `docs/rfcs/canonical-musical-model.md` — canonical data model (Voice, ControlSchema, SourceAdapter)
- `docs/rfcs/view-architecture.md` — four-view architecture (Tracker, Rack, Patch, Surface)
- `docs/rfcs/ai-curated-surfaces.md` — Surface module system
- `docs/rfcs/surface-north-star.md` — Surface module taxonomy
- `docs/principles/ai-interface-design-principles.md` — AI interface design principles
- `docs/design-references.md` — design references (Ableton Drum Rack, NI Maschine)

---

## Product Thesis

Gluon needs a drum rack. Today, building a beat requires 3–4 separate tracks (kick, snare, hat, perc), each consuming a track slot, each with its own pattern, each mixed independently. This is functional but musically incoherent — the AI and human both lose the ability to reason about "the drums" as a single instrument.

The drum rack solves this by putting multiple sound sources on one track, with named trigger lanes sharing a single pattern container, processor chain, and mix position. The AI sees stacked lanes and reasons about groove; the human sees a pad grid and plays a kit.

### Design origin

This design was informed by structured interviews with Gluon's AI (Gemini). We asked the model to notate drum patterns in whatever format felt most natural, compared three compression formats, and observed which representations the model has strongest priors on. The key observations:

1. **The AI organises by named layers** — "kick", "snare", "ghosts", "hats" — not as flat event lists. When writing a mixed event list, it added comments to track which instrument each event belonged to — the format was fighting its natural grouping.
2. **Grid notation is token-efficient and training-data-prevalent** — `"x...o...|x..o...."` maps to how drum patterns appear in music forums, manuals, and tracker documentation. The model has strong priors on this representation.
3. **Separating positions from velocities requires cross-referencing** — our initial design (separate `hits` and `accents` arrays) was rejected in favour of co-located information where each grid character carries both position and intensity.
4. **Categorical velocity maps to musical vocabulary** — accent/normal/ghost maps to how drummers describe dynamics, and the model's training data reinforces these categories over arbitrary 0.0–1.0 floats.
5. **Sketch the whole kit at once, edit one lane at a time** — the AI described drum parts as inherently interlocking, needing joint composition but individual refinement.

**Caveat:** The AI's introspective claims about its own processing should not be taken literally. LLMs don't have reliable self-knowledge about attention patterns or internal representations. What IS meaningful is the behavioural output — the specific notations the model reaches for when unconstrained — because these reflect training-data priors that translate to real pattern-completion advantages. See [Generalisation](#generalisation-role-aware-compression) for a fuller discussion of epistemic limits.

### A general principle discovered

The interview revealed something bigger than drum racks: **state compression should be role-aware and intention-revealing, not a neutral serialization of events.** The model produces structurally different notations for drums (grid strings), bass (tracker rows with pitch+duration), pads (chord blocks with voice-leading), and plucked riffs (motif cells with accent patterns). Today we send the same `{at, pitch, vel, dur}` event list for all of them.

This RFC implements role-aware compression for drum rack tracks. The generalisation to melodic and harmonic content is a hypothesis that should be validated empirically before implementation. See [Generalisation](#generalisation-role-aware-compression) below.

---

## Design Principles

### 1. Source type plus adapter-specific config

A Track already has `engine` and `model` fields that every system understands. The drum rack is `engine: 'drum-rack'` — a source type that happens to contain multiple sub-sources. The `engine` field is the discriminant that tells systems how to handle this track. Adapter-specific configuration (the pad list) lives in an optional `drumRack` field on Track — the same pattern as `processors`, `modulators`, and other optional config that only certain track configurations use.

This is a pragmatic choice: systems that don't care about drum rack internals (undo grouping, agency checks, mute/solo) can ignore the `drumRack` field entirely and operate on the Track as usual. Systems that do care (audio engine, sketch execution, compression) check `engine === 'drum-rack'` and use the pad config. The alternative — a new `TrackKind` — would require changes to every `kind` switch in the codebase, which is a larger blast radius for a source-level concern.

### 2. Lightweight containers, not nested tracks

A drum pad has a source, a level, and a pan. It does not have its own processor chain, modulator graph, modulation routing, send bus, or surface. If you want effects on your hi-hats, put them on a separate drum rack track with its own chain. This keeps the audio graph simple: N sources → mix → track output → track chain.

The Ableton Drum Rack has per-pad chains. That's powerful but enormously complex — each pad becomes a mini-track with its own undo, its own AI tool surface, its own Surface modules. We can add it later. v1 is a drum machine, not a drum DAW.

### 3. Named trigger lanes, not pitch-mapped notes

The AI should think "add a snare hit at 2.1.1", not "add a note at E4 on step 8". Drum rack patterns are collections of named trigger lanes, where each lane maps to a pad. Events are tagged with `padId`, not encoded in pitch.

This aligns with principle 7 from the AI interface design doc: "Constrain to musical dimensions, don't expand to all dimensions." Named pads shrink the possibility space from 128 MIDI pitches to the 4–16 sounds actually in the kit.

### 4. Grid notation for compression

The AI reads and writes drum patterns as grid strings: `"x...o...|x..o...."` where each character is a 16th-note position carrying both timing and intensity. This is:
- **Spatially legible** — the AI sees gaps, clusters, and interlocking parts at a glance
- **Token-efficient** — 32 characters for a 2-bar pattern vs ~200 tokens as event objects
- **Round-trip symmetric** — the AI reads what it writes; no format translation
- **Categorically expressive** — `x`=accent, `o`=normal, `g`=ghost, `.`=rest covers 90% of drum programming

Per-event detail (micro-timing offsets, exact velocities) is provided only for exceptions.

### 5. Growable pads, not fixed grids

The AI starts with kick+snare+hat and adds percussion as the beat develops. Pads are added mid-session, not fixed at creation. This matches Gluon's incremental exploration model.

---

## Data Model

### DrumPad

A single sound source within a drum rack.

```ts
interface DrumPad {
  id: string;               // stable identifier: "kick", "snare", "hat-closed"
  name: string;             // human-readable: "Kick", "Snare", "Closed Hat"
  source: {
    engine: string;         // "plaits" (or future: "sampler")
    model: number;          // Plaits model index
    params: Record<string, number>;
  };
  chokeGroup?: number;      // pads in same group mute each other on trigger
  level: number;            // 0.0–1.0, default 0.8
  pan: number;              // 0.0–1.0 (0.5 = center), default 0.5
}
```

### DrumRackConfig

The drum rack configuration, stored on the Track.

```ts
interface DrumRackConfig {
  pads: DrumPad[];          // growable, max 16 for v1
}
```

### Track integration

The drum rack adds one optional field to Track — adapter-specific config, following the same pattern as `processors`, `modulators`, and other optional fields that only certain track configurations use.

```ts
interface Track {
  // existing fields...
  engine: string;           // 'drum-rack' for drum rack tracks
  model: number;            // unused for drum rack (0)
  params: SynthParamValues; // unused for drum rack (defaults)

  /** Drum rack configuration. Present only when engine === 'drum-rack'. */
  drumRack?: DrumRackConfig;

  // existing fields continue...
}
```

The `engine: 'drum-rack'` discriminant tells all systems how to handle this track. The `drumRack` field is the adapter-specific config — analogous to how `model` is Plaits-specific.

### Event tagging

Events in a drum rack track's patterns carry a `padId` field:

```ts
interface TriggerEvent extends BaseEvent {
  kind: 'trigger';
  velocity: number;
  accent?: boolean;
  /** For drum rack tracks: which pad this trigger belongs to. */
  padId?: string;
}
```

`padId` is optional — non-drum-rack tracks don't use it. When present, it routes the trigger to the named pad's source. Events without `padId` in a drum rack track are invalid and rejected during validation.

### Pattern containers

Drum rack tracks use the existing pattern system unchanged. All pads share the track's patterns and sequence. Pattern switching (verse → chorus) switches the entire kit at once — this is how hardware drum machines and Ableton Drum Rack work.

---

## Compression Format

### AI-facing representation

When the AI receives compressed state, a drum rack track looks like:

```
drums (drum-rack, 4 pads, agency ON, approval exploratory):
  pads:
    kick (analog_bass_drum, level 0.8, pan C)
    snare (analog_snare, level 0.75, pan C)
    hat (analog_hat, level 0.6, pan L20, choke 1)
    open-hat (analog_hat, level 0.5, pan L20, choke 1)
  pattern (2 bars, 32 steps):
    kick:     x...o...|x..o....
    snare:    .x.....x|.x.....x
    hat:      hHh.hHh.|hHh.hHh.
    open-hat: .......O|.......O
  detail: { "hat@2.4.3": { offset: +0.05 } }
  legend: x=accent o=hit g=ghost H=loud h=soft O=open .=rest |=bar
  density: 0.6
  processors: [...]
  volume: 0.8, pan: C
```

### Grid notation spec

Each lane is a string of characters, one per 16th-note step. Bar lines (`|`) are visual separators (not counted as steps).

| Character | Meaning | Velocity range | Default velocity |
|-----------|---------|---------------|-----------------|
| `x` | Accent hit | 0.90–1.0 | 0.95 |
| `H` | Loud hit | 0.84–0.89 | 0.88 |
| `O` | Open (for hats, cymbals) | 0.77–0.83 | 0.80 |
| `o` | Normal hit | 0.60–0.76 | 0.75 |
| `h` | Soft hit | 0.40–0.59 | 0.50 |
| `g` | Ghost note | 0.20–0.39 | 0.30 |
| `.` | Rest | — | — |
| `|` | Bar line (visual only) | — | — |

> **Implementation note:** The velocity ranges are non-overlapping and evaluated top-down
> (highest threshold first). Default velocities are the category midpoints used by
> `gridToEvents()` for round-trip fidelity. See `src/engine/drum-grid.ts` for the
> canonical thresholds.

The legend maps characters to velocity categories. It's included in the compressed state so the AI doesn't have to memorize mappings. Different kits can use different legends — the characters are conventions, not fixed protocol.

### Detail map

Events that need per-event precision beyond the grid category use a detail map:

```json
{
  "hat@2.4.3": { "vel": 0.42, "offset": +0.05 },
  "kick@1.2.3": { "vel": 0.72 }
}
```

Keys are `padId@position`. Values override the grid category's default velocity and/or add micro-timing offset. Most events don't need detail entries.

### Why this format

From the AI interface design principles:

- **Rule 3: Make state legible and decision-ready.** The stacked grid lets the AI read vertically to see interlocking parts. "Where are the gaps?" is answered by scanning for `.` characters, not by computing set differences on event position arrays.
- **Rule 7: Constrain to musical dimensions.** Categorical velocity (`x/o/g/h/H/O`) maps to how drummers think — accent, normal, ghost — not to arbitrary 0.0–1.0 floats. The AI's decision is "accent or ghost?" not "0.87 or 0.34?"
- **Round-trip symmetry.** The sketch tool accepts the same grid strings. The AI reads what it writes.

---

## AI Tool Interface

### Sketch (whole kit)

The `sketch` tool gains a `kit` parameter for drum rack tracks:

```json
{
  "type": "sketch",
  "trackId": "drums",
  "kit": {
    "kick":   "x...o...|x..o....",
    "snare":  ".x.....x|.x.....x",
    "hat":    "hHh.hHh.|hHh.hHh.",
    "open-hat": ".......O|.......O"
  },
  "groove": "dnb_break",
  "grooveAmount": 0.6,
  "humanize": 0.1,
  "description": "breakbeat skeleton with driving hats"
}
```

When `kit` is present, it replaces the active pattern's events for the specified pads. Pads not mentioned in `kit` are left unchanged — the AI can sketch just the kick and snare without touching the hats.

Grid strings are parsed into `TriggerEvent[]` with `padId` set. The legend determines velocity mapping. Groove and humanize are applied after parsing, same as existing sketch.

The existing `events` parameter still works for drum rack tracks — the AI can submit raw `TriggerEvent` objects with `padId` for fine-grained control. Grid notation is the ergonomic default; events are the escape hatch.

### Edit (single lane)

The `edit_pattern` tool gains an optional `pad` parameter:

```json
{
  "type": "edit_pattern",
  "trackId": "drums",
  "pad": "hat",
  "operations": [
    { "action": "remove", "step": "1.2.1" },
    { "action": "remove", "step": "1.4.1" },
    { "action": "add", "step": "1.3.4", "event": { "type": "trigger", "velocity": 0.3 } }
  ],
  "description": "drop hats on snare hits, add ghost before beat 4"
}
```

When `pad` is provided, operations are scoped to that pad's events. `remove` at step "1.2.1" removes only the hat trigger at that position, not a kick or snare that might also be there.

### Transform (per-lane)

The `transform` tool gains an optional `pad` parameter:

```json
{
  "type": "transform",
  "trackId": "drums",
  "pad": "hat",
  "operation": "euclidean",
  "hits": 7,
  "velocity": 0.6,
  "description": "euclidean hat pattern"
}
```

Pattern generators operate on one pad at a time. The AI can compose a kit by applying different generators to different pads: euclidean hats, four-on-the-floor kick, snare on 2 and 4.

### Move (per-pad params)

Source parameters on individual pads are addressed as `pad.param`:

```json
{
  "type": "move",
  "trackId": "drums",
  "param": "kick.timbre",
  "target": { "absolute": 0.3 }
}
```

Per-pad level and pan use the same pattern: `"kick.level"`, `"snare.pan"`.

### Set model (per-pad)

Changing a pad's Plaits model:

```json
{
  "type": "set_model",
  "trackId": "drums",
  "pad": "kick",
  "model": "analog_bass_drum"
}
```

### Manage pads

A new tool for adding, removing, and configuring pads:

```json
{
  "type": "manage_drum_pad",
  "trackId": "drums",
  "action": "add",
  "padId": "clap",
  "name": "Clap",
  "model": "analog_snare",
  "chokeGroup": null,
  "description": "add a clap pad"
}
```

Actions: `add`, `remove`, `rename`, `set_choke_group`. Adding a pad mid-session is the expected workflow — the AI builds the kit incrementally.

---

## Audio Engine

### Multi-voice per track

A drum rack track needs N Plaits instances (one per pad), mixed to a single output that feeds the track's processor chain.

Current architecture: each `TrackSlot` in `audio-engine.ts` creates a `VoicePool` with `VOICES_PER_TRACK = 4` voices, all sharing the same model and params.

For drum rack tracks, the voice pool is replaced by a **pad pool**: one voice per pad, each with its own model and params.

```
DrumRack TrackSlot:
  pad[0] (kick)   → PlaitsSynth → padGain(level) → padPanner(pan) ─┐
  pad[1] (snare)  → PlaitsSynth → padGain(level) → padPanner(pan) ──┤
  pad[2] (hat)    → PlaitsSynth → padGain(level) → padPanner(pan) ──┤→ sourceOut
  pad[3] (clap)   → PlaitsSynth → padGain(level) → padPanner(pan) ─┘
      ↓
  chainOutGain → processors → trackVolume → trackPanner → muteGain → mixer
```

Each pad gets:
- Its own `PlaitsSynth` instance (or future source type)
- A `GainNode` for per-pad level
- A `StereoPannerNode` for per-pad pan
- All outputs merge into the shared `sourceOut` node

### Choke groups

When a pad triggers, all other pads in the same choke group receive an immediate gate-off. Implementation:

1. On trigger, check `pad.chokeGroup`
2. If non-null, find all other pads with the same `chokeGroup`
3. Ramp those pads' `accentGain` to zero over `CHOKE_RAMP_TIME` (~5ms to avoid clicks)
4. Send gate-off to their synth instances

This reuses the existing voice-stealing ramp logic in `VoicePool` (the `STEAL_RAMP_TIME = 0.003s` pattern).

### Polyphony within a pad

Some pads may need polyphony — e.g., an open hi-hat that rings while the next hit starts. For v1, each pad is monophonic (one voice). The choke group handles the open/closed hat case. Future: per-pad voice count if needed.

### Resource management

16 pads × 1 voice = 16 Plaits instances per drum rack track. This is within budget — the current system already supports 16 tracks × 4 voices = 64 instances. A typical drum rack (4–8 pads) uses fewer voices than 4 separate tracks would.

---

## Sequencer Integration

### Tracker view

When the active track is a drum rack, the Tracker view shows **lane rows** instead of a single event column:

```
Step | kick | snare | hat  | clap
-----|------|-------|------|------
0    | x    |       | h    |
1    |      | x     | H    |
2    |      |       | h    |
3    |      |       | H    |
4    | o    |       | h    |
...
```

Each lane row is a named pad. Events are displayed as velocity indicators matching the grid notation characters.

### Step grid and projection cache

The current `track.stepGrid` is a single-lane gate/accent/velocity cache — it does not support multi-lane per-pad rendering. For drum rack tracks, the Tracker and step-grid Surface module should **bypass `stepGrid` and render directly from canonical events** in the active pattern, filtered by `padId`.

This is the simpler of two options:

- **Option A (chosen): Bypass stepGrid for drum racks.** The Tracker renderer checks `engine === 'drum-rack'` and projects directly from `pattern.events` grouped by `padId`. The `stepGrid` field is unused (or set to an empty default) for drum rack tracks. This avoids designing a multi-lane cache structure.
- **Option B (deferred): Drum-rack-specific projection cache.** A `DrumStepGrid` type with per-pad lanes, populated by a drum-rack-aware projection function. More performant for large patterns but adds a new cache that must stay synchronised with canonical events. Worth revisiting if rendering performance is a problem.

The existing `stepGrid` projection continues to work unchanged for non-drum-rack tracks.

### Pattern generators

Generators (`euclidean`, `ghost_notes`, `densify`, etc.) operate per-pad when the `pad` parameter is set. Without `pad`, they operate on all events in the pattern (backward compatible for non-drum-rack tracks).

---

## Surface Integration

### Pad grid module

A new Surface module type: `pad-grid`.

```ts
// surface-module-registry.ts addition
{
  type: 'pad-grid',
  name: 'Pad Grid',
  description: 'Drum pad grid with trigger, velocity, and per-pad controls',
  requiredBindings: [
    { role: 'kit', description: 'Drum rack track to bind to' }
  ],
  optionalBindings: [],
  defaultSize: { w: 6, h: 4 },
  minSize: { w: 4, h: 3 },
  maxSize: { w: 8, h: 6 }
}
```

The pad grid renders:
- 4×4 grid of pads (grows with pad count)
- Each cell shows: pad name, activity indicator (lights on trigger)
- Tap to audition (fires the pad's source)
- Long-press or secondary gesture for per-pad level/pan

### Auto-surface

When the AI creates a drum rack track, it should auto-compose a surface with:
- `pad-grid` module (the kit)
- `step-grid` module (the pattern for the selected pad)
- `knob-group` module (source params for the selected pad)

This follows the readiness rule from the Surface north-star RFC: `pad-grid` is a projection of existing canonical state (drum rack config + pattern events), not new engine logic.

---

## Undo

### Granularity

Drum rack operations use existing snapshot types where the existing type's scope matches. Where it doesn't — specifically for per-pad state that lives inside `DrumPad.source.params`, not in `track.params` — a new snapshot type is needed.

| Operation | Snapshot type | What's captured |
|-----------|--------------|-----------------|
| Sketch (kit) | `PatternSnapshot` | Previous events for all affected pads |
| Edit (single pad) | `PatternEditSnapshot` | Previous events (scoped to pad) |
| Move (pad param) | New: `DrumPadSnapshot` | Previous pad list (includes source params) |
| Move (pad level/pan) | `DrumPadSnapshot` | Previous pad list |
| Add/remove pad | `DrumPadSnapshot` | Previous pad list |
| Set pad model | `DrumPadSnapshot` | Previous pad list (includes model + params) |
| Choke group change | `DrumPadSnapshot` | Previous pad list |

### New snapshot type

```ts
interface DrumPadSnapshot {
  kind: 'drum-pad';
  trackId: string;
  prevPads: DrumPad[];
  timestamp: number;
  description: string;
}
```

Added to the `Snapshot` union type. Revert restores `track.drumRack.pads` to `prevPads`.

**Why a single snapshot type for all pad mutations:** Per-pad state (source params, level, pan, model, choke group) all lives inside the `DrumPad` object, which is nested inside `track.drumRack.pads`. The existing `ParamSnapshot` assumes params live at `track.params` and `ModelSnapshot` assumes model lives at `track.model` — neither addresses the nested pad structure. Rather than adding `padId` to every existing snapshot type, a single `DrumPadSnapshot` captures the entire pad list before any mutation.

**Grouping rule:** Each discrete pad mutation action creates its own `DrumPadSnapshot` at the point of mutation, before any state changes. This means undoing `kick.timbre` reverts the pad list to the state immediately before that specific `kick.timbre` change — not to some earlier point. The coarseness is per-action, not per-session: if an AI turn contains `move kick.timbre` followed by `move snare.decay`, each gets its own snapshot (grouped into a single `ActionGroupSnapshot` for the turn, as with all AI actions). Undoing the turn reverts both; undoing individual moves within a turn is not supported (consistent with existing undo granularity).

The pad list is small (max 16 entries), so snapshotting the entire list per mutation is cheap. If per-param granularity proves necessary, a `DrumPadParamSnapshot` with `padId` + `prevParams` can be introduced later.

---

## Validation

### Invariants

1. **Pad IDs are unique within a drum rack.** Duplicate pad IDs are rejected.
2. **Events in drum rack patterns must have `padId`.** Triggers without `padId` in a drum rack track are rejected during sketch/edit validation.
3. **`padId` must reference an existing pad.** Events targeting a removed pad are invalid.
4. **Max 16 pads per drum rack (v1).** Soft cap, same as `MAX_TRACKS`.
5. **Choke groups are integers ≥ 1.** Null means no choke group.
6. **Grid strings must match pattern length.** A 2-bar, 4/4 pattern expects 32 characters (plus bar lines). Mismatched lengths are rejected.

### Agency

Agency (`OFF`/`ON`) applies at the track level, not per-pad. If the drum rack track has agency OFF, no AI operations affect any pad.

---

## Migration

### No breaking changes

Existing tracks are unaffected. A drum rack is created fresh via `add_track` or a new `manage_drum_pad` action. No migration of existing state is needed.

### Creation flow

```json
[
  { "type": "add_track", "kind": "audio", "label": "Drums", "description": "drum rack" },
  { "type": "set_model", "trackId": "drums", "model": "drum-rack" },
  { "type": "manage_drum_pad", "trackId": "drums", "action": "add", "padId": "kick", "name": "Kick", "model": "analog_bass_drum" },
  { "type": "manage_drum_pad", "trackId": "drums", "action": "add", "padId": "snare", "name": "Snare", "model": "analog_snare" },
  { "type": "manage_drum_pad", "trackId": "drums", "action": "add", "padId": "hat", "name": "Hat", "model": "analog_hat" }
]
```

Or: a single `add_track` variant that creates a drum rack with initial pads.

---

## Generalisation: Role-Aware Compression

The grid notation format was designed for drum racks, but the underlying principle — compress state in the shape the AI naturally reasons about — applies to all track types. AI interviews produced spontaneously different notations for bass (tracker rows with pitch + duration), pads (chord blocks with voice-leading), and plucked riffs (motif cells with accent patterns).

The full analysis, proposed formats, epistemic caveats, hypothesis testing protocol, and staged implementation plan live in a separate document: **`docs/briefs/role-aware-compression.md`**.

This RFC implements Stage 1 of that plan: percussion grid strings and drum rack stacked lanes. The melodic formats (bass, pad, pluck) are validated and shipped separately per the brief's gated approach.

---

## Implementation Plan

Work is structured as a dependency chain. Each phase produces a testable increment. Phases 1–3 form the minimum viable drum rack (AI can create, program, and hear a kit). Phases 4–6 add UI and polish.

### Phase 1: Types and data model

**Goal:** All drum rack types exist. Existing tests still pass.

| # | Task | Files | Depends on |
|---|------|-------|------------|
| 1a | Add `DrumPad`, `DrumRackConfig` interfaces | `src/engine/types.ts` | — |
| 1b | Add optional `padId: string` to `TriggerEvent` | `src/engine/canonical-types.ts` | — |
| 1c | Add optional `drumRack: DrumRackConfig` to `Track` | `src/engine/types.ts` | 1a |
| 1d | Add `DrumPadSnapshot` to `Snapshot` union | `src/engine/types.ts` | 1a |
| 1e | Add `DrumPadSnapshot` revert logic to `revertSnapshot()` | `src/engine/primitives.ts` | 1d |
| 1f | Add grid string serialiser/parser module | New: `src/engine/drum-grid.ts` | 1b |
| 1g | Unit tests for grid serialiser/parser round-trip | `tests/engine/drum-grid.test.ts` | 1f |

**Verification:** `npx tsc --noEmit` passes. `npx vitest run` passes. Grid round-trip tests pass.

### Phase 2: Audio engine

**Goal:** A drum rack track produces sound. Each pad plays its own Plaits model. Choke groups work.

| # | Task | Files | Depends on |
|---|------|-------|------------|
| 2a | Add drum rack voice management — per-pad Plaits instance, padGain, padPanner, mix to sourceOut | `src/audio/audio-engine.ts` | 1a, 1c |
| 2b | Route triggers with `padId` to the correct pad's synth | `src/audio/audio-engine.ts` | 2a, 1b |
| 2c | Implement choke group logic — gate-off + gain ramp for same-group pads on trigger | `src/audio/audio-engine.ts` | 2a |
| 2d | Handle pad add/remove at runtime — create/destroy synth instances, reconnect audio graph | `src/audio/audio-engine.ts` | 2a |
| 2e | Per-pad param changes (`kick.timbre` etc.) route to the correct synth instance | `src/audio/audio-engine.ts` | 2a |

**Verification:** Create a drum rack track programmatically, trigger pads, hear distinct sounds. Choke group silences open hat on closed hat trigger. Manual audio test (or scripted with offline render).

### Phase 3: AI tools and execution

**Goal:** The AI can create a drum rack, add pads, sketch patterns with grid notation, edit individual lanes, and change per-pad params. Full undo coverage.

| # | Task | Files | Depends on |
|---|------|-------|------------|
| 3a | Add `manage_drum_pad` tool schema (add/remove/rename/set_choke_group) | `src/ai/tool-schemas.ts` | 1a |
| 3b | Add `manage_drum_pad` execution + `DrumPadSnapshot` undo | `src/engine/operation-executor.ts` | 1d, 1e, 3a |
| 3c | Add `kit` parameter to `sketch` tool schema (record of lane grid strings) | `src/ai/tool-schemas.ts` | 1f |
| 3d | Add grid-based sketch execution — parse grid strings, tag events with `padId`, store in pattern | `src/engine/operation-executor.ts`, `src/engine/primitives.ts` | 1f, 3c |
| 3e | Add `pad` parameter to `edit_pattern` — scope operations to one pad's events | `src/ai/tool-schemas.ts`, `src/engine/operation-executor.ts` | 1b |
| 3f | Add `pad` parameter to `transform` — scope generators to one pad | `src/ai/tool-schemas.ts`, `src/engine/operation-executor.ts` | 1b |
| 3g | Extend `move` for per-pad params (`kick.timbre`, `snare.level`) | `src/engine/operation-executor.ts` | 1a |
| 3h | Extend `set_model` with `pad` parameter for per-pad model changes | `src/engine/operation-executor.ts` | 1a |
| 3i | Add validation: `padId` required on drum rack triggers, `padId` must reference existing pad, max 16 pads, grid length matches pattern | `src/engine/operation-executor.ts` | 1a, 1b, 1f |
| 3j | Integration tests: full AI action sequence (create rack → add pads → sketch kit → edit lane → undo) | `tests/engine/drum-rack-actions.test.ts` | 3a–3i |

**Verification:** All tests pass. A scripted action sequence creates a drum rack, sketches a beat with grid notation, edits a single lane, and undoes cleanly.

### Phase 4: State compression

**Goal:** The AI reads stacked grid lanes in compressed state. Round-trip: compress → AI reads → AI writes grid → parse → events match.

| # | Task | Files | Depends on |
|---|------|-------|------------|
| 4a | Add drum-rack-aware branch in `compressPattern()` — group events by `padId`, emit per-lane grid strings | `src/ai/state-compression.ts` | 1f |
| 4b | Add pad metadata to compressed track (pad names, models, levels, pans, choke groups) | `src/ai/state-compression.ts` | 1a |
| 4c | Add legend and detail map to compressed output | `src/ai/state-compression.ts` | 4a |
| 4d | Update system prompt — drum rack format description, grid notation spec, tool usage examples | `src/ai/system-prompt.ts` | 4a, 4b |
| 4e | Update AI contract docs | `docs/ai/ai-contract.md` | 4d |
| 4f | Round-trip tests: compress a drum rack pattern → parse the grid strings back → events match | `tests/ai/drum-rack-compression.test.ts` | 4a, 1f |

**Verification:** Compressed state for a drum rack track shows stacked grid lanes. Round-trip tests pass.

### Phase 5: UI

**Goal:** Drum rack tracks are visible and interactive in the Tracker and Surface views.

| # | Task | Files | Depends on |
|---|------|-------|------------|
| 5a | Register `pad-grid` module type in surface module registry | `src/engine/surface-module-registry.ts` | — |
| 5b | Add `pad-grid` to `set_surface` tool schema enum | `src/ai/tool-schemas.ts` | 5a |
| 5c | Implement `PadGridModule` renderer — 4×4 grid, pad names, activity indicators, tap-to-audition | `src/ui/surface/PadGridModule.tsx` | 5a |
| 5d | Register renderer in `SurfaceCanvas.tsx` | `src/ui/surface/SurfaceCanvas.tsx` | 5c |
| 5e | Tracker: detect drum rack tracks, render lane columns (bypass stepGrid, project from canonical events) | `src/ui/tracker/` (tracker components) | 1b |
| 5f | Add auto-surface template for drum rack tracks (pad-grid + step-grid + knob-group) | `src/engine/surface-templates.ts` | 5a, 5b |
| 5g | Visual verification with Playwright — create drum rack, screenshot, compare | — | 5c, 5e |

**Verification:** Playwright screenshots show pad grid in Surface and lane columns in Tracker.

### Phase 6: End-to-end validation

**Goal:** The full drum rack workflow works from AI conversation through to audio output.

| # | Task | Files | Depends on |
|---|------|-------|------------|
| 6a | End-to-end test: AI conversation creates a drum rack, programs a beat, the human hears it | Manual or scripted | All phases |
| 6b | Test with Gluon's AI: "build me a breakbeat" → verify it uses grid notation and drum rack tools | Manual | 4d |
| 6c | Regression: run full test suite, verify no existing tests break | `npx vitest run` | All phases |
| 6d | Consolidation: review for dead code, unnecessary abstractions, doc consistency | — | All phases |

---

## Scope Boundaries

### In scope (v1)

- Drum rack as source type (`engine: 'drum-rack'`)
- Up to 16 pads per rack, growable mid-session
- Per-pad: source (Plaits model + params), level, pan, choke group
- Named trigger lanes with grid notation
- Kit-level sketch + per-lane edit/transform
- Choke groups
- Pad grid Surface module
- Tracker lane view

### Explicitly out of scope

- **Per-pad processor chains** — use separate tracks for per-voice effects
- **Per-pad modulation** — track-level modulators only
- **Per-pad patterns** — all pads share the track's pattern containers
- **Sample playback** — sampler is a future source type; drum rack is source-agnostic and will support it when it arrives
- **MIDI note mapping** — internal addressing uses padId, not MIDI notes. MIDI mapping is a future integration concern.
- **Velocity layers** — per-pad sample switching by velocity is a sampler feature, not a drum rack feature
- **Generalised role-aware compression** — this RFC proves the pattern; generalisation is a separate issue

---

## Open Questions

1. **Grid notation for non-4/4 time signatures.** The grid assumes 16th-note resolution. A 3/4 bar is 12 characters; 7/8 is 14. Bar lines help readability, but the AI needs to know the grid resolution. Should the legend include step resolution?

2. **Pad ordering.** Should pads have a fixed display order, or should the AI/human be able to reorder them? Reordering affects the stacked grid readability.

3. **Default pads on creation.** Should `add_track` with `model: 'drum-rack'` create a default kit (kick, snare, hat), or should the AI always add pads explicitly? A default kit is faster; explicit is more flexible.

4. **Grid resolution.** 16th notes are standard for most genres, but some patterns need 32nd notes (fast hi-hat rolls, dnb breaks). Should grid resolution be configurable per lane or per pattern?

---

## Acceptance Criteria

1. A drum rack track with 4+ pads plays through the audio engine with correct per-pad source, level, and pan.
2. Choke groups work: triggering a closed hat silences the open hat.
3. The AI can sketch a full kit using grid notation and receive the same format in compressed state.
4. Per-lane `edit_pattern` and `transform` work without affecting other pads.
5. The Tracker view shows drum lanes.
6. The `pad-grid` Surface module renders and responds to taps.
7. Undo correctly reverts drum rack operations (pad add/remove, sketch, param changes).
8. No existing tests break — drum rack is additive.
