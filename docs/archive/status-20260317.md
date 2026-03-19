# Gluon — Build Status

**As of:** 2026-03-17
**Build:** 1252 tests, 82 test files, zero type errors
**Prior status:** archived at `docs/archive/status-pre-20260317.md`

---

## Product State

Browser-based AI-assisted music instrument. Human directs AI via natural language, AI makes structured changes, human listens and iterates.

**Core:** 1-16 dynamic tracks (audio + bus), Plaits/Rings/Clouds/Tides WASM synthesis with all parameters exposed and smoothed, processor chains, Tides modulation, send/return bus routing with explicit master bus, polyphonic sequencing (up to 4 simultaneous notes per step).

**Views:**
- **Tracker** — Renoise-style slot-based grid. Inline FX columns, keyboard nav, copy/paste, 4 note columns, automation lane, multi-select with batch transpose, note-on-hover audio preview, play-from-cursor.
- **Rack** — Eurorack-style module grid with hardware-matched faceplate layouts (Plaits/Rings/Clouds). Three knob tiers (large/medium/small), Bitwig-style per-modulation colored depth rings, inline modulation depth editing, parameter unit display on hover (Hz, dB, ms, %).
- **Patch** — Interactive node graph. Node dragging, edge selection, drag-to-connect cable patching with bezier preview and snap-to-port, right-click cable removal, send/bus topology display, pan/pinch zoom.
- **Surface** — Currently a hybrid placeholder on expanded-track editing, not yet the full AI-curated surface model.

**AI:** 20 tools (including explain_chain, simplify_chain, bug report), dual-provider stack (GPT-5.4 planner + Gemini 3 Flash listener), streaming responses, dual-posture system prompt, preservation contracts, reaction history, structured listening. Tool param descriptions derived programmatically from instrument registry to prevent drift.

**UX:** Undo history dropdown with visual timeline, audio export (mono + stereo WAV), multi-line chat, per-track volume/pan (view-independent mix strip), BPM 20-300 with large readout, loop/cycle toggle, prominent playhead position, co-located time signature, metronome, pattern/song transport mode, module bypass, configurable gate length, parameter interpolation (step/linear/curve), micro-timing offsets, keyboard shortcuts panel (Cmd+?), A/B comparison, selection + Delete key pattern (no inline x buttons), bus track visual differentiation in sidebar, send routing from sidebar, importance/musicalRole track metadata.

---

## Completed Milestones

M0 (Stabilization) → M1 (Sequencer) → M2 (Expressivity) → M3 (Views) → M4 (Chains) → Phase 4B (Modulation) → M5 (UI Layers) → M6 (AI Collaboration) → Finalization Waves 1-3 → Stabilisation → Finalization Pipeline

See `docs/roadmap.md` for full milestone details and exit criteria.

---

## Recent Work (2026-03-17 Finalization Pipeline)

18 PRs merged in one session covering UI polish, UX patterns, AI tools, and docs:

| Area | What landed |
|------|-------------|
| **Rack view** | Hardware-matched faceplate layouts, three knob tiers, per-modulation colored rings, inline depth editing, parameter unit display |
| **Transport** | Large BPM readout, loop toggle, prominent playhead, co-located time signature |
| **Sidebar** | Bus track differentiation (background, indent, badge), name tooltips, styled master slider, send routing controls |
| **Tracker** | Audio preview on hover/nav, play-from-cursor, batch transpose (Cmd+Shift+Up/Down), SVG pattern icons |
| **Patch view** | Bezier cable preview, snap-to-port, right-click removal, send topology display |
| **UX patterns** | Selection + Delete/Backspace across app (modules, routes, tracks, patterns, sequence slots) |
| **AI tools** | explain_chain, simplify_chain, bug report tool, registry-derived param descriptions |
| **Docs** | Protocol + AI contract refresh, roadmap truthfulness audit |
| **Undo** | Visual undo history dropdown |
| **Track metadata** | Importance + musicalRole UI controls |

---

## Open Follow-On Work

### Gating: composition walkthrough (#527)
The next milestone gate is a 4-track techno composition walkthrough done collaboratively with the AI. Surface view work is gated on completing this.

### Runtime contract hardening
- #555: Shared audio module runtime contract and topology alignment
- #568, #571: Browser failure-mode and long-session performance audits

### Surface honesty
- #559: Clarify Surface placeholder vs intended curated model
- #560: Make Surface state real (pins, axes, deep-view parity)

### Remaining priority:next
- #430: Piano roll view
- #526: sfizz-webaudio sampler spike
- #474, #480: Cross-model consultation and Gemini analysis spikes

### Deferred (priority:later)
- #466: Port-level patch graph (DAG)
- #469: Scene structure
- #429: Arrangement timeline
- #307: Non-destructive modulation offset model
- #303: Keyboard accessibility
- See GitHub backlog for full list

---

## Tech Stack

- TypeScript, React, Vite, Tailwind CSS
- Emscripten (C++ to WASM) — Mutable Instruments Plaits, Rings, Clouds, Tides
- Web Audio API + AudioWorklet
- Google GenAI SDK + OpenAI SDK + Anthropic SDK (multi-provider)

## Key Design Decisions

- **Tracks:** 1-16 dynamic, typed (`audio` | `bus`), empty by default
- **Polyphony:** Free-form simultaneous events, max 4 notes per step, column ≠ voice
- **Bus routing:** Post-fader sends, explicit master bus, send state on sending track, human-editable from sidebar
- **Patterns:** Standard tracker model (Renoise/ProTracker). Per-track sequence for arrangement. Pattern mode loops, song mode walks sequence.
- **Rack modules:** Fixed hardware feel, no internal scroll, 572px height, dynamic width, three knob tiers, never hide params, echo familiar hardware layouts
- **Delete pattern:** Selection + Delete/Backspace key, no inline x buttons (matches Renoise/Ableton)
- **Port graph:** Deferred (#466) — chain model is shallow and not blocking
- **Arrangement:** Per-track sequences stabilised. Global tracker patterns (Renoise model) is the target, deferred as design-tier work.
- **Views:** Tracker = events, Rack = parameters (ground truth), Patch = topology (interactive), Surface = curated (placeholder)
- **Automation:** Dual model — inline ParameterEvents as FX columns + visual breakpoint envelope editor with curve interpolation
