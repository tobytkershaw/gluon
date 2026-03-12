---
name: fix-issue
description: Pick up a GitHub issue, implement it, verify, and commit
argument-hint: "[issue-number]"
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, Agent
---

## Fix GitHub Issue $ARGUMENTS

1. Read the issue: `gh issue view $ARGUMENTS`
2. Understand the scope and acceptance criteria
3. Create a feature branch from dev: `git checkout -b fix/$ARGUMENTS dev`
4. Implement the fix, following existing patterns in the codebase
5. Write or update tests covering the change
6. Verify: `npx tsc --noEmit && npx vitest run`
7. Commit with a message referencing the issue (e.g., "fix: description (#$ARGUMENTS)")
8. Report what was done and what to test manually
