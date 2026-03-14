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

### Worktrees Are Mandatory

**Every agent MUST work in a worktree, never in the main checkout.** The main checkout is shared — if one agent switches branches or leaves modified files, it breaks every other agent.

- **Codex:** Always use `.codex-worktrees/` (auto-managed). Never modify files in the root checkout directly.
- **Claude Code:** Uses `.claude/worktrees/` or `isolation: "worktree"` on Agent tool calls.
- Both `.claude/worktrees/` and `.codex-worktrees/` are gitignored
- Vitest excludes worktree directories (see `vite.config.ts`)
- Clean up stale worktrees periodically: `git worktree prune`

**Why this matters:** We have had incidents where agent work switched the branch in the main checkout mid-session, causing commits to land on wrong branches and modified files to contaminate unrelated work. Worktrees prevent this entirely.

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

## GitHub Backlog Hygiene

- When creating or updating issues, preserve the backlog structure already in GitHub.
- Close issues that are already merged; do not leave done work open.
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
- `docs/gluon-interaction-protocol-v05.md` - Protocol spec (v0.5.0)
- `docs/status.md` - Current build status and milestone tracking
- `docs/principles/ai-interface-design-principles.md` - **Read before changing anything in `src/ai/`**. Defines how the AI layer should expose state, tools, constraints, and feedback.
- `docs/principles/ai-capability-doctrine.md` - Hard boundaries, then maximize AI usefulness inside them.
- `docs/principles/ai-collaboration-model.md` - What good human-AI collaboration looks like.
