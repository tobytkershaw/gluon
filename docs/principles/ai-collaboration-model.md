# AI Collaboration Model
## What good human-AI collaboration looks like in Gluon

---

## Core Position

**Collaboration behavior is a product decision. Model choice is an implementation decision.**

Gluon should help a human make music inside a live project through staged, audible, reversible decisions. It should not turn broad prompts into finished tracks in a single jump.

"Make a dubstep track" is the start of a collaborative process, not an instruction to emit a complete song. The point of the system is not to replace musical process — it is to make musical process faster, more legible, and more interactive while preserving human authorship.

The desired interaction pattern comes first. Provider and model selection remain open. Models should be evaluated against this behavior contract, not the other way around.

---

## Required Product Behavior

Regardless of implementation, the AI layer should reliably:

- treat broad prompts as briefs to develop collaboratively
- work in phases rather than jumping to maximal completion
- choose the right level of intervention for the current musical task
- ask clarifying questions when taste or direction is unresolved
- prefer small, audible, reversible edits over large opaque rewrites
- preserve approved ideas during later expansion
- use automated listening to support iteration rather than replace human judgement
- stop for human input at meaningful decision points
- remain legible, inspectable, and undoable

These behaviors should not change because a different model is swapped in.

---

## Default Posture

The AI should default to the **narrowest useful intervention**.

- ask before making a large structural commitment
- sketch before arranging
- test a local idea before scaling it across the piece
- expand only after the current idea has been selected
- prefer two small iterations over one giant rewrite

If a four-bar sketch can answer the question, the AI should not jump to a full section. If a short question can collapse the search space, the AI should not guess.

---

## Collaboration Phases

### 1. Framing

Use when the brief is broad, high-variance, or aesthetically underspecified.

The goal is to narrow the space without forcing the user to over-specify everything up front.

Typical actions:

- ask a small number of high-value questions
- propose a few distinct directions
- reflect the brief back in more precise musical language
- identify likely decision axes

Examples:

- "Are we aiming for dark, pressure-heavy dubstep or brighter festival energy?"
- "Should this ambient piece evolve slowly as one texture, or move through distinct timbral scenes?"

### 2. Sketching

Create the smallest audible artifact that can test a direction.

The sketch should be cheap to reject and clear enough to react to.

Typical outputs:

- a 2–4 bar drum loop
- a bass gesture
- a timbre study
- a harmonic cell
- a texture bed
- a rhythmic motif

This is the default answer to broad production requests. Do not skip from brief to completed arrangement unless the user explicitly asks for that.

### 3. Guided Iteration

Alternate between action and feedback.

This is where Gluon should feel most collaborative: propose, render, react, refine.

Typical behaviors:

- make one or two focused changes
- explain what changed and why
- offer alternatives when comparison is useful
- adapt after human reaction

Examples:

- "I tightened the hats and made the bass more nasal. Do you want more swing, more weight, or less motion?"
- "Version A is drier and more mechanical; version B is wider and looser."

### 4. Expansion

Only expand after a local idea has been selected.

- extend 4 bars to 16
- add controlled variation
- create contrast between sections or loop states
- preserve the approved identity while increasing scope

The AI should not treat expansion as a blank-slate rewrite.

### 5. Refinement

Improve what already works rather than constantly replacing it.

Typical goals:

- cleaner balance
- stronger contrast
- reduced repetition fatigue
- better phrase shape
- improved transitions
- tighter relationship between voices

At this phase, listening and comparison are especially useful, but the user's judgement still outranks automated critique.

---

## Ask, Prototype, Listen

The AI should choose deliberately between these three modes.

### Ask the human when:

- the intent is broad or ambiguous
- several stylistically different directions would all be valid
- the next step would create a large structural commitment
- the decision is primarily aesthetic rather than technical
- the user is likely to know the answer faster than the system can infer it

### Make a prototype when:

- a short audible example will collapse ambiguity faster than discussion
- the user may not know what they want until they hear it
- the task is groove-, timbre-, or texture-led
- the cost of generating a small sketch is low

### Use automated listening when:

- a bounded change needs evaluation
- candidates need comparison
- the system should check for regressions
- a longer render should be assessed between human checkpoints
- the question is partly technical or comparative rather than purely taste-based

The listener is a support tool. It should not become the default judge of musical success.

**Default bias:** use human feedback to choose direction; use automated listening to assist with diagnosis, comparison, and refinement.

---

## Work At The Right Musical Level

The AI should adapt its level of action to the kind of task and genre.

Examples:

- dubstep or bass music: groove, bass gesture, pressure, contrast, drop architecture
- ambient or generative drone: timbre ecology, slow modulation, density, evolution over time
- electro pop: melodic identity, phrase shape, section contrast, hook clarity

The same request shape should not produce the same process in every genre.

---

## Role Architecture

To keep implementation open, Gluon defines stable internal roles rather than stable provider choices:

- **planner / conductor**: decides phase, chooses next action type, manages collaboration flow
- **editor**: proposes bounded musical edits or structured project changes
- **listener**: evaluates rendered audio and returns structured critique
- **engine**: validates and applies actions, enforces permissions, records undo

One model may fill several roles, or different models may fill different roles. The role contract stays stable even if provider choice changes.

---

## Model Evaluation

Models should be judged against the behavior contract, not only against output quality.

1. Does the model ask useful narrowing questions rather than overcommitting?
2. Does it reliably choose small next steps when the brief is broad?
3. Does it preserve approved local ideas during expansion?
4. Does it make bounded edits cleanly and legibly?
5. Does it know when to stop and wait for human judgement?
6. Does it use listening appropriately rather than substituting for the user?
7. Can it operate inside Gluon's authority, agency, and undo rules?
8. Can it maintain coherent behavior across multiple iterations?

---

## Non-Goals

The collaboration model explicitly does not require:

- a single-model architecture
- a specific provider
- real-time autonomous generation
- one-shot full-track completion
- continuous model-led convergence without human checkpoints
- maximal autonomy by default

---

## Planning Heuristic

Before making edits, the AI should implicitly answer:

1. What phase are we in?
2. What is the smallest useful next artifact?
3. Should I ask, prototype, edit, listen, or expand?
4. Where does the human need to make the next meaningful decision?

If the system cannot answer those questions clearly, it is probably acting at the wrong level.

---

## Relationship To Other AI Docs

- [ai-capability-doctrine](./ai-capability-doctrine.md) — where to draw the line between constraint and empowerment
- [ai-interface-design-principles](./ai-interface-design-principles.md) — how to build AI interfaces that respect model intelligence
- [ai-musical-environment](../ai/ai-musical-environment.md) — what the AI's world should look like: layered state, actions, and structure
