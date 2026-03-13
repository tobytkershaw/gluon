# Canonical Musical Model — Implementation Plan (v5)

## Context

The canonical musical model RFC (`docs/rfcs/canonical-musical-model.md`) defines the abstraction layer between Gluon's AI agent and its runtime backends. This plan implements the RFC across small, reviewable PRs that can run in parallel workstreams without conflicting with ongoing Phase 3 work.

The backlog is issues #18–#22 plus housekeeping. The plan sequences these into 8 PRs across 3 workstreams.

### Key architectural decisions

1. **Operation execution moves to the engine layer.** Today, agency checks and action dispatch live in `App.tsx` (UI). The RFC requires adapter validation before side effects and agency enforcement at the model layer. This plan introduces an engine-level operation executor that validates, resolves, and applies operations — so adding a second adapter never requires UI changes.

2. **Per-action validation, then apply accepted.** The executor validates each operation individually. Invalid operations are rejected with a reason; valid operations proceed. This matches current behaviour (an agency-OFF voice is silently skipped while other actions apply) and is better UX than batch-atomic (one bad AI action shouldn't block everything else). The RFC invariant "invalid operation fails cleanly with no side effects" applies per-operation: a rejected operation never partially mutates. But a batch containing both valid and invalid operations applies the valid ones.

3. **Executor returns an execution report, not just a session.** The report includes: the mutated session, accepted/rejected operations, resolved before/after values per control, and human-readable log entries. The UI consumes the report for action logs and message synthesis without re-implementing executor logic.

4. **Provenance uses canonical IDs from the start.** `ControlState` is keyed by canonical `controlId` (e.g. `brightness`, `pitch`), never by runtime param names. In PR-4, the executor uses the adapter to resolve canonical → runtime before applying mutations, and writes provenance under the canonical key. This avoids a namespace inconsistency when semantic IDs land.

5. **Event conversion is split from pitch conversion.** Generic event conversion (`MusicalEvent[]` ↔ `Step[]`) handles structure only: gates, accents, param locks, timing. Pitch conversion (MIDI 0–127 ↔ normalised 0–1) is a separate adapter-provided function injected into the conversion when needed. Round-trip tests cover structural conversion only; pitched round-trips require the adapter and are tested in the adapter's test suite.

6. **The instrument registry replaces all consumers.** `PLAITS_MODELS` is currently imported by `session.ts`, `ModelSelector.tsx`, and `state-compression.ts`. PR-2 migrates all of them. Between PR-2 and PR-6, `PLAITS_MODELS` remains as transitional duplication (not "source of truth") until PR-6 derives it from the registry.

7. **Tests go in `tests/` (top-level).** Existing convention: `tests/engine/`, `tests/ai/`, `tests/audio/`.

8. **Provenance drives undo and source attribution, not arbitration.** Arbitration remains its own runtime-param-keyed cooldown system (`Arbitrator` class in `arbitration.ts`). The executor passes the `Arbitrator` as a dependency; it does not derive arbitration from provenance state. A future PR may unify them, but this plan does not promise it.

9. **The full protocol migrates: parser, prompt, and types.** PR-5 migrates both `move` (param → controlId) and `sketch` (steps → events) in the parser, action types, and prompt action syntax. The AI emits the RFC shape; backward-compatible parsing accepts both legacy and canonical shapes during transition.

10. **Human-write provenance is mapped in the engine layer.** `updateVoiceParams()` gains an optional `adapter?: SourceAdapter` parameter. When provided, it calls `adapter.mapRuntimeParamKey(paramKey)` for each changed bare runtime param key (e.g. `timbre`) to get the canonical controlId (e.g. `brightness`), then writes provenance internally. This is distinct from `ControlBinding.path` (a dotted path like `params.timbre`) which is used only by the executor's canonical→runtime resolution. The UI passes the adapter but never knows the mapping. When no adapter is provided (e.g. during early init), provenance is not tracked. This keeps adapter-specific knowledge out of the UI, consistent with decision 1.

11. **One set of canonical types.** `src/engine/canonical-types.ts` is the single source of truth for canonical operation types (`MoveOp`, `SketchOp`, `AIOperation`, etc.). `src/engine/types.ts` re-exports or unions with legacy types for backward compatibility — it never redefines them.

---

## PR-0: Docs cleanup

**Branch:** `chore/canonical-model-docs-cleanup`
**Size:** Small — docs only
**Dependencies:** None

Commits the doc changes already made in this session:
- `docs/rfcs/canonical-musical-model.md` (new — the combined RFC)
- `docs/archive/rfc-musical-data-model.md` (moved)
- `docs/archive/gluon-canonical-musical-model-rfc.md` (moved)
- `docs/rfcs/phase4a.md` (updated status section)
- `docs/status.md` (updated header)
- `docs/briefs/canonical-model-implementation-plan.md` (this plan)

**Verification:** `npx tsc --noEmit` and `npx vitest run` pass.

---

## PR-1: Define canonical types [#18]

**Branch:** `feature/canonical-types`
**Workstream:** A (engine layer)
**Size:** Small — pure type definitions, no runtime changes
**Dependencies:** PR-0 merged

**New files:**
- `src/engine/canonical-types.ts` — All types from Part 1 of the RFC:
  - `ControlKind`, `SemanticRole`, `ControlSchema`, `ControlBinding`
  - `ControlValue` (value + source + updatedAt), `ControlState` (keyed by canonical controlId)
  - `SoundSource`, `Processor`
  - `RegionKind`, `Region`
  - `EventKind`, `BaseEvent`, `NoteEvent` (pitch: MIDI 0–127), `TriggerEvent`, `ParameterEvent` (with interpolation), `MusicalEvent`
  - `InstrumentDef`, `EngineDef`
  - `SourceAdapter` interface (both read and write paths):
    - `mapControl(controlId: string): ControlBinding` — canonical → runtime binding (includes dotted path like `params.timbre`)
    - `mapRuntimeParamKey(paramKey: string): string | null` — bare runtime param key (e.g. `timbre`) → canonical controlId (e.g. `brightness`). Explicit inverse of `mapControl` at the key level. Returns `null` for unknown keys.
    - `midiToNormalisedPitch` / `normalisedPitchToMidi` for adapter-boundary pitch conversion
    - Read/write paths: `applyControlChanges()`, `readControlState()`, `mapEvents()`, `readRegions()`, `getControlSchemas()`, `validateOperation()`
  - AI operation types: `MoveOp`, `SketchOp` (with `events: MusicalEvent[]`, `mode: 'replace' | 'merge'`, optional `regionId`), `AddProcessorOp`, `RemoveProcessorOp`, `SetProcessorParamOp`, `SayOp`, `AIOperation` union
  - `ExecutionReport` type: `{ session: Session; accepted: AIOperation[]; rejected: { op: AIOperation; reason: string }[]; log: ActionLogEntry[] }`

- `tests/engine/canonical-types.test.ts` — Structural validation helpers, compile-time type assertions.

**Files NOT touched:** `src/engine/types.ts` or any existing file.

---

## PR-2: Instrument registry (all consumers) [#19, part 1]

**Branch:** `feature/instrument-registry`
**Workstream:** B (audio + engine layer)
**Size:** Medium
**Dependencies:** PR-1 merged. Can be **started in parallel** using the RFC as reference, then rebased.

**New files:**
- `src/audio/instrument-registry.ts` — `InstrumentDef` for Plaits with all 16 `EngineDef` entries. Each engine maps:
  - `harmonics` → `richness` (SemanticRole), binding: `params.harmonics`
  - `timbre` → `brightness` (SemanticRole), binding: `params.timbre`
  - `morph` → `texture` (SemanticRole), binding: `params.morph`
  - `note` → `pitch` (SemanticRole), binding: `params.note`
  - Per-model musical descriptions sourced from `PLAITS_MODELS` and `system-prompt.ts`
  - Exports lookup helpers: `getEngineById()`, `getModelName()`, `getEngineControlSchemas()`, `getControlBinding(controlId)`
  - Exports a `controlIdToRuntimeParam` map and its inverse `runtimeParamToControlId` for the adapter

- `tests/audio/instrument-registry.test.ts` — Every engine has required controls, all bindings reference valid Plaits param paths, all semantic roles from the union, no duplicate IDs, registry covers all 16 models, `controlIdToRuntimeParam` is bijective.

**Modified files:**
- `src/engine/session.ts` — Import from registry instead of `PLAITS_MODELS`. `setModel()` uses registry lookup.
- `src/ui/ModelSelector.tsx` — Import model list from registry.
- `src/ai/state-compression.ts` — Replace local `modelName()` array with registry lookup.

**NOT modified yet:** `src/audio/synth-interface.ts` — `PLAITS_MODELS` remains as **transitional duplication**. It is no longer the source of truth (the registry is), but it is not yet derived from the registry. PR-6 collapses it.

**Conflict note:** Touches `session.ts` and `ModelSelector.tsx`. The changes are import swaps and function call replacements — easy to rebase.

---

## PR-3: Generate system prompt from registry [#19, part 2]

**Branch:** `feature/prompt-from-registry`
**Workstream:** B (AI layer)
**Size:** Small-medium
**Dependencies:** PR-2 merged

**Modified files:**
- `src/ai/system-prompt.ts` — Replace hardcoded "Plaits Models Reference" and "Parameter Space" sections with a generator function that reads from the instrument registry. Generates semantic control descriptions (e.g. "brightness (0.0–1.0): Spectral content, low = dark, high = bright"). Hand-written behavioural rules stay as string literals. **Action syntax examples stay as-is** (using `param` and `pattern.steps`) — PR-5 updates these when the parser is ready.

**New files:**
- `tests/ai/system-prompt-generation.test.ts` — Generated prompt includes all 16 models, mentions semantic role names, includes parameter ranges. Snapshot test for regression.

---

## PR-4: Operation executor + provenance [#20, part 1]

**Branch:** `feature/operation-executor`
**Workstream:** A (engine layer)
**Size:** Medium-large — the architectural keystone
**Dependencies:** PR-2 merged (needs registry for control ID resolution). Schedule in a Phase 3 gap.

### The executor

This is the layer between AI action dispatch and existing primitives. It validates, resolves, tracks provenance, and produces an execution report.

**New files:**
- `src/engine/operation-executor.ts`

  Core function:
  ```ts
  executeOperations(
    session: Session,
    actions: AIAction[],
    adapter: SourceAdapter,
    arbitrator: Arbitrator
  ): ExecutionReport
  ```

  Per-action validation, then apply:
  1. **Validate each action.** For each action: check agency (model layer, not UI), check arbitration, resolve `controlId` → runtime param via adapter, validate via `adapter.validateOperation()`. Invalid actions are rejected with a reason string and skipped. Valid actions are collected for application.
  2. **Apply accepted operations.** Mutate session through existing primitives (`applyMove`, `applySketch`). Track provenance under canonical controlId for each mutation. Collect before/after values and generate log entries. Group snapshots into a single undo entry.

  The `ExecutionReport` includes:
  - `session`: the mutated session
  - `accepted`: operations that were applied
  - `rejected`: operations that were rejected, each with a reason string
  - `log`: `ActionLogEntry[]` with voiceId, voiceLabel, description (including resolved before/after values)

  This gives the UI everything it needs for action logs and message synthesis without re-implementing executor logic.

### Provenance

Provenance is keyed by **canonical controlId** (e.g. `brightness`, `pitch`), not runtime param names. The executor resolves canonical → runtime via the adapter before applying mutations, then writes provenance under the canonical key.

`ControlState` on `Voice` stores: `{ brightness: { value: 0.3, source: 'ai', updatedAt: 1710... }, ... }`

This means `Voice.params` (runtime: `{ timbre: 0.3 }`) and `Voice.controlProvenance` (canonical: `{ brightness: { value: 0.3, source: 'ai' } }`) use **different key namespaces intentionally**. The runtime params drive the audio engine; the provenance drives undo and source attribution. The adapter bridges the two namespaces. There is no mixing.

**Provenance does NOT drive arbitration.** Arbitration remains its own runtime-param-keyed cooldown system (`Arbitrator` class). The executor passes the existing `Arbitrator` as a dependency and calls `canAIAct(voiceId, runtimeParam)` using the resolved runtime param name. A future PR may unify arbitration with provenance, but this plan keeps them separate.

### Human-write provenance

`updateVoiceParams()` in `session.ts` gains an optional `adapter?: SourceAdapter` parameter. When provided, it calls `adapter.mapRuntimeParamKey(paramKey)` for each changed param to get the canonical controlId, then writes provenance as `source: 'human'`. The UI passes the adapter but never knows the mapping:

```ts
export function updateVoiceParams(
  session: Session,
  voiceId: string,
  params: Partial<SynthParamValues>,
  trackAsHuman = false,
  adapter?: SourceAdapter,  // NEW: optional, enables provenance tracking
): Session
```

When `adapter` is provided and `trackAsHuman` is true, the function calls `adapter.mapRuntimeParamKey(paramKey)` for each changed runtime param key (e.g. `timbre`) to get the canonical controlId (e.g. `brightness`), then updates `voice.controlProvenance[controlId]` with `{ value, source: 'human', updatedAt }`. When `adapter` is omitted (backward compatible), provenance is not updated — only param values change.

App.tsx handlers pass the adapter:

```ts
// In handleParamChange:
next = updateVoiceParams(next, vid, { timbre, morph }, true, adapterRef.current);
```

This keeps adapter-specific knowledge in the engine layer, consistent with decision 1 (no UI changes for a second adapter).

### Undo-aware provenance

`ParamSnapshot` gains a `prevProvenance?: Partial<ControlState>` field that captures the provenance state before mutation. `revertSnapshot` restores both param values AND provenance. This ensures undo never desyncs value state from source attribution.

**New files:**
- `src/engine/operation-executor.ts` — As described above.
- `tests/engine/operation-executor.test.ts`:
  - Agency-OFF voice rejects all AI operations
  - Arbitration-held param rejects AI move (using runtime param key via adapter resolution)
  - `controlId` resolves to correct runtime param via adapter
  - Unknown `controlId` is rejected cleanly
  - Rejected operation does not mutate session (pre-validation)
  - Provenance set to 'ai' after AI move, keyed by canonical controlId
  - Undo restores both param values AND provenance state
  - Multiple ops grouped into single undo entry
  - Execution report contains accurate before/after values
  - Execution report log entries match accepted operations
  - Rejected ops appear in report with reasons

**Modified files:**
- `src/engine/types.ts` — Add `controlProvenance?: ControlState` to `Voice`. Add `prevProvenance?: Partial<ControlState>` to `ParamSnapshot`. Both additive-only.
- `src/engine/session.ts` — `updateVoiceParams()` gains optional `adapter` parameter for provenance tracking. `createVoice()` initialises `controlProvenance` with all controls as `source: 'default'` using canonical IDs from the registry.
- `src/engine/primitives.ts` — `applyMove`/`applyMoveGroup` gain optional `provenance` parameter (backward compatible). `revertSnapshot` checks for `prevProvenance` and restores it when present.
- `src/ui/App.tsx` — Two changes:
  1. `dispatchAIActions` is simplified: creates adapter, calls `executeOperations()`, reads `ExecutionReport` for log entries and message synthesis. The inline agency checks, arbitration, move grouping, and snapshot collapsing are removed (executor handles all of it). Net simplification.
  2. `handleParamChange`, `handleNoteChange`, `handleHarmonicsChange` pass the adapter to `updateVoiceParams()` to enable provenance tracking. The UI never sees canonical control IDs — the adapter handles the mapping internally.

**Conflict risk:** Highest of all PRs — touches `types.ts`, `primitives.ts`, `session.ts`, `App.tsx`. The `App.tsx` change is large but is a net simplification. Time for Phase 3 gap.

---

## PR-5: Event abstraction, adapter, and protocol migration [#20, part 2]

**Branch:** `feature/event-abstraction`
**Workstream:** A (engine layer)
**Size:** Medium
**Dependencies:** PR-3 and PR-4 both merged

### Event conversion (structure only)

Generic conversion handles gates, accents, param locks, timing. It does NOT handle pitch.

**New files:**
- `src/engine/event-conversion.ts`:
  - `stepsToEvents(steps: Step[], options?: { pitchConverter?: (normalised: number) => number }): MusicalEvent[]`
  - `eventsToSteps(events: MusicalEvent[], stepCount: number, options?: { pitchConverter?: (midi: number) => number }): Step[]`
  - When `pitchConverter` is not provided, any `step.params.note` is dropped from the event output (or NoteEvent.pitch is dropped from Step output). Pitch conversion is opt-in and injected by the adapter.
  - Structural conversion: TriggerEvent ↔ Step (gate+accent). ParameterEvent ↔ step param locks (non-note params only, using canonical controlId). NoteEvent presence ↔ gate with pitch.

- `tests/engine/event-conversion.test.ts`:
  - **Structural round-trips (no pitch):** Steps with gates/accents/param locks → Events → Steps is identity.
  - **Edge cases:** Empty pattern, all-accent pattern, param locks on non-pitch controls.
  - **Pitch is not round-tripped without converter:** Steps with `note` → Events without pitchConverter → Steps without `note`. This is correct — pitch lives at the adapter boundary.

### Plaits adapter

**New files:**
- `src/audio/plaits-adapter.ts` — First `SourceAdapter` implementation:
  - `mapControl(controlId)` → `ControlBinding` (includes dotted path like `params.timbre`)
  - `mapRuntimeParamKey(paramKey)` → canonical controlId (e.g. `timbre` → `brightness`)
  - `applyControlChanges()` → translates semantic IDs to Plaits params
  - `readControlState()` → reads current params with semantic IDs
  - `midiToNormalisedPitch(midi: number): number` — MIDI 60 → ~0.47 (uses existing `midiToNote` from `synth-interface.ts`)
  - `normalisedPitchToMidi(normalised: number): number` — inverse
  - `mapEvents(events)` → delegates to `eventsToSteps` with `pitchConverter: this.midiToNormalisedPitch`
  - `validateOperation()` → checks control exists, value in range
  - `getControlSchemas()` → delegates to registry

- `tests/audio/plaits-adapter.test.ts`:
  - `brightness` maps to `params.timbre`
  - Unknown controlId rejected
  - MIDI 60 → normalised ~0.47 (via adapter pitch converter)
  - Normalised 0.47 → MIDI ~60 (inverse)
  - **Pitched round-trip through adapter:** Steps with note → Events (adapter pitch converter) → Steps with note is identity (within rounding tolerance)
  - Agency enforcement is NOT in the adapter (executor handles it)

### Protocol migration (parser + types + prompt)

This is where the full AI-facing protocol shifts to the canonical shape. Both `move` and `sketch` are migrated.

**Modified files:**
- `src/engine/types.ts` — Import and re-export `MoveOp` and `SketchOp` from `canonical-types.ts` (no redefinition). Widen the `AIAction` union to include canonical types alongside legacy types: `type AIAction = AIMoveAction | AICanonicalMoveAction | AISayAction | AISketchAction | AICanonicalSketchAction`. Where `AICanonicalMoveAction = MoveOp` and `AICanonicalSketchAction = SketchOp` are type aliases re-exported from `canonical-types.ts`. Both shapes are valid during the transition.

- `src/ai/response-parser.ts` — Accept both legacy and canonical shapes:
  - `move`: accept `controlId` as alternative to `param`. If `controlId` is present, use it; if `param` is present, pass through (executor resolves).
  - `sketch`: accept `events` array as alternative to `pattern.steps`. If `events` is present, parse as canonical sketch; if `pattern` is present, parse as legacy sketch (executor handles conversion via adapter).

- `src/ai/system-prompt.ts` — Update action syntax examples to teach canonical shapes:
  - `move`: `{ "type": "move", "controlId": "brightness", "target": { "absolute": 0.7 } }` (replaces `param: "timbre"`)
  - `sketch`: `{ "type": "sketch", "voiceId": "v0", "description": "...", "mode": "replace", "events": [...] }` (replaces `pattern.steps`)
  - Include `MusicalEvent` examples: `{ "kind": "trigger", "at": 0, "velocity": 1.0, "accent": true }`, `{ "kind": "note", "at": 0, "pitch": 60, "velocity": 0.8, "duration": 0.25 }`
  - Parameter section uses semantic names: "brightness (0.0–1.0)" instead of "timbre (0.0–1.0)"

- `src/engine/operation-executor.ts` — Wire in event conversion for sketch operations: incoming `MusicalEvent[]` converted to `Step[]` via conversion layer with adapter pitch converter before passing to `applySketch`. Handle both legacy (PatternSketch) and canonical (events) sketch shapes.

**Files NOT touched:** `App.tsx` (executor handles dispatch from PR-4), `primitives.ts`, step grid UI.

---

## PR-6: Collapse PLAITS_MODELS (cleanup)

**Branch:** `chore/collapse-plaits-models`
**Workstream:** B
**Size:** Small
**Dependencies:** PR-2 and PR-5 merged

**Modified files:**
- `src/audio/synth-interface.ts` — `PLAITS_MODELS` becomes a derived export from the registry. `SynthParams`, `DEFAULT_PARAMS`, `noteToHz`, `midiToNote` stay unchanged.
- `tests/audio/instrument-registry.test.ts` — Assertion: derived `PLAITS_MODELS` matches expected shape and count.

---

## PR-7: AI-facing contract document [#21]

**Branch:** `docs/ai-contract`
**Workstream:** C (docs only)
**Size:** Small-medium
**Dependencies:** PR-5 merged (needs final action syntax). Can be **drafted in parallel**; finalised after PR-5.

**New files:**
- `docs/ai/ai-contract.md` — What the agent needs at inference time:
  - Type definitions for build-now layer
  - Serialised state format (example JSON)
  - 3+ worked round-trip examples (state → reasoning → operation)
  - Semantic role guide with musical grounding
  - Validation invariants as hard rules
  - Positive instructions
  - **No north-star vocabulary**

---

## Parallel Execution Schedule

```
Phase 1 — Start immediately:

  PR-0  docs cleanup              [any agent, ~30 min]
  PR-1  canonical types            [Agent A, ~1 hr]      no deps
  PR-2  instrument registry        [Agent B, ~2 hrs]     start parallel, rebase onto PR-1

Phase 2 — After PR-1 and PR-2 merge:

  PR-3  prompt from registry       [Agent B, ~1.5 hrs]   depends on PR-2
  PR-4  operation executor +       [Agent A, ~3–4 hrs]   depends on PR-2
        provenance                                       schedule in Phase 3 gap

Phase 3 — After PR-3 and PR-4 merge:

  PR-5  event abstraction +        [Agent A, ~3 hrs]     depends on PR-3 + PR-4
        adapter + protocol                               (larger than v3 due to
        migration                                        parser/prompt migration)

Phase 4 — After PR-5 merge:

  PR-6  collapse PLAITS_MODELS     [Agent B, ~30 min]    depends on PR-2 + PR-5
  PR-7  AI contract doc            [Agent C, ~2 hrs]     depends on PR-5

```

---

## Workstream Ownership (file boundaries)

| Workstream | Owns | Does NOT touch |
|---|---|---|
| A (engine) | `src/engine/*`, `src/audio/plaits-adapter.ts` | `src/audio/instrument-registry.ts`, `src/audio/synth-interface.ts` |
| B (audio+AI) | `src/audio/instrument-registry.ts`, `src/audio/synth-interface.ts`, `src/ai/state-compression.ts`, `src/engine/session.ts` (PR-2 only), `src/ui/ModelSelector.tsx` (PR-2 only) | `src/engine/primitives.ts`, `src/engine/types.ts` |
| A (PR-5 only) | `src/ai/system-prompt.ts`, `src/ai/response-parser.ts` | Coordinated with B since PR-3 also touches `system-prompt.ts`. PR-5 rebases onto PR-3. |
| C (docs) | `docs/*` | `src/*` |

---

## Coordination with Phase 3

| Overlap file | Which PR | Risk | Mitigation |
|---|---|---|---|
| `types.ts` | PR-4, PR-5 | Medium | Additive only, schedule between Phase 3 PRs |
| `primitives.ts` | PR-4 | Medium | Additive only (optional provenance param) |
| `session.ts` | PR-2, PR-4 | Low | PR-2: import swap. PR-4: additive init + new function |
| `App.tsx` | PR-4 | High | Large change (net simplification). After Phase 3 step 3+ merges |
| `response-parser.ts` | PR-5 | Low | Backward-compatible addition |
| `system-prompt.ts` | PR-3, PR-5 | Low | PR-3: reference sections. PR-5: action syntax. Sequential. |

---

## Changes from v3 (in v4)

1. **Decision 8 (new):** Provenance drives undo and source attribution only, not arbitration. Arbitration stays as its own runtime-param-keyed cooldown system. Dropped overstated claim.

2. **Decision 9 (new):** Full protocol migration in PR-5. Parser, prompt action syntax, and action types all migrate together. Both `move` (param → controlId) and `sketch` (steps → events) are migrated. Backward-compatible parsing accepts both shapes.

3. **Decision 10 (new in v4, revised in v5):** Human-write provenance mapped in engine layer via optional adapter parameter on `updateVoiceParams()`.

4. **PR-4 revised:** Provenance tracking via adapter in `updateVoiceParams()`. Clarified that arbitration is NOT derived from provenance.

5. **PR-5 revised:** Now includes parser migration (both move and sketch), action type additions to `types.ts`, and prompt action syntax update. PR-7 dependency changed from PR-3 to PR-5.

6. **PR-7 dependency changed:** Now depends on PR-5 (not PR-3) since the AI contract document needs the final canonical action syntax.

## Changes from v4 (in v5)

1. **Decision 2 rewritten:** Executor uses per-action validation, not batch-atomic. Invalid actions are rejected individually; valid actions proceed. This matches current behaviour and is better UX. The headline and PR-4 description are now consistent.

2. **Decision 10 rewritten:** Human-write provenance mapping moved from UI (App.tsx) to engine layer. `updateVoiceParams()` gains optional `adapter?: SourceAdapter` parameter. The UI passes the adapter but never sees canonical control IDs. This is consistent with decision 1 (no UI changes for a second adapter).

3. **Decision 11 (new):** One set of canonical types. `canonical-types.ts` is the single source. `types.ts` re-exports or aliases — never redefines. PR-5's type additions reference `canonical-types.ts` instead of creating parallel definitions.

## Changes in v5.1

1. **Adapter inverse API specified.** `SourceAdapter` gains `mapRuntimeParamKey(paramKey: string): string | null` — bare runtime param key (e.g. `timbre`) → canonical controlId (e.g. `brightness`). This is the explicit inverse of `mapControl(controlId)` at the key level, distinct from `ControlBinding.path` (which is a dotted path like `params.timbre`). Decision 10, PR-1 (adapter interface), and PR-4 (human-write provenance) all consistently reference `mapRuntimeParamKey()`. No more ambiguity between registry exports and adapter methods, or between runtime paths and runtime param keys.

---

## Verification (every PR)

1. `npx tsc --noEmit` — zero type errors
2. `npx vitest run` — all tests pass (including new tests)
3. Rebase onto `dev` before opening PR
