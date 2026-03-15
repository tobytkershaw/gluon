# Gluon Transport and Scheduler Reset
## Implementation Plan Mapped to Current Files

---

## Purpose

This document translates the design brief in [transport-scheduler-reset.md](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/docs/briefs/transport-scheduler-reset.md) into a concrete implementation plan against the current codebase.

It is deliberately file-oriented. The aim is to show where the current transport behavior lives today, what should move, and in what order the refactor should happen.

---

## Current File Map

These are the current modules that own transport or scheduling behavior.

### Transport state and mutations

- [src/engine/sequencer-types.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/sequencer-types.ts)
  - defines `Transport` as `{ playing, bpm, swing }`
- [src/engine/types.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/types.ts)
  - embeds transport into `Session`
  - defines transport snapshots and action diffs
- [src/engine/session.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/session.ts)
  - creates default transport state
  - mutates BPM, swing, and play or stop using `togglePlaying`
- [src/engine/operation-executor.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/operation-executor.ts)
  - lets AI issue `set_transport`

### Runtime transport control

- [src/ui/App.tsx](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/ui/App.tsx)
  - instantiates `Scheduler`
  - starts or stops scheduler from a React effect keyed to `session.transport.playing`
  - chooses between `releaseAll()` and `silenceAll()` via `hardStopRef`
  - logs QA transport traces
- [src/ui/useShortcuts.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/ui/useShortcuts.ts)
  - maps keyboard actions to play or hard stop
- [src/ui/TransportStrip.tsx](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/ui/TransportStrip.tsx)
  - UI labels and controls for play, hard stop, BPM, and swing

### Scheduling and playback execution

- [src/engine/scheduler.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/scheduler.ts)
  - owns mutable `cursor`, `startTime`, and `previousBpm`
  - scans lookahead windows and schedules notes directly
  - reanchors on BPM change
  - has no explicit event identity or generation invalidation
- [src/audio/audio-engine.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/audio/audio-engine.ts)
  - executes scheduled notes
  - owns `releaseAll()`, `silenceAll()`, `restoreBaseline()`, `releaseTrack()`
  - has a `clearFence` mechanism, which is currently the nearest thing to generation invalidation
- [src/audio/plaits-synth.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/audio/plaits-synth.ts)
  - applies note scheduling in the synth path
- [src/audio/tides-synth.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/audio/tides-synth.ts)
  - exposes pause or resume behavior for modulators

### Sequencer source data and editing

- [src/engine/canonical-types.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/canonical-types.ts)
  - canonical note, trigger, and parameter event types
- [src/engine/sequencer-helpers.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/sequencer-helpers.ts)
  - audible track filtering and parameter resolution
- [src/engine/pattern-primitives.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/pattern-primitives.ts)
  - note and pattern edits while transport may be active
- [src/engine/event-primitives.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/event-primitives.ts)
  - canonical event editing
- [src/ui/useKeyboardPiano.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/ui/useKeyboardPiano.ts)
  - records and finalizes notes during active transport

### Persistence and offline rendering

- [src/engine/persistence.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/persistence.ts)
  - persists transport as stopped on reload
- [src/audio/render-offline.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/audio/render-offline.ts)
  - offline render path with separate timing model
- [src/audio/render-worker.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/audio/render-worker.ts)
  - current offline scheduling assumptions

### QA and verification

- [src/qa/audio-trace.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/qa/audio-trace.ts)
  - trace points for scheduler and transport
- [scripts/qa-playwright-smoke.sh](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/scripts/qa-playwright-smoke.sh)
  - smoke checks for transport behavior

---

## Refactor Strategy

The safest approach is to keep the existing session and UI surface mostly intact while introducing a new runtime transport layer underneath it.

That means:

- keep `Session.transport` as the persisted user-facing transport state initially
- introduce an internal runtime transport model beside it
- move scheduling ownership out of `App.tsx`
- evolve the audio engine contract to address event or generation lifecycle directly
- only then simplify the legacy wiring

This reduces risk because it avoids rewriting UI, persistence, and AI transport mutations at the same time.

---

## Proposed Runtime Ownership

The reset should align with the four runtime domains from the design brief.

### `TransportState`

Home:

- new [src/engine/transport-runtime.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/transport-runtime.ts)

### `ArrangementState`

Home:

- existing session and event-editing modules, primarily:
  - [src/engine/types.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/types.ts)
  - [src/engine/pattern-primitives.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/pattern-primitives.ts)
  - [src/engine/event-primitives.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/event-primitives.ts)

### `PlaybackPlan`

Home:

- new [src/engine/playback-plan.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/playback-plan.ts)

### `ActiveVoices`

Home:

- primarily [src/audio/audio-engine.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/audio/audio-engine.ts)

Reasoning:

`ActiveVoices` should live closest to the code that can actually confirm whether a runtime event is sounding, releasing, or silenced. `playback-plan.ts` should own future planned events; `audio-engine.ts` should own active voice lifecycle keyed by runtime event identity.

---

## Proposed New Modules

The reset can be implemented cleanly by adding a small set of focused modules rather than overloading `scheduler.ts`.

### 1. `src/engine/transport-runtime.ts`

Purpose:

- define the runtime transport state machine
- own transitions for `play`, `pause`, `resume`, `stop`, `hardStop`, and `seek`
- own generation increment rules

Expected exports:

- `RuntimeTransportState`
- `TransportStatus`
- `createRuntimeTransport()`
- transition helpers such as `playTransport`, `pauseTransport`, `stopTransport`

### 2. `src/engine/playback-plan.ts`

Purpose:

- define the near-future scheduled plan
- define runtime event identity and occurrence identity
- support idempotent admit, replace, and invalidate behavior

Expected exports:

- `RuntimeEventId`
- `PlannedEvent`
- `PlaybackPlan`
- helpers to admit events and invalidate by generation or range

### 3. `src/engine/transport-controller.ts`

Purpose:

- replace the current `App.tsx` transport effect as the runtime coordinator
- bridge session transport intent, runtime transport state, scheduler planning, and audio engine execution

Expected responsibilities:

- start or stop the scheduler loop
- respond to BPM or swing changes
- apply pause, stop, and hard-stop semantics consistently
- isolate transport orchestration from React component code

Integration approach:

- implement this as a plain class with injected dependencies
- wrap it in a thin React hook only for wiring

Recommended split:

- class: `TransportController`
  - testable without React
  - owns runtime orchestration and generation transitions
- hook: `useTransportController(...)`
  - instantiated from `App.tsx`
  - binds `session`, `setSession`, `audioRef`, `setGlobalStep`, QA tracing, and any scheduler callbacks

This keeps the controller testable while avoiding awkward React integration.

### 4. Optional `src/engine/live-edit-policy.ts`

Purpose:

- centralize the rules for applying edits during playback
- classify edits by impact on future and active events

This should not be created unless the policy grows beyond a small helper. The default starting point is:

- implement the first version as a local helper in `transport-controller.ts` or `scheduler.ts`
- extract it only if edit classification becomes meaningfully complex

---

## File-by-File Change Plan

### Phase 1. Add runtime transport state and explicit transport actions

Primary files:

- [src/engine/sequencer-types.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/sequencer-types.ts)
- [src/engine/types.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/types.ts)
- [src/engine/session.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/session.ts)
- [src/engine/operation-executor.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/operation-executor.ts)
- [src/ui/useShortcuts.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/ui/useShortcuts.ts)
- new [src/engine/transport-runtime.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/transport-runtime.ts)

Changes:

- keep persisted `Transport` backward-compatible at first, but add room for explicit semantics
- prefer replacing `playing: boolean` with `status: 'stopped' | 'playing' | 'paused'` in runtime code first
- add runtime-only fields:
  - `playheadBeats`
  - `anchorAudioTime`
  - `generation`
- replace `togglePlaying()` with explicit session-level actions:
  - `playTransport()`
  - `pauseTransport()`
  - `stopTransport()`
  - `hardStopTransport()` or equivalent UI intent flag
- update AI `set_transport` handling so `playing` no longer hides whether the result should be pause or stop
- update keyboard and button handlers to call explicit actions
- keep persistence conservative until the runtime contract is stable

Implementation note:

Do not force the full session shape to change in one pass. Start by introducing runtime transport state in a new module and adapt `Session.transport.playing` into that layer.

Definition of done:

- runtime transport state exists independently of `App.tsx`
- generation and playhead are represented explicitly in code
- there is a single transition API for transport actions
- no call sites depend on `togglePlaying()`
- transport actions are explicit in both human and AI paths
- QA traces can distinguish pause from stop and hard stop

### Phase 2. Move runtime orchestration out of `App.tsx`

Primary files:

- [src/ui/App.tsx](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/ui/App.tsx)
- new [src/engine/transport-controller.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/transport-controller.ts)

Changes:

- move scheduler start or stop logic out of the React effect
- move hard-stop cleanup choice out of `hardStopRef`
- let `App.tsx` issue transport intents only
- add a thin `useTransportController(...)` hook for App wiring
- let `transport-controller.ts` own:
  - transport transitions
  - scheduler lifecycle
  - audio engine cleanup calls
  - QA transport trace emission

Definition of done:

- `App.tsx` no longer directly implements pause or stop semantics
- transport behavior can be tested without mounting the whole app

### Phase 3. Split planning from scheduling in `scheduler.ts`

Primary files:

- [src/engine/scheduler.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/scheduler.ts)
- new [src/engine/playback-plan.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/playback-plan.ts)
- [src/engine/sequencer-helpers.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/sequencer-helpers.ts)
- [src/engine/canonical-types.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/canonical-types.ts)

Changes:

- keep the short-lookahead loop, but make it produce planned events rather than treating the mutable cursor as the whole runtime truth
- define runtime event identity from:
  - generation
  - track identity
  - region identity
  - source event identity
  - occurrence or loop cycle
- add a plan admission check so the same event in the same generation is admitted only once
- isolate event resolution from event execution
- revisit `ScheduledNote.baseParams` once event identity is stable
- remove or simplify the current set-patch conditional only after the scheduler is idempotent, so arbitration behavior is corrected without reintroducing duplicate patch churn

Likely shape:

- `scheduler.ts` becomes the planner loop
- `playback-plan.ts` stores admitted events and invalidation logic
- `scheduler.ts` emits only newly admitted events to the audio engine

Definition of done:

- rescanning the same planning window does not emit duplicate notes
- stale planned events can be invalidated by generation
- loop wrap produces distinct occurrence IDs per cycle

### Phase 4. Replace `clearFence` with explicit generation propagation

Primary files:

- [src/audio/audio-engine.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/audio/audio-engine.ts)
- [src/audio/plaits-synth.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/audio/plaits-synth.ts)
- related processor and modulator engines under [src/audio/](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/audio)

Changes:

- make transport generation the same value that is propagated to worklets as the stale-event guard
- rename `clearFence` to `generation` when practical
- rename worklet-side `minFence` to `minGeneration` when practical
- add event or generation-oriented methods:
  - `startEvent(event)`
  - `releaseGeneration(generation, reason)`
  - `silenceGeneration(generation, reason)`
  - optional `releaseEvent(eventId, reason)`
- track active voices by runtime identity, not just by track
- align processor and modulator cleanup to the same generation semantics

Why this matters:

The current fence mechanism already acts like a generation system. The reset should formalize that instead of layering a second invalidation mechanism beside it.

Definition of done:

- pause, stop, and hard stop operate on explicit runtime lifecycle state
- duplicate or stale work from a prior generation cannot continue sounding

### Phase 5. Define live-edit admission policy

Primary files:

- [src/engine/pattern-primitives.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/pattern-primitives.ts)
- [src/engine/event-primitives.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/event-primitives.ts)
- [src/ui/useKeyboardPiano.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/ui/useKeyboardPiano.ts)
- [src/engine/transport-controller.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/transport-controller.ts)
- optionally new [src/engine/live-edit-policy.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/live-edit-policy.ts)

Changes:

- classify edits that affect future playback:
  - add note
  - remove note
  - move note
  - edit gate or duration
  - edit parameter lock
- define which edits:
  - invalidate future planned events
  - leave active voices alone
  - require quantized application
- ensure cross-track edits during playback are admitted exactly once on the next eligible rebuild
- keep the first implementation local to `transport-controller.ts` or `scheduler.ts`
- extract to a dedicated module only if the policy outgrows a few focused helpers

Definition of done:

- notes added during playback on another track sound without transport restart
- restarting transport after such edits does not duplicate prior queued work

### Phase 6. Finish timing semantics, then update persistence and offline

Primary files:

- [src/engine/scheduler.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/scheduler.ts)
- [src/engine/playback-plan.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/playback-plan.ts)
- [src/audio/audio-engine.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/audio/audio-engine.ts)
- [src/engine/persistence.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/persistence.ts)
- [src/audio/render-offline.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/audio/render-offline.ts)
- [src/audio/render-worker.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/audio/render-worker.ts)

Changes:

- stop deriving note lifetime from mutable tempo context after admission
- choose one policy and implement it consistently:
  - note-offs remain as originally scheduled for admitted events
  - or affected note-offs are explicitly rescheduled on tempo change
- make the choice visible in tests and QA traces
- keep persistence writing transport as stopped unless and until paused playhead restore is a product requirement
- review whether offline rendering should share any event identity or planning helpers with realtime scheduling
- avoid coupling the realtime transport reset to the offline renderer until the runtime path is stable

Definition of done:

- mid-play BPM changes do not leave note-on and note-off timing in contradictory states
- persistence remains predictable
- offline rendering is not accidentally broken by realtime transport refactors

---

## Recommended Order of Execution

The implementation should be sequenced to reduce churn and preserve debuggability.

1. Add `transport-runtime.ts` and explicit transport actions.
2. Add `transport-controller.ts` and remove runtime semantics from `App.tsx`.
3. Add `playback-plan.ts` and refactor `scheduler.ts` around event identity and duration ownership.
4. Upgrade `audio-engine.ts` to generation-based cleanup and active-voice tracking.
5. Add live-edit policy and patch note-edit call sites.
6. Expand QA and unit tests, then update persistence and offline compatibility paths as needed.

This order matters because scheduler idempotence depends on transport generation, and live-edit correctness depends on both.

---

## Test Work Required

The transport reset should ship with new tests in parallel with code changes, not after.

### Unit-level targets

- [src/engine/scheduler.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/scheduler.ts)
- new `transport-runtime` tests
- new `playback-plan` tests
- live-edit policy tests

Add tests for:

- generation invalidation
- idempotent event admission
- loop occurrence identity
- active voice lifecycle by runtime event ID
- pause or resume transitions
- stop versus hard-stop semantics
- edit admission while transport is active

### Integration targets

- [src/ui/App.tsx](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/ui/App.tsx)
- [src/audio/audio-engine.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/audio/audio-engine.ts)
- [src/ui/useKeyboardPiano.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/ui/useKeyboardPiano.ts)

Add integration coverage for:

- pausing with active notes
- resuming after pause without stale queued notes
- adding notes on another track during playback
- no duplicate notes after stop and restart
- BPM changes while notes are active

### QA smoke targets

- [scripts/qa-playwright-smoke.sh](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/scripts/qa-playwright-smoke.sh)
- [src/qa/audio-trace.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/qa/audio-trace.ts)

Add or update smoke checks for:

- pause emits no new `audio.note` traces after completion
- cross-track note insertion during playback produces exactly one newly admitted note
- transport restart after live edits does not replay invalid generation work

---

## Risks and Constraints

### Session-shape churn

Changing `Session.transport` too early will increase merge risk and create broad UI fallout. The runtime layer should absorb that complexity first.

### Audio-engine coupling

`audio-engine.ts` currently blends transport cleanup, gain management, processor cleanup, and modulator pause behavior. Untangling this will require careful incremental changes.

### Undo and AI transport actions

`operation-executor.ts` and snapshot handling currently assume transport changes are simple field mutations. More explicit transport semantics may require richer transport snapshots and action diffs.

### Offline and realtime divergence

The offline renderer should not silently become a second transport implementation with different semantics. Shared helpers should be introduced only when the realtime contract is stable.

---

## First Concrete Slice

If this reset is started immediately, the first implementation slice should be:

1. add `src/engine/transport-runtime.ts`
2. replace `togglePlaying()` with explicit play, pause, and stop actions
3. introduce `TransportController` plus a thin `useTransportController(...)` wrapper
4. move the `App.tsx` scheduler effect into that controller
5. emit richer QA traces for transport transitions and generation changes

That slice is small enough to land without rewriting the scheduler yet, but large enough to remove the current ambiguity around pause, stop, and hard stop.

---

## Recommendation

Use this plan as the execution layer for the architecture brief.

The immediate objective is not to fix every audible bug directly. The immediate objective is to establish explicit transport ownership, runtime identity, and generation invalidation in the current files that already own transport behavior. Once those foundations are in place, the existing bug list should collapse into a much smaller and more testable set of implementation defects.
