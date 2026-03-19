# Gluon Roadmap

---

## Where We Are

**As of:** 2026-03-19

M0 through M6 are complete. Gluon has Plaits/Rings/Clouds/Tides synthesis, processor chains (Ripples, EQ, Compressor), Tides modulation, canonical event sequencing, four views (Surface, Rack, Patch, Tracker), project persistence, bus routing, offline listen, and a 20-tool AI collaboration layer.

**Current phase: Finalization.** The goal is to complete all implemented elements to full song composition capability — not new subsystems, but finishing what's started. The AI stack is Gemini-only (Gemini 3.1 Pro planner + Gemini Flash listener). GPT was tried but underperforms on music tasks.

The critical path is: fix blocking bugs → fix AI reliability (#945 resilient agentic architecture) → ship chat UX improvements → agency redesign (#926). A full composition walkthrough (#527) remains the finalization gate but is deferred until significant backlog progress is made — multiple attempts generated more issues than they resolved.

**Completed foundations:** Phases 1–3, M0 stabilisation, M5 workbench, M6 collaboration, Phase 4B (Tides modulation), Finalization waves 1–3, AI capability sprint (15 PRs, 30+ tools/features).

---

## Phase Map

```
  DONE                                                    NOW              LATER
   │                                                       │                 │
   ▼                                                       ▼                 ▼
┌──────────┐   ┌──────────────┐   ┌────────────────┐   ┌──────────────┐   ┌───────────────────┐
│ STABILIZE │──▶│  WORKBENCH   │──▶│  COLLABORATION │──▶│ FINALIZATION  │──▶│    OPEN WORLD     │
│           │   │              │   │                │   │              │   │                   │
│ M0: Fix   │   │ M5: Make the │   │ M6: Make the   │   │ Complete all │   │ M7: Connect to    │
│ what's    │   │ human        │   │ AI a better    │   │ elements to  │   │ the outside       │
│ broken    │   │ effective    │   │ collaborator   │   │ full song    │   │ world             │
│  ✓        │   │  ✓           │   │  ✓             │   │ capability   │   │                   │
└──────────┘   └──────────────┘   └────────────────┘   └──────────────┘   └───────────────────┘
```

Each phase has a clear product test — what can the user do at the end that they can't do now?

---

## STABILIZE — M0: Stabilization

**Status:** Core stabilisation work landed; audit-driven follow-ons remain.

M0 closed the initial blocker clusters that prevented Gluon from feeling like a reliable instrument: transport correctness, voice audibility, UI control stability, chain cleanup, stop/start behavior, and QA gate infrastructure. Later audit work also landed fixes for transport command/state separation, cursor-play behavior, parameter-timing drift, restore-path unification, and several live/offline audio-module parity gaps.

**What M0 delivered:**
- reliable play/stop/pause behavior
- working undo across human and AI edits
- processor/modulator cleanup and execution guards
- offline listen infrastructure with deterministic timing
- a repeatable QA gate for browser and preflight coverage

---

## WORKBENCH — M5: UI Layers

**Status:** Foundations landed; some product claims still need to be made honest.

**Product test:** The human can navigate a complex project fluently — see all parameters, inspect wiring, save and reload, mix voices, and understand what the AI changed.

M5 transformed the UI from scaffolding into a usable workbench. The canonical views are strong, but the audit found that Surface and routing claims still overstate what the current UI really supports.

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
**Enables:** Near-parity for canonical views — the human can inspect most of what the AI can modify through Tracker, Rack, Patch, and chat-visible state. Full parity is still incomplete where the AI can manipulate Surface metadata that the UI does not yet make real.

### 5C: AI-Curated Surfaces (M5 Steps 5–7)

The AI configures what the human sees, not just what the instrument sounds like.

| # | Issue | What |
|---|-------|------|
| 73 | Three-layer UI model | Structural foundation landed; the current Surface tab is still a placeholder/hybrid rather than the full curated-surface model |

**What this is intended to add:**
- Semantic controls (AI-chosen names and ranges for the current context)
- Pin mechanism (human or AI pins important controls to the surface)
- AI surface curation tools (configure XY axes, choose which controls to show)
- Thumbprint visualization from voice parameters

**Design docs:** `docs/rfcs/ai-curated-surfaces.md`
**Dependencies:** 5B (ground-truth views must exist before projections over them).
**Reality check:** parts of this state exist in the model and AI tools, but the current UI does not yet make pinned controls and custom XY axes fully real. Treat this section as the intended direction, not as a claim that the shipped Surface already meets it.

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

These criteria are mostly met for the canonical workbench views, persistence, and AI legibility. They are not fully met for the intended curated Surface model or for routing usability from the human UI.

---

## COLLABORATION — M6: AI Collaboration Quality

**Status:** Core systems landed and later contract-alignment fixes have also shipped.

**Product test:** The AI calibrates its behavior to the session — avoids repeating rejected directions, preserves approved material, sizes its interventions appropriately, and asks when uncertain about taste.

This phase implements the design work from the AI environment docs. The product already has the AI tools; this phase makes the AI *use them well*.

### M6X: Model Stack Prerequisite — Complete

Provider abstraction landed (PR #275). Originally GPT-5.4 planner + Gemini 3 Flash listener (PR #278), now Gemini-only: Gemini 3.1 Pro (planner) + Gemini Flash (listener). GPT was evaluated but underperforms on music tasks.

### 6A0: Collaboration State Foundation — Complete

Landed: approval levels (#336), reaction history (#339), observed patterns and restraint (#344), open decisions (#345), voice importance metadata (#340).

### 6A: Preservation — Complete

Landed: mark_approved tool and UI affordance (#342), preservation enforcement (#346), preservation reports (#349), enriched consequence reporting (#348). Tool consolidation merged mark_approved into set_track_meta (#366).

### 6B: Aesthetic Direction — Complete

Landed: reaction history (#339), observed patterns and restraint guidance (#344). System prompt tuned for taste-informed behavior (#363).

### 6C: Structured Listening — Complete

Landed: question-based listening (#335), comparative listening and listening lenses (#343), audio analysis tools (spectral/dynamics/rhythm, #341). Tool consolidation merged analysis into single `analyze` tool (#366).

### 6D: Environment Legibility — Complete

Landed: voice importance metadata (#340), open decisions (#345), enriched consequence reporting (#348). Tool consolidation merged set_importance into set_track_meta (#366).

### M6A Consolidation

Post-M6 QA and consolidation pass:

| What | PR |
|------|-----|
| API structural integrity audit | #359 |
| raise_decision executor fix | #360 |
| openDecisions persistence fix | #361 |
| Session helper and state compression tests | #362 |
| System prompt consolidation | #363 |
| Tool schema consolidation (26 to 17) | #366 |
| Volume/pan/polyphony audit | #368 |
| M6 behavioral validation scripts | #369, #370 |
| Human capability parity audit | #371 |
| Parity test fixes and QA helper extraction | #380 |

### M6 exit criteria — Met

- Approved material survives AI expansion edits (runtime enforced, not just prompt guidance) -- verified live
- The AI avoids repeating directions the human rejected earlier in the session
- The AI calibrates intervention size based on session evidence
- Listening evaluations answer specific questions rather than producing generic feedback -- verified live
- The AI asks about aesthetic uncertainty rather than guessing -- raise_decision verified live

### Known issue
- `render` tool fails without prior audio context activation (#379). The `listen` tool works independently.

---

## FINALIZATION — Complete to Full Song Composition

**Status:** Active. Blocking bugs being fixed, AI reliability and chat UX in progress.

**Product test:** A human and AI can collaboratively compose a 4-track techno piece from scratch, using only the shipped tools, without hitting blocking bugs or needing workarounds.

### Critical Path

1. **Fix blocking bugs** — notes silent on transport start (#965), extended param dials broken (#966), wrong AI param descriptions (#968)
2. **Fix AI reliability** — stuck in tool loops (#918), duplicate decisions (#928), new tracks untargetable (#939), resilient agentic architecture (#945)
3. **Chat UX** — empty state starters (#970), phase labels (#971), per-turn summary cards (#972), musical reactions (#973), scope badges (#974), listen events (#975). Design brief: `docs/briefs/chat-ux.md`
4. **Agency redesign** — approval-based instead of binary ON/OFF (#926)
5. **Composition walkthrough** — re-attempt #527 after significant progress

### Also in scope

- Per-track swing (#156)
- Tempo-synced parameter values (#959)
- Compound tools for common workflows (#958)
- Patch library (#779)
- Docs truthfulness audit (#572)

### Finalization exit criteria

- The #527 composition walkthrough completes without blocking bugs
- AI can reliably execute multi-step musical tasks without loops or regressions
- Chat UX surfaces the collaboration loop (brief → change → listen → react → next)
- Agency model supports granular permissions, not just binary ON/OFF

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

M5 delivered the structural Surface foundation: four-view navigation, semantic controls, surface templates, and AI surface tools. That does **not** mean the shipped Surface experience is yet the intended curated model.

The next Surface-specific work is partly expressivity and partly contract honesty: the product needs to either realize or narrow the current Surface claim before layering richer visual language on top.

### Surface Expression

| What | Design doc |
|------|-----------|
| Advanced Surface module library and performance-oriented compositions | `docs/rfcs/view-architecture.md` |
| Surface visual language / Surface Score | `docs/briefs/visual-language.md` |

**Framing:** canonical views (Tracker, Rack, Patch) stay exact and trustworthy. Surface is where project-responsive visual identity, performative emphasis, and bounded AI-authored expression can evolve, but the current app still needs follow-on work to make Surface state real and trustworthy.

**Why separate this from M5:** this is no longer foundational cockpit work. It is post-foundation Surface evolution that should not reopen the completed M5 exit criteria.

---

## Dependency Graph

```
M0: Stabilize ✓
 │
 ▼
M5A: Project Foundation ✓ ────────────────────────────┐
 │                                                     │
 ├──▶ M5B: Parameter & Patch Navigation ✓              │
 │     │                                               │
 │     ├──▶ M5C: AI-Curated Surfaces ✓                 │
 │     │                                               │
 │     └──▶ M5E: Legibility ✓                          │
 │                                                     │
 └──▶ M5D: Sequencer & Listen (parallel) ✓ ───────────┤
                                                       │
                                                       ▼
                                              M6X: Model Stack ✓
                                                       │
                                                       ▼
                                              M6: Collaboration ✓
                                                       │
                                                       ▼
                                              Finalization ◀── YOU ARE HERE
                                               │
                                               ├── Blocking bugs
                                               ├── AI reliability (#945)
                                               ├── Chat UX (#970-976)
                                               ├── Agency redesign (#926)
                                               └── Composition walkthrough (#527)
                                                       │
                                                       ▼
                                              M7: External Integration

Parallel long-term stream:
M5/M6 foundations ───────────────────────────▶ Modular Evolution
```

---

## Evergreen Issues (no milestone)

| # | Issue | Notes |
|---|-------|-------|
| ~~72~~ | ~~Migrate to gemini-3-flash~~ | Done (PR #278) |
| ~~156~~ | ~~Per-track swing~~ | Moved to Finalization, `priority:next` |
| 8 | Graceful AI model degradation | Each AI layer independently disableable |
| 50 | Ableton sequencing adapter spike | M7 territory (deprioritized) |
| 6 | Lyria integration + sampler voice | M7 territory (deprioritized) |

---

## Open Questions

1. ~~**How should approval granularity work in M6A?**~~ Resolved: voice-level approval with four levels (exploratory, liked, approved, anchor). Shipped in M6.

2. ~~**How should preservation surface in the UI?**~~ Resolved: approval cycle button (“A”) on track rows in the sidebar, plus chat-based preservation reports. Shipped in M6.

3. **What counts as “family-preserving” in practice?** `preserve_exact` can be enforced structurally; `preserve_family` requires similarity rules that are musically useful but not brittle. Still open — only `preserve_exact` is implemented.

4. ~~**M7 direction:**~~ Resolved: deprioritized. Focus on standalone depth. M7 deferred until after Finalization.

5. **Agency redesign (#926):** Binary ON/OFF is too blunt. Approval-based or permission-request model? Design-tier, in Finalization scope.

6. **Resilient agentic architecture (#945):** Batch one-shot tool model is fragile. Decomposed step-by-step execution with streaming feedback, error recovery, and circuit breakers needed. The architectural question that most affects AI reliability.

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

### Finalization
- `docs/briefs/chat-ux.md` — chat UX collaboration loop (7 shippable improvements)
- `docs/principles/ai-collaboration-model.md` — behavioral contract the chat UI should make visible
- `docs/principles/ai-interface-design-principles.md` — transparency, legibility, composability

### Modular Evolution
- `docs/briefs/modular-roadmap.md` — long-horizon modular patching path beyond the current chain model
- `docs/rfcs/phase4a.md` — constrained patch chains as the first modular step

### M7: External Integration
- `docs/gluon-architecture.md` — external integration vision
- `docs/briefs/sequencer.md` — sequencing strategy and adapter boundary
- `docs/rfcs/canonical-musical-model.md` — SourceAdapter abstraction for external instruments
