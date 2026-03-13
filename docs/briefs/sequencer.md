# Gluon Sequencer Brief
## Scope for Roadmap Planning

---

## Purpose

This document defines the product scope, architectural direction, and delivery boundaries for Gluon's sequencing system. It is intended to be the planning brief that gets translated into an actionable roadmap.

The aim is not to build a general-purpose DAW sequencer inside Gluon. The aim is to build the smallest sequencing core that is uniquely required by Gluon:

- AI-editable musical structure
- human-first arbitration
- unified undo for all actions (human and AI)
- multiple editing surfaces over shared musical data
- adapters to external runtimes such as Mutable-derived generators and Ableton Live

This brief assumes the Canonical Musical Model RFC is the source of truth for long-term architecture, specifically:

- musical events are the foundation
- editors are views, not separate models
- runtime integrations sit behind adapters

---

## Executive Summary

Gluon should continue to own its sequencing core. It should not adopt an external sequencer or tracker as its foundational model.

The current step sequencer is good enough as a Phase 2 implementation, but not good enough as the long-term sequencing substrate. It is intentionally narrow:

- fixed 16th-note grid
- fixed step-oriented scheduling model
- swing only
- stored but inactive microtiming
- per-voice step patterns, not general regions/clips
- UI and engine optimized for one editing surface

That is acceptable as a starting point, but insufficient for the product Gluon is becoming.

The recommended direction is:

1. Keep the current step grid as one editing surface.
2. Move sequencing authority to canonical regions and musical events.
3. Expand timing, pattern, and clip behavior in Gluon-owned engine code.
4. Reuse external tools selectively:
   - Mutable sequencing ideas and algorithms as generators
   - Ableton as an external target/runtime
   - optional transport/timing utilities where they reduce maintenance cost
5. Avoid wholesale adoption of an external tracker or sequencer application.

---

## Why This Matters

Sequencing in Gluon is not a support feature. It is part of the core interaction loop:

1. The human describes an intention.
2. The AI reads and edits musical structure.
3. The human hears the result immediately.
4. The human overrides, nudges, undoes, or redirects.

That loop only works if the sequencer is:

- musically expressive enough to make convincing material
- structurally stable enough for the AI to edit safely
- narrow enough that the product does not become an unfocused DAW clone

If sequencing remains too primitive, the AI can only make toy changes.
If sequencing is outsourced wholesale to another application's model, Gluon loses control of its core UX, AI contract, and undo/arbitration guarantees.

---

## Current State

As of March 11, 2026, Gluon has:

- a working browser-based scheduler
- 4 voice step sequencing
- variable pattern lengths up to 64 steps
- per-step gates, accents, and parameter locks
- transport BPM and swing
- AI sketching over musical events with conversion back to steps
- unified undo for all actions (human and AI), with AI actions grouped per turn

The current sequencer implementation is deliberately simple:

- scheduler: main-thread `setInterval` with lookahead
- timing resolution: fixed 16th-note steps at 48 PPQN
- microtiming: represented in data but ignored at playback time
- playback model: repeating per-voice patterns rather than general clips/regions

This is a sound prototype architecture, but it is not yet the sequencing system Gluon ultimately needs.

---

## Product Problem Statement

The current sequencer is strong enough to demonstrate the concept, but weak in the areas that matter for real musical work:

- groove depth is limited
- timing expression is limited
- pattern evolution tools are limited
- structural composition beyond looped step patterns is limited
- editing ergonomics are optimized for one narrow surface
- future integration with tracker, piano-roll, clips, or external DAWs would become awkward if the step grid remains the real model

The roadmap already points toward broader sequencing capabilities:

- canonical event model
- alternative editors such as tracker or timeline views
- processor chains and richer voice abstractions
- external integration such as Ableton Live

The sequencing strategy needs to support those directions without requiring a rewrite every phase.

---

## Strategic Recommendation

### Recommendation

Build a Gluon-native sequencing core on top of canonical regions and musical events, while keeping the existing step grid as a projection/editor.

### Do not do

- Do not treat the current step-grid pattern format as the long-term source of truth.
- Do not replace Gluon's sequencing model with an external tracker or sequencer application's internal data model.
- Do not rely on future Ableton control to compensate for weak native sequencing.
- Do not assume importing Mutable sequencer concepts eliminates the need for Gluon-owned sequencing architecture.

### Reuse selectively

- Reuse sequencing algorithms and pattern-generation ideas.
- Reuse external transport/control protocols where appropriate.
- Reuse UI/editor patterns where they fit Gluon's model.
- Reuse external runtimes as targets via adapters rather than as the core authoring model.

---

## Why Not Adopt an Existing Open-Source Sequencer

Open-source sequencers and trackers are useful references, but poor foundations for Gluon's core.

### Mismatch with Gluon's product model

Most sequencers assume one or more of the following:

- the sequencer owns the source of truth
- the user edits directly, not through an AI contract
- undo does not typically cover both human and AI actions in a unified stack
- timing/edit semantics are tightly coupled to a specific UI paradigm
- project structure is designed around clips, patterns, rows, or MIDI regions specific to that product

Gluon has different requirements:

- AI must edit stable musical abstractions
- human touches must override AI safely
- OFF voices remain visible but protected
- step grid, tracker, piano roll, and external clips should all be views/adapters over shared data
- sequencing decisions must align with the protocol and operation executor

### Integration cost is deceptive

Adopting an external sequencer looks cheaper until integration begins. In practice it usually forces Gluon to absorb:

- another data model
- another undo model
- another scheduling model
- another set of assumptions about voice ownership and timing
- another UI/editor worldview

That cost is usually higher than improving Gluon's own engine in a targeted way.

### Licensing and maintenance risk

Some attractive open-source music tools come with licensing, architectural, or maintenance constraints that make them poor candidates for becoming core product infrastructure.

Even when licensing is acceptable, a large upstream dependency can still become a strategic liability if Gluon has to bend its protocol and state model around that dependency.

---

## Reuse Strategy

Gluon should distinguish between three categories of reuse.

### 1. Algorithms and compositional behaviors

Good candidates for reuse:

- Euclidean rhythm generation
- probabilistic trigger generation
- mutation and variation rules
- ratcheting and fills
- pattern interpolation
- groove templates
- Mutable-inspired generative logic

These can be embedded into Gluon's engine or exposed as AI-callable operations without surrendering the core model.

### 2. External runtimes and targets

Good candidates for adapter integration:

- Ableton Live clip writing and transport control
- MIDI hardware sequencing targets
- future sampler or clip-launch environments

These should be outputs or peer runtimes, not the only place real sequencing happens.

### 3. Infrastructure utilities

Possible reuse areas:

- transport/timing utilities
- MIDI serialization/parsing
- clip export/import helpers
- editor widgets where they do not force a foreign data model

These should be adopted only if they fit Gluon's architecture cleanly.

---

## Design Principles

The sequencing roadmap should be evaluated against these principles.

### 1. Musical events are the foundation

Notes, triggers, and parameter changes are canonical. Step indices, tracker rows, and clip cells are representations.

### 2. Editors are projections

Step grid, tracker, piano roll, and clip/timeline views must read and write shared regions/events rather than becoming parallel state systems.

### 3. The human's hands always win

Any sequencing evolution must preserve arbitration rules and protect human input priority.

### 4. Undo stays one action away

All sequencing changes (human and AI) must remain undoable. AI-generated changes are grouped into coherent action groups, regardless of how many events or voices they touch.

### 5. Native sequencing must remain musically useful

External integration is additive. Gluon should still be able to make compelling music on its own.

### 6. Build the minimum core, not a DAW clone

The roadmap should expand expressive power without drifting into full arrangement, editing, and file-management complexity too early.

### 7. Reuse should reduce complexity, not relocate it

Adopt external code only where it decreases net system complexity after integration, not before.

---

## Scope

This section defines the work that belongs inside the sequencing initiative.

### In scope

- canonical sequencing model refinement around `Region` and `MusicalEvent`
- step-grid projection over canonical events
- timing engine improvements
- groove and expression improvements
- richer pattern operations for human and AI use
- alternative sequencing surfaces that project the same data
- adapter boundaries for external sequencing targets
- export/import pathways where they support the core workflow
- testing and validation infrastructure for timing and event conversions

### Out of scope

- building a full DAW arrangement engine in one step
- replacing Gluon's UX with a generic tracker or piano-roll app
- broad compatibility with arbitrary third-party project formats in the near term
- deep scoring/notation features
- full collaborative/multi-user sequencing
- every possible sequencing paradigm at once

---

## Capability Goals

The sequencing system should ultimately support the following capabilities.

### Timing and groove

- microtiming that actually affects playback
- swing that coexists cleanly with microtiming
- per-pattern and per-lane rhythmic feel
- variable playback direction and pattern start offset
- polymeter and polyrhythm across voices
- trigger probability and conditional steps
- ratchets, repeats, flam, and fills

### Pattern and clip structure

- multiple regions/clips per voice
- explicit pattern/clip boundaries
- copy, duplicate, extend, condense, and mutate operations
- variation management
- sparse editing over long sequences
- section-level transformations

### Event semantics

- note events
- trigger events
- parameter automation events
- control changes independent of note triggers
- sustained notes that are not forced into one-step gates

### Editing surfaces

- existing step-grid editor, improved but preserved
- future tracker-style editor
- future timeline/clip editor
- possible piano-roll style projection later if it proves necessary

### AI interaction

- AI can write musically meaningful events rather than only grid deltas
- AI can request scoped transformations such as simplify, add syncopation, create variation B, or thin the hats in bars 5-8
- AI operations remain bounded, explainable, and undoable

### External integration

- render canonical events to external clip formats or APIs
- drive Ableton or MIDI targets without changing the internal sequencing model
- ingest limited external structures where useful

---

## Non-Goals

The sequencing initiative should explicitly avoid these traps.

### Non-goal: full DAW parity

Gluon does not need to become a complete workstation with arrangement lanes, comping, audio warping, mixer automation, and browser-level plugin hosting before its sequencing is useful.

### Non-goal: tracker purity

A tracker view may become valuable, but Gluon should not contort the whole engine around tracker-row semantics.

### Non-goal: MIDI-first everything

MIDI is one adapter and interchange format. It is not a sufficient internal model for Gluon because it does not naturally express provenance, UI projections, or some of the higher-level operation semantics Gluon needs.

### Non-goal: one-shot replacement rewrite

The sequencing roadmap should be incremental and keep the product usable at every stage.

---

## Proposed Architecture Direction

### Core model

The canonical model should remain:

- `Voice` as the main musical actor today
- `Region` as a time-bounded container for content
- `MusicalEvent` as the content within regions

The current `Pattern.steps` representation should continue to exist only as:

- a projection for the current step-grid editor
- a compatibility layer during migration
- a convenient rendering form for certain operations

It should not remain the long-term sequencing authority.

### Engine responsibilities

The Gluon sequencing engine should own:

- event storage and validation
- region lifecycle
- time resolution and scheduling
- event-to-runtime conversion
- AI-facing editing operations
- undo snapshots for sequencing edits
- arbitration-aware application of edits

### Adapter responsibilities

Adapters should own:

- mapping canonical events to runtime-specific behaviors
- converting canonical pitch/control values into target-specific values
- exporting/importing to external devices or DAWs
- runtime capability declaration

### Editor responsibilities

Editors should:

- present useful views over canonical content
- emit canonical edits or edits convertible to canonical form
- remain disposable surfaces, not foundational data stores

---

## Major Workstreams

The roadmap should likely be cut along the following workstreams.

### Workstream 1: Canonical sequencing foundation

Goal:
Move sequencing authority from step patterns to regions/events cleanly enough that future editors and adapters do not require another model migration.

Includes:

- finalize `Region` semantics for current sequencing needs
- define event invariants clearly
- strengthen step/event round-tripping
- preserve existing UI behavior during migration
- establish execution/reporting paths for sequencing operations

Key outcome:
The step sequencer still works, but it is no longer the source of truth.

### Workstream 2: Timing engine and playback correctness

Goal:
Upgrade playback from a narrow Phase 2 scheduler into a robust timing engine that supports expressive sequencing features.

Includes:

- activate microtiming
- extend scheduling for non-grid event times
- validate swing plus micro interactions
- improve playback determinism under tempo changes and tab/background conditions
- prepare for probability/ratchet/conditional playback features

Key outcome:
Playback remains musically tight as sequencing becomes more expressive.

### Workstream 3: Pattern operations and musical transformation tools

Goal:
Give both humans and AI a richer set of transformations than direct step toggling.

Includes:

- duplicate, mutate, simplify, densify, humanize, invert, rotate, transpose
- pattern variation generation
- scoped edits over bars, voices, or regions
- compositional utilities inspired by Mutable and other groovebox workflows

Key outcome:
The AI can make useful musical changes without brute-force rewriting entire patterns every time.

### Workstream 4: Editing surfaces

Goal:
Support multiple sequencing workflows over the same underlying data.

Includes:

- improve current step-grid ergonomics
- define tracker-view requirements
- define timeline/clip-view requirements
- keep view-switching clean and bounded

Key outcome:
New editors can be added without introducing parallel state systems.

### Workstream 5: External adapters and interoperability

Goal:
Connect Gluon sequencing to external environments without externalizing the core model.

Includes:

- Ableton adapter exploration and scope
- MIDI output targets
- export/import boundaries
- capability declarations per adapter

Key outcome:
Gluon can sequence beyond itself without becoming dependent on another app's internal model.

### Workstream 6: Testing, validation, and quality infrastructure

Goal:
Make sequencing changes safe enough to evolve quickly.

Includes:

- event conversion tests
- scheduler/timing regression tests
- property-based tests where useful for round-tripping
- deterministic fixtures for AI sequencing actions
- performance and drift measurement

Key outcome:
Sequencing evolves without turning timing correctness into guesswork.

---

## Open-Source Option Assessment

This section records the current recommendation on reuse candidates.

### Adopt as core foundation

Recommendation: no current candidate.

Reason:
The cost of aligning a third-party sequencer's source-of-truth model with Gluon's canonical model, AI operations, undo behavior, and arbitration rules is likely higher than building the missing Gluon-native sequencing layers.

### Borrow ideas or algorithms from

- Mutable Instruments sequencing concepts such as probabilistic and generative pattern logic
- groovebox and tracker interaction patterns where they improve expressiveness
- established timing and transformation techniques from mature sequencers

Recommendation:
yes, selectively.

### Integrate as external target

- Ableton Live
- MIDI hardware and software instruments

Recommendation:
yes, via adapters.

### Use as implementation utility

- transport or timing libraries if they reduce maintenance burden without forcing a foreign model

Recommendation:
evaluate pragmatically, case by case.

---

## Success Criteria

The sequencing initiative is successful when all of the following are true.

### Product criteria

- Gluon can create musically convincing patterns and variations without leaving the app.
- The AI can make sequencing edits that feel intentional rather than mechanical.
- Human override remains immediate and reliable.
- Undo remains simple even when edits are structurally large.
- Users can work in more than one sequencing surface without model confusion.

### Technical criteria

- Canonical events and regions are the sequencing source of truth.
- Step-grid rendering remains stable as a projection of canonical data.
- Timing remains tight under expressive timing features.
- External adapters do not force changes to the core operation vocabulary.
- Sequencing changes are testable and regression-resistant.

### Strategic criteria

- Gluon gains sequencing depth without turning into a generic DAW.
- External integrations add reach without weakening the native product.
- New views and runtimes can be added incrementally.

---

## Risks

### Risk: overbuilding too early

If Gluon tries to build full clip, timeline, tracker, probability, polymeter, and DAW interoperability at once, the sequencing effort will sprawl and stall.

Mitigation:
phase the roadmap and define a clear minimum lovable sequencing core.

### Risk: step-grid lock-in

If the team continues adding features directly to `Pattern.steps` as the real model, future editors and adapters will get more expensive every month.

Mitigation:
finish the migration to canonical sequencing authority early.

### Risk: architecture purity slows useful musical progress

If the team spends too long on abstraction without shipping better musical outcomes, the product will remain theoretically elegant but practically weak.

Mitigation:
pair foundational work with visible musical capability gains in each phase.

### Risk: external integration becomes a distraction

Ableton and hardware integration are attractive, but they can consume roadmap attention while leaving the native instrument underpowered.

Mitigation:
treat external targets as adapters after the native sequencing core is clearly improving.

### Risk: AI edits become too broad or opaque

Richer sequencing power increases the blast radius of AI actions.

Mitigation:
keep operation scope explicit, execution reporting clear, and undo grouping coherent.

---

## Questions the Roadmap Must Resolve

The roadmap should answer these questions explicitly rather than leaving them implicit.

1. What is the minimum canonical sequencing milestone after which the step grid is only a view?
2. Which expressive timing features belong in the first sequencing upgrade, and which should wait?
3. When does tracker view become worth building versus continuing to improve the step grid?
4. What is the smallest useful scope for Ableton integration that proves the adapter model without derailing sequencing work?
5. Which transformation operations should be first-class engine operations rather than ad hoc AI behavior?
6. What testing harness is needed before timing and event semantics are expanded aggressively?
7. Where should Gluon draw the line between pattern sequencing and arrangement sequencing in the near term?

---

## Recommended Roadmap Shape

This is not the roadmap itself, but it is the recommended structure for one.

### Phase A: Canonical sequencing authority

Move source of truth to regions/events while keeping the current sequencer operational.

### Phase B: Expressive timing and playback

Activate microtiming and widen scheduling capability beyond fixed grid assumptions.

### Phase C: Musical transformation toolkit

Add variation, probability, ratchets, humanize, and other operations that make sequencing feel alive.

### Phase D: Second editor surface

Add one new sequencing surface, most likely tracker or clip/timeline, as a proof that the model supports multiple projections.

### Phase E: External sequencing adapter

Integrate one external runtime, most likely Ableton, to prove the adapter boundary without changing the core model.

---

## Immediate Next Step

The next planning step should be to convert this brief into a roadmap document with:

- phased milestones
- explicit dependencies
- acceptance criteria per milestone
- suggested PR/worktree boundaries
- test gates for each phase

That roadmap should stay constrained to the principles and boundaries defined here.
