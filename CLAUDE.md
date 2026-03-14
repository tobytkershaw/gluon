# Gluon

## What This Is

Gluon is the Claude Code of music: an open source platform built around an AI-legible musical core that you can glue instruments, workflows, and hardware onto. The human directs the AI via natural language, the AI makes structured changes to the project, and the human listens, iterates, or undoes.

## Architecture

- **Browser-based**: React + TypeScript + Vite
- **Audio**: Mutable Instruments Plaits DSP compiled to WebAssembly via Emscripten, running in an AudioWorklet
- **AI (reasoning)**: Google Gemini API (`@google/genai`) for project state reasoning and structured edits
- **AI (audio eval)**: Gemini native audio model for listening to rendered audio snapshots
- **Protocol**: Custom interaction protocol (see `docs/gluon-interaction-protocol-v05.md`)

## Key Concepts

- **Voices**: Things that make sound, with parameters normalised 0.0-1.0
- **Agency**: Per-voice AI permission (OFF / ON) — AI only modifies voices with agency ON, and only when asked
- **Arbitration**: Human's hands always win when both touch the same parameter
- **Undo**: Reverses all actions (human and AI) in LIFO order, grouped by action groups
- **Audio snapshots**: Rendered clips sent to multimodal model for AI self-evaluation

## Project Structure

```
src/
  audio/       # WASM bridge, AudioWorklet, Web Audio setup
  engine/      # Protocol types, session state, undo stack
  ai/          # Gemini API, state compression, response parsing
  ui/          # React components (parameter space, chat, controls)
wasm/          # Plaits C++ source and Emscripten build
docs/          # Architecture docs and protocol spec
```

## Tech Stack

- TypeScript, React, Vite, Tailwind CSS
- Emscripten (C++ to WASM)
- Web Audio API + AudioWorklet
- Google GenAI SDK (`@google/genai`)

## Development Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run wasm:build   # Compile Plaits to WASM
```

## Key Design Principles

1. The human's hands always win (arbitration rule)
2. The AI plays the instrument, it does not replace it
3. The AI acts when asked (no unsolicited actions)
4. The AI can hear its own work (audio snapshots)
5. Undo is always one action away

## Multi-Agent Workflow

This repo is worked on by multiple AI agents (Claude Code, Codex, etc.) in parallel. The lead agent acts as team lead: triaging the backlog, dispatching work to parallel agents, reviewing plans, and merging PRs.

### Continuous Pipeline (not batch waves)

Work flows continuously — no wave branches, no batch-and-review cycles.

- **One issue = one branch = one PR.** No aggregating work into wave branches.
- Dispatch 3-5 agents in parallel on independent issues
- As each completes, review/merge and dispatch newly-unblocked work
- Pipeline review with implementation: while one PR is reviewed, the next batch is already running

### Three-Tier Planning

| Tier | When | Planning |
|------|------|----------|
| **Trivial** | Renames, config, one-file fixes with obvious diffs | No plan — just implement |
| **Standard** | Clear bug fixes, scoped features, isolated components | Agent starts in plan mode, lead reviews plan, then approves execution |
| **Design** | New subsystems, cross-cutting changes, product decisions | Human and AI align on plan together before any code |

### Worktrees Are Mandatory

**Every agent MUST work in a worktree, never in the main checkout.** The main checkout is shared — if one agent switches branches or leaves modified files, it breaks every other agent.

- **Claude Code:** Use `isolation: "worktree"` on every Agent tool call that writes code. For the main conversation, create a worktree branch before making changes: `git worktree add .claude/worktrees/<task-name> -b <branch-name>`
- **Codex:** Uses `.codex-worktrees/` (auto-managed)
- Both `.claude/worktrees/` and `.codex-worktrees/` are gitignored
- Vitest excludes worktree directories (see `vite.config.ts`)
- Clean up stale worktrees periodically: `git worktree prune`

**Why this matters:** We have had incidents where Codex review work switched the branch in the main checkout mid-session, causing commits to land on wrong branches and modified files to contaminate unrelated work. Worktrees prevent this entirely.

### Branching
- `main` is the integration branch — never commit directly during parallel work
- One task per branch, one agent per branch
- Rebase onto `main` before opening a PR, not during parallel editing
- Merge small PRs frequently rather than letting branches drift

### Avoiding Conflicts
- Split work by **module boundary** (`src/audio/`, `src/ai/`, `src/engine/`, `src/ui/`), not by task type
- If two agents need the same file, assign ownership before starting — don't merge and hope
- Shared types in `src/engine/types.ts` are the highest-conflict file; coordinate changes there
- After one PR merges, the other rebases before merging

### Verification
- `npx tsc --noEmit` — zero type errors
- `npx vitest run` — all tests pass
- Both checks must pass after rebase, before merge

### PR Review
After completing a plan's implementation, always open a PR. Then choose the review level proportional to the risk of the change. Default to merging quickly when checks pass — don't add overhead to routine work.

| Level | When to use | What it does |
|-------|------------|--------------|
| **Just merge** | Renames, lint fixes, cosmetic UI, docs, config changes. Anything where the diff is obvious and checks pass. | No review tooling — merge after verification. |
| **`/review`** | Non-trivial bug fixes, logic changes, state management, anything where a second pair of eyes adds value. | Single-pass code review checking for bugs and CLAUDE.md compliance. |
| **`gluon-reviewer`** | Changes to core engine (`src/engine/`), AI contract (`src/ai/`), protocol types, or audio pipeline (`src/audio/`). | Checks Gluon-specific invariants and design principle adherence. |
| **`/pr-review-toolkit:review-pr`** | Large refactors, new subsystems, changes to critical paths (persistence, audio rendering, undo). High blast radius. | Heavy multi-agent review (code, types, error handling, test coverage). |

These can be combined — e.g. `/review` + `gluon-reviewer` for engine changes. Use judgement.

## GitHub Backlog Hygiene

- When creating or updating issues, preserve the backlog structure already in GitHub.
- **Always use `Closes #NNN` in PR descriptions** to autoclose issues on merge. Never manually close issues with `gh issue close`.
- For active implementation work, add:
  - one area label: `phase-3`, `phase-4a`, `canonical-model`, `ai-models`, `infrastructure`, or `sequencer`
  - one priority label: `priority:now`, `priority:next`, or `priority:later`
- Use `audit` for QA, review, and assessment work rather than feature implementation.
- Use milestones consistently:
  - `M0–M4, Phase 4B` — complete (stabilization, sequencer, chains, modulation)
  - `M0: Stabilization` (current) — pre-M5 QA bug fixes
  - `M5: UI Layers` — project foundation, parameter/patch navigation, AI-curated surfaces, listen tool
  - `M6: Collaboration` — preservation contracts, aesthetic direction, structured listening
  - `M7: External Integration` — MIDI output, hardware profiles, DAW integration
  - See `docs/roadmap.md` for the full implementation roadmap
- Do not create GitHub Projects or expand the label taxonomy unless explicitly asked.

## Reference Docs

- `docs/roadmap.md` - **Implementation roadmap**: M0 → M5 → M6 → M7 with dependencies, design doc mapping, and exit criteria
- `docs/gluon-architecture.md` - Full vision and architecture
- `docs/design-references.md` - Design references from synths, DAWs, and related tools: Guitar Rig (rack + inline params), Bitwig (modulation, remote controls), Reason, VCV Rack, Ableton, Max, and others. Includes parameter ground truth analysis and modulation display comparison.
- `docs/gluon-interaction-protocol-v05.md` - Protocol spec (v0.5.0)
- `docs/status.md` - Current build status and milestone tracking

### Principles (`docs/principles/`)
- `docs/principles/ai-capability-doctrine.md` - Project-level doctrine for AI product posture: keep boundaries hard, then maximize AI usefulness inside them.
- `docs/principles/ai-interface-design-principles.md` - **Read before changing anything in `src/ai/`**. Defines how the AI layer should expose state, tools, constraints, and feedback. Applies to prompts, tool declarations, state compression, and error handling.
- `docs/principles/ai-collaboration-model.md` - What good human-AI collaboration looks like: phases, posture, roles, model evaluation criteria.
- `docs/principles/human-capability-parity.md` - Anything the AI can do, the human should have a means to do.

### AI Contract (`docs/ai/`)
- `docs/ai/ai-contract.md` - What the AI agent needs at inference time: tools, state format, validation rules.
- `docs/ai/ai-musical-environment.md` - Target AI environment: layered state, layered actions, tool families, structured listening, loop-native structure.
- `docs/ai/aesthetic-direction.md` - How taste emerges from enriched collaboration state: reaction history, observed patterns, restraint guidance, prompt rules. No standalone taste subsystem.

### RFCs (`docs/rfcs/`)
- `docs/rfcs/canonical-musical-model.md` - Canonical musical model: Voice, Region, MusicalEvent, ControlSchema, SourceAdapter.
- `docs/rfcs/view-architecture.md` - View architecture: three canonical views (Tracker, Rack, Patch) as data model ground truth, one custom view (Surface) composed from a library of surface modules. Full module taxonomy.
- `docs/rfcs/ai-curated-surfaces.md` - AI-curated UI surfaces: semantic controls, VoiceSurface state, AI curation operations. Foundation for the Surface view's module system.
- `docs/rfcs/sequencer-view-layer.md` - Sequencer views as projections over canonical events.
- `docs/rfcs/phase4a.md` - Phase 4A: constrained patch chains.
- `docs/rfcs/preservation-contracts.md` - Runtime enforcement of approved material during AI edits: approval levels, preservation constraints, reports, artifact lineage.
- `docs/rfcs/patch-view-layer.md` - Patch views as projections over chain/modulation data. Node graph is the ground-truth view (like tracker for sequencing); inline modulation, chain strips are projections.

### Briefs (`docs/briefs/`)
- `docs/briefs/phase4a.md` - Phase 4A implementation brief.
- `docs/briefs/sequencer.md` - Sequencing strategy and product boundaries.
- `docs/briefs/offline-listen.md` - Offline audio rendering for the listen tool.
