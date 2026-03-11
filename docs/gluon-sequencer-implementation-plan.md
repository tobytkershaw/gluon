# Gluon Sequencer Implementation Plan
## Roadmap Derived from `docs/gluon-sequencer-brief.md`

---

## Purpose

This document translates the sequencing brief into an implementation plan that can be executed through small, reviewable issues and PRs.

It is intentionally narrower than the brief:

- the brief explains strategy and boundaries
- this plan defines phases, milestones, dependencies, acceptance criteria, and issue slices

This plan assumes the Canonical Musical Model work remains the architectural foundation. It does not replace that work; it sequences the next layer of sequencing-specific implementation on top of it.

---

## Planning Rules

The roadmap follows these constraints.

### 1. Keep the product usable at every stage

No phase should require a stop-the-world rewrite of sequencing, transport, or AI operations.

### 2. Change the source of truth before expanding features

Do not add rich new sequencing behavior directly onto `Pattern.steps` as the primary model.

### 3. Ship visible musical wins alongside foundational work

Every phase should produce either a user-visible sequencing improvement or a meaningful reduction in future implementation risk.

### 4. Preserve Gluon's core guarantees

Every phase must preserve:

- arbitration
- grouped undo
- per-voice agency
- AI operation boundedness

### 5. Prefer issue slices that minimize file conflicts

Work should be split by module boundary where possible:

- `src/engine/`
- `src/audio/`
- `src/ai/`
- `src/ui/`
- `tests/`
- `docs/`

---

## Current Baseline

The current system already provides:

- step-grid sequencing per voice
- canonical event conversion in the sketch path
- grouped undo for AI actions
- AI operation execution in the engine layer
- browser-based transport and scheduler

The main limitations that drive this roadmap are:

- step-grid representation is still too close to sequencing authority
- microtiming exists in data but not in playback
- scheduler assumptions are fixed to Phase 2 grid semantics
- pattern operations are too primitive
- step grid is the only real editor surface
- no external adapter proves the sequencing architecture yet
- sequencing-specific tests are not broad enough for aggressive evolution

---

## Roadmap Overview

The implementation plan is split into six phases.

### Phase A: Canonical sequencing authority

Goal:
Move sequencing source of truth to canonical regions and events while preserving the current step-grid UX.

Outcome:
The step grid becomes an editor/projection rather than the foundation.

### Phase B: Expressive timing and playback

Goal:
Upgrade playback from fixed-grid step scheduling to event-aware timing with microtiming support.

Outcome:
The engine can play expressive sequencing data without fighting the data model.

### Phase C: Pattern operations and variation tools

Goal:
Add reusable sequencing transformations for both humans and AI.

Outcome:
The AI can perform meaningful composition edits without rewriting whole patterns constantly.

### Phase D: Editing surfaces

Goal:
Improve the current step-grid experience and prepare one second sequencing surface over the same data.

Outcome:
Gluon proves that “editors are views” is true in the sequencing layer.

### Phase E: External adapter proof

Goal:
Integrate one external sequencing target without changing the internal sequencing model.

Outcome:
The adapter boundary is proven for sequencing, not just controls.

### Phase F: Sequencing quality infrastructure

Goal:
Strengthen tests, fixtures, and regression harnesses so sequencing can evolve safely.

Outcome:
Timing and event correctness stop being guesswork.

---

## Phase Plan

## Phase A: Canonical Sequencing Authority

### Why this phase comes first

If the team keeps adding expressive features directly to `Pattern.steps`, the future tracker, clip view, and external adapters all become more expensive.

### Scope

- define sequencing-specific `Region` usage for current product needs
- define sequencing event invariants
- move session sequencing reads/writes to canonical regions/events
- keep step grid functioning through projection logic
- maintain backward compatibility where needed during migration

### Deliverables

1. Sequencing region semantics are explicit and documented.
2. Canonical regions/events become the sequencing source of truth.
3. Step-grid reads/writes flow through projection helpers rather than owning state directly.
4. Event/step round-tripping is hardened for real editing paths.

### Dependencies

- existing canonical model PRs/issues

### Acceptance criteria

- creating or editing a pattern via the UI updates canonical sequencing data
- AI sketch operations write canonical sequencing data first
- step-grid playback still works without UI regression
- undo/redo behavior remains coherent for pattern edits
- no parallel step-grid-only source of truth remains in engine logic

### Suggested PR shape

- PR A1: sequencing region semantics and conversion helpers
- PR A2: source-of-truth migration with step-grid projection

---

## Phase B: Expressive Timing and Playback

### Why this phase follows

Once canonical events own the data, playback can be widened without hard-coding everything to step indices.

### Scope

- activate microtiming in scheduler playback
- support event times that are not limited to integer step positions
- verify swing + microtiming interaction rules
- harden tempo-change and background-tab scheduling behavior
- define data-model hooks for probability/ratchets/conditional playback

### Deliverables

1. Microtiming affects audible playback.
2. Scheduler supports sub-step event timing.
3. Timing semantics are defined for swing plus microtiming.
4. Playback correctness tests cover tempo changes and lookahead edge cases.

### Dependencies

- Phase A complete

### Acceptance criteria

- non-zero microtiming values produce audible and testable timing offsets
- timing remains stable under BPM changes while playing
- no duplicate triggering or missed gate-offs occur in regression scenarios
- timing tests cover background catch-up and sub-step scheduling

### Suggested PR shape

- PR B1: microtiming activation and event-aware scheduler changes
- PR B2: timing regression harness and edge-case hardening

---

## Phase C: Pattern Operations and Variation Tools

### Why this phase matters

Without reusable transformations, the AI has to brute-force pattern authoring. That is both musically clumsy and operationally noisy.

### Scope

- duplicate, rotate, transpose, simplify, densify, mutate, humanize
- region-scoped transformations
- variation generation primitives
- engine-level operation definitions for transformation requests
- optional Mutable-inspired generator experiments where they clearly fit

### Deliverables

1. Core transformation operations exist in the engine.
2. AI can invoke scoped sequencing transformations, not just raw rewrites.
3. Transformations are undoable as coherent action groups.

### Dependencies

- Phase A complete
- Phase B partially complete for timing-aware transforms that touch microtiming

### Acceptance criteria

- at least one transformation path works on canonical regions/events rather than step-grid deltas
- AI can request transformations like simplify, humanize, rotate, or variation B
- undo reverts the full transform cleanly
- transformation tests cover idempotence and scope boundaries where relevant

### Suggested PR shape

- PR C1: engine transformation primitives
- PR C2: AI operation integration and execution reporting
- PR C3: Mutable-inspired generator spike or implementation, only if Phase C1/C2 are solid

---

## Phase D: Editing Surfaces

### Why this phase matters

The roadmap claims editors are views. This phase proves it.

### Scope

- improve step-grid ergonomics over canonical data
- define and prototype one second sequencing surface
- keep view switching clean
- avoid introducing a second state model

### Deliverables

1. Step-grid editing remains strong after canonical migration.
2. One second sequencing surface is specified or prototyped.
3. Shared editing logic is separated from view-specific UI logic.

### Dependencies

- Phase A complete

### Acceptance criteria

- step-grid edits still feel immediate and stable
- second-surface prototype reads shared sequencing data
- no view writes a private state model that bypasses canonical regions/events
- design and engineering scope for the second editor is explicit

### Suggested PR shape

- PR D1: step-grid polish over canonical data
- PR D2: tracker or timeline spike/prototype

Decision rule:
Prefer tracker if the near-term product need is dense event editing and parameter-lock visibility. Prefer timeline/clip view if the near-term need is section-level structure and external clip parity.

---

## Phase E: External Adapter Proof

### Why this phase matters

The sequencing architecture is not proven until one non-native target can consume the same sequencing model without forcing core changes.

### Scope

- define smallest useful external sequencing adapter
- prove export or live write path from canonical regions/events
- keep Gluon-native sequencing primary
- avoid full DAW integration sprawl

### Deliverables

1. One external target consumes Gluon's canonical sequencing data.
2. Adapter capability boundaries are explicit.
3. Core sequencing operation vocabulary remains unchanged.

### Dependencies

- Phase A complete
- ideally after enough of Phase B/C to make the exported data musically worthwhile

### Acceptance criteria

- at least one external target can receive notes/triggers/automation from canonical sequencing data
- the integration does not require changing internal source-of-truth structures
- adapter failure modes are clear and non-destructive

### Suggested PR shape

- PR E1: Ableton adapter spike and narrow scope definition
- PR E2: first external sequencing write path

Default target:
Ableton Live, unless another target proves materially easier while still validating the adapter boundary.

---

## Phase F: Sequencing Quality Infrastructure

### Why this phase must run throughout

Sequencing changes touch timing, musical correctness, and AI behavior. Without stronger harnesses, regressions will be hard to diagnose and easy to ship.

### Scope

- event conversion tests
- scheduler timing tests
- deterministic sequencing fixtures
- regression scenarios for AI sequencing operations
- performance and drift measurement

### Deliverables

1. Sequencing regression suite covers core event and playback behavior.
2. Fixtures exist for representative musical scenarios.
3. Timing drift and scheduler edge cases are measurable in CI/local verification.

### Dependencies

- runs alongside all phases

### Acceptance criteria

- every sequencing phase adds or updates dedicated tests
- scheduler changes have timing regressions tests
- canonical conversion changes have round-trip tests
- AI sequencing operations have deterministic execution fixtures

### Suggested PR shape

- PR F1: sequencing test harness baseline
- PR F2+: phase-specific test expansions

---

## Dependency Graph

The minimum sensible execution order is:

1. Phase A
2. Phase B
3. Phase C
4. Phase D or Phase E
5. Phase F throughout

Recommended overlap:

- Phase F starts immediately and grows alongside the rest
- early design work for Phase D/E can begin during Phase B/C
- implementation of D/E should wait until A is solid

---

## Suggested GitHub Issue Slices

These issue slices are designed to be ownable and reviewable.

1. Sequencer A1: define sequencing region semantics and invariants
2. Sequencer A2: make canonical regions/events the source of truth behind the step grid
3. Sequencer B1: activate microtiming and sub-step event scheduling
4. Sequencer B2: harden scheduler correctness under tempo changes and background catch-up
5. Sequencer C1: add engine-level sequencing transformation primitives
6. Sequencer C2: integrate sequencing transformation operations into AI execution
7. Sequencer D1: step-grid polish over canonical sequencing data
8. Sequencer D2: prototype a second sequencing surface over canonical data
9. Sequencer E1: spike a narrow Ableton sequencing adapter
10. Sequencer F1: build a sequencing regression harness

---

## Verification Standard

Every issue and PR in this plan should include:

- `npx tsc --noEmit`
- targeted Vitest coverage for changed sequencing behavior
- explicit manual verification notes where audible behavior changes

For timing-sensitive work, add:

- deterministic scheduler tests where possible
- one manual audio verification checklist

---

## Definition of Done

The sequencing roadmap is meaningfully complete when:

- canonical regions/events are the sequencing source of truth
- Gluon supports expressive timing beyond fixed grid playback
- the AI can perform transformation-style sequencing edits
- at least two editor surfaces exist over shared sequencing data
- one external target can consume canonical sequencing data through an adapter
- sequencing regressions are covered by dedicated tests

---

## Related Issues

Implementation issues created from this plan:

- `#42` Sequencer A1: define sequencing region semantics and invariants
- `#43` Sequencer A2: make canonical regions/events the source of truth behind the step grid
- `#44` Sequencer B1: activate microtiming and sub-step event scheduling
- `#45` Sequencer B2: harden scheduler correctness under tempo changes and background catch-up
- `#46` Sequencer C1: add engine-level sequencing transformation primitives
- `#47` Sequencer C2: integrate sequencing transformation operations into AI execution
- `#48` Sequencer D1: step-grid polish over canonical sequencing data
- `#49` Sequencer D2: prototype a second sequencing surface over canonical data
- `#50` Sequencer E1: spike a narrow Ableton sequencing adapter
- `#51` Sequencer F1: build a sequencing regression harness
