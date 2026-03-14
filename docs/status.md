# Gluon — Current Build Status

**As of:** 2026-03-14
**Phases complete:** Phase 1 (PoC), Phase 2 (Sequence & Layers), Canonical Musical Model, M0 (Stabilization), M1 (Sequencer Foundations), M2 (Sequencer Expressivity), M3 (View Layer), M4 (First Chain + Phase 4A), Phase 4B (Modulation / Tides), M5: UI Layers (all sub-phases)
**Current product state:** Four-view tabbed UI (Surface with semantic controls, Rack, Patch, Tracker), AI-curated surfaces with template registry, full parameter surfaces, node-graph patch view, live recording with parameter automation, micro-timing display, offline audio rendering with voice isolation, pause/hard-stop transport, 19 AI tools
**Near-term focus:** M6A (Preservation contracts)
**Latest milestone:** M5C complete — AI-curated surfaces with semantic controls, pinning, and surface tools (PRs #251, #252, #254)
**Data model direction:** Canonical regions/events are the sequencing authority — `voice.pattern` is a derived projection. Tracker is the canonical truth view; step grid and other editors are addable surfaces.

---

## Current Snapshot

Gluon is a browser-based, AI-assisted instrument with:

- 4-voice Plaits WASM synthesis
- Rings WASM resonator + Clouds WASM granular processor
- Tides WASM function generator (LFO/envelope modulator)
- Processor chain architecture: source → sourceOut → [processors] → chainOutGain → accentGain → muteGain → mixer
- Glitch-free chain rebuild via gain ramp (2ms fade-out/fade-in on processor add/remove)
- Sequence fence for stop/start race prevention (monotonic clearFence counter)
- Modulation architecture: Tides → GainNode(depth) → target AudioParam (max 2 modulators per voice)
- AI tools (19): move, sketch, listen, set_transport, set_model, transform, add_view, remove_view, add_processor, remove_processor, replace_processor, add_modulator, remove_modulator, connect_modulator, disconnect_modulator, set_surface, pin, unpin, label_axes
- AI surface curation: set_surface proposes semantic controls, pin/unpin surfaces raw controls, label_axes changes XY pad bindings — all immediate, undoable, no agency required
- Surface template registry: auto-applies semantic controls when chain changes (signature matching against known chain configs)
- Semantic controls: weighted multi-parameter knobs that aggregate across chain modules, with inspection popover showing weight mappings
- Processor and modulator control authority: AI can target params and models via `processorId`/`modulatorId` on move/set_model
- Chain validation layer: structural rules enforced via registry-driven validator (processors + modulators)
- Four-view tabbed UI: Surface (semantic controls + pinned controls), Rack (full parameter surface), Patch (node graph), Tracker (event list)
- Rack view: Guitar Rig-style vertical parameter surface with module-grouped controls
- Patch view: node graph showing signal chain and modulation routing
- Grid-based control surface layout
- Module inspector: clickable chain strip, param sliders, mode selector, remove button
- Module browser: browse and add sound generators, processors, modulators to tracks
- Modulation routing: human sets center, modulation adds around it; multiple routings to same param sum additively
- Unified undo across human and AI actions (gesture-based for sliders)
- Canonical region/event sequencing with step-grid projection
- Event-centric tracker with micro-timing badges and quantize operation
- Live note recording and parameter automation recording
- Addable sequencer views (step grid as default, piano roll placeholder)
- AI view operations (add_view, remove_view) — UI curation, no agency check
- AI action legibility: visual diffs in chat messages
- Microtiming, sub-step scheduling, and transformation primitives (M2)
- Region invariants with validation and normalization
- Multi-project persistence via IndexedDB with export/import (.gluon JSON)
- Session versioning with v1→v2→v3 migration, shared across localStorage and IndexedDB paths
- Per-voice agency (AI-editable by default, human-protectable)
- Three-column layout: collapsible chat sidebar (left), main content (center), track list (right)
- Global footer bar with persistent composer strip
- Pause vs hard stop transport semantics (Space = pause with tail decay, Shift+Space = immediate silence)
- Mix bus: per-voice volume/pan, master channel
- Offline audio rendering for AI listen tool with voice isolation and configurable bar count
- Audio snapshot evaluation via Gemini native audio
- AudioContext-based capture timing (replaces setTimeout drift)
- Concurrent recording/capture mutex guard
- Native Gemini function calling with tool use

---

## Recent Merged PRs

| PR | Description | Merged |
|---|---|---|
| PR #247 | feat: micro-timing display and quantize operation (#238) | 2026-03-14 |
| PR #246 | fix: glitch-free chain rebuild + stop/start race fence (#139, #147) | 2026-03-14 |
| PR #245 | feat: record parameter automation during transport playback (#236) | 2026-03-14 |
| PR #244 | feat: split transport stop into pause and hard stop (#164) | 2026-03-14 |
| PR #243 | fix: captureNBars timer drift + orphaned recorder guard (#143) | 2026-03-14 |
| PR #242 | fix: chat toggle in footer bar, collapsed composer width (#240, #239) | 2026-03-14 |
| PR #237 | feat: module browser (#171) | 2026-03-14 |
| PR #235 | feat: patch view — node graph for signal chain and modulation routing (#158) | 2026-03-14 |
| PR #234 | feat: parameter surface layer — Rack view (#162) | 2026-03-14 |
| PR #233 | feat: grid-based control surface layout (#126) | 2026-03-14 |
| PR #232 | feat: AI action legibility — visual diffs in chat (#163) | 2026-03-14 |
| PR #231 | feat: four-view tab infrastructure (Surface, Rack, Patch, Tracker) | 2026-03-14 |
| PR #230 | feat: global footer bar (#203) | 2026-03-14 |
| PR #229 | feat: offline audio rendering + voice isolation + configurable bars (#106, #107, #108) | 2026-03-14 |
| PR #228 | feat: mix bus — per-voice volume/pan, master channel (#160) | 2026-03-14 |
| PR #227 | chore: rename Voice to Track across codebase (#227) | 2026-03-14 |
| PR #226 | fix: P1/P2 bug batch — crash guards, undo fixes, agency, persistence (#205-#214) | 2026-03-14 |
| PR #225 | feat: keyboard piano, track names, chat resize, collapse toggle (#178-#184) | 2026-03-14 |
| PR #169 | M5 Wave 1: layout restructuring + project persistence | 2026-03-14 |
| PR #168 | M0 Stabilization: scheduler float-fix, voice-scoped automation, agency button | 2026-03-13 |

---

## M5 Wave 2: Transport + Mix + Infrastructure — Complete

### Landed

- **#160 — Mix bus (PR #228):** Per-voice volume/pan controls, master channel with gain staging
- **#164 — Pause vs hard stop (PR #244):** Space pauses (tails ring out), Shift+Space hard stops (immediate silence)
- **#170 — Footer bar (PR #230):** Global footer bar with persistent composer strip, replaces floating chat overlay
- **#171 — Module browser (PR #237):** Browse and add sound generators, processors, modulators to tracks
- **#172 — Undo persistence:** Undo stack persists across project save/load

---

## M5B: Parameter & Patch Navigation — Complete

### Landed

- **#126 — Control surface layout (PR #233):** Grid-based modular layout replacing stacked blocks
- **#162 — Parameter surface / Rack view (PR #234):** Guitar Rig-style ground-truth view for full parameter space, module-grouped controls
- **#158 — Patch view / node graph (PR #235):** Ground-truth view for signal chain and modulation routing as interactive node graph
- **#161 — Generic voices:** Decision doc — voices are generic (not typed as drum/synth/bass), AI handles configuration complexity
- **Four-view tab infrastructure (PR #231):** Surface (placeholder), Rack, Patch, Tracker as tabbed views

---

## M5D: Sequencer & Listen — Complete

### Landed

- **#106 — Offline audio rendering (PR #229):** AI can evaluate audio without transport playing
- **#107 — Voice isolation (PR #229):** AI can listen to individual voices
- **#108 — Configurable bar count (PR #229):** Flexible evaluation window for listen tool
- **#238 — Micro-timing display + quantize (PR #247):** Off-grid events show timing badge, quantize button snaps to grid
- **#236 — Parameter automation recording (PR #245):** Knob movements captured as control events during armed recording

---

## M5E: Legibility — Complete

### Landed

- **#163 — AI action legibility (PR #232):** Visual diffs in chat messages showing what the AI changed
- **#123 — System message attribution:** System messages correctly labelled (not as AI)

---

## M0 Late Fixes — Complete

### Landed

- **#143 — captureNBars timer drift (PR #243):** AudioContext.currentTime-based timing replaces setTimeout. Concurrent recording/capture mutex guard.
- **#139 — rebuildChain audio dropout (PR #246):** chainOutGain node with 2ms gain ramp eliminates hard audio click on processor add/remove
- **#147 — Stop/start race (PR #246):** Monotonic clearFence counter prevents rapid stop/play from wiping freshly scheduled events

---

## M5C: AI-Curated Surfaces — Complete

### Landed

- **#248 — Surface template registry (PR #251):** Chain signature matching (`plaits:rings:clouds`), auto-apply semantic controls on chain change, SurfaceSnapshot for undo, validateSurface for weight/module validation
- **#249 — Semantic control rendering (PR #252):** SemanticKnob rotary component with weighted multi-param fan-out, SemanticInspector popover showing weight mappings, emerald accent, gesture-based undo grouping
- **#250 — AI surface tools (PR #254):** set_surface, pin, unpin, label_axes tools (19 total). Surface state in AI state compression. Trigger discipline in system prompt. All surface ops immediate, undoable, no agency required.

---

## Open Backlog

### Evergreen

- #72 — migrate to gemini-3-flash when function calling stable
- #8 — graceful AI model layer degradation
- #156 — per-track swing
- #50 — Ableton sequencing adapter spike (M7)
- #6 — Lyria integration + sampler voice (M7)

---

## Likely Next Work

**M6A: Preservation** — Runtime enforcement of approved material during AI edits. Approval levels on voices and aspects, mark_approved/preserve_material tools, preservation constraints, reports on edits. Design doc: `docs/rfcs/preservation-contracts.md`. Unblocked now that M5 is complete.

Dependency graph:

```
M0 ✓  M1 ✓  M2 ✓  M3 ✓  M4 ✓  Phase 4B ✓  M5 ✓ (all sub-phases)
  └── M6A (Preservation) ← next
        └── M6B (Aesthetic Direction)
        └── M6C (Structured Listening)
              └── M6D (Environment Legibility)
                    └── M7 (External Integration)
```

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
- 19 declared tools: `move`, `sketch`, `listen`, `set_transport`, `set_model`, `transform`, `add_view`, `remove_view`, `add_processor`, `remove_processor`, `replace_processor`, `add_modulator`, `remove_modulator`, `connect_modulator`, `disconnect_modulator`, `set_surface`, `pin`, `unpin`, `label_axes`
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
- Processor chain: source → sourceOut → [processors] → chainOutGain → accentGain → muteGain → mixer
- Glitch-free chain rebuild: chainOutGain ramp to 0 before disconnect, ramp to 1 after reconnect (~2ms)
- Sequence fence: monotonic clearFence counter tags events and clear-scheduled messages, worklets filter stale clears
- Modulation routing: Tides AudioWorkletNode → GainNode(depth) → target AudioParam
- `addProcessor` / `removeProcessor` with async in-flight dedupe and cancellation
- `addModulator` / `removeModulator` with keep-alive GainNode pattern
- `addModulationRoute` / `removeModulationRoute` with canonical ID threading
- Multi-processor type dispatch (Rings, Clouds)
- Sample-accurate `scheduleNote()` with per-step locks and fence tagging
- Media stream destination available for export/evaluation

**Plaits Runtime**
- Parameter smoothing, trigger/gate separation, HEAPF32 compatibility
- Custom k-rate `mod-*` AudioParams for modulation input (brightness/richness/texture, not pitch)
- Fence-aware event scheduling and clear-scheduled filtering

**Rings Runtime**
- WASM resonator processor taking audio input
- Sub-block event scheduling in AudioWorklet
- 6 resonator models, 4 normalized controls
- Custom k-rate `mod-*` AudioParams for modulation input
- Fence-aware event scheduling and clear-scheduled filtering

**Clouds Runtime**
- WASM granular processor (MI Clouds DSP)
- 4 processing modes: granular, pitch-shifter, looping-delay, spectral
- 4 normalized controls: position, size, density, feedback
- Float-to-int16 conversion for ShortFrame I/O
- Sub-block event scheduling in AudioWorklet
- Custom k-rate `mod-*` AudioParams for modulation input
- Fence-aware event scheduling and clear-scheduled filtering

**Tides Runtime**
- WASM function generator (MI Tides v2 PolySlopeGenerator, 77KB)
- 3 modes: AD (one-shot), Looping (free-running LFO), AR (sustained)
- 4 controls: frequency (0.01-20 Hz exponential), shape, slope, smoothness
- Audio output (-1..+1) routed to target AudioParams via GainNode depth scaling
- No audio input — generates modulation signal only

**Audio Exporter**
- AudioContext.currentTime-based capture timing (replaces setTimeout)
- Concurrent recording/capture mutex guard
- Capture + manual recording mutual exclusion

### UI (`src/ui/`)

**App shell**
- **AppShell:** Three-column layout — collapsible chat sidebar (left), main content (center), track list (right)
- **Global footer bar:** Persistent composer strip with chat input, future controls area
- **ChatSidebar:** Persistent left sidebar. Expanded: w-80 with API key header + ChatPanel. Collapsed: floating ChatComposer input at bottom-left with unread badge, thinking/listening indicators
- **TrackList / TrackRow:** Vertical voice sidebar (right). Per-track: thumbprint dot, label, agency indicator, M/S/C buttons
- **ProjectMenu:** Dropdown — create, rename, duplicate, delete, export (.gluon), import
- **useShortcuts:** Keyboard handler — Cmd+1-4 views, Cmd+/ chat toggle, Tab cycle, Space play/stop, Shift+Space hard stop, Cmd+Z undo
- **useProjectLifecycle:** Project load/save/switch hook with auto-save debounce
- Four view modes: `'surface' | 'rack' | 'patch' | 'tracker'`

**Views**
- **Surface:** Placeholder — AI-curated interface (M5C)
- **Rack:** Guitar Rig-style vertical parameter surface with module-grouped controls
- **Patch:** Node graph showing signal chain and modulation routing
- **Tracker:** Event-centric canonical view with micro-timing badges, quantize button, inline editing

**Three-layer voice model (M5 Steps 1-4)**
- **Layer 1 — TrackRow:** Compact voice row with thumbprint, agency dot, M/S/C, AI activity pulse
- **Layer 2 — ExpandedVoice:** Voice header, chain strip, control sections, XY pad, sequencer, visualiser
- **Layer 3 — DeepView:** Read-only per-module inspector with values and source provenance
- `TrackSurface` type on Voice (scaffolding for semantic controls — M5C)

**Transport**
- Pause (Space): stops scheduler, lets tails decay naturally
- Hard stop (Shift+Space): stops scheduler + silenceAll() for immediate cutoff
- Mix bus: per-voice volume/pan, master channel
