# Gluon RFC: View Architecture & Surface Module Library

## Status

Draft RFC for architectural alignment.

Related docs:

- `docs/rfcs/ai-curated-surfaces.md` — semantic controls, surface state, AI curation operations
- `docs/rfcs/canonical-musical-model.md` — canonical data model (ControlSchema, Region, MusicalEvent, SourceAdapter)
- `docs/rfcs/sequencer-view-layer.md` — sequencer views as addable projections
- `docs/design-references.md` — design references from synths, DAWs, and related tools
- `docs/principles/ai-interface-design-principles.md` — AI interface posture

---

## Product Thesis

Gluon has four views. Three of them are **canonical views** — structural representations of the underlying data model. One is a **custom view** — a blank canvas composed from a library of UI modules.

The canonical views give the human deep-dive access to everything the AI can touch. They are the debugger, the inspector, the ground truth. The custom view gives the human (and AI) the ability to build a musically meaningful control surface tailored to each track's role. It is the instrument panel, the performance interface, the designed experience.

This distinction is the central architectural decision. The canonical views are determined by the data; the Surface is determined by the musician.

---

## The Four Views

### Three Canonical Views

Canonical views are projections over the data model. Given a track's data, the view is structurally determined — there is no curation, no composition, no AI opinion about what to show. They show everything.

#### Tracker

Event-level ground truth. Shows the contents of a track's regions as a scrollable event list — every note, trigger, and parameter event with exact timing, pitch, velocity, and duration. The Renoise/Ableton-style tracker grid.

- **Scope:** Per-track (switches with track selection)
- **Data source:** `track.regions[].events[]`
- **What it exposes:** Musical event programming — the same data the AI's `sketch` operation writes
- **Human capability:** The human can see, edit, add, and delete every event the AI can write
- **Reference:** Renoise, Dirtywave M8

#### Rack

Parameter-level ground truth. A vertical stack of module panels in chain order (source at top, processors below, modulators at bottom), each exposing every knob for that module via its ControlSchema. The Guitar Rig / Reason rack model.

- **Scope:** Per-track (switches with track selection)
- **Data source:** `track.source`, `track.chain[]`, `track.modulators[]`, each module's `ControlSchema[]` and `ControlState`
- **What it exposes:** Every parameter the AI's `move` and `set_processor_param` operations can change
- **Human capability:** The human can see and adjust every parameter the AI can touch
- **Reference:** Guitar Rig (NI), Reason rack

#### Patch

Topology-level ground truth. A node graph showing how modules are connected — signal flow, modulation routing, and (eventually) cross-track sends and sidechains. The Max/MSP model where everything is a node and connections are first-class edges.

- **Scope:** Per-track by default, with a global view available for cross-track routing
- **Data source:** `track.source`, `track.chain[]`, `track.modulators[]`, `track.modulations[]`, and (future) project-level `routes[]`
- **What it exposes:** Signal chain topology and modulation routing — the same structure the AI's `add_processor`, `remove_processor`, `connect_modulator`, and (future) routing operations modify
- **Human capability:** The human can inspect and (with interactive editing) modify the wiring the AI built
- **Per-track mode:** Shows one track's chain as a left-to-right flow with modulation edges
- **Global mode:** Shows all tracks with cross-track routing (sends, sidechains). The only view that breaks the per-track boundary
- **Reference:** Max/MSP, PureData, Cables.gl

### One Custom View

#### Surface

A blank canvas. Nothing is hard-coded at the beginning. The AI (and/or human) composes an interface from a library of **surface modules** — self-contained UI building blocks that each bind to specific data on the track.

- **Scope:** Per-track, plus a **performance mode** that spans all tracks
- **Data source:** Whatever the placed modules bind to — controls, regions, cross-track relationships
- **What it exposes:** A curated, musically meaningful subset of the track's capabilities, abstracted into controls that match the track's musical role

The Surface is where Gluon's AI-native advantage lives. Traditional instruments have fixed control panels designed once by a hardware engineer. Gluon's Surface is designed by the AI for each track, each session, each musical context. A kick drum track gets a step sequencer and a tone control. A poly synth gets a piano roll and ADSR. A monosynth chained to effects gets a composite control that makes that combination modifiable in musically coherent ways.

The Surface is also where the human can build their own performance interface — pinning controls from different tracks, creating macro knobs that span the project, building the mixing desk they actually want.

**Per-track Surface:** The AI configures a set of surface modules appropriate for the track's current role, source, and chain. When the chain changes, the surface updates. The human can override, rearrange, or rebuild it.

**Performance Surface:** A cross-track view where the human (or AI) composes a global performance interface. Mixer strips from all tracks, macro knobs that affect multiple tracks ("darken everything"), transport controls, and cross-track relationship displays. This is the live performance view.

---

## Why This Split Matters

The canonical views and the Surface serve different cognitive tasks:

| | Canonical Views | Surface |
|---|---|---|
| **Purpose** | Inspection, debugging, full access | Performance, composition, musical control |
| **Content** | Determined by data | Designed by AI/human |
| **Completeness** | Shows everything | Shows what matters |
| **Stability** | Changes only when data changes | Changes when the musical context changes |
| **AI role** | None (views are structural) | AI composes the interface |

The human uses canonical views to understand what's happening. They use the Surface to *do things* musically. The canonical views build trust (the human can always verify what the AI did). The Surface builds flow (the human can act without navigating implementation details).

---

## Surface Module Library

Surface modules are the atomic building blocks the AI composes into a Surface. Each module is a self-contained UI component that binds to specific data on one or more tracks.

### Design Principles for Surface Modules

1. **Each module solves one musical control problem.** A step grid solves rhythmic programming. An XY pad solves timbral exploration. A macro knob solves dimensional reduction. Modules do not try to be general-purpose.

2. **Modules bind to data, not to specific implementations.** A step grid binds to `region.events[]`, not to "Plaits triggers." An ADSR editor binds to four control IDs, not to "the Plaits envelope." This means the same module type works across different sources and processors.

3. **Modules are composable.** The AI places multiple modules on a Surface. Their arrangement is the designed interface. No single module needs to do everything — the composition is the instrument panel.

4. **Modules range from standard to experimental.** The library includes both proven building blocks (step grids, knob groups) and novel controls (tension arcs, probability fields) that explore what's possible when a screen is the control surface and an AI is the designer.

### Module Interface

Every surface module conforms to a common interface so the AI can place and configure them uniformly:

```ts
interface SurfaceModule {
  type: string;                    // module type from the registry
  id: string;                      // unique instance ID
  label: string;                   // human-readable label
  bindings: ModuleBinding[];       // what data this module connects to
  position: { x: number; y: number; w: number; h: number };  // grid placement
  config: Record<string, unknown>; // module-type-specific configuration
}

interface ModuleBinding {
  role: string;                    // module-defined binding role: 'x-axis', 'velocity', 'cutoff', 'state-a'
  trackId: string;                 // which track this binding targets
  target: string;                  // controlId, regionId, or semantic reference
}
```

The AI's `set_surface` operation becomes: "here is a list of modules, their bindings, and their positions." The human can drag, resize, rebind, or remove any of them.

---

### Event Programming Modules

Modules for composing and editing temporal musical content.

#### Step Grid

TR-style gate/velocity/accent row. The canonical drum programming interface.

- **Binds to:** A region's trigger/note events
- **Controls:** Gate on/off, velocity, accent per step. Optional: per-step parameter locks
- **When to place:** Drum and percussion tracks, rhythmic parts, any track where patterns are primarily trigger-based
- **Size:** Wide and short (full width, 1-2 grid rows)
- **Reference:** Roland TR-808/909, Elektron step sequencer, Ableton Push drum mode

#### Piano Roll

Pitch × time note editor. The canonical melodic programming interface.

- **Binds to:** A region's note events
- **Controls:** Note pitch, start time, duration, velocity. Vertical axis is pitch, horizontal is time
- **When to place:** Melodic and harmonic tracks — synths, bass lines, chord parts
- **Size:** Wide and tall (needs vertical space for pitch range)
- **Reference:** Every DAW piano roll

#### Automation Lane

Breakpoint envelope for one parameter over time. Draw curves that shape a parameter across the loop.

- **Binds to:** A single control ID + a region (parameter events over time)
- **Controls:** Breakpoint positions, curve shape between points (step, linear, curve)
- **When to place:** When a parameter needs per-bar shaping — filter sweeps, volume swells, effect wet/dry over time
- **Size:** Wide and short (full width, 1-2 grid rows). Multiple lanes can stack vertically
- **Reference:** DAW automation lanes, Ableton envelope view

#### Probability Row

Per-step firing probability and conditional triggers.

- **Binds to:** A region's events (probability metadata per event)
- **Controls:** Probability percentage per step, optional condition type (1st play, fill, nth time)
- **When to place:** Generative or evolving patterns — hi-hats with humanisation, fills that appear conditionally, textures that breathe
- **Size:** Wide and short (pairs with a step grid)
- **Reference:** Elektron trig conditions, Bitwig note chance

---

### Parameter Control Modules

Modules for adjusting synthesis and processing parameters.

#### Knob Group

A bank of labelled knobs. The universal parameter surface — the NKS/Push "page of 8" pattern.

- **Binds to:** N control IDs (typically 4-8)
- **Controls:** One rotary knob per parameter with label, value, and range
- **When to place:** Default for exposing a curated set of parameters. The AI labels them musically ("Brightness", "Body", "Decay") not technically ("Timbre", "Harmonics", "Morph")
- **Size:** Flexible — 4 knobs in a row, or 2×4 grid
- **Config:** Number of knobs, layout (row vs grid)
- **Reference:** Ableton macro knobs, Bitwig remote controls, Elektron parameter pages, NKS pages

#### XY Pad

2D continuous control. Position maps to two parameters simultaneously.

- **Binds to:** Two control IDs (x-axis and y-axis)
- **Controls:** Continuous X/Y position, with axis labels
- **When to place:** Timbral exploration (brightness × texture), spatial control, performance gestures. Most useful when the two parameters interact musically
- **Size:** Square, medium to large
- **Config:** Axis labels, optional snap-to-centre, optional trail visualisation
- **Reference:** Korg Kaoss Pad, Gluon's existing parameter space

#### ADSR Editor

Draggable multi-segment envelope shape. Four to six parameters rendered as one interactive curve.

- **Binds to:** Four control IDs (attack, decay, sustain, release) on a specific module
- **Controls:** Draggable breakpoints for each envelope stage. Visual shape updates in real time
- **When to place:** Any track with an amplitude or filter envelope — synth pads, plucked sounds, anything where the temporal shape of the sound matters
- **Size:** Medium width, short height
- **Reference:** Serum/Vital envelope editors, hardware synth envelope displays

#### Filter Display

Cutoff + resonance with a visual frequency response curve. The display IS the control.

- **Binds to:** Two or three control IDs (cutoff, resonance, optional filter type)
- **Controls:** Draggable cutoff point on frequency axis, draggable resonance peak height. Visual shows the resulting filter curve
- **When to place:** Any track with filter processing — subtractive synths, filtered drums, effect chains with filters
- **Size:** Medium width, short to medium height
- **Reference:** FabFilter Pro-Q, Serum filter display, Ableton EQ Eight

#### Macro Knob

Single knob that maps to weighted contributions from multiple raw controls. The physical manifestation of a semantic control.

- **Binds to:** Multiple control IDs with weights and transforms (the `SemanticControlDef` from the curated surfaces RFC)
- **Controls:** One rotary control that fans out to multiple underlying parameters
- **When to place:** When a track has a chain with enough parameters that direct control is overwhelming. The AI defines the mapping based on musical meaning ("Space" = Clouds mix × 0.5 + Clouds size × 0.3 + Rings damping × 0.2)
- **Size:** Small (single knob with label)
- **Config:** Weight mapping, transform types (linear, inverse, bipolar)
- **Reference:** Ableton rack macros, Reason Combinator knobs

#### Toggle Bank

Row of on/off switches for binary states.

- **Binds to:** N boolean control IDs or module-level states
- **Controls:** Labelled toggle buttons
- **When to place:** Module bypass controls, mode selection, step mutes, layer enables
- **Size:** Compact row
- **Reference:** Ableton device on/off, Elektron function buttons

#### Model Selector

Visual engine/waveform picker. Discrete selection of the fundamental sound source.

- **Binds to:** Source engine selection (categorical)
- **Controls:** Visual grid or strip of available models with icons/labels. Selection changes the active synthesis model
- **When to place:** When the track's source has multiple models (Plaits has 16) and switching between them is a musically relevant action
- **Size:** Compact strip or small grid
- **Reference:** Plaits model selector, OP-1 engine screens

---

### Visualisation Modules

Modules that display information, some interactive.

#### Level Meter

Signal level display (peak, RMS, or both).

- **Binds to:** Track audio output (read-only)
- **Controls:** None (read-only visualisation)
- **When to place:** Mixing contexts, gain staging, performance view
- **Size:** Narrow vertical bar
- **Reference:** Every mixer channel strip

#### Waveform Display

Time-domain signal shape. Static (sample) or live (output monitoring).

- **Binds to:** Track audio output or sample data (read-only)
- **Controls:** Read-only, or interactive with playback position / loop markers for sample-based tracks
- **When to place:** Sample-based tracks, monitoring, visual identity
- **Size:** Wide and short
- **Reference:** Ableton clip view, sampler displays

#### Spectrum View

Frequency content display (FFT). Shows where the track's energy sits in the frequency spectrum.

- **Binds to:** Track audio output (read-only)
- **Controls:** Read-only visualisation. Optionally interactive when paired with a filter display
- **When to place:** When frequency masking between tracks is a concern, mixing decisions, EQ work
- **Size:** Medium width, short to medium height
- **Reference:** Voxengo SPAN, FabFilter Pro-Q analyser overlay

---

### Composite Modules

Modules that combine multiple concerns into one integrated surface.

#### Mixer Strip

Level + pan + mute/solo for one track. The canonical mixing control.

- **Binds to:** Track level, pan, mute, solo controls
- **Controls:** Vertical fader (level), knob (pan), buttons (mute, solo), meter (level)
- **When to place:** Performance view (cross-track). Rarely placed on per-track Surface — the track sidebar already handles this
- **Size:** Narrow and tall (vertical strip)
- **Reference:** Every mixing console and DAW mixer

#### Chain Strip

Compact effects chain visualisation with per-module bypass toggles.

- **Binds to:** `track.chain[]` — processor list and enable states
- **Controls:** Module name labels in chain order, bypass toggle per module, optional click-to-focus for quick parameter access
- **When to place:** Tracks with processors, as a compact overview of the signal chain
- **Size:** Wide and short (horizontal strip)
- **Reference:** Ableton device chain, Bitwig device lane

---

### Experimental / Non-Standard Modules

Modules that explore what's possible when a screen is the control surface and an AI is the designer. These go beyond what hardware controllers can offer.

#### Vector Pad

4-corner blend. Position in a 2D space controls the mix between four distinct parameter states. Each corner represents a saved configuration; the pad interpolates between them.

- **Binds to:** Four sets of parameter snapshots (states A, B, C, D) across multiple control IDs
- **Controls:** 2D position that blends between four corner states. Corners are labelled with their musical character
- **When to place:** Tracks with rich timbral variation — when the AI identifies four meaningfully different parameter regions worth exploring. Performance contexts where smooth morphing between states is musically useful
- **Config:** The four corner states (parameter snapshots), corner labels
- **Reference:** Sequential Prophet VS vector synthesis, Bitwig Vector-4 modulator, Korg Wavestation vector joystick

#### Orbit

A point that moves through an XY parameter space on a defined path. The path shape, speed, and centre are the controls — not the current position.

- **Binds to:** Two control IDs (same as XY pad) plus modulation rate and path shape
- **Controls:** Path editor (shape: circle, ellipse, figure-8, random walk), orbit speed (free or tempo-synced), centre position, orbit radius. The point moves continuously, sweeping the two parameters
- **When to place:** Evolving textures, generative timbral movement, pads and drones where continuous parameter motion is the musical intent. Replaces manual knob-turning for slow sweeps
- **Config:** Path shape, speed, sync mode, radius, centre
- **Reference:** Buchla 252e concept (generative movement through control space), Lemur MultiBall physics mode

#### Tension Arc

A single horizontal curve representing energy/tension over the loop length. The human drags the curve; the system interprets the shape into concrete parameter changes across the pattern.

- **Binds to:** Multiple control IDs + region events. The arc is a musical intent that the system maps to density, velocity distribution, brightness, and other parameters
- **Controls:** Draggable bezier curve spanning the loop length. Vertical axis is "tension" (abstract). The system redistributes event density, velocity, timbral brightness, and other parameters to match the shape
- **When to place:** When the human (or AI) wants to shape the energy contour of a pattern without manually adjusting individual steps. Composition-level control over a loop's arc
- **Config:** Which parameters the tension mapping affects, mapping weights
- **Reference:** Novel. Closest analogues: Ableton's velocity/probability drawing tools, but operating at a higher level of musical abstraction

#### Morph Slider

Interpolates between two saved parameter states (A and B). The slider position blends all mapped parameters between the two snapshots.

- **Binds to:** Two parameter snapshots (state A and state B) across multiple control IDs
- **Controls:** Single horizontal slider. At 0% = state A, at 100% = state B, intermediate positions interpolate all parameters linearly
- **When to place:** When the AI identifies two distinct timbral characters worth moving between — a "dark" and "bright" version of the same sound, a "dry" and "wet" version. Performance morphing
- **Config:** State A snapshot, state B snapshot, per-parameter interpolation curves (optional)
- **Reference:** Ableton crossfader between racks, Elektron sound locks, morphing synth presets

#### Constraint Surface

Makes the AI's permission boundaries tangible and editable. Shows which parameters the AI can and cannot change, with draggable range boundaries.

- **Binds to:** Track agency state, preservation contracts (future), parameter range constraints
- **Controls:** Visual display of parameter ranges with draggable min/max boundaries. Parameters outside the allowed range are visually locked. The human can widen or narrow the AI's operating range per parameter
- **When to place:** When the human wants fine-grained control over what the AI is allowed to touch — beyond the binary agency OFF/ON. Refinement and preservation contexts
- **Config:** Which parameters to display, initial range constraints
- **Reference:** Novel. Makes the collaboration contract (preservation contracts RFC) into a direct manipulation interface

#### Relationship Display

Shows how this track relates to another track musically — frequency overlap, rhythmic alignment, sidechain coupling, masking regions.

- **Binds to:** Two track IDs (read-only cross-track analysis, or interactive for routing parameters)
- **Controls:** Read-only visualisation of cross-track relationships. Optionally interactive: drag to increase/decrease coupling (e.g., sidechain depth, frequency separation target)
- **When to place:** When the AI detects interaction between tracks (kick/bass frequency competition, rhythmic alignment issues). Performance view for mix relationships
- **Config:** Which relationship dimensions to show (frequency, rhythm, dynamics)
- **Reference:** Novel. Closest analogues: sidechain visualisation in mixing plugins, iZotope Relay inter-plugin communication

#### Gesture Recorder

Record a knob movement as a reusable shape. The gesture becomes a stored curve that can be applied to any parameter as an automation lane or modulation source.

- **Binds to:** One control ID (source for recording) + one or more control IDs (targets for playback)
- **Controls:** Record button, gesture display (time-domain curve of the recorded movement), apply-to-target selector. The recorded gesture loops at the region length
- **When to place:** When the human demonstrates a parameter movement by hand and wants to reuse it. Capturing performance gestures as reusable modulation
- **Config:** Loop mode (one-shot, loop, ping-pong), time stretch, target mapping
- **Reference:** Buchla "stored program" concept (parameter movements as data), Lemur physics-based gesture recording

#### Probability Field

2D field where position sets probability distributions for two parameters simultaneously. Not a fixed value but a *tendency* — the actual values drift around the set point.

- **Binds to:** Two control IDs (same as XY pad) but with probability distribution parameters (spread, bias)
- **Controls:** 2D position sets the centre of the probability distribution. Radius sets the spread (how far values can drift from centre). Shape sets the distribution (gaussian, uniform, biased)
- **When to place:** Generative/evolving textures, ambient pads, any sound that should breathe and shift rather than stay fixed. The AI places this when controlled randomness is musically appropriate
- **Config:** Distribution shape, spread range, update rate (how often new random values are generated)
- **Reference:** Buchla Source of Uncertainty meets XY pad. The module makes controlled randomness a first-class musical control

---

### Performance View Modules

Modules designed for the cross-track performance Surface.

#### Mixer Strip Bank

Level/pan/mute/solo for all tracks in a compact horizontal or vertical layout.

- **Binds to:** All tracks' level, pan, mute, solo controls
- **Size:** Full width, medium height (horizontal) or full height, medium width (vertical)

#### Cross-Track Macro

Single knob mapped to parameters across multiple tracks. Project-wide musical gestures.

- **Binds to:** Multiple control IDs across multiple tracks with weights
- **Controls:** One rotary control with a musical label ("Darken Everything", "Increase Chaos", "Strip Back")
- **When to place:** When the AI identifies a cross-track musical gesture that the human would benefit from controlling as a single action
- **Reference:** Ableton rack macros (but cross-track), DJ mixer effects knobs

#### Tension Arc (Global)

Same as per-track Tension Arc, but spanning all tracks. Shapes the energy contour of the entire piece.

- **Binds to:** Multiple parameters across all tracks
- **Controls:** Draggable curve representing overall energy/tension over time

#### Relationship Matrix

Shows all cross-track dependencies in one view — sidechain routing, frequency masking, rhythmic alignment.

- **Binds to:** All tracks (read-only analysis + interactive routing controls)
- **Controls:** NxN matrix where each cell shows the relationship between two tracks. Interactive cells for routing parameters (sidechain depth, send level)

---

## AI Surface Composition

The AI composes a Surface by selecting modules from the library, configuring their bindings, and placing them on the canvas. This is the `set_surface` operation from the curated surfaces RFC, extended to work with the module library.

### Example: Kick Drum Track

```
Surface for KICK:
┌──────────────────────────────────────────────┐
│  [Step Grid]        ████ ░░░░ ████ ░░░░      │  binds to: default region triggers
│                     ████ ░░░░ ████ ░░░░      │
├──────────────────────────────────────────────┤
│  [Knob Group: "Tone"]                        │  binds to: brightness, body, decay
│  ◉ Punch   ◉ Tone   ◉ Tail                  │
├──────────────────────────────────────────────┤
│  [Probability Row]  100% 100% 80% 100%       │  binds to: per-step probability
└──────────────────────────────────────────────┘
```

### Example: Poly Synth Track

```
Surface for PAD:
┌─────────────────────────────────────────────────────┐
│  [Piano Roll]                                       │
│  ───█████──────                                     │
│  ──────████████                                     │
│  █████─────────                                     │
├────────────────────────────┬────────────────────────┤
│  [ADSR Editor]             │  [XY Pad]              │
│  /\___________             │  Warmth ×              │
│ /             \____        │         × current pos  │
│                            │                 Space  │
├────────────────────────────┴────────────────────────┤
│  [Knob Group: "Character"]                          │
│  ◉ Warmth  ◉ Movement  ◉ Space  ◉ Shimmer          │
└─────────────────────────────────────────────────────┘
```

### Example: Monosynth + Effects Chain

```
Surface for LEAD:
┌─────────────────────────────────────────────────────┐
│  [Piano Roll]                                       │
├──────────────────────┬──────────────────────────────┤
│  [Filter Display]    │  [Morph Slider]              │
│  ╱‾‾‾‾╲             │  Clean ◄━━━━●━━━━► Saturated │
│ ╱      ╲            │                              │
├──────────────────────┴──────────────────────────────┤
│  [Chain Strip]  Plaits → Rings → Clouds             │
├─────────────────────────────────────────────────────┤
│  [Macro Knob]  [Macro Knob]  [Macro Knob]           │
│  ◉ Brightness  ◉ Space       ◉ Movement             │
└─────────────────────────────────────────────────────┘
```

### Example: Performance View

```
Performance Surface:
┌─────────────────────────────────────────────────────┐
│  [Mixer Strip Bank]                                 │
│  KICK  BASS  LEAD  PAD                              │
│  ┃▓▓┃  ┃▓▓┃  ┃▓░┃  ┃▓░┃                            │
│   M S   M S   M S   M S                             │
├────────────────────┬────────────────────────────────┤
│  [Cross-Track      │  [Tension Arc (Global)]        │
│   Macro]           │  ╱‾‾‾╲                         │
│  ◉ Darkness        │ ╱     ╲____╱‾‾‾               │
│  ◉ Chaos           │                                │
│  ◉ Density         │                                │
├────────────────────┴────────────────────────────────┤
│  [Relationship Matrix]                              │
│       KICK  BASS  LEAD  PAD                         │
│  KICK  ──   SC▼   ──    ──                          │
│  BASS  ──   ──    ──    ──                          │
│  LEAD  ──   ──    ──    ──                          │
└─────────────────────────────────────────────────────┘
```

---

## Module Registry

Surface modules are registered in a typed registry, similar to the instrument registry for sound sources. The registry provides:

- Module type definitions (what bindings a module type requires)
- Default configurations per module type
- Size constraints (minimum/maximum grid dimensions)
- Binding validation (which data types a module can bind to)

```ts
interface SurfaceModuleDef {
  type: string;                    // 'step-grid', 'xy-pad', 'knob-group', etc.
  label: string;                   // "Step Grid", "XY Pad", etc.
  category: 'event' | 'parameter' | 'visualisation' | 'composite' | 'experimental' | 'performance';
  requiredBindings: BindingSlot[]; // what data the module needs
  optionalBindings: BindingSlot[];
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  maxSize?: { w: number; h: number };
  defaultConfig: Record<string, unknown>;
}

interface BindingSlot {
  role: string;                    // 'region', 'x-axis', 'cutoff', 'state-a', etc.
  dataType: 'control' | 'region' | 'track' | 'snapshot';
  description: string;
}
```

---

## What This Does Not Define

**Visual design** — Exact styling, spacing, colours, and animations for each module. That is design work, not architecture.

**Module implementation priority** — Which modules to build first. That depends on what tracks exist and what the product needs next. The standard modules (step grid, knob group, XY pad) are obvious first implementations. Experimental modules can be built as spikes when the infrastructure supports them.

**Grid/canvas layout system** — How modules are positioned and resized on the Surface canvas. That is a UI framework concern (CSS Grid, drag-and-drop library, etc.).

**AI composition heuristics** — How the AI decides which modules to place for a given track. That is prompt engineering and AI contract work, informed by the track's role, source, chain, and musical context.

---

## Relationship to Other Documents

- **AI-Curated Surfaces RFC**: This RFC extends and reframes the curated surfaces RFC. The `VoiceSurface` type, `SemanticControlDef`, and AI surface operations defined there are the foundation. This RFC adds the module library and the canonical-vs-custom view distinction. The `set_surface` operation now composes modules rather than just defining semantic controls and pins.
- **Canonical Musical Model RFC**: The canonical views (Tracker, Rack, Patch) are projections over the canonical model's types — `Region`, `MusicalEvent`, `ControlSchema`, `ControlState`, `Processor`, modulation routing. The Surface modules bind to the same types.
- **Sequencer View Layer RFC**: Established the pattern of "views as addable projections over canonical data." The Surface module library extends this pattern: each module is a projection over some subset of the data model, composed into a designed interface.
- **Design References**: Guitar Rig (Rack reference), Max/MSP (Patch reference), Renoise (Tracker reference), NKS/Combinator (Surface composition reference), Korg Kaoss Pad (XY pad), Buchla (experimental modules).
