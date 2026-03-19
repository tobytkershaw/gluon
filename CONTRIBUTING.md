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
- **Clean up after merging** — do this immediately, not "later":
  - `git worktree remove .codex-worktrees/<task>` (or `.claude/worktrees/<task>`)
  - `git branch -d <branch-name>`
  - Periodically run `git worktree prune`, `git fetch --prune`, and delete all merged/gone local branches
  - Branch bloat slows git operations for every agent

## Backlog Structure

Every active implementation issue should have:
- one area label
- one priority label
- one milestone

Issues use a two-state ownership model:

- `provisional:codex` / `provisional:claude` — **planned** assignment from backlog grooming. Not yet started.
- `active:codex` / `active:claude` — agent is **actively working** on this issue.

**The first action when picking up an issue is to claim it.** Remove the `provisional:*` label and add the matching `active:*` label. This happens before creating a worktree, before reading code, before starting a plan. It's a hard gate, not a suggestion.

- If picking up an issue assigned to a different agent, switch both labels to yours and leave a short issue comment explaining the reassignment.
- Never leave both `provisional:` and `active:` labels, or labels for both agents, on the same issue.
- Remove all ownership labels after merge or if you abandon the issue.

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

## Three-Tier Planning

Match planning depth to the scope and risk of the change.

| Tier | When | Planning |
|------|------|----------|
| **Trivial** | Renames, config, one-file fixes with obvious diffs | No plan — just implement |
| **Standard** | Clear bug fixes, scoped features, isolated components | Agent starts in plan mode, lead reviews plan, then approves execution |
| **Design** | New subsystems, cross-cutting changes, product decisions | Human and AI align on plan together before any code |

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
1. **claim ownership** — remove `provisional:*` and add `active:codex` or `active:claude`. If reassigning from another agent, comment on the issue. This is step 1, before any code or planning.
2. create worktree and branch
3. implement only the scoped issue
4. run targeted verification during development
5. rebase onto `main`
6. run final verification
7. open PR with **`Closes #NNN` in the PR description** — this is mandatory, not optional. Never manually close issues with `gh issue close`; let GitHub autoclose them on merge.
8. merge quickly once checks and review level are satisfied
9. remove `active:*` label after merge or handoff

## Review Depth

After completing implementation, always open a PR. Choose the review level proportional to the risk of the change. Default to merging quickly when checks pass — don't add overhead to routine work.

| Level | When to use | What it does |
|-------|------------|--------------|
| **Just merge** | Renames, lint fixes, cosmetic UI, docs, config changes. Anything where the diff is obvious and checks pass. | No review tooling — merge after verification. |
| **`/review`** | Non-trivial bug fixes, logic changes, state management, anything where a second pair of eyes adds value. | Single-pass code review checking for bugs and CLAUDE.md compliance. |
| **`gluon-reviewer`** | Changes to core engine (`src/engine/`), AI contract (`src/ai/`), protocol types, or audio pipeline (`src/audio/`). | Checks Gluon-specific invariants and design principle adherence. |
| **`/pr-review-toolkit:review-pr`** | Large refactors, new subsystems, changes to critical paths (persistence, audio rendering, undo). High blast radius. | Heavy multi-agent review (code, types, error handling, test coverage). |

These can be combined — e.g. `/review` + `gluon-reviewer` for engine changes. Use judgement.

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
