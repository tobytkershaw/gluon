# AI Interface Design Principles
## Designing Gluon as an instrument the model can actually use

---

## Why This Exists

Gluon is not a chatbot wrapped around a synth. It is a shared instrument where a human directs an AI to make musical changes inside a live project.

That means the core design problem is not "how do we parse model output safely?" The deeper problem is:

**How do we build an environment the model can understand, reason about, and act within coherently?**

If we get that wrong, the model is reduced to performing formatting tricks for our parser. It stops being a musical agent operating an instrument and becomes a text generator trying to guess our internal protocol.

This document defines the principle we should apply across Gluon whenever we expose state, actions, constraints, or feedback to the model.

---

## The Core Principle

**Treat the model as an agent operating an instrument, not as a text emitter that must simulate our internals.**

Our responsibility is to give the model:

- A legible world
- A meaningful action space
- Clear constraints
- Useful feedback about consequences

The model's responsibility is to choose what to do within that world.

This is the fundamental posture behind Gluon.

We do not want a system where:

- the model has to remember arbitrary output syntax
- intent is recovered with regexes and heuristics
- capabilities exist conceptually but not operationally
- constraints are hidden in post-processing
- the model is forced to "pretend" to be a protocol compiler

We do want a system where:

- the available actions match the musical task
- the state representation is compact, structured, and meaningful
- the model can inspect, act, and speak through first-class interfaces
- outcomes are returned in a form that supports further reasoning
- the boundaries of allowed action are explicit and coherent

In short:

**Build affordances, not extraction pipelines.**

---

## What "Respecting the Model's Intelligence" Means

Respecting the model's intelligence does not mean giving it unrestricted freedom. It means giving it a well-designed environment.

A strong model should not be forced to spend its reasoning budget on:

- remembering exact JSON wrappers
- guessing which phrases trigger special hidden modes
- reverse-engineering what the application is capable of
- working around mismatches between prompt instructions and runtime behavior

Instead, its reasoning should be spent on the musical problem:

- what to change
- where to change it
- whether to listen first
- how much to adjust
- whether to act or just reply
- how to respond to the human's direction and taste

The more legible the system is, the more of the model's intelligence is applied to music rather than protocol recovery.

---

## Design Rules

### 1. Expose capabilities, not output formats

The primary interface to the model should be tools, operations, and structured state, not instructions to emit text in a machine-readable shape.

Bad pattern:
- "Reply with a JSON array matching this schema"

Better pattern:
- "Here are the tools available to you: move, sketch, listen, set_transport"

The model should choose actions by using capabilities, not by imitating an API by hand.

### 2. Make the action space match the task

The model should be able to act in terms that are musically meaningful.

If Gluon conceptually allows the AI to:

- change a control
- write or replace a pattern
- listen to the result
- adjust transport

then those should exist as explicit operations in the model interface.

Capabilities should not exist only in human code paths or hidden branches while the model is expected to infer them indirectly.

### 3. Make state legible and decision-ready

The state we expose should help the model decide what to do next.

That means state should be:

- compressed
- structured
- semantically named
- aligned with the available actions

It should answer practical questions such as:

- Which voices exist?
- Which ones have agency ON?
- What is currently playing?
- What has the human changed recently?
- What is the current tempo and swing?
- What patterns and parameters are already present?

State should be optimized for reasoning, not for mirroring every internal implementation detail.

### 4. Put constraints in the environment, not only in prose

If the AI cannot touch a voice with agency OFF, that should be reflected in the state and enforced by execution.

If transport changes are allowed, that should be a real tool.

If listening requires playback, the system should return that consequence clearly.

Do not rely on the prompt alone to carry operational truth. The runtime must embody the rules of the system.

### 5. Let the model choose between acting, inspecting, and speaking

The model should be able to:

- act when a change is appropriate
- listen when evaluation is needed
- speak when no action is warranted

We should not hard-route these choices with brittle heuristics unless there is a real safety or product reason.

The system should allow the model to decide whether the next best step is:

- "make a change"
- "listen first"
- "explain what I hear"
- "ask for clarification"
- "do nothing but respond"

### 6. Return consequences, not just acknowledgements

Tool responses should help the model continue reasoning.

Weak result:
- "applied"

Stronger result:
- what changed
- what failed
- what values were clamped
- what audio critique came back
- what state now matters for the next step

The model is more effective when the environment reports outcomes in a way that supports follow-up decisions.

### 7. Align conceptual and operational truth

One of the easiest ways to make an AI system incoherent is to let the prompt describe a world that the runtime does not actually implement.

Examples of misalignment:

- telling the model it can do something that has no corresponding tool
- hiding a capability behind a regex instead of exposing it directly
- claiming the AI can control transport while undo, feedback, or execution paths do not support it coherently

If something is part of the model's job, it should be represented consistently across:

- prompt
- tool declarations
- state representation
- execution layer
- feedback loop
- undo and audit behavior

### 8. Design for composability

The model should be able to combine simple actions into higher-level behavior.

For example:

- listen, then sketch
- set transport, then listen
- move multiple controls, then explain

This is better than encoding special-case workflows in hidden routing logic.

Composable primitives produce a more general and more intelligible system.

### 9. Keep the human's authority explicit

Treating the model as an agent does not weaken the human's authority. It depends on it.

Gluon's model of collaboration requires:

- the AI acts when asked
- per-voice agency is respected
- human touch wins in conflicts
- AI actions are inspectable
- AI actions are undoable

These are not implementation details. They are part of the instrument's social contract.

When adding new model capabilities, we should preserve this contract.

### 10. Prefer coherent affordances over clever hacks

If a feature works only because we:

- regex-detect intent
- scrape malformed text
- special-case one phrase
- inject hidden context to simulate missing tools

then we should treat that as a temporary bridge, not as architecture.

Temporary hacks are acceptable during exploration. They should not become the mental model of the system.

---

## Heuristic For New AI Features

When adding a new AI capability, ask:

1. Is this a real capability the model should have, or just parser glue?
2. Can it be expressed as a clear tool or structured operation?
3. Does the exposed state give the model enough information to use it well?
4. Are the constraints explicit in both state and runtime behavior?
5. Does the model receive meaningful feedback after using it?
6. Is the behavior undoable, inspectable, and consistent with human control?
7. Have we reduced hidden routing logic, or added more of it?

If the answer to most of these is "no", the design is probably not ready.

---

## Implications For Gluon

This principle should shape the entire AI layer.

### Prompts

Prompts should orient the model to its role, musical context, and behavioral rules. They should not be long protocol manuals for producing machine-readable text.

### Tools

Tools should be the main way the model acts on the project. They should map to real musical operations and expose the consequences of using them.

### State Compression

State compression should make the current project musically legible and operationally relevant. It should help the model choose good actions, not drown it in raw data.

### Listening

Listening should be a first-class operation the model can choose when it needs evidence from sound, not a hidden mode triggered by phrase matching.

### Transport and Session Controls

If transport is part of the shared instrument, it should be represented coherently as part of the model's environment, including the same standards for control, visibility, and reversibility that apply elsewhere.

### Undo and Audit

Every AI-originated change that matters to the human should remain traceable and reversible. The system should not quietly create a second class of AI actions that escape the collaboration contract.

---

## Non-Goals

This principle does not imply:

- full autonomy
- continuous unsolicited action
- unrestricted access to all internals
- replacing product constraints with model judgment

The point is not to "let the model do anything."

The point is to give it a coherent world in which it can do the right things well.

---

## One-Sentence Summary

**Design Gluon so the model uses the instrument through clear affordances and real feedback, rather than forcing it to simulate hidden protocols through text.**

---

## Capability Doctrine

See [ai-capability-doctrine.md](./ai-capability-doctrine.md) for the project-level doctrine that complements these interface principles.

The short version is:

**Constrain the AI at the product boundary. Empower it aggressively inside that boundary.**
