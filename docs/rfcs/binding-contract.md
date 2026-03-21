# RFC: Binding Contract for Surface and Live Control Targets

**Status:** Draft
**Issue:** #1381
**Epic:** #1380 (Creative Scaffolding)

## Problem

Surface modules and live controls need to reference parameters they control. Today, `ModuleBinding.target` is an untyped string. Each renderer manually parses it — `KnobGroupModule` splits on `:` to detect `moduleId:controlId`, `MacroKnobModule` ignores bindings entirely and reads a `SemanticControlDef` from `config`. There is no validation, no stale detection, and no shared resolution logic.

This works for track source params and partially for processor params, but breaks for:
- **Modulator params** — no renderer knows how to resolve them
- **Generator params** — don't persist in track state yet
- **ParamShape params** — don't persist in track state yet
- **Weighted multi-param** — lives in `config`, not bindings
- **Region targets** — separate resolution path with no stale detection

The creative scaffolding epic requires the AI to compose surfaces and live controls with bindings to all of these target types. A unified, typed binding contract is the foundation.

## Design

### Three layers

**1. BindingTarget** — what the control points at (data model, serializable)

**2. BindingResolver** — how a target reads/writes current state (runtime, per-track)

**3. BindingPresentation** — labels, ranges, transforms, semantic names (module config, renderer concern)

These are separate concerns. A `BindingTarget` is inert data. The resolver evaluates it against a live `Track`. Presentation metadata (e.g. a macro knob labelled "Character") lives in `SurfaceModule.config` and `SurfaceModule.label`, not in the binding.

### Layer 1: BindingTarget

```typescript
// ── Scalar parameter targets ──

type SourceTarget     = { kind: 'source'; param: string };
type ProcessorTarget  = { kind: 'processor'; processorId: string; param: string };
type ModulatorTarget  = { kind: 'modulator'; modulatorId: string; param: string };
type MixTarget        = { kind: 'mix'; param: 'volume' | 'pan' };
type DrumPadTarget    = { kind: 'drumPad'; padId: string; param: string };

// Future — declared now, resolve as 'unsupported' until state persistence exists
type GeneratorTarget  = { kind: 'generator'; generatorId: string; param: string };
type ParamShapeTarget = { kind: 'paramShape'; shapeId: string; param: string };

// ── Region targets (step-grid, piano-roll) ──

type RegionTarget = { kind: 'region'; patternId: string };

// ── Weighted multi-param (macro knobs) ──

type WeightedMapping = {
  target: ScalarTarget;
  weight: number;
  transform?: 'linear' | 'inverse' | 'bipolar';
};

type WeightedTarget = { kind: 'weighted'; mappings: WeightedMapping[] };

// ── Chain target (chain-strip) ──

type ChainTarget = { kind: 'chain' };

// ── Kit target (pad-grid) ──

type KitTarget = { kind: 'kit' };

// ── Union ──

type ScalarTarget =
  | SourceTarget
  | ProcessorTarget
  | ModulatorTarget
  | MixTarget
  | DrumPadTarget
  | GeneratorTarget
  | ParamShapeTarget;

type BindingTarget =
  | ScalarTarget
  | WeightedTarget
  | RegionTarget
  | ChainTarget
  | KitTarget;
```

**Why regions, chains, and kits are in the union:** They're still bindings — they need the same validation and stale detection. A deleted pattern should produce a stale region binding, not a silent empty grid. Keeping them outside would recreate the split-brain problem.

**Why generator and paramShape now:** One stable schema for `set_surface` and `propose_controls`. No second binding redesign later. Resolvers return `unsupported` until the backing state exists.

### Layer 2: BindingResolver

#### Normalized vs native values

Not all parameters live in 0-1 space. The resolver always reads and writes **native values** — whatever range the backing state uses. The presentation layer (renderers) is responsible for normalizing to display range.

| Target kind | Native range | Notes |
|---|---|---|
| `source` | 0.0–1.0 | All Plaits params are normalized |
| `processor` | 0.0–1.0 | All processor params are normalized |
| `modulator` | 0.0–1.0 | All modulator params are normalized |
| `mix.volume` | 0.0–1.0 | Linear gain |
| `mix.pan` | -1.0–1.0 | Track/master pan (center = 0.0) |
| `drumPad` (source params) | 0.0–1.0 | Per-pad source params are normalized |
| `drumPad.level` | 0.0–1.0 | Per-pad level |
| `drumPad.pan` | 0.0–1.0 | Per-pad pan (center = 0.5) — note: different from track pan |

The resolver reports the native range alongside the value so renderers can normalize without hardcoding per-target knowledge:

```typescript
type ResolvedScalar = {
  status: 'ok';
  kind: 'scalar';
  value: number;
  range: { min: number; max: number };
};

type ResolvedWeighted = {
  status: 'ok';
  kind: 'weighted';
  value: number;           // weighted average, normalized to 0-1 for display
  componentValues: { target: ScalarTarget; value: number; range: { min: number; max: number } }[];
};

type ResolvedBinding =
  | ResolvedScalar
  | ResolvedWeighted
  | { status: 'ok'; kind: 'region'; patternId: string; events: MusicalEvent[] }
  | { status: 'ok'; kind: 'chain'; processors: Processor[] }
  | { status: 'ok'; kind: 'kit'; pads: DrumPad[] }
  | { status: 'stale'; reason: string }       // target existed but was removed
  | { status: 'unsupported'; reason: string }; // target kind not yet backed by state
```

The read function:

```typescript
function resolveBinding(track: Track, target: BindingTarget): ResolvedBinding
```

**Scalar resolution** dispatches on `target.kind`:
- `source` → `track.params[controlIdToRuntimeParam[param]]`, range `{ min: 0, max: 1 }`
- `processor` → find processor by ID, read `proc.params[param]`, range `{ min: 0, max: 1 }`. If processor missing → `stale`.
- `modulator` → find modulator by ID, read `mod.params[param]`, range `{ min: 0, max: 1 }`. If missing → `stale`.
- `mix.volume` → `track.volume`, range `{ min: 0, max: 1 }`
- `mix.pan` → `track.pan`, range `{ min: -1, max: 1 }`
- `drumPad` → find pad, read source param or level/pan. Range depends on field. If pad missing → `stale`.
- `generator` / `paramShape` → `unsupported` (until Slices 2-3 land state persistence)

**Weighted resolution**: resolve each mapping's scalar target, normalize each to 0-1 using its native range, compute weighted average. The composite `value` is always 0-1.

**Region resolution**: find pattern by `patternId` in `track.patterns`. If missing → `stale`.

**Chain resolution**: return `track.processors`. Always `ok` (empty array if no processors).

**Kit resolution**: return `track.drumRack.pads`. If no drum rack → `stale`.

#### Write path — BindingMutation

The write path cannot return a bare `Track` — the app's mutation model is session-level and undo-aware. Surface interactions today go through explicit callbacks (`onParamChange`, `onProcessorParamChange`, `onInteractionStart/End`, `onBypassToggle`) that capture undo snapshots and respect arbitration. The binding write path must produce mutation descriptors that integrate with this existing infrastructure, not bypass it.

```typescript
// A single parameter change described by a binding write
type ParamMutation =
  | { kind: 'sourceParam'; param: string; value: number }
  | { kind: 'processorParam'; processorId: string; param: string; value: number }
  | { kind: 'modulatorParam'; modulatorId: string; param: string; value: number }
  | { kind: 'mixParam'; param: 'volume' | 'pan'; value: number }
  | { kind: 'drumPadParam'; padId: string; param: string; value: number };

// Result of writing to a binding target
type BindingWriteResult =
  | { status: 'ok'; trackId: string; mutations: ParamMutation[] }
  | { status: 'stale'; reason: string }
  | { status: 'unsupported'; reason: string };

function writeBinding(track: Track, target: BindingTarget, value: number): BindingWriteResult
```

For scalar targets, this produces a single-element `mutations` array. For weighted targets, it produces one mutation per mapping with the inverse-transformed value. For non-writable target kinds (region, chain, kit), it returns `unsupported`. The caller (renderer or Live Controls panel) dispatches each mutation through the existing session callbacks, which handle undo grouping, arbitration, and snapshot capture. The binding layer does not own mutation execution — it translates a knob turn into the set of parameter changes that the existing infrastructure already knows how to apply.

**Weighted write semantics:** When mappings have heterogeneous native ranges, each mapping's write value is computed independently:
1. The input `value` is 0-1 (normalized knob position).
2. For each mapping, apply the inverse transform (linear/inverse/bipolar) with the mapping's weight to get a 0-1 intermediate value.
3. Denormalize the intermediate value to the target's native range: `native = range.min + intermediate * (range.max - range.min)`.
4. Clamp to the target's native range.

This means a macro knob that maps to both `mix.pan` (-1..1) and `source.timbre` (0..1) produces correct native values for both. Overlapping targets (two mappings pointing at the same param) are last-write-wins within a single mutation batch — the higher-index mapping's value takes precedence. This is predictable and matches the existing `computeSemanticRawUpdates` behavior.

### Layer 3: BindingPresentation

Presentation metadata stays in `SurfaceModule.config` and `SurfaceModule.label`, where it already lives. This layer is the renderer's concern, not the binding contract's.

Examples of presentation metadata that is NOT part of BindingTarget:
- Macro knob label ("Character", "Openness")
- Display range/clamp overrides
- Axis labels for XY pad
- Visual transform hints

The binding contract provides native values with their ranges. For weighted targets, the composite display value is normalized to 0-1. For scalar targets, the value is native (which happens to be 0-1 for most params, but is -1..1 for track pan). Renderers use the reported range to normalize for display.

### Updated ModuleBinding

```typescript
interface ModuleBinding {
  role: BindingRole;    // module-definition-driven, not free string
  trackId: string;      // owning track (cross-track reserved for future)
  target: BindingTarget;
}
```

**`trackId` resolution rule:** `trackId` is never provided by the AI in tool calls. It is always set by the tool handler from the action's `trackId` (the owning track). On-wire (AI-facing JSON), bindings contain only `role` and `target`. On storage, every `ModuleBinding` includes the resolved `trackId`. Migration preserves existing `trackId` values. This avoids ambiguity: the AI targets a track, the tool handler fills in `trackId` on all bindings — same as today's `set_surface` handler.

### Binding roles

Roles are defined by the module registry, not free strings. Each module type declares its allowed roles:

```typescript
type BindingRole =
  | 'control'   // knob-group: one per knob
  | 'x-axis'    // xy-pad: X dimension
  | 'y-axis'    // xy-pad: Y dimension
  | 'region'    // step-grid, piano-roll: pattern reference
  | 'chain'     // chain-strip: processor chain reference
  | 'kit'       // pad-grid: drum rack reference
  | 'track';    // level-meter: signal monitoring
```

The registry validates that a module's bindings use only its allowed roles. Free strings are how drift returns.

### AI-facing schema

The AI provides structured targets in `set_surface` and `propose_controls`. JSON, not string parsing:

```json
{
  "modules": [{
    "type": "knob-group",
    "label": "Tone",
    "bindings": [
      { "role": "control", "target": { "kind": "source", "param": "harmonics" } },
      { "role": "control", "target": { "kind": "source", "param": "timbre" } }
    ]
  }, {
    "type": "macro-knob",
    "label": "Character",
    "bindings": [{
      "role": "control",
      "target": {
        "kind": "weighted",
        "mappings": [
          { "target": { "kind": "source", "param": "harmonics" }, "weight": 0.4 },
          { "target": { "kind": "source", "param": "timbre" }, "weight": 0.4, "transform": "linear" },
          { "target": { "kind": "source", "param": "morph" }, "weight": 0.2 }
        ]
      }
    }]
  }, {
    "type": "xy-pad",
    "label": "Filter",
    "bindings": [
      { "role": "x-axis", "target": { "kind": "processor", "processorId": "ripples-1", "param": "cutoff" } },
      { "role": "y-axis", "target": { "kind": "processor", "processorId": "ripples-1", "param": "resonance" } }
    ]
  }, {
    "type": "step-grid",
    "label": "Pattern",
    "bindings": [
      { "role": "region", "target": { "kind": "region", "patternId": "pattern-abc" } }
    ]
  }]
}
```

### Migration

Existing surfaces use old string-format bindings. A migration function converts at load time:

```typescript
function migrateBinding(old: { role: string; trackId: string; target: string }): ModuleBinding {
  // "frequency" → { kind: 'source', param: 'frequency' }
  // "ripples-1:cutoff" → { kind: 'processor', processorId: 'ripples-1', param: 'cutoff' }
  // pattern ID → { kind: 'region', patternId: ... }
  // For macro-knob: migrate SemanticControlDef from config into weighted binding
}
```

Old surfaces continue to work. New surfaces use typed bindings from the start.

### Cross-track bindings

Not designed now. Every module belongs to one owning track. Bindings default to that track. The `trackId` field is preserved for future extension — targets could optionally name another track later — but no cross-track authoring, rendering, or permission semantics are specified here.

## What this replaces

| Before | After |
|---|---|
| `ModuleBinding.target: string` | `ModuleBinding.target: BindingTarget` (discriminated union) |
| `ModuleBinding.role: string` | `ModuleBinding.role: BindingRole` (typed from registry) |
| Manual `moduleId:controlId` parsing in each renderer | Shared `resolveBinding()` function |
| `SemanticControlDef` in `module.config` for macro knobs | `WeightedTarget` in binding, presentation in config |
| No stale detection | `stale` / `unsupported` resolution states |
| No modulator/generator/paramShape bindings | Typed target kinds (modulator works now; generator/paramShape resolve as unsupported until state persistence) |

## Files affected

| File | Change |
|---|---|
| `src/engine/types.ts` | New `BindingTarget`, `BindingRole`, `ResolvedBinding`, `ParamMutation`, `BindingWriteResult` types. Update `ModuleBinding`. Deprecate `SemanticControlDef` (migrate to weighted binding). |
| `src/engine/binding-resolver.ts` | **New file.** `resolveBinding()`, `writeBinding()`, `migrateBinding()`, native range lookup. |
| `src/engine/surface-module-registry.ts` | Typed binding roles per module. Validation against allowed roles. |
| `src/ui/surface/KnobGroupModule.tsx` | Replace manual string parsing with `resolveBinding()`. |
| `src/ui/surface/XYPadModule.tsx` | Replace manual string parsing with `resolveBinding()`. |
| `src/ui/surface/MacroKnobModule.tsx` | Replace `SemanticControlDef` config read with weighted binding resolution. |
| `src/ui/surface/StepGridModule.tsx` | Replace manual pattern lookup with `resolveBinding()`. |
| `src/ui/surface/ChainStripModule.tsx` | Use `resolveBinding()` for chain target. |
| `src/ui/surface/PadGridModule.tsx` | Use `resolveBinding()` for kit target. |
| `src/ui/surface/semantic-utils.ts` | Logic moves to `binding-resolver.ts`. File may be removed. |
| `src/ai/api.ts` | Update `set_surface` handler to accept structured targets. Add `propose_controls` handler. |
| `src/ai/tool-schemas.ts` | Update `set_surface` binding schema. Add `propose_controls` tool. |
| `src/ui/LiveModuleRenderer.tsx` | Use `resolveBinding()` for live control knobs (currently unconnected). |
| `src/engine/surface-templates.ts` | Migrate `SemanticControlDef` usage to weighted bindings. |

## Implementation order

1. Define types (`BindingTarget`, `BindingRole`, `ResolvedBinding`) in `types.ts`
2. Build `binding-resolver.ts` with `resolveBinding()`, `writeBinding()`, `migrateBinding()`
3. Update registry with typed roles and validation
4. Migrate renderers one at a time (knob-group first — it's the Slice 1 proving ground)
5. Update `set_surface` tool to accept structured targets
6. Build `propose_controls` tool (Slice 1 deliverable)
7. Migrate `SemanticControlDef` → weighted bindings (can coexist during transition)

## Open questions

1. **Interaction grouping for weighted writes.** A macro knob turn produces N mutations. Should these be grouped into a single undo entry at the binding layer, or does the caller (renderer) handle undo grouping via `onInteractionStart/End`? Current answer: the caller handles it — the binding layer produces mutations, the renderer wraps them in an interaction group. This matches the existing pattern in `MacroKnobModule` → `App.tsx` interaction callbacks.

2. **Stale binding UX.** When a binding resolves as `stale`, the renderer should show a disconnected state (dim, strikethrough, or badge). The exact visual treatment is a renderer/design concern, not specified here. The contract guarantees the resolver will report `stale` with a `reason` string suitable for tooltip display.
