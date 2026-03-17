# Contributing to Gluon

This repository is worked on by humans and multiple coding agents in parallel. The workflow needs to stay predictable under that load.

This document is the shared contribution contract for:
- backlog triage
- issue ownership
- branch and worktree hygiene
- Codex / Claude Code division of labor
- merge sequencing

`AGENTS.md` and `CLAUDE.md` contain model-specific instructions. This file is the repository-wide workflow baseline.

## Core Rules

1. One issue = one branch = one PR.
2. Every code-writing agent works in a worktree, never in the main checkout.
3. Split work by module boundary, not by task type.
4. Keep issues self-contained enough that an agent can pick them up without reading an audit thread first.
5. Merge small PRs quickly; do not let long-lived branches accumulate hidden conflicts.

## Worktrees

- `main` is the shared integration checkout. Do not write code there.
- Codex work happens in `.codex-worktrees/`.
- Claude Code work happens in `.claude/worktrees/` or equivalent worktree isolation.
- After merge:
  - remove the worktree
  - delete the merged local branch
  - periodically run `git worktree prune` and `git fetch --prune`

## Backlog Structure

Every active implementation issue should have:
- one area label
- one priority label
- one milestone

When an issue is actively being worked, also add exactly one provisional owner label:
- `provisional:codex`
- `provisional:claude`

These labels are temporary execution signals, not permanent taxonomy. Remove or switch them when work is handed off, paused, or merged.

Before implementation starts, the provisional owner label must already match the agent who is about to work on the issue.

- If Codex takes an issue currently marked `provisional:claude`, switch the label first, then create the worktree and branch.
- If Claude takes an issue currently marked `provisional:codex`, switch the label first, then start implementation.
- If ownership is changing after work has already started, leave a short issue comment when switching labels so the handoff is explicit.
- Never leave both provisional owner labels on the same issue.

## Issue Quality

Implementation issues should be self-contained. Each issue body should include:
- summary
- problem statement
- scope
- non-goals
- acceptance criteria
- verification
- dependencies / sequencing

Audit issues can be lighter, but implementation issues should not depend on a separate report for basic context.

## Parallel Delivery Model

Use a continuous pipeline, not batch waves.

- Keep 3-5 independent issues in flight when the backlog supports it.
- As one PR merges, assign the next newly-unblocked issue immediately.
- Do not wait for a full batch to finish before reviewing or merging.

Recommended sequence for a large backlog:
1. fix-now correctness bugs
2. contract unification
3. architectural extraction
4. coverage hardening
5. roadmap feature work built on the stabilized contracts

## Codex / Claude Code Split

Use the tools where they are strongest rather than splitting work evenly by issue count.

### Claude Code should usually own

- token-intensive cross-cutting work
- large UI/view-layer changes
- broad architecture passes
- multi-file refactors with heavy coordination cost
- tasks that benefit from parallel sub-agents
- large roadmap slices that need orchestration across several modules

### Codex should usually own

- scoped bug fixes
- engine and scheduler fixes with clear boundaries
- persistence fixes
- targeted test additions and parity hardening
- backlog hygiene, issue cleanup, and focused follow-through work
- smaller or medium-sized implementation issues that benefit from direct end-to-end execution

### Do not split by model preference alone

Split by:
- file ownership
- blast radius
- need for orchestration
- need for deep local iteration

Not by:
- “frontend vs backend”
- “easy vs hard”
- whichever agent happens to be free first

## Ownership Rules

Before starting parallel work, assign file/module ownership explicitly.

High-conflict files:
- `src/engine/types.ts`
- `src/ui/App.tsx`
- `src/audio/audio-engine.ts`

If two issues need one of those files:
- sequence them, or
- assign one agent as the owner and keep the other issue out of that file

## Suggested Execution Pattern

For each issue:
1. assign provisional owner label
2. create worktree and branch
3. implement only the scoped issue
4. run targeted verification during development
5. rebase onto `main`
6. run final verification
7. open PR with `Closes #NNN`
8. merge quickly once checks and review level are satisfied
9. remove provisional label after merge or handoff

## Review Depth

Match review depth to risk.

- low risk: obvious docs/config/small isolated fixes
- medium risk: standard bug fixes and local state changes
- high risk: audio runtime, undo, persistence, AI contract, protocol, scheduler

High-risk changes should usually get an explicit second pass before merge, even when the implementation issue is well-scoped.

## Handoffs

When handing work from one agent to another, include:
- issue number
- branch name
- worktree path
- files touched
- verification already run
- unresolved risks
- exact next step

Do not hand off with “continue from here” and no state.

## Roadmap Progression

Once the stabilization backlog is under control, keep the same workflow for roadmap work.

- Use self-contained issues for each roadmap slice.
- Keep architecture issues separate from UI polish issues.
- Land enabling contract work before dependent feature work.
- Prefer vertical slices that produce a mergeable result over broad unfinished groundwork.

## Reference Docs

- `AGENTS.md`
- `CLAUDE.md`
- `docs/roadmap.md`
- `docs/audits/2026-03-system-audit.md`
