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

This repo is worked on by multiple AI agents (Claude Code, Codex, etc.) in parallel. Rules:

### Branching
- `dev` is the integration branch — treat it as read-only during active work
- One task per branch, one agent per branch
- Rebase onto `dev` before opening a PR, not during parallel editing
- Merge small PRs frequently rather than letting branches drift

### Worktrees
- Each agent uses its own worktree directory (auto-managed)
- Both `.claude/worktrees/` and `.codex-worktrees/` are gitignored
- Vitest excludes worktree directories (see `vite.config.ts`)
- Clean up stale worktrees periodically: `git worktree prune`

### Avoiding Conflicts
- Split work by **module boundary** (`src/audio/`, `src/ai/`, `src/engine/`, `src/ui/`), not by task type
- If two agents need the same file, assign ownership before starting — don't merge and hope
- Shared types in `src/engine/types.ts` are the highest-conflict file; coordinate changes there
- After one PR merges, the other rebases before merging

### Verification
- `npx tsc --noEmit` — zero type errors
- `npx vitest run` — all tests pass
- Both checks must pass after rebase, before merge

## GitHub Backlog Hygiene

- When creating or updating issues, preserve the backlog structure already in GitHub.
- Close issues that are already merged; do not leave done work open.
- For active implementation work, add:
  - one area label: `phase-3`, `phase-4a`, `canonical-model`, `ai-models`, `infrastructure`, or `sequencer`
  - one priority label: `priority:now`, `priority:next`, or `priority:later`
- Use `audit` for QA, review, and assessment work rather than feature implementation.
- Use milestones consistently:
  - `M1–M3` — complete (sequencer foundations, expressivity, surfaces)
  - `M4: First Chain` — prove modular chains end-to-end (Rings, structure tools, human undo)
  - `M5: UI Layers` — UI foundation from curated surfaces RFC + external adapters
- Do not create GitHub Projects or expand the label taxonomy unless explicitly asked.

## Reference Docs

- `docs/gluon-architecture.md` - Full vision and architecture
- `docs/gluon-interaction-protocol-v05.md` - Protocol spec (v0.5.0)
- `docs/status.md` - Current build status and milestone tracking

### Principles (`docs/principles/`)
- `docs/principles/ai-capability-doctrine.md` - Project-level doctrine for AI product posture: keep boundaries hard, then maximize AI usefulness inside them.
- `docs/principles/ai-interface-design-principles.md` - **Read before changing anything in `src/ai/`**. Defines how the AI layer should expose state, tools, constraints, and feedback. Applies to prompts, tool declarations, state compression, and error handling.
- `docs/principles/ai-collaboration-model.md` - What good human-AI collaboration looks like: phases, posture, roles, model evaluation criteria.

### AI Contract (`docs/ai/`)
- `docs/ai/ai-contract.md` - What the AI agent needs at inference time: tools, state format, validation rules.
- `docs/ai/ai-musical-environment.md` - Target AI environment: layered state, layered actions, tool families, loop-native structure.

### RFCs (`docs/rfcs/`)
- `docs/rfcs/canonical-musical-model.md` - Canonical musical model: Voice, Region, MusicalEvent, ControlSchema, SourceAdapter.
- `docs/rfcs/ai-curated-surfaces.md` - AI-curated UI surfaces: semantic controls, views, pins.
- `docs/rfcs/sequencer-view-layer.md` - Sequencer views as projections over canonical events.
- `docs/rfcs/phase4a.md` - Phase 4A: constrained patch chains.

### Briefs (`docs/briefs/`)
- `docs/briefs/phase4a.md` - Phase 4A implementation brief.
- `docs/briefs/sequencer.md` - Sequencing strategy and product boundaries.
- `docs/briefs/offline-listen.md` - Offline audio rendering for the listen tool.
