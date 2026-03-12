# Gluon — Current Build Status

**As of:** 2026-03-12
**Phases complete:** Phase 1 (PoC), Phase 2 (Sequence & Layers), Canonical Musical Model, M0 (Stabilization), M1 (Sequencer Foundations), M2 (Sequencer Expressivity)
**Current product state:** Phase 3 core shipped, M0 + M1 + M2 complete, M3 in progress
**Near-term focus:** M3 sequencer surfaces (view layer landed, Ableton adapter spike next) + M5 UI layers
**Latest milestone:** M3 sequencer view layer — tracker + addable views (PR #88)
**Data model direction:** Canonical regions/events are the sequencing authority — `voice.pattern` is a derived projection. Tracker is the canonical truth view; step grid and other editors are addable surfaces.

---

## Current Snapshot

Gluon is a browser-based, AI-assisted instrument with:

- 4-voice Plaits WASM synthesis
- canonical region/event sequencing with step-grid projection
- event-centric tracker showing full canonical event list with inline editing
- addable sequencer views (step grid as default, piano roll placeholder)
- AI view operations (add_view, remove_view) — UI curation, no agency check
- microtiming, sub-step scheduling, and transformation primitives (M2)
- region invariants with validation and normalization
- session persistence with v1→v2 migration (views stripped as session-local)
- per-voice agency (AI-editable by default, human-protectable)
- grouped AI undo with provenance (AI-only undo contract)
- multi-view UI (Chat + Instrument)
- audio snapshot evaluation
- native Gemini function calling with tool use (move, sketch, listen, set_transport, set_model, transform, add_view, remove_view)

---

## Recent Merged PRs

| PR | Description | Merged |
|---|---|---|
| PR #88 | M3: sequencer view layer — tracker + addable views (#48, #49) | 2026-03-12 |
| PR #87 | M2: sequencer expressivity (#44, #45, #46, #47, #64, #84) | 2026-03-12 |
| PR #85 | M1: canonical regions as sequencing source of truth | 2026-03-12 |
| PR #86 | docs: AI capability doctrine | 2026-03-12 |
| PR #82 | Invert per-voice agency default | 2026-03-12 |
| PR #81 | Session persistence (localStorage) | 2026-03-12 |
| PR #39 | Docs positioning refresh | 2026-03-11 |
| PR #38 | Gemini native function calling, tool loop, listen tool, AI transport tools | 2026-03-11 |
| PR #36 | Audio snapshot evaluation / listen mode | 2026-03-11 |
| PR #35 | Polish pass — chat styling and status docs | 2026-03-11 |
| PR #34 | Audio quality audit — smoothing, trigger/gate, HEAPF32, scheduler fix | 2026-03-11 |
| PR #33 | Request lifecycle gating, thinking indicator, improved chat strip | 2026-03-11 |
| PR #32 | Undo button preview tooltip and post-undo chat feedback | 2026-03-11 |
| PR #31 | Gemini 3 migration | 2026-03-11 |
| PR #23–#30 | Canonical musical model implementation sequence | 2026-03-11 |

---

## M3: Sequencer Surfaces — In Progress

### Landed: Sequencer View Layer (PR #88)

Unified view layer architecture where the tracker is the canonical truth view and other editors are addable surfaces per-voice.

**Tracker (always present):**
- Event-centric: one row per event, not one row per step slot
- Shows exact fractional `at` positions — nothing hidden
- Inline editing: double-click to edit velocity, pitch, duration (Enter to commit, Escape to cancel)
- Delete button on hover, beat separators every 4 steps, playhead auto-scroll
- Color-coded by event kind: amber (trigger), emerald (note), blue (parameter)

**Addable views:**
- `SequencerViewConfig` on Voice with `views?: SequencerViewConfig[]`
- Step grid renders via `SequencerViewSlot` — add/remove with UI controls
- Transitional default: all voices start with a step-grid view for backward compatibility
- View state is presentation-only — not serialized, not part of musical state

**AI view operations:**
- `add_view` / `remove_view` tools — no agency check (UI curation, not musical mutation)
- `ViewSnapshot` for undo (AI view changes are undoable, human view changes are not)
- Views included in state compression so AI sees current view list
- Contextual prompt guidance: add step-grid after percussion sketches

**Event primitives:**
- `EventSelector` type mirroring dedup invariants (triggers unique per position, notes unique per position, parameters unique per position+controlId)
- `addEvent`, `removeEvent`, `updateEvent` — all write through `normalizeRegionEvents()` + `reprojectVoicePattern()`

#### Key files

| File | Role |
|---|---|
| `src/ui/Tracker.tsx` | Main tracker component — event list table |
| `src/ui/TrackerRow.tsx` | Single event row with inline editing |
| `src/ui/SequencerViewSlot.tsx` | Renders view from SequencerViewConfig |
| `src/engine/event-primitives.ts` | EventSelector, addEvent, removeEvent, updateEvent |
| `src/engine/view-primitives.ts` | addView, removeView |

### Remaining M3 issues

- #50 — Ableton sequencing adapter spike

---

## M2: Sequencer Expressivity — Complete

PR #87 merged all M2 issues (#44, #45, #46, #47, #64, #84).

### What changed

- **Microtiming**: Fractional `event.at` values for sub-step timing, windowed scheduler
- **Scheduler hardening**: Correct behavior under tempo changes, event-based windowed scheduling
- **Transformation primitives**: `rotate`, `transpose`, `reverse`, `duplicate` operating on canonical events
- **AI transform integration**: `transform` tool in the AI tool loop with prevalidation
- **Dynamic voice-setup prompt**: AI sees current voice configuration, classification, and agency state
- **Canonical state compression**: AI sees canonical event summaries (triggers, notes, param locks, density)

---

## M1: Sequencer Foundations — Complete

PR #85 merged all three M1 issues (#42, #43, #51). The sequencer now operates on canonical regions/events as the source of truth.

### What changed

- **Canonical regions as authority**: `voice.regions[0]` holds the musical truth. `voice.pattern` is always derived via `projectRegionToPattern()` / `reprojectVoicePattern()`.
- **Region invariants**: `validateRegion()` enforces structural rules (duration > 0, events sorted, within bounds, no collisions). `normalizeRegionEvents()` sorts and deduplicates on every write.
- **All write paths go through regions**: Both AI operations (operation-executor) and human edits (pattern-primitives) write to regions first, then project to pattern.
- **AI-only undo contract**: Human grid edits (gate, accent, param lock, length, clear) update regions but do not push undo snapshots. Only AI operations create undoable entries via `RegionSnapshot`.
- **Velocity-0 sentinel**: Disabled triggers use `velocity: 0` to preserve accent state across gate off/on cycles.
- **Hidden events stash**: `voice._hiddenEvents` stores out-of-range events when pattern length is shortened; merged back on expand; cleared on `clearPattern()`. Transient — not persisted.
- **Persistence v2**: Saves regions, re-projects pattern on load. v1 sessions (no regions) are migrated by hydrating regions from legacy step arrays.
- **Regression harness**: 33 sequencing regression tests + 7 canonical fixtures locking down round-trip fidelity, AI sketch execution, undo coherence, and scheduler timing.

#### Key files

| File | Role |
|---|---|
| `src/engine/region-helpers.ts` | Validation, normalization, factory |
| `src/engine/region-projection.ts` | Region → pattern projection |
| `src/engine/pattern-primitives.ts` | Human write path (regions-first, no undo) |
| `src/engine/operation-executor.ts` | AI write path (regions-first, RegionSnapshot undo) |
| `src/engine/persistence.ts` | v2 save/load with v1 migration |
| `src/engine/event-conversion.ts` | Bidirectional steps↔events with velocity-0 guard |
| `tests/engine/sequencing-regression.test.ts` | Regression harness |

### Test coverage

377 tests passing across 29 test files.

---

## Canonical Musical Model Status

The canonical musical model is fully operational and now serves as the sequencing authority.

### Landed

- **Canonical types** (`src/engine/canonical-types.ts`): `Region`, `MusicalEvent`, `ControlSchema`, `SemanticRole`, `ControlValue`/`ControlState`, `SourceAdapter`
- **Region helpers** (`src/engine/region-helpers.ts`): validation, normalization, factory functions with 10 enforced invariants
- **Region projection** (`src/engine/region-projection.ts`): `projectRegionToPattern()`, `reprojectVoicePattern()`
- **Instrument registry** (`src/audio/instrument-registry.ts`): 16 Plaits engines with semantic controls and runtime bindings
- **Operation executor** (`src/engine/operation-executor.ts`): canonical region writes, RegionSnapshot undo, execution reporting
- **Event conversion** (`src/engine/event-conversion.ts`): adapter-agnostic `stepsToEvents()` / `eventsToSteps()` with velocity-0 sentinel
- **Plaits adapter** (`src/audio/plaits-adapter.ts`): `SourceAdapter` with control validation and pitch conversion
- **Persistence** (`src/engine/persistence.ts`): v2 format with region authority, v1 migration

---

## What's Built

### AI Integration (`src/ai/`)

**Gemini Chat (`api.ts`)**
- `GluonAI` uses `@google/genai`, model `gemini-2.5-flash`
- Native Gemini function calling with multi-round tool loop
- Exchange-based history trimming for multi-turn coherence
- Cancellation support for stale requests and listen capture
- Backoff/rate-limit handling

**Tool Calling (`tool-declarations.ts`)**
- Declared tools: `move`, `sketch`, `listen`, `set_transport`, `set_model`, `transform`, `add_view`, `remove_view`
- Tool responses are prevalidated against live session state before returning success to the model
- `listen` is model-invoked rather than routed by regex intent detection

**System Prompt (`system-prompt.ts`)**
- Agentic assistant framing
- Tool-based workflow instructions rather than JSON-action formatting instructions
- Model reference and parameter space generated from the instrument registry
- Dynamic voice setup reflecting live session state
- Contextual view guidance for post-sketch view operations
- Scope control and agency rules remain explicit

**State Compression (`state-compression.ts`)**
- Compact project-state payload for each AI call
- Includes voices, pattern summaries, transport, undo depth, recent human actions, and view list per voice

**Audio Evaluation**
- Captures rendered audio, converts to WAV, sends critique request with separate listen prompt
- Exposed to the model through the `listen` tool in the main tool loop

### Engine / Protocol (`src/engine/`)

**Types (`types.ts`)**
- `Agency`: `'OFF' | 'ON'`
- `SequencerViewKind`, `SequencerViewConfig` — presentation state types
- `AIAction` union includes `move`, `say`, `sketch`, `set_transport`, `set_model`, `transform`, `add_view`, `remove_view`
- Undo snapshots: `ParamSnapshot`, `PatternSnapshot`, `TransportSnapshot`, `ModelSnapshot`, `RegionSnapshot`, `ViewSnapshot`
- `Voice` includes `regions: Region[]`, `views?: SequencerViewConfig[]`, `_hiddenEvents?`, `controlProvenance?`

**Operation Executor (`operation-executor.ts`)**
- Shared prevalidation path used by both the tool loop and executor
- AI sketch writes to canonical regions, validates, projects to pattern
- AI view operations (add_view, remove_view) — no agency check, ViewSnapshot undo
- Per-action validation through adapter + arbitration
- Provenance tracking under canonical control IDs
- Grouped undo entries with execution reports

**Event Primitives (`event-primitives.ts`)**
- `EventSelector` type for unique event identity within a region
- `addEvent`, `removeEvent`, `updateEvent` — granular event manipulation
- All write through `normalizeRegionEvents()` + `reprojectVoicePattern()`

**View Primitives (`view-primitives.ts`)**
- `addView`, `removeView` — presentation state only, no undo snapshots for human operations

**Pattern Primitives (`pattern-primitives.ts`)**
- Human write path: all edits go through regions first
- No undo snapshots pushed (AI-only undo contract)
- Gate toggle, accent toggle, param lock, length change, clear — all canonical

**Transformations (`transformations.ts`)**
- `rotate`, `transpose`, `reverse`, `duplicate` — operate on canonical events
- Pure functions returning new event arrays

**Undo**
- AI edits remain one undo away
- RegionSnapshot stores full `prevEvents` for simple revert
- ViewSnapshot stores `prevViews` for view operation revert
- Transport and model changes are undoable

**Persistence (`persistence.ts`)**
- v2 format: regions are authority, pattern is derived on load
- v1 migration: hydrates regions from legacy step arrays
- Strips transient state (_hiddenEvents, views, undo stack closures) before save
- Recovery hierarchy for corrupted saves

**Sequencer**
- Event-based windowed scheduler reading from `voice.regions[0].events`
- Step grid reads from `voice.pattern` (projected from regions)
- Fractional timing support for sub-step events

### UI (`src/ui/`)

**Views**
- `ChatView`: primary AI conversation surface
- `InstrumentView`: parameter space, tracker, addable view slots, transport, and compact chat strip
- View switching via `ViewToggle`

**Tracker**
- `Tracker.tsx`: event list table reading `region.events` directly
- `TrackerRow.tsx`: per-event row with inline editing, color-coded by kind
- Always present for the active voice — canonical truth view

**Sequencer View Slots**
- `SequencerViewSlot.tsx`: renders views from `voice.views` (step grid, piano roll placeholder)
- Add/remove controls for human view management
- AI can add/remove views via tool calls

**Chat UX**
- Thinking indicator
- Listening indicator during capture/evaluation
- Action logs shown inline in AI messages

**App Runtime (`App.tsx`)**
- `handleSend()` routes through the native tool-calling AI path
- Passes listen context, stale-request cancellation, and live action prevalidation to the AI layer
- `dispatchAIActions()` delegates to the operation executor and automation engine
- Event editing callbacks wired to tracker via event-primitives
- View add/remove callbacks wired via view-primitives

### Audio (`src/audio/`)

**Audio Engine**
- 4 voice slots, Web Audio API, 48kHz
- Sample-accurate `scheduleNote()` with per-step locks
- Media stream destination available for export/evaluation

**Audio Exporter**
- Can record browser output and capture N bars for evaluation
- WAV conversion path added for Gemini audio evaluation

**Plaits Runtime**
- Parameter smoothing landed
- Trigger/gate separation fixed
- HEAPF32 compatibility fix landed for current Emscripten behavior

---

## Open Backlog

### M0: Stabilization — Complete

All M0 issues closed.

**Remaining M0-adjacent (no milestone blocker):**
- #72 — migrate to gemini-3-flash when function calling stable (priority:next)

### M2: Sequencer Expressivity — Complete

All M2 issues closed (#44, #45, #46, #47, #64, #84).

### M3: Sequencer Surfaces + Integrations (1 remaining issue)

- ~~#48 — step-grid polish over canonical data~~ (closed, merged in PR #88)
- ~~#49 — second sequencing surface spike~~ (closed, merged in PR #88)
- #50 — Ableton sequencing adapter spike

### M4: Phase 4A Discovery (4 issues)

- #22 — implementation brief and issue breakdown
- #55 — Phase 4A gate decision
- #6 — Lyria integration + sampler voice engine
- #83 — expand AI patch-chain capability vocabulary

### M5: UI Layers (1 issue)

- #73 — three-layer UI model from AI-Curated Surfaces RFC

### Unassigned

- #8 — graceful AI model layer degradation

---

## Likely Next Work

### Two Parallel Streams

**Stream A — Sequencer (M3):** M2 is done. View layer landed (PR #88). Remaining: Ableton adapter spike (#50). Primarily `src/engine/`.

**Stream B — UI Layers (M5):** Three-layer UI model from the AI-Curated Surfaces RFC. Compact cards, expanded card layout, deep view. Issue #73. Primarily `src/ui/`. Runs in parallel — different module boundaries.

### Later: Phase 4A and AI-Curated Surfaces

Phase 4A discovery (M4) can begin planning anytime. Phase 4A implementation introduces patch chains. After chains exist and UI Layers are in place, the full AI-Curated Surfaces RFC can be implemented.

Dependency graph:

```
M0 ✓  M1 ✓  M2 ✓
  ├── M3 (Sequencer surfaces — view layer ✓, adapter spike remaining)
  ├── M5 (UI Layers — parallel with sequencer)
  └── M4 (Phase 4A Discovery)
        └── Phase 4A Implementation
              └── AI-Curated Surfaces (needs chains + UI Layers)
```

---

## Audio Snapshot Status

**Current shipped path:** discrete captured-audio evaluation via WAV snapshots

Audio self-evaluation is part of the product surface. The AI can invoke `listen` to capture and critique its own output.

---

## AI-Curated Surfaces

RFC at `docs/rfc-ai-curated-surfaces.md`. Key ideas:

- **Three-layer UI**: Stage (compact voice cards) → Semantic Surface (curated controls per voice) → Deep View (all raw parameters)
- **Semantic controls**: virtual controls that map to weighted combinations of raw params across a chain
- **AI as UI curator**: AI can propose surfaces, suggest pins, label axes — but never reconfigures UI without human approval
- **Same collaboration contract**: AI acts when asked, human's hands win, undo reverts UI changes too

Depends on M5 (UI Layers) and Phase 4A (patch chains).
