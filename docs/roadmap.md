# Gluon Roadmap

---

## Where We Are

Gluon has a working core: 4-voice Plaits synthesis, Rings and Clouds processors, Tides modulation, canonical event sequencing with tracker and step-grid views, 15 AI tools, unified undo, and agency control. The AI can build patches, write patterns, wire signal chains, set up modulation, and listen to its own output.

What it can't do yet: save a project, show the human a full parameter surface, let the human inspect wiring visually, persist aesthetic direction across a session, enforce preservation of approved material, or render audio offline for evaluation. The UI has structural scaffolding (M5 Steps 1–4) but hasn't reached the point where the human can fluently navigate a multi-voice, multi-processor project.

The product feels like a capable engine behind a rough cockpit. The roadmap from here is about making the cockpit match the engine.

**Completed:** Phases 1–3, M0–M4, Phase 4B (Tides modulation), M5 Steps 1–4 (UI structural foundation).

---

## Phase Map

```
  NOW                                                              LATER
   │                                                                 │
   ▼                                                                 ▼
┌──────────┐   ┌──────────────┐   ┌────────────────┐   ┌───────────────────┐
│ STABILIZE │──▶│  WORKBENCH   │──▶│  COLLABORATION │──▶│    OPEN WORLD     │
│           │   │              │   │                │   │                   │
│ M0: Fix   │   │ M5: Make the │   │ M6: Make the   │   │ M7: Connect to    │
│ what's    │   │ human        │   │ AI a better    │   │ the outside       │
│ broken    │   │ effective    │   │ collaborator   │   │ world             │
└──────────┘   └──────────────┘   └────────────────┘   └───────────────────┘
```

Each phase has a clear product test — what can the user do at the end that they can't do now?

---

## STABILIZE — M0: Stabilization

**Product test:** The app works reliably. Every voice sounds, every control responds, transport starts and stops cleanly, undo works.

**Why first:** Nothing else matters if the instrument is broken. Users will forgive missing features but not broken features.

### Priority: Now (blockers)

| # | Issue | Cluster |
|---|-------|---------|
| 120 | BPM change crashes (setBpm not a function) | Transport |
| 137 | setBpm silent no-op | Transport |
| 153 | First step often silent on transport start | Scheduler |
| 131 | Non-primary voices only sound momentarily | Audio engine |
| 132 | Voice parameters change spontaneously | Audio engine |
| 130 | XY pad and slider values revert on mouse-up | UI state |
| 135 | Worklets lack stale-event drain — ghost events | Worklet |
| 149 | Removing processor leaves dangling mod routes | Chain |
| 150 | Record silently no-ops before audio init | Infrastructure |
| 121 | Agency button missing from voice cards | UI |
| 127 | Replace Chat view with persistent sidebar | UI |

### Priority: Next (quality)

| # | Issue | Cluster |
|---|-------|---------|
| 138 | Async race on processor/modulator add | Audio engine |
| 140 | Scheduler drifts after tab background | Scheduler |
| 141 | Arbitration cooldown + sync effect conflict | State |
| 142 | Processor sync re-syncs all on every change | Performance |
| 146 | Rings keeps ringing after transport stop | Audio cleanup |
| 148 | Tides continues after transport stop | Audio cleanup |
| 155 | Tracker double-click editing broken | UI |
| 152 | Lint baseline red | Infrastructure |
| 119 | Voice names hardcoded | UI |
| 122–125 | UI consistency (transport, buttons, labels, nesting) | UI |

### Priority: Later (known, non-blocking)

| # | Issue |
|---|-------|
| 139 | rebuildChain audio dropout (~2.7ms) |
| 143 | captureNBars timer drift |
| 144 | TidesSynth doesn't re-apply params after init |
| 147 | Rapid stop/start race |
| 145 | Broad architectural review beyond audio layer |

### Exit criteria
- All `priority:now` issues closed
- `npx tsc --noEmit && npx vitest run` green
- Manual smoke test: create 4-voice patch with processors and modulation, play/stop/undo cycle works

---

## WORKBENCH — M5: UI Layers

**Product test:** The human can navigate a complex project fluently — see all parameters, inspect wiring, save and reload, mix voices, and understand what the AI changed.

This is the largest phase because it transforms the UI from scaffolding into a usable workbench. Broken into sub-phases that can ship independently.

### 5A: Project Foundation

The minimum for the app to feel like a real tool rather than a demo.

| # | Issue | What |
|---|-------|------|
| 159 | Project persistence | Save/load full session as JSON, multiple projects |
| 154 | Move track controls to vertical sidebar | Layout prerequisite for everything else |
| 160 | Mix bus | Master channel with volume, panning, output routing |
| 164 | Pause vs hard stop | Transport UX — pause preserves state, stop resets |

**Dependencies:** M0 complete (no point saving broken state).
**Enables:** Users can work across sessions. Mix bus enables basic mixing. Layout enables scaling beyond 4 voices.

### 5B: Parameter & Patch Navigation

The human needs to see and control everything the AI can touch.

| # | Issue | What |
|---|-------|------|
| 162 | Parameter surface layer | Ground-truth view for full parameter space (Guitar Rig / NKS model) |
| 126 | Control surface layout | Grid-based modular layout replacing stacked blocks |
| 158 | Patch view (node graph) | Ground-truth view for signal chain and modulation routing |
| 161 | Generic voices | Voices untyped, maximally flexible, renamable |

**Design docs:**
- `docs/rfcs/ai-curated-surfaces.md` — semantic controls, pins, AI surface curation
- `docs/rfcs/patch-view-layer.md` (on PR #165) — node graph as wiring ground truth
- `docs/design-references.md` (on PR #165) — NI ecosystem, Bitwig, Reason, VCV Rack references

**Dependencies:** 5A (layout foundation). Canonical model's ControlSchema.
**Enables:** Human capability parity — the human can inspect and edit everything the AI can modify. AI-curated surfaces become possible once the ground-truth views exist.

### 5C: AI-Curated Surfaces (M5 Steps 5–7)

The AI configures what the human sees, not just what the instrument sounds like.

| # | Issue | What |
|---|-------|------|
| 73 | Three-layer UI model | Full implementation of curated surfaces RFC |

**What this adds:**
- Semantic controls (AI-chosen names and ranges for the current context)
- Pin mechanism (human or AI pins important controls to the surface)
- AI surface curation tools (configure XY axes, choose which controls to show)
- Thumbprint visualization from voice parameters

**Design docs:** `docs/rfcs/ai-curated-surfaces.md`
**Dependencies:** 5B (ground-truth views must exist before projections over them).
**Enables:** The AI becomes a UI designer, not just a sound designer. The human sees a curated, context-appropriate interface rather than raw parameter lists.

### 5D: Sequencer Polish & Listen Tool

| # | Issue | What |
|---|-------|------|
| 118 | Tracker view switch discards edits | Sequencer robustness |
| 106 | Offline audio rendering for listen tool | AI can evaluate without transport playing |
| 107 | Voice isolation for listen tool | AI can listen to individual voices |
| 108 | Configurable bar count for listen | Flexible evaluation window |

**Design docs:** `docs/briefs/offline-listen.md`
**Dependencies:** None (can run in parallel with 5A–5C).
**Enables:** AI self-evaluation becomes reliable and flexible. Prerequisite for structured listening in M6.

### 5E: Legibility

| # | Issue | What |
|---|-------|------|
| 163 | AI action legibility | Visual diffs / animated replay in chat |
| 123 | System messages labelled as AI | Message attribution |

**Dependencies:** 5A (chat sidebar). Better after 5B (parameter/patch views exist to show diffs against).
**Enables:** The human understands what the AI did without reading parameter lists. Trust.

### M5 exit criteria
- Human can save, close, reopen a project and continue working
- Human can see all parameters across all voices and processors
- Human can inspect signal chain and modulation routing visually
- AI can curate which controls the human sees
- AI can evaluate audio offline with voice isolation
- Human can understand AI actions from the chat history

---

## COLLABORATION — M6: AI Collaboration Quality

**Product test:** The AI calibrates its behavior to the session — avoids repeating rejected directions, preserves approved material, sizes its interventions appropriately, and asks when uncertain about taste.

This phase implements the design work from the AI environment docs. The product already has the AI tools; this phase makes the AI *use them well*.

### 6A: Preservation

| What | Design doc |
|------|-----------|
| Approval levels on voices and aspects | `docs/rfcs/preservation-contracts.md` |
| `mark_approved` / `preserve_material` tools | `docs/rfcs/preservation-contracts.md` |
| Runtime enforcement of preservation constraints | `docs/rfcs/preservation-contracts.md` |
| Preservation reports on edits | `docs/rfcs/preservation-contracts.md` |

**Dependencies:** M5 (the human needs to see approval status in the UI; parameter surfaces must exist for partial approvals to make sense).
**Enables:** Aesthetic direction (6B) — taste-informed preservation is advisory without runtime enforcement.

### 6B: Aesthetic Direction

| What | Design doc |
|------|-----------|
| Reaction history in session state | `docs/ai/aesthetic-direction.md` |
| Rationale on approved/rejected directions | `docs/ai/aesthetic-direction.md` |
| Observed patterns and restraint guidance | `docs/ai/aesthetic-direction.md` |
| Prompt tuning for taste-informed behavior | `docs/ai/aesthetic-direction.md` |

**Dependencies:** 6A (preservation contracts). Collaboration state layer in session (from `ai-musical-environment.md`).
**Enables:** The AI behaves like a collaborator who remembers what happened earlier in the session and adjusts accordingly.

### 6C: Structured Listening

| What | Design doc |
|------|-----------|
| Question-based listening | `docs/ai/ai-musical-environment.md` (Structured Listening section) |
| Comparative listening | `docs/ai/ai-musical-environment.md` |
| Listening lenses (punch, separation, groove) | `docs/ai/ai-musical-environment.md` |

**Dependencies:** 5D (offline render + voice isolation). Better after 6A (preservation reports give listening context).
**Enables:** AI evaluation becomes diagnostic rather than vague. "Did the bass widening reduce kick punch?" rather than "how does it sound?"

### 6D: Environment Legibility

| What | Design doc |
|------|-----------|
| Voice importance metadata (must_preserve, may_change) | `docs/ai/ai-musical-environment.md` (Voice layer) |
| Open decisions in collaboration state | `docs/ai/ai-musical-environment.md` (Session layer) |
| Enriched consequence reporting | `docs/ai/ai-musical-environment.md` (Consequence Reporting) |

**Dependencies:** 6A (importance metadata depends on approval levels). Session state layer.
**Enables:** The AI makes better decisions because it understands *why* things matter, not just *what* they are.

### M6 exit criteria
- Approved material survives AI expansion edits (runtime enforced, not just prompt guidance)
- The AI avoids repeating directions the human rejected earlier in the session
- The AI calibrates intervention size based on session evidence
- Listening evaluations answer specific questions rather than producing generic feedback
- The AI asks about aesthetic uncertainty rather than guessing

---

## OPEN WORLD — M7: External Integration

**Product test:** Gluon connects to things outside itself — hardware synths, DAWs, external instruments.

This phase is deliberately underspecified because it depends on what we learn from M5 and M6. The design docs gesture toward it but don't prescribe implementation.

### Likely directions

| Area | What | Reference |
|------|------|-----------|
| MIDI output | Send note/CC data to hardware synths | Architecture doc (Future: External Integration) |
| Hardware profiles | Adapt AI tools to external instrument parameter maps | `docs/rfcs/canonical-musical-model.md` (SourceAdapter) |
| DAW integration | Ableton Link, clip export, session sync | Architecture doc |
| External sequencer adapters | Ableton-style clip view, other sequencing models | `docs/briefs/sequencer.md` (Phase E) |
| Higher-level AI tools | Phrase-level editing, variant-first exploration | `docs/ai/ai-musical-environment.md` (Layered Actions) |

### Gating question
Before committing to M7 scope, we need evidence from M5/M6 about:
- Whether the SourceAdapter abstraction can support external instruments cleanly
- Whether the AI's collaboration quality (M6) is good enough to justify expanding its scope
- What users actually want to connect to (hardware? DAWs? both?)

---

## Dependency Graph

```
M0: Stabilize
 │
 ▼
M5A: Project Foundation ──────────────────────────────┐
 │                                                     │
 ├──▶ M5B: Parameter & Patch Navigation                │
 │     │                                               │
 │     ├──▶ M5C: AI-Curated Surfaces                   │
 │     │                                               │
 │     └──▶ M5E: Legibility                            │
 │                                                     │
 └──▶ M5D: Sequencer & Listen (parallel) ─────────────┤
                                                       │
                                                       ▼
                                              M6A: Preservation
                                                       │
                                               ┌───────┴───────┐
                                               ▼               ▼
                                      M6B: Aesthetic    M6C: Structured
                                      Direction         Listening
                                               │               │
                                               └───────┬───────┘
                                                       ▼
                                              M6D: Environment
                                              Legibility
                                                       │
                                                       ▼
                                              M7: External
                                              Integration
```

---

## Evergreen Issues (no milestone)

| # | Issue | Notes |
|---|-------|-------|
| 72 | Migrate to gemini-3-flash | When function calling is stable |
| 8 | Graceful AI model degradation | Each AI layer independently disableable |
| 156 | Per-track swing | Sequencer feature, implement when swing UX is clearer |
| 50 | Ableton sequencing adapter spike | M7 territory |
| 6 | Lyria integration + sampler voice | M7 territory (new voice engine type) |

---

## Open Questions

1. **M5 parallelism:** How much of 5A–5D can run in parallel? Project persistence (5A) and offline listen (5D) have no dependency. Parameter surfaces (5B) and sequencer polish (5D) are independent. This suggests two parallel streams are feasible.

2. **When does M6 start?** Aesthetic direction and preservation are prompt + state design — some of this work (reaction history, rationale fields) could start during M5 without waiting for UI surfaces to be complete. The runtime enforcement part of preservation needs the operation executor changes.

3. **Scope of M5B:** The patch view (node graph) is a significant piece of work. Is it essential for M5, or can it be deferred to M6/M7? The human can currently inspect chains via the module inspector — the node graph adds visual wiring but isn't strictly necessary for parameter navigation.

4. **M7 direction:** MIDI output to hardware is the most frequently mentioned external integration. Is that the first M7 deliverable, or is DAW integration (Ableton Link) higher priority?

---

## Design Doc Index

Documents that inform this roadmap, grouped by the phase they primarily serve.

### M5: Workbench
- `docs/rfcs/ai-curated-surfaces.md` — semantic controls, pins, surface curation
- `docs/rfcs/patch-view-layer.md` — node graph as wiring ground truth (PR #165)
- `docs/rfcs/sequencer-view-layer.md` — tracker + addable projection views
- `docs/design-references.md` — NI, Bitwig, Reason, VCV Rack references (PR #165)
- `docs/principles/human-capability-parity.md` — anything AI can do, human can do (PR #165)
- `docs/briefs/offline-listen.md` — offline audio rendering implementation brief

### M6: Collaboration
- `docs/ai/aesthetic-direction.md` — taste through enriched collaboration state
- `docs/rfcs/preservation-contracts.md` — runtime enforcement of approved material
- `docs/ai/ai-musical-environment.md` — target AI environment (structured listening, environment legibility, layered actions)
- `docs/principles/ai-collaboration-model.md` — collaboration phases and posture
- `docs/principles/ai-capability-doctrine.md` — hard boundaries, maximum usefulness inside them

### M7: External Integration
- `docs/gluon-architecture.md` — external integration vision
- `docs/briefs/sequencer.md` — sequencing strategy and adapter boundary
- `docs/rfcs/canonical-musical-model.md` — SourceAdapter abstraction for external instruments
