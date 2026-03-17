# System Audit Report

Ongoing subsystem-by-subsystem audit using the framework in `docs/audits/framework.md`.

Last updated: 2026-03-17.

---

## Scope

This report is the running record for the current full-system audit. Each completed subsystem section should capture:
- planned vs claimed vs implemented vs required
- contract, parity, lifecycle, usability, and orthodoxy findings
- linked GitHub issues for fix-now bugs and structural follow-up

---

## Issue Map

- [#554](https://github.com/tobytkershaw/gluon/issues/554) Plaits integration robustness and reusable source-module runtime pattern
- [#555](https://github.com/tobytkershaw/gluon/issues/555) Shared audio module runtime contract and port topology alignment
- [#556](https://github.com/tobytkershaw/gluon/issues/556) Audio module live/offline parity gaps
- [#557](https://github.com/tobytkershaw/gluon/issues/557) Transport command/state separation and automation timing
- [#558](https://github.com/tobytkershaw/gluon/issues/558) Cursor-play and parameter-timing regressions
- [#559](https://github.com/tobytkershaw/gluon/issues/559) Surface placeholder vs intended curated surface model
- [#560](https://github.com/tobytkershaw/gluon/issues/560) Make Surface state real in the UI
- [#561](https://github.com/tobytkershaw/gluon/issues/561) Make bus sends and routing topology usable from the human UI
- [#562](https://github.com/tobytkershaw/gluon/issues/562) Align chain/routing parity audits and topology claims
- [#563](https://github.com/tobytkershaw/gluon/issues/563) Real round-trip coverage for project persistence/import/export/restore
- [#564](https://github.com/tobytkershaw/gluon/issues/564) Shared restore/migration contract for imported and project-stored sessions
- [#566](https://github.com/tobytkershaw/gluon/issues/566) Unify the written AI contract with the actual tool/state/executor interface
- [#567](https://github.com/tobytkershaw/gluon/issues/567) Make AI track-metadata actions undoable
- [#568](https://github.com/tobytkershaw/gluon/issues/568) Browser/runtime failure-mode and degraded-state audit
- [#642](https://github.com/tobytkershaw/gluon/issues/642) Fence project lifecycle loads and surface degraded persistence failures honestly
- [#643](https://github.com/tobytkershaw/gluon/issues/643) Make audio runtime degradation explicit and user-visible
- [#648](https://github.com/tobytkershaw/gluon/issues/648) Run a hands-on Playwright UI audit of the current product
- [#650](https://github.com/tobytkershaw/gluon/issues/650) Clarify AI/chat readiness and collaboration entry point in the main workspace
- [#651](https://github.com/tobytkershaw/gluon/issues/651) Make tracker note entry and cell editing behave like a trustworthy musical grid
- [#652](https://github.com/tobytkershaw/gluon/issues/652) Fix first-run UI flow and default landing experience
- [#569](https://github.com/tobytkershaw/gluon/issues/569) End-to-end composition walkthrough audit
- [#571](https://github.com/tobytkershaw/gluon/issues/571) Performance and resource lifecycle audit
- [#572](https://github.com/tobytkershaw/gluon/issues/572) Docs/status/roadmap truthfulness audit

---

## Execution Sequence

The issue map should be executed in dependency order, not issue-number order. The main principle is:
- fix contract bugs that can mislead users or corrupt behavior first
- then unify split contracts
- then extract reusable patterns
- then tighten docs and parity coverage

### Phase 1: Fix live correctness and user-trust bugs

These issues represent direct contract failures or user-facing gaps. They should land before broader refactors.

1. [#558](https://github.com/tobytkershaw/gluon/issues/558) Cursor-play and parameter-timing regressions
2. [#556](https://github.com/tobytkershaw/gluon/issues/556) Audio module live/offline parity gaps
3. [#561](https://github.com/tobytkershaw/gluon/issues/561) Make bus sends and routing topology usable from the human UI
4. [#567](https://github.com/tobytkershaw/gluon/issues/567) Make AI track-metadata actions undoable

Why first:
- These are the clearest places where the current product behavior violates its own contract.
- They are likely to reduce false signals during subsequent structural work.

### Phase 2: Unify core contracts

These issues address duplicated or split truth across the runtime.

1. [#557](https://github.com/tobytkershaw/gluon/issues/557) Transport command/state separation and automation timing
2. [#564](https://github.com/tobytkershaw/gluon/issues/564) Shared restore/migration contract for imported and project-stored sessions
3. [#566](https://github.com/tobytkershaw/gluon/issues/566) Unify the written AI contract with the actual tool/state/executor interface
4. [#562](https://github.com/tobytkershaw/gluon/issues/562) Align chain/routing parity audits and topology claims

Why here:
- They establish one source of truth for transport, persistence, AI interface, and topology claims.
- Later refactors will be safer once these contracts are explicit.

### Phase 3: Stabilize the Surface and module architecture

These issues make the intended reusable architecture real.

1. [#560](https://github.com/tobytkershaw/gluon/issues/560) Make Surface state real in the UI
2. [#559](https://github.com/tobytkershaw/gluon/issues/559) Surface placeholder vs intended curated surface model
3. [#554](https://github.com/tobytkershaw/gluon/issues/554) Plaits integration robustness and reusable source-module runtime pattern
4. [#555](https://github.com/tobytkershaw/gluon/issues/555) Shared audio module runtime contract and port topology alignment

Why here:
- Surface work depends on the UI/runtime contract being clearer.
- The reusable audio runtime work should follow after immediate parity fixes, otherwise the refactor will absorb live bugs and muddy verification.

### Phase 4: Expand verification and lock parity down

These issues are primarily about preventing regression after the architecture work lands.

1. [#563](https://github.com/tobytkershaw/gluon/issues/563) Real round-trip coverage for project persistence/import/export/restore

Why last:
- This coverage should be written against the corrected restore contract, not the drifting one.
- Additional parity/contract tests should also be added as part of Phases 1-3, but this issue is the dedicated persistence/test hardening pass.

### Recommended implementation waves

If work needs to be chunked into short execution waves:

1. Wave A: `#558`, `#556`, `#567`
2. Wave B: `#561`, `#557`
3. Wave C: `#564`, `#566`, `#562`
4. Wave D: `#560`, `#559`
5. Wave E: `#554`, `#555`
6. Wave F: `#563` plus end-to-end regression verification

### Dependency notes

- `#558` should land before or alongside `#557`, because it fixes current transport bugs while `#557` regularizes the underlying model.
- `#556` should land before `#555`, because parity bugs are easier to verify before the shared runtime refactor.
- `#564` should land before `#563`, because the test suite should target the unified restore path.
- `#560` should land before `#559` if you want the current Surface model to become honest incrementally; reverse them if you choose to replace the placeholder first.
- `#554` and `#555` are closely related and may be worked as one coordinated stream, but `#554` is the narrower Plaits-led proving ground.

### Later audits

These are recommended after the current stabilization sequence, not before it:

- [#569](https://github.com/tobytkershaw/gluon/issues/569) End-to-end composition walkthrough audit
- [#568](https://github.com/tobytkershaw/gluon/issues/568) Browser/runtime failure-mode and degraded-state audit
- [#571](https://github.com/tobytkershaw/gluon/issues/571) Performance and resource lifecycle audit
- [#572](https://github.com/tobytkershaw/gluon/issues/572) Docs/status/roadmap truthfulness audit

---

## Audit Coverage

| Subsystem | Status | Notes |
| --- | --- | --- |
| Transport / scheduler | Complete | Findings filed |
| UI / control surfaces | Complete | Findings filed |
| Chain / routing lifecycle | Complete | Findings filed |
| Persistence / undo | Complete | Findings filed |
| AI action contract | Complete | Findings filed |
| Browser / runtime failure modes | Complete | Findings filed |
| Hands-on UI audit | Complete | Findings filed |

---

## 1. Transport / Scheduler

### Product alignment

| Layer | Assessment |
| --- | --- |
| Planned | Standardized tracker model, simplified scheduler, song mode, play-from-cursor, metronome, automation and interpolation. |
| Claimed | `docs/status.md` presents transport stabilisation as complete apart from minor transport shortcut undo parity. |
| Implemented | Core play/pause/stop and song-mode sequencing are implemented and broadly sound. |
| Required | Cursor-start, pause/resume, transport edits during playback, and parameter automation timing need to be reliable enough to trust transport as a core musical tool. |

### Findings

1. `P0` `playFromStep` is documented as a one-shot transport command but is never consumed after use.
2. `P0` Pause/resume after play-from-cursor can resume from the stale cursor request rather than the paused runtime position.
3. `P0` Parameter automation is applied on lookahead entry rather than at the event's audio time.
4. `P1` Transport state and one-shot transport commands are structurally conflated.
5. `P2` Tests are strong on known regressions but weak on the actual transport-command and automation-timing contract.

### Orthodoxy alignment

| Subsystem | Orthodox pattern | Gluon approach | Deviation class | Reason | Risk |
| --- | --- | --- | --- | --- | --- |
| Scheduler timing | Two-clocks Web Audio scheduler | Mostly aligned | justified | Worklet + Web Audio constraints | low |
| Event invalidation | Lifecycle flush / cancel scheduled events | Generation fence | justified | Web Audio worklet adaptation | low |
| Transport command model | Separate durable transport state and locate/play commands | `playFromStep` stored in transport state | unjustified | accidental hybridization | high |
| Automation timing | Timed scheduling against audio clock | immediate main-thread callback on lookahead entry | unjustified | historical simplification | high |

### Tests run

- `npx vitest run tests/engine/scheduler.test.ts tests/engine/sequencing-regression.test.ts src/engine/transport-controller.test.ts tests/engine/transport-pause-resume.test.ts tests/engine/session.test.ts`
- Result: 152 tests passed

### Filed issues

- [#557](https://github.com/tobytkershaw/gluon/issues/557) `Separate transport commands from transport state and regularize scheduler automation timing`
- [#558](https://github.com/tobytkershaw/gluon/issues/558) `Fix transport cursor-play and parameter-timing regressions`

---

## 2. UI / Control Surfaces

### Product alignment

| Layer | Assessment |
| --- | --- |
| Planned | Tracker, Rack, and Patch are canonical views; Surface is a custom composed, AI-curated performance layer with semantic controls, pinned controls, XY labeling, stage/performance behavior, and deep-view parity. |
| Claimed | `docs/status.md` still frames the true AI-curated Surface as upcoming proof work, but the product already exposes a `Surface` tab and AI surface tools. |
| Implemented | The `surface` tab currently routes through `InstrumentView -> ExpandedTrack`, a fixed expanded-track editor with semantic controls, raw module panels, a hardcoded XY pad, sequencer slots, and deep-view inspection. |
| Required | The user needs a clear distinction between canonical views and the curated performance surface, and any AI-surface state exposed in tools/state should be real and directly usable in the UI. |

### Findings

1. `P0` `TrackSurface.pinnedControls` is a dead view-layer path. It exists in state, persistence, AI tools, and operation execution, but is not rendered in the Surface UI.
2. `P0` `TrackSurface.xyAxes` is a dead view-layer path. It exists in state, persistence, and AI tools, but the visible XY pad remains hardwired to `timbre` / `morph`.
3. `P1` `DeepView` is read-only, so the human cannot perform several surface-editing actions the current RFC and AI-surface tool model imply, including control pinning and richer semantic-surface editing.
4. `P1` The current `surface` tab is a pragmatic placeholder/hybrid expanded-track editor rather than the composed surface-module system described in the view and surface RFCs.
5. `P2` Canonical-vs-curated role separation is blurred because Surface includes substantial raw module editing that overlaps with Rack and Deep View responsibilities.

### Orthodoxy alignment

| Subsystem | Orthodox pattern | Gluon approach | Deviation class | Reason | Risk |
| --- | --- | --- | --- | --- | --- |
| Tracker / Rack / Patch split | Clear ground-truth views with distinct roles | Mostly aligned | justified | Product structure is coherent overall | low |
| Curated performance surface | Composed control surface distinct from inspection/editor views | Hybrid expanded-track editor | pragmatic-temporary | interim implementation | medium |
| Human parity for AI surface tools | User-facing surface actions should exist if AI can perform them | AI can pin and label axes, UI cannot fully use them | unjustified | contract drift | high |

### Filed issues

- [#559](https://github.com/tobytkershaw/gluon/issues/559) `Clarify or replace the current Surface placeholder with the intended curated surface model`
- [#560](https://github.com/tobytkershaw/gluon/issues/560) `Make Surface state real in the UI (pins, axes, deep-view parity)`

---

## 3. Chain / Routing Lifecycle

### Product alignment

| Layer | Assessment |
| --- | --- |
| Planned | Chains are intentionally shallow and constrained, but bus routing, explicit master bus behavior, and Patch as the topology ground-truth view are part of the shipped model. |
| Claimed | `docs/status.md` presents bus routing as a stabilized design decision and Patch as the topology ground-truth view. Human capability parity tests are meant to describe which routing actions are or are not available in the UI. |
| Implemented | Session state and the audio engine support bus tracks, sends, modulation routing, and master-bus rerouting. Patch supports modulation routing and chain inspection for the active track. |
| Required | The user needs a truthful and usable way to create and understand routing, including bus/send behavior, without relying on AI-only paths or hidden engine state. |

### Findings

1. `P0` Bus/send routing is implemented in session state and the audio engine, but there is no visible human UI path for creating, removing, or editing sends.
2. `P0` Patch is described as the topology ground-truth view, but it does not represent bus/send topology and only shows source/processor/output plus modulation for the active track.
3. `P1` The human-capability parity test is stale: it still claims modulation-route connect has no UI even though Patch now supports connection interactions.
4. `P1` Topology ownership is structurally brittle. The engine has a one-way `rerouteToMasterBus()` helper and no inverse reroute path if the master-bus assumption changes, even though session logic currently keeps that latent.
5. `P2` The subsystem is not fundamentally broken, but the current truth is split across docs, tests, Patch scope, and engine behavior rather than one explicit routing contract.

### Orthodoxy alignment

| Subsystem | Orthodox pattern | Gluon approach | Deviation class | Reason | Risk |
| --- | --- | --- | --- | --- | --- |
| Chain topology | Constrained serial chain with explicit routing contract | Mostly aligned | justified | intentional shallow-chain design | low |
| Bus/send workflow | Routing should be visible and editable from the human interface | State/engine support exists without human UI control surface | unjustified | product/implementation drift | high |
| Patch truth model | Ground-truth topology view should include the topology it claims to own | Patch omits bus/send topology while docs still call it ground truth | unjustified | accidental hybridization | high |
| Topology parity audit | Tests/docs should describe current capabilities accurately | parity test and product language are stale | pragmatic-temporary | audit drift | medium |

### Tests run

- `npx vitest run tests/audio/audio-engine.test.ts tests/ai/human-capability-parity.test.ts tests/engine/session.test.ts`
- Result: 110 tests passed

### Filed issues

- [#561](https://github.com/tobytkershaw/gluon/issues/561) `Make bus sends and routing topology usable from the human UI`
- [#562](https://github.com/tobytkershaw/gluon/issues/562) `Align chain/routing parity audits and topology claims with the actual implementation`

---

## 4. Persistence / Undo

### Product alignment

| Layer | Assessment |
| --- | --- |
| Planned | Project persistence, undo across human and AI edits, import/export, and legacy migration are all part of the product foundation. |
| Claimed | `docs/roadmap.md` treats project persistence and working undo as landed core capability, and the product shell exposes save/import/export/switching as routine workflow. |
| Implemented | Undo/redo primitives are fairly rich, and legacy localStorage persistence has substantial migration coverage. The current product path uses IndexedDB project storage plus `useProjectLifecycle` restore logic. |
| Required | The user needs save/load/import/export and undo behavior to preserve one consistent session contract regardless of source, with no hidden differences between legacy recovery, project storage, and imported files. |

### Findings

1. `P1` The current project-storage path and the legacy localStorage path do not restore sessions through one shared normalization contract.
2. `P1` `importProject()` accepts older project versions but bypasses legacy restore safeguards, including incompatible undo/redo clearing for pre-v6 data and other session-level normalization.
3. `P2` Persistence coverage is heavily weighted toward the legacy loader. The current IndexedDB/import/export path has only mocked lifecycle tests, not real session round-trip coverage.
4. `P2` The undo core is reasonably well covered for in-memory operations, but persistence and restore are not tested as one end-to-end contract.

### Orthodoxy alignment

| Subsystem | Orthodox pattern | Gluon approach | Deviation class | Reason | Risk |
| --- | --- | --- | --- | --- | --- |
| Session restore | One shared loader/normalizer per persisted document shape | legacy and current project paths normalize differently | unjustified | implementation drift | high |
| Import migration | Older file formats should pass through the same migration rules as normal load | import path does partial migration only | unjustified | accidental split path | high |
| Undo/redo model | In-memory LIFO/grouping semantics | mostly aligned | justified | coherent snapshot model | low |
| Persistence testing | Real round-trip coverage for current storage path | mostly legacy-path coverage plus mocked hook tests | pragmatic-temporary | tests never caught up with storage architecture | medium |

### Tests run

- `npx vitest run tests/engine/undo.test.ts tests/engine/primitives.test.ts tests/engine/operation-executor.test.ts src/engine/quantize.test.ts`
- Result: 50 tests passed
- `npx vitest run tests/engine/persistence.test.ts tests/ui/useProjectLifecycle.test.tsx`
- Result: 35 tests passed

### Filed issues

- [#563](https://github.com/tobytkershaw/gluon/issues/563) `Add real round-trip coverage for project persistence, import, export, and restore`
- [#564](https://github.com/tobytkershaw/gluon/issues/564) `Run imported and project-stored sessions through the full restore/migration contract`

---

## 5. AI Action Contract

### Product alignment

| Layer | Assessment |
| --- | --- |
| Planned | The AI should operate a legible, truthful instrument: tools, state, constraints, feedback, and undo behavior must all describe the same world. |
| Claimed | `docs/ai/ai-contract.md` presents a coherent public AI contract, and the principles docs explicitly require conceptual and operational truth to stay aligned. |
| Implemented | The live AI stack uses `tool-schemas`, `system-prompt`, compressed state, API parsing, and executor validation/execution. Much of that runtime is coherent, but the written contract has drifted and one executor path violates the undo contract. |
| Required | The model and the human need one trustworthy contract: what the AI can do, what state it sees, what names it should use, and which actions are fully undoable. |

### Findings

1. `P0` The written AI contract in `docs/ai/ai-contract.md` is not the actual live AI contract. Tool count, tool names, and control vocabulary have drifted from the current schemas, prompt, and compressed state.
2. `P0` AI metadata writes via `set_track_meta` are only partially undoable. Approval changes create undo snapshots; importance and musical-role changes do not.
3. `P1` The AI layer still has multiple sources of truth: public docs, tool schemas, compressed state, and system prompt each describe overlapping but not identical interfaces.
4. `P2` The current tests are good at structural tool-loop coverage, but they do not assert written-contract parity or undo behavior for AI metadata writes.

### Orthodoxy alignment

| Subsystem | Orthodox pattern | Gluon approach | Deviation class | Reason | Risk |
| --- | --- | --- | --- | --- | --- |
| Tool contract | One authoritative tool/state contract | multiple overlapping descriptions | unjustified | documentation/runtime drift | high |
| AI action undo | All stateful AI edits should participate in one undo model | metadata edits partially bypass undo | unjustified | executor gap | high |
| Tool loop validation | schema + prevalidation + execution | mostly aligned | justified | coherent runtime design | low |
| Contract testing | explicit checks for interface drift | mostly structural tests only | pragmatic-temporary | tests never expanded to docs/contract parity | medium |

### Tests run

- `npx vitest run tests/ai/tool-schemas.test.ts tests/ai/api-structural.test.ts tests/ai/human-capability-parity.test.ts src/engine/operation-executor.test.ts src/engine/operation-executor-guards.test.ts`
- Result: 72 tests passed

### Filed issues

- [#566](https://github.com/tobytkershaw/gluon/issues/566) `Unify the written AI contract with the actual tool, state, and executor interface`
- [#567](https://github.com/tobytkershaw/gluon/issues/567) `Make AI track-metadata actions undoable and consistent with the collaboration contract`

---

## 6. Browser / Runtime Failure Modes

### Product alignment

| Layer | Assessment |
| --- | --- |
| Planned | Browser/runtime failures should degrade honestly, recover where possible, and avoid leaving hidden broken state behind. |
| Claimed | The current product implies graceful fallback in a few places, especially source fallback and persistence degraded mode, but does not describe the real limits of those degraded states. |
| Implemented | Healthy-path guards exist for suspend/resume, AI request staleness, import validation, and some persistence fallback. |
| Required | Runtime failures need to become explicit product state: users should know when Gluon is no longer running the intended audio engine or when persistence/project actions are degraded. |

### Findings

1. `P0` Source-engine degradation is still silent at the product layer. Plaits source init failure falls back to `WebAudioSynth` with only a console warning in `src/audio/create-synth.ts`, and the only automated coverage locks in the fallback rather than requiring explicit degraded-state visibility in `tests/audio/create-synth.test.ts`.

2. `P0` Async processor/modulator init failures are not surfaced honestly. The UI adds tracks, processors, and modulators with `void ... .then(...)` chains in `src/ui/App.tsx` with no rejection handling, while the engine-side constructors for Rings, Clouds, and Tides can reject during WASM/worklet init in `src/audio/audio-engine.ts`. I infer these failures currently become console/unhandled-promise behavior rather than visible degraded state.

3. `P1` Persistence degraded mode is only partially honest. On IndexedDB init failure, `useProjectLifecycle()` drops to an in-memory session plus `saveStatus = 'error'` in `src/ui/useProjectLifecycle.ts`, and the UI reduces that to a save-error dot titled “Save failed — working in memory” in `src/ui/ProjectMenu.tsx`. But most project actions still target IndexedDB-backed flows and are not represented as unavailable or degraded.

4. `P1` Project lifecycle actions are not fenced or surfaced consistently under failure. `loadProjectById()` has no request token or stale-response guard in `src/ui/useProjectLifecycle.ts`, so rapid switch/duplicate/delete flows can race. `ProjectMenu` only awaits import; `new/open/duplicate/delete/export` are fire-and-forget in `src/ui/ProjectMenu.tsx`, which means action failures can disappear into unhandled rejections rather than user-visible feedback.

5. `P2` Failure-path coverage is narrow and creates false confidence. Current tests prove that source fallback exists, IndexedDB migration works, and scheduler skips work during suspend in `tests/audio/create-synth.test.ts`, `tests/ui/useProjectLifecycle.test.tsx`, and `src/engine/scheduler.test.ts`. They do not lock in degraded-state visibility, stale-load fencing, or async module-init failure handling.

### Orthodoxy alignment

| Subsystem | Orthodox pattern | Gluon approach | Deviation class | Reason | Risk |
| --- | --- | --- | --- | --- | --- |
| Audio init failure | Explicit degraded mode or hard failure when the intended engine is unavailable | silent source fallback plus console warning | unjustified | historical convenience fallback | high |
| Async lifecycle loads | Token/fence stale async responses so only the latest request wins | project load path has no request fencing | unjustified | implementation drift | high |
| Browser suspend/resume | Skip scheduling while suspended, cap catch-up on resume | aligned | justified | good Web Audio adaptation | low |
| Degraded persistence UX | Disable or clearly qualify unavailable project actions | save-error dot plus mostly unchanged project menu | pragmatic-temporary | incomplete degraded-state design | medium |

### Tests run

- `npx vitest run tests/audio/create-synth.test.ts tests/ui/useProjectLifecycle.test.tsx src/engine/scheduler.test.ts`
- Result: 24 tests passed

### Filed issues

- [#642](https://github.com/tobytkershaw/gluon/issues/642) `Fence project lifecycle loads and surface degraded persistence failures honestly`
- [#643](https://github.com/tobytkershaw/gluon/issues/643) `Make audio runtime degradation explicit and user-visible`

---

## 7. Hands-On Playwright UI Audit

### Scope

Manual browser audit performed against the live app using Playwright-driven clicks, key presses, view switches, and screenshots. The audit stayed on the real interaction path and did not use JS state mutation shortcuts.

### Screenshots

- [01-initial-shell.png](ui-audit-2026-03/01-initial-shell.png)
- [02-project-menu.png](ui-audit-2026-03/02-project-menu.png)
- [03-tracker-default.png](ui-audit-2026-03/03-tracker-default.png)
- [04-rack-no-source.png](ui-audit-2026-03/04-rack-no-source.png)
- [05-rack-source-picker.png](ui-audit-2026-03/05-rack-source-picker.png)
- [06-rack-source-selected.png](ui-audit-2026-03/06-rack-source-selected.png)
- [07-tracker-cell-editing.png](ui-audit-2026-03/07-tracker-cell-editing.png)
- [08-tracker-playing-with-invalid-cell.png](ui-audit-2026-03/08-tracker-playing-with-invalid-cell.png)
- [09-patch-playing.png](ui-audit-2026-03/09-patch-playing.png)
- [10-send-picker.png](ui-audit-2026-03/10-send-picker.png)
- [11-send-added.png](ui-audit-2026-03/11-send-added.png)

### Product alignment

| Layer | Assessment |
| --- | --- |
| Planned | Canonical workbench views should be trustworthy, source setup should be legible, and chat should read as a clear collaboration entry point. |
| Claimed | The app shell presents Surface, Rack, Patch, Tracker, transport, project controls, and chat as one coherent product workspace. |
| Implemented | Rack and Patch are materially usable; Tracker is visually legible but interaction semantics are shaky; Surface is still a building site; chat is hidden and under-explained until expanded. |
| Required | A first-run user needs an obvious place to start, a clear source-setup path, a trustworthy tracker editing model, and an understandable collaboration entry point. |

### Findings

1. `P0` The first-run landing flow is misleading. The app lands in Surface even though Surface is not currently the clearest primary workflow, and the initial track has no source loaded. A new user has to discover Rack before Tracker/playback become materially useful. See [01-initial-shell.png](ui-audit-2026-03/01-initial-shell.png), [03-tracker-default.png](ui-audit-2026-03/03-tracker-default.png), and [04-rack-no-source.png](ui-audit-2026-03/04-rack-no-source.png).

2. `P0` The live browser session silently degraded the audio engine while the UI continued to imply the intended source model was running. During source selection, the console reported repeated `Plaits init failed, falling back to WebAudioSynth` warnings, but the UI still presented `Plaits (Virtual Analog)` as if the intended engine were active.

3. `P0` Tracker note entry is not trustworthy enough in live use. Clicking the first empty note cell immediately changed the cell state and focused a textbox; pressing `z` then changed the visible note cell to literal `Z`, making the tracker behave like raw text editing instead of a clear musical grid. Playback kept running while the grid showed invalid-looking content. See [07-tracker-cell-editing.png](ui-audit-2026-03/07-tracker-cell-editing.png) and [08-tracker-playing-with-invalid-cell.png](ui-audit-2026-03/08-tracker-playing-with-invalid-cell.png).

4. `P1` The project shell under-explains persistence and destructive actions. The project menu exposes new, duplicate, export, import, delete, and WAV export, but most of the state context is compressed into a tiny save indicator dot in the title button. See [02-project-menu.png](ui-audit-2026-03/02-project-menu.png).

5. `P1` Source setup is discoverable only after switching to Rack, and the initiating control label is poor. The underlying source picker is reasonable once open, but the trigger is a vague `Unknown` button that hides the real module vocabulary. See [04-rack-no-source.png](ui-audit-2026-03/04-rack-no-source.png) and [05-rack-source-picker.png](ui-audit-2026-03/05-rack-source-picker.png).

6. `P1` The AI/chat entry point is under-signposted for first-run use. Expanding chat reveals API-key fields and a disabled prompt box, but there is little framing about whether collaboration is ready, blocked, or how central this panel is to the product. See [11-send-added.png](ui-audit-2026-03/11-send-added.png).

7. `P2` Routing usability is better than the earlier code audit suggested. In live use, adding a send from the sidebar was straightforward and both the sidebar and Patch reflected the result coherently. This lowers the severity of “no human routing path” for the current product, though it does not remove broader topology-truth issues. See [10-send-picker.png](ui-audit-2026-03/10-send-picker.png) and [11-send-added.png](ui-audit-2026-03/11-send-added.png).

### Orthodoxy alignment

| Subsystem | Orthodox pattern | Gluon approach | Deviation class | Reason | Risk |
| --- | --- | --- | --- | --- | --- |
| First-run workbench | Land on the most trustworthy, legible primary workflow | lands on unfinished Surface path | pragmatic-temporary | historical default / unfinished transition | high |
| Tracker editing | Explicit musical cell-edit model, not ambiguous text-entry behavior | tracker cells can drift into raw textbox semantics | unjustified | interaction model mismatch | high |
| Collaboration entry | Clear visible collaboration panel or obvious setup/readiness state | hidden side panel with under-explained disabled state | pragmatic-temporary | product shell still evolving | medium |
| Routing UI | Human-editable send workflow in the shell | better than expected; coherent enough in live use | justified | currently acceptable | low |

### Filed issues

- [#650](https://github.com/tobytkershaw/gluon/issues/650) `Clarify AI/chat readiness and collaboration entry point in the main workspace`
- [#651](https://github.com/tobytkershaw/gluon/issues/651) `Make tracker note entry and cell editing behave like a trustworthy musical grid`
- [#652](https://github.com/tobytkershaw/gluon/issues/652) `Fix first-run UI flow and default landing experience`
