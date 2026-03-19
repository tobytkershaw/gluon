# Surface View: North Star

## Status

Draft — working document for design alignment. Synthesised from:

- `docs/rfcs/view-architecture.md` — four-view model, module library
- `docs/rfcs/ai-curated-surfaces.md` — semantic controls, AI operations, three-layer model
- `docs/briefs/visual-language.md` — Surface Score, alive feeling
- `docs/principles/ai-interface-design-principles.md` — AI interface posture
- `docs/principles/ai-capability-doctrine.md` — constrain boundaries, empower inside
- `docs/principles/human-capability-parity.md` — anything AI can do, human can too
- `docs/principles/ai-collaboration-model.md` — collaboration phases, default posture
- `docs/design-references.md` — NKS, Guitar Rig, Bitwig, Kontakt, Logic Smart Controls

---

## 1. What Is Surface?

The canonical views (Tracker, Rack, Patch) are 1:1 mappings of controls to the data layer. You can make music entirely within them and never touch Surface. Surface is something different.

**Surface is the musically useful, context-dependent abstraction over the canonical data.** It applies to the human the same principle Gluon applies to the AI: constrain the possibility space to a musically meaningful subspace, while maintaining aesthetic freedom.

Where the Rack for an instrument might expose 10 raw controls, the Surface might present two macro knobs wired up by the AI for the purpose at hand. That's the simplest example of what Surface does. The AI chooses when to add piano rolls, step sequencers, chord generators, filter displays, Buchla-style interfaces — whatever suits the context and the musical need. It chooses how to colour things for legibility, how to label controls, how to arrange the visual design. All in the service of empowering the human by curating the possibility space.

The human can construct and edit Surface for themselves (the parity principle), but the real power comes from empowering the AI to curate it — and even build novel controls from modular parts — to suit the context and the musical need.

Surface operates at two scales:
- **Per-track** — primarily for composition. The AI curates a focused control surface for one instrument's role.
- **Cross-track** — primarily for performance. The AI curates a control surface spanning the whole project.

---

## 2. User Stories

### The musician composing with AI assistance

Opens Gluon. Sees the Stage — compact cards for each track. KICK, BASS, LEAD, PAD. Clicks LEAD. The Surface expands: an XY pad mapped to Brightness × Space, three macro knobs (Brightness, Space, Movement), a step grid showing the pattern, a chain strip showing Plaits → Rings → Clouds.

Grabs the Space knob, turns it up. Clouds mix and size increase together. Rings damping decreases. One gesture, multiple parameters, musically coherent.

Tells the AI "make the lead more aggressive." The AI moves parameters AND updates the Surface — relabels the XY pad to Attack × Brightness, because those are now the dimensions that matter.

Wants to fine-tune Clouds feedback specifically. Opens the Deep View for the Clouds node. Sees every raw parameter. Pins `feedback` to the Surface. Now it's right there next to the macro knobs.

### The musician performing

Switches to the Performance Surface — a cross-track view. Mixer strips for all tracks. A global "Darkness" macro that affects brightness across the whole project. A tension arc shaping the energy of the loop.

Grabs the Darkness macro, sweeps it down. Every track responds — filters close, brightness decreases, the visual palette shifts from warm amber to deep indigo. One gesture, project-wide.

### The musician who doesn't trust the AI's surface

Opens the Deep View. Sees every parameter on every module. Inspects what "Brightness" actually does — "Plaits timbre × 0.6, Rings brightness × 0.3, Clouds feedback × 0.1". Adjusts the weights. Or ignores semantic controls entirely and pins the raw controls they want.

Or switches to Rack view. Full ground truth. Every knob for every module. No abstraction. No AI opinion.

### The musician with a bare Plaits track (no chain)

Surface shows raw controls directly — timbre, morph, note, harmonics. No semantic aggregation. No macro knobs. There's nothing to aggregate over. The Surface earns its abstraction only when complexity demands it.

### The AI building a sound

The AI adds Rings to a Plaits track. As part of the same action group, it sets up the Surface: a KnobGroup with Brightness and Resonance macro knobs, an XY pad bound to those two dimensions, and a step grid for the pattern. Sound and interface are configured together — one undo reverts both.

The human says "I keep tweaking the reverb tail." The AI pins Clouds decay to the Surface. The human says "actually, set up something different for this track." The AI recomposes the Surface with different modules and bindings.

### The new collaboration flow (Surface changes the system prompt)

Without Surface, the AI's collaboration model is: **do → report → wait.**

> Human: "Add a hi-hat part."
> AI: "I've added a hi-hat track with a pattern. What do you think?"

The human hears the result. If they want changes, they describe them in words. The AI interprets and acts. Round-trip.

With Surface, the AI can **hand the human the controls** instead of finishing the job alone:

> Human: "Add a hi-hat part."
> AI: [creates the track, sets up a pattern generator module with density/swing/accent controls, adds a tone knob for the hi-hat character] "I've set up a hi-hat with a pattern generator and sound controls. Dial in what you're looking for, or tell me a direction and I'll adjust."

The human tweaks the density slider. Tries more swing. Pulls back the accent. They're exploring the space the AI set up, using controls the AI chose for this specific task. When they find something they like, they can tell the AI to refine from there — or keep tweaking themselves.

This is a fundamental shift in the collaboration posture. The AI's job is no longer just "make the change." It's "set up the right controls for this task, then either act or let the human act." The AI becomes more of a luthier and less of a session musician.

**What this means for the system prompt and collaboration model:**

- The AI should think about which Surface modules to provide alongside any musical action, not just what parameters to set.
- "Add a hi-hat part" might mean placing a pattern generator module (rather than committing to a specific pattern) so the human can explore.
- "Make the bass darker" might mean adjusting parameters AND reconfiguring the Surface to foreground the dimensions the human will want to iterate on next.
- The collaboration phases (framing → sketching → guided iteration → expansion → refinement) from `docs/principles/ai-collaboration-model.md` gain a new dimension: Surface modules are how the AI sets up each phase's workspace.
- The AI should bias toward giving the human interactive controls over a space rather than committing to a single point in that space — especially during sketching and iteration phases.

This doesn't mean the AI never acts directly. "Make the bass darker" is a clear directive and the AI should move the parameters. But it should also ask itself: "what will the human want to adjust next?" and set up the Surface accordingly.

---

## 3. What Does It Feel Like?

The canonical views feel like engineering tools — precise, complete, honest. Surface feels like the instrument itself.

**The Stage** feels like looking at a mixing desk from across the room. You can see what's there. Each track has a colour, a shape, a name. You can see which ones are active, which have AI permission. You can tell at a glance whether it's a sparse project or a dense one.

**The per-track Surface** feels like someone handed you exactly the right controls for this sound. Not all the controls — the right ones. The labels are musical ("Space", "Punch", "Tail"), not technical ("parameter 3 on module 2"). The layout matches the instrument's role: drums get step grids and tone controls, pads get piano rolls and ADSR editors, leads get filter displays and morph sliders. The AI chose these controls because they suit the context, and you can change any of it.

**The Performance Surface** feels like standing at the mixing desk. Everything is in reach. You're not editing individual instruments — you're shaping the whole piece. Faders, macros, relationships between tracks.

**The Deep View** feels like opening the back panel. Full diagnostic access. Every parameter, every module, every weight. This is where trust is built — you can always see exactly what the abstraction is doing. And you can always escape to Rack, Patch, or Tracker for the full canonical truth.

**The visual language** is not decoration — it's information. The kick track is visually heavy and deep-coloured. The hi-hats are thin and ghostly. When the AI acts, you see signal propagation. When the music builds, the visual density increases. Different projects feel visually distinct. The AI has maximum control over the visual aspects of everything inside the Surface canvas — colour, weight, motion, labelling, arrangement. This is part of the curation, not a layer on top of it. A Surface that looks the same for every track is failing at its job of communicating what each sound is.

---

## 4. The Structural Model

### Surface modules vs canonical views

Canonical views (Tracker, Rack, Patch) are 1:1 mappings to the data layer. They are the source of truth. Surface modules are a layer on top.

Some Surface modules show and edit the same data that canonical views show — a Surface step grid edits the same region events as the Tracker, a Surface chain strip shows the same processor chain as the Rack. But they are **curated projections and interfaces**, not ground truth. They show a subset, in a layout chosen for context, with controls chosen for the musical task. The canonical view retains the 1:1 relationship to the data layer and remains the source of truth.

If there's ever a question about what the data actually is, you go to the canonical view. Surface modules defer to canonical views in terms of truthfulness. They are useful abstractions, not authoritative representations.

### Three layers, increasing detail

| Layer | What | Scope | When visible |
|-------|------|-------|-------------|
| **Stage** | Compact cards — identity markers, not controls | All tracks | Always (when Surface tab active) |
| **Surface** | Composed modules — curated controls for one track | Per-track | When a track is expanded from Stage |
| **Deep View** | Full parameter listing per module | Per-module within a track | On demand (click chain node, double-click, or ask AI) |

Plus:

| Layer | What | Scope | When visible |
|-------|------|-------|-------------|
| **Performance Surface** | Cross-track composed modules — mixer, macros, relationships | All tracks | Dedicated mode/toggle |

### Layer interactions

**Stage → Surface:** Click a compact card, it expands into the Surface. The other cards stay visible as compact markers. Only one track's Surface is expanded at a time.

**Surface → Deep View:** Click a node in the chain strip, or double-click the expanded area, or ask the AI. Deep View shows every raw control for that module, with pin-to-surface buttons.

**Deep View → Surface:** Pin a raw control from the Deep View. It appears on the Surface next to the curated modules.

### Compact cards (Stage)

The Stage's job is simple: show what tracks exist, give each one visual identity, let the human select one. The current track sidebar already does most of this. Stage may be a visual upgrade to the existing track selection UI rather than an entirely new architectural layer.

Each card should show the track's identity at a glance — name, mute state, visual character, agency status. Keep it minimal. No mini-knobs, no parameter values. Click to expand into the per-track Surface.

**Density constraint:** The stage must remain scannable at 8-12 tracks.

---

## 5. The Building Blocks

### Two levels of composition

Surface modules operate at two levels:

**Level 1: Module types.** A library of known module types — knob groups, XY pads, step grids, piano rolls, filter displays, etc. Each has a defined interface, bindings, and rendering. The AI selects and configures these to compose a Surface.

**Level 2: Novel controls from modular parts.** The AI can compose genuinely new control types by wiring module primitives together. A macro knob is the simplest example — one knob wired to weighted contributions from multiple raw parameters. But the principle extends further:

- An XY pad where each axis is itself a weighted mapping across four parameters
- A step grid where each step exposes inline parameter locks specific to this track's chain
- A morph control that interpolates between two parameter snapshots the AI identified as the endpoints of the useful space
- A filter display whose cutoff knob is actually a macro affecting both the filter frequency and the source brightness

This is the difference between the AI as a **UI configurator** (picks from a menu of modules) and the AI as a **UI designer** (composes interfaces from primitives). Both levels exist. Level 1 is the foundation. Level 2 is where the vision gets genuinely novel.

**Level 3: Interfaces to audio modules.** Some Surface modules are direct interfaces to audio-rate DSP modules in the chain. The Mutable Instruments library includes generative modules — Marbles (random pattern generator), Grids (topographic drum pattern generator), Stages (programmable envelope/sequencer) — that are not yet compiled for Gluon but exist in the open source codebase. A Surface "pattern generator" module is not new DSP — it's an interface to Marbles or Grids, with the controls curated by the AI for the task. The AI adds Marbles to the chain and surfaces its density, bias, and jitter controls with musical labels. This is exactly how Surface works: the canonical Rack view shows every Marbles parameter; the Surface shows the controls that matter for "dial in a hi-hat pattern."

This extends to all audio modules. Every processor in the chain (Rings, Clouds, Ripples, Compressor, EQ, etc.) can have its controls surfaced as a curated module. The AI decides which controls to expose, how to label them, and whether to wire them into macro mappings — all based on the track's musical role.

### Surface modules are interfaces, not logic

Surface modules must not contain novel logic or functionality. They are purely interfaces to things that exist in the canonical model — audio modules, control mappings, region events, modulation routes.

If a control concept requires its own logic (a tension arc that maps abstract energy to concrete parameters, an orbit that moves through parameter space on a path, a probability field that generates stochastic values), that logic belongs in the engine or audio layer as a modulation source, automation generator, or mapping type. The Surface module is then an interface to that engine concept.

Why: if a Surface module has its own logic, it creates state that doesn't exist in the canonical model. That means the canonical views (Rack, Patch, Tracker) can't show it, violating the principle that Surface modules defer to canonical views in terms of truthfulness. Every parameter change caused by a Surface interaction must be visible in the canonical views as a real modulation, automation, or parameter value.

This keeps Surface as a pure presentation/interface layer. It also means every interesting "experimental" Surface module is really two things: (1) a new engine concept and (2) a Surface interface to that concept. The engine work comes first; the Surface module follows.

### Growing the vocabulary

The module library is not a fixed taxonomy to be fully specified up front. It's a starting vocabulary that grows through iteration. Build the first few modules, learn what the module interface actually needs, then expand.

### Module interface

```ts
interface SurfaceModule {
  type: string;                    // module type from the registry
  id: string;                      // unique instance ID
  label: string;                   // human-readable label
  bindings: ModuleBinding[];       // what data this module connects to
  position: { x: number; y: number; w: number; h: number };  // grid placement
  config: Record<string, unknown>; // module-type-specific configuration
}

interface ModuleBinding {
  role: string;                    // module-defined binding role
  trackId: string;                 // which track
  target: string;                  // controlId, regionId, or semantic reference
}
```

### Starting module vocabulary

These are the modules to build first and learn from. The taxonomy will grow through iteration, not upfront specification.

**Parameter control:**
- **Knob Group** — bank of labelled rotary knobs. Binds to raw or semantic control IDs.
- **XY Pad** — 2D continuous control. Binds to two control IDs (raw, semantic, or composite mappings).
- **Macro Knob** — single knob wired to weighted multi-parameter mapping. The physical manifestation of a semantic control.

**Event programming:**
- **Step Grid** — TR-style gate/velocity/accent row. Binds to region events. Curated projection of Tracker data.
- **Piano Roll** — pitch × time note editor. Binds to region events. Curated projection of Tracker data.

**Signal chain:**
- **Chain Strip** — signal flow diagram with bypass toggles. Curated projection of Patch data.

**Visualisation:**
- **Level Meter** — signal level display. Read-only.

Further modules (ADSR editors, filter displays, model selectors, automation lanes, vector pads, tension arcs, morph sliders, etc.) are described in `docs/rfcs/view-architecture.md` and will be built as the canvas and module interface prove themselves.

### Performance modules (cross-track, comes later)

Performance Surface is the most novel and least specified part of the vision. It comes after per-track Surface modules have been iterated and proven. Initial vocabulary:

- **Mixer Strip Bank** — level/pan/mute/solo for all tracks
- **Cross-Track Macro** — single knob affecting parameters across tracks
- **Tension Arc (Global)** — energy curve spanning all tracks
- **Relationship Matrix** — cross-track dependency overview

---

## 6. What Does the AI Do?

### The AI is the luthier

It builds the instrument panel, not just the sound. When the AI adds Rings to a chain, it also sets up the controls for Rings on the Surface. One gesture — sound and interface together.

The AI also has maximum control over the visual aspects of everything inside the Surface canvas — colour, weight, labelling, arrangement, visual identity. The visual language is part of the curation. A kick drum track should look and feel different from a pad track before the human touches anything.

### Making it easy for the AI to get it right

The same logic behind Surface itself applies to the AI's Surface curation tools. Just as Surface constrains the human's possibility space to a musically meaningful subspace, the AI's curation tools should constrain the design space while allowing creative freedom.

This means:
- **Layout constraints** rather than a blank canvas. The AI fills defined slots in a constrained layout system, not an infinite plane. Good layouts emerge from good constraints, not from unlimited freedom.
- **Module types with clear binding contracts.** The AI knows what a Knob Group needs (N control IDs) and what a Step Grid needs (a region). It doesn't have to guess what data each module requires.
- **Templates as starting points.** Known chain configurations get deterministic default surfaces from a registry. The AI proposes surfaces for novel configurations. For common chains, the experience is instant and predictable.
- **Visual language primitives** rather than arbitrary styling. The AI selects from a constrained palette — track colour derived from timbral character, weight from frequency register, motion from rhythmic role. It doesn't write CSS.
- **Structured feedback.** The AI receives consequences after surface operations (what was applied, what was rejected, what the resulting surface looks like) so it can reason about the next step.

The goal: it should be hard for the AI to produce a bad Surface, and easy for it to produce a good one. Constrain the physics, free the aesthetics — the same principle as the musical tools.

### Surface as shared mental model

The Surface the AI curates is also a representation of how it understands the track. If the AI set up Brightness and Space as the primary dimensions for LEAD, that's a signal about what the AI considers musically important for this sound. When the human asks "make it better," the AI already knows which dimensions to work in — the ones it identified as meaningful.

The Surface becomes a shared mental model between human and AI. The human can see what the AI thinks matters. The AI can see what the human has overridden or pinned. Both sides learn from the other's choices.

### Surface as implicit teaching

Surface is also how Gluon teaches. A beginner doesn't know that kicks are about punch, tone, and tail — but the Surface shows them. A beginner doesn't know which parameters on a Plaits → Rings → Clouds chain interact musically — but the macro knobs demonstrate the meaningful dimensions.

Traditional instruments require you to already know what matters. Surface tells you. The AI isn't just setting up controls — it's implicitly communicating: "these are the dimensions that matter for this kind of sound." This happens automatically as a consequence of good curation, not as a separate teaching feature.

### AI Surface operations

| Operation | What | When |
|-----------|------|------|
| `set_surface` | Compose a complete surface (modules, bindings, positions, visual properties) | Chain changes, human asks for reorganisation |
| `pin` | Surface a raw control | Human repeatedly adjusts same raw param, or asks |
| `unpin` | Remove a pinned control | Surface cleanup |
| `label_axes` | Set XY pad axes | Context shift (working on spatial vs timbral qualities) |
| `set_visual_identity` | Set track colour, weight, visual character | Track creation, role change, timbral shift |

### Trigger discipline

The AI does NOT:
- Rearrange the surface spontaneously without a chain change or human request
- Change semantic control mappings without a chain structure change
- Constantly suggest surface changes
- Propose more than one surface change per response unless the human asked for reorganisation

The AI proposes a surface when the chain changes. That's the natural moment. Otherwise, the human asks. Undo is the runtime safety net.

### What the AI sees

In compressed state per track:

```
track LEAD (agency: ON)
  chain: Plaits(Wavetable) → Rings → Clouds
  surface:
    modules: KnobGroup[Brightness, Space, Movement], XYPad[Brightness×Space], StepGrid
    pinned: Clouds:decay (pinned by human)
  values: Brightness=0.65, Space=0.31, Movement=0.55, Clouds:decay=0.20
```

### Semantic controls

- **Single-module tracks:** raw controls only. No aggregation needed.
- **Chain tracks (>6 raw params):** semantic macro knobs that map weighted across modules.
- **Stability:** mappings defined per-engine-chain configuration, not per-patch. Authored when chain is built, stable until chain structure changes.
- **Inspectable:** human can see the weight mapping from Deep View and override it.
- **AI cannot silently redefine what "Brightness" means.**

---

## 7. Principles

1. **Surface constrains the possibility space to a musically meaningful subspace.** The same principle Gluon applies to AI tools, applied to the human's control surface. Where the Rack shows 10 raw controls, the Surface might show two macro knobs wired for the task at hand.
2. **The AI curates, the human keeps control.** The AI composes and configures the Surface. The human can override, reshape, or replace it. Surface changes apply immediately and are undoable, just like all other AI actions.
3. **The human can do everything the AI can.** Parity principle. The human can construct, edit, and reconfigure their own Surface. The AI accelerates — it should never be the only path.
4. **Transparency is one click or one question away.** Every abstraction is inspectable — the human can see every weight, every mapping, and escape to the canonical views at any time.
5. **Small vocabulary, rich composition.** A small set of UI module primitives that the AI assembles per-instrument, per-context. The modules are the atoms; the composition is the design. Novel controls can be composed from these primitives.
6. **The visual language is information, not decoration.** The AI controls colour, weight, motion, and labelling inside the Surface canvas. Visual differentiation between tracks is part of the curation — it communicates what each sound is before the human touches anything.
7. **Make it easy for the AI to get it right.** Constrain the Surface design space (layout slots, binding contracts, visual primitives) so that good surfaces emerge naturally. The same principle as the musical tools: constrain the physics, free the aesthetics.
8. **Surface teaches implicitly.** The AI's curation communicates what matters for each sound. A beginner learns that kicks are about punch, tone, and tail because the Surface shows them.
9. **The abstraction earns its place.** Simple tracks get raw controls. Semantic surfaces appear only when complexity demands it.
10. **Same rules as parameter control.** AI acts when asked. Human's hands win. Undo reverts UI changes too.
11. **UI curation operations do not require agency.** Agency gates sound mutation, not presentation. The AI can help organise any track's Surface regardless of agency.
12. **Trust over restriction.** The environment should make it natural for the human to trust the AI, not encourage them to think in terms of restricting it. Permission gates and undo provide the safety net. The human shouldn't need to remember to protect things.
13. **Surface modules are interfaces, not logic.** If it has novel functionality, it belongs in the engine/audio layer. Surface modules are purely interfaces to things that exist in the canonical model. Every parameter change caused by a Surface interaction must be visible in the canonical views.
14. **Surface changes the collaboration posture.** The AI's job shifts from "do the thing and report back" to "set up the controls so the human can explore, or offer to act directly." The AI should think about which Surface modules to provide alongside any musical action. Bias toward giving the human interactive controls over a space rather than committing to a single point.

---

## 8. Current Implementation State

| Component | Status |
|-----------|--------|
| **TrackSurface type** (semanticControls, pinnedControls, xyAxes, thumbprint) | Implemented |
| **set_surface AI tool** + validation + undo | Implemented |
| **Surface templates** for known chains | Implemented |
| **SemanticKnob + SemanticInspector** | Implemented |
| **Semantic value computation** (bidirectional) | Implemented |
| **ExpandedTrack** (current Surface tab content) | Implemented but **redundant** — to be replaced |
| Pinned controls rendering | State exists, **UI does not render** |
| XY pad axis binding | State exists, **UI hardwired to timbre/morph** |
| Compact cards / Stage layer | Not implemented |
| Surface module composition (canvas) | Not implemented |
| Deep View (per-module inspector with pin-to-surface) | Partial |
| Surface Score (visual identity) | Not implemented (deferred) |
| Performance Surface (cross-track) | Not implemented |
| Human surface authoring UI | Not implemented (#376) |

---

## 9. Open Decisions

### Must decide before implementation

| # | Question | Options | Stakes |
|---|----------|---------|--------|
| 1 | **Does `set_surface` compose modules or define semantic controls?** | (A) Stays as semantic-control-only, new tool for modules. (B) Evolves to compose modules; semantic controls become config within KnobGroup/MacroKnob. | Shapes the entire AI-surface contract. (B) is cleaner but bigger change. |
| 2 | **Constrained layout system?** | Defined slot system (header/controls/sequencer/footer), CSS Grid with constraints, or react-grid-layout with size limits. Not free-form — the layout system should make it hard to produce a bad arrangement. | Determines how modules are positioned. The constraint is the design. |
| 3 | **What visual primitives does the AI control?** | Track colour, module weight, edge style, labelling, motion — defined as a constrained vocabulary the AI selects from, not arbitrary CSS. | Determines how visual identity is structured. Needs to be constrained enough for good defaults, expressive enough for differentiation. |
| 4 | **Who initiates the first surface?** | (A) Templates only (deterministic). (B) AI proposes on track creation. (C) Empty canvas until configured. | Predictability vs adaptiveness vs honesty. |
| 5 | **Deep View: overlay, panel, or inline?** | Slides over Surface, appears as side panel, expands inline below chain strip | Affects spatial model. |
| 6 | **Human surface editing: direct manipulation, AI-mediated, or both?** | (A) Human drags modules, resizes, rebinds. (B) Human tells AI. (C) Both. | Parity principle says (C), but drag-and-drop UI is significant work. |

### Can decide during implementation

| # | Question | Options |
|---|----------|---------|
| 7 | Performance Surface: separate mode or same canvas? | Toggle, new tab, or mixed modules. Comes after per-track iteration. |
| 8 | Side-by-side track comparison? | One expanded track or two |
| 9 | Surface persistence: per-track or per-chain-signature? | Per-track (personal) vs chain-signature defaults (predictable) vs both |
| 10 | How does Surface respond to chain mutations? | Full regeneration vs graceful degradation vs degradation + AI fills gaps |
| 11 | Semantic control count limit? | Hard cap (2-4) or scales with chain complexity |
| 12 | Surface changes in chat vs inline? | Chat messages vs UI notifications on the card |
| 13 | Human weight editing UX? | Sliders per weight, matrix, or AI-mediated |
| 14 | Stage: new component or visual upgrade to track sidebar? | Keep simple — the exact form follows from the layout work |

---

## 10. What This Document Does Not Define

- **Pixel-level visual design** — exact colours, spacing, typography, animation curves. The visual language principles are defined here; the rendering details are design work.
- **Implementation phasing** — build order and issue breakdown (separate document)
- **AI reasoning quality** — whether the AI proposes good surfaces depends on model capability, prompt design, and the quality of the curation tools we give it
- **Persistence format** — serialisation for save/load
- **Individual module specs** — each module's detailed interface, binding slots, and rendering. The starting vocabulary is listed; the specs emerge through iteration.
- **Performance Surface detail** — the cross-track Surface is the most novel part of the vision but comes after per-track modules are proven. It deserves its own deep design pass.

---

## 11. Relationship to Other Documents

| Document | Relationship |
|----------|-------------|
| `docs/rfcs/view-architecture.md` | Defines the four-view split and module library taxonomy. This document synthesises and extends. |
| `docs/rfcs/ai-curated-surfaces.md` | Defines semantic controls, AI operations, three-layer model, validation invariants. This document incorporates and contextualises. |
| `docs/briefs/visual-language.md` | Defines Surface Score (full visual identity system). The structural visual language (track colour, weight, labelling) is part of this document's scope. The full Score system (motion, atmosphere, relationships) comes later. |
| `docs/rfcs/canonical-musical-model.md` | Defines ControlSchema, SemanticRole, SourceAdapter. Surface modules bind to these types. |
| `docs/rfcs/patch-view-layer.md` | Patch is the topology ground truth. Surface's chain strip is a projection of the same data. |
| `docs/design-references.md` | NKS, Guitar Rig, Bitwig Remote Controls, Logic Smart Controls — all precedents for curated parameter surfaces. |
| `docs/principles/ai-collaboration-model.md` | Defines collaboration phases (framing, sketching, iteration, expansion, refinement). Surface gives the AI a new way to set up each phase's workspace — the collaboration model gains a Surface dimension. |
| GitHub #559 | Decision gate: placeholder vs foundation. Decision: replace. |
| GitHub #560 | Dead metadata fixes. Superseded — fixes go into the new Surface directly. |
| GitHub #73 | Meta-issue for post-foundation Surface work (module library, performance surface). |
| GitHub #376 | Human surface authoring UI. Depends on open decision #6. |
