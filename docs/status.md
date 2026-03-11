# Gluon — Current Build Status

**As of:** 2026-03-11
**Phases complete:** Phase 1 (PoC), Phase 2 (Sequence & Layers)
**In progress:** Phase 3, Step 1 (Remove Reactive Model) — PR #11
**Next:** Phase 3, Step 2+
**Latest spike:** Gemini Native Audio — SUCCESS
**Data model direction:** Canonical Musical Model RFC adopted — see `docs/rfc-canonical-musical-model.md`

---

## What's Built

### AI Integration (`src/ai/`)

**Gemini Chat (`api.ts`)**
- `GluonAI` class using `@google/genai` SDK, model `gemini-2.5-flash`
- Single mode: `ask()` (human-prompted) — AI only responds when asked
- Stateful chat session per API key
- Backoff/rate-limit handling with exponential delay

**System Prompt (`system-prompt.ts`)**
- Agentic assistant framing — AI makes changes when asked, does not act autonomously
- Defines 3 action types: `move`, `sketch`, `say`
- Covers 4 voices (v0–v3) with default models (kick, bass, lead, pad)
- Full Plaits model reference (0–15), parameter space docs
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
- Validates 3 action types: move, sketch, say
- Safe failure (empty array on parse error)

**Automation (`automation.ts`)**
- Smooth parameter drift for `move` actions with `over` timing
- RAF loop interpolation, callback-driven

### Engine / Protocol (`src/engine/`)

**Types (`types.ts`)**
- `Agency`: `'OFF' | 'ON'` (2-state)
- `Voice`: id, engine, model, params, agency, pattern, mute/solo
- `SynthParamValues`: harmonics, timbre, morph, note (all 0.0–1.0)
- `AIAction` union: move, say, sketch
- `Snapshot`: ParamSnapshot or PatternSnapshot
- `Session`: voices[], activeVoiceId, transport, undoStack, context, messages[], recentHumanActions[]

**Session (`session.ts`)**
- 4 default voices with preset models
- Agency setter, param/model updates, mute/solo, transport

**Undo (`undo.ts`)**
- Simple stack of Snapshot objects, max 100
- Push/pop semantics

**Arbitration (`arbitration.ts`)**
- Tracks touch records per voice+param with timestamp
- 500ms cooldown, `canAIAct()` / `getHeldParams()`
- Human's hands always win

**Primitives (`primitives.ts`)**
- `applyMove()` / `applyMoveGroup()`: Direct param changes (undoable)
- `applySketch()`: Applies pattern sketch immediately + pushes undo snapshot
- `applyParamDirect()`: Raw param set (used by automation drift)
- `applyUndo()`: Reverts last AI action

**Sequencer**
- `Step`: gate, accent, params (per-step locks), micro timing
- `Pattern`: steps[] + length
- `PatternSketch`: sparse change description for AI proposals
- `Scheduler`: drives note scheduling from pattern + tempo

### UI (`src/ui/`)

**App (`App.tsx`)**
- Manages session state, audio setup, AI instance, scheduler, arbitrator, automation
- `handleSend()`: human message → AI ask → dispatch actions
- `dispatchAIActions()`: applies move, sketch, say actions
- Keyboard shortcuts: Cmd+Z undo, Space play/pause

**Chat Panel (`ChatPanel.tsx`)**
- Human/AI message display, text input, auto-scroll
- Minimal dark UI (mono font, zinc/amber)

**Agency Toggle (`AgencyToggle.tsx`)**
- 2-button: OFF | ON (per voice, teal styling for ON)

**Other Components**
- `ModelSelector`, `ParameterSpace`, `PitchControl`
- `VoiceSelector` (switching + mute/solo, OFF/ON agency badge)
- `TransportBar` (play/pause, BPM, swing, recording)
- `StepGrid` (16-step with pagination), `PatternControls`
- `Visualiser` (FFT analyser)
- `UndoButton`, `ApiKeyInput`

### Audio (`src/audio/`)

**Audio Engine (`audio-engine.ts`)**
- Web Audio API, 48kHz, 4 voice slots
- Each voice: synth (Plaits WASM) → accentGain → muteGain → mixer → analyser → output
- Sample-accurate `scheduleNote()` with per-step param locks
- `getMediaStreamDestination()` — stream available for recording

**Audio Exporter (`audio-exporter.ts`)**
- Records MediaStream to WebM (opus), start/stop with blob download

**Synth / WASM**
- Plaits C++ compiled to WASM via Emscripten
- Runs in AudioWorklet

---

## Phase 3 Step 1: Remove Reactive Model (DONE — PR #11)

All reactive jam-partner machinery has been removed:

| Removed | Replacement |
|---|---|
| Agency: OFF / SUGGEST / PLAY | Agency: OFF / ON |
| Leash slider (0.0–1.0) | Removed — AI doesn't act autonomously |
| Reactive loop (15s `react()` calls) | Removed — AI only responds to human prompts |
| 5 action types (move, suggest, audition, sketch, say) | 3 action types (move, sketch, say) |
| Pending actions (suggest/audition/sketch queues) | Sketches apply immediately, undo to revert |
| PendingOverlay, LeashSlider, ListenerSpike components | Deleted |
| listener.ts (native audio spike) | Deleted (spike complete, will reintegrate in later step) |

**Files deleted:** `LeashSlider.tsx`, `PendingOverlay.tsx`, `ListenerSpike.tsx`, `listener.ts`
**Net change:** -1,001 lines across 19 files. All 189 tests pass.

---

## Remaining Phase 3 Steps

| Step | Description | Status |
|---|---|---|
| Step 2 | Chat-first UI | Not started |
| Step 3 | Audio snapshot rendering | Not started |
| Step 4 | Audio eval integration | Not started |
| Step 5 | Listen-then-judge loop | Not started |
| Step 6 | Action log in chat | Not started |
| Step 7 | Improved undo UX | Not started |

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
