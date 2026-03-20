# UI Component Inventory

> Step 2 of the UI redesign process. Catalogs every element each screen needs to display, mapped to the actual codebase implementation. Use this to produce pixel-precise design specs in Step 3.

---

## Shared Elements

### Top Bar

**AppShell** (`src/ui/AppShell.tsx`) — Main layout container. Renders the global top bar, body content (view-switched), and footer. Owns all top-level state orchestration.

| Component | File | What it renders |
|-----------|------|-----------------|
| **ProjectMenu** | `ProjectMenu.tsx` | Dropdown: SaveIndicator + project name + chevron. Menu: rename, new, duplicate, export (JSON + WAV), import, project list, delete. |
| **ViewToggle** | `ViewToggle.tsx` | 5-tab button group: Chat, Surface, Rack, Patch, Tracker. Active tab: amber-400/15 bg + amber-400 text. |
| **TransportStrip** | `TransportStrip.tsx` | Play/Pause, Stop, Record (pulsing), Loop (locked in pattern mode), Pattern/Song toggle. Bar:beat display (monospace). BPM (DraggableNumber) + TimeSignatureControl. Swing % (DraggableNumber). MetronomeButton with volume context menu. |
| **ABControls** | `TransportStrip.tsx` | Inactive: single "A/B" button. Active: A + B toggles + X clear button. |
| **UndoButton** | `UndoButton.tsx` | Two-part: main undo + history dropdown. Dropdown shows reversed undo stack with descriptions + timestamps. |
| **RedoButton** | `RedoButton.tsx` | Single redo button with description tooltip. |
| **ModelStatusIndicator** | `ModelStatusIndicator.tsx` | Colored dot + label. States: teal "AI Connected", zinc "No AI", amber "Manual mode", teal+amber ring "AI Connected (no audio eval)". |

**Current top bar layout:** Left zone (ProjectMenu, ViewToggle, TransportStrip) + Right zone (UndoButton, RedoButton, ABControls).

**New layout target:** `gluon | CHAT | Surface Rack Patch Tracker ... | > ■ | 1:01 128 BPM |▌▌ ... ● Gluon AI`

### Track Sidebar

**TrackList** (`src/ui/TrackList.tsx`) — 48px wide sidebar. Header: "TRACKS" label + "+ Track" / "+ Bus" buttons (disabled at 16 tracks). Scrollable track rows. Anchored master bus at bottom.

**TrackRow** (`src/ui/TrackRow.tsx`) — Two variants:

| Variant | Used in | Renders |
|---------|---------|---------|
| **default** | Rack, Patch, Tracker | Activity pulse overlay. Expand chevron. Vertical level meter. Thumbprint dot (colored circle for audio, gray square for bus). Track label (editable on double-click, max 20 chars). M/S/approval buttons. Expanded: protection level, importance (Low/Mid/High), musical role (editable), sends. |
| **stage** | Surface | Compact identity card. Colored accent bar. Track name + mute/solo indicators. Role badge + module count. |

**Agency/Approval dots** cycle: `○` exploratory → `♡` liked → `◉` approved → `⚓` anchor. Each with distinct color (zinc/amber/teal/purple).

**Activity pulse:** amber-400/15 overlay for 2s after AI action on track.

**Sends section** (expanded): List of bus sends with level slider (0-1) + remove button. Add send dropdown showing available buses.

**TrackLevelMeter** (`TrackLevelMeter.tsx`): Vertical 1px bar (in sidebar) or horizontal 6px bar. Green→amber→red gradient.

**Master bus:** Always anchored at bottom. Volume slider + stereo PeakMeter (canvas-based, 20px wide, L/R bars with peak hold).

### Footer Bar

Integrated in AppShell (28px tall, `border-t border-zinc-700/40`):

| Element | Renders |
|---------|---------|
| AudioLoadMeter | "CPU" label + 40px bar (green→amber→red) |
| Playback position | bar:beat (monospace, zinc-500) |
| Transport mode | "Song" or "Pattern" (uppercase, 11px) |
| Track count | "N tracks" (11px) |
| PeakMeter | Stereo meter (canvas) |
| Chat toggle | Chevron button (direction indicates open/closed) |
| AI activity dot | 2x2, violet-400, pulsing when thinking/listening |

---

## Chat Tab

### Core Components

**ChatSidebar** (`src/ui/ChatSidebar.tsx`) — Currently a collapsible right sidebar with drag-to-resize. Contains header, messages panel, and composer. Shows setup screen when no API keys. Will become the full Chat tab view.

**ChatMessages** (`src/ui/ChatMessages.tsx`) — Renders conversation history. Props: messages, isThinking, isListening, streamingText, streamingLogEntries, streamingRejections, reactions, undoStack, tracks.

Sub-components within messages:
- **ScopeBadge** — Shows which tracks AI is targeting
- **ReactionControls** — Undo, approve/reject buttons, suggested musical chips
- **ThinkingDots** — Animated indicator (thinking/listening/applying)

**ChatComposer** (`src/ui/ChatComposer.tsx`) — Auto-growing textarea (max 150px). Enter to send, Shift+Enter for newline. Up-arrow recalls last message. Number keys 1-4 send follow-up chips. Two variants: sidebar (bright) / footer (muted).

### Message Types

```typescript
interface ChatMessage {
  role: 'human' | 'ai' | 'system';
  text: string;
  timestamp: number;
  actions?: ActionLogEntry[];      // Executed actions with diffs
  toolCalls?: ToolCallEntry[];     // Raw tool calls
  listenEvents?: ListenEvent[];    // Audio playback cards
  undoStackRange?: { start, end }; // Undo scope
  scopeTracks?: { trackId, name }[];
  suggestedReactions?: string[];   // AI-provided follow-up chips
}
```

### Action Display Components

**ActionDiffView** (`ActionDiffView.tsx`) — Renders diffs for each ActionLogEntry. Handles 15+ diff kinds: param-change, model-change, processor-add/remove/replace, pattern-change, transport-change, master-change, modulator-add/remove, modulation-connect/disconnect, transform, surface-set/pin/unpin/label-axes, approval-change.

**ToolCallsView** (`ToolCallsView.tsx`) — Collapsible tool call summary. Groups consecutive same-tool calls. Friendly name mapping (e.g., "move" → "Adjusted parameter"). Hides scaffolding tools.

**ListenEventView** (`ListenEventView.tsx`) — Audio playback cards. Each card: play/pause toggle, progress bar, duration, scope badge (track IDs or "full mix"), diff badge (before/after), evaluation summary (120 char max).

**TurnSummaryCard** (`TurnSummaryCard.tsx`) — "Changed" summary + "Why" rationale + follow-up action chips (max 4, always includes "undo"). Derives context-aware follow-ups from action categories.

### AI Interaction Components

**PromptStarters** (`PromptStarters.tsx`) — Context-aware starter chips. Three states: empty project ("Start a dark techno kick"), tracks exist ("Make the hats looser"), resume ("Remind me where we left off").

**OpenDecisionsPanel** (`OpenDecisionsPanel.tsx`) — Card-based UI for pending AI decisions. Shows question + context + option buttons with semantic coloring (allow→green, deny→red).

### Configuration Components

**ApiKeySetup** (`ApiKeySetup.tsx`) — Onboarding screen. Provider tabs (Gemini/OpenAI). "Continue without AI" fallback.

**ApiKeyInput** (`ApiKeyInput.tsx`) — Collapsed "API Connected" button (when configured) or expanded form. Gemini + OpenAI key fields. Listener provider selector.

### Utilities

- **inlineMarkdown** (`inlineMarkdown.tsx`) — Renders bold, italic, code, links in chat text
- **getPhaseLabel()** — Derives "Listening", "Applying N changes", "Thinking"
- **deriveScopeTracks()** — Extracts target tracks from action log
- **selectStarters()** — Chooses prompt starters based on project state

### NEW Elements (not yet implemented)

| Element | Description |
|---------|-------------|
| **Live Controls panel** | Right-side panel. AI surfaces transient modules (knob groups, step grids). "Add to Surface" promotes permanently. Empty state: "Controls appear here as the AI suggests them." |
| **Interleaved tool use** | AI narrates → tool-group blocks → more narration. Tool blocks: color-coded one-line (amber=source, sky=processor, emerald=pattern, grey=param), expandable, per-action undo on hover. |
| **Proper composer** | Send button → stop button (red square) when streaming. |

---

## Surface Tab

### Main Canvas

**SurfaceCanvas** (`src/ui/surface/SurfaceCanvas.tsx`) — react-grid-layout grid (12 columns, 60px rows, 8px margins). Renders modules from `track.surface.modules[]`. ResizeObserver for responsive layout. Module selection triggers config panel. ModulePicker popup in bottom-right.

### Module Types (8)

| Type | Component | File | Bindings | Default Size | Description |
|------|-----------|------|----------|-------------|-------------|
| `knob-group` | KnobGroupModule | `surface/KnobGroupModule.tsx` | control (mult.) | 4x2 | Bank of labelled Knob components (36px) |
| `macro-knob` | MacroKnobModule | `surface/MacroKnobModule.tsx` | control | 2x2 | Single Knob (48px) with weighted multi-param SemanticControlDef |
| `xy-pad` | XYPadModule | `surface/XYPadModule.tsx` | x-axis, y-axis | 4x4 | Canvas 2D control. Grid lines, crosshair, radial glow, accent-colored cursor |
| `step-grid` | StepGridModule | `surface/StepGridModule.tsx` | region | 12x3 | TR-style read-only gate/accent visualization (16 steps) |
| `chain-strip` | ChainStripModule | `surface/ChainStripModule.tsx` | chain | 12x2 | Horizontal signal flow: Source → Processors → Out, with bypass toggles |
| `piano-roll` | PianoRollModule | `surface/PianoRollModule.tsx` | region | 8x4 | Canvas pitch x time display. Auto-zoom pitch range. Velocity-mapped alpha |
| `level-meter` | LevelMeterModule | `surface/LevelMeterModule.tsx` | track | 2x4 | dB scale meter. **Hidden** — pending real audio wiring (#1152) |
| `pad-grid` | PadGridModule | `surface/PadGridModule.tsx` | kit | 6x4 | 4-column drum pad grid. Activity indicators from pattern triggers |

All modules implement `ModuleRendererProps` interface: `{ module, track, visualContext?, onParamChange?, onProcessorParamChange?, onInteractionStart?, onInteractionEnd?, onToggleProcessorEnabled? }`.

### Supporting Components

**ModulePicker** (`surface/ModulePicker.tsx`) — Popup menu showing pickable module defs (excludes hidden). Seeds default bindings on selection. Click-outside or Escape to close.

**ModuleConfigPanel** (`surface/ModuleConfigPanel.tsx`) — Right sidebar (272px). Label editor. Binding target dropdowns (grouped: Source params, Processor params). Remove button.

**PlaceholderModule** (`surface/PlaceholderModule.tsx`) — Fallback for unknown module types.

### Visual Identity System

**visual-utils.ts** — HSB→HSL/RGB conversion. `getAccentColor()`, `getModuleContainerStyle()` (borderColor, borderWidth from weight, opacity from prominence, edge style variations: crisp/soft/glow).

**visual-identity.ts** — `getDefaultVisualIdentity(trackIndex)`: golden angle (137.508 deg) hue distribution, saturation 0.6, brightness 0.7. `deriveModuleVisualContext(track, trackIndex)`: produces ModuleVisualContext consumed by all modules.

**semantic-utils.ts** — `computeSemanticValue()`: weighted average with transforms (linear/inverse/bipolar). `computeSemanticRawUpdates()`: inverse mapping for macro knob changes.

### Data Types

```typescript
interface SurfaceModule {
  type: string;           // 'knob-group', 'xy-pad', etc.
  id: string;
  label: string;
  bindings: ModuleBinding[];  // { role, trackId, target }
  position: { x, y, w, h };  // Grid placement
  config: Record<string, unknown>;
}

interface TrackSurface {
  modules: SurfaceModule[];
  thumbprint: ThumbprintConfig;  // Visual branding
}

interface ModuleVisualContext {
  trackColour: { hue, saturation, brightness };
  weight: number;       // 0-1, border thickness
  edgeStyle: 'crisp' | 'soft' | 'glow';
  prominence: number;   // 0-1, opacity modulation
}
```

### Surface Templates

**surface-templates.ts** — Auto-applied baseline surfaces for known processor chains: `plaits`, `plaits:rings`, `plaits:clouds`, `plaits:rings:clouds`, `drum-rack`. Applied on chain configuration changes with undo support.

### Stage Cards (TrackRow variant='stage')

Compact identity cards in track sidebar: colored accent bar, track name, role badge, module count.

---

## Rack Tab

### Main View

**RackView** (`src/ui/RackView.tsx`) — Eurorack-style vertical module grid. Signal flow: Source → Processors → Output. Contains ChainStrip (top), ModulePanel grid, ModuleBrowser slide-out.

### Module Panels

**ModulePanel** (`src/ui/ModulePanel.tsx`) — Fixed height 572px (2U Eurorack). Three accent colors: amber (source), sky (processor), violet (modulator).

**Header:** Bypass dot (clickable) + module label (strikethrough if bypassed) + swap button.

**Body:** Controls partitioned into tiers:
- **Large knobs** (52px) — primary controls (timbre, morph, threshold, etc.)
- **Medium knobs** (42px) — tone/character controls
- **Small knobs** (32px) — attenuverters, extended params
- **Boolean controls** — ON/OFF toggles
- **Discrete controls** — cycle buttons for enum/numeric values

**Knob** (`src/ui/Knob.tsx`) — SVG arc rendering (135 deg start, 270 deg sweep). Modulation depth arcs (Bitwig-style, stacked inward). Interaction: pointer drag (200px = full range), Shift+Click opens RampPopover, keyboard arrows +/- 0.01/0.1. DisplayMapping for human-readable values (Hz, dB, ms, %).

**Sub-components in ModulePanel:**
- `ModeSelector` — Engine/model dropdown
- `ToggleControl` — ON/OFF button
- `DiscreteSelector` — Cycle buttons for enum values
- `PinButton` — Pin-to-Surface (appears on knob hover)

### Signal Chain

**ChainStrip** (`src/ui/ChainStrip.tsx`) — Horizontal badges: Source (amber) → Processors (sky) → Modulators (violet). Clickable badges. Bypassed processors shown with strikethrough + opacity.

### Modulation

**RoutingChips** (`src/ui/RoutingChip.tsx`) — Inside modulator panels. Each chip: target label + draggable depth (-1.0 to +1.0). Delete/Backspace removes. "Edit routes in Patch" navigation link.

Modulation arcs on knobs: 6 distinct colors assigned cyclically per modulator. Shows modulation range from current value to value+depth.

### Module Browser

**ModuleBrowser** (`src/ui/ModuleBrowser.tsx`) — Slide-out panel. Processors (sky, max 2): rings, clouds, ripples, eq, compressor, stereo, chorus, distortion, warps, elements, beads, frames. Modulators (violet, max 2): tides, marbles. Replace mode for swapping processors.

### Supporting Components

**DraggableNumber** (`DraggableNumber.tsx`) — Drag vertical to adjust, click to enter edit mode with text input. Used in transport BPM, modulation depths, ramp targets.

**RampPopover** (`RampPopover.tsx`) — Shift+Click on knobs. Current value, target value, duration presets (0.5s, 1s, 2s, 5s). "Start Ramp" button.

### Control Building

**module-controls.ts** — `getSourceControls(track)`, `getProcessorControls(proc)`, `getModulatorControls(mod)`: Maps instrument registry definitions → ControlDef[] for ModulePanel rendering.

**format-display-value.ts** — `formatDisplayValue(normalized, mapping)`: Maps 0-1 through DisplayMapping (linear/log/dB/percent) → "440 Hz", "-6.0 dB", "50%".

---

## Patch Tab

### Main View

**PatchView** (`src/ui/PatchView.tsx`) — SVG canvas with nodes, edges, and interactive routing.

**State:** selectedNodeId, selectedEdgeId, browserOpen, dragState (cable routing), hoveredPortKey, contextMenu, nodeOffsets (user-dragged positions), panZoom (zoom 0.25-2.0, panX, panY).

**Nodes:** Source, Processors, Modulators, Output terminal, Send destinations. Each rendered as a NodeCard.

**Layout:** Source at left → Processors horizontal → Output terminal. Modulators centered below.

### Node Types

| Kind | Color | Ports |
|------|-------|-------|
| source | amber | Inputs: V/OCT, TRIGGER, LEVEL, MODEL CV, TIMBRE CV, FM CV, MORPH CV, HARMONICS CV. Outputs: OUT, AUX |
| processor | violet | Varies by type (rings, clouds, etc. — from port-registry.ts) |
| modulator | cyan | Tides: V/OCT, FM, SLOPE, SMOOTH, SHAPE, TRIG, CLOCK inputs. OUT 1-4 outputs |
| output | — | Small circle terminal node |
| send-dest | — | Bus send routing target |

**Port signal types:** audio (amber), cv (emerald), gate (rose).

### Edges

**AudioEdge** — SVG line from audio output to next audio input. Color from signal type.

**ModEdge** — SVG bezier curve from modulator output to target port. Dashed line. Label at midpoint showing target param. Interactive depth slider (DraggableNumber).

### Interactions

- Drag nodes to reposition
- Drag from modulator output port to modulation target port (cable routing)
- Mouse wheel / Space+drag for pan/zoom
- Delete/Backspace removes selected node/edge
- Right-click edge for context menu (remove)
- Click node to show detail panel

### Constants

NODE_W=180px, NODE_HEADER_H=40px, PORT_ROW_H=22px, NODE_GAP=80px, PORT_CIRCLE_R=5px, OUTPUT_R=18px.

---

## Tracker Tab

### Main View

**TrackerView** (`src/ui/TrackerView.tsx`) — Contains toolbar, pattern tabs, sequence editor, tracker grid, automation panel.

**Toolbar:** Pattern length buttons (4, 8, 16, 32, 64). Operations: Rotate, Transpose, Reverse, Duplicate, Quantize, Clear.

**Pattern tabs:** Clickable tabs for each pattern in track. Context menu: rename, duplicate, delete. Active pattern highlighted.

### Tracker Grid

**Tracker** (`src/ui/Tracker.tsx`) — Polyphonic note grid.

**Column layout:** Pos | Ch1..Ch4 | Vel | Dur | FX1..FXN

**Per-row (SlotRow):** Step number + up to 4 polyphonic note columns + velocity + duration + parameter columns.

**Cell types:**
- **NoteColumnCell** — Pitch display "C-4" format. Editable via keyboard (A-G, #/-). Trigger events show "TRG" in amber.
- **FxCell** — Parameter value 0-100. Blue colored.
- **EditableCell** — Inline editor. Click/double-click to edit, Enter to commit, Escape to cancel.

**Keyboard interactions:** Arrow keys navigate, Shift+Arrow extends selection, Enter edits, Delete removes, Cmd+C/X/V copy/cut/paste, Cmd+Shift+Up/Down transpose, piano keys (A-G) enter notes, -/= change octave.

**Row styling:** Emerald bg if has notes/triggers, zinc if empty. Amber for playhead, indigo for selection, sky for cursor. Alternating beat tint.

### Drum Lane Tracker

**DrumLaneTracker** (`src/ui/DrumLaneTracker.tsx`) — Alternative grid for drum-rack tracks. Table: Step | Pad1 | Pad2 | ... | PadN. Grid characters for velocity levels. Read-only.

### Sequence Editor

**SequenceEditor** (`src/ui/SequenceEditor.tsx`) — Song mode arrangement. Vertical scrollable slot list. Per-slot: playhead indicator, zero-padded index (Renoise-style), pattern label (cyan if reused), reorder Up/Down buttons, delete. Keyboard: Delete removes, Alt+Up/Down reorders.

### Automation

**AutomationPanel** (`src/ui/AutomationPanel.tsx`) — Collapsible. Dropdown selector for parameter. Badge showing param count.

**AutomationLane** (`src/ui/AutomationLane.tsx`) — SVG breakpoint envelope editor. Grid background, value axis (0-1), time axis with beat markers. Interpolation curves: step, linear, curve (with tension). Draggable breakpoints. Click to add, right-click to delete.

### Step Grid (Legacy)

**StepGrid** (`src/ui/StepGrid.tsx`) — 16-step horizontal grid. Click toggle gate, right-click toggle accent. Beat markers every 4 steps. Param lock indicator (blue dot). Playhead ring.

### Event Types

```typescript
type MusicalEvent = NoteEvent | TriggerEvent | ParameterEvent;

// NoteEvent: { kind: 'note', at, pitch (MIDI 0-127), velocity (0-1), duration }
// TriggerEvent: { kind: 'trigger', at, velocity?, accent?, gate?, padId? }
// ParameterEvent: { kind: 'parameter', at, controlId, value, interpolation?, tension? }
```

**Pattern:** `{ id, kind: 'pattern', duration (beats), name?, events: MusicalEvent[] }`

**PatternRef:** `{ patternId, automation?: SequenceAutomationLane[] }` — sequence slot pointing to a pattern.

---

## NEW Elements (to be designed)

These exist in the approved mockup but not yet in the codebase:

| Element | Tab | Description |
|---------|-----|-------------|
| **Live Controls panel** | Chat | Right-side panel. AI surfaces transient modules contextually. "Add to Surface" promotes. Empty state text. |
| **Floating dock** | Surface, Rack, Patch, Tracker | Bottom-right card. AI presence dot, status (Idle/Working), last action summary, Cmd+K button. NOT on Chat tab. |
| **Command lens (Cmd+K)** | All | Spotlight-style overlay. Recent conversation + "Open full chat" escape hatch. |
| **Quick-flip button** | Chat | Bottom-right "Instrument" button with backtick hint. Redundant with tabs. |
| **Interleaved tool use** | Chat | AI narrates + tool-group blocks inline. Color-coded by type. Expandable. Per-action undo on hover. |
| **Tabs in top bar** | All | Five-tab always-visible nav: `| CHAT | Surface Rack Patch Tracker`. Chat separated by dividers. |

---

## Design Token Reference

From `src/index.css`:

**Fonts:** Syne (headings/UI), DM Mono (data/values)

**Colors (warm zinc):** Custom zinc scale from zinc-50 (#fafaf9) to zinc-950 (#0c0a09). Accent: amber-400. AI: violet-400. Status: teal (connected), amber (warning), rose (error), emerald (success).

**Sizing patterns:** 11px-12px for labels, 10px-9px for secondary text. Heights follow 6px baseline (h-6, h-7, h-9).
