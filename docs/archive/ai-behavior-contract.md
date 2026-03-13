# AI Behavior Contract
## Product behavior that should remain stable while model implementation stays open

---

## Why This Exists

Gluon's collaboration model should not be defined by whichever model happens to perform best this month.

Model and provider choice should remain an implementation question. The required user-facing behavior should be treated as product truth.

This document defines the AI behaviors Gluon should exhibit regardless of whether the underlying implementation uses Gemini, Claude, Codex, Claude Code, a hybrid stack, or future models.

---

## Core Position

**Model choice is an implementation decision. Collaboration behavior is a product decision.**

That means:

- the desired interaction pattern comes first
- provider and model selection remain open
- the runtime should be built around stable contracts and role boundaries
- models should be evaluated against the behavior contract, not the other way around

If a model is strong but consistently pushes Gluon toward the wrong interaction pattern, that is a product mismatch rather than a product requirement.

---

## Required Product Behavior

Regardless of implementation, the AI layer should reliably do the following:

- treat broad prompts as briefs to develop collaboratively
- work in phases rather than jumping to maximal completion
- choose the right level of intervention for the current musical task
- ask clarifying questions when taste or direction is unresolved
- prefer small, audible, reversible edits over large opaque rewrites
- preserve approved ideas during later expansion
- use automated listening to support iteration rather than replace human judgement
- stop for human input at meaningful decision points
- remain legible, inspectable, and undoable

These are the behaviors that matter. They should not change because a different model is swapped in.

---

## Non-Goals

The AI behavior contract explicitly does not require:

- a single-model architecture
- a specific provider
- real-time autonomous generation
- one-shot full-track completion
- continuous model-led convergence without human checkpoints

These may be possible implementations or experiments. They are not the target behavior.

---

## Stable Behavioral Capabilities

Any acceptable implementation should support these user-facing capabilities.

### 1. Framing

The system can narrow an underspecified brief without forcing immediate generation.

Expected behaviors:

- asks a small number of high-value questions
- proposes a few distinct directions when the space is broad
- reflects the user's goal back in clearer musical terms

### 2. Sketching

The system can create a small test artifact before making larger commitments.

Expected behaviors:

- proposes 2-4 bar loops, motifs, timbre studies, or texture studies
- chooses sketches that are cheap to reject
- avoids jumping straight from brief to arrangement

### 3. Guided Iteration

The system can alternate between edits and checkpoints.

Expected behaviors:

- makes focused changes
- explains what changed and why
- offers alternatives when comparison is useful
- adapts after human reaction

### 4. Expansion

The system can scale an approved local idea without losing its identity.

Expected behaviors:

- extends a sketch into a phrase or section after approval
- adds controlled variation
- preserves the selected musical identity

### 5. Refinement

The system can improve what already works rather than constantly replacing it.

Expected behaviors:

- tightens balance, contrast, transitions, repetition, and phrasing
- uses listening and comparison as support tools
- does not treat refinement as an excuse for unnecessary rewrites

---

## Stable Decision Rules

Any model implementation should be able to express these choices:

- when to ask the user
- when to make a sketch
- when to apply a bounded edit
- when to render or listen
- when to expand scope
- when to stop and wait for human judgement

If an implementation cannot make those distinctions reliably, it is not yet a good fit for Gluon.

---

## Human-AI Authority Contract

The following rules are independent of provider choice:

- the AI acts when asked
- the human's hands win in conflicts
- per-voice agency is enforced
- AI actions are inspectable
- AI actions are undoable
- the engine, not the model, is the authority that applies state changes

Any model stack that cannot operate cleanly inside those boundaries should be rejected or tightly scoped.

---

## Implementation Is Open

The following questions should remain open investigations:

- which provider is best for conversational planning
- which provider is best for structured music editing
- whether a coding agent is useful as a specialist subsystem
- whether automated listening should be done by the same model or a separate one
- whether different phases benefit from different models
- what level of multimodal audio understanding is actually useful in practice

The architecture should be designed so those questions can be answered experimentally without redefining product behavior each time.

---

## Recommended Architectural Stance

To keep implementation open, Gluon should define stable internal roles rather than stable provider choices.

Useful role boundaries:

- `planner` or `conductor`: decides phase, chooses next action type, manages collaboration flow
- `editor`: proposes bounded musical edits or structured project changes
- `listener`: evaluates rendered audio and returns structured critique
- `engine`: validates and applies actions, enforces permissions, records undo

One model may fill several roles, or different models may fill different roles. The role contract should stay stable even if provider choice changes.

---

## Evaluation Criteria For Models

Models should be judged against the behavior contract, not only against output quality.

Questions to ask:

1. Does the model ask useful narrowing questions rather than overcommitting?
2. Does it reliably choose small next steps when the brief is broad?
3. Does it preserve approved local ideas during expansion?
4. Does it make bounded edits cleanly and legibly?
5. Does it know when to stop and wait for human judgement?
6. Does it use listening appropriately rather than substituting for the user?
7. Can it operate inside Gluon's authority, agency, and undo rules?
8. Can it maintain coherent behavior across multiple iterations?

This is the right basis for comparing Gemini, Claude, Codex, Claude Code, or hybrid systems.

---

## What This Means For Embedding

Embedding a coding agent is an implementation option, not a product commitment.

A coding agent may be useful for:

- structured editing
- sequencer or rule generation
- diagnostics
- constrained multi-step tool use

But embedding a coding agent does not remove the need for:

- a collaboration planner
- phase-aware interaction
- human checkpoints
- bounded engine-level validation

If Codex or Claude Code is used, it should be because it satisfies part of the behavior contract better than alternatives, not because Gluon has decided its identity is "an embedded coding agent for music."

---

## Product Test

When making AI architecture decisions, ask:

1. Are we keeping the behavior contract stable while changing implementation?
2. Are we choosing the model to fit the product, rather than changing the product to fit the model?
3. Can this implementation be swapped or re-scoped without redefining Gluon's interaction model?
4. Does this increase capability without drifting toward one-shot generation?
5. Does this preserve staged, legible, human-directed collaboration?

If the answer to those questions is "no", the implementation is probably exerting too much product influence.

---

## Summary

Gluon should define the collaboration behavior it wants first, then treat models, providers, and embeddings as interchangeable implementation candidates.

The stable thing is the human-AI interaction model. The variable thing is how that behavior is delivered.
