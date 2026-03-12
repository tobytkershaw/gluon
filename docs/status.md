# Gluon — Current Build Status

**As of:** 2026-03-12
**Phases complete:** Phase 1 (PoC), Phase 2 (Sequence & Layers), Canonical Musical Model, M0 (Stabilization), M1 (Sequencer Foundations)
**Current product state:** Phase 3 core shipped, M0 + M1 complete
**Near-term focus:** Two parallel streams: M2 sequencer expressivity + M5 UI layers
**Latest milestone:** M1 canonical regions as sequencing source of truth (PR #85)
**Data model direction:** Canonical regions/events are now the sequencing authority — `voice.pattern` is a derived projection

---

## Current Snapshot

Gluon is a browser-based, AI-assisted instrument with:

- 4-voice Plaits WASM synthesis
- canonical region/event sequencing (M1) with step-grid projection
- region invariants with validation and normalization
- session persistence with v1→v2 migration
- per-voice agency (AI-editable by default, human-protectable)
- grouped AI undo with provenance (AI-only undo contract)
- multi-view UI (Chat + Instrument)
- audio snapshot evaluation
- native Gemini function calling with tool use (move, sketch, listen, set_transport, set_model)

---

## Recent Merged PRs

| PR | Description | Merged |
|---|---|---|
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

### Key files

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

320 tests passing across 28 test files, including ~80 new tests from M1.

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
- `GluonAI` uses `@google/genai`, model `gemini-3-flash-preview`
- Thinking support via `thinkingConfig`
- Native Gemini function calling with multi-round tool loop
- Exchange-based history trimming for multi-turn coherence
- Cancellation support for stale requests and listen capture
- Backoff/rate-limit handling

**Tool Calling (`tool-declarations.ts`)**
- Declared tools: `move`, `sketch`, `listen`, `set_transport`, `set_model`
- Tool responses are prevalidated against live session state before returning success to the model
- `listen` is model-invoked rather than routed by regex intent detection

**System Prompt (`system-prompt.ts`)**
- Agentic assistant framing
- Tool-based workflow instructions rather than JSON-action formatting instructions
- Model reference and parameter space generated from the instrument registry
- Scope control and agency rules remain explicit

**State Compression (`state-compression.ts`)**
- Compact project-state payload for each AI call
- Includes voices, pattern summaries, transport, undo depth, and recent human actions

**Audio Evaluation**
- Captures rendered audio, converts to WAV, sends critique request with separate listen prompt
- Exposed to the model through the `listen` tool in the main tool loop

### Engine / Protocol (`src/engine/`)

**Types (`types.ts`)**
- `Agency`: `'OFF' | 'ON'`
- `AIAction` union includes `move`, `say`, `sketch`, `set_transport`, `set_model`
- Undo snapshots: `ParamSnapshot`, `PatternSnapshot`, `TransportSnapshot`, `ModelSnapshot`, `RegionSnapshot`
- `Voice` includes `regions: Region[]`, `_hiddenEvents?`, `controlProvenance?`

**Operation Executor (`operation-executor.ts`)**
- Shared prevalidation path used by both the tool loop and executor
- AI sketch writes to canonical regions, validates, projects to pattern
- Per-action validation through adapter + arbitration
- Provenance tracking under canonical control IDs
- Grouped undo entries with execution reports

**Pattern Primitives (`pattern-primitives.ts`)**
- Human write path: all edits go through regions first
- No undo snapshots pushed (AI-only undo contract)
- Gate toggle, accent toggle, param lock, length change, clear — all canonical

**Undo**
- AI edits remain one undo away
- RegionSnapshot stores full `prevEvents` for simple revert
- Transport and model changes are undoable

**Persistence (`persistence.ts`)**
- v2 format: regions are authority, pattern is derived on load
- v1 migration: hydrates regions from legacy step arrays
- Strips transient state (_hiddenEvents, undo stack closures) before save
- Recovery hierarchy for corrupted saves

**Sequencer**
- Step grid reads from `voice.pattern` (projected from regions)
- Scheduler reads from `voice.pattern` (no changes needed)
- `micro` exists in the data model but is still not active in playback

### UI (`src/ui/`)

**Views**
- `ChatView`: primary AI conversation surface
- `InstrumentView`: parameter space, step grid, transport, and compact chat strip
- View switching via `ViewToggle`

**Chat UX**
- Thinking indicator
- Listening indicator during capture/evaluation
- Action logs shown inline in AI messages

**App Runtime (`App.tsx`)**
- `handleSend()` routes through the native tool-calling AI path
- Passes listen context, stale-request cancellation, and live action prevalidation to the AI layer
- `dispatchAIActions()` delegates to the operation executor and automation engine

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

All M0 issues closed. Key PRs: #75 (state compression), #76 (UI bugs + BPM), #78 (ai-contract docs), #80 (tool loop composition).

**Remaining M0-adjacent (no milestone blocker):**
- #64 — derive AI voice-setup prompt from live session truth (priority:later)
- #72 — migrate to gemini-3-flash when function calling stable (priority:next)

### M2: Sequencer Expressivity (5 issues)

- #44 — microtiming and sub-step event scheduling
- #45 — scheduler correctness under tempo changes
- #46 — engine-level transformation primitives
- #47 — integrate transformations into AI execution
- #84 — expose canonical sequencing authority to AI

### M3: Sequencer Surfaces + Integrations (3 issues)

- #48 — step-grid polish over canonical data
- #49 — second sequencing surface spike
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

**Stream A — Sequencer (M2 → M3):** M1 is done. Next: microtiming (#44), scheduler hardening (#45), transformation primitives (#46, #47), expose canonical model to AI (#84). Primarily `src/engine/` and `src/audio/`.

**Stream B — UI Layers (M5):** Three-layer UI model from the AI-Curated Surfaces RFC. Compact cards, expanded card layout, deep view. Issue #73. Primarily `src/ui/`. Runs in parallel — different module boundaries.

### Later: Phase 4A and AI-Curated Surfaces

Phase 4A discovery (M4) can begin planning anytime. Phase 4A implementation introduces patch chains. After chains exist and UI Layers are in place, the full AI-Curated Surfaces RFC can be implemented.

Dependency graph:

```
M0 ✓  M1 ✓
  ├── M2 → M3 (Sequencer expressivity → surfaces)
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
