# QA Gate

## Purpose

This QA gate is the structured stabilization pass that should run before further M5 work.

It is explicitly backlog-aware:

- known open stabilization issues are part of the QA matrix
- reproduced `priority:now` issues are blockers by default
- non-blocking findings should be filed as follow-up issues instead of silently absorbed into a vague checklist

The gate is automation-first, then human-confirmed.

## Phases

### Phase A: Preflight

Run the static confidence checks first:

```bash
./scripts/qa-preflight.sh
```

This runs:

- `npx tsc --noEmit`
- `npx vitest run`
- `npm run build`
- `npm run lint` as a known-red informational step unless/until [#152](https://github.com/tobytkershaw/gluon/issues/152) is fixed

Record:

- branch and commit
- whether API config is present for live AI smoke
- whether lint is red only because of known backlog issue `#152`

### Phase B: Automated Browser QA

Use the existing Playwright CLI workflow. Do not introduce a second browser test framework for this gate.

Run:

```bash
./scripts/qa-playwright-smoke.sh
```

Default smoke mode opens the app with `?qaAudioTrace=1`, which enables QA-only scheduler/audio trace logging in the browser console.

Artifacts are written under:

```text
output/playwright/<run-id>/
```

The smoke runner is split conceptually into:

- Tier B1: deterministic UI and state flows
- Tier B2: live AI smoke, only if API config is present
- Tier B3: QA audio/event trace confirmation for playback correctness

### Phase C: Human Checkpoint 1

Run only after:

- Phase A is green
- Tier B1 is green or only reproduces already-known issues
- Tier B2 is green or explicitly blocked by missing API config

This checkpoint is visual and interaction-focused.

### Phase D: Human Checkpoint 2

Run only after Checkpoint 1 passes.

This checkpoint is for audio and AI judgment. It is intentionally human-in-the-loop.

## Known-Issue Reproduction Matrix

These issues should be checked deliberately during each QA cycle instead of being rediscovered ad hoc.

### Default blockers if reproduced

- [#120](https://github.com/tobytkershaw/gluon/issues/120) BPM change path broken
- [#121](https://github.com/tobytkershaw/gluon/issues/121) agency control missing in some views
- [#130](https://github.com/tobytkershaw/gluon/issues/130) controls revert on mouse-up
- [#131](https://github.com/tobytkershaw/gluon/issues/131) non-primary voices only sound momentarily
- [#132](https://github.com/tobytkershaw/gluon/issues/132) spontaneous delayed parameter changes
- [#135](https://github.com/tobytkershaw/gluon/issues/135) stale events in Rings/Clouds worklets
- [#137](https://github.com/tobytkershaw/gluon/issues/137) BPM change path still bypasses scheduler
- [#149](https://github.com/tobytkershaw/gluon/issues/149) dangling modulation routes after processor changes
- [#150](https://github.com/tobytkershaw/gluon/issues/150) record no-op before audio init
- [#153](https://github.com/tobytkershaw/gluon/issues/153) transport start/playhead regression

### Non-blocking but must be tracked

- [#118](https://github.com/tobytkershaw/gluon/issues/118) tracker view switch should discard in-progress inline edits consistently
- [#124](https://github.com/tobytkershaw/gluon/issues/124) nested button issue in chain strip
- [#138](https://github.com/tobytkershaw/gluon/issues/138) AI/state audit follow-up
- [#140](https://github.com/tobytkershaw/gluon/issues/140) AI/state audit follow-up
- [#141](https://github.com/tobytkershaw/gluon/issues/141) AI/state audit follow-up
- [#142](https://github.com/tobytkershaw/gluon/issues/142) AI/state audit follow-up
- [#146](https://github.com/tobytkershaw/gluon/issues/146) AI/state audit follow-up
- [#148](https://github.com/tobytkershaw/gluon/issues/148) AI/state audit follow-up
- [#152](https://github.com/tobytkershaw/gluon/issues/152) lint baseline red

## Automated Coverage

### Tier B1: Deterministic UI and State Flows

The current smoke runner should cover:

- app boot
- top-bar view switching: `Chat`, `Inst`, `Track`
- active voice continuity across view switches
- tracker dedicated view visible
- transport UI presence
- transport playback trace:
  - seeded tracker events produce `scheduler.note` and `audio.note` during playback
- tracker inline editing basics:
  - double-click enters edit
  - `Escape` cancels
  - `Enter` commits
- editable-focus shortcut guard:
  - `Cmd+1/2/3` and `Tab` are suppressed while an input is focused
- voice-stage smoke:
  - voice selection
  - mute / solo button presence
- persistence smoke via reload on the same session

Representative seeded scenarios to add over time:

- default session
- processor chain session
- modulator session
- tracker-edited session
- session with tracker + added step-grid view

### Tier B2: Live AI Smoke

Run only if API configuration is present in the environment.

Keep assertions objective:

- user message appears
- AI response appears
- expected visible state delta appears
- undo becomes available
- result survives a view switch
- no stuck thinking state
- no fatal console error

Recommended small prompt set:

- chat-only response
- one parameter move
- one transport change
- one structural action:
  - add processor or add modulator
- one UI curation action:
  - add view
- one sequencing action:
  - sketch or transform

Do not treat this tier as audio-quality judgment.

### Tier B3: QA Audio/Event Trace

Use the QA trace before asking a human to judge playback correctness by ear.

Trace sources currently include:

- `transport.state`
- `transport.settings`
- `scheduler.note`
- `audio.note`
- modulation route add/remove/depth changes

Artifacts:

- `output/playwright/<run-id>/smoke/console-*.txt`
- browser console lines prefixed with `[qa-audio]`

Primary purpose:

- verify playback is scheduling and triggering events
- verify first-step/start behavior and per-voice triggering
- reduce reliance on subjective listening for basic correctness

## Human Checkpoint 1

Checklist:

- layout feels coherent across `chat`, `instrument`, `tracker`
- tracker is materially more usable in dedicated view
- no obvious UI drift or broken interaction patterns
- deep view, stage strip, and chain/modulator surfaces feel structurally correct
- agency visibility and affordances are correct in all views
- tracker edit lifecycle matches expectation

Allowed outcomes:

- `pass`
- `pass with follow-up issues`
- `stop and fix blockers`

## Human Checkpoint 2

Manual scripted scenarios:

- transport playback sanity across voices
- processor audition:
  - Rings
  - Clouds
- modulation audition:
  - Tides to source target
  - Tides to processor target
- AI musical behavior:
  - small sound change
  - “add movement”
  - simple sequencing change
  - optional listen/critique follow-up
- undo sanity after human and AI edits
- persistence sanity after meaningful edited session reload

Judgment criteria:

- result is audible
- AI changes are legible and reversible
- no obvious control/agency violations
- no obviously broken processor or modulation side effects
- the product feels trustworthy enough to continue with further surface work

## Issue Handling

For each QA cycle:

- update existing issues instead of filing duplicates when the problem is already tracked
- file all genuinely new non-blocking findings immediately
- treat reproduced `priority:now` stabilization issues as blockers unless explicitly downgraded
- keep flaky scenarios out of the blocker set unless they materially undermine trust

## Reporting

Use [docs/qa-report-template.md](/Users/tobykershaw/Development/gluon/docs/qa-report-template.md) for each run.

Every report should include:

- environment
- preflight results
- deterministic browser results
- known-issue reproduction matrix
- live AI smoke results
- human checkpoint results
- blockers / non-blockers / flaky items
