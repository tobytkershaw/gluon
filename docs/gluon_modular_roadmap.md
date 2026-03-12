# Gluon Roadmap: From Agentic Synth Assistant to AI-Assisted Modular Patching

## Purpose

This roadmap sets out a realistic path from Gluon’s current direction - an agentic music assistant operating on a shared instrument and project state - toward a richer long-term vision: AI-assisted modular patch design built on the Mutable Instruments DSP catalogue.

The goal is not to jump straight from a single Plaits-based voice to a full virtual Eurorack environment. The goal is to expand Gluon in stages, preserving the core product thesis at each step:

- the user works on a real instrument, not a black-box generator
- the AI operates on structured musical state
- every AI action is inspectable, editable, and undoable
- the user can always take over directly

This roadmap assumes the current Gluon pivot remains in place: chat-first, request-driven, project-aware, with AI acting when asked rather than as a live co-performer.

---

## Strategic Thesis

The Mutable Instruments catalogue is not just a source of more synth voices. It is an open modular music system: oscillators, resonators, granular processors, modulators, utilities, filters, and algorithmic composition tools.

That matters because modular patching is exactly the kind of activity where an AI assistant can add real value.

It is:

- knowledge-intensive
- highly parameterised
- hard for beginners to enter
- rich in reversible structured edits
- well suited to natural-language goals like "make this more unstable", "add shimmer without losing punch", or "build a patch that slowly blooms over 16 bars"

So the long-term opportunity is not merely "Gluon supports more MI modules".

It is:

**Gluon becomes an AI-assisted patch design environment, where the AI can help construct, explain, modify, and simplify modular signal chains in response to musical intent.**

---

## Guiding Principles

### 1. Expand only after the core assistant loop is strong

Gluon should not move into modular graph design until the basics are solid:

- ask -> AI edits -> user listens -> undo / refine
- clear action reporting
- reliable grouped undo
- stable project state model
- strong direct-manipulation workflow alongside chat

The modular roadmap depends on this loop working well first.

### 2. Start with constrained modularity, not full freedom

The end state may be a highly flexible graph-based modular environment. The first useful version should be much narrower.

The AI should begin by building and editing simple chains, not arbitrary patch spaghetti.

### 3. Keep the patch legible

An AI-designed modular environment only works if users can understand what was built.

The UI and action model should make the patch readable through:

- graph visualisation
- natural-language patch summaries
- grouped operations
- named modules and clear signal flow
- reversible edits

### 4. Prefer the smallest patch that satisfies the goal

The AI should be biased toward minimal, musically coherent patches rather than over-complicated ones.

### 5. Separate musical state from graph topology

As Gluon evolves, it should distinguish between:

- patch structure
- runtime/performance state
- AI edit operations

This will keep the system understandable and extensible.

### 6. Constrain the boundary, empower the AI inside it

The roadmap should not treat every increase in AI capability as a risk to be minimized. The fixed product boundaries already do that work:

- the AI acts when asked
- the user can inspect what changed
- undo remains dependable
- permission rules remain explicit

Inside that contract, Gluon should bias toward making the AI more useful:

- richer first-class operations
- better state visibility
- better consequence reporting
- stronger inspect/explain/compare abilities

The goal is not merely safe AI patch editing. The goal is the most capable musical assistant that still obeys Gluon's collaboration contract.

---

## Roadmap Overview

### Phase 3 foundation
Strengthen the current agentic assistant on single-voice and simple project editing.

### Phase 4A
Move from single voices to AI-assisted patch chains.

### Phase 4B
Introduce guided modular patching with a constrained graph model.

### Phase 5
Add composition-aware modular tools such as Grids and Marbles.

### Phase 6
Expand toward a fuller modular environment with richer routing, macro structures, and deeper AI patch editing.

---

# Phase 3 Foundation: Lock the Core Assistant Loop

## Goal

Establish the Gluon interaction model that everything else will rely on.

## Deliverables

- chat-first assistant loop is reliable and pleasant
- AI can inspect project state and apply structured edits
- grouped undo works well
- action logs are clear and useful
- user can directly tweak the instrument before and after AI edits
- audio evaluation, if included, is optional and human-triggered

## Why this phase matters for the roadmap

Without a strong base assistant loop, modular expansion will just multiply complexity. The value of later phases depends on users already trusting the system to:

- make sensible edits
- explain itself when asked
- stay within scope
- be easy to undo

## Exit criteria

- users can ask for meaningful timbral and musical changes and get good results
- undo is dependable and grouped in musically sensible units
- project state representation is stable enough to extend
- the system prompt and action vocabulary feel aligned with the product

---

# Phase 4A: AI Patch Chains

## Goal

Move from "one voice with parameters" to "a small chain of modules".

This is the first step toward modularity, but it should still feel simple and instrument-like.

## Product shape

Instead of one Plaits voice being the whole sound, a voice can become a small signal chain such as:

- Plaits -> Rings
- Plaits -> Clouds
- Plaits -> Ripples -> Clouds
- Elements -> Blades

The AI can help create and edit these chains in response to requests like:

- "put this through something more resonant"
- "add a grainy wash after the oscillator"
- "make this patch more metallic"
- "simplify the chain but keep the shimmer"

## Scope constraints

This phase should be intentionally narrow:

- one source module per voice
- up to two downstream processors
- one or two modulation sources
- no arbitrary feedback loops
- clear left-to-right signal path
- no fully general patch graph yet

## Technical model

Introduce a chain model rather than a full graph:

```text
Voice {
  source: Module
  processors: [Module]
  modulators: [ModulationSource]
  params: per-module params
}
```

This gives you far more expressiveness than a single synth voice without taking on full graph complexity.

## AI action extensions

Add structured operations such as:

- add_processor
- replace_processor
- remove_processor
- set_module_param
- add_modulation
- adjust_modulation_depth
- simplify_chain

This is the minimum structural layer. Once the basic chain model is real, Gluon should bias toward richer first-class assistant capabilities rather than stopping at low-level patch editing verbs.

## UI expectations

- chain view is clearly visible
- modules are visually ordered
- each AI action is shown in an action log
- the user can bypass or remove modules manually
- undo treats a multi-step chain edit as one action group

## Exit criteria

- AI can build and edit simple signal chains reliably
- users can understand what the chain is doing
- chain edits remain musically coherent and reversible
- the system stays fast enough to feel interactive

## Why this phase is valuable

This is likely the first phase where Gluon starts to feel genuinely differentiated. It moves from AI-controlled synth tweaking into AI-assisted sound design.

---

# Phase 4B: Guided Modular Patching

## Goal

Move from chains to a constrained modular graph.

This is the point where patching becomes a first-class concept, but still inside product guardrails.

## Product shape

A voice becomes a small modular patch with modules and routings, but the system still imposes structure to keep things legible.

Examples:

- Plaits feeding Rings and Clouds in parallel
- Tides modulating Clouds density while an envelope controls filter cutoff
- Warps or Ripples inserted conditionally in one branch

The AI can now do things like:

- "route Plaits through Rings into Clouds"
- "modulate grain density slowly"
- "split the oscillator into a dry and processed path"
- "replace the filter with something more aggressive"

## Technical model

Shift from chain to graph:

```text
Voice {
  modules: [Module]
  connections: [Connection]
}

Module {
  id: ModuleID
  type: ModuleType
  params: Map<ParamID, f32>
}

Connection {
  from: { module: ModuleID, output: OutputID }
  to: { module: ModuleID, input: InputID }
  amount: f32
}
```

## Recommended constraints

For the first guided modular release:

- no arbitrary cycles
- only validated graph topologies
- capped module count per voice
- a limited module catalogue
- strong validation rules before graph changes are applied
- clear topological execution order

## AI action vocabulary

Expand the assistant with graph-edit operations:

- add_module
- remove_module
- connect
- disconnect
- reroute
- replace_module
- set_connection_amount
- collapse_region_to_macro
- simplify_patch

## UX requirements

This phase only works if patch legibility is treated as core product work.

Needed elements:

- graph view with clear signal flow
- collapsible complexity
- natural-language patch summaries
- "what changed" descriptions for graph edits
- fast bypass, mute, and revert operations

## Exit criteria

- AI can build small valid modular patches from natural language
- users can inspect and understand what was created
- undo and action grouping remain reliable
- patches are stable enough to save and revisit

## Why this phase matters

This is the point where Gluon becomes more than an assistant for a fixed instrument. It becomes a system for constructing instruments.

---

# Phase 5: Algorithmic Composition Modules

## Goal

Add modules that generate musically useful movement and structure, not just sound processing.

The most important candidates are:

- Grids
- Marbles
- possibly Stages or related control/sequencing utilities

## Why this phase is special

These modules sit right at the boundary between sound design and composition. They give the AI a richer musical vocabulary than direct step editing alone.

Examples:

- "give me a shuffling broken beat"
- "make the hats evolve more over time"
- "generate a tonal but slightly drifting melody"
- "keep the rhythm recognisable but less repetitive"

These requests map naturally to tools like Grids and Marbles.

## Product opportunities

- AI can configure generative rhythm patterns instead of writing every step manually
- AI can set randomness levels musically rather than numerically
- users can explore families of patterns by moving through a 2D or constrained parameter space
- the system can combine deterministic sequencing with controlled stochastic variation

## Technical additions

- sequencing/state model extended to support generative sources
- transport-aware evaluation and preview
- richer project-state summaries for the AI
- better pattern visualisation

## Risks

- random tools can easily become chaotic or unsatisfying
- the AI may overuse algorithmic modules because they are expressive
- users need clear ways to freeze, tame, or commit generated behaviour

## Exit criteria

- AI can meaningfully use Grids/Marbles-style tools to satisfy musical requests
- users can understand and control the randomness
- generated patterns feel musical rather than arbitrary

---

# Phase 6: Fuller Modular Environment

## Goal

Expand from guided modular patching into a more capable modular environment while preserving usability.

This phase is not about copying Eurorack in full. It is about deciding how much modular freedom Gluon can support without losing its strengths.

## Possible additions

- broader Mutable catalogue support
- richer branching topologies
- patch templates and reusable macro modules
- user-defined macros built from module groups
- multi-voice patch coordination
- more advanced modulation routing
- deeper DAW and sequencer integration
- patch save/share/fork workflows

## AI opportunities

At this point the AI can do more than just assemble patches. It can also:

- explain signal flow in plain language
- simplify overly complex patches
- convert a patch into a macro-oriented version
- propose alternative routings for the same musical goal
- analyse a patch for likely sonic consequences before applying changes

## Main challenge

The challenge in this phase is product discipline. The risk is building something technically impressive but too complex to remain legible.

The question to keep asking is:

**Does this still feel like an instrument with an intelligent assistant, or has it become a generic modular sandbox with AI layered on top?**

---

# Cross-Cutting Workstreams

## 1. Patch Representation and Validation

Across phases 4 to 6, Gluon will need a stable internal model for:

- module definitions
- input/output types
- valid connection rules
- graph validation
- serialisation and persistence
- migration as the patch model evolves

This is foundational work and should be treated as product infrastructure.

## 2. AI Operation Layer

As modularity increases, raw state diffs become less useful. The AI should increasingly act in terms of high-level patch operations rather than direct low-level mutations.

Examples:

- insert processor after source
- split dry/wet path
- add slow modulation to selected parameter
- replace filter while preserving neighbouring structure
- simplify this patch but keep the spectral movement

These operations should become the main unit of explanation, logging, and undo grouping.

As the patch model matures, the vocabulary should expand not only downward into more precise edit operations, but upward into more useful assistant capabilities: explain, compare, simplify while preserving intent, and propose better human-facing controls over complex patches.

## 3. Patch Legibility and Explanation

The AI should not only build patches. It should help users understand them.

Important capabilities:

- summarise current patch in plain language
- explain why a module was added
- describe likely sonic consequences of a routing
- compare two alternative patch structures

This is central to beginner value and also useful for experts.

## 4. Performance and Execution Model

The deeper Gluon goes into modularity, the more the execution architecture matters.

Long-term target:

- efficient graph execution
- sample-accurate modulation and routing
- minimal per-module overhead
- predictable behaviour as patch complexity increases

The likely end-state is a unified graph execution model rather than many loosely coordinated processing nodes, but this should be approached incrementally.

## 5. Safety, Scope, and Musical Restraint

As the AI gains patch-level power, it needs stronger behavioural guidance.

Important defaults:

- prefer minimal changes
- avoid unnecessary complexity
- preserve playability
- add modules only when they serve a clear audible goal
- keep generated patches understandable unless the user explicitly asks for complexity

---

# Decision Gates

Before moving from one phase to the next, Gluon should pass explicit product checks.

## Gate A: Before Phase 4A

- Is the core assistant loop already strong enough?
- Do users trust undo and action logs?
- Is project state stable enough to extend?

## Gate B: Before Phase 4B

- Are patch chains already genuinely useful?
- Do users understand AI edits to signal flow?
- Is the current UI ready for graph complexity?

## Gate C: Before Phase 5

- Does guided modular patching already feel coherent?
- Is the AI good enough at patch construction to justify algorithmic composition tools?
- Can generated movement be controlled and explained?

## Gate D: Before Phase 6

- Is Gluon still legible and musical as complexity rises?
- Are users benefiting from extra modular freedom, or just getting lost?
- Is the AI improving instrument design, not just adding complexity?

---

# What Not to Do Too Early

To keep the roadmap healthy, avoid these traps:

## 1. Do not jump straight to full arbitrary modular graphs

That will maximise complexity before the product language is ready.

## 2. Do not let the AI over-patch to look clever

More modules is not the same as better sound.

## 3. Do not treat DSP compilation as the whole problem

Graph representation, UI legibility, undo semantics, and explanation quality matter just as much.

## 4. Do not let modularity outrun the assistant model

The AI needs to remain understandable and musically restrained as its power grows.

## 5. Do not lose the current Gluon thesis

Gluon should remain an instrument with an assistant, not become an opaque auto-music system.

---

# Near-Term Recommendation

Once the current Gluon basics are locked in, the best next step is not "full modular".

It is:

**Phase 4A: AI patch chains using a small curated subset of Mutable Instruments modules.**

Recommended initial subset:

- Plaits or Braids as sound source
- Rings or Ripples as first processor options
- Clouds or Beads as second-stage texture processor
- Tides as initial modulation source

This set is rich enough to create genuinely interesting patches while staying understandable.

A good first milestone would be:

- AI can create a chain such as Plaits -> Rings -> Clouds
- AI can add one modulation source
- user can inspect, tweak, bypass, and undo every step
- AI can explain the patch in plain language

That would already be a compelling and differentiated product milestone.

---

# Final View

The long-term opportunity is real.

The Mutable Instruments ecosystem gives Gluon a path from an AI-assisted synth to an AI-assisted instrument-building environment. That is a strong direction because it fits Gluon’s current architecture and product thesis:

- structured musical state
- reversible edits
- natural-language control
- real instrument underneath
- AI as collaborator and guide rather than black-box generator

The right way to get there is incrementally:

- first a strong assistant loop
- then patch chains
- then guided modular graphs
- then algorithmic modules
- then deeper modular freedom

If Gluon stays disciplined about legibility, restraint, and user control, this could become one of its most distinctive long-term directions.
