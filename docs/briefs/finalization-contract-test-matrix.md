# Finalization Contract Test Matrix

## Purpose

This matrix defines the kinds of tests Gluon needs in Finalization to become systematically robust.

It is not a coverage checklist. It is a contract checklist.

The question is not "do we have a test somewhere?" The question is "what boundary or invariant would fail loudly if a regression reappeared?"

## Test Layers

### Layer A: Invariant Tests

Pure-state tests for canonical rules, normalization, and compatibility checks.

Properties:

- fast
- deterministic
- broad
- no browser/runtime dependency

### Layer B: Boundary Contract Tests

Tests for explicit subsystem boundaries:

- project lifecycle
- AI turn lifecycle
- playback lifecycle
- restore/import lifecycle
- snapshot/render/analyze lifecycle

Properties:

- stateful but still deterministic
- focus on "what survives / what resets / what is rejected"

### Layer C: Parity Tests

Tests that compare different paths that should produce the same truth:

- human vs AI
- live vs restore/import
- live vs offline render/listen
- session truth vs derived projections

### Layer D: Scenario Tests

Short multi-step flows that reproduce high-risk lifecycle sequences:

- in-flight AI turn + project switch
- playback + structural edit
- render + project switch + analyze

### Layer E: Browser Truthfulness Tests

Real UI wiring checks for:

- destructive actions
- first-run behavior
- degraded/recovery states
- visible state matching runtime truth

## Matrix

| Area | Main contract | Best test layer | Current gap |
|---|---|---|---|
| Project switch | project-scoped ephemera resets cleanly | B | large |
| AI turn | turn-scoped artifacts and streamed state do not leak or apply stale | B, D | large |
| Playback runtime | timers/plans/generations remain valid under edits | B, D | medium-large |
| Restore/import | accepted state is normalized to runtime assumptions | A, B | medium |
| Snapshot compatibility | incompatible comparisons are rejected, not analyzed | A, B | large |
| Human vs AI parity | equivalent operations produce equivalent state and undo shape | C | large |
| Live vs offline parity | render/listen/analyze match live semantics honestly | C, D | large |
| UI truthfulness | visible warnings/selection/controls reflect current reality | E | medium-large |

## Specific Suites To Add

### 1. Project Boundary Contract

Suggested file:

- `tests/ui/project-boundary-contract.test.tsx`

Current branch coverage:

- `tests/ai/project-boundary-contract.test.ts`

Should cover:

- A/B state reset
- AI-side project-scoped ephemera reset
- stale diagnostics reset
- selection/activity state reset or revalidation
- no stale ids survive from project A into project B

### 2. AI Turn Contract

Suggested files:

- `tests/ai/turn-lifecycle-contract.test.ts`
- `tests/ui/ai-turn-staleness-contract.test.tsx`

Current branch coverage:

- `tests/ui/ai-turn-epoch.test.ts`

Should cover:

- snapshot store cleared on turn completion
- turn-scoped artifacts cleared on turn discard
- stale streamed steps do not commit after supersession
- turn-scoped caches do not survive into unrelated turns unless explicitly intended

### 3. Snapshot Compatibility Contract

Suggested file:

- `tests/ai/snapshot-compatibility-contract.test.ts`

Current branch coverage:

- `tests/ai/snapshot-compatibility-contract.test.ts`

Should cover:

- diff rejects mismatched scope
- diff rejects mismatched bar count when required
- diff rejects incompatible snapshot provenance when available
- masking rejects duplicate-track inputs
- masking rejects multi-track-scope snapshots
- compare/listen paths fail honestly when before-state is unavailable

### 4. Playback Structural Edit Contract

Suggested files:

- `tests/engine/playback-live-edit-contract.test.ts`
- `tests/engine/transport-controller-live-edit.test.ts`

Current branch coverage:

- `tests/engine/playback-live-edit-contract.test.ts`
- `tests/engine/playback-sequence-edit-contract.test.ts`

Should cover:

- remove track during playback
- reorder/remove sequence refs during playback
- time signature / loop / mode changes during playback
- no stale timers or dedup entries target missing entities

### 5. Human / AI / Restore Parity Contract

Suggested file:

- `tests/engine/session-parity-contract.test.ts`

Pattern:

1. perform operation via human path
2. perform equivalent operation via AI/executor path
3. restore/import equivalent state if relevant
4. compare resulting session shape and undo semantics

Good candidates:

- add/remove processor
- add/remove modulator
- set model
- set transport mode / time signature
- track removal and cleanup

## Tests That Create False Confidence

These patterns are especially risky:

- tests that assert one narrow regression but not the boundary contract
- tests that only inspect a returned success object and not resulting state
- tests that validate schema shape but not semantic compatibility
- tests that prove an interface alias matches itself rather than implementations
- tests that mock away the exact lifecycle edge that tends to break in production

## Preferred Pattern For New Hardening Tests

When adding a test for a bug class:

1. identify the boundary
2. name the invariant
3. test both the positive and negative path
4. assert rejection/reset behavior, not only success behavior
5. avoid duplicating product logic inside the test

Example:

Not enough:

- "returns a diff result for valid snapshots"

Better:

- "rejects diff requests when snapshots have incompatible scope or duration"
- "accepts diff requests only when snapshot compatibility contract holds"

## Suggested Review Heuristic

Any PR that introduces new mutable non-session state should be blocked until it answers:

1. what scope does this state belong to?
2. what resets it?
3. what rebuilds it?
4. what contract test covers it?

If those questions are unanswered, the PR is adding future audit debt.
