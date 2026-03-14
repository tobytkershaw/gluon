# Design References

This document captures reference points from existing synths, DAWs, and related tools that are relevant to Gluon's design. None of these are templates to copy — each has trade-offs that don't fully align with Gluon's goals. We study what they get right, what they get wrong, and where Gluon's AI-native model requires something different.

## Native Instruments Ecosystem

NI deserves a section of its own. Across Guitar Rig, Reaktor, Massive X, Kontakt, Maschine, and Komplete Kontrol, they've tackled nearly every design problem Gluon faces — signal chain UIs, parameter organisation, curated surfaces, hardware/software integration, and instrument architecture.

### Guitar Rig

The strongest reference for Gluon's combined chain + parameter view. Guitar Rig is a vertical rack where signal flows top to bottom. Each module shows its controls inline — knobs, switches, all visible in the module's section. A sidebar shows a collapsed signal flow overview for the chain structure at a glance.

**Why it matters for Gluon:** It combines the parameter inspector and the signal flow diagram in one view. The rack IS both. Each module section is a group of parameters in chain order. You don't need a separate node graph because the topology is linear — just a vertical stack. This maps directly to Gluon's constrained topology (source → processors → output).

**Relevant for:** #157 (patch view), #162 (parameter ground truth)

### Massive X

The routing page shows the full signal flow (oscillators → effects → filters → output) in an abridged, interactive diagram. Click a source output, drag to a destination input to rewire. Signal paths are colour-coded: grey for audio, blue for feedback, yellow for bypass. Despite being a synth, Massive X's routing page is essentially a constrained node graph for a fixed set of modules — very close to what Gluon's patch view needs.

**Why it matters for Gluon:** Shows how to do a clean, modern routing UI without full patcher complexity. The colour-coded signal flow and drag-to-connect interaction are directly applicable.

**Relevant for:** #157 (patch view), #158 (node graph ground truth)

### Reaktor

Two levels: Blocks (constrained Eurorack-like surface with standardised panel widths) and Core/Primary (full patcher). Blocks panels have A/B modulation depth sliders per parameter. The Structure View is the ground truth; the Panel View is the designed surface.

**Why it matters for Gluon:** The two-level architecture (simple surface on top of full patcher) is exactly the pattern Gluon needs. The Blocks standardisation (fixed panel widths, consistent mod depth UI) shows how to make a modular system feel cohesive.

**Relevant for:** #157 (patch view), #162 (parameter navigation), #73 (curated surfaces)

### NKS (Native Kontrol Standard) and Komplete Kontrol

NKS is the closest existing thing to Gluon's AI-curated surfaces concept. It's an industry standard for organising plugin parameters into named pages and sections, pre-mapped to hardware knobs. Key properties:

- **Pages of 8 parameters**, each page and section named
- **Pre-mapped per preset** — load a preset and the mapping is ready, no manual configuration
- **Edit mode** for adding, removing, renaming parameters and pages
- **Three-tier visibility**: automated (exposed to DAW), stored (saved in presets but not automatable), hidden
- **750+ plugins from 90+ manufacturers** support the format
- File format: RIFF container with MessagePack-encoded chunks (NISI for metadata, NICA for controller assignments, PLID for plugin ID, PCHK for preset data)

**Why it matters for Gluon:** NKS is manually authored curated surfaces. Gluon's AI-curated surfaces (#73) are the same concept but AI-generated. The NKS data model (pages → sections → named parameters with ranges) is a proven structure. The difference is that in Gluon, the AI generates the mapping dynamically rather than a sound designer shipping it with a preset.

**Relevant for:** #73 (curated surfaces — this is the primary reference), #162 (parameter navigation)

### Kontakt

Instrument architecture with scripted custom UIs (KSP scripting language, Komplete Script in v8). Libraries ship with bespoke interfaces built on top of a standard sampling engine. Modulation via envelopes, LFOs, and step sequencers can target almost any parameter.

**Why it matters for Gluon:** The pattern of custom designed interfaces on top of a standard engine is exactly what AI-curated surfaces would be — the AI is the "library developer" designing a control surface for the current patch.

**Relevant for:** #73 (curated surfaces)

### Maschine

Hardware/software integration with parameter pages (groups of 8 knobs). Macro Controls let you assign any parameter to hardware knobs. Modulation recording via hold-and-turn.

**Why it matters for Gluon:** Pioneer of the "pages of 8" pattern later adopted by Bitwig and standardised in NKS. The one-knob-per-function approach and automatic parameter page assignment are relevant to how AI-curated surfaces should feel.

**Relevant for:** #73 (curated surfaces)

## Other Signal Chain and Parameter References

### Bitwig Studio

Two key contributions:

1. **Unified modulation system** — drag a modulator onto any parameter. Modulation depth shown as coloured rings directly on target controls. No separate patch view needed for modulation routing. The Inspector panel shows all routes in a table for the complete picture.

2. **Remote Controls** — parameters organised into pages of 8. Every device ships with default pages. This is the strongest pagination model in any DAW (after NI pioneered the pattern with Maschine/NKS).

**Why it matters for Gluon:** The inline modulation display is the best projection model for Tides routing. Remote Controls show how to handle "curated parameter surfaces" — relevant to AI-curated surfaces (#73).

**Relevant for:** #73 (curated surfaces), #162 (parameter navigation)

### Reason (Propellerhead/Reason Studios)

Rack metaphor with cables on the back. Flip the rack to see routing. Constrained topology (CV/audio between rack units in a linear stack).

**Why it matters for Gluon:** Makes complex routing feel physical and discoverable. Approachable to non-specialists. The constrained topology matches Gluon's.

**Relevant for:** #157 (patch view)

### VCV Rack

Virtual Eurorack. Cables between module jacks. Especially relevant because Gluon runs the same Mutable Instruments DSP — VCV Rack has virtual versions of the same modules.

**Why it matters for Gluon:** The cable metaphor is immediately understood by anyone who's seen a modular synth. Open source.

**Relevant for:** #157 (patch view)

### Ableton Live

Macro knobs (curated, up to 16) + Configure mode on plugins + full plugin window. The automation parameter dropdown is the closest thing to a flat enumeration of every parameter. Racks provide grouping and chain visibility.

**Why it matters for Gluon:** Clear separation between curated surface and complete view. Track headers and arranger are a reference for the track sidebar (#154).

**Relevant for:** #154 (track sidebar), #73 (curated surfaces)

### Logic Pro

Smart Controls (up to 12 mapped controls) vs full plugin UI. Very clear curated/complete separation.

**Why it matters for Gluon:** Smart Controls are the closest existing analogue to "AI-curated surfaces" — a designed interface that maps to underlying parameters.

**Relevant for:** #73 (curated surfaces)

### SuperCollider (scsynth server architecture)

Not a UI reference — a signal routing model reference. scsynth's server architecture has the cleanest separation of concerns for audio graph execution in any open source system. The key abstractions:

- **Buses** — named routing points for audio and control signals. Audio buses carry multi-channel signal between nodes. Control buses carry single-sample values (parameter data, modulation). Buses are the only way nodes communicate — there is no direct node-to-node wiring. This forces all routing to be explicit and inspectable.
- **Groups** — ordered containers of nodes. Execution order within a group is guaranteed (top to bottom). Groups can nest. This solves the "voice A's output must exist before voice B's sidechain compressor reads it" problem cleanly — put A's group before B's group.
- **Nodes** — either a Synth (DSP unit) or a Group. The entire audio graph is a tree of nodes. Synths read from input buses, process, write to output buses. The tree determines execution order.
- **SynthDefs** — compiled DSP templates, instantiated as Synths at runtime. Separation of instrument definition from instance mirrors Gluon's InstrumentDef/Voice split.

The routing model for sends and sidechains is particularly clean: a sidechain is just "Synth A writes to Bus 10, Synth B reads from Bus 10 as a control input." No special sidechain type, no separate routing API. The bus abstraction unifies audio sends, sidechain inputs, and modulation routing into one concept.

**Why it matters for Gluon:** When Gluon needs Routes (the north star in the canonical model RFC), the bus concept maps well. A Route is essentially a named bus: `{ sourceTargetId, destinationTargetId, kind }`. The execution ordering problem (which node runs first when there's a dependency) is solved by scsynth's group ordering — Gluon will need an equivalent when chains have cross-voice dependencies like sidechains. The SynthDef/Synth separation validates the InstrumentDef/Voice pattern already in the canonical model.

**What doesn't transfer:** scsynth's OSC command protocol, sample-accurate scheduling (Web Audio handles this), audio-rate vs control-rate distinction (Web Audio's AudioParam system covers this differently), and the language/server split (sclang is irrelevant to Gluon).

**Relevant for:** Routes north star (canonical model RFC), sidechain/send routing, execution ordering for cross-voice signal dependencies

## Parameter Ground Truth

The industry uses two models for complete parameter views:

### Flat table (Max Parameters Window, FL Studio Browse Parameters)

A scrollable table with one row per parameter. Columns: name, value, range, type. Complete, honest, no hierarchy. Max adds a Visibility attribute (Automated/Stored/Hidden) — a three-tier curation system.

**Trade-off:** Complete but decontextualised. Parameters lose their relationship to the module they belong to.

### Rack with inline controls (Guitar Rig, Ableton Racks)

Modules stacked in chain order, each showing their own parameters. The structure of the chain provides the parameter grouping.

**Trade-off:** Complete AND contextualised. Parameters stay grouped with their module. But only works for linear/hierarchical topologies — not arbitrary parameter sets.

**For Gluon:** The rack model is the better ground truth because our parameters naturally belong to modules in a chain. A flat table is ground truth for arbitrary parameter sets. When the parameters have structure (which ours always do), the rack preserves that structure. Guitar Rig is the closest existing model.

## Modulation Display

| System | Approach | Strengths | Weaknesses |
|---|---|---|---|
| Bitwig | Coloured rings on target controls | Inline, glanceable, no view switch | Only shows one modulator's routes at a time |
| Serum/Vital | Matrix tab (table of all routes) | Complete overview | Separate view from the controls |
| VCV Rack / Eurorack | Cables + attenuators | Physical, intuitive | No numeric depth display |
| Reaktor Blocks | A/B mod depth sliders on panel | Direct, per-param | Limited to 2 mod sources |

## Instrument Extensibility

| System | Approach | Relevance |
|---|---|---|
| RNBO (Max) | Compiles patches to C++/WASM | Direct — same deployment target as Gluon |
| Faust | Functional DSP language → WASM | Simpler authoring than C++ |
| CLAP | Modern open plugin format | Industry standard, but native not WASM |
| VCV Rack | Open source module SDK | Community instrument ecosystem model |

## Limitations of All References

None of these systems were designed for AI-assisted workflows. They assume the human does everything manually. Gluon needs to design for:

- The AI built the chain — the human is inspecting/tweaking, not authoring from scratch
- AI actions need visual legibility (#163) — no existing system has this
- The ground-truth view must be readable by both human AND AI
- Undo maps to AI action groups, not individual parameter changes
