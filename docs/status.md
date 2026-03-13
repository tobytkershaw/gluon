# Gluon — Current Build Status

**As of:** 2026-03-13
**Phases complete:** Phase 1 (PoC), Phase 2 (Sequence & Layers), Canonical Musical Model, M0 (Stabilization), M1 (Sequencer Foundations), M2 (Sequencer Expressivity)
**Current product state:** Phase 3 core shipped, M0–M2 complete, M3 view layer landed, M4 in progress
**Near-term focus:** M4 First Chain (Rings WASM, chain routing, structure tools) + M5 UI layers
**Latest milestone:** AI structure tools — add_processor/remove_processor (PR #99), Rings WASM + processor chain (PR #98)
**Data model direction:** Canonical regions/events are the sequencing authority — `voice.pattern` is a derived projection. Tracker is the canonical truth view; step grid and other editors are addable surfaces.

---

## Current Snapshot

Gluon is a browser-based, AI-assisted instrument with:

- 4-voice Plaits WASM synthesis
- Rings WASM resonator as first processor module
- processor chain architecture: source → processor(s) → gain staging
- AI structure tools: add_processor / remove_processor with undoable ProcessorSnapshot
- canonical region/event sequencing with step-grid projection
- event-centric tracker showing full canonical event list with inline editing
- addable sequencer views (step grid as default, piano roll placeholder)
- AI view operations (add_view, remove_view) — UI curation, no agency check
- microtiming, sub-step scheduling, and transformation primitives (M2)
- region invariants with validation and normalization
- session persistence with v1→v2 migration
- per-voice agency (AI-editable by default, human-protectable)
- unified undo: all actions (human and AI) reversible in LIFO order, with action groups
- multi-view UI (Chat + Instrument)
- audio snapshot evaluation
- native Gemini function calling with tool use (move, sketch, listen, set_transport, set_model, transform, add_view, remove_view, add_processor, remove_processor)

---

## Recent Merged PRs

| PR | Description | Merged |
|---|---|---|
| PR #99 | AI structure tools: add_processor / remove_processor (#96) | 2026-03-13 |
| PR #98 | Rings WASM + processor chain + audio engine integration (#94, #95) | 2026-03-13 |
| PR #97 | Unified undo: make human edits undoable (#89) | 2026-03-13 |
| PR #88 | M3: sequencer view layer — tracker + addable views (#48, #49) | 2026-03-12 |
| PR #87 | M2: sequencer expressivity (#44, #45, #46, #47, #64, #84) | 2026-03-12 |
| PR #85 | M1: canonical regions as sequencing source of truth | 2026-03-12 |
| PR #86 | docs: AI capability doctrine | 2026-03-12 |
| PR #82 | Invert per-voice agency default | 2026-03-12 |
| PR #81 | Session persistence (localStorage) | 2026-03-12 |
| PR #39 | Docs positioning refresh | 2026-03-11 |
| PR #38 | Gemini native function calling, tool loop, listen tool, AI transport tools | 2026-03-11 |
| PR #36 | Audio snapshot evaluation / listen mode | 2026-03-11 |

---

## M4: First Chain — In Progress

Prove modular chains end-to-end: Rings as first processor module, chain routing, human undo across the stack.

### Landed: AI Structure Tools (PR #99)

`add_processor` / `remove_processor` in the AI tool loop so the AI can wire up processor modules on a voice's chain.

- `AIAddProcessorAction` / `AIRemoveProcessorAction` with prevalidation (agency check, type/ID validity)
- `ProcessorSnapshot` for undoable chain operations
- Processor ID generated once in tool loop, reused by projection and execution (closes same-turn composition gap)
- Compressed state includes `processors` array per voice; system prompt documents Rings models and chain guidance
- Function response returns assigned `processorId` so AI can reference it in later same-turn calls

### Landed: Rings WASM + Processor Chain (PR #98)

- Mutable Instruments Rings compiled to WASM (57KB binary)
- AudioWorklet with sub-block event scheduling, C ABI wrapper with smoothed params
- Audio engine processor chain: `sourceOut` routing, `addProcessor`/`removeProcessor` with async in-flight dedupe
- 6 resonator models, 4 normalized controls, SourceAdapter with 1:1 control mapping
- Session sync via `voice.processors` → audio engine reconciliation

### Landed: Unified Undo (PR #97)

All edits (human and AI) push undo snapshots. Replaces the old AI-only undo contract.

- `RegionSnapshot` for step-grid and tracker edits (with `prevHiddenEvents` for length changes)
- `ParamSnapshot` with `prevProvenance` for control source attribution
- `ActionGroupSnapshot` for grouping multi-target gestures (e.g., XY pad + param lock)
- `setStepParamLock` suppresses per-frame undo during continuous drags
- View add/remove push `ViewSnapshot`

### Remaining M4 Issues

- #22 — Phase 4A implementation brief

---

## M3: Sequencer Surfaces — View Layer Complete

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
- View state is presentation-only — persisted but not part of musical state

**AI view operations:**
- `add_view` / `remove_view` tools — no agency check (UI curation, not musical mutation)
- `ViewSnapshot` for undo (view changes are undoable)
- Views included in state compression so AI sees current view list
- Contextual prompt guidance: add step-grid after percussion sketches

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
- Declared tools: `move`, `sketch`, `listen`, `set_transport`, `set_model`, `transform`, `add_view`, `remove_view`, `add_processor`, `remove_processor`
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
- Includes voices, pattern summaries, transport, undo depth, recent human actions, view list, and processor chain per voice

### Engine / Protocol (`src/engine/`)

**Types (`types.ts`)**
- `Agency`: `'OFF' | 'ON'`
- `SequencerViewKind`, `SequencerViewConfig` — presentation state types
- `ProcessorConfig` — processor chain state per voice
- `AIAction` union includes `move`, `say`, `sketch`, `set_transport`, `set_model`, `transform`, `add_view`, `remove_view`, `add_processor`, `remove_processor`
- Undo snapshots: `ParamSnapshot`, `PatternSnapshot`, `TransportSnapshot`, `ModelSnapshot`, `RegionSnapshot`, `ViewSnapshot`, `ProcessorSnapshot`, `ActionGroupSnapshot`
- `Voice` includes `regions`, `views?`, `processors?`, `_hiddenEvents?`, `controlProvenance?`

**Undo**
- Unified: all actions (human and AI) reversible in LIFO order
- `ActionGroupSnapshot` for multi-target gestures
- `RegionSnapshot` stores full `prevEvents` + optional `prevHiddenEvents`
- `ParamSnapshot` stores `prevProvenance` for control source attribution
- View, transport, and model changes are undoable

### Audio (`src/audio/`)

**Audio Engine**
- 4 voice slots, Web Audio API, 48kHz
- Processor chain: source → sourceOut → [processors] → accentGain → muteGain → mixer
- `addProcessor` / `removeProcessor` with async in-flight dedupe and cancellation
- Sample-accurate `scheduleNote()` with per-step locks
- Media stream destination available for export/evaluation

**Plaits Runtime**
- Parameter smoothing, trigger/gate separation, HEAPF32 compatibility

**Rings Runtime**
- WASM resonator processor taking audio input
- Sub-block event scheduling in AudioWorklet
- 6 resonator models, 4 normalized controls
- Session sync via `voice.processors` → audio engine reconciliation

---

## Open Backlog

### M4: First Chain (1 remaining issue)

- #22 — Phase 4A implementation brief

### M3: Sequencer Surfaces (1 remaining issue)

- #50 — Ableton sequencing adapter spike

### M5: UI Layers (1 issue)

- #73 — three-layer UI model from AI-Curated Surfaces RFC

### Unassigned

- #72 — migrate to gemini-3-flash when function calling stable
- #8 — graceful AI model layer degradation

---

## Likely Next Work

### Two Parallel Streams

**Stream A — First Chain (M4):** Rings WASM, processor chain, and AI structure tools all landed (PRs #98, #99). The AI can now add/remove Rings on any voice. Remaining: implementation brief (#22).

**Stream B — UI Layers (M5):** Three-layer UI model from the AI-Curated Surfaces RFC. Compact cards, expanded card layout, deep view. Issue #73. Primarily `src/ui/`. Runs in parallel — different module boundaries.

### Later: AI-Curated Surfaces

After chains exist and UI Layers are in place, the full AI-Curated Surfaces RFC can be implemented.

Dependency graph:

```
M0 ✓  M1 ✓  M2 ✓
  ├── M3 (Sequencer surfaces — view layer ✓, adapter spike remaining)
  ├── M5 (UI Layers — parallel with sequencer)
  └── M4 (First Chain — Rings WASM ✓, chain routing ✓, structure tools ✓)
        └── AI-Curated Surfaces (needs chains + UI Layers)
```
