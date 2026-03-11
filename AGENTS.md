# Gluon

## What This Is

Gluon is the Claude Code of music: an open source platform where you describe what you want and an AI makes it happen on a shared instrument. The human directs the AI via natural language, the AI makes structured changes to the project, the human listens and iterates.

## Architecture

- **Browser-based**: React + TypeScript + Vite
- **Audio**: Mutable Instruments Plaits DSP compiled to WebAssembly via Emscripten, running in an AudioWorklet
- **AI (reasoning)**: Google Gemini API (`@google/genai`) for project state reasoning and structured edits
- **AI (audio eval)**: Gemini native audio model for listening to rendered audio snapshots
- **Protocol**: Custom interaction protocol (see `docs/gluon-interaction-protocol-v03.md`)

## Key Concepts

- **Voices**: Things that make sound, with parameters normalised 0.0-1.0
- **Agency**: Per-voice AI permission (OFF / ON) — AI only modifies voices with agency ON, and only when asked
- **Arbitration**: Human's hands always win when both touch the same parameter
- **Undo**: Reverses AI actions only, grouped by action groups
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

## Reference Docs

- `docs/gluon-architecture.md` - Full vision and architecture
- `docs/gluon-interaction-protocol-v03.md` - Protocol spec (v0.4.0)
- `docs/gluon-phase1-build.md` - Phase 1 implementation brief
