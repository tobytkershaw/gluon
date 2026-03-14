# Phase 4A Implementation Brief

## Status

Implementation brief for issue #22.
Written after M4 "First Chain" delivered the first vertical slice (Rings WASM + chain routing + AI structure tools).

---

## What M4 Delivered

The "First Chain" milestone proved modular chains end-to-end:

| Capability | PR | Status |
|---|---|---|
| Rings WASM compilation (57KB binary, 6 resonator models) | #98 | Merged |
| Audio engine chain routing (source → processor → gain staging) | #98 | Merged |
| Instrument registry for Rings (models, controls, adapter) | #98 | Merged |
| `ProcessorConfig` on Voice + session CRUD helpers | #98 | Merged |
| App.tsx sync effect (session processors ↔ audio engine) | #98 | Merged |
| `add_processor` / `remove_processor` AI tools | #99 | Merged |
| `ProcessorSnapshot` for undoable chain operations | #99 | Merged |
| Chain structure in AI state compression | #99 | Merged |
| Processor modules in system prompt | #99 | Merged |
| Unified undo across human + AI actions | #97 | Merged |

**What works today:** The AI can add Rings to any voice, the audio chain routes correctly, the human can undo it, and the AI sees the chain in its compressed state. Persistence round-trips processors.

---

## What Remains for Phase 4A Completion

The RFC (`docs/rfcs/phase4a.md`) defines Phase 4A as: "each voice = one small, legible signal chain" with source → up to 2 processors → modulation, plus chain UI.

### Slice 1: Second Processor Module (Clouds/Beads)

Add a second processor type to prove multi-processor chains work.

- Compile Clouds (or Beads) to WASM
- Add to instrument registry (models, controls, adapter)
- Audio engine already supports N processors per voice — no chain routing changes needed
- Validate: `Plaits → Rings → Clouds` chain works end-to-end

### Slice 2: Processor Param Tools

The AI can add/remove processors but can't yet adjust processor parameters via tool calls.

- `set_processor_param` AI tool (trackId, processorId, param, value)
- `set_processor_model` AI tool (trackId, processorId, model) — switch Rings resonator modes
- Prevalidation: processor existence, valid param names from registry
- Undo via existing `ProcessorSnapshot` or a new `ProcessorParamSnapshot`
- State compression: include processor params (currently only id/type/model)

### Slice 3: Chain Validation Layer

Enforce RFC structural rules in one shared validator:

- Exactly one source module per voice
- `processors.length <= 2`
- Valid processor types from registry
- Called by both AI prevalidation and any future human UI chain editing
- Currently validation is ad-hoc in `prevalidateAction` — extract to `src/engine/chain-validation.ts`

### Slice 4: Chain UI

The user must see what modules are in each voice's chain.

- **Chain strip**: left-to-right module badges below the voice header (source → processor(s))
- **Module inspector**: click a module badge to see/edit its params
- **Bypass toggle**: per-processor enable/disable (uses existing `ProcessorConfig.enabled` field — not yet wired)
- **Remove button**: remove processor from chain (dispatches same action as AI `remove_processor`)

### Slice 5: Modulation (Tides)

The RFC's modulation layer. Lower priority — depends on Slices 1-4 being solid.

- Compile Tides to WASM
- `ModulationAssignment` type and `modulations` array on Voice
- `add_modulation` / `remove_modulation` AI tools
- Runtime: modulator output applied as per-frame param offset during module evaluation
- UI: modulation summary chips on chain strip

### Slice 6: replace_processor Tool

Convenience tool combining remove + add in one atomic operation:

- `replace_processor` AI tool (trackId, processorId, newModuleType)
- Single undo group
- Useful once multiple processor types exist (Slice 1)

---

## Recommended Build Order

```
Slice 2 (processor param tools)     — unblocks AI sound design on Rings
Slice 3 (chain validation)          — safety net before adding more modules
Slice 1 (Clouds WASM)               — second processor proves multi-chain
Slice 4 (chain UI)                  — human can see and edit chains
Slice 6 (replace_processor)         — convenience, low effort
Slice 5 (modulation / Tides)        — Phase 4A capstone
```

Slices 2 and 3 can run in parallel. Slice 4 can start after Slice 1 lands (chain strip is more useful with 2+ processor types). Slice 5 is the final Phase 4A gate item.

---

## What Phase 4A Does NOT Include

Per the RFC non-goals:

- Arbitrary patch graphs or parallel routing
- Feedback loops
- Cross-voice audio routing
- Drag-and-drop modular editor
- PatchChain type migration (collapsing `voice.engine`/`voice.model`/`voice.params` into `patch.source`) — deferred until chain path is stable
- More than 2 processor types beyond Rings + Clouds

---

## Acceptance Criteria (from RFC)

Phase 4A is complete when:

1. The AI can build and edit simple patch chains reliably
2. The user can understand the result without reading internal state
3. Chain edits remain inspectable and undoable
4. Direct manipulation still feels first-class
5. Runtime performance is acceptable (4 voices × source + 2 processors)
6. The AI tends toward minimal patches

---

## Decision Gate for Phase 4B

Do not expand to guided modular graphs until Phase 4A is proven useful and legible in real sessions. See RFC for full gate criteria.
