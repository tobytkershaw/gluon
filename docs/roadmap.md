# Gluon Roadmap

---

## Where We Are

Gluon now has a working cockpit as well as a working engine: 4-voice Plaits synthesis, Rings and Clouds processors, Tides modulation, canonical event sequencing, four navigable views (Surface, Rack, Patch, Tracker), project persistence, mix bus, offline listen, and AI-curated surface tools.

What it still cannot do well enough is collaborate over time with taste and memory. The next gap is not "show more controls" or "add another view" — it is teaching the AI to preserve approved material, reason about what matters, and size edits to the session's history.

The roadmap from here is therefore less about structural UI and more about collaboration quality.

**Completed:** Phases 1–3, M0–M5, Phase 4B (Tides modulation).

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

**Status:** Complete.

M0 closed the blocker clusters that prevented Gluon from feeling like a reliable instrument: transport correctness, voice audibility, UI control stability, chain cleanup, stop/start behavior, and QA gate infrastructure. Follow-on fixes (pause vs hard stop, offline listen timing, chain rebuild smoothing, stop/start race fencing) also landed during late M5 work.

**What M0 delivered:**
- reliable play/stop/pause behavior
- working undo across human and AI edits
- processor/modulator cleanup and execution guards
- offline listen infrastructure with deterministic timing
- a repeatable QA gate for browser and preflight coverage

---

## WORKBENCH — M5: UI Layers

**Status:** Complete.

**Product test:** The human can navigate a complex project fluently — see all parameters, inspect wiring, save and reload, mix voices, and understand what the AI changed.

M5 transformed the UI from scaffolding into a usable workbench and is now effectively closed.

### 5A: Project Foundation

The minimum for the app to feel like a real tool rather than a demo.

| # | Issue | What |
|---|-------|------|
| 159 | Project persistence | Landed |
| 154 | Move track controls to vertical sidebar | Landed |
| 160 | Mix bus | Landed |
| 164 | Pause vs hard stop | Landed |

**Dependencies:** M0 complete (no point saving broken state).
**Enables:** Users can work across sessions. Mix bus enables basic mixing. Layout enables scaling beyond 4 voices.

### 5B: Parameter & Patch Navigation

The human needs to see and control everything the AI can touch.

| # | Issue | What |
|---|-------|------|
| 162 | Parameter surface layer | Landed |
| 126 | Control surface layout | Landed |
| 158 | Patch view (node graph) | Landed |
| 161 | Generic voices | Landed as a product decision and follow-on implementation |

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
| 73 | Three-layer UI model | Structural foundation landed; remaining Surface ambition is now post-M5 follow-on work |

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
| 118 | Tracker view switch discards edits | Landed |
| 106 | Offline audio rendering for listen tool | Landed |
| 107 | Voice isolation for listen tool | Landed |
| 108 | Configurable bar count for listen | Landed |

**Design docs:** `docs/briefs/offline-listen.md`
**Dependencies:** None (can run in parallel with 5A–5C).
**Enables:** AI self-evaluation becomes reliable and flexible. Prerequisite for structured listening in M6.

### 5E: Legibility

| # | Issue | What |
|---|-------|------|
| 163 | AI action legibility | Landed |
| 123 | System messages labelled as AI | Landed |

**Dependencies:** 5A (chat sidebar). Better after 5B (parameter/patch views exist to show diffs against).
**Enables:** The human understands what the AI did without reading parameter lists. Trust.

### M5 exit criteria
- Human can save, close, reopen a project and continue working
- Human can see all parameters across all voices and processors
- Human can inspect signal chain and modulation routing visually
- AI can curate which controls the human sees
- AI can evaluate audio offline with voice isolation
- Human can understand AI actions from the chat history

These criteria are now met by the current build.

---

## COLLABORATION — M6: AI Collaboration Quality

**Product test:** The AI calibrates its behavior to the session — avoids repeating rejected directions, preserves approved material, sizes its interventions appropriately, and asks when uncertain about taste.

This phase implements the design work from the AI environment docs. The product already has the AI tools; this phase makes the AI *use them well*.

**Current focus:** M6A Preservation.

### M6X: Model Stack Prerequisite

Before judging collaboration quality, Gluon needs to know which model stack is actually responsible for planning, editing, and listening.

| What | Design doc |
|------|-----------|
| Provider abstraction for planner / editor / listener roles | `docs/rfcs/gluon_model_capability_assessment.md` |
| Planner-model bakeoff against Gluon's collaboration contract | `docs/rfcs/gluon_model_capability_assessment.md` |
| Listener-model evaluation for audio reasoning quality | `docs/rfcs/gluon_model_capability_assessment.md` |

**Why it matters:** preservation, restraint, structured listening, and consequence reporting all depend on the behavior of the actual planner/editor/listener stack. If the model stack is unsettled, M6 behavior tuning is partly tuning the wrong thing.

**Dependencies:** M5 complete.
**Enables:** M6A–M6D become more meaningful once the provider/model role split is explicit and the shipping collaboration stack is known.

### 6A0: Collaboration State Foundation

Before preservation, aesthetic direction, and structured listening feel coherent, Gluon needs a richer shared collaboration-state layer.

| What | Design doc |
|------|-----------|
| Approved and rejected directions with rationale | `docs/ai/ai-musical-environment.md` |
| Observed patterns / taste summary | `docs/ai/aesthetic-direction.md` |
| Open decisions and active brief | `docs/ai/ai-musical-environment.md` |
| Listener observations and comparison context | `docs/ai/ai-musical-environment.md` |
| Restraint / intervention sizing cues | `docs/ai/aesthetic-direction.md` |

**Why it matters:** the newer collaboration docs assume more than isolated tools. They assume the AI and human are collaborating over a shared session memory, not just over the current transport and parameter state.

**Dependencies:** M5 complete.
**Enables:** M6A–M6D all become more coherent once there is a real collaboration-state layer rather than scattered one-off fields.

### 6A: Preservation

| What | Design doc |
|------|-----------|
| Approval levels on voices and aspects | `docs/rfcs/preservation-contracts.md` |
| `mark_approved` / `preserve_material` tools | `docs/rfcs/preservation-contracts.md` |
| Runtime enforcement of preservation constraints | `docs/rfcs/preservation-contracts.md` |
| Preservation reports on edits | `docs/rfcs/preservation-contracts.md` |

**Immediate backlog shape:**
- approval levels in session state and compressed AI state
- `mark_approved` tool and UI affordance
- executor enforcement for simple `preserve_exact` rhythm constraints
- preservation contracts and reports for expansion-style edits
- visible approval / protection affordances in the UI (not chat-only)

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
| `compare(candidateIds, question)` tool | `docs/ai/ai-musical-environment.md` |
| `summarize_voice(trackId)` tool | `docs/ai/ai-musical-environment.md` |
| `ask_clarifying(question)` collaboration tool | `docs/ai/ai-musical-environment.md` |

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

## Modular Evolution

The repo's modular design docs still describe a meaningful long-horizon product stream that is distinct from external integration. It should remain visible in the roadmap even if collaboration quality is the current focus.

### Why this is separate from M7

External integration is about connecting Gluon to hardware, DAWs, and other outside systems.

The modular roadmap is about deepening Gluon as an internal patch-design environment:
- constrained patch chains
- guided modular routing
- composition-aware modular tools
- richer module libraries and AI patch editing

Those are different bets and should not be collapsed into one phase heading.

### Likely modular path

| Stage | What | Reference |
|------|------|-----------|
| Constrained patch chains | Small, legible source → processor → modulation chains | `docs/rfcs/phase4a.md` |
| Guided modular patching | Constrained graphs beyond linear chains | `docs/briefs/modular-roadmap.md` |
| Composition-aware modular tools | Grids / Marbles-style higher-level patching | `docs/briefs/modular-roadmap.md` |
| Fuller modular environment | Richer routing, macro structures, deeper AI patch editing | `docs/briefs/modular-roadmap.md` |

**Framing:** this is a long-term internal product evolution stream, not a statement that it should pre-empt M6 collaboration work now.

---

## Surface Follow-On

M5 delivered the structural Surface foundation: four-view navigation, semantic controls, surface templates, and AI surface tools. That does **not** mean Surface expression is finished.

The next Surface-specific work is no longer core M5 plumbing; it is a follow-on stream that builds on the completed foundation.

### Surface Expression

| What | Design doc |
|------|-----------|
| Advanced Surface module library and performance-oriented compositions | `docs/rfcs/view-architecture.md` |
| Surface visual language / Surface Score | `docs/briefs/visual-language.md` |

**Framing:** canonical views (Tracker, Rack, Patch) stay exact and trustworthy. Surface is where project-responsive visual identity, performative emphasis, and bounded AI-authored expression can evolve.

**Why separate this from M5:** this is no longer foundational cockpit work. It is post-foundation Surface evolution that should not reopen the completed M5 exit criteria.

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
                                              M6X: Model Stack
                                                       │
                                                       ▼
                                              M6A0: Collaboration
                                              State Foundation
                                                       │
                                               ┌───────┴───────┐
                                               ▼               ▼
                                      M6A: Preservation M6B: Aesthetic
                                                        Direction
                                               │               │
                                               └───────┬──────────────┐
                                                       ▼              ▼
                                              M6C: Structured   M6D: Environment
                                              Listening         Legibility
                                                       ▼
                                                       │
                                                       ▼
                                              M7: External
                                              Integration

Parallel long-term stream:
M5/M6 foundations ───────────────────────────▶ Modular Evolution
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

1. **How should approval granularity work in M6A?** Voice-level approval is easy to explain, but partial approvals on rhythm, timbre, contour, and relationships are more powerful. What is the minimum shippable granularity?

2. **How should preservation surface in the UI?** Chat-only reporting is cheap, but approval state likely also needs visible affordances in Surface/Rack/Patch so the human can see what is protected.

3. **What counts as “family-preserving” in practice?** `preserve_exact` can be enforced structurally; `preserve_family` requires similarity rules that are musically useful but not brittle.

4. **M7 direction:** MIDI output to hardware is still the most obvious first external integration. Is that still the first M7 deliverable, or has DAW integration become higher priority?

---

## Design Doc Index

Documents that inform this roadmap, grouped by the phase they primarily serve.

### M5: Workbench
- `docs/rfcs/view-architecture.md` — four-view model: three canonical views (Tracker, Rack, Patch) + one custom view (Surface). Surface module library taxonomy
- `docs/rfcs/ai-curated-surfaces.md` — semantic controls, pins, surface curation, VoiceSurface type
- `docs/rfcs/patch-view-layer.md` — node graph as wiring ground truth (PR #165)
- `docs/rfcs/sequencer-view-layer.md` — tracker + addable projection views
- `docs/design-references.md` — NI, Bitwig, Reason, VCV Rack references (PR #165)
- `docs/principles/human-capability-parity.md` — anything AI can do, human can do (PR #165)
- `docs/briefs/offline-listen.md` — offline audio rendering implementation brief
- `docs/briefs/visual-language.md` — project-responsive Surface visual language and Surface Score (post-M5 Surface evolution)

### M6: Collaboration
- `docs/rfcs/gluon_model_capability_assessment.md` — provider roles, model-stack bakeoff, planner/editor/listener evaluation
- `docs/ai/aesthetic-direction.md` — taste through enriched collaboration state
- `docs/rfcs/preservation-contracts.md` — runtime enforcement of approved material
- `docs/ai/ai-musical-environment.md` — target AI environment (structured listening, environment legibility, layered actions)
- `docs/principles/ai-collaboration-model.md` — collaboration phases and posture
- `docs/principles/ai-capability-doctrine.md` — hard boundaries, maximum usefulness inside them

### Modular Evolution
- `docs/briefs/modular-roadmap.md` — long-horizon modular patching path beyond the current chain model
- `docs/rfcs/phase4a.md` — constrained patch chains as the first modular step

### M7: External Integration
- `docs/gluon-architecture.md` — external integration vision
- `docs/briefs/sequencer.md` — sequencing strategy and adapter boundary
- `docs/rfcs/canonical-musical-model.md` — SourceAdapter abstraction for external instruments
