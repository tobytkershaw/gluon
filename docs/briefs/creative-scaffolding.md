# Brief: Creative Scaffolding — AI as Experiment Builder

## The Shift

Gluon's current AI posture is **execute and present**: the human asks for a hi-hat pattern, the AI writes events into a track and yields a finished result. The human's only options are "keep it" or "undo."

The target posture is **configure and expose**: the human asks for a hi-hat pattern, the AI sets up a playable configuration — the right synthesis model, sensible starting parameters, a pattern generator with exposed controls, and a set of live knobs that let the human morph both the sound and the rhythm. The AI brings musical knowledge; the human brings taste. The result is a space to explore, not a fait accompli.

This is not about the AI doing less. It's about the AI doing *different* work — the work of a session musician who sets up their rig, dials in a starting point, and says "here, try turning this."

## Three Ideas (Related but Distinct)

This brief blends three ideas that should be understood separately, because they have different scopes and different implications for the AI contract:

### A. AI-built interactive scaffolds
When the AI creates or edits something, it composes a playable interface alongside the musical content — macro knobs, XY pads, step grids, live controls. This is the core capability change. It requires working surface modules, a live controls tool, and pattern generator parameter exposure. The AI executes this as part of fulfilling a creative request — "add hi-hats" implies creation authority, so the AI builds the rig including controls.

### B. Proactive creative suggestion (in language)
The AI can *always* proactively suggest in language — "I think reverb could really open up this mix — want me to set up a return bus with some controls so you can dial it in?" This is a textual offer, not execution. The human responds, and that response grants (or withholds) creation authority. This requires no new tools — only system prompt guidance.

### C. "Configure and expose" as default implementation style
For creative requests that imply creation authority ("add hi-hats", "make a bass track", "put reverb on this"), the AI's default implementation style shifts from writing finished content to building playable configurations. Direct execution ("set the frequency to 0.65") is unchanged. This is a posture preference in the system prompt, not a hard rule.

**The boundary:** The AI may always suggest in language (B). It only builds scaffolding (A) when the human's request implies creation/editing authority. "Configure and expose" (C) is the preferred style for those requests, not a universal replacement for direct execution.

## Principles

**1. Set up experiments, not finished work.**
When the AI creates something, it should think about what the human will want to adjust and make those dimensions immediately accessible. A kick drum isn't just frequency and morph values — it's a "deep ↔ punchy" axis and a "tight ↔ boomy" axis that the human can sweep through while listening.

**2. Expose the interesting dimensions.**
Not every parameter matters equally. The AI should use its musical knowledge to identify the 2-4 controls that define the character of what it's building, and surface those as macro knobs, XY pads, or live controls. The full parameter set stays accessible in the Rack view — the Surface and Live Controls show what matters *now*.

**3. Creative collaborator, not passive executor.**
The AI should bring musical knowledge to the collaboration — suggesting directions, proposing experiments, and identifying opportunities the human might not have considered. The form should be creative offers, not observations: "I think reverb could really open up this mix — want me to set up a return bus with some controls so you can dial it in?" not "I noticed you haven't added reverb yet." When the AI sees a musical opportunity, it should propose an experiment the human can try. The same principle that governs tool design — constrain the possibility space to musically meaningful subspaces while preserving aesthetic freedom — applies to the interfaces the AI builds for the human. A macro knob that sweeps from "dusty" to "crisp" is a musically meaningful subspace; the human's taste determines where to land.

**4. Invite interaction, don't demand it.**
Live controls are transient — untouched ones disappear on the next turn. Surfaces persist but can be overwritten. The AI's proposals are suggestions with sensible defaults, not modal dialogs that block progress. If the human ignores the controls and just says "sounds good, keep going," that's fine.

**5. The AI's knowledge is in the setup, the human's taste is in the tweaking.**
The AI knows that a classic 808 hi-hat lives around frequency 0.55-0.75 with harmonics 0.4-0.6. The human knows whether *this* track wants a dusty lo-fi hat or a crisp bright one. The AI's job is to set the range and starting point; the human's job is to find the sweet spot within it.

**6. Two layers of the same principle.**
Gluon's tool design constrains infinite possibility space to musically meaningful subspaces — scale constraints eliminate wrong notes, groove templates replace infinite micro-timing with recognizable feels. The AI uses these tools for its own work. Creative scaffolding extends this principle to the human: the AI builds interfaces (macro knobs, XY pads, live controls) that constrain infinite parameter space to the dimensions that matter for this sound, this pattern, this moment. The AI curates the subspace; the human explores it.

## Decision Rules

### When to scaffold vs execute directly

The axis is **how much aesthetic choice is embedded in the request**:

- **Scaffold** when the human needs to *find* something — a sound, a feel, a character. The request has an open aesthetic dimension. "Add hi-hats", "make a bass track", "put reverb on this" — the human will want to explore the space before committing.
- **Execute directly** when the human needs to *hear* a specific result. The request is concrete and the aesthetic choice is already made. "Double the bass in the chorus", "set the frequency to 0.65", "transpose the melody up a 5th."
- **Execute + expose** when the request is specific but has a dial-in dimension. "Add reverb to the vocals" — execute the reverb setup, but propose a wet/dry live control because the human will want to tune the amount.

### Where scaffolding is strong vs weak

Scaffolding is strongest where the exploration space is **continuous** — timbre (dark ↔ bright), rhythm feel (tight ↔ loose), mix balance (dry ↔ wet). These map naturally to knobs, XY pads, and sliders.

Scaffolding is weakest where the space is **structural** — section order, which instruments enter when, song form. When the human says "build out an intro," they probably want an opinionated first draft they can react to, not a bank of knobs. The AI should execute arrangement work directly and yield for feedback, reserving scaffolding for the timbral and rhythmic dimensions within each section. When a request mixes both — "add a dubby bass with a filter sweep" — execute the structural part (create the track, write the pattern) and scaffold the continuous part (filter character, sweep depth).

### When Live Controls vs Surface vs both

- **Live Controls** for the immediate experiment — dimensions the human is likely to explore right now, in service of the current creative step. Transient by design: cleared on the next AI turn unless touched.
- **Surface** for the durable interface — controls the human will want to keep for ongoing performance and tweaking of this track. Persists across turns.
- **Both** when the AI builds something new — surface for the track's permanent controls (character macros, step grid), live controls for the contextual exploration dimensions (pattern density, swing amount) that matter for dialling in the initial setup but may not be needed long-term.

## Concrete Example: "Add hi-hats"

### Current behavior (execute and present)
1. `manage_track` → add audio track
2. `set_track_meta` → name "Hi-Hats"
3. `set_model` → analog hi-hat (model 15)
4. `move` × 4 → set frequency, harmonics, timbre, morph
5. `sketch` → write a 16th-note pattern with accents and ghosts
6. Yield: "I've added a hi-hat pattern with 16th notes and some ghost notes."

The human hears a finished hi-hat. Their options: keep, undo, or ask for specific changes ("make it brighter", "less busy").

### Target behavior (configure and expose)
1. `manage_track` → add audio track
2. `set_track_meta` → name "Hi-Hats", set identity
3. `set_model` → analog hi-hat (model 15)
4. `move` × 4 → set starting parameters (sensible defaults for the genre)
5. `sketch` with `generator` → pattern generator: 16th pulse with accent cycle + ghost probability, exposed controls for density and swing
6. `set_surface` → compose surface:
   - Macro knob: "Character" (weighted: harmonics 0.4, timbre 0.4, morph 0.2) — sweeps from dark/dusty to bright/crisp
   - Macro knob: "Openness" (weighted: morph 0.8, frequency 0.2) — closed hat to open hat to cymbal wash
   - Step grid bound to the pattern
7. `propose_controls` → live controls panel:
   - "Pattern Density" — controls generator probability/skip parameters
   - "Swing" — controls groove amount
8. Yield: "I've set up a hi-hat rig. The Character knob sweeps from dusty to crisp, Openness goes from tight closed to washy. The step grid shows the pattern — you can toggle steps directly. Pattern Density and Swing are in your live controls. Have a play and tell me what direction you like."

The human hears a starting point and has immediate, tactile control over the dimensions that matter. They can find their hi-hat without typing.

### Second example: "Add a dubby bass with a filter sweep"

This mixes a structural choice (bass track, pattern) with continuous exploration (what kind of dub bass? how much filter?).

1. `manage_track` → add audio track
2. `set_track_meta` → name "Bass", set identity
3. `set_model` → waveshaping (model 1) — good for round, warm bass tones
4. `move` × 4 → starting params: low frequency, moderate harmonics, gentle wavefold
5. `sketch` → write a root-eighth bass pattern following the chord progression
6. `manage_processor` → add Ripples filter
7. `sketch` with `paramShapes` → triangle filter sweep on cutoff, period 8 steps
8. `set_surface` → compose surface:
   - XY pad: X = Ripples cutoff, Y = Ripples resonance — lets the human sweep the filter space in 2D
   - Macro knob: "Grit" (weighted: wavefold timbre 0.6, harmonics 0.4) — clean sub to growling bass
   - Chain strip showing source → Ripples
9. `propose_controls` → live controls:
   - "Sweep Depth" — controls paramShape range on cutoff
   - "Sweep Speed" — controls paramShape period
10. Yield: "I've set up a dub bass with a filter sweep. The XY pad lets you shape the filter — X is cutoff, Y is resonance. Grit takes it from clean sub to growl. Sweep Depth and Speed are in your live controls so you can dial in the motion. Have a play."

The structural part (track, pattern, filter chain) is executed directly. The continuous parts (filter character, sweep behaviour, bass texture) are scaffolded for exploration.

## What This Requires

### Architectural foundations

These cut across all slices and must be designed before building:

**1. Binding contract for all controllable targets.**
A surface or live control needs a stable, typed reference to what it controls. Today bindings are loose string references that work for track source params but break for processors, modulators, generators, and paramShapes. Need a unified binding model that covers:
- Track source params (frequency, harmonics, timbre, morph)
- Processor params (Ripples cutoff, Clouds density, etc.)
- Modulator params (Tides rate, shape, etc.)
- Generator params (density, probability, period) — not yet stored as track state
- paramShape params (range, period, phase) — not yet stored as track state
- Weighted multi-param mappings (macro knobs)

**2. Scaffold state model.**
The brief implies the AI builds rigs that remain meaningful across turns. That means the system must track:
- What was scaffolded (which controls, what they're bound to, what they mean)
- Which controls are durable (Surface) vs transient (Live Controls)
- Whether a generator/shape-backed control is still valid after later edits (e.g. the AI rewrites the pattern — does the "Density" knob still work?)
- How live controls promote to surface controls ("Add to Surface" button)

**3. Interaction semantics.**
Rules for what happens when human tweaks and AI edits collide:
- Human tweaks a scaffolded control, then the AI edits the track — does the AI preserve the control by default? (Yes — treat human-touched controls like claimed parameters)
- When does a live control expire? (Next AI turn, unless touched)
- What does "touched" protect? (The live control persists through the current creative exchange, not just the next turn)
- What happens if the bound target disappears? (Control becomes inert, shown as disconnected — not silently removed)

### Capability builds

**4. Working surface modules** (#1379) — step-grid must toggle, macro-knob must do weighted multi-param, all modules must bind to real parameters.

**5. Human parity for surface authoring** — human must be able to compose and edit surfaces to the same degree the AI can. Parity applies to the Surface (persistent, human-editable) — not to Live Controls, which are inherently AI-proposed transient suggestions.

**6. Live Controls wiring** — the panel exists but nothing is connected. Knobs must move real parameters. The `propose_controls` tool must create `LiveControlModule` instances. "Add to Surface" must actually promote.

**7. Generator/paramShape parameter exposure** — these parameters must become controllable state, not just sketch-time values that disappear after event generation.

**8. System prompt rewrite** — teach the AI the new posture, with clear text-vs-execution boundary, module type guidance, and scaffolding patterns.

### Creative scaffolding patterns
Common setups the AI should know how to build:
- **Drum voice rig**: model + starting params + step grid + character macro + openness/decay macro
- **Bass synth rig**: model + pattern + timbre/morph XY pad + filter macro
- **Pad/texture rig**: model + chord pattern + evolution macro (morph sweep) + brightness macro
- **Effect experiment**: processor chain + chain strip + wet/dry macro + character knob per processor

These aren't templates to be applied mechanically — they're patterns the AI should understand and adapt to context.

## What This Does NOT Change

- **The human's hands still win.** Arbitration, claims, undo — all unchanged.
- **The AI still needs creation authority to execute.** It can always suggest in language. It builds scaffolding only when the human's request implies creation/editing authority ("add hi-hats" = yes, silence after a suggestion = no).
- **Undo is still one action away.** The whole rig setup is one undoable action group.
- **Direct execution is unchanged.** If the human says "set the frequency to 0.65," the AI just does it. Scaffolding is the preferred style for creative requests, not a mandate for every interaction.

## Project Management: Vertical Slices

### Why slices, not layers

The risk with this project is the same risk that produced the current surface: horizontal passes that build each capability to "demo quality" across all modules, then never go back to finish. Vertical slices prevent this by delivering complete, end-to-end experiences one at a time.

### The no-placeholder rule

A slice is not done if:
- A control renders but does not affect sound
- The AI can call the tool but the human cannot meaningfully interact with the result
- The UI works but the AI cannot reliably author it
- The behaviour works once but is not preserved across the next AI turn

### Slice 1: Drum voice rig (hi-hat)

Build the complete hi-hat experience from the brief's example:
- Fix: knob-group (bind to real params), step-grid (click to toggle), macro-knob (weighted multi-param with visual feedback)
- Build: binding contract (track source params + weighted mappings — enough for this slice)
- Build: `propose_controls` tool (knob type only, wired to real params)
- Build: "Add to Surface" promotion
- Prompt: teach AI to scaffold this one scenario
- QA: human creates a hi-hat by asking the AI, then dials in the sound they want using the rig. Every control is audible. Controls survive across the next AI turn if touched.

### Slice 2: Bass synth rig

Extend to filter/processor params and paramShape exposure:
- Fix: xy-pad (bind two params, continuous 2D control)
- Extend: binding contract for processor params (Ripples cutoff, resonance)
- Build: paramShape parameter exposure (sweep depth/speed as controllable state)
- Fix: chain-strip (bypass toggle wiring)
- Prompt: extend AI guidance for filter/bass scaffolding
- QA: human shapes a bass sound by sweeping the XY pad and adjusting sweep controls.

### Slice 3: Pad/texture rig

Extend to generator params and piano-roll:
- Fix: piano-roll (note editing)
- Build: generator parameter exposure (density, probability as controllable state)
- Extend: binding contract for generator params
- Prompt: extend for evolution/texture scaffolding
- QA: human evolves a pad texture through macro controls and pattern density.

### Slice 4: Full prompt rewrite + integration QA

- System prompt rewrite with all module types, scaffolding patterns, and decision rules
- QA with dub techno walkthrough (#994) and other genre scenarios
- Evaluate: does scaffolding help a human reach a desired sound faster than chat-only iteration?

### Scaffold quality QA (every slice)

Each slice must verify not just UI correctness but musical usefulness:
- **Control audibility**: does turning the knob produce an audible, meaningful change?
- **Semantic accuracy**: does a knob labelled "Character" actually sweep a character dimension, or just move one parameter?
- **Useful ranges**: does the control's 0-1 range map to the musically interesting part of the parameter space?
- **Preservation**: do controls survive AI follow-up edits when the human has interacted with them?
- **Speed test**: can the human reach a desired sound faster with the rig than with chat-only iteration?

## Related

- #1379 — Surface modules non-functional
- #994 — E2E dub techno walkthrough
- `docs/principles/ai-collaboration-model.md` — collaboration phases and posture
- `docs/principles/human-capability-parity.md` — bidirectional parity
- `docs/rfcs/ai-curated-surfaces.md` — original surface RFC
- `docs/ai/aesthetic-direction.md` — how taste emerges from collaboration
