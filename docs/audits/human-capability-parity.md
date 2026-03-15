# Human Capability Parity Audit

**Date:** 2026-03-15
**Scope:** All 17 AI tool schemas vs. UI capabilities across the four canonical views
**Principle:** Anything the AI can do, the human should have a means to do (see `docs/principles/human-capability-parity.md`)

## Verification Matrix

Legend: `OK` = exposed and editable, `VIEW` = visible but not editable, `MISS` = not exposed in UI

### Sound Design (Source / Processor / Modulator Parameters)

| AI Capability | Tool | Surface | Rack | Patch | Tracker | Status |
|---|---|---|---|---|---|---|
| Move source parameter (brightness, richness, texture, pitch) | `move` | XY pad (timbre/morph only) | Sliders for all 4 controls | -- | -- | **OK** (Rack) |
| Move processor parameter | `move` (processorId) | -- | Sliders per processor | -- | -- | **OK** (Rack) |
| Move modulator parameter | `move` (modulatorId) | -- | Sliders per modulator | -- | -- | **OK** (Rack) |
| Smooth transition (`over` param) | `move` | -- | -- | -- | -- | **MISS** |
| Set source model/engine | `set_model` | -- | Mode selector dropdown | -- | -- | **OK** (Rack) |
| Set processor mode | `set_model` (processorId) | -- | Mode selector per processor | -- | -- | **OK** (Rack) |
| Set modulator mode | `set_model` (modulatorId) | -- | Mode selector per modulator | -- | -- | **OK** (Rack) |

### Signal Chain Management

| AI Capability | Tool | Surface | Rack | Patch | Tracker | Status |
|---|---|---|---|---|---|---|
| Add processor | `add_processor` | -- | Module Browser button | -- | -- | **OK** (Rack) |
| Remove processor | `remove_processor` | -- | Remove button per processor | -- | -- | **OK** (Rack) |
| Replace processor (atomic swap) | `replace_processor` | -- | -- | -- | -- | **MISS** |
| Add modulator | `add_modulator` | -- | Module Browser button | -- | -- | **OK** (Rack) |
| Remove modulator | `remove_modulator` | -- | Remove button per modulator | -- | -- | **OK** (Rack) |

### Modulation Routing

| AI Capability | Tool | Surface | Rack | Patch | Tracker | Status |
|---|---|---|---|---|---|---|
| Connect modulator to target | `connect_modulator` | -- | -- | -- | -- | **MISS** |
| Disconnect modulation route | `disconnect_modulator` | -- | Remove button on routing chip | -- | -- | **OK** (Rack) |
| Edit modulation depth | (via `connect_modulator`) | -- | DraggableNumber on chip | DraggableNumber overlay | -- | **OK** (Rack, Patch) |
| View modulation routes | -- | -- | Routing chips under modulators | Dashed lines with labels | -- | **OK** (Rack, Patch) |

### Sequencing (Events)

| AI Capability | Tool | Surface | Rack | Patch | Tracker | Status |
|---|---|---|---|---|---|---|
| Create trigger events | `sketch` | -- | Step grid toggle | -- | -- | **OK** (Surface step grid) |
| Create note events | `sketch` | -- | Keyboard piano (record) | -- | -- | **OK** (keyboard recording) |
| Create parameter events (param locks) | `sketch` | -- | -- | -- | -- | **MISS** |
| Edit event pitch | (inline) | -- | -- | -- | EditableCell | **OK** (Tracker) |
| Edit event velocity | (inline) | -- | -- | -- | EditableCell | **OK** (Tracker) |
| Edit event duration | (inline) | -- | -- | -- | EditableCell | **OK** (Tracker) |
| Edit param event value | (inline) | -- | -- | -- | EditableCell | **OK** (Tracker) |
| Delete events | (inline) | -- | -- | -- | Delete button per row | **OK** (Tracker) |
| View all event types | -- | -- | -- | -- | T/N/P glyphs, color-coded | **OK** (Tracker) |

### Pattern Transforms

| AI Capability | Tool | Surface | Rack | Patch | Tracker | Status |
|---|---|---|---|---|---|---|
| Rotate pattern | `transform` | -- | -- | -- | -- | **MISS** |
| Transpose pattern | `transform` | -- | -- | -- | -- | **MISS** |
| Reverse pattern | `transform` | -- | -- | -- | -- | **MISS** |
| Duplicate pattern | `transform` | -- | -- | -- | -- | **MISS** |
| Quantize events | (not AI tool) | -- | -- | -- | Quantize button | **OK** (Tracker, human-only) |

### Transport

| AI Capability | Tool | Surface | Rack | Patch | Tracker | Status |
|---|---|---|---|---|---|---|
| Set BPM | `set_transport` | Global top bar | Same | Same | Same | **OK** |
| Set swing | `set_transport` | Global top bar | Same | Same | Same | **OK** |
| Play/stop | `set_transport` | Global top bar (Space) | Same | Same | Same | **OK** |

### Track Metadata

| AI Capability | Tool | Surface | Rack | Patch | Tracker | Status |
|---|---|---|---|---|---|---|
| Set approval level | `mark_approved` | -- | -- | -- | -- | **OK** (TrackList cycle button) |
| Set importance | `set_importance` | -- | -- | -- | -- | **MISS** |
| Set musicalRole | `set_importance` | -- | -- | -- | -- | **MISS** |
| Toggle agency (AI access) | -- | Agency toggle in track header | Same | Same | Same | **OK** |
| Mute/Solo | -- | TrackList M/S buttons | Same | Same | Same | **OK** |
| Rename track | -- | TrackList double-click | Same | Same | Same | **OK** |

### Views & Surface

| AI Capability | Tool | Surface | Rack | Patch | Tracker | Status |
|---|---|---|---|---|---|---|
| Add sequencer view (step-grid) | `add_view` | + Step Grid button | -- | -- | -- | **OK** (Surface) |
| Remove sequencer view | `remove_view` | Remove button on view slot | -- | -- | -- | **OK** (Surface) |
| Set semantic controls | `set_surface` | -- | -- | -- | -- | **MISS** |
| Pin control to surface | `pin` | -- | -- | -- | -- | **MISS** |
| Unpin control from surface | `unpin` | -- | -- | -- | -- | **MISS** |
| Label XY axes | `label_axes` | -- | -- | -- | -- | **MISS** |

### AI-Only Capabilities (No Parity Required)

These tools are inherently AI-facing and have no meaningful human equivalent:

| AI Tool | Human Equivalent | Notes |
|---|---|---|
| `render` | Human presses play and listens | Direct audio perception |
| `listen` | Human listens to playback | Multimodal evaluation |
| `spectral` | Human ear / external analysis | Audio analysis |
| `dynamics` | Human ear / external analysis | Audio analysis |
| `rhythm` | Human ear / external analysis | Audio analysis |
| `raise_decision` | Human types in chat | The chat panel is the equivalent |

## Parity Gap Summary

### Critical Gaps (core musical operations with no UI path)

1. **Connect modulation routes** (`connect_modulator`): The human can view routes, edit depth, and disconnect them, but cannot create new routes. The only way to connect a modulator to a target is via AI. This is the single largest parity violation.

2. **Create parameter events / param locks** (`sketch` with `kind: "parameter"`): The step grid supports trigger gates and the keyboard piano supports note recording, but there is no UI to create per-step parameter automation. Parameter events are visible and editable in the Tracker once created by the AI, but cannot be created by the human.

3. **Pattern transforms** (`transform`): Rotate, transpose, reverse, and duplicate have no UI controls. These are common sequencer operations that should be accessible from the Tracker view.

### Moderate Gaps (metadata/configuration with no UI path)

4. **Set importance / musicalRole** (`set_importance`): No UI control exists. Approval level can be cycled in the TrackList, but importance and musicalRole are AI-only metadata.

5. **Set semantic controls** (`set_surface`): Semantic controls are displayed and interactive when defined, but only the AI can define them. The human cannot create, edit, or remove semantic control definitions.

6. **Pin/unpin controls** (`pin`, `unpin`): No UI to pin raw module controls to the surface.

7. **Label XY axes** (`label_axes`): No UI to set semantic labels for the XY pad axes.

### Minor Gaps (edge cases or convenience features)

8. **Replace processor** (`replace_processor`): Atomic swap has no UI equivalent. The human must remove and re-add manually (two operations instead of one). Low severity since the result is identical.

9. **Smooth transitions** (`move` with `over`): The AI can specify timed parameter ramps. Human slider interaction is immediate only. Low severity since smooth transitions are an enhancement, not a distinct capability.

## View Coverage Summary

| View | Primary Role | Coverage |
|---|---|---|
| **Surface** | Curated interaction surface | Semantic knobs (display), step grid, XY pad, agency toggle. Expected to lag per doctrine -- gaps here are not parity bugs. |
| **Rack** | Parameter + chain ground truth | Excellent. All module parameters, model selection, add/remove modules, modulation depth editing, route disconnection. Missing: route creation, replace processor. |
| **Patch** | Signal flow ground truth | Read-only visualization of chain topology and modulation routing. Modulation depth is editable. No add/remove/connect operations. |
| **Tracker** | Event ground truth | Excellent for editing existing events. All event types visible and editable inline. Missing: event creation (except via step grid triggers and keyboard recording), pattern transforms. |

## Recommendations

Priority order for follow-up issues:

1. **Modulation route creation UI** -- Add a "connect" gesture to the Rack view (e.g., drag from modulator chip to parameter, or a dropdown on the modulator section). This is the only core musical operation entirely blocked for humans.

2. **Pattern transform buttons** -- Add rotate/transpose/reverse/duplicate to the Tracker view toolbar, next to the existing Quantize button.

3. **Parameter event creation** -- Add a mechanism to create param lock events, either via the step grid (shift+click to open a param lock editor) or the Tracker view.

4. **Importance/role UI** -- Add importance slider and musicalRole text field to the track metadata area (TrackList or expanded track header).

5. **Surface authoring** -- Lower priority since Surface view is expected to be AI-curated, but consider a simple "edit surface" panel for power users.
