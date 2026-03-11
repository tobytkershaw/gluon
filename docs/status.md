# Gluon — Current Build Status

**As of:** 2026-03-11
**Phases complete:** Phase 1 (PoC), Phase 2 (Sequence & Layers), Canonical Musical Model (all 8 PRs merged)
**In progress:** Phase 3 — Agentic Music Assistant
**Next:** Polish pass, status docs, then optional audio eval (PR-F)
**Latest milestone:** Audio quality audit (PR #34) — parameter smoothing, trigger/gate fix, scheduler double-hit fix
**Data model direction:** Canonical Musical Model RFC adopted — see `docs/rfc-canonical-musical-model.md`

---

## Canonical Musical Model — Implementation Status

| PR | Description | Status |
|---|---|---|
| PR-0 | Docs cleanup | Merged |
| PR-1 | Canonical types (`canonical-types.ts`) | Merged |
| PR-2 | Instrument registry + consumer migration | Merged |
| PR-3 | System prompt from registry | Merged |
| PR-4 | Operation executor + provenance | Merged |
| PR-5 | Event abstraction, Plaits adapter, protocol migration | Merged |
| PR-6 | Collapse `PLAITS_MODELS` | Merged |
| PR-7 | AI contract doc | Merged |

### What landed

- **Canonical types** (`src/engine/canonical-types.ts`): ControlSchema, SemanticRole, ControlValue/ControlState, MusicalEvent (trigger/note/parameter), SourceAdapter interface, AIOperation union, ExecutionReport
- **Instrument registry** (`src/audio/instrument-registry.ts`): 16 Plaits engines with 4 semantic controls each (brightness→timbre, richness→harmonics, texture→morph, pitch→note). Bidirectional control mapping. All consumers migrated.
- **Operation executor** (`src/engine/operation-executor.ts`): Engine-layer operation dispatch with per-action validation, adapter-based control resolution, provenance tracking (canonical IDs), undo grouping. Returns execution report for UI consumption.
- **Event conversion** (`src/engine/event-conversion.ts`): Generic `stepsToEvents`/`eventsToSteps` with injected pitch and control-ID mapping. Adapter-agnostic — no Plaits imports.
- **Plaits adapter** (`src/audio/plaits-adapter.ts`): First `SourceAdapter` implementation. Validates controls, converts MIDI↔normalised pitch, delegates to registry.
- **Protocol migration**: Parser accepts both legacy (`param`/`pattern.steps`) and canonical (`controlId`/`events[]`) shapes. System prompt teaches canonical syntax with semantic control names.
- **Provenance**: `Voice.controlProvenance` tracks who set each control (human/ai/default), keyed by canonical controlId. Undo restores both values and provenance.
- **PLAITS_MODELS collapsed** (`src/audio/synth-interface.ts`): Derived from instrument registry via `getModelList()`. Registry is single source of truth.
- **AI contract doc** (`docs/ai-contract.md`): Inference-time reference — type definitions, serialised state format, semantic controls, worked examples, validation invariants.

---

## What's Built

### AI Integration (`src/ai/`)

**Gemini Chat (`api.ts`)**
- `GluonAI` class using `@google/genai` SDK, model `gemini-3-flash-preview`
- Thinking support: `thinkingConfig: { thinkingLevel: 'MEDIUM' }`
- Full model `Content` preservation in history (retains `thoughtSignature` fields for multi-turn coherence)
- Single mode: `ask()` (human-prompted) — AI only responds when asked
- Stateful chat session per API key
- Backoff/rate-limit handling with exponential delay
- Request lifecycle gating: sequence-tagged requests prevent stale responses, all composers disabled during flight

**System Prompt (`system-prompt.ts`)**
- Agentic assistant framing — AI makes changes when asked, does not act autonomously
- Defines 3 action types: `move`, `sketch`, `say`
- Model reference and parameter space generated from instrument registry
- Canonical action syntax: semantic control names (brightness, richness, texture, pitch), MusicalEvent-based sketches
- Scope control rule (minimal and local edits by default)
- Agency rule (OFF voices can be observed but not modified)

**State Compression (`state-compression.ts`)**
- Compact JSON of session state (~2–3KB per call)
- Voices → id, model name, params (2dp), agency, mute/solo, pattern
- Pattern → active_steps, accents, locks
- Transport, context, undo depth, recent 5 human actions

**Response Parser (`response-parser.ts`)**
- Parses JSON action arrays from AI responses
- Handles markdown code blocks, strict type validation
- Accepts both legacy and canonical action shapes (backward compatible)
- Per-kind event validation for canonical sketches
- Safe failure (empty array on parse error)

**Automation (`automation.ts`)**
- Smooth parameter drift for `move` actions with `over` timing
- RAF loop interpolation, callback-driven

### Engine / Protocol (`src/engine/`)

**Types (`types.ts`)**
- `Agency`: `'OFF' | 'ON'` (2-state)
- `Voice`: id, engine, model, params, agency, pattern, mute/solo, controlProvenance
- `SynthParamValues`: harmonics, timbre, morph, note (all 0.0–1.0)
- `AIAction` union: move (accepts param or controlId), say, sketch (accepts pattern or events)
- `Snapshot`: ParamSnapshot (with prevProvenance) or PatternSnapshot
- `Session`: voices[], activeVoiceId, transport, undoStack, context, messages[], recentHumanActions[]

**Canonical Types (`canonical-types.ts`)**
- ControlSchema, ControlBinding, ControlValue, ControlState
- MusicalEvent discriminated union (NoteEvent, TriggerEvent, ParameterEvent)
- SourceAdapter interface (read/write paths, pitch conversion, validation)
- AIOperation union, ExecutionReport

**Operation Executor (`operation-executor.ts`)**
- Per-action validation through adapter (agency, arbitration, control resolution)
- Adapter-based control ID resolution (runtime↔canonical) with round-trip verification
- Provenance tracking under canonical controlIds
- Undo snapshot grouping with prevProvenance for restore
- Execution report: accepted/rejected/log/resolvedParams

**Session (`session.ts`)**
- 4 default voices with preset models
- Agency setter, param/model updates, mute/solo, transport
- Registry-derived default provenance per voice

**Undo (`undo.ts`)**
- Simple stack of Snapshot objects, max 100
- Push/pop semantics
- Post-undo chat feedback ("Undid: <description>")

**Arbitration (`arbitration.ts`)**
- Tracks touch records per voice+param with timestamp
- 500ms cooldown, `canAIAct()` / `getHeldParams()`
- Human's hands always win

**Primitives (`primitives.ts`)**
- `applyMove()` / `applyMoveGroup()`: Direct param changes (undoable)
- `applySketch()`: Applies pattern sketch immediately + pushes undo snapshot
- `applyParamDirect()`: Raw param set (used by automation drift)
- `applyUndo()`: Reverts last AI action (restores params AND provenance)

**Event Conversion (`event-conversion.ts`)**
- `stepsToEvents()` / `eventsToSteps()`: adapter-agnostic conversion
- Pitch and control-ID mapping injected as options
- Preserves ungated param locks (automation on silent steps)

**Sequencer**
- `Step`: gate, accent, params (per-step locks), micro timing
- `Pattern`: steps[] + length
- `PatternSketch`: sparse change description for AI proposals
- `Scheduler`: drives note scheduling from pattern + tempo

### UI (`src/ui/`)

**App (`App.tsx`)**
- Manages session state, audio setup, AI instance, scheduler, arbitrator, automation
- Uses `createPlaitsAdapter()` for operation execution
- `handleSend()`: human message → AI ask → dispatch actions
- `dispatchAIActions()`: delegates to operation executor, handles drift animation from execution report
- Request lifecycle gating with sequence tagging (prevents concurrent sends, stale responses)
- Keyboard shortcuts: Cmd+Z undo, Space play/pause

**Two-View Layout**
- `InstrumentView`: parameter space, step grid, transport, model selector, visualiser, compact chat strip
- `ChatView`: full chat panel with API key config, compact transport controls
- Tab / Cmd+1 / Cmd+2 switching via `ViewToggle`

**Chat Panel (`ChatPanel.tsx`)**
- Human/AI message display, text input, auto-scroll
- Thinking indicator (pulsing "Thinking..." during AI requests)
- Action logs with visual hierarchy (teal left-border, indented)
- Minimal dark UI (mono font, zinc/amber/teal)

**Agency Toggle (`AgencyToggle.tsx`)**
- 2-button: OFF | ON (per voice, teal styling for ON)

**Other Components**
- `ModelSelector`, `ParameterSpace`, `PitchControl`
- `VoiceSelector` (switching + mute/solo, OFF/ON agency badge)
- `TransportBar` (play/pause, BPM, swing, recording)
- `StepGrid` (16-step with pagination), `PatternControls`
- `Visualiser` (FFT analyser)
- `UndoButton` (with preview tooltip showing pending undo description), `ApiKeyInput`

### Audio (`src/audio/`)

**Audio Engine (`audio-engine.ts`)**
- Web Audio API, 48kHz, 4 voice slots
- Each voice: synth (Plaits WASM) → accentGain → muteGain → mixer → analyser → output
- Sample-accurate `scheduleNote()` with per-step param locks
- `getMediaStreamDestination()` — stream available for recording

**Audio Exporter (`audio-exporter.ts`)**
- Records MediaStream to WebM (opus), start/stop with blob download

**Instrument Registry (`instrument-registry.ts`)**
- 16 Plaits engine definitions with semantic controls
- Bidirectional mapping: controlId ↔ runtime param
- Model list, engine lookup, control schema access

**Plaits Adapter (`plaits-adapter.ts`)**
- `SourceAdapter` implementation for Plaits WASM
- Control validation (canonical + runtime param names, value range)
- MIDI ↔ normalised pitch conversion
- Event conversion with injected Plaits-specific mappings

**Synth / WASM**
- Plaits C++ compiled to WASM via Emscripten
- Runs in AudioWorklet
- One-pole lowpass parameter smoothing (prevents clicks on parameter jumps)
- Trigger/gate separation (trigger is one-block pulse, level follows gate)
- `HEAPF32` exported via `EXPORTED_RUNTIME_METHODS` for Emscripten 5.x compatibility

**Plaits Audit (`plaits-audit.ts`)**
- Audit scenarios for all 16 Plaits models (sustain, percussion, param sweeps)
- Buffer metrics: peak, RMS, max delta
- Used for reference comparison between native and WASM builds

---

## Phase 3 Progress

| Step | Description | Status | Notes |
|---|---|---|---|
| Step 1 | Remove reactive model | Done | PR #11 |
| Gemini 3 | API migration | Done | PR #31 — `gemini-3-flash-preview`, thinking config, thought signature preservation |
| Undo UX | Tooltip + post-undo feedback | Done | PR #32 — undo button preview, "Undid: ..." chat message |
| Chat UX | Request lifecycle + thinking | Done | PR #33 — sequence-tagged requests, thinking indicator, empty-response fallback |
| Audio | Quality audit | Done | PR #34 — parameter smoothing, trigger/gate fix, HEAPF32 export, scheduler double-hit |
| Polish | Dead code sweep + styling | Done | PR #35 — no dead code found, chat message styling improved |
| Step 4 | Audio snapshot evaluation | Not started | Optional. Requires audio format conversion (WebM→OGG/WAV) and listen-mode prompt isolation. |

---

## Spike Results: Gemini Native Audio

**Model:** `gemini-2.5-flash-native-audio-preview-12-2025`
**Method:** Gemini Live API (`bidiGenerateContent`), PCM audio chunks from AudioWorklet

**Findings:**
- Model correctly identified: single voice, sustained tone, bright/metallic character of Plaits
- Gave different descriptions at different moments — genuinely listening to the stream
- Answers offset by ~1 question (audio response first, transcription lags)
- `outputAudioTranscription: {}` required to get text from audio responses
- `responseModalities: [Modality.AUDIO]` required (TEXT alone rejected by native audio models)
- Only `gemini-2.5-flash-native-audio-*` models support `bidiGenerateContent`

**Implication for Phase 3:** Audio eval works. The integration path is: render clip → send as inline audio to Gemini → get text assessment. For Phase 3 this should be a discrete call (not continuous streaming) — render a few bars, send the buffer, get back a text evaluation.
