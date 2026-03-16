# Gluon — Build Status

**As of:** 2026-03-16
**Build:** 986 tests, 67 test files, zero type errors

---

## Product State

Browser-based AI-assisted music instrument. Human directs AI via natural language, AI makes structured changes, human listens and iterates.

**Core:** 1-16 dynamic tracks (audio + bus), Plaits/Rings/Clouds/Tides WASM synthesis with all parameters exposed and smoothed, processor chains, Tides modulation, send/return bus routing with explicit master bus, polyphonic sequencing (up to 4 simultaneous notes per step).

**Views:** Surface (AI-curated semantic controls), Rack (Eurorack-style module grid with knob hierarchy), Patch (node graph with named MI hardware ports + signal-typed edges), Tracker (Renoise-style with keyboard nav, copy/paste, note columns).

**AI:** 17 tools, dual-provider stack (GPT-5.4 planner + Gemini 3 Flash listener), streaming responses with progressive text rendering, dual-posture system prompt (collaborator for discussion, precise for actions), preservation contracts, reaction history, structured listening.

**UX:** Undo + redo, audio export (WAV), multi-line chat, per-track volume/pan knobs, BPM 20-300 with fractional support, voice stealing gain ramp.

---

## Finalization Progress

Goal: finalize all implemented elements so you can compose full songs in collaboration with the AI. Surface view and new module types come after.

### Wave 1: "Make it usable" — Complete (10/10 PRs merged)

Redo support, audio export, multi-line chat, tracker event creation + pattern length, per-track volume/pan, voice steal ramp, BPM expansion, AI posture rewrite, dead code cleanup.

### Wave 2: "Make it real" — Complete (8/8 PRs merged)

Tracker keyboard nav + copy/paste, Eurorack rack grid, Patch view real ports, WASM bridge (all MI params + smoothing), streaming AI, dynamic track count (1-16), polyphonic tracker (note columns).

### Wave 2→3 Bridge — Complete (1 PR merged)

Bus tracks with send/return routing, explicit master bus.

### Wave 3: "Make it complete" — Not started

**3A Arrangement:** multiple regions (#399), song timeline (#429), loop selection (#404)
**3B Routing:** port-level patch graph (#395), module bypass (#436)
**3C AI depth:** tool-call visibility (#414), reaction UI (#431), diff tool (#434), bug report tool (#441)
**3D Scheduling:** metronome (#403), time signatures (#412), param interpolation (#408), gate length (#410), piano roll (#430)

### Wave 4: "Make it polished" — Not started

~20 QoL issues: keyboard shortcuts, A/B comparison, automation drawing, micro-timing, stereo render, pan/zoom, play-from-cursor, per-message undo, CPU indicator, etc.

---

## Tech Stack

- TypeScript, React, Vite, Tailwind CSS
- Emscripten (C++ to WASM) — Mutable Instruments Plaits, Rings, Clouds, Tides
- Web Audio API + AudioWorklet
- Google GenAI SDK + OpenAI SDK (dual-provider)

## Milestones Complete

M0 (Stabilization) → M1 (Sequencer) → M2 (Expressivity) → M3 (Views) → M4 (Chains) → Phase 4B (Modulation) → M5 (UI Layers) → M6 (AI Collaboration) → Finalization Waves 1-2

## Key Design Decisions

- **Tracks:** 1-16 dynamic, typed (`audio` | `bus`), empty by default (no auto-Plaits)
- **Polyphony:** Free-form simultaneous events, max 4 notes per step, column ≠ voice
- **Bus routing:** Post-fader sends, explicit master bus, send state on sending track
- **Views:** Tracker = canonical event view, Rack = parameter ground truth, Patch = topology ground truth, Surface = AI-curated
