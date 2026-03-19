# Issue 571 Lifecycle Audit

Audit of performance and resource lifecycle under long-session use.

## Scope

Inspected:
- [`src/audio/audio-engine.ts`](/Users/tobykershaw/Development/gluon/.codex-worktrees/issue-571/src/audio/audio-engine.ts)
- [`src/audio/render-offline.ts`](/Users/tobykershaw/Development/gluon/.codex-worktrees/issue-571/src/audio/render-offline.ts)
- [`src/audio/snapshot-store.ts`](/Users/tobykershaw/Development/gluon/.codex-worktrees/issue-571/src/audio/snapshot-store.ts)
- [`src/ui/App.tsx`](/Users/tobykershaw/Development/gluon/.codex-worktrees/issue-571/src/ui/App.tsx)
- [`src/ui/useProjectLifecycle.ts`](/Users/tobykershaw/Development/gluon/.codex-worktrees/issue-571/src/ui/useProjectLifecycle.ts)
- [`src/audio/render-worker.ts`](/Users/tobykershaw/Development/gluon/.codex-worktrees/issue-571/src/audio/render-worker.ts)

Compared against:
- `docs/briefs/offline-listen.md`
- `docs/briefs/phase4a.md`
- `docs/gluon-architecture.md`

Tests run:
- `npx vitest run tests/audio/snapshot-store.test.ts`

## Findings

1. `P1` Audio snapshots were being retained indefinitely across AI turns because `storeSnapshot()` writes into a process-wide `Map` and the production path never cleared it. The store itself documents that snapshots are only meant to live for one tool loop, but before this audit there was no matching turn-end cleanup in the app path. I added the missing clear in [`src/ui/App.tsx`](/Users/tobykershaw/Development/gluon/.codex-worktrees/issue-571/src/ui/App.tsx) immediately after `finalizeAITurn()`.

2. `P2` Track, processor, modulator, and routing churn is mostly bounded correctly. [`AudioEngine.removeTrack()`](/Users/tobykershaw/Development/gluon/.codex-worktrees/issue-571/src/audio/audio-engine.ts) destroys processors, modulators, send nodes, and voice pools; [`AudioEngine.stop()`](/Users/tobykershaw/Development/gluon/.codex-worktrees/issue-571/src/audio/audio-engine.ts) clears the entire graph and closes the `AudioContext`; and the async add paths guard against stale inserts after a track has already been removed. I did not find a second accumulation path in this area.

3. `P2` Offline renders are low-risk from a lifecycle perspective. [`renderOffline()`](/Users/tobykershaw/Development/gluon/.codex-worktrees/issue-571/src/audio/render-offline.ts) creates a fresh worker per render and always terminates it in `finally`, so repeated listens do not appear to accumulate worker state. The worker itself caches WASM modules only within its own lifetime.

4. `P3` Project switching relies on session-to-engine reconciliation rather than a full audio-runtime restart. [`useProjectLifecycle()`](/Users/tobykershaw/Development/gluon/.codex-worktrees/issue-571/src/ui/useProjectLifecycle.ts) reloads session state and the app effect in [`src/ui/App.tsx`](/Users/tobykershaw/Development/gluon/.codex-worktrees/issue-571/src/ui/App.tsx) removes engine slots that no longer exist. That is functionally sound, but the `AudioContext` itself remains app-lifetime unless the whole app unmounts.

## Outcome

The only concrete long-session accumulation bug I found was snapshot retention, and that was fixed as part of this audit. The remaining lifecycle paths are intentionally long-lived and currently look bounded by explicit destroy/disconnect logic rather than by hidden accumulation.
