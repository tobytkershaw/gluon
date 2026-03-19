# Orphaned Docs Audit

**Date:** 2026-03-19  
**Scope:** Historical docs added on branches or in past commits that were missing from the current `main` checkout.

## Audit

Compared `git log --all --diff-filter=A -- 'docs/**/*.md' 'src/**/*.md'` against the current worktree and checked the live references for the missing candidates.

Restored docs in this PR:

- `docs/principles/product-identity.md`
- `docs/audits/2026-03-track-importance.md`

Checks that supported restoration:

- `docs/briefs/chat-ux.md` and `docs/briefs/turn-contract.md` had already been restored on `main` in `#1030`, so they were removed from this branch during rebase.
- `README.md` still referenced `docs/principles/product-identity.md`.
- The current codebase still uses `importance`, so the track-importance audit remained meaningful as an audit artifact.

No intentionally removed docs were identified in this pass.

## Verification

- Docs-only audit.
- No tests were needed.
