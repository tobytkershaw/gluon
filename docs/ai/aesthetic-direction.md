# Aesthetic Direction
## How taste emerges from collaboration state

---

## Status

Design document. Defines how Gluon handles aesthetic direction without a standalone taste subsystem. Extends the collaboration state described in [ai-musical-environment.md](./ai-musical-environment.md).

---

## Core Claim

**Taste is not a separate system. It is what happens when collaboration state is rich enough and the model is prompted to use it well.**

The AI should develop a working model of the human's aesthetic direction and use it to guide decisions — intervention size, candidate generation, preservation, avoidance of rejected directions. But that model lives inside the session's collaboration state, not in a parallel subsystem with its own update rules.

---

## Architectural Alignment

Two existing commitments constrain the design:

1. **"The AI acts when asked"** is a hard product boundary ([ai-capability-doctrine.md](../principles/ai-capability-doctrine.md)). Taste-informed behavior operates within a human-initiated request. It does not trigger autonomous action.

2. **Taste comes from conversation and session context**, not from a separate model ([ai-musical-environment.md](./ai-musical-environment.md)). The session and collaboration layer already includes active brief, approved/rejected directions, comparison candidates, human reactions, and listener observations. Aesthetic direction extends that layer rather than creating a sibling.

---

## What Changes

### 1. Reaction History

A short rolling log of concrete human reactions with enough context to reason about.

```
reactions: [
  {
    event: "user undid AI action group #12",
    context: "AI had widened the bass stereo field",
    user_comment: "too fizzy",
    age_turns: 1
  },
  {
    event: "user approved voice v0",
    context: "kick pattern: four-on-the-floor, dry, punchy",
    age_turns: 3
  },
  {
    event: "user manually reduced brightness on v2 after AI edit",
    context: "AI had set brightness to 0.7, user pulled it to 0.35",
    age_turns: 2
  },
  {
    event: "user chose candidate A over candidate B",
    context: "A was sparser with more swing, B was denser and straighter",
    age_turns: 4
  }
]
```

Each entry records what happened, what the context was, and how recent it is. Entries decay and fall off after a window (15–20 turns or a configurable session limit). The log is append-only from the runtime's perspective — the model reads it but does not write to it.

This replaces pre-classified signal strengths (strong negative, moderate, weak) with raw evidence. The model interprets the evidence in context.

### 2. Observed Patterns

A short natural-language summary of recurring tendencies, maintained by the model as part of its collaboration reasoning. Not a separate subsystem — a field in the collaboration state that the model updates when it observes consistency across multiple reactions.

```
observed_patterns: [
  "User has consistently reduced density when AI adds it (3 instances)",
  "User prefers parameter tweaks over adding new voices",
  "Bright timbres have been rejected twice — both times on the bass voice"
]
```

This replaces dimension scores (`density_preference: medium_low`, `brightness_preference: restrained`). Dimension scores look precise but lose context. "Brightness preference: restrained" doesn't tell the model whether the user dislikes brightness everywhere or only on the bass. The natural-language form preserves specificity.

The model updates observed patterns during its planning step — a reasoning task, not a state machine.

### 3. Approved and Rejected Directions Carry Rationale

The existing `approved_directions` and `rejected_directions` fields gain rationale strings.

```
approved_directions: [
  {
    direction: "Kick remains dry and punchy",
    rationale: "User approved after comparing with roomier version, explicitly said 'keep this'"
  }
]

rejected_directions: [
  {
    direction: "Wide stereo bass",
    rationale: "Undone immediately, user said 'too fizzy' — likely a timbral objection, not a spatial one"
  }
]
```

The rationale gives the model interpretive context. This is especially important for rejections, where the *reason* determines what to avoid. "Too fizzy" is a different constraint from "too wide."

### 4. Project Memories

Persistent, project-scoped memories that survive context rotation and span sessions. Three types:

- **direction** — overall creative direction ("dark, minimal techno with emphasis on sub weight")
- **track-narrative** — per-track character and role notes ("Kick is punchy and dry, no reverb")
- **decision** — key choices made during sessions ("decided to keep bass monophonic for clarity")

Memories are written by the AI via `save_memory`, retrieved via `recall_memories`, and removed via `forget_memory`. Max 30 per project. They appear in the compressed state as a `projectMemory` field — a natural-language summary grouped by type. The AI reads memories at the start of each turn to maintain continuity.

### 5. Restraint Guidance

An explicit restraint field in the collaboration state.

```
restraint: {
  intervention_size: "small",
  basis: "User has preferred parameter adjustments over structural changes throughout this session. Two density additions were undone."
}
```

This is the most important behavioral lever: the model sees it before choosing how large a change to make. Updated by the model alongside observed patterns — a judgment call grounded in evidence.

---

## Prompt Rules for Taste-Informed Behavior

**Within a requested action**, the model should:

- Check the reaction history and observed patterns before choosing intervention size
- Default to the smallest change that addresses the request
- Avoid repeating directions that appear in rejected_directions
- Preserve elements associated with approved_directions
- When multiple valid approaches exist, prefer the one most consistent with observed patterns
- When the restraint field says "small," do not add voices, create new structural elements, or make stylistic pivots unless explicitly asked

**The model should not:**

- Act on inferred taste without a human request (the "acts when asked" boundary holds)
- Treat observed patterns as hard constraints (they are heuristics, not rules)
- Refuse to explore outside established patterns when the user asks it to
- Update the restraint field to be more restrictive without evidence

**When uncertain about taste**, the model should ask: "Last time I widened the bass you pulled it back — should I keep this edit tighter, or do you want to try a different kind of width?"

---

## Relationship to Undo

Undo is one piece of evidence among many, never an automatic trigger.

When an AI action group is undone, the reaction history records the event with context. The model sees it. But it does not mechanically update any state in response. It reasons about the undo in context — possibly asking what was wrong, possibly noting a pattern if it's the third similar undo, possibly doing nothing if the undo is ambiguous.

The undo stack is mixed (human and AI actions interleave), and even AI-provenance undos have multiple interpretations. Contextual reasoning with the option to ask produces better interpretations than automated update rules applied to ambiguous signals.

---

## Relationship to Preservation

Taste-informed behavior depends on preservation being enforceable. "Respect what's been approved" only works if the system can protect approved material during edits.

This document assumes that preservation contracts ([preservation-contracts.md](../rfcs/preservation-contracts.md)) land before or alongside this work:

- `mark_approved` and `preserve_material` operations exist as runtime-enforced tools
- Expansion tools accept preservation constraints as parameters
- The operation executor validates preservation constraints before applying edits

Without these, taste-informed preservation is just a prompt instruction that the model may ignore under pressure. With them, "respect what the user approved" becomes a runtime invariant.

---

## What This Does Not Include

**No standalone taste state.** No `taste_state` object with dimension scores. Aesthetic direction lives in concrete evidence (reactions, approvals, rejections, patterns).

**No mechanical update rules.** No "undo → strong negative update" pipeline. Interpretation is contextual, not mechanical.

**No persistent user taste.** Cross-session taste is partially addressed by per-project AI memory (`save_memory`/`recall_memories`/`forget_memory` tools). The AI can persist creative direction, track narratives, and key decisions across sessions and context rotations. Cross-project user taste (style preferences that transfer between projects) is covered by `docs/rfcs/cross-project-memory.md` and is not yet implemented.

**No autonomy heuristic.** No "high confidence + low impact → act" rule. The collaboration model already provides guidance for choosing between asking, prototyping, and editing.

---

## Implementation

No new subsystem. Extends work already planned for the session and collaboration layer.

### Dependencies

1. **Collaboration state in session** (from ai-musical-environment.md, planned for M4): reaction history, observed patterns, and restraint are additions to this layer.
2. **Preservation contracts** (from preservation-contracts.md): required for taste-informed preservation to be enforceable.

### Incremental Steps

**Step 1: Reaction history.** Add the rolling reaction log to session state. Populate from existing signals: undo events (with AI-provenance tagging), explicit approvals, user comments, manual parameter adjustments following AI edits.

**Step 2: Rationale on approvals and rejections.** Extend the existing approved/rejected directions fields to include rationale strings.

**Step 3: Observed patterns and restraint.** Add these fields. The model updates them during its planning step. Prompt guidance instructs the model to check them before choosing intervention size.

**Step 4: Prompt tuning.** Iterate on the prompt rules. This is where behavioral effects land — not in state machinery, but in how the model reasons about enriched state.

Each step is independently useful and testable. Step 1 alone gives the model better context. Step 3 is where the behavioral effects start to appear. Step 4 is ongoing.

---

## When This Approach Would Be Wrong

If, after implementing enriched collaboration state and tuning prompts, the model consistently fails to:

- notice recurring patterns across reactions
- calibrate intervention size despite clear evidence
- maintain coherent aesthetic direction across many turns

then a more structured taste representation may be needed. The forcing function is evidence from real sessions, not architecture diagrams.

---

## Relationship to Other AI Docs

- [ai-musical-environment.md](./ai-musical-environment.md) — the session and collaboration layer this document extends
- [ai-collaboration-model.md](../principles/ai-collaboration-model.md) — the collaboration phases and posture that taste-informed behavior operates within
- [ai-capability-doctrine.md](../principles/ai-capability-doctrine.md) — the "acts when asked" boundary that constrains taste-informed autonomy
- [preservation-contracts.md](../rfcs/preservation-contracts.md) — the runtime enforcement mechanism that makes taste-informed preservation reliable
