# Gluon — Build Status

**As of:** 2026-03-16
**Build:** 1045 tests, 70 test files, zero type errors

---

## Product State

Browser-based AI-assisted music instrument. Human directs AI via natural language, AI makes structured changes, human listens and iterates.

**Core:** 1-16 dynamic tracks (audio + bus), Plaits/Rings/Clouds/Tides WASM synthesis with all parameters exposed and smoothed, processor chains, Tides modulation, send/return bus routing with explicit master bus, polyphonic sequencing (up to 4 simultaneous notes per step).

**Views:** Surface (AI-curated semantic controls), Rack (Eurorack-style module grid with Bitwig-style modulation indicators), Patch (node graph with named MI hardware ports + signal-typed edges + route creation), Tracker (Renoise-style with keyboard nav, copy/paste, note columns, automation lane).

**AI:** 17 tools, dual-provider stack (GPT-5.4 planner + Gemini 3 Flash listener), streaming responses with progressive text rendering, dual-posture system prompt (collaborator for discussion, precise for actions), preservation contracts, reaction history, structured listening.

**UX:** Undo + redo, audio export (mono + stereo WAV), multi-line chat, per-track volume/pan knobs, BPM 20-300 with fractional support (keyboard nudge +/-1/10), voice stealing gain ramp, metronome click track, pattern/song transport mode, module bypass toggle, configurable gate length, parameter interpolation (step/linear/curve), micro-timing offsets, expanded keyboard shortcuts with reference panel (Cmd+?).

---

## Finalization Progress

Goal: finalize all implemented elements so you can compose full songs in collaboration with the AI. Surface view and new module types come after.

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

### Stabilisation — In progress

Pattern/sequence model refactor (#516, PR #517) merged. Adopted standard tracker model, simplified scheduler, added song mode.

QA triage: #506 (dropped notes) and #508 (delayed params) closed — fixed by #517. #511 point 6 (pattern model) and #514 point 2 (loop → mode toggle) addressed. PR #518 merged: metronome stop fix (#507), small knob drag fix (#510), L shortcut rewired to pattern/song mode, metronome volume restore on play, 11 new tests. Filed #519 (transport shortcut undo parity). Remaining: #509 (A/B comparison), #511 (tracker overhaul), #512 (track sidebar), #513 (patch view), #514 (sig dropdown + polish), #515 (AI contract), #519 (transport undo).

### Wave 4: "Make it polished" — Not started

Remaining QoL: A/B comparison, pan/zoom, play-from-cursor, per-message undo, CPU indicator, scenes (#469), etc.

---

## Tech Stack

- TypeScript, React, Vite, Tailwind CSS
- Emscripten (C++ to WASM) — Mutable Instruments Plaits, Rings, Clouds, Tides
- Web Audio API + AudioWorklet
- Google GenAI SDK + OpenAI SDK + Anthropic SDK (multi-provider)

## Milestones Complete

M0 (Stabilization) → M1 (Sequencer) → M2 (Expressivity) → M3 (Views) → M4 (Chains) → Phase 4B (Modulation) → M5 (UI Layers) → M6 (AI Collaboration) → Finalization Waves 1-3

## Key Design Decisions

- **Tracks:** 1-16 dynamic, typed (`audio` | `bus`), empty by default (no auto-Plaits)
- **Polyphony:** Free-form simultaneous events, max 4 notes per step, column ≠ voice
- **Bus routing:** Post-fader sends, explicit master bus, send state on sending track
- **Patterns:** Standard tracker model (Renoise/ProTracker). Patterns are content containers (no position). Per-track sequence for arrangement. Pattern mode loops active pattern, song mode walks sequence. Step-grid is a read-only derived cache.
- **Port graph:** Deferred (#466) — chain model is shallow and not blocking. Module bypass standalone.
- **Arrangement:** Per-track `sequence: PatternRef[]`. Song mode plays through sequence and stops at end. Scenes (#469) and timeline deferred.
- **Views:** Tracker = canonical event view, Rack = parameter ground truth (read-only modulation indicators), Patch = topology ground truth (route creation), Surface = AI-curated
- **Automation:** Dual model — inline ParameterEvents in tracker + visual breakpoint envelope editor. Linear/curve interpolation with per-point tension.
