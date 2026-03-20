# Finalization Hardening Plan

**Milestone:** Finalization

## Goal

Move Gluon from "many local bug fixes" to "a system with explicit contracts that resists whole classes of bugs."

This plan is a response to the March 2026 audit pass. The main conclusion is that the repo no longer primarily suffers from isolated implementation mistakes. It suffers from missing lifecycle boundaries, unclear state ownership, and weak semantic validation at subsystem edges.

The right next step is not more ad hoc patching. It is to formalize the invariants the product depends on, align state to those invariants, and add contract tests that make the system fail loudly when those invariants drift.

## Implemented On This Branch

This branch now hardens four concrete boundaries:

- project boundary: clears project-scoped AI/UI ephemera on project change
- AI turn boundary: explicit turn epoch invalidation for superseded turns, project actions, and provider resets
- playback boundary: transport structural edits restart from the current playhead, and live sequence edits invalidate playing tracks deterministically
- snapshot boundary: `analyze(diff)` and `analyze(masking)` reject semantically incompatible inputs

## Main Diagnosis

The recent audit issues cluster around a few recurring failure modes:

1. Project boundaries are not hard reset boundaries.
2. Important state lives outside the session model without explicit scope/reset rules.
3. Runtime, UI, AI, persistence, and offline analysis each keep partial copies of truth.
4. Tool handlers often validate shape but not semantic compatibility.
5. Live playback/edit paths rely on partial invalidation instead of explicit lifecycle contracts.

Those are system-shape problems. If left as-is, fixing individual issues will keep paying down symptoms while new variants continue to appear.

## What “Robust” Means Here

For Gluon, robustness means:

- a project switch cannot leak prior project state into the next one
- an AI turn cannot apply stale work into a newer session
- a render/analyze/listen pipeline cannot compare incompatible inputs silently
- human, AI, restore/import, and offline paths converge on the same resulting state shape
- live playback remains correct under structural edits, not just under the happy path
- invalid or stale derived state is rebuilt or rejected, not silently tolerated

## Hard Boundaries To Formalize

These boundaries should be treated as first-class contracts.

### 1. Project Boundary

Switching, creating, duplicating, importing, or deleting the active project must define a hard reset boundary for all project-scoped ephemeral state.

Must persist:

- persisted session state
- persisted chat history for that project

Must reset or rebuild:

- A/B state
- AI-side project caches and registries
- spectral slot assignments
- motif library
- recent auto-diff context
- snapshot store
- UI selections keyed by track/module IDs
- runtime degradation banners and similar diagnostics
- any other track- or module-keyed local state

### 2. AI Turn Boundary

An AI turn is a transaction-like scope for:

- planner/provider history mutation
- snapshot lifetime
- before/after auto-diff context
- in-turn projected session state
- streamed execution state

At turn end:

- commit or discard provider history consistently
- clear turn-scoped snapshots
- promote only explicitly intended next-turn context
- reject or invalidate any stale streamed work

### 3. Playback Boundary

Playback start, pause, stop, and hard stop must define the lifecycle of:

- playback plan entries
- queued automation timers
- generation/fence state
- metronome scheduling state
- active voice cleanup

Any structural edit during playback must either:

- invalidate the affected runtime plan deterministically, or
- force a bounded restart/reanchor path

### 4. Restore / Import Boundary

Load, import, duplicate, and export must converge through the same normalized session shape.

Never stamp current-version metadata onto data that has not been normalized first.

Anything accepted from persistence must satisfy the runtime invariants already assumed by:

- engine
- UI
- AI state compression
- offline render

### 5. Snapshot Boundary

Audio snapshots are not generic blobs. They have semantic meaning:

- project identity
- render scope
- bar count / duration
- sample rate
- source session relationship

Analysis tools must reject incompatible comparisons rather than returning plausible-looking output.

## State Ownership Rules

Every mutable state bucket should have an explicit entry with:

- owner
- source of truth
- scope
- persistence
- reset trigger
- rebuild path

### Required Scope Levels

Use only these scopes:

- `turn`
- `playback`
- `project`
- `app`

If a state bucket cannot be assigned one of these scopes clearly, its ownership is underspecified.

### Current High-Risk State Buckets

The audit already surfaced these as likely or confirmed problems:

- A/B snapshot state
- spectral slot registry
- motif registry
- recent auto-diff summaries
- audio snapshot store
- patch cache
- runtime degradation banner
- track/module selection state outside session
- playback timers and plan entries

### Rule Of Thumb

If state affects behavior in a project, but is not persisted in the session, then it still needs:

- a declared scope
- a reset trigger
- a test that proves the reset happens

Otherwise it is a latent cross-project bug.

## Testing Strategy

Yes: Gluon needs more systematic testing, but not just “more unit tests.”

The missing piece is contract-oriented testing that targets lifecycle edges and parity surfaces.

### 1. Lifecycle Contract Tests

Add dedicated suites for:

- project switch contract
- AI turn lifecycle contract
- playback lifecycle contract
- restore/import normalization contract
- snapshot lifecycle contract

Each suite should assert:

- what survives
- what resets
- what is rebuilt
- what must be rejected

### 2. Parity Matrix Tests

For important operations, run the same scenario through:

- human path
- AI path
- restore/import path
- offline render / listen path

Then compare:

- resulting session shape
- undo stack shape
- emitted side effects
- derived projections

This is the only reliable way to catch drift between “equivalent” paths.

### 3. Semantic Input Validation Tests

Current validation is often schema-level or shape-level only.

Add tests that assert rejection of semantically invalid combinations, such as:

- diffing snapshots with different scope or duration
- masking analysis with duplicate-track inputs
- compare/listen requests without satisfiable before-state inputs
- project data that passes shape checks but violates runtime uniqueness assumptions

### 4. Stateful Sequence Tests

Many failures only appear after a sequence of operations, not after one call.

Add scenario tests for flows like:

1. render
2. switch project
3. analyze old snapshot

or:

1. start playback
2. remove track
3. pending timed event fires

or:

1. AI turn in flight
2. project switch
3. streamed step arrives

These should be small state-machine tests, not browser-only smoke tests.

### 5. Property / Fuzz Tests For Invariants

The repo already has good examples of this style in undo and scheduler fuzzing. Expand that pattern to:

- project normalization
- topology/routing cleanup
- undo/redo symmetry
- state restoration after arbitrary remove/reorder sequences

The important shift is to fuzz invariants, not just functions.

### 6. Browser QA For Truthfulness, Not Coverage Theater

Keep Playwright and smoke coverage, but use it for:

- end-to-end lifecycle truth
- destructive flow truth
- first-run flow truth
- runtime degradation and recovery truth

Do not rely on browser QA to catch core contract drift that can be proven deterministically in unit/contract tests.

## Recommended Test Architecture

Use a layered model:

### Layer A: Pure invariant tests

For canonical state, topology, persistence normalization, and analysis compatibility.

Fast and broad.

### Layer B: Contract tests at subsystem boundaries

For:

- AI tool handlers
- project lifecycle hooks
- transport controller
- render/analyze/listen pipelines

These should encode boundary rules explicitly.

### Layer C: Stateful scenario tests

For multi-step sequences with lifecycle transitions and stale-state hazards.

### Layer D: Browser smoke and user-path QA

For validating that the real app wiring matches the contracts.

## A Different Engineering Approach

Yes: the repo should adopt a somewhat different approach from here.

### Shift from “fix issue” to “eliminate bug class”

For each new correctness bug, ask:

- what missing invariant allowed this?
- where should that invariant live?
- what test would make this class fail immediately next time?

The fix is not complete until that answer exists.

### Prefer rebuildable derived state over sticky caches

Where possible:

- derive from session each time, or
- rebuild at explicit boundaries

Long-lived mutable side registries should be rare and heavily tested.

### Make boundaries explicit in code shape

Introduce named reset/rebuild hooks rather than scattered local effects.

Examples:

- `resetProjectScopedEphemera()`
- `resetTurnScopedArtifacts()`
- `rebuildAnalysisContextFromSession()`
- `resetPlaybackRuntime()`

Even if the exact names differ, the architectural move matters: boundary logic should be centralized, not emergent.

### Validate semantics, not just syntax

Schemas catch malformed requests.
They do not catch incompatible requests.

The handler layer must reject semantically incompatible combinations with crisp errors.

## Prioritized Execution Sequence

### Phase 1: Boundary Inventory

Produce a state-scope table for all non-session mutable state.

Output:

- owner
- scope
- reset trigger
- rebuild source
- current gaps

### Phase 2: Project Boundary Hardening

Implement a single project-switch reset/rebuild path for all project-scoped ephemeral state.

This should close the highest-risk cross-project leakage issues first.

### Phase 3: Snapshot / Analysis Integrity

Harden the render/listen/analyze contract:

- project-scoped snapshot lifetime
- compatibility checks for compare/diff/masking/reference modes
- clear user-facing errors for invalid comparisons

### Phase 4: Playback Structural Edit Contract

Document and enforce what happens when the session changes during playback.

Prefer explicit invalidation/restart rules over partial opportunistic syncing.

### Phase 5: Parity Harness Expansion

Build scenario tests that compare human, AI, restore/import, and offline paths for the same operation.

## Immediate Deliverables

The next concrete outputs should be:

1. a state-scope inventory
2. a project-boundary contract test suite
3. a snapshot compatibility contract test suite
4. a small boundary-reset abstraction used by project lifecycle and AI lifecycle

## Success Criteria

This hardening plan is working if:

- new audit findings increasingly map to already-declared invariants
- cross-project leakage issues stop appearing
- analysis-tool correctness issues shift from “misleading result” to “clean rejection”
- playback/edit bugs become localized rather than systemic
- the repo gains contract tests faster than it accumulates ad hoc regressions

## Non-Goals

- inventing major new product subsystems
- replacing the current architecture wholesale
- chasing 100% test coverage
- moving every ephemeral UI detail into persisted session state

The goal is not maximal formalism. The goal is to make the existing system honest, bounded, and hard to accidentally break.
