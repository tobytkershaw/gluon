# Gluon Transport and Scheduler Reset
## Design Brief

---

## Purpose

This brief defines the transport and scheduling architecture Gluon should adopt before further sequencer feature work. It is a corrective design document, not a bugfix checklist.

The goal is to stop treating transport and playback reliability as an accumulation of local regressions. The current failures point to a deeper mismatch between Gluon's sequencing model and the runtime contract required by a robust musical transport.

This brief imports established sequencing patterns from mature systems and adapts them to Gluon's constraints:

- browser-based Web Audio runtime
- AI-editable musical structure
- human-first editing and arbitration
- unified undo
- multiple editing surfaces over shared musical data

---

## Executive Summary

Gluon should keep its own transport and scheduler, but it should stop relying on the current loosely coupled model of:

- React transport state
- a mutable scheduler cursor
- ad hoc scheduling windows
- audio-engine release and silence behavior applied at the UI boundary

That model is sufficient for a prototype, but it is too weak for reliable playback under live edits, pause/stop transitions, tempo changes, and repeated transport cycles.

The replacement model should be built around six principles:

1. One source of truth for musical time.
2. Explicit transport semantics for play, pause, stop, and hard stop.
3. Idempotent near-future scheduling into the audio clock.
4. Stable event identity plus transport generation invalidation.
5. A hard separation between editable musical state and runtime playback state.
6. An explicit policy for edits while playback is active.

The immediate recommendation is not to keep patching transport bugs in place. The immediate recommendation is to refactor the transport and scheduler to enforce these principles first, then resume bugfixing and feature work on top of that foundation.

---

## Why This Reset Is Necessary

Recent failures are not random. They are all variations of the same architectural weakness:

- pause does not fully stop audible playback
- notes added during playback do not consistently sound
- transport restart can produce duplicate notes
- tempo changes can leave already-scheduled note lifetimes inconsistent
- runtime state becomes hard to reason about after a few transport transitions

These failures indicate that Gluon does not yet have a fully coherent answer to three questions:

1. What musical time is the source of truth?
2. Which future events are valid right now?
3. What should happen to active and queued notes when transport state changes?

Until those questions are answered by architecture rather than by local fixes, the same class of bug will keep resurfacing.

---

## Current Model Analysis

As of March 15, 2026, the current transport path is split across the UI layer, the scheduler, and the audio engine.

### Current transport control shape

In [App.tsx](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/ui/App.tsx), transport control is driven by a React effect keyed to `session.transport.playing`. On transition to playing:

- baseline audio state is restored
- the scheduler is started

On transition to stopped:

- the scheduler is stopped
- either `releaseAll()` or `silenceAll()` is invoked depending on a separate hard-stop flag

This means transport semantics are partly encoded in React effect wiring, partly in scheduler state, and partly in audio-engine cleanup calls.

### Current scheduler shape

In [scheduler.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/scheduler.ts), the scheduler:

- maintains mutable `cursor`, `startTime`, and `previousBpm`
- derives step position by comparing audio time against a mutable start anchor
- scans a short lookahead window on a periodic timer
- schedules note-on plus gate-off times directly from the current timing context

This has some good qualities already:

- it uses short lookahead rather than long-range precomputation
- it schedules against the audio clock rather than using UI timing alone
- it limits catch-up bursts to avoid pathological backfill

But it still has critical weaknesses:

- event identity is implicit rather than stable
- queued events are not invalidated through an explicit generation model
- transport state and playback state are not separated cleanly
- live edits are applied through whatever the next scan happens to observe
- note lifetime logic is derived from mutable tempo context

The explicit comment in [scheduler.ts](/Users/tobykershaw/Development/gluon/.codex-worktrees/transport-design/src/engine/scheduler.ts) about gate-off timing remaining wrong after a mid-play BPM change is a symptom of this design: event lifetime is still coupled to mutable transport timing instead of being owned as a scheduled runtime fact.

### Architectural diagnosis

The current system mixes three concerns that should be separate:

- transport timeline state
- arrangement or pattern state
- runtime scheduled and active event state

When those concerns are mixed, the system cannot answer simple questions deterministically:

- has this event already been scheduled?
- is this queued note still valid after pause or stop?
- should a note added mid-play be rendered immediately, at the next step boundary, or on restart?
- does a transport restart continue the same scheduling generation or begin a new one?

That ambiguity is the root cause.

---

## Imported Principles From Mature Sequencer Systems

Gluon does not need to copy another sequencer wholesale. It should borrow the parts that are already solved.

### 1. Schedule against the audio timeline, not the UI timer

Web Audio scheduling guidance is consistent: JavaScript timers are only good enough to wake a scheduler, not to define musical execution time. A robust browser sequencer wakes periodically, computes a short planning window, and schedules events against the audio clock with explicit timestamps.

Gluon already follows part of this pattern. The reset is about finishing the job and making the scheduler deterministic under invalidation and edits.

### 2. Keep the planning horizon short

Scheduling too far ahead makes playback unresponsive to edits, transport changes, and tempo changes. Scheduling too little risks underruns. Mature systems converge on a short rolling lookahead.

Gluon should continue to use a short lookahead window, but that window should produce an explicit playback plan rather than mutating runtime state opportunistically.

### 3. Treat transport timeline as a first-class object

Mature transport systems model beat time, tempo, and start or stop state explicitly. They do not infer transport authority from incidental mutable cursor fields.

Gluon should treat beat position, tempo map, playhead anchor, and transport generation as first-class transport state.

### 4. Give scheduled events stable identity

Robust schedulers can clear, replace, or ignore stale events because they can identify them. Event identity is what makes scheduling idempotent.

Gluon should assign each scheduled musical event a stable runtime identifier derived from:

- track or voice identity
- region identity
- event identity
- loop iteration or transport-relative occurrence
- transport generation

### 5. Invalidate by generation, not by hope

When transport restarts, seeks, or rebuilds, old scheduled work must become invalid by definition. Mature systems do this with cancellation handles, generation counters, or equivalent timeline invalidation.

Gluon should introduce a transport generation or epoch. Any queued or active runtime object from an older generation is stale and must not be allowed to continue scheduling work into the current run.

### 6. Separate editable state from runtime state

Sequencer data is one thing. Playback state is another.

The arrangement or pattern model should remain editable and undoable. The scheduler should consume snapshots plus explicit deltas or invalidation rules. It should not treat the mutable project state itself as the runtime queue.

### 7. Define live-edit policy explicitly

Mature musical tools do not leave edit-during-play behavior ambiguous. They define whether edits apply:

- immediately
- on the next scheduler rebuild
- on the next quantized boundary
- or only after transport restart

Gluon needs the same clarity.

---

## Proposed Runtime Model

The transport reset should introduce four explicit runtime domains.

### 1. `TransportState`

`TransportState` is the source of truth for musical time and transport intent.

It should include:

- `status`: `stopped | playing | paused`
- `playheadBeats`: current musical position in beats
- `anchorAudioTime`: audio-clock time corresponding to the current playhead anchor
- `tempo`: current BPM
- `swing`: current swing setting
- `generation`: monotonically increasing transport epoch
- `startPolicy`: whether the most recent transition was play, resume, stop, or hard stop

Only one runtime subsystem should own advancement of musical time from this state.

### 2. `ArrangementState`

`ArrangementState` is the editable musical source of truth:

- tracks or voices
- regions
- musical events
- step projections
- automation or parameter locks

This state remains the domain of UI editing, AI editing, undo, and persistence.

It does not directly own runtime scheduling handles.

### 3. `PlaybackPlan`

`PlaybackPlan` is the scheduler's explicit near-future plan for a single generation.

It should contain:

- scheduled event IDs
- event onset beat and onset audio time
- note duration or gate end time
- resolved parameter snapshot for the event
- generation

The scheduler rebuilds or extends this plan for the next lookahead window. Recomputing the same window must not produce duplicates because event identity is stable.

### 4. `ActiveVoices`

`ActiveVoices` tracks what is currently sounding in the engine.

It should map runtime event identity to:

- track or voice
- note start time
- intended release time
- current generation
- release or silence status

This structure is what allows pause, stop, and hard stop to be correct instead of approximate.

---

## Transport Semantics

Transport semantics need to be contractually precise.

### `play`

`play` starts timeline advancement from the current playhead.

Requirements:

- transport enters `playing`
- current `playheadBeats` is preserved
- a fresh generation is created if prior scheduled work cannot be safely reused
- scheduler begins filling the lookahead window for the new generation
- only events from the current generation may sound

### `pause`

`pause` stops timeline advancement without resetting the playhead.

Requirements:

- transport enters `paused`
- no future events remain valid for scheduling in the current run
- active voices are released according to instrument policy
- no additional note-on events may occur after pause completes
- resuming from pause continues from the paused playhead, not from stale queued timing

This is the place where Gluon's current behavior is weakest. Pause must invalidate future scheduling first and then resolve currently active notes.

### `stop`

`stop` ends playback and resets the playhead to the transport origin.

Requirements:

- transport enters `stopped`
- playhead resets to origin
- future scheduling for the old generation is invalidated
- active voices are released
- no stale events may be heard after stop completes

### `hard stop`

`hard stop` is a stronger variant of stop.

Requirements:

- includes all `stop` behavior
- active voices are silenced immediately rather than released naturally
- tails and long releases are cut by definition

The distinction between `stop` and `hard stop` should be part of the transport contract itself, not an implementation accident in the UI layer.

---

## Scheduling Model

### Short-lookahead planner

The scheduler should remain a short-lookahead planner running from a periodic wake-up, but the planner should be idempotent.

At each scheduler tick:

1. Read current `TransportState`.
2. Derive the planning window in beats and audio time for the current generation.
3. Query `ArrangementState` for events intersecting that window.
4. Resolve event instances for the current loop iteration or region projection.
5. Materialize runtime event identities.
6. Add missing events to `PlaybackPlan`.
7. Ignore or replace events already planned for the same identity.
8. Hand off only newly admitted events to the audio engine.

This makes the scheduler robust to repeated scans and transport churn.

### Event identity

Every scheduled note event needs a stable runtime identity.

At minimum, identity should encode:

- transport generation
- event source identity
- occurrence identity within looping playback

For example, a note repeated on the next loop should be a different occurrence of the same source event, not the same runtime event.

### Generation invalidation

Generation invalidation is the primary defense against duplicates and stale playback.

The following should increment generation:

- play from stopped
- stop
- hard stop
- seek
- any rebuild that makes previously queued event times invalid

Pause may either increment generation immediately or invalidate queued work within the same generation, but the behavior must be explicit and testable. The safer default is to increment generation on resume, so stale pre-pause work cannot leak into the resumed run.

### Duration ownership

Once a note-on is admitted into `PlaybackPlan`, its note lifetime should be treated as a scheduled runtime fact for that generation.

If tempo or transport rules change after scheduling:

- either existing note durations remain as originally scheduled
- or the system explicitly reschedules affected note-offs

What must not happen is a half-state where note-ons reflect one transport context and note-offs reflect another without invalidation.

---

## Live Edit Contract

Edits during playback should not be opportunistic. They need policy.

### Recommended default policy

Gluon should adopt this default:

- note additions or removals: apply on the next scheduler rebuild for any event not yet admitted into `PlaybackPlan`
- parameter edits for unsounded events: apply on the next scheduler rebuild
- parameter edits for active voices: instrument-specific, usually apply only if the parameter is truly live-modulatable
- structural edits that move timing materially: invalidate affected future event identities and rebuild the plan for the current generation or a fresh one

This policy gives Gluon responsive editing without pretending that every mutation can safely rewrite already-started audio.

### Quantized application

Some edit classes may need quantized application in the future:

- next step boundary
- next beat
- next bar

That should be an explicit product-level choice, not an accidental side effect of scheduler timing.

### Cross-track edits during playback

The bug class where notes added to another track while transport is already running do not sound until restart, then later duplicate, is a direct sign that the current runtime has no clean admission policy for new events.

The corrected behavior should be:

- a newly added future event on another track is admitted once on the next eligible scheduler rebuild
- if the event's onset has already passed, it is either skipped or quantized forward by policy
- restarting transport must not replay stale queued copies from the prior generation

---

## Audio Engine Contract

The audio engine should not need to infer transport meaning from scattered calls.

It should expose a small contract aligned to transport semantics:

- `startEvent(event)`
- `releaseEvent(eventId, reason)`
- `silenceEvent(eventId, reason)`
- `releaseGeneration(generation, reason)`
- `silenceGeneration(generation, reason)`

This makes transport operations addressable by runtime identity rather than by global side effects alone.

`releaseAll()` and `silenceAll()` may still exist as escape hatches, but they should not be the primary correctness mechanism for normal transport flow.

---

## Invariants

The reset should be considered successful only if these invariants are enforced.

### Transport invariants

- there is exactly one authoritative transport timeline
- playhead position is defined in musical units, not inferred indirectly from cursor drift
- transport transitions have explicit semantics and tests

### Scheduler invariants

- scheduling the same planning window twice does not duplicate events
- no queued event from an old generation may sound in the current one
- scheduler output is a deterministic function of transport state, arrangement state, and generation

### Playback invariants

- after pause completes, no new note-on events occur
- after stop completes, no stale queued note-on events occur
- after hard stop completes, no active voices remain audible

### Live-edit invariants

- adding a future note during playback admits it at most once
- deleting a future note during playback prevents it from sounding if it has not already started
- edits to one track do not require a full transport restart to become audible unless policy explicitly says so

---

## Migration Plan

This should be implemented as a focused transport refactor, not as scattered bugfixes.

### Phase 1. Write the contract into code

- introduce explicit transport states and transition functions
- move transport semantics out of implicit UI effect behavior
- define pause, stop, and hard-stop behavior in one owned module

### Phase 2. Introduce runtime identity and generation

- define event identity for scheduled note instances
- add transport generation invalidation
- ensure stale generations cannot schedule or emit notes

### Phase 3. Separate planning from audio execution

- introduce `PlaybackPlan`
- make scheduler produce or extend a plan instead of directly behaving as the runtime queue
- make audio engine consume admitted plan entries by identity

### Phase 4. Define live-edit admission rules

- codify what edits apply immediately, on next rebuild, or on future quantized boundaries
- invalidate only affected future events when possible
- avoid whole-transport resets for normal editing

### Phase 5. Tighten the audio contract

- address release and silence by event identity or generation
- make pause and stop behavior observable and testable
- reduce reliance on global cleanup methods for correctness

### Phase 6. Only then resume feature work

After the reset:

- revisit expressive timing
- revisit tracker and alternative views
- revisit richer region models
- revisit transport-linked AI operations

Trying to add these first will increase the repair cost.

---

## Test Plan

The transport reset needs a dedicated regression suite. These tests are more important than adding new sequencing features.

### Transport transitions

- play, pause, resume, stop, and hard stop across empty and active sessions
- repeated rapid transitions without duplicate notes
- background suspend or resume behavior where supported

### Scheduling correctness

- same scheduling window scanned repeatedly does not duplicate note-ons
- stale generation events are ignored
- lookahead rebuild after edit admits only new eligible events

### Live editing

- add a note to the currently playing track before its onset
- add a note to another track during playback
- delete a future note during playback
- edit a parameter lock for a future note during playback
- edit a live parameter on an active voice

### Tempo and timing

- BPM change before any affected event is admitted
- BPM change while notes are active
- BPM change during sustained notes
- swing change while transport is playing

### Looping and regions

- loop wraparound does not duplicate event instances
- same source event across successive loop iterations yields distinct occurrence IDs
- region length changes invalidate only the affected future schedule

### Audio cleanup

- pause releases active notes and prevents further note-ons
- stop resets playhead and prevents stale queue playback
- hard stop silences all sounding voices immediately

---

## Non-Goals

This brief does not propose:

- replacing Gluon's sequencer with an external application
- adopting a foreign project data model
- introducing a full DAW transport feature set
- solving long-term sync with external peers in this pass

This is a local architectural reset for Gluon's own transport and playback correctness.

---

## Reference Patterns

The architecture in this brief is informed by a small set of established transport and scheduling patterns rather than by any one upstream implementation.

- Web Audio scheduling guidance: use JavaScript timers only to wake a short-lookahead scheduler, and schedule audible work against the audio clock.
- Web Audio API timing model: treat scheduled audio times as sample-accurate execution targets rather than UI-timer approximations.
- Tone.js Transport pattern: separate transport timeline from event callbacks, and manage scheduled work through stable identities and cancellation semantics.
- Ableton Link timeline model: treat beat time, tempo, and start or stop intent as explicit transport concepts rather than incidental mutable state.
- SuperCollider server timing model: schedule ahead by a controlled latency window and separate planning from audio execution.

These references are not prescriptions to import another framework wholesale. They are evidence that mature sequencing systems converge on the same core ideas: explicit transport ownership, short rolling scheduling windows, stable event identity, and hard invalidation of stale work.

---

## Recommendation

Gluon should treat transport and scheduler correctness as foundational infrastructure, not as a stream of isolated defects.

The current bug pattern is strong evidence that the architecture has reached its limit. The right next step is to implement this reset, beginning with explicit transport semantics, event identity, generation invalidation, and an idempotent short-lookahead playback planner.

Only after that refactor should Gluon resume tuning playback behavior or adding sequencer capability.
