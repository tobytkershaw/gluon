# Gluon — Build Status

**As of:** 2026-03-17
**Build:** Treat CI on `main` as the source of truth for current test counts and typecheck status.

---

## Product State

Browser-based AI-assisted music instrument. Human directs AI via natural language, AI makes structured changes, human listens and iterates.

**Core:** 1-16 dynamic tracks (audio + bus), Plaits/Rings/Clouds/Tides WASM synthesis with all parameters exposed and smoothed, processor chains, Tides modulation, send/return bus routing with explicit master bus, polyphonic sequencing (up to 4 simultaneous notes per step).

**Views:** Surface (currently a hybrid placeholder built on expanded-track editing, not yet the full AI-curated surface model), Rack (Eurorack-style module grid with Bitwig-style modulation indicators), Patch (interactive node graph with node dragging, edge selection, port connection dragging, pan/pinch zoom), Tracker (Renoise-style slot-based grid with inline FX columns, keyboard nav, copy/paste, 4 note columns, automation lane).

**AI:** 17 tools, dual-provider stack (GPT-5.4 planner + Gemini 3 Flash listener), streaming responses with progressive text rendering, dual-posture system prompt (collaborator for discussion, precise for actions), preservation contracts, reaction history, structured listening. Tracks identified by 1-indexed ordinals ("Track 1") with automatic resolution from natural language references.

**UX:** Undo + redo, audio export (mono + stereo WAV), multi-line chat, per-track volume/pan (view-independent mix strip), BPM 20-300 with integer drag + fractional text entry, voice stealing gain ramp, metronome click track, pattern/song transport mode, module bypass toggle, configurable gate length, parameter interpolation (step/linear/curve), micro-timing offsets, expanded keyboard shortcuts with reference panel (Cmd+?), A/B comparison with seamless transport.

**Current truth:** the canonical workbench views are much stronger than the curated Surface layer. Core transport, persistence, AI metadata undo, and several live/offline parity bugs were fixed during the March 2026 audit pass, but follow-on work remains around shared audio module runtime contracts, Surface honesty, routing usability, and later failure-mode/performance audits.

---

## Finalization Progress

Goal: finalize all implemented elements so you can compose full songs in collaboration with the AI.

This page should describe that goal honestly, including what is already solid and what is still follow-on work, rather than treating all stabilisation and Surface claims as complete.

### Wave 1: "Make it usable" — Complete (10/10 PRs merged)

Redo support, audio export, multi-line chat, tracker event creation + pattern length, per-track volume/pan, voice steal ramp, BPM expansion, AI posture rewrite, dead code cleanup.

### Wave 2: "Make it real" — Complete (8/8 PRs merged)

Tracker keyboard nav + copy/paste, Eurorack rack grid, Patch view real ports, WASM bridge (all MI params + smoothing), streaming AI, dynamic track count (1-16), polyphonic tracker (note columns).

### Wave 2→3 Bridge — Complete (1 PR merged)

Bus tracks with send/return routing, explicit master bus.

### Wave 3: "Make it complete" — Complete (15/15 PRs merged)

**First batch (7):** multiple regions (#399), loop selection (#404), metronome (#403), module bypass (#436), tool-call visibility (#414), reaction UI (#431), multi-region review fixes (#473)

**Second batch (8):** stereo render (#411), configurable gate length (#410), render tool fix (#379), micro-timing tests (#409), keyboard shortcuts + reference panel (#433), parameter interpolation (#408), modulation Rack→Patch refactor (#391), automation drawing UI (#432)

**Design decisions:** #395 (port-level graph) deferred to post-finalization (#466). #429 (arrangement) split into layers — regions + loop = finalization, scenes (#469) + timeline = later.

### Stabilisation — Core fixes landed, follow-on work remains

Pattern/sequence model refactor (#516, PR #517) merged. Adopted standard tracker model, simplified scheduler, added song mode.

QA triage: #506 (dropped notes) and #508 (delayed params) closed — fixed by #517. PR #518 merged: metronome stop fix (#507), small knob drag fix (#510), L shortcut rewired to pattern/song mode, metronome volume restore on play.

**Final stabilisation batch (6 PRs):**
- #520: A/B comparison — preserve transport playback state during swap
- #521: Transport bar — time sig dropdown, save indicator layout shift, BPM integer drag, CPU meter visibility
- #522: Track sidebar — visible names, empty default tracks, master bus in sidebar, view-independent mix strip, clear add-track buttons, agency badge
- #523: Tracker overhaul — slot-based grid (one row per step), inline FX columns (Renoise model), trigger events retired from UI, column cosmetics (Ch1-Ch4, Vel, monospace), pattern tab cleanup
- #524: Patch view — node dragging, edge click-to-select + Delete, port connection dragging, two-finger pan + pinch zoom
- #525: AI contract — ordinal track labels ("Track 1 (Kick)"), natural language resolution, bus ordinals

Later audit-driven fixes that have since landed:
- #554: Plaits stabilisation and live/offline parameter parity
- #556: offline/live audio module parity gaps
- #557 and #558: transport command/state separation, cursor-play, and parameter-timing fixes
- #563 and #564: unified restore contract plus real project-store round-trip coverage
- #566 and #567: AI contract truth alignment and undo parity for track metadata

Still open from the audit/follow-on backlog:
- #555: shared audio module runtime contract and topology alignment
- #559 and #560: Surface placeholder vs intended curated model; make Surface state real in the UI
- #561: make bus sends and routing topology usable from the human UI
- #568 and #571: browser/runtime failure-mode and long-session performance audits

### Wave 4: "Make it polished" — Replaced by targeted follow-on work

The next work is not one clean polish wave. It is a mix of:
- remaining runtime contract work (`#555`)
- Surface honesty and usability (`#559`, `#560`)
- routing usability and topology truth (`#561`)
- later audits for degraded-mode, performance, and end-to-end robustness

---

## Current Follow-On Priorities

The next phase is no longer accurately described as "Surface View & UI Polish" alone. The March 2026 audit showed three active follow-on streams:

1. **Runtime contract hardening**
- shared audio module runtime contract and topology honesty (`#555`)
- later degraded-mode and performance audits (`#568`, `#571`)

2. **Surface honesty and usability**
- clarify the current Surface placeholder vs the intended curated model (`#559`)
- make pinned controls, XY axes, and deep-view parity real in the UI (`#560`)

3. **Routing usability**
- expose bus sends and routing topology in a truthful human UI (`#561`)

New module types and source expansion should follow these contract and UI-truth fixes, not bypass them.

---

## Tech Stack

- TypeScript, React, Vite, Tailwind CSS
- Emscripten (C++ to WASM) — Mutable Instruments Plaits, Rings, Clouds, Tides
- Web Audio API + AudioWorklet
- Google GenAI SDK + OpenAI SDK + Anthropic SDK (multi-provider)

## Milestones Complete

M0 (Stabilization) → M1 (Sequencer) → M2 (Expressivity) → M3 (Views) → M4 (Chains) → Phase 4B (Modulation) → M5 (UI Layers) → M6 (AI Collaboration) → Finalization Waves 1-3 → Stabilisation

## Key Design Decisions

- **Tracks:** 1-16 dynamic, typed (`audio` | `bus`), empty by default (no auto-Plaits)
- **Polyphony:** Free-form simultaneous events, max 4 notes per step, column ≠ voice
- **Bus routing:** Post-fader sends, explicit master bus, send state on sending track
- **Patterns:** Standard tracker model (Renoise/ProTracker). Patterns are content containers (no position). Per-track sequence for arrangement. Pattern mode loops active pattern, song mode walks sequence. Step-grid is a read-only derived cache.
- **Port graph:** Deferred (#466) — chain model is shallow and not blocking. Module bypass standalone.
- **Arrangement:** Per-track `sequence: PatternRef[]` is the stabilised runtime. Global tracker patterns (Renoise model) is the target for cross-track arrangement, but deferred as a design-tier architecture project. Scenes (#469) not to be layered on per-track sequences (no hybrid arrangement authorities).
- **Views:** Tracker = canonical event view (slot-based, inline FX columns), Rack = parameter ground truth (read-only modulation indicators), Patch = per-track chain topology (interactive node graph for source/processor/modulator routing; bus/send topology deferred to #561), Surface = currently a placeholder/hybrid expanded-track layer rather than the full curated-surface model
- **Automation:** Dual model — inline ParameterEvents as FX columns in tracker (per-step locks) + visual breakpoint envelope editor (continuous curves). Linear/curve interpolation with per-point tension.
