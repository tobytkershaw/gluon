# Gluon — Current Build Status

**As of:** 2026-03-14
**Phases complete:** Phase 1 (PoC), Phase 2 (Sequence & Layers), Canonical Musical Model, M0 (Stabilization), M1 (Sequencer Foundations), M2 (Sequencer Expressivity), M3 (View Layer), M4 (First Chain + Phase 4A), Phase 4B (Modulation / Tides), M5 Steps 1-4 (UI Layers foundation), M5 Wave 1 (Layout + Project Persistence)
**Current product state:** Three-column layout (chat | main | tracks), multi-project IndexedDB persistence, collapsible chat sidebar
**Near-term focus:** M5 Wave 2 (mix bus, pause/stop), then 5B (parameter & patch navigation)
**Latest milestone:** M5 Wave 1 — layout restructuring + project persistence (PR #169)
**Data model direction:** Canonical regions/events are the sequencing authority — `voice.pattern` is a derived projection. Tracker is the canonical truth view; step grid and other editors are addable surfaces.

---

## Current Snapshot

Gluon is a browser-based, AI-assisted instrument with:

- 4-voice Plaits WASM synthesis
- Rings WASM resonator + Clouds WASM granular processor
- Tides WASM function generator (LFO/envelope modulator)
- Processor chain architecture: source → processor(s) → gain staging (max 2 processors per voice)
- Modulation architecture: Tides → GainNode(depth) → target AudioParam (max 2 modulators per voice)
- AI tools (15): move, sketch, listen, set_transport, set_model, transform, add_view, remove_view, add_processor, remove_processor, replace_processor, add_modulator, remove_modulator, connect_modulator, disconnect_modulator
- Processor and modulator control authority: AI can target params and models via `processorId`/`modulatorId` on move/set_model
- Chain validation layer: structural rules enforced via registry-driven validator (processors + modulators)
- Module inspector: clickable chain strip, param sliders, mode selector, remove button
- Modulation routing: human sets center, modulation adds around it; multiple routings to same param sum additively
- Unified undo across human and AI actions (gesture-based for sliders)
- Canonical region/event sequencing with step-grid projection
- Event-centric tracker showing full canonical event list with inline editing
- Addable sequencer views (step grid as default, piano roll placeholder)
- AI view operations (add_view, remove_view) — UI curation, no agency check
- Microtiming, sub-step scheduling, and transformation primitives (M2)
- Region invariants with validation and normalization
- Multi-project persistence via IndexedDB with export/import (.gluon JSON)
- Session versioning with v1→v2→v3 migration, shared across localStorage and IndexedDB paths
- Per-voice agency (AI-editable by default, human-protectable)
- Three-column layout: collapsible chat sidebar (left), main content (center), track list (right)
- Two view modes: Instrument + Tracker (chat is a persistent sidebar, not a view)
- Audio snapshot evaluation
- Native Gemini function calling with tool use

---

## Recent Merged PRs

| PR | Description | Merged |
|---|---|---|
| PR #169 | M5 Wave 1: layout restructuring (chat sidebar, track list, three-column shell) + multi-project IndexedDB persistence | 2026-03-14 |
| PR #168 | M0 Stabilization: scheduler float-fix, voice-scoped automation, agency button | 2026-03-13 |
| PR #133 | fix: scheduler skips disabled steps, first-beat timing race, accent restore | 2026-03-13 |
| PR #113 | Phase 4B: Tides WASM modulation, AI modulation tools, modulator UI | 2026-03-13 |
| PR #112 | M5 Steps 1-4: TrackSurface types, VoiceStage, ExpandedVoice, DeepView | 2026-03-13 |
| PR #111 | Phase 4A: Clouds WASM, module inspector, chain editing, replace_processor (#102–#104) | 2026-03-13 |
| PR #109 | Processor control authority + chain validation (#100, #101) | 2026-03-13 |
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

## M0: Stabilization — Complete

Pre-M5 QA pass fixing priority:now blockers.

### Landed: M0 Blocker Burn-Down (PR #168)

- **#121 — Agency button missing in Instrument/Tracker views:** `onToggleAgency` prop threaded through InstrumentView and TrackerView to VoiceStage. Agency (C) button now visible and functional in all view modes.
- **#130 — XY pad / slider values revert on mouse-up:** AutomationEngine rewritten to key by `(trackId, param)` instead of param-only. Each param handler cancels only the exact automation being touched. `arbRef.current.canAIAct(trackId, param)` guards automation callbacks as second defense. Fixes #132 (spontaneous param drift) as a side-effect.
- **#153 — First sequencer step silent on loops 2-3:** Root cause: IEEE 754 floating-point accumulation in scheduler cursor. After ~20 ticks, cursor overshoots exact multiples of regionLen by ~1e-15, causing `lowerBound` to skip events at step 0. Fixed with epsilon guard in `getLocalSegments`: `if (localStart > 0 && localStart < 1e-9) localStart = 0`.

### Landed: QA Audio Fixes (PR #133)

- Transport stop reliability, first-step silence on initial play, accent gain restore after stop/start cycles.

---

## Phase 4B: Modulation / Tides — Complete

Added modulation as a new module kind: control-rate signal generators routed to parameters on source and processor modules.

### Landed: Tides WASM + Modulation Runtime (PR #113)

- **Tides WASM:** MI Tides v2 PolySlopeGenerator compiled to WASM (77KB). C ABI wrapper mapping normalized params to DSP. 3 modes (AD, Looping, AR), 4 controls (frequency, shape, slope, smoothness).
- **AudioWorklet modulation plumbing:** Custom k-rate `mod-*` AudioParams on Plaits, Rings, and Clouds worklets. Target worklet `process()` reads modulation AudioParams and applies as offset to base values before WASM render.
- **Audio engine routing:** TidesEngine lifecycle management, GainNode-based depth scaling, AudioParam connection/disconnection. Route IDs threaded from session state through to audio engine for stable sync. Keep-alive pattern prevents GC.
- **Modulation semantics:** Human sets center (knob position), modulation adds/subtracts around it. Multiple routings to same param sum via Web Audio. Effective value clamped to 0–1.
- **Data model:** `ModulatorConfig`, `ModulationTarget` (discriminated union), `ModulationRouting` on Voice. `ModulatorSnapshot`, `ModulatorStateSnapshot`, `ModulationRoutingSnapshot` for undo. 4 new AI action types + `modulatorId` on move/set_model.
- **Chain validation:** Max 2 modulators per voice, registered type check, target validity (no pitch modulation), depth range -1 to 1, route uniqueness (idempotent connect_modulator).
- **AI tools (4 new):** `add_modulator`, `remove_modulator`, `connect_modulator` (idempotent), `disconnect_modulator`. Pre-assigned IDs for same-turn composition.
- **UI:** Modulator badges in ChainStrip (violet accent), ControlSection blocks with mode selector + sliders + remove button, routing display as text chips.
- **Persistence:** Modulators and modulations persist on Voice; validated on load.

---

## M4: First Chain + Phase 4A — Complete

Prove modular chains end-to-end: two processor types, full AI control authority, human chain editing, and structural validation.

### Landed: Phase 4A — Clouds, Inspector, Replace (PR #111)

- **Clouds WASM (#102):** MI Clouds compiled to WASM — 4 processing modes (granular, pitch-shifter, looping-delay, spectral), 4 normalized controls (position, size, density, feedback). Registry-driven audio engine generalized from Rings-only to multi-processor.
- **Chain strip (#103a):** Read-only `[Source] → [Processor]` badge display using registry labels.
- **Module inspector + chain editing (#103b):** Clickable processor badges with selection highlight. Inspector panel with param sliders (from registry), mode selector dropdown, and remove button. Human edits create ProcessorStateSnapshot with gesture-based undo (single snapshot per drag, not per frame).
- **replace_processor (#104):** Atomic swap tool — snapshot prev chain, replace at same index, single undo step. Pre-assigned newProcessorId for same-turn composition honesty.
- **System prompt:** Processor module docs auto-generated from registry.

### Landed: Processor Control Authority + Chain Validation (PR #109)

- **Processor control authority (#100):** `move` and `set_model` accept optional `processorId` to target processor controls/modes. Separate resolution paths: source via controlIdToRuntimeParam, processor via registry. ProcessorStateSnapshot captures full prev state for undo.
- **Chain validation (#101):** Pure registry-driven validator — max 2 processors, type existence, no duplicate IDs, param/model name validation. AI-readable errors for self-correction.
- Timed moves (`over`) rejected for processor controls.

### Landed: AI Structure Tools (PR #99)

`add_processor` / `remove_processor` in the AI tool loop so the AI can wire up processor modules on a voice's chain.

- `AIAddProcessorAction` / `AIRemoveProcessorAction` with prevalidation (agency check, type/ID validity)
- `ProcessorSnapshot` for undoable chain operations
- Processor ID generated once in tool loop, reused by projection and execution (closes same-turn composition gap)
- Compressed state includes `processors` array per voice; system prompt documents chain guidance
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
- `ActionGroupSnapshot` for multi-target gestures (e.g., XY pad + param lock)
- `setStepParamLock` suppresses per-frame undo during continuous drags
- View add/remove push `ViewSnapshot`

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
- 15 declared tools: `move`, `sketch`, `listen`, `set_transport`, `set_model`, `transform`, `add_view`, `remove_view`, `add_processor`, `remove_processor`, `replace_processor`, `add_modulator`, `remove_modulator`, `connect_modulator`, `disconnect_modulator`
- Tool responses are prevalidated against live session state before returning success to the model
- `listen` is model-invoked rather than routed by regex intent detection

**System Prompt (`system-prompt.ts`)**
- Agentic assistant framing
- Tool-based workflow instructions rather than JSON-action formatting instructions
- Model reference and parameter space generated from the instrument registry
- Module docs auto-generated from registry (Plaits, Rings, Clouds, Tides)
- Dynamic voice setup reflecting live session state (including modulators + routings)
- Contextual view guidance for post-sketch view operations
- Modulation guidance: shallow depths, common routings, workflow patterns
- Scope control and agency rules remain explicit

**State Compression (`state-compression.ts`)**
- Compact project-state payload for each AI call
- Includes voices, pattern summaries, transport, undo depth, recent human actions, view list, processor chain, modulators, and modulation routings per voice (with model names and param values)

### Engine / Protocol (`src/engine/`)

**Types (`types.ts`)**
- `Agency`: `'OFF' | 'ON'`
- `SequencerViewKind`, `SequencerViewConfig` — presentation state types
- `ProcessorConfig` — processor chain state per voice
- `ModulatorConfig`, `ModulationTarget`, `ModulationRouting` — modulation state per voice
- `AIAction` union includes `move`, `say`, `sketch`, `set_transport`, `set_model`, `transform`, `add_view`, `remove_view`, `add_processor`, `remove_processor`, `replace_processor`, `add_modulator`, `remove_modulator`, `connect_modulator`, `disconnect_modulator`
- Undo snapshots: `ParamSnapshot`, `PatternSnapshot`, `TransportSnapshot`, `ModelSnapshot`, `RegionSnapshot`, `ViewSnapshot`, `ProcessorSnapshot`, `ProcessorStateSnapshot`, `ModulatorSnapshot`, `ModulatorStateSnapshot`, `ModulationRoutingSnapshot`, `ActionGroupSnapshot`
- `Voice` includes `regions`, `views?`, `processors?`, `modulators?`, `modulations?`, `_hiddenEvents?`, `controlProvenance?`, `surface`

**Chain Validation (`chain-validation.ts`)**
- Pure registry-driven structural rules: max 2 processors, max 2 modulators, type existence, no duplicate IDs
- `validateChainMutation` for topology changes, `validateProcessorTarget` for param/model targeting
- `validateModulatorMutation`, `validateModulationTarget`, `validateModulatorTarget` for modulation operations
- AI-readable error strings for self-correction

**Undo**
- Unified: all actions (human and AI) reversible in LIFO order
- `ActionGroupSnapshot` for multi-target gestures
- `RegionSnapshot` stores full `prevEvents` + optional `prevHiddenEvents`
- `ParamSnapshot` stores `prevProvenance` for control source attribution
- `ProcessorSnapshot` for chain topology changes, `ProcessorStateSnapshot` for param/model changes
- `ModulatorSnapshot` for modulator topology changes, `ModulatorStateSnapshot` for param/model changes, `ModulationRoutingSnapshot` for routing changes
- Gesture-based undo for sliders (capture on pointerdown, push on pointerup)
- View, transport, and model changes are undoable

### Audio (`src/audio/`)

**Audio Engine**
- 4 voice slots, Web Audio API, 48kHz
- Processor chain: source → sourceOut → [processors] → accentGain → muteGain → mixer
- Modulation routing: Tides AudioWorkletNode → GainNode(depth) → target AudioParam
- `addProcessor` / `removeProcessor` with async in-flight dedupe and cancellation
- `addModulator` / `removeModulator` with keep-alive GainNode pattern
- `addModulationRoute` / `removeModulationRoute` with canonical ID threading
- Multi-processor type dispatch (Rings, Clouds)
- Sample-accurate `scheduleNote()` with per-step locks
- Media stream destination available for export/evaluation

**Plaits Runtime**
- Parameter smoothing, trigger/gate separation, HEAPF32 compatibility
- Custom k-rate `mod-*` AudioParams for modulation input (brightness/richness/texture, not pitch)

**Rings Runtime**
- WASM resonator processor taking audio input
- Sub-block event scheduling in AudioWorklet
- 6 resonator models, 4 normalized controls
- Custom k-rate `mod-*` AudioParams for modulation input

**Clouds Runtime**
- WASM granular processor (MI Clouds DSP)
- 4 processing modes: granular, pitch-shifter, looping-delay, spectral
- 4 normalized controls: position, size, density, feedback
- Float↔int16 conversion for ShortFrame I/O
- Sub-block event scheduling in AudioWorklet
- Custom k-rate `mod-*` AudioParams for modulation input

**Tides Runtime**
- WASM function generator (MI Tides v2 PolySlopeGenerator, 77KB)
- 3 modes: AD (one-shot), Looping (free-running LFO), AR (sustained)
- 4 controls: frequency (0.01–20 Hz exponential), shape, slope, smoothness
- Audio output (-1..+1) routed to target AudioParams via GainNode depth scaling
- No audio input — generates modulation signal only

### UI (`src/ui/`)

**App shell (M5 Wave 1)**
- **AppShell:** Three-column layout — collapsible chat sidebar (left), main content (center), track list (right)
- **ChatSidebar:** Persistent left sidebar. Expanded: w-80 with API key header + ChatPanel. Collapsed: floating ChatComposer input at bottom-left with unread badge, thinking/listening indicators
- **TrackList / TrackRow:** Vertical voice sidebar (right). Per-track: thumbprint dot, label, agency indicator, M/S/C buttons. Replaces horizontal VoiceStage from top bar
- **ProjectMenu:** Dropdown in project bar — create, rename, duplicate, delete, export (.gluon), import. Inline rename, project list with relative timestamps
- **useShortcuts:** Extracted keyboard handler — Cmd+1/2 views, Cmd+/ chat toggle, Tab cycle, Space play/stop, Cmd+Z undo
- **useProjectLifecycle:** Project load/save/switch hook with auto-save debounce, loading guard, IndexedDB error fallback
- Two view modes: `'instrument' | 'tracker'` (ChatView removed)

**Three-layer voice model (M5 Steps 1-4)**
- **Layer 1 — TrackRow:** Compact voice row with thumbprint, agency dot, M/S/C, AI activity pulse (in TrackList sidebar)
- **Layer 2 — ExpandedVoice:** Voice header with agency toggle, chain strip, module-grouped `ControlSection` components (amber for source, sky for processors, violet for modulators), XY pad, sequencer, visualiser
- **Layer 3 — DeepView:** Read-only per-module inspector with values and source provenance (default/human/AI)
- `TrackSurface` type on Voice with scaffolding for semantic controls, pinned controls, XY axes, thumbprint config (inert until Steps 5+)
- `ChainStrip` with processor badges (sky) and modulator badges (violet), disclosure chevrons for deep view entry
- Modulation routing display as text chips (`→ source:brightness (0.30)`)

---

## M5 Wave 1: Layout + Project Persistence — Complete

### Landed: Layout Restructuring + Project Persistence (PR #169)

- **#127 — Chat sidebar:** Removed Chat as a view mode. Chat is now a persistent collapsible left sidebar (ChatSidebar). Collapsed state shows floating ChatComposer input with unread badge, thinking/listening LED, auto-expand on send.
- **#154 — Track sidebar:** Replaced horizontal VoiceStage with vertical TrackList on the right (TrackRow components with thumbprint, M/S/C, agency). VoiceStage removed from view top bars.
- **#159 — Project persistence:** Multi-project save/load via IndexedDB (project-store.ts). Create, rename, duplicate, delete, export (.gluon JSON), import. Auto-save with loading guard and 3-failure backoff. One-time localStorage migration. Version validation and session shape checking shared with persistence.ts boundary.
- **App.tsx refactor:** Layout extracted to AppShell, keyboard shortcuts to useShortcuts hook, project lifecycle to useProjectLifecycle hook.

---

## Open Backlog

### M5 Wave 2 (next)

- #160 — Mix bus: per-voice volume/pan, master channel
- #164 — Pause vs hard stop: transport UX
- #170 — Footer bar: prevent floating chat overlay
- #171 — Module browser: browse and add modules to tracks
- #172 — Persist undo stack across project save/load

### M5: UI Layers (remaining sub-phases)

- 5B — Parameter & patch navigation (#162 parameter surface, #126 control layout, #158 patch view, #161 generic voices)
- 5C — AI-curated surfaces (#73 — semantic controls, pin mechanism, AI surface curation tools)
- 5D — Sequencer & listen (#106 offline render, #107 voice isolation, #108 configurable bars)
- 5E — Legibility (#163 AI action legibility, #123 message attribution)

### Evergreen

- #72 — migrate to gemini-3-flash when function calling stable
- #8 — graceful AI model layer degradation
- #50 — Ableton sequencing adapter spike

---

## Likely Next Work

**M5 Wave 2:** Mix bus (#160) and pause/stop (#164). These add per-voice volume/pan controls and musical pause semantics. Footer bar (#170) and module browser (#171) support the layout and human capability parity.

**Then M5B:** Parameter & patch navigation. The human needs ground-truth views for the full parameter surface and signal chain wiring.

Dependency graph:

```
M0 ✓  M1 ✓  M2 ✓  M3 ✓  M4 ✓  Phase 4B ✓  M5 Steps 1-4 ✓  M5 Wave 1 ✓
  └── M5 Wave 2 (mix bus, pause/stop, footer, module browser) ← next
        └── M5B (parameter & patch navigation)
              └── M5C (AI-curated surfaces)
  └── M5D (sequencer & listen — parallel)
  └── M5E (legibility — after 5B)
```
