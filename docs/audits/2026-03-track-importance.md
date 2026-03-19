# Track Importance Audit

**Issue:** [#886](https://github.com/tobytkershaw/gluon/issues/886)  
**Date:** 2026-03-19  
**Scope:** How `Track.importance` is actually used across the codebase and nearby docs/artifacts.

## Findings

`importance` is a real persisted field on `Track`, but it is not consumed as a runtime mechanic anywhere in the engine, audio path, or arbitration logic.

What it does do:

- Stored on the session model in `src/engine/types.ts` and updated via `setTrackImportance()` in `src/engine/session.ts`.
- Accepted through the engine and AI action paths as `set_importance` / `set_track_meta`.
- Serialized into compressed AI state in `src/ai/state-compression.ts`.
- Described in the AI contract and system prompt as advisory mix priority / importance metadata.
- Exposed in the current human UI as a metadata editor, but the control itself does not drive any mechanical behavior.

What it does not do:

- It is not read by synthesis, mix routing, transport, scheduling, undo selection, or preservation logic as a control input.
- No code path found in the repo uses `importance` to alter audio output, routing priority, or edit permission.

## Decision

Keep `importance` as **AI-facing advisory metadata**, not as a new mechanical subsystem.

Rationale:

- The field already has clear value for AI reasoning, state compression, and collaboration context.
- Adding mechanics now would need a separate design because no existing runtime path consumes the field.
- Removing the field entirely would throw away useful collaboration context without solving any current user-facing problem.

## Practical Consequence

The visible UI affordance should not remain as a dead control. If the UI still exposes importance editing, that should be treated as a temporary compatibility artifact and removed or hidden in the companion cleanup.

## Notes

- The current repo state still contains several references to importance in UI and docs; those references are consistent with the advisory model, not with a mechanical priority system.
- If the product later wants importance to affect preservation strength, auto-gain, or spectral priority, that should be a separate RFC with explicit mechanics and tests.
