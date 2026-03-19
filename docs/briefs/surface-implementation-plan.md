# Surface Implementation Plan

Implementation plan for the Surface north star (`docs/rfcs/surface-north-star.md`).

**Status: COMPLETE** — All 6 layers shipped across issues #1051-#1067 (12 issues, 12 PRs).

## Strategy

One clean contract cut (Layer 0), then build forward. No coexistence of semantic-controls and module-based representations. The old `TrackSurface.semanticControls` is replaced by `TrackSurface.modules` in a single atomic change.

---

## Layer 0: Contract Migration

The clean cut. Replace the semantic-controls contract with the module-composition contract. Merges as one atomic change, but internally structured into sub-slices with clear ownership.

### 0a. Engine state & types

**Owner:** Engine / types

- New types: `SurfaceModule`, `ModuleBinding`, `SurfaceModuleDef`, `SurfaceModuleRegistry`
- `TrackSurface` changes:
  - Add `modules: SurfaceModule[]`
  - Remove `semanticControls: SemanticControlDef[]`
  - Remove `pinnedControls: PinnedControl[]`
  - Remove `xyAxes: { x: string; y: string }`
  - Keep `thumbprint: ThumbprintConfig` (visual identity, unaffected)
- Pins become Knob Group modules with `{ pinned: true }` in config
- XY axes become bindings on an XY Pad module
- Semantic controls become Macro Knob module config (reuses `SemanticControlDef` shape)
- Undo snapshots: `SurfaceSnapshot` captures `modules[]`

### 0b. Module registry

**Owner:** Engine / registry

- `SurfaceModuleDef` entries for initial module types:
  - **Knob Group** — binds to N control IDs, renders labelled knobs
  - **Macro Knob** — single knob with weighted multi-param mapping, config shape = `SemanticControlDef`
  - **XY Pad** — binds to two control IDs
  - **Step Grid** — binds to region events
  - **Chain Strip** — binds to processor chain
- Each definition: required bindings, optional bindings, default size, min/max size
- Binding validation: can a module bind to this target?

### 0c. Migration & session initialisation

**Owner:** Engine / session

- **State hydration normalizer**: on session load, detect old `TrackSurface` shape (has `semanticControls` field) and convert to `modules[]`:
  - Each `SemanticControlDef` → Macro Knob module
  - Each `PinnedControl` → Knob Group module with one binding + `{ pinned: true }`
  - `xyAxes` → XY Pad module with matching bindings
- New sessions create modules directly (no old-shape intermediary)
- **Bare-track defaults are templates**: a Plaits-only track gets its default surface from the template registry (signature `'plaits'`), same code path as chain templates. One source for all default surfaces.

### 0d. Template migration

**Owner:** Engine / surface-templates

- All templates produce `SurfaceModule[]` instead of `SemanticControlDef[]`
- Template for `'plaits'`: Knob Group (timbre, morph, harmonics) + Step Grid
- Template for `'plaits:rings'`: Macro Knob (Brightness, Resonance) + XY Pad + Step Grid
- Template for `'plaits:clouds'`, `'plaits:rings:clouds'`, etc.: similar pattern
- `maybeApplySurfaceTemplate()` applies module-based templates on chain mutation
- Bare-track defaults flow through the same template system

### 0e. Operation executor

**Owner:** Engine / operation-executor

- `set_surface`: applies `modules[]` to track state
- `pin`: creates a Knob Group module with one binding + `{ pinned: true }`
- `unpin`: removes the matching pinned module
- `label_axes`: updates bindings on the existing XY Pad module. **Fails if no XY Pad module exists** — the AI should use `set_surface` to add one. No implicit module creation.
- Validation: module types must exist in registry, bindings must reference real controls/regions, positions must fit grid constraints

### 0f. AI tool schema & parsing

**Owner:** AI / api

- `set_surface` schema: accepts `modules[]` with types, bindings, positions, config
- Remove old semantic-controls-only schema entirely
- Parsing: validate module types against registry, validate bindings, generate module IDs
- `pin` / `unpin`: implementation as described above
- `label_axes`: fails if no XY Pad module exists
- Tool result format: reports what modules were placed, what was rejected

### 0g. State compression

**Owner:** AI / state-compression

- Compressed surface state format:
  ```
  surface:
    modules: KnobGroup[Brightness, Space], XYPad[Brightness×Space], StepGrid
    pinned: Clouds:decay
  ```
- Remove old `semantic:` format

### 0h. System prompt & docs

**Owner:** AI / prompts + docs

- System prompt: new `set_surface` description, module composition guidance
- New collaboration posture: "set up the controls" alongside musical actions
- `docs/ai/ai-contract.md`: update tool declarations for module-based surface
- `docs/gluon-interaction-protocol-v05.md`: update surface operations section
- Remove all references to semantic-controls-only `set_surface`

### 0i. Tests

**Owner:** Tests (cross-cutting)

- Update all tests referencing `semanticControls`, `pinnedControls`, `xyAxes` on `TrackSurface`
- New tests:
  - Module-based `set_surface` validation (valid modules, invalid bindings, missing types)
  - Pin-as-module creation and removal
  - Template migration (old shape → new modules)
  - State hydration normalizer (old sessions load correctly)
  - Undo: surface module state captures and reverts correctly
  - `label_axes` fails when no XY Pad exists
- Contract tests: module surface state is undoable, bounded, parity-safe

---

## Layer 1: Canvas + First Modules

*Depends on Layer 0. Renders the new state. Replaces ExpandedTrack routing.*

### 1a. SurfaceCanvas component

- react-grid-layout (or similar) integration
- Renders `track.surface.modules` from state
- Grid constraints: column count, row heights, module snap
- Drag/resize enabled from day one (parity principle)
- Surface tab routes to `SurfaceCanvas`, replacing `InstrumentView → ExpandedTrack`
- Empty/sparse surface is acceptable at this stage

### 1b. Knob Group module renderer

- Renders N labelled rotary knobs bound to control IDs
- Reuses existing knob SVG rendering
- Handles param changes through existing `onParamChange` paths

### 1c. Macro Knob module renderer

- Single knob with weighted multi-parameter mapping
- Config contains `SemanticControlDef` shape
- Reuses existing `computeSemanticRawUpdates` logic

### 1d. XY Pad module renderer

- Binds to two control IDs
- Replaces hardwired ParameterSpace component
- Axis labels from module bindings

### Visual verification

Playwright screenshots at each step. Compare against reference layouts. This layer needs visual inspection — it's the first time the new Surface renders.

---

## Layer 2: Remaining Core Modules

*Depends on Layer 1. Parallelise across modules.*

### 2a. Step Grid module

- Binds to region events
- Curated projection of Tracker data — current pattern, gate/velocity/accent
- Reuses existing step grid rendering logic

### 2b. Chain Strip module

- Binds to track processor chain
- Signal flow diagram with bypass toggles
- Curated projection of Patch data

### 2c. Piano Roll module

- Binds to melodic region events
- Curated projection of Tracker data for pitched content

### 2d. Level Meter module

- Binds to track audio output
- Read-only signal level display

---

## Layer 3: Human Editing

*Depends on Layer 1. Parallel with Layer 2.*

### 3a. Module picker / menu

- UI for adding modules to the Surface from available types
- Browse module types with descriptions
- Configure bindings on add (which controls, which region)
- Parity: human can do everything the AI's `set_surface` can do

### 3b. Module configuration UI

- Select a module on the canvas → view/edit its bindings
- Rebind controls (change which params a Knob Group maps to)
- Remove modules from surface

### 3c. Pin-to-surface from Rack

- Pin icon/action on controls in Rack view
- Creates a pinned Knob Group module on the active track's Surface
- Cross-tab action: action in Rack, result on Surface

---

## Layer 4: Stage

*Depends on Layer 0. Parallel with everything else.*

### 4a. Stage / compact cards

- Visual upgrade to track selection
- Track identity at a glance: name, mute, visual character, agency
- Click to expand into per-track Surface
- Scannable at 8-12 tracks
- May evolve from existing track sidebar rather than replace it

---

## Layer 5: Visual Identity

*Depends on Layer 1. Parallel with Layers 2-4.*

### 5a. Visual identity primitives

- Track colour, weight, edge style, prominence as structured data
- Module rendering consumes visual context derived from track identity

### 5b. AI tools

- `set_track_identity`: set per-track visual properties through Score system
- `set_surface_score`: set project-level visual rules

### 5c. Module visual context

- Modules receive `ModuleVisualContext` from Score system
- Rendering adapts to track identity (colour, weight, edge style)

---

## Layer 6: Cleanup & Expansion

*After Layers 1-3 stable. Depends on Layer 2 for parity before deletion.*

### 6a. Delete old components

- `ExpandedTrack.tsx`, `InstrumentView.tsx`
- `SemanticControlsSection.tsx`, `SemanticInspector.tsx`
- Only after Step Grid, Chain Strip, and XY Pad modules provide equivalent coverage

### 6b. Update/close issues

- #559 → resolved (replace decision made)
- #560 → superseded (fixes absorbed into Layer 0)
- #376 → resolved by Layer 3
- #73 → update scope

### 6c. Additional modules (ongoing)

- ADSR Editor, Filter Display, Model Selector, Automation Lane, etc.
- Each follows the readiness rule from the north star RFC
- Build as canvas and module interface prove themselves

---

## Dependency Graph

```
Layer 0 (contract migration — one atomic merge)
  ├─ 0a engine types          ─┐
  ├─ 0b module registry        │
  ├─ 0c migration/session      │ all merge together
  ├─ 0d template migration     │
  ├─ 0e operation executor     │
  ├─ 0f AI tool schema         │
  ├─ 0g state compression      │
  ├─ 0h prompts/docs           │
  └─ 0i tests                 ─┘
       │
       ├── Layer 1 (canvas + knob group + macro knob + XY pad)
       │     ├── Layer 2 (step grid, chain strip, piano roll, meter) ← parallel
       │     ├── Layer 3 (human editing — picker, config, pin-from-rack) ← parallel
       │     └── Layer 5 (visual identity) ← parallel
       │
       ├── Layer 4 (stage) ← parallel with Layer 1+
       │
       └── Layer 6 (cleanup) ← after Layers 1-2 stable
```

## Agent Dispatch

- **Layer 0**: One agent (or a small coordinated team). This is the critical path — it must be correct. Review before merge.
- **Layer 1**: One agent. End-to-end proof. Needs Playwright visual verification.
- **Layer 2**: 2-3 agents in parallel (one per module).
- **Layer 3**: One agent. UI work with visual verification.
- **Layer 4**: One agent. Independent of module work.
- **Layer 5**: One agent. After canvas exists.
- **Layer 6**: One agent. After Layer 2 modules provide parity.
