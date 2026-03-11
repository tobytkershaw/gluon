# Gluon RFC
## Canonical Musical Model and Adapter Architecture

---

## Status

Draft RFC for architectural alignment.

Related docs:

- `docs/gluon-interaction-protocol-v03.md`
- `docs/gluon-architecture.md`
- `docs/gluon-phase3-build.md`
- `docs/gluon_modular_roadmap.md`
- `docs/gluon-phase4a-rfc.md`

---

## Purpose

Define the data model that should sit underneath Gluon's AI protocol, UI, and runtime integrations.

This RFC exists to answer one question:

**What is the stable musical abstraction that the AI edits, regardless of whether sound is produced by Plaits, another Mutable Instruments module, MIDI hardware, a tracker, or Ableton Live?**

The current model is good enough for the Phase 2 / Phase 3 browser synth, but it is too tightly coupled to:

- Plaits-oriented parameter names
- a built-in step sequencer representation
- a single notion of "voice"
- one native browser runtime

That coupling will become debt if Gluon expands into:

- more Mutable Instruments modules
- constrained patch chains
- external hardware control over MIDI
- tracker-style editing
- Ableton integration

This RFC defines the abstraction layer that should remain stable while adapters and UI surfaces evolve around it.

---

## Executive Summary

Gluon should not make "Plaits voice + step pattern" the long-term foundation.

Instead, the system should center on four canonical concepts:

1. **Targets**
   Addressable musical objects such as instruments, processors, mixers, clips, or external devices.

2. **Controls**
   Typed, semantically-described musical controls exposed by a target. The AI reasons about these controls musically; adapters map them to implementation-specific parameters.

3. **Regions and Events**
   Representation-agnostic time-based musical content. A step grid, tracker, piano roll, MIDI clip, and arrangement lane should all be views or adapters over the same event model.

4. **Adapters**
   Runtime-specific bridges that map canonical targets, controls, and events to real engines such as Plaits WASM, Mutable module chains, MIDI hardware, or Ableton devices.

The AI should operate on this canonical model through a small action vocabulary. UI surfaces and runtimes should translate to and from it, rather than inventing their own private models.

---

## Why This RFC Exists Now

The current protocol direction is strong:

- human asks
- AI reads project state
- AI applies structured edits
- human listens, tweaks, undoes, refines

That interaction model is portable.

The current state model is not yet portable enough.

Today the implementation assumes:

- one voice is one sound source
- one voice owns one flat parameter map
- one voice owns one step pattern
- transport is simple and global
- the main editable things are synth params and step gates

Those assumptions will break down as soon as Gluon wants to support:

- source -> processor chains
- non-step-based sequencing
- clip launching or arrangement editing
- external devices with different control surfaces
- multiple editing views over the same musical material

The correct move is to define the canonical model before more product surface area is added.

---

## Goals

This RFC should provide a foundation for:

- native Mutable Instruments engines
- constrained modular patch chains
- MIDI hardware control
- tracker and piano-roll style editing
- Ableton or DAW integration
- multiple UIs over the same underlying musical content
- a stable AI-facing operation model

The design must preserve Gluon's product thesis:

- the AI edits a real instrument or project, not a hidden latent space
- edits are inspectable
- edits are reversible
- the human can always take direct control

---

## Non-Goals

This RFC does not define:

- the final UI layout
- the system prompt wording
- how semantic controls are inferred automatically
- arbitrary modular graph execution
- project file persistence format
- collaborative networking
- taste or long-term memory systems

Those can build on this model later.

---

## Design Principles

### 1. The AI should reason musically, not implementation-first

The AI should understand that a control affects brightness, decay, density, feedback, or pitch stability.

It should not need to care whether that control is:

- `params.timbre`
- MIDI CC 74
- an Ableton device parameter
- a macro mapped to several downstream parameters

### 2. The model must preserve concrete capability

The abstraction must not become so generic that the AI loses access to what a given target can actually do.

The AI needs both:

- semantic meaning
- concrete capability and valid ranges

### 3. Musical time must be representation-agnostic

The canonical model should not privilege a 16-step grid.

Notes, triggers, automation, and structural regions should exist independently of whether they are viewed as:

- steps
- tracker rows
- piano-roll notes
- MIDI clips
- arrangement blocks

### 4. UI representations are views, not foundations

A step sequencer, tracker, and clip launcher are editing surfaces over shared content, not separate source-of-truth models.

### 5. Runtime-specific details belong behind adapters

DSP wrappers, CC numbers, API calls, and node graphs should not leak into the AI-facing model unless explicitly surfaced as capabilities.

### 6. The human's hands still win

This RFC does not change arbitration, undo, or per-target AI permissions. It only defines what kind of objects those rules apply to.

---

## Canonical Model Overview

At the highest level:

```text
Project
  -> Targets
  -> Regions
  -> Events
  -> Context
  -> Policies
  -> Undo / Chat / Action Log
```

The canonical model separates:

- **what exists**: targets and topology
- **what is controllable**: controls
- **what happens over time**: regions and events
- **how it is realized**: adapters

---

## Core Concepts

### Project

The top-level session object.

```ts
type ProjectId = string;
type TargetId = string;
type RegionId = string;
type EventId = string;

interface Project {
  id: ProjectId;
  transport: TransportState;
  context: MusicalContext;
  targets: Target[];
  regions: Region[];
  routes: Route[];
  policies: ProjectPolicies;
  messages: ChatMessage[];
  undoStack: UndoEntry[];
}
```

This is the AI's source of truth.

### Target

A target is any addressable musical object that Gluon can inspect or edit.

Examples:

- a synth voice
- a drum lane
- an effect processor
- a mixer channel
- a macro controller
- an external MIDI device
- an Ableton track
- an Ableton device
- a clip launcher

```ts
type TargetKind =
  | 'instrument'
  | 'processor'
  | 'mixer_channel'
  | 'macro'
  | 'transport'
  | 'external_device'
  | 'clip_launcher'
  | 'arrangement_track';

interface Target {
  id: TargetId;
  kind: TargetKind;
  name: string;
  role?: MusicalRole;
  agency: Agency;
  adapterId: string;
  capabilities: TargetCapabilities;
  controls: ControlSchema[];
  metadata?: Record<string, string | number | boolean>;
}
```

The key design point:

- a target is not defined by implementation
- a target is defined by what it is, what it can do, and what it exposes

### Control Schema

A control is a typed musical handle exposed by a target.

This is the most important part of the abstraction.

```ts
type ControlKind = 'continuous' | 'discrete' | 'enum' | 'boolean' | 'trigger';

interface ControlSchema {
  id: string;
  name: string;
  kind: ControlKind;
  semanticRole: SemanticRole;
  description: string;
  readable: boolean;
  writable: boolean;
  range?: {
    normalizedMin: number;
    normalizedMax: number;
    recommendedMin?: number;
    recommendedMax?: number;
    units?: string;
  };
  enumValues?: string[];
  binding: ControlBinding;
}

interface ControlBinding {
  adapterId: string;
  path: string;
}
```

Examples:

```ts
const brightness: ControlSchema = {
  id: 'brightness',
  name: 'Brightness',
  kind: 'continuous',
  semanticRole: 'brightness',
  description: 'Controls spectral brightness or darkness.',
  readable: true,
  writable: true,
  range: { normalizedMin: 0, normalizedMax: 1, recommendedMin: 0.1, recommendedMax: 0.85 },
  binding: { adapterId: 'plaits', path: 'params.timbre' },
};

const cutoff: ControlSchema = {
  id: 'brightness',
  name: 'Brightness',
  kind: 'continuous',
  semanticRole: 'brightness',
  description: 'Low-pass filter cutoff mapped to musical brightness.',
  readable: true,
  writable: true,
  range: { normalizedMin: 0, normalizedMax: 1 },
  binding: { adapterId: 'digitone', path: 'cc.74' },
};
```

Both expose the same semantic role. The adapters differ.

### Control State

The schema describes what a control is. State stores the current value.

```ts
interface ControlState {
  controlId: string;
  value: number | string | boolean;
  lastUpdatedAt?: number;
  source?: 'human' | 'ai' | 'adapter' | 'automation';
}
```

Implementations may store control state inside targets or in a parallel structure, but the AI-facing model must be able to read current control values consistently.

### Regions

A region is a named time span containing musical content.

Examples:

- a 1-bar bass pattern
- a 4-bar phrase
- a tracker pattern
- an Ableton clip
- an automation region

```ts
type RegionKind = 'pattern' | 'clip' | 'automation_lane' | 'arrangement_block';

interface Region {
  id: RegionId;
  targetId: TargetId;
  kind: RegionKind;
  start: MusicalTime;
  duration: MusicalDuration;
  loop?: boolean;
  name?: string;
  tags?: string[];
}
```

### Events

Events are the atomic time-based edits within regions.

```ts
type EventKind = 'note' | 'trigger' | 'parameter' | 'automation_point' | 'clip_trigger';

interface BaseEvent {
  id: EventId;
  regionId: RegionId;
  at: MusicalTime;
  kind: EventKind;
}

interface NoteEvent extends BaseEvent {
  kind: 'note';
  pitch: number;
  velocity: number;
  duration: MusicalDuration;
  channel?: number;
}

interface TriggerEvent extends BaseEvent {
  kind: 'trigger';
  lane?: string;
  velocity?: number;
}

interface ParameterEvent extends BaseEvent {
  kind: 'parameter';
  controlId: string;
  value: number | string | boolean;
  interpolation?: 'step' | 'linear' | 'curve';
}

type Event = NoteEvent | TriggerEvent | ParameterEvent;
```

This is the abstraction that can back:

- a step sequencer
- a tracker
- a piano roll
- MIDI clips
- arrangement automation

### Routes

Routes describe signal or control flow between targets.

For early phases this can remain constrained and linear. The model should still make routes explicit.

```ts
type RouteKind = 'audio' | 'control' | 'modulation';

interface Route {
  id: string;
  kind: RouteKind;
  sourceTargetId: TargetId;
  destinationTargetId: TargetId;
  metadata?: Record<string, string | number | boolean>;
}
```

This allows the same model to represent:

- `Plaits -> Rings`
- `Track -> Reverb`
- `Tides -> Filter cutoff`
- `MIDI track -> hardware synth`

### Context

Context is session-level musical understanding.

```ts
interface MusicalContext {
  key: string | null;
  scale: string | null;
  tempo: number | null;
  meter?: string | null;
  energy: number;
  density: number;
  groove?: GrooveContext | null;
  section?: string | null;
}
```

Context is shared across targets and helps the AI reason coherently.

### Policies

Policies are constraints that govern AI behavior and editing boundaries.

```ts
interface ProjectPolicies {
  protectedTargetIds: TargetId[];
  allowedTargetIds?: TargetId[];
  tempoLocked?: boolean;
  keyLocked?: boolean;
  scaleLocked?: boolean;
}
```

This generalizes the current per-voice agency model into a project-wide permission layer without removing per-target agency.

---

## Semantic Roles

Semantic roles are the vocabulary that lets the AI reason musically across adapters.

Suggested initial set:

```ts
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
  | 'swing'
  | 'level'
  | 'pan'
  | 'mute'
  | 'solo'
  | 'pattern_density'
  | 'variation';
```

This list should remain small and curated.

The goal is not to create a universal ontology of music. The goal is to give the AI reliable cross-instrument handles for common musical intent.

Instrument-specific controls can still exist. They should carry:

- a local `id`
- a semantic role where applicable
- a textual description when they do not map neatly to a shared role

---

## Adapter Architecture

Adapters implement the bridge between the canonical model and a runtime.

Examples:

- `plaits-wasm`
- `rings-wasm`
- `digitone-midi`
- `ableton-live`
- `tracker-renderer`

### Adapter Responsibilities

An adapter must:

1. expose targets
2. expose control schemas
3. read current control state
4. apply control changes
5. read and write musical events if supported
6. describe routing capabilities
7. validate supported operations

### Adapter Interface

```ts
interface MusicalAdapter {
  id: string;
  name: string;

  discoverTargets(): Promise<Target[]>;

  readControlState(targetId: TargetId): Promise<ControlState[]>;
  writeControlChanges(changes: ControlChange[]): Promise<void>;

  readRegions(targetId: TargetId): Promise<Region[]>;
  readEvents(regionId: RegionId): Promise<Event[]>;
  writeEventPatch(patch: EventPatch): Promise<void>;

  readRoutes(): Promise<Route[]>;

  validateOperation(op: CanonicalOperation): ValidationResult;
}
```

### Examples

#### Plaits adapter

- target kind: `instrument`
- exposes controls like brightness, texture, richness, pitch
- writes to WASM parameter paths
- reads and writes note / trigger data through the current sequencer

#### MIDI hardware adapter

- target kind: `external_device`
- exposes controls mapped to CC or NRPN
- translates note events into MIDI note messages
- optionally exposes a limited set of writable regions if the device has a pattern model

#### Ableton adapter

- target kinds: `arrangement_track`, `clip_launcher`, `processor`, `mixer_channel`
- exposes device parameters and clip regions
- translates writes into Live API operations

---

## AI-Facing Operation Model

The interaction protocol can stay small if it operates on canonical targets, controls, and events.

Recommended core operation vocabulary:

```ts
type CanonicalOperation =
  | MoveControlOp
  | WriteEventsOp
  | EditRegionOp
  | AddTargetOp
  | RemoveTargetOp
  | AddRouteOp
  | RemoveRouteOp
  | SayOp;
```

### Move Control

```ts
interface MoveControlOp {
  type: 'move_control';
  targetId: TargetId;
  controlId: string;
  target: { absolute: number | string | boolean } | { relative: number };
  overMs?: number;
}
```

This generalizes the current `move`.

### Write Events

```ts
interface WriteEventsOp {
  type: 'write_events';
  targetId: TargetId;
  regionId?: RegionId;
  mode: 'replace' | 'merge' | 'clear_and_write';
  events: Event[];
  description: string;
}
```

This generalizes the current `sketch` for time-based material.

### Edit Region

```ts
interface EditRegionOp {
  type: 'edit_region';
  regionId: RegionId;
  changes: {
    start?: MusicalTime;
    duration?: MusicalDuration;
    loop?: boolean;
    name?: string;
  };
  description: string;
}
```

### Add / Remove Target

These support future modular chains, effect inserts, clip launchers, or external devices.

```ts
interface AddTargetOp {
  type: 'add_target';
  parentTargetId?: TargetId;
  targetKind: TargetKind;
  adapterId: string;
  description: string;
}

interface RemoveTargetOp {
  type: 'remove_target';
  targetId: TargetId;
  description: string;
}
```

### Add / Remove Route

```ts
interface AddRouteOp {
  type: 'add_route';
  route: Route;
  description: string;
}

interface RemoveRouteOp {
  type: 'remove_route';
  routeId: string;
  description: string;
}
```

### Say

```ts
interface SayOp {
  type: 'say';
  text: string;
}
```

---

## How This Maps to the Current Protocol

The current protocol can be treated as the first constrained subset of the canonical model.

### Current `Voice`

Current:

```ts
interface Voice {
  id: string;
  engine: string;
  model: number;
  params: SynthParamValues;
  agency: Agency;
  pattern: Pattern;
  muted: boolean;
  solo: boolean;
}
```

Future interpretation:

- `Voice` becomes one specialized `Target`
- `params` become `ControlState[]` over a shared `ControlSchema[]`
- `pattern` becomes one or more `Region + Event[]`
- `engine` and `model` move into target metadata or adapter-specific identity

### Current `move`

Current `move` becomes `move_control`.

### Current `sketch`

Current `sketch` becomes `write_events` over a region.

### Current `say`

Unchanged.

This means Gluon's current assistant loop does not need to be thrown away. It needs to be generalized.

---

## UI Implications

This RFC implies a clean separation between canonical model and editors.

### Editors become projections

A UI surface should declare which part of the canonical model it projects:

- step grid -> trigger/note events projected onto quantized steps
- tracker -> note/parameter events projected onto rows
- piano roll -> note events projected on pitch vs time
- clip view -> regions projected as launchable blocks
- modular chain view -> targets and routes projected as a constrained graph

### Action logs should remain canonical

The action log should be generated from canonical operations where possible:

- "bass brightness 0.70 -> 0.30"
- "wrote 8 trigger events to kick pattern"
- "added resonator after lead voice"

This keeps AI reporting stable even when the UI representation changes.

---

## Migration Plan

The model should be introduced in stages. Do not rewrite the product in one jump.

### Stage 1: Define canonical types beside current types

Add a new canonical model namespace with:

- `Target`
- `ControlSchema`
- `ControlState`
- `Region`
- `Event`
- `Route`
- adapter interfaces

No product behavior change yet.

### Stage 2: Treat the current Plaits voice as Adapter 1

Implement a `plaits-wasm` adapter that maps:

- current voice params -> canonical controls
- current step pattern -> canonical region and events
- current voice identity -> canonical target

The old UI can continue to run while reading from compatibility layers.

### Stage 3: Change AI state compression to use canonical data

Stop serializing raw implementation details as the primary AI-facing model.

The AI should receive:

- targets
- control schemas and current control values
- regions and events
- routes
- context and policies

Adapter-specific details should only appear where useful and bounded.

### Stage 4: Refactor `move` and `sketch` execution through canonical operations

The current engine primitives can become the execution path for the first adapter-backed operations.

### Stage 5: Add second adapter before broadening scope

Before adding many new features, prove the model with one additional adapter, such as:

- MIDI hardware
- a constrained patch-chain processor target
- a tracker-oriented region editor

If the model holds across two genuinely different runtimes, it is probably at the right level.

---

## Validation Rules

The canonical model should enforce a few strong invariants:

1. Every writable AI operation must target a known target or region.
2. Every control write must reference a declared control schema.
3. Every event write must reference a valid target and region shape.
4. Adapter validation must run before side effects.
5. Agency and project policies must be enforced at the canonical layer, not only in adapters.
6. Undo snapshots should be generated from canonical operations, even if adapters also keep local compatibility data.

---

## Risks

### Risk: over-abstraction

If the model becomes too generic, the AI will lose useful understanding of the active instrument.

Mitigation:

- keep semantic roles curated
- keep concrete control descriptions
- preserve adapter-specific metadata where helpful

### Risk: duplicated state during migration

There is a danger of maintaining both legacy voice state and canonical state for too long.

Mitigation:

- set a clear migration boundary
- treat compatibility fields as projections, not independent truth

### Risk: UI complexity outruns model maturity

Adding tracker or modular views before the canonical model is stable will create parallel state systems.

Mitigation:

- define the canonical model first
- add new views only as projections over it

---

## Open Questions

1. Should `Target` remain a flat list with routes, or become an explicit graph structure?
2. Should clip launching and arrangement editing share one region model or use sibling region types?
3. Which semantic roles are essential in v1, and which are too vague to be reliable?
4. How much adapter-specific metadata should be exposed to the AI by default?
5. Should human gesture history live in the canonical model or in a derived interaction layer?

These questions are important, but they do not block the core direction of this RFC.

---

## Acceptance Criteria

This RFC should be considered successfully adopted when:

1. The repo has a canonical type layer for targets, controls, regions, events, and routes.
2. The current browser Plaits voice can be represented entirely through that model.
3. AI state compression is built primarily from canonical data, not implementation-specific fields.
4. At least one non-Plaits adapter can be represented without changing the AI operation vocabulary.
5. A new editing surface such as a tracker or chain view can be added as a projection over canonical regions / targets rather than inventing a separate state model.

---

## Recommendation

Before Phase 4A or broader modular expansion proceeds, Gluon should adopt this RFC as the intended architectural direction.

The immediate next step should be a small implementation plan for:

1. canonical type definitions
2. a `plaits-wasm` adapter
3. compatibility mapping from current `Voice` and `Pattern`
4. canonical AI state compression

That is the right foundation for modular chains, MIDI hardware, tracker workflows, and Ableton integration without hard-coding each new feature into the core model.
