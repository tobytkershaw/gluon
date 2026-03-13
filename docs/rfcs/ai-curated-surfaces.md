# Gluon RFC: AI-Curated Surfaces

## Status

Draft RFC for architectural alignment.

Related docs:

- `docs/rfcs/canonical-musical-model.md` — canonical data model (semantic controls, adapters, control schema)
- `docs/rfcs/sequencer-view-layer.md` — sequencer views as addable projections (same pattern applied to sequencing)
- `docs/rfcs/phase4a.md` — constrained patch chains (the module expansion this RFC builds on top of)
- `docs/principles/ai-interface-design-principles.md` — AI interface posture
- `docs/gluon-interaction-protocol-v05.md` — interaction protocol (v0.5.0)

---

## Product Thesis

Every software instrument faces the same UX problem: more modules and parameters mean more power, but also more surface to manage. Traditional solutions all degrade at scale. Showing everything overwhelms. Pages and tabs hide things. Presets discourage exploration.

Gluon has something those instruments don't: an AI that understands the instrument. This changes the design question from "how do we show all the parameters?" to **"what does the human need to see and touch directly, given that the AI handles the rest?"**

The core idea of this RFC: **the AI's toolkit includes UI curation, not just parameter manipulation.** The AI doesn't just play the instrument — it also sets up the mixing desk for the human.

This extends the AI interface design principles naturally. The AI already reasons about music through semantic controls, acts through structured operations, and respects the human's authority. UI curation is a new category of structured operation, subject to the same rules: the AI acts, the change is immediate, undo reverts.

### This RFC produces two outputs

**This document** is the human-facing specification. It defines the layered UI model, the semantic surface abstraction, the AI's UI operation vocabulary, type definitions, constraints, and migration strategy.

**An AI-facing extension to the contract document** (generated from this RFC) adds the UI curation tools to the agent's action space. It contains only: the new tool declarations, the surface state format the agent receives, worked examples of valid surface proposals, and the rules for when the agent should and should not propose surface changes.

---

## How to Read This Document

This RFC has two layers:

**The implementation plan (Part 1)** — what to build. Centered on the three-layer UI model (Stage, Semantic Surface, Deep View), semantic control definitions, the AI's UI operation vocabulary, and the compact card design. This is the working model for Phase 4A and beyond.

**The architectural north star (Part 2)** — where the surface model is headed. Adaptive surfaces that learn from usage patterns, collaborative surface editing in multi-user sessions, and surface templates that transfer between projects. Explicitly deferred.

The implementation plan is designed so that every piece of it migrates cleanly into the north-star architecture when the time comes.

---

## Design Principles

### 1. The AI sets up the instrument, the human keeps control

The AI configures both the sound and the surface as part of the same action. When it adds Rings to a voice, it also sets up the controls for Rings. These are part of the same gesture — the musician doesn't want to approve a processor and then separately approve its knobs.

What this means in practice:
- A stable default semantic surface per voice, set when the voice/chain is created
- Surface changes apply immediately and are undoable, just like all other AI actions
- Constant spontaneous rearrangement is not allowed — surfaces change when chains change, not continuously
- Some adaptive behaviour (highlighting what just changed) is allowed

The user should feel the UI is evolving with them, not shape-shifting under them.

### 2. Transparency is one click or one question away

Semantic controls are only trustworthy if the user can inspect what they actually do. If one patch's "Space" mostly changes Clouds mix and another's mostly changes stereo width, that can be fine — but only if the mapping is legible and the behaviour feels musically consistent enough.

What makes a semantic control feel stable across patches:
- Stable naming conventions (defined per-engine-chain, not per-patch)
- Visible mapping on demand (inspect any semantic control to see its weights)
- AI-curated but user-overridable behaviour

### 3. Small vocabulary, rich composition

A small set of UI primitives that the AI can assemble per-instrument, rather than bespoke layouts for every module combination. The hard design work shifts from "layout all the parameters" to "what are the atomic UI building blocks the AI can compose?"

### 4. Compact cards are identity markers, not control surfaces

The overview layer must stay clean at 8-12 voices. If compact cards try to do too much, the whole system collapses into mini-dashboard clutter.

### 5. Same rules as parameter control

UI curation follows the same collaboration contract as parameter manipulation:
- AI acts when asked
- Human's hands win
- Undo reverts UI changes too

### 6. The abstraction earns its place

Semantic controls are not an abstraction we impose on day one. A voice with only Plaits (4 params) doesn't need semantic aggregation — it needs clear labels. Semantic surfaces earn their place when a voice has a chain with enough parameters that showing them all is worse than showing a curated subset. Single-module voices can skip straight to raw controls.

---

## Part 1: Implementation Plan (Build Now)

### The Three-Layer Model

The UI is organised into three layers of increasing detail. Each layer has a clear purpose, a defined information density, and rules about what the AI can change.

#### Layer 1: The Stage (always visible)

A compact overview of the whole project — what's making sound right now.

Each voice is a **compact card** showing exactly:
- **Name** — KICK, LEAD, etc. (from voice label)
- **Mute state** — dimmed if muted
- **Thumbprint** — a single visual identity marker (see Thumbprint Design below)
- **Agency dot** — teal indicator if AI has permission
- **Activity pulse** — subtle glow when the AI just changed something on this voice, fades over ~2 seconds

Nothing else. No mini-knobs, no parameter values, no chain detail, no pinned controls. The compact card is an identity marker. Click to expand, or tell the AI to work on it.

**Density constraint**: The stage must remain scannable at 8-12 voices. This means compact cards must work at roughly 60-80px wide. If the design requires more space per card, reduce the maximum voice count visible without scrolling.

**Selection**: Clicking a compact card expands it into the active voice panel (Layer 2). The previously active voice collapses back to a compact card. Only one voice is expanded at a time.

#### Layer 2: The Semantic Surface (per-voice, when expanded)

The expanded view for the currently active voice. Shows curated controls that give the human meaningful handles over the voice's sound.

**For single-module voices (no chain):** Show the module's raw controls directly. There's no value in aggregating 4 Plaits parameters into 2 semantic dimensions — it just adds indirection. The raw controls already have semantic labels (`brightness`, `texture`, `richness`, `pitch`) from the instrument registry.

**For chain voices (source + processors):** Show 2-4 semantic controls that aggregate across the chain, plus any user-pinned raw controls.

In both cases, the expanded view also shows:
- **Chain strip** — signal flow diagram (source → processors), visible only for chain voices
- **Step grid** — the voice's pattern
- **Transport controls** — play/stop, BPM (shared, not per-voice)
- **XY pad** — axes labelled by the two most relevant controls/dimensions for this voice
- **Pinned controls** — raw parameters the human has surfaced, visually distinct from semantic controls

**Information budget for the expanded view**: semantic/raw controls + chain strip + step grid + XY pad. This is the working surface. It should feel focused, not busy.

#### Layer 3: The Deep View (on demand)

Full parameter listing, per module, with raw values and patch routing. Accessed by:
- Double-clicking the expanded voice card
- Asking the AI ("show me all the Rings parameters")
- A disclosure toggle on the chain strip (tap a module node)

The deep view shows every control on every module in the chain, grouped by module. Controls show their current value, provenance (human/AI/default), and binding path. This is the escape hatch for power users and the inspection tool for building trust in semantic controls.

From the deep view, the human can:
- Pin any raw control to the semantic surface (drag or click-to-pin)
- See semantic control weights ("Brightness = Plaits timbre × 0.6 + Rings brightness × 0.3 + Clouds feedback × 0.1")
- Override a semantic mapping weight
- Bypass or remove processors

---

### Semantic Controls

A semantic control is a virtual control that maps to weighted contributions from multiple raw controls across a voice's module chain. It is the key abstraction that makes AI-curated surfaces work.

#### Type Definition

```ts
type SemanticTransform = 'linear' | 'inverse' | 'bipolar';

interface SemanticControlWeight {
  moduleId: string;           // which module in the chain
  controlId: string;          // which raw control on that module
  weight: number;             // 0.0-1.0, weights sum to 1.0 within a semantic control
  transform: SemanticTransform; // how the semantic value maps to the raw value
}

interface SemanticControlDef {
  id: string;                 // "brightness", "space", "movement"
  name: string;               // "Brightness", "Space", "Movement"
  semanticRole: SemanticRole | null;
  description: string;        // Musical meaning, for AI and human tooltips
  weights: SemanticControlWeight[];
  range: { min: number; max: number; default: number };
}
```

#### Mapping Behaviour

When the user moves a semantic control to value `v`:
1. For each weight entry, compute the raw delta based on the transform type:
   - `linear`: `delta = (v - 0.5) * weight * 2` — raw parameter moves in the same direction
   - `inverse`: `delta = -(v - 0.5) * weight * 2` — raw parameter moves in the opposite direction
   - `bipolar`: `delta = (v - 0.5) * weight * 2`, but the raw parameter is centred at 0.5 regardless of its base value
2. Compute `target = baseValue + delta`
3. Clamp each target to the raw control's range
4. Apply via the existing `applyControlChanges` adapter path

The base values are the raw parameters' current positions when the semantic control was last "zeroed" (set to 0.5).

**Why transforms matter**: A "Space" semantic control might need to *increase* Clouds mix while *decreasing* a dry/wet balance, or a "Brightness" control might need to close a filter (inverse) while opening harmonics (linear). Without `inverse`, certain musically natural mappings would require negative weights, which break the "weights sum to 1.0" invariant and are confusing to inspect.

**Why only three transforms**: More complex curves (exponential, S-curve) are more expressive but harder to predict and inspect. These three cover the common cases. If users consistently find the mapping unintuitive for specific combinations, add curve types later.

#### Stability Rules

1. **Semantic controls are defined per-engine-chain configuration, not per-patch.** If you have a Plaits → Rings → Clouds chain, "Space" always maps to the same raw controls with the same weights. The values differ between patches, the mapping doesn't.

2. **The mapping is authored when the chain is built.** The AI proposes a semantic surface when a processor is added to a chain. The mapping is then stable until the chain structure changes (a module is added, removed, or replaced).

3. **The human can override weights.** From the deep view, the human can adjust how much a raw control contributes to a semantic dimension. This override persists until the chain structure changes.

4. **The AI cannot redefine a semantic control's mapping without a chain change.** This is a hard rule. The AI's freedom is in proposing the initial mapping and in suggesting value changes — not in silently remapping what "Brightness" means.

#### Baseline Surfaces from the Registry

If a voice chain matches a known engine/chain configuration, Gluon should generate a deterministic default semantic surface from the instrument registry without the AI inventing one from scratch. This is important for predictability: the "Plaits → Rings → Clouds" surface should be the same every time a user builds that chain, not dependent on what the AI happens to propose in a given session.

```ts
interface ChainSurfaceTemplate {
  chainSignature: string;        // e.g. "plaits:rings:clouds" — source:processor:processor
  semanticControls: SemanticControlDef[];
  xyAxes: { x: string; y: string };
}
```

The registry stores surface templates for known chain configurations. When a chain is built or modified:

1. Check if a registry template matches the new chain signature.
2. If yes, apply the template as the default surface. No AI proposal needed — the surface just appears.
3. If no template matches, the AI sets up a surface (using the `set_surface` operation).

The AI's role shifts from "invent a surface every time" to "propose surfaces for novel chain configurations." For common chains, the experience is instant and deterministic. For unusual combinations, the AI fills the gap.

Templates are authored by hand in the instrument registry (alongside engine definitions) and refined over time. The AI does not write templates — it proposes surfaces, and if a proposal proves useful across many sessions, a developer can promote it to a registry template.

#### When Semantic Controls Are Not Used

Single-module voices (no processors in the chain) skip semantic controls entirely. The module's raw controls are shown directly with their existing semantic labels from the instrument registry. There's no useful aggregation to do when there's only one module.

The threshold for introducing semantic controls is: **when the voice has more controllable parameters than can comfortably fit on the expanded card** (roughly > 6 raw controls across the chain). Below that threshold, show raw controls.

---

### Voice Surface State

The surface configuration is part of the voice's state — it persists, it's undoable, and the AI sees it.

```ts
interface PinnedControl {
  moduleId: string;
  controlId: string;
}

interface VoiceSurface {
  semanticControls: SemanticControlDef[];   // empty for single-module voices
  pinnedControls: PinnedControl[];          // raw controls the human surfaced
  xyAxes: {
    x: string;                              // controlId or semanticControlId
    y: string;
  };
  thumbprint: ThumbprintConfig;
}

interface ThumbprintConfig {
  type: 'waveform' | 'spectral-color' | 'static-color';
  // For static-color, hue is derived from dominant semantic character
  // For waveform/spectral-color, computed from audio analysis
}
```

The `VoiceSurface` lives on the `Voice` type:

```ts
interface Voice {
  // ... existing fields ...
  surface: VoiceSurface;
}
```

When a voice is created, it gets a default surface:
- No semantic controls (single-module default)
- No pinned controls
- XY axes set to `brightness` × `texture` (the current default)
- Thumbprint set to `static-color`

When a processor is added to the chain, the surface updates automatically: if a registry template matches the new chain, it is applied immediately; otherwise the AI sets up a surface as part of the same action. The human can undo or ask for a different arrangement.

---

### State Categorisation

Surface-related state falls into three categories with different persistence and undo behaviour. Keeping these boundaries clear prevents over-persisting visual noise or under-modelling meaningful UI collaboration.

**Project state** — persisted and undoable:
- Semantic surface definitions (`VoiceSurface.semanticControls`)
- Pinned controls
- XY axis bindings
- Thumbprint configuration

**Render-only state** — derived at runtime, never persisted:
- Activity pulse
- Thumbprint colour computation (derived from parameter values)
- Hover/focus state
- Deep view open/closed state

The `VoiceSurface` type captures project state only. Render-only state is never serialised.

---

### AI UI Operations

The AI's UI toolkit is a new category of operations, subject to the same rules as parameter operations: validate before apply, fail cleanly, generate a human-readable description, group into undoable action groups.

```ts
// --- Surface operations (new) ---
// All surface operations apply immediately and are undoable,
// following the same pattern as move, sketch, and add_processor.

interface SetSurfaceOp {
  type: 'set_surface';
  voiceId: string;
  semanticControls: SemanticControlDef[];
  xyAxes?: { x: string; y: string };
  description: string;         // "Set up Brightness/Space/Movement for Plaits→Rings→Clouds chain"
}

interface PinOp {
  type: 'pin';
  voiceId: string;
  moduleId: string;
  controlId: string;
  reason: string;              // "You've adjusted Clouds decay 4 times in this session"
}

interface UnpinOp {
  type: 'unpin';
  voiceId: string;
  moduleId: string;
  controlId: string;
  reason: string;
}

interface LabelAxesOp {
  type: 'label_axes';
  voiceId: string;
  x: string;                   // controlId or semanticControlId
  y: string;
  reason: string;
}

type AISurfaceOp =
  | SetSurfaceOp
  | PinOp
  | UnpinOp
  | LabelAxesOp;
```

#### Operation Semantics

All surface operations apply immediately and are undoable, just like `move`, `sketch`, and `add_processor`. There is no approval gate. If the human doesn't like a surface change, they undo it — the same pattern as every other AI action.

**`set_surface`**: The AI sets a complete semantic surface for a voice. This happens when:
- A processor is added to a chain (the AI should set up a surface that covers the new chain)
- The human asks the AI to "set up controls for this voice"
- The human asks for a different organisation of the controls

The AI explains what it did in the chat: "I've set up Brightness, Space, and Movement controls for the lead. These map across your Plaits → Rings → Clouds chain." The human can undo if they prefer the previous arrangement.

**`pin`**: The AI surfaces a raw control. This should be infrequent — only when the AI has evidence that the human wants direct access (e.g., they've asked about a specific parameter, or they've been adjusting it via the deep view).

**`unpin`**: The AI removes a pinned control. Same pattern — immediate, undoable.

**`label_axes`**: The AI sets different XY pad axes based on context. For example, if the human is working on the spatial qualities of a pad, the AI might set X=Space, Y=Movement instead of the default X=Brightness, Y=Texture.

#### What the AI Cannot Do

The AI cannot:
- Change a semantic control's weight mapping without a chain structure change
- Rearrange the order of controls on the surface
- Change the thumbprint
- Hide the deep view or any information the human asked to see
- Make sound-affecting changes to voices with agency OFF (surface/view changes are allowed — they don't affect sound)
- Spontaneously rearrange surfaces without a chain change or human request (see Trigger Discipline)

#### Trigger Discipline

The AI should not constantly suggest surface changes. Guidelines for the AI contract:

- Propose a surface when the chain changes. That's the natural moment.
- Suggest a pin after the human touches the same raw control 3+ times in a session, or asks about it.
- Suggest axis changes only when the human's recent work clearly aligns with different dimensions.
- Never propose more than one surface change per response unless the human asked for a reorganisation.
- When in doubt, don't suggest. The human can always ask.

**Why this is prompt guidance, not a runtime constraint.** The AI interface design principles (Rule 4) say to put constraints in the environment, not only in prose. Trigger discipline is an intentional exception. "Don't rearrange too frequently" is a nuanced, context-dependent judgment — encoding it as a hard runtime limit (e.g., "max 1 surface change per N responses") would be brittle and prevent the AI from responding well to legitimate requests like "reorganise all my controls." The runtime safety net is undo: if the AI changes the surface and the human doesn't like it, they undo. The prompt guidance shapes behaviour; undo enforces the boundary. This is the same contract as every other AI action.

---

### Surface State in AI Context

The AI interface design principles (Rule 3) require that exposed state be legible and decision-ready. The AI needs to see the current surface to decide whether to propose changes. The state compression layer should include surface state for each voice.

**What the AI receives per voice (in compressed state):**

```
voice LEAD (agency: ON)
  chain: Plaits(Wavetable) → Rings → Clouds
  surface:
    semantic: Brightness [Plaits:timbre×0.6, Rings:brightness×0.3, Clouds:feedback×0.1]
              Space [Clouds:mix×0.5, Clouds:size×0.3, Rings:damping×0.2]
              Movement [Tides:rate×0.6, Clouds:texture×0.4]
    pinned: Clouds:decay (pinned by human)
    xy: Brightness × Space
  values: Brightness=0.65, Space=0.31, Movement=0.55, Clouds:decay=0.20
```

**What the AI does NOT receive:**
- Thumbprint configuration (rendering concern, not decision-relevant)
- Pin timestamps (internal bookkeeping)
- Weight details unless the AI specifically inspects a control (keep the default compressed)

**When the AI should receive expanded surface state:**
- When the human asks about controls ("what does Space do?")
- When the AI is about to propose a surface change
- After a chain change invalidates the current surface

The compressed format is generated from `VoiceSurface`, not hand-written. The same registry-driven generation principle from the canonical model RFC applies: the AI contract is produced from the data model, not maintained separately.

---

### Surface Execution Reports

The AI interface design principles (Rule 6) require that tool responses return consequences, not just acknowledgements. Surface operations need explicit feedback so the AI can reason about what happened.

**Extension to `ExecutionReport`:**

```ts
interface SurfaceOpResult {
  op: AISurfaceOp;
  outcome: 'applied' | 'rejected';
  reason?: string;                // why it was rejected (validation failure)
  resultingSurface?: VoiceSurface; // the surface state after application
}
```

**What the AI receives after each surface operation type:**

`set_surface` — applied:
```
Surface set for LEAD: Brightness, Space, Movement. XY axes set to Brightness × Space.
```

`set_surface` — rejected (validation):
```
Surface rejected: voice LEAD does not exist.
```

`pin` — applied:
```
Pinned Clouds:decay on LEAD. Surface now has 2 semantic controls + 1 pinned control.
```

`pin` — rejected (validation):
```
Pin rejected: LEAD already has 4 pinned controls (maximum).
```

This feedback format follows the same pattern as the existing `ExecutionReport` for parameter operations: structured enough for the AI to reason about, concise enough to not waste context.

---

### Surface Change Attribution in the Action Log

The existing action log shows entries like "KICK: moved brightness +0.3". Surface changes need their own vocabulary so the human can distinguish sound changes from layout changes at a glance.

**Action log entry types for surface operations:**

```
Surface set for LEAD: Brightness, Space, Movement             ← AI set up surface
Pinned Clouds:decay on LEAD                                   ← AI or human pinned
Unpinned Rings:brightness from LEAD                           ← AI or human unpinned
XY axes changed on LEAD: Space × Movement                     ← AI or human changed axes
Surface degraded on LEAD: removed Space (Clouds removed)      ← automatic chain-change degradation
```

These entries use the existing `ActionLogEntry` structure but are visually distinct from sound-change entries in the chat panel. Sound changes use the amber accent; surface changes should use a neutral or distinct accent (perhaps the same teal as agency indicators) so the human can scan the log and immediately see "the AI changed sound here, changed layout there."

---

### Composability: Surface and Structure Operations

The AI interface design principles (Rule 8) require composable primitives. When the AI adds a processor and sets up a surface in the same response, both operations apply immediately in order — no deferred operations, no approval gates.

**Undo grouping:**

When a structure change (e.g., `add_processor`) and a surface change (e.g., `set_surface`) appear in the same AI response, they are grouped into a **single undo entry**. Adding Rings and setting up its controls is one gesture from the musician's perspective — one undo should revert both.

The undo stack after such a response looks like:

```
[top]  Group: "Added Rings to LEAD, set up Brightness/Space/Movement"  ← undo reverts processor + surface
```

This follows the existing principle: one AI response = one undo group. Surface operations are not special-cased.

**What if the human wants to keep the processor but change the surface?** They ask the AI for a different arrangement, or they customise it from the deep view. They don't need to undo-and-redo to get a different surface — they just tell the AI what they want, which is the normal collaboration flow.

---

### Activity Pulse

The activity pulse is a purely ephemeral visual feedback mechanism. When the AI changes parameters on a voice, that voice's compact card (and expanded card header) briefly glows — ~2 seconds, ease-out fade.

This is purely ephemeral and carries no state. It is not an AI operation — it's a rendering concern driven by the existing action log. If an `AIAction` targets a voice, that voice's card pulses. No new types needed.

The pulse should be subtle enough to notice peripherally but not distracting. A gentle amber glow (matching the parameter accent colour) that fades to nothing.

---

### Thumbprint Design

The thumbprint is the compact card's visual identity marker. It must be:
- Instantly distinguishable between voices
- Meaningful (not arbitrary)
- Stable (doesn't flicker or change constantly)
- Tiny (fits in a ~40px space)

**Recommended approach for v1: static colour derived from the voice's dominant semantic character.**

The colour is computed from the voice's current parameter state, mapping the dominant timbral quality to a hue:
- Dark/warm sounds → deep blue/purple
- Bright/harsh sounds → orange/yellow
- Noisy/textured sounds → grey/white
- Resonant/metallic sounds → cyan/teal

The colour updates when parameters change, but slowly (lerp over ~1 second) so it doesn't flicker. It's an ambient indicator, not a real-time meter.

**Deferred for later**: Waveform thumbnails (requires per-voice audio analysis), spectral colour (requires FFT), animated indicators. These are better but need audio infrastructure that doesn't exist yet.

---

### Signal Chain Visualisation

For chain voices, the expanded card shows a chain strip:

```
[Plaits(Wavetable)] → [Rings] → [Clouds]
       ●                ○         ○
```

Implementation:

```ts
interface ChainNode {
  moduleId: string;
  moduleType: string;          // "plaits", "rings", "clouds"
  label: string;               // "Plaits (Wavetable)", "Rings", "Clouds"
  enabled: boolean;
  focused: boolean;            // true when deep view is showing this module
}
```

The chain strip is a horizontal layout of `ChainNode` elements connected by arrows. Tapping a node opens the deep view focused on that module. The strip is compact — module name + status dot, nothing more.

For single-module voices, no chain strip is shown.

---

### Pinning Mechanism

Pinning is how the human bridges between the semantic surface and raw control.

**Pin sources:**
- From the deep view: click a "pin" icon on any raw control
- From conversation: "I want direct control over the reverb tail" → AI uses `pin`
- Drag from deep view to the expanded card surface (stretch goal)

**Pin display:**
- Pinned controls appear below the semantic controls on the expanded card
- Visually distinct: labelled with the module name (e.g., "Clouds: Decay") in a smaller font
- Module-coloured left border or accent to show provenance

**Pin limits:**
- Maximum 4 pinned controls per voice (prevents the expanded card from becoming the deep view)
- If the human tries to pin a 5th, the oldest pin is highlighted with "Replace?" or the deep view is suggested instead

**Pin state:**
```ts
interface PinnedControl {
  moduleId: string;
  controlId: string;
  pinnedAt: number;            // timestamp, for LRU if limit is reached
  pinnedBy: 'human' | 'ai';   // provenance
}
```

---

### Undo Model

Surface changes create undo entries, following the existing grouped-snapshot model.

```ts
interface SurfaceSnapshot {
  kind: 'surface';
  voiceId: string;
  prevSurface: VoiceSurface;
  timestamp: number;
  description: string;
}
```

This type is added to the existing `Snapshot` discriminated union. Surface snapshots are grouped with other operations from the same AI response into a single undo entry, following the standard action group pattern.

---

### How This Integrates with Existing Types

The canonical model RFC (`rfc-canonical-musical-model.md`) already defines `ControlSchema`, `SemanticRole`, `ControlState`, `Processor`, and the adapter interface. This RFC builds on top of those types — it does not replace them.

The relationship:

```
Canonical Model RFC          This RFC
────────────────────         ─────────────────────
ControlSchema                SemanticControlDef (aggregates multiple ControlSchemas)
SemanticRole                 Used as semantic control IDs where applicable
ControlState                 Drives thumbprint colour, activity pulse
Voice                        Extended with VoiceSurface
Processor                    Chain nodes in the chain strip
InstrumentDef / EngineDef    Extended with ChainSurfaceTemplate (baseline surfaces)
AIOperation                  Extended with AISurfaceOp
Snapshot                     Extended with SurfaceSnapshot
ExecutionReport              Extended with SurfaceOpResult
```

The canonical model defines what the AI can reason about and act on. This RFC defines what the human sees and touches. The semantic surface is the bridge: the AI reasons about raw controls via the canonical model, but presents curated views via the surface model.

---

## Part 2: Architectural North Star (Build Later)

This section describes where the surface model is headed. **Do not build this yet.**

### Adaptive Surfaces

When Gluon has enough usage data, the system could learn which controls the human uses most on each chain configuration and propose optimised default surfaces. This is a refinement of the AI's initial proposals, not a new mechanism.

**Promotion trigger**: When Gluon has session persistence and enough usage data to make meaningful predictions.

### Surface Templates

A surface configuration that works well for a "Plaits → Rings → Clouds pad" could be saved as a template and reused across projects. Templates would be stored in the instrument registry alongside engine definitions.

**Promotion trigger**: When users are building similar chain configurations repeatedly and asking for the same surface arrangements.

### Collaborative Surfaces

In multi-user sessions, each user could have their own surface view of the same voice. One person sees Brightness/Space, another sees the raw Rings parameters. The underlying state is shared; only the view differs.

**Promotion trigger**: When multi-user collaboration is designed.

### Semantic Modulation Display

When an LFO is sweeping a parameter that contributes to a semantic control, the semantic slider could show a range indicator (the sweep range) rather than a fixed position. This requires the modulation system from Phase 4B.

**Promotion trigger**: When Phase 4B modulation assignments exist.

---

## Validation Invariants

1. **A semantic control's weights must sum to 1.0** (within floating-point tolerance). The system normalises if needed after human weight overrides.
2. **A semantic control must reference only modules present in the voice's chain.** When the chain changes, the surface degrades gracefully rather than being invalidated wholesale:
   - Semantic controls whose mappings are all still valid are kept unchanged.
   - Semantic controls with some invalid mappings (referencing a removed module) are kept with the invalid weights removed and remaining weights renormalised — if this leaves a semantic control with only one mapping, it is demoted to a pinned raw control automatically.
   - Semantic controls with all mappings invalid are removed.
   - After degradation, if a registry template matches the new chain, it is offered as a replacement. Otherwise the AI is prompted to propose a revised surface.
3. **Pinned controls must reference existing modules and controls.** When a module is removed, pins targeting it are automatically removed (with an undo entry).
4. **UI curation operations do not require agency.** Agency gates sound mutation (params, patterns, transforms, chain structure), not presentation. The AI should be able to help the human inspect and organise any voice regardless of agency. OFF means "don't change my sound," not "don't help me look at this voice." This aligns with the sequencer view layer RFC, where `add_view`/`remove_view` are explicitly not agency-gated.
5. **Surface operations apply immediately and are undoable.** They follow the same pattern as all other AI actions — no approval gate, no deferred flow.
6. **Maximum 4 pinned controls per voice.** Enforced at the model layer.
7. **The activity pulse carries no state.** It is purely a rendering effect driven by the action log. It cannot be undone, persisted, or referenced by other operations.

---

## Migration Strategy

Incremental. The existing UI continues to work at every step.

### Step 1: Add VoiceSurface type and default surface

Add the `VoiceSurface`, `SemanticControlDef`, `PinnedControl`, and `ThumbprintConfig` types alongside the existing types. Every voice gets a default surface on creation: no semantic controls, no pins, default XY axes, static-color thumbprint. No visible UI changes — the existing parameter controls continue to render as they do today.

### Step 2: Implement compact cards (Layer 1)

Replace the current `VoiceSelector` compact mode with the new compact card design: name, mute state, thumbprint, agency dot. The activity pulse is wired to the action log. The expanded voice still uses the current parameter UI.

### Step 3: Implement the expanded card layout (Layer 2 shell)

Restructure the `InstrumentView` to use the expanded card layout: chain strip (if applicable), control area, step grid, XY pad. For single-module voices, the control area shows raw controls exactly as today. No semantic controls yet.

### Step 4: Implement the deep view (Layer 3)

Add the disclosure toggle on chain nodes. The deep view shows per-module raw controls in a scrollable panel. Pin buttons on each control. This can ship before semantic controls exist — it's useful as a module inspector for Phase 4A chains.

### Step 5: Implement semantic controls

Add the `SemanticControlDef` rendering: a slider that fans out to weighted raw controls. Add the inspection popover that shows the mapping. Wire the AI `set_surface` operation. This is the first step where the AI curates the surface.

### Step 6: Implement pinning

Wire the pin mechanism: from deep view, from AI action, from conversation. Add the `pin` operation to the AI's toolkit. Add pin rendering on the expanded card.

### Step 7: Wire AI trigger discipline

Add the contextual rules: propose a surface when a chain changes, suggest pins after repeated adjustment. This is prompt/contract work, not UI work.

---

## Acceptance Criteria

### Implementation plan (build now)

1. Compact cards remain clean and scannable at 8 voices.
2. The expanded card shows meaningful controls for both single-module and chain voices.
3. The deep view exposes every raw parameter on every module in the chain.
4. Semantic controls are inspectable — the user can see the weight mapping.
5. Semantic control mappings are stable: they don't change unless the chain changes.
6. The AI can set up surfaces, and surface changes apply immediately and are undoable.
7. Pinned controls work and respect the 4-pin limit.
8. Surface changes are undoable, grouped with other operations from the same AI response.
9. The activity pulse fires on AI parameter changes and fades naturally.
10. The AI does not spontaneously rearrange the surface without asking.
11. The AI receives compressed surface state per voice and can reason about the current surface.
12. Surface operation results return meaningful feedback (applied/rejected with reason).

### North star (prove later)

13. Surface templates can be saved and reused across projects.
14. The AI's default surface proposals improve with usage data.
15. Semantic controls handle modulation display gracefully.

---

## What This Does Not Define

**Visual design specifics** — Exact colours, spacing, typography, animation curves. Those are design work, not architecture.

**AI reasoning quality** — Whether the AI proposes good semantic surfaces is a function of the model, the prompt, and the control descriptions — not the surface model.

**Module set** — Which Mutable Instruments modules ship and when. That's Phase 4A scope.

**Persistence format** — How surfaces are serialised for save/load. That's a concern when project persistence is built.

**Multi-touch and gesture** — How the XY pad handles multi-finger input, whether gestures can trigger surface changes. Deferred.

---

## Open Questions

1. **Thumbprint design**: Static colour is the v1 proposal, but waveform thumbnails would be much more expressive. How hard is per-voice audio analysis in the current AudioWorklet architecture? Is it worth the complexity for v1?

2. **Semantic control count**: The proposal says 2-4 per voice. Should this be a hard limit, or should it scale with chain complexity (e.g., 2 for source + 1 processor, 4 for source + 2 processors)?

3. **Modulation on semantic controls**: When an LFO sweeps a raw parameter that contributes to a semantic control, the semantic slider's position becomes ambiguous. Should we defer semantic controls on modulated parameters until Phase 4B has a clear modulation model?

4. **Effects-only voices**: A send bus with just Clouds has no source module. Does the surface model handle this, or do effects buses need a different card type?

5. **Human weight editing UX**: The RFC allows humans to override semantic control weights from the deep view. What's the interaction? Sliders per weight? A matrix? Or just "the AI proposes, and if you don't like it, tell the AI"?

6. **Surface changes in chat vs. inline**: Should `set_surface` results appear as chat messages or as inline UI notifications on the voice card? Chat is more conversational; inline is more spatial.

These questions are important but do not block the core direction. They can be resolved during implementation of the relevant steps.

---

## Relationship to Other Documents

- **Canonical Model RFC**: This RFC builds on `ControlSchema`, `SemanticRole`, `Processor`, and the adapter interface. Semantic controls aggregate canonical controls. The two RFCs are complementary — canonical model defines what the AI reasons about, this RFC defines what the human sees.
- **Phase 4A RFC**: The chain UI elements (chain strip, module inspector, deep view) are the UI counterpart of Phase 4A's patch chain model. This RFC should be implemented alongside or shortly after Phase 4A's runtime work.
- **AI Interface Design Principles**: This RFC was audited against all 10 design rules and the 7-point heuristic for new AI features. Surface operations are first-class structured tools (Rule 1), the action space matches the task (Rule 2), state compression includes surface state (Rule 3), constraints are enforced at the model layer via validation invariants with undo as the runtime boundary (Rule 4), the AI chooses whether to propose or not (Rule 5), execution reports return consequences (Rule 6), conceptual and operational truth are aligned across types/validation/undo/agency (Rule 7), surface operations compose with immediate operations via the deferred-operation pattern (Rule 8), human authority is explicit throughout (Rule 9), and all operations are coherent affordances, not hacks (Rule 10). The one intentional deviation is trigger discipline (Rule 4): frequency guidance is prompt-level, with undo as the runtime safety net. This is documented and justified in the Trigger Discipline section.
- **Interaction Protocol**: The protocol's principles (human wins, AI acts when asked, undo is one action away) extend to surface operations unchanged. `set_surface` is an AI action like `move` or `sketch` — it's immediate, undoable, and inspectable. Unlike sound-mutation tools, UI curation operations (views, surfaces, pins) do not require agency — they change presentation, not sound.
