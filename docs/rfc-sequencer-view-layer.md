# Gluon RFC: Sequencer View Layer

## Status

Draft RFC for architectural alignment.

Related docs:

- `docs/rfc-canonical-musical-model.md` — canonical event model and “editors are views” principle
- `docs/gluon-sequencer-brief.md` — sequencing strategy and product boundaries
- `docs/gluon-sequencer-implementation-plan.md` — phased sequencing roadmap
- `docs/rfc-ai-curated-surfaces.md` — UI curation model and voice-surface architecture
- `docs/ai-interface-design-principles.md` — AI interface posture

---

## Product Thesis

Gluon's sequencing UI should stop pretending that one editor can faithfully represent every kind of musical content.

The canonical sequencing truth is already `Region.events: MusicalEvent[]`. The UI should reflect that reality:

- the **tracker** is the always-available canonical inspection and editing view
- other sequencer views such as **step grid** and **piano roll** are optional projections over the same events
- those optional views are part of the voice's curated surface, and are therefore UI tools that both the human and the AI can add when useful

This RFC does **not** make the tracker the source of truth. The source of truth remains canonical event data. The tracker is the most direct human-readable projection of that truth.

That distinction matters:

- canonical data stays stable across all sequencing surfaces
- the tracker provides legibility and editability without becoming a second model
- the AI can use sequencing views as communication tools, not just sound-editing tools

---

## Why This RFC Exists

M2 made the sequencing model richer:

- fractional event positions
- note events with pitch and duration
- canonical event-aware playback
- AI-facing summaries derived from canonical events

But the UI still centers one lossy surface: the step grid.

That creates a mismatch:

- the engine can play expressive timing the human cannot clearly see
- the AI can write richer event structures than the UI can inspect directly
- the product says “editors are views,” but the current UX still feels “grid first”

This RFC resolves that mismatch by defining a view-layer model for sequencing that fits the canonical musical model and the curated-surfaces RFC.

---

## Core Framing

### 1. Canonical data remains the foundation

`Region.events` is the sequencing truth.

Sequencer views do not own or duplicate musical content. They project it and write back through canonical edit operations.

### 2. The tracker is the canonical human-readable view

The tracker is always available for any voice with a region.

Its role is:

- show exact event truth
- support dense event inspection
- support direct event editing
- provide the reliable “what is really happening?” answer when other views compress or filter the data

### 3. Other sequencer views are optional tools

Step grid, piano roll, and future timeline/clip or automation views are task-specific surfaces.

They should be:

- addable
- removable
- derived from the same canonical region data
- placed alongside other voice-surface elements rather than treated as the only sequencer mode

### 4. Sequencer views are part of UI curation

The curated-surfaces RFC already says the AI's toolkit includes UI curation, not just parameter changes.

Sequencer views belong in that category.

The AI should be able to:

- add a step grid to a drum voice after writing a rhythmic pattern
- add a piano roll to a melodic voice after writing notes
- remove an unhelpful view to reduce clutter

The human should be able to do the same directly.

### 5. Tracker and optional views are not mutually exclusive modes

This is not “switch between tracker and step grid.”

This is:

- tracker always available
- optional additional views added when helpful
- one canonical event model underneath all of them

That makes the tracker an inspection/edit anchor and the other views contextual helpers.

---

## Design Principles

### 1. Truth is always one view away

No sequencer projection should become so convenient that the product loses a reliable, inspectable event-level view.

The tracker is that reliable view.

### 2. Views are tools, not silos

A step grid is good for toggling hits quickly.
A piano roll is good for pitch and duration shape.
A tracker is good for dense event truth.

These are different tools over one shared model, not separate editing worlds.

### 3. Projection fidelity should be explicit

Views differ in what they preserve and what they hide.

- tracker: minimal loss
- step grid: intentionally lossy
- piano roll: note-centric, parameter-blind

That should be understood in both UI and implementation.

### 4. The AI uses views to communicate

If the AI just wrote a complex rhythmic pattern with locks, adding a step grid or tracker is part of making the change legible.

If the AI just wrote a pitched phrase, adding a piano roll is part of making the result inspectable.

Sequencer views are therefore not only human affordances; they are part of AI-human collaboration.

### 5. UI curation is separate from musical mutation

Adding or removing a view does not change sound.

That means sequencer-view operations should be treated as UI actions, not musical edits, even when initiated by the AI.

### 6. The abstraction earns its place

This RFC does not propose a general docking/layout system for all future UI.

It defines only what Gluon needs now:

- one always-present tracker
- a small set of addable sequencer views
- canonical writeback through existing region/event paths

---

## The Sequencer View Set

### Tracker

Question it answers:

“What events actually exist in this region?”

Role:

- canonical inspection view
- dense event editor
- baseline truth for every voice

What it shows well:

- exact event positions
- note pitch
- note duration
- trigger velocity/accent
- parameter events
- fractional timing

What it does not optimize for:

- rapid grid toggling
- spatial pitch drawing
- large-scale arrangement structure

### Step Grid

Question it answers:

“What fires at each quantized slot?”

Role:

- quick rhythmic editing tool
- especially useful for drum and percussion voices

What it shows well:

- per-slot trigger activity
- high-level pattern shape
- quick muting/toggling/accent editing

What it hides:

- exact sub-step timing
- exact event order at the same position
- note durations as first-class objects

### Piano Roll

Question it answers:

“Where are the notes in pitch × time?”

Role:

- melodic note editing tool
- note duration and interval editing

What it shows well:

- pitched note relationships
- note durations
- melodic contour

What it hides:

- parameter-event detail
- trigger-only patterns

### Future Views

Deferred:

- clip/timeline view
- automation lane view
- arrangement/launcher views

These become relevant when Gluon has multi-region composition and broader arrangement workflows.

---

## Relationship To The Curated Surfaces RFC

The curated-surfaces RFC defines a voice surface as a composed working surface for the human.

This RFC extends that model for sequencing.

### Sequencer views are voice-surface elements

They should live alongside:

- semantic controls
- pinned raw controls
- XY pad
- chain strip

They are not separate application modes.

### Tracker is baseline, not optional

The tracker is the sequencing equivalent of the deep-inspection guarantee in the curated-surfaces RFC.

It should always be available because it is the direct inspection path for canonical event truth.

### Optional views are curated additions

Step grid and piano roll are addable voice-surface elements.

That means the voice surface concept expands naturally:

```ts
type SequencerViewKind = 'step-grid' | 'piano-roll';

interface SequencerViewConfig {
  kind: SequencerViewKind;
  id: string;
}

interface VoiceSurface {
  semanticControls: SemanticControlDef[];
  pinnedControls: PinnedControl[];
  xyAxes: { x: string; y: string };
  thumbprint: ThumbprintConfig;
  sequencerViews: SequencerViewConfig[];
}
```

The tracker is not represented in `sequencerViews` because it is implicit and always available.

### AI view operations are UI curation operations

For sequencing, the AI's UI curation vocabulary should include operations like:

```ts
interface AIAddViewAction {
  type: 'add_view';
  voiceId: string;
  viewKind: SequencerViewKind;
  description: string;
}

interface AIRemoveViewAction {
  type: 'remove_view';
  voiceId: string;
  viewId: string;
  description: string;
}
```

These are not musical mutations. They are legibility operations.

---

## AI Role In Sequencer Views

### What the AI should be able to do

- add a step grid to a voice after writing a drum pattern
- add a piano roll to a voice after writing melodic notes
- remove an unnecessary view to reduce clutter
- use view changes as part of making its work inspectable

### What the AI should not do

- constantly reshuffle views
- add views unsolicited when there is no clear benefit
- treat view changes as substitutes for explaining musical changes
- hide the tracker or make the truthful view unavailable

### Proposed posture

Sequencer view operations should be:

- immediate
- reversible
- session-local
- undoable when initiated by the AI

This differs from larger persistent surface proposals in the curated-surfaces RFC, which may require explicit approval.

The reasoning is narrower here:

- adding a sequencer view is low-risk
- it is easily dismissed by the human
- its purpose is legibility, not structural UI redefinition

---

## View Semantics And Contracts

Every sequencing view should obey the same contract:

```ts
interface SequencerProjection<ViewState, ViewEdit> {
  project(region: Region): ViewState;
  applyEdit(region: Region, edit: ViewEdit): Region;
}
```

This should remain a conceptual contract even if the implementation uses ordinary helpers rather than a formal interface type immediately.

### Tracker

Projection:

- near-direct rendering of the event list
- preserves exact `at`, event kind, and event fields

Edit model:

- direct event add/remove/update

### Step Grid

Projection:

- quantized step-based summary over region content
- intentionally lossy

Edit model:

- gate/accent/lock edits translated back into canonical event mutations

### Piano Roll

Projection:

- notes filtered into pitch/time rectangles

Edit model:

- note add/remove/move/resize translated back into canonical note-event edits

---

## Tracker Semantics

The tracker should be event-centric, not slot-centric.

That means:

- one row per event
- sorted by canonical event order
- exact displayed event positions
- no artificial empty grid rows as the primary representation

This is important because M2 made fractional timing a real part of the model. A row-per-slot tracker would immediately collapse that precision back into a step-grid mindset.

### Event identity

Tracker editing needs a stable way to refer to events.

An event selector model is appropriate:

```ts
type EventSelector =
  | { at: number; kind: 'trigger' }
  | { at: number; kind: 'note' }
  | { at: number; kind: 'parameter'; controlId: string };
```

This fits current sequencing invariants:

- one trigger per position
- one note per position per voice
- one parameter event per `(position, controlId)`

### Editing scope

Initial tracker editing should support:

- edit note pitch
- edit velocity
- edit note duration
- edit parameter-event value
- delete events
- add events with explicit position entry

The insertion flow should not invent hidden microtiming implicitly. If insertion is seeded from an adjacent row, the exact `at` value should still be visible and editable before commit.

---

## Transitional Implementation Shape

This RFC does not require immediate full `VoiceSurface` adoption.

An acceptable transitional implementation is:

- tracker rendered directly in the current instrument/voice workspace
- addable sequencer views stored temporarily as lightweight presentation state on `Voice`
- those addable views excluded from persistence and musical-state logic
- later migration into `VoiceSurface.sequencerViews`

That is a pragmatic implementation path, not the desired long-term ownership boundary.

---

## Observation: The Pattern May Extend Beyond Sequencing

The sequencer view layer established a pattern: canonical state projected through addable, removable UI tools available to both human and AI. That pattern is not specific to sequencing.

The XY pad is a 2D projection of parameter state. The visualiser is a projection of audio state. Semantic controls from the curated-surfaces RFC are projections of aggregated chain parameters. All of these read from canonical state, write through canonical primitives, and could be managed as addable surfaces with the same `add`/`remove` vocabulary.

If this pattern proves durable, the natural evolution is to unify sequencer views and parameter surfaces under a single model — replacing `SequencerViewKind` with a broader `SurfaceKind` that includes `'xy-pad'`, `'semantic-surface'`, `'waveform'`, etc. The `VoiceSurface.sequencerViews` field would become `VoiceSurface.surfaces` or similar.

This RFC does not propose that unification. It has not been validated beyond sequencing, and premature generalisation would add abstraction without evidence. But the seam is visible, and worth noting so that future surface work can evaluate whether the pattern holds.

---

## Proposed Delivery Shape

### Phase 1: Tracker

- read-only tracker over canonical events
- tracker editing through canonical event operations

### Phase 2: Addable view infrastructure

- step grid becomes an optional addable view
- tracker remains always present
- optional sequencer views rendered as voice-surface elements

### Phase 3: AI view operations

- `add_view`
- `remove_view`
- sequencing views included in AI-visible state
- prompt guidance for when the AI should use them

### Phase 4: Piano roll

- first non-grid, non-tracker additional sequencer projection

---

## Acceptance Criteria

This RFC is successful when:

1. The human always has a truthful event-level sequencing view.
2. The step grid is no longer the implied primary source of sequencing truth in the UX.
3. Additional sequencer views can be added without introducing a second sequencing model.
4. Sequencer views fit cleanly into the curated-surfaces architecture.
5. The AI can use sequencer views as legibility tools, not just sound-editing tools.

---

## Non-Goals

This RFC does not define:

- a complete tracker interaction design for every keyboard shortcut and editing gesture
- piano roll implementation details
- arrangement or clip-launcher UI
- a general-purpose windowing/docking system
- replacement of the canonical event model

---

## Summary

The canonical sequencing truth stays in `Region.events`.

The tracker becomes the always-available canonical inspection and edit view over that truth.

Step grid, piano roll, and later sequencing surfaces become optional UI tools that can be added by either the human or the AI as part of the curated voice surface.

That gives Gluon a sequencing UI architecture that is:

- faithful to the canonical musical model
- compatible with AI-curated surfaces
- legible after AI edits
- extensible without creating parallel sequencer state
