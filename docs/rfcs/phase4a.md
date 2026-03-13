# Gluon Phase 4A RFC
## Constrained Patch Chains

---

## Status

Draft RFC for implementation planning.

**Data model:** The data model for Phase 4A (types, control schemas, adapter interfaces) is now defined in `docs/rfcs/canonical-musical-model.md`. This document retains ownership of product scope, UI constraints, module set, performance budgets, and the Phase 4B decision gate.

Related docs:

- `docs/rfcs/canonical-musical-model.md` — canonical data model (supersedes the type definitions in this doc)
- `docs/archive/gluon-phase3-build.md`
- `docs/briefs/modular-roadmap.md`

Related issue:

- `#16 Phase 4A RFC: constrained patch-chain model`

---

## Purpose

Define the first modular expansion of Gluon after the Phase 3 assistant loop is stable.

Phase 4A is not "full modular patching." It is the smallest useful step from:

- one voice = one synth with parameters

to:

- one voice = one small, legible signal chain

This RFC is execution-facing. It defines:

- scope
- data model
- runtime model
- AI operation model
- UI constraints
- migration approach
- acceptance criteria

---

## Why Phase 4A Exists

The current product can already do:

- ask -> AI edits -> listen -> undo or refine
- direct human control over voices and patterns
- grouped undo
- chat-first guidance

The next meaningful expansion is not arbitrary graph patching. That would multiply complexity too early.

The right next step is to let the AI and the human work on **small signal chains** that are:

- musically useful
- easy to understand
- easy to edit
- easy to undo

This is where Gluon starts to become an AI-assisted sound-design environment rather than only an AI-assisted synth editor.

---

## Goals

Phase 4A should make these requests possible:

- "Put this through something more resonant."
- "Add a grainy wash after the oscillator."
- "Make the pad more metallic."
- "Add slow movement without changing the pattern."
- "Simplify the chain but keep the shimmer."

The result should still feel like one instrument per voice, not a free-form modular sandbox.

---

## Non-Goals

Phase 4A must not include:

- arbitrary patch graphs
- parallel routing
- feedback loops
- unrestricted module counts
- arbitrary cross-voice audio routing
- generic CV patch spaghetti
- a full drag-and-drop modular editor
- persistence/migration for old saved projects beyond what is needed for in-memory compatibility

Those belong to later phases.

---

## Product Shape

Each voice becomes a **patch chain** with:

- exactly one source module
- zero to two processor modules
- zero to two modulation assignments

Examples:

- `Plaits -> Rings`
- `Plaits -> Clouds`
- `Plaits -> Ripples -> Clouds`

The chain is left-to-right and always legible.

The AI can:

- add a processor
- replace a processor
- remove a processor
- adjust module parameters
- add modulation
- change modulation depth
- simplify the chain
- explain the chain

The human can:

- inspect every module
- tweak module params directly
- bypass or remove processors
- undo the whole AI edit group

---

## Recommended Initial Module Set

Start with a deliberately small set.

### Source

- `Plaits`

### Processors

- `Rings`
- `Clouds` or `Beads`
- `Ripples` or `Blades`

### Modulator

- `Tides`

Rationale:

- this is enough to prove source -> processor -> modulation workflows
- each module adds clear musical value
- the UI remains understandable
- the runtime can stay linear

Do not add more modules until this set is working and legible.

---

## Data Model

### New Types

```ts
type ModuleKind = 'source' | 'processor' | 'modulator';

type ModuleType =
  | 'plaits'
  | 'rings'
  | 'clouds'
  | 'ripples'
  | 'blades'
  | 'tides';

interface ModuleInstance {
  id: string;
  type: ModuleType;
  kind: ModuleKind;
  enabled: boolean;
  params: Record<string, number>;
}

interface ModulationAssignment {
  id: string;
  sourceModuleId: string;
  targetModuleId: string;
  targetParam: string;
  depth: number;
}

interface PatchChain {
  source: ModuleInstance;
  processors: ModuleInstance[];
  modulations: ModulationAssignment[];
}
```

### Voice Extension

```ts
interface Voice {
  id: string;
  patch: PatchChain;
  pattern: Pattern;
  agency: Agency;
  muted: boolean;
  solo: boolean;
}
```

### Compatibility Rule

For Phase 4A, the current voice fields:

- `engine`
- `model`
- `params`

should be treated as a compatibility representation of a default `Plaits` source module and then gradually collapsed into `patch.source`.

Short-term migration rule:

- existing `voice.model` -> `voice.patch.source.params.model`
- existing `voice.params.*` -> `voice.patch.source.params.*`

Do not try to keep two independent sources of truth long-term.

---

## Validation Rules

Phase 4A should enforce strict structural rules:

1. A patch chain must have exactly one source module.
2. `processors.length <= 2`
3. A processor cannot also be a source.
4. Modulations must target an existing module and an allowed target param.
5. A modulation source must be a module with `kind === 'modulator'`.
6. No modulation assignment may target another modulation assignment.
7. No cross-voice module references.
8. No cycles because the structure is linear.

These rules should live in one validation layer, not be duplicated between UI and AI execution paths.

---

## Module Registry

Phase 4A should introduce a real module registry shared by:

- runtime
- UI
- AI prompt construction
- validation

Suggested shape:

```ts
interface ModuleParamSpec {
  id: string;
  label: string;
  min: number;
  max: number;
  defaultValue: number;
  automatable: boolean;
  modulateable: boolean;
}

interface ModuleSpec {
  type: ModuleType;
  kind: ModuleKind;
  label: string;
  description: string;
  params: ModuleParamSpec[];
  allowedTargets?: string[];
}
```

This registry should be machine-readable and not rely on prompt-only descriptions.

---

## Runtime Model

### Architecture

Phase 4A should use a **linear chain execution model**.

Per voice:

1. render source module
2. run output through processor 1 if present
3. run output through processor 2 if present
4. apply modulation inputs during module parameter evaluation

No branching.
No graph scheduler.
No general topological sort.

### Runtime Requirements

- module enable/disable must be click-free
- chain edits must not require tearing down the whole audio engine when avoidable
- module replacement should happen at safe boundaries
- per-module params must remain normalized at the Gluon layer even if DSP wrappers use native ranges internally

### Performance Constraints

Phase 4A only proceeds if a chain with:

- 4 voices
- one source each
- up to two processors each
- light modulation

still feels interactive on the target browsers.

If it does not, reduce module scope before expanding architecture.

---

## AI Operation Model

Phase 4A should not expose raw patch diffs as the main abstraction.

It should define first-class operations:

```ts
type PatchOp =
  | { type: 'add_processor'; voiceId: string; module: ModuleType; position?: number }
  | { type: 'replace_processor'; voiceId: string; moduleId: string; module: ModuleType }
  | { type: 'remove_processor'; voiceId: string; moduleId: string }
  | { type: 'set_module_param'; voiceId: string; moduleId: string; param: string; value: number }
  | { type: 'add_modulation'; voiceId: string; sourceModuleId: string; targetModuleId: string; targetParam: string; depth: number }
  | { type: 'adjust_modulation_depth'; voiceId: string; modulationId: string; depth: number }
  | { type: 'simplify_chain'; voiceId: string }
  | { type: 'explain_chain'; voiceId: string };
```

### Operation Principles

- validate before apply
- fail cleanly with no partial mutation
- generate a human-readable description
- group related operations into one undoable AI action group

### Prompt Guidance

Default AI behaviour for patch chains should be:

- prefer editing existing modules before adding new ones
- prefer one processor over two unless a second is clearly useful
- prefer shallow modulation before aggressive modulation
- prefer the smallest patch that satisfies the request

---

## Undo Model

Patch-chain edits must preserve the existing Gluon invariant:

- one user ask
- one grouped AI action
- one undo

That means:

- adding a processor and setting two of its params can still be one undo step
- replacing a processor and rewiring its modulation can still be one undo step

Phase 4A should extend the grouped snapshot model to include:

- module insertion/removal
- module replacement
- per-module param changes
- modulation add/remove/change

Do not fall back to opaque full-chain snapshots unless there is no better implementation path.

Preferred approach:

- operation-aware inverse patches
- or structured patch snapshots scoped to one voice

---

## UI Model

### Core Requirement

The user must always be able to answer:

- what modules are in this voice?
- what order are they in?
- what is being modulated?
- what did the AI just change?

### Required UI Elements

1. **Chain strip**
   - left-to-right modules
   - source visually distinct from processors/modulators

2. **Module inspector**
   - selected module params
   - enable/bypass control
   - remove control where allowed

3. **Modulation summary**
   - concise text or chips
   - example: `Tides -> Clouds density (0.22)`

4. **Action log entries**
   - example:
     - `Added Rings after Plaits`
     - `Set Rings brightness 0.41 -> 0.68`
     - `Added Tides modulation to Clouds texture`

### UI Constraints

- no free-form cable drawing in Phase 4A
- no graph canvas
- no hidden automatic module insertion

---

## Migration Strategy

Phase 4A should include a one-step in-memory migration from the current voice model.

### Initial Migration

Any existing voice loads as:

```ts
patch = {
  source: {
    id: 'src-voice-x',
    type: 'plaits',
    kind: 'source',
    enabled: true,
    params: {
      model,
      ...voice.params
    }
  },
  processors: [],
  modulations: []
}
```

### Implementation Guidance

- add a compatibility adapter first
- keep current UI functional while the chain UI is introduced
- collapse old fields only after the patch chain path is stable

Do not do a flag day rewrite if it can be avoided.

---

## Acceptance Criteria

Phase 4A is successful if:

1. The AI can build and edit simple patch chains reliably.
2. The user can understand the result without reading internal state.
3. Chain edits remain inspectable and undoable.
4. Direct manipulation still feels first-class.
5. Runtime performance remains acceptable on supported browsers.
6. The AI tends toward minimal patches instead of overbuilding.

---

## Decision Gate for Phase 4B

Do not move to guided modular graphs until these questions can be answered "yes":

1. Are patch chains genuinely useful in real sessions?
2. Do users understand what the AI changed?
3. Does the AI avoid unnecessary complexity?
4. Is the runtime stable with multiple chained modules per voice?
5. Does the current chain UI still feel legible?

If the answer to any of these is "no," improve Phase 4A rather than broadening scope.

---

## Recommended Immediate Follow-On Work

After Phase 3 is complete, the recommended order is:

1. Finish Phase 3 audio/runtime validation
   - Plaits audio audit
   - manual QA pass
   - audio-eval spike

2. Turn this RFC into a concrete implementation brief
   - exact module set
   - exact registry shape
   - exact migration plan

3. Build the smallest vertical slice
   - `Plaits -> Rings`
   - one modulation source
   - AI can add/remove/replace one processor

4. Evaluate before expanding module count

---

## Final Recommendation

Phase 4A should be treated as:

- the first modular milestone
- a constrained chain editor
- a test of whether AI-assisted sound-design architecture is truly valuable

If Phase 4A works, Phase 4B becomes a product expansion.

If Phase 4A does not feel legible and useful, a full graph system will only make the problem worse.
