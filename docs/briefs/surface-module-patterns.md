# Brief: Surface Module Interaction Patterns

Research-backed interaction patterns for Gluon's surface modules, drawn from established music software. Use this as a design reference when implementing or evolving module types.

## Step Grid

**Reference implementations:** Roland TR-808/909, Logic Pro Step Sequencer, FL Studio Channel Rack, Elektron Digitakt, Reason Redrum, iO-808 (web).

### Established patterns

| Gesture | Action | Source |
|---|---|---|
| Click | Toggle gate on/off | Universal |
| Click+drag horizontal | Paint on/off (matches first toggle direction) | FL Studio, Logic |
| Shift+click | Toggle accent | Modifier convention |
| Right-click or long-press | Step detail popover (velocity, probability, gate length) | Logic, Elektron |
| Scroll wheel on step | Adjust velocity | Power-user shortcut |

### Velocity models

| Level | Model | Used by |
|---|---|---|
| Binary | Gate on/off only | TR-808, basic web demos |
| 3-level | Soft/medium/hard via color intensity | Reason Redrum |
| Continuous | 0-127 per step, vertical drag or subrow | Logic Pro, Elektron |

**Recommendation:** Start with binary + accent (current), evolve to 3-level color coding. Drag-to-paint is the highest-impact missing interaction.

### Visual conventions
- Beat grouping every 4 steps (color alternation or separator)
- Playhead as full-column translucent highlight, not just a ring on one cell
- Step numbers visible but subtle (9px, low-contrast)
- Active steps: accent color at varying opacity (accent=0.7, normal=0.3, empty=neutral)

### What differentiates great from basic
- Drag-to-paint (first toggle determines direction)
- Per-step parameter access (even if just velocity + probability)
- Per-row resolution switching (polymetric: kick at 1/8, hi-hat at 1/32)
- Conditional trigs (Elektron: play every 2nd time, fill-only)

---

## XY Pad

**Reference implementations:** Korg Kaoss Pad, Ableton Live XY, TouchOSC, Bitwig XY Device, FL Studio X-Y Controller, Open Stage Control, Lemur.

### Established patterns

| Behavior | Standard | Notes |
|---|---|---|
| Touch/click | Absolute position jump | Universal default |
| Release | Hold last position | Dominant (Ableton, FL, Bitwig, TouchOSC) |
| Spring-to-center | Opt-in, per-axis | For pitch bend, spring back. For filter, hold. |
| Visual indicator | Filled dot (8-12px) on dark background | Universal |
| Axis labels | At edges, short parameter names | Required for legibility |

### Release behavior is the key decision
- **Hold** (default): finger lift preserves position. Best for filter, mix, character controls.
- **Spring**: returns to center on release. Best for pitch bend, momentary effects.
- **Per-axis**: X springs, Y holds (or vice versa). The AI should set this based on what the axes control.

### What differentiates great from basic
- Shift-to-lock-axis (constrain to horizontal or vertical)
- Double-tap to reset to default
- Smoothing/inertia on movement (FL Studio speed/acceleration)
- Physics simulation (Korg Modwave Kaoss Physics, Lemur MultiBall)
- Trail/history rendering
- Per-axis logarithmic scaling (essential for frequency)

### Compact module sizing
- Minimum useful: 80x80px (below this, precision is too poor)
- Recommended: 120x120px to 160x160px
- Aspect ratio: square is standard
- No grid lines at compact size (too noisy)
- Subtle crosshair lines from dot to edges (very low opacity, ~0.1)

---

## Piano Roll (compact/inline)

**Reference implementations:** Ableton Live clip mini-view, FL Studio Channel Rack, Bitwig clip preview, Auxy, Korg Gadget, Reason Player devices, Elektron, OP-1.

### Three categories of compact piano roll

| Category | Purpose | Editable? | Min height |
|---|---|---|---|
| Thumbnail preview | At-a-glance pattern identity | No — click to open full editor | ~50px |
| Compact inline editor | Quick edits without full editor | Yes, grid-quantized | ~160px (mouse), ~200px (touch) |
| Device-internal editor | Part of a device's function | Yes, with device constraints | Varies |

**Recommendation:** The Surface module should be a **thumbnail preview** at small sizes (6x2, 8x3) and optionally an **inline editor** at large sizes (12x4+, ~240px height). Grid quantization is mandatory for compact editing.

### Handling limited vertical space
- Auto-range to visible notes (current approach — correct)
- Diatonic mode: collapse non-scale rows when track has scale constraint (recovers ~42% vertical space)
- Minimum row height: 22px (mouse), 32px (touch) — below this, scroll instead of shrink

### Interaction (no tool switching — Auxy model)
- Tap empty cell: add note at grid position
- Tap existing note: select
- Drag note body: move (pitch + time, snapped)
- Drag note right edge: resize duration
- Right-click or long-press: delete
- Velocity via color intensity (read) or bottom-of-note drag bar (edit)
- No piano keyboard ruler in compact mode (too expensive at 24-40px width)

### Scale visualization
- Tint non-scale rows darker (FL Studio approach)
- In diatonic mode, hide non-scale rows entirely

---

## Chain Strip

**Reference implementations:** Ableton Live device chain, Guitar Rig (rack + sidebar), Bitwig device chain, Logic Pro insert slots, Line 6 Helix Edit, MOD Devices web UI.

### Layout
- **Horizontal strip, left to right** — industry standard for compact chain views
- Each processor is a pill-shaped badge: name (truncated ~12 chars) + bypass toggle
- Source node at left, output at right
- Arrow connectors between nodes (CSS triangles, not unicode)
- Color-code by processor role (tonal/spatial/generative)
- Horizontal scroll for long chains

### Bypass toggle
- Position: right side of each processor badge (power icon)
- Active: green/emerald icon, full opacity, role-colored border
- Bypassed: grey icon, reduced opacity (40%), strikethrough on name
- This matches Gluon's current implementation and industry convention

### Interaction
- Click processor badge: focus/select (open detail panel or scroll Rack view)
- Click bypass toggle: toggle enabled state (with undo)
- Drag to reorder (stretch goal — standard in Ableton, Guitar Rig, Bitwig)

### What NOT to show in the strip
- Individual parameter values (belongs in Rack view)
- Modulation routing (belongs in Patch view)
- Wet/dry mix (it's a per-processor parameter)
- Sidechain routing (at most a tiny badge icon)

---

## Sources

### Step Grid
- [iO-808](https://github.com/vincentriemer/io-808) — React/Redux/Web Audio TR-808
- Logic Pro Step Sequencer — edit modes, per-row resolution
- Elektron Analog Rytm — parameter locks, conditional trigs
- Reason Redrum — 3-level dynamics model
- FL Studio Channel Rack — drag-to-paint, graph editor

### XY Pad
- Korg Kaoss Pad — touch gate, hold, pad motion, Modwave physics
- Open Stage Control — most fully-specified open-source XY reference
- TouchOSC — absolute/relative modes, Z-axis, multi-touch
- FL Studio X-Y Controller — speed/acceleration inertia model

### Piano Roll
- Auxy — no-tool-switching compact editor (tap = add, drag = move)
- FL Studio Channel Rack — inline velocity graph
- Logic Pro iPad — touch gesture patterns

### Chain Strip
- Guitar Rig 7 Sidebar — compact signal flow overview with drag reorder
- Ableton Live — horizontal device chain with fold/unfold
- MOD Devices web UI — freeform canvas pedalboard (node graph equivalent)
