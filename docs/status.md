# Gluon — Current Build Status

**As of:** 2026-03-11
**Phases complete:** Phase 1 (PoC), Phase 2 (Sequence & Layers), Canonical Musical Model
**Current product state:** Phase 3 core shipped
**Near-term focus:** QA, backlog cleanup, status/doc cleanup, and prioritising the next execution slice
**Latest milestone:** Gemini native function calling + tool loop (PR #38)
**Data model direction:** Canonical Musical Model RFC adopted — see `docs/rfc-canonical-musical-model.md`

---

## Current Snapshot

Gluon is currently a browser-based, AI-assisted instrument with:

- 4-voice Plaits WASM synthesis
- step-grid sequencing
- canonical event abstraction under the AI path
- grouped AI undo with provenance
- multi-view UI (Chat + Instrument)
- audio snapshot evaluation
- native Gemini function calling with tool use

The project is ahead of the previous Phase 3 status snapshot. Audio evaluation is no longer “next”; it has landed. The main AI execution path is no longer text-to-JSON parsing; it now uses Gemini's native tool-calling flow.

---

## Recent Merged PRs

| PR | Description | Merged |
|---|---|---|
| PR #39 | Docs positioning refresh | 2026-03-11 |
| PR #38 | Gemini native function calling, tool loop, listen tool, AI transport tools | 2026-03-11 |
| PR #36 | Audio snapshot evaluation / listen mode | 2026-03-11 |
| PR #35 | Polish pass — chat styling and status docs | 2026-03-11 |
| PR #34 | Audio quality audit — smoothing, trigger/gate, HEAPF32, scheduler fix | 2026-03-11 |
| PR #33 | Request lifecycle gating, thinking indicator, improved chat strip | 2026-03-11 |
| PR #32 | Undo button preview tooltip and post-undo chat feedback | 2026-03-11 |
| PR #31 | Gemini 3 migration | 2026-03-11 |
| PR #23–#30 | Canonical musical model implementation sequence | 2026-03-11 |
| PR #12 | Multi-view UI + action log | 2026-03-11 |
| PR #11 | Remove reactive model | 2026-03-11 |

---

## Canonical Musical Model Status

The canonical musical model implementation sequence is merged.

### Landed

- **Canonical types** (`src/engine/canonical-types.ts`): `ControlSchema`, `SemanticRole`, `ControlValue`/`ControlState`, `MusicalEvent`, `SourceAdapter`, canonical operation types
- **Instrument registry** (`src/audio/instrument-registry.ts`): 16 Plaits engines with semantic controls and runtime bindings
- **Operation executor** (`src/engine/operation-executor.ts`): engine-layer operation execution, validation, provenance, grouped undo support, execution reporting
- **Event conversion** (`src/engine/event-conversion.ts`): adapter-agnostic `stepsToEvents()` / `eventsToSteps()`
- **Plaits adapter** (`src/audio/plaits-adapter.ts`): first `SourceAdapter` implementation with control validation and pitch conversion
- **Protocol migration**: AI-facing sequencing/control edits can use canonical control IDs and event-based sketches
- **AI contract doc** (`docs/ai-contract.md`): inference-time contract for the AI layer
- **Registry cleanup**: `PLAITS_MODELS` collapsed into registry-derived export

### Implication

The architectural foundation for future sequencing work is in place. The next sequencing work should build on canonical regions/events and adapters rather than expanding `Pattern.steps` as the real source of truth.

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
- Declared tools: `move`, `sketch`, `listen`, `set_transport`
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

**Response Parser (`response-parser.ts`)**
- Legacy fallback only; no longer the primary AI execution path

**Audio Evaluation**
- Audio snapshot evaluation landed in PR #36
- Captures rendered audio, converts to WAV, sends critique request with separate listen prompt
- Exposed to the model through the `listen` tool in the main tool loop

### Engine / Protocol (`src/engine/`)

**Types (`types.ts`)**
- `Agency`: `'OFF' | 'ON'`
- `AIAction` union includes `move`, `say`, `sketch`, `set_transport`
- Undo snapshots now include transport snapshots alongside param/pattern snapshots

**Operation Executor (`operation-executor.ts`)**
- Shared prevalidation path used by both the tool loop and executor
- Per-action validation through adapter + arbitration
- Provenance tracking under canonical control IDs
- Grouped undo entries with execution reports

**Undo**
- AI edits remain one undo away
- Transport changes are undoable

**Sequencer**
- Step-grid sequencing remains the current UI surface
- `micro` exists in the data model but is still not active in playback
- Scheduler remains the Phase 2-style main-thread lookahead scheduler

### UI (`src/ui/`)

**Views**
- `ChatView`: primary AI conversation surface
- `InstrumentView`: parameter space, step grid, transport, and compact chat strip
- View switching via `ViewToggle`

**Chat UX**
- Thinking indicator
- Listening indicator during capture/evaluation
- Action logs shown inline in AI messages
- Improved chat styling and action hierarchy

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

## Phase 3 Status

| Step | Description | Status | Notes |
|---|---|---|---|
| Step 1 | Remove reactive model | Done | PR #11 |
| Step 2 | Multi-view UI + action log | Done | PR #12 |
| Canonical Model | Types, registry, executor, event abstraction, AI contract | Done | PRs #23–#30 |
| Gemini 3 | API migration | Done | PR #31 |
| Undo UX | Tooltip + post-undo feedback | Done | PR #32 |
| Chat UX | Request lifecycle + thinking | Done | PR #33 |
| Audio | Quality audit | Done | PR #34 |
| Polish | Styling + docs refresh | Done | PR #35 |
| Step 4 | Audio snapshot evaluation / listen mode | Done | PR #36 |
| AI Runtime | Native Gemini function calling + tools | Done | PR #38 |
| Docs | Positioning refresh | Done | PR #39 |

**Summary:** The core Phase 3 agentic assistant is shipped. The app now supports canonical-model-backed AI edits, multi-view workflow, audio snapshot evaluation, and native Gemini function calling with tools.

---

## Sequencer Status

The current sequencer is functional, but still clearly a Phase 2/3 implementation rather than the final sequencing architecture.

### What is true now

- step grid is the only production editing surface
- AI can sketch using canonical events
- event abstraction exists
- grouped undo and arbitration work with sequencing edits
- transport is AI-addressable

### What is still missing

- canonical regions/events as the clear sequencing source of truth behind the UI
- audible microtiming
- richer timing/groove features
- transformation-style sequencing operations
- second sequencing surface
- external sequencing adapter proof
- broader sequencing regression harness

See:

- `docs/gluon-sequencer-brief.md`
- `docs/gluon-sequencer-implementation-plan.md`

---

## Audio Snapshot Status

**Original spike model:** `gemini-2.5-flash-native-audio-preview-12-2025`
**Current shipped path:** discrete captured-audio evaluation via WAV snapshots

### Status

- The project no longer depends on a continuous-live-audio spike to provide audio critique
- A practical product path has landed: render/capture a short clip, send it with a critique-only prompt, and return text assessment

### Implication

Audio self-evaluation is now part of the product surface, not just an experiment.

---

## Likely Next Work

The highest-signal near-term work is now:

1. backlog cleanup and status/doc cleanup
2. Phase 3 QA and polish
3. selecting the next implementation slice from the sequencer plan

The sequencer backlog now exists as issues `#42`–`#51`, which should be treated as the main roadmap for sequencing-specific follow-on work.
