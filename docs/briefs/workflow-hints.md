# Workflow Hints: From Toolbox to Workbench

## Context

During a composition session (2026-03-18), Gluon identified a recurring problem: it has all the tools but reconstructs workflows from scratch every turn. The AI knows how to render, diff, sketch, and slot — but has no named patterns that compose these primitives into production-level sequences. This causes errors like #871 (bars default) where context that the system already has doesn't flow to where it's needed.

This brief captures the design direction for **workflow hints** — named production patterns that the AI can follow when relevant and ignore when not.

## Design Principles

1. **Hints, not macros.** Workflow hints are guidance in the system prompt, not hard-coded multi-step procedures. The AI is free to skip, adapt, or combine them based on context. The moment a workflow is rigid, it breaks for the 50% of songs that don't follow the expected structure.

2. **Make tools smarter first.** Before adding a workflow hint, ask: can the tool infer the right behavior from context? If yes, fix the tool (like #871 — bars should default to pattern length). Workflow hints are for sequences that genuinely require multiple tool calls with creative judgment between them.

3. **Named by intent, not by steps.** Workflows should be named for what the producer wants ("verify my edit", "slot the mix", "build a section"), not for the tool sequence ("render-edit-render-diff"). The AI maps intent to steps; the hint just reminds it which steps matter.

4. **Composable.** Workflows can nest. "Build a section" might include "slot the mix" for each new track added. Keep them modular.

5. **Nothing mandatory, primitives always accessible.** Every abstraction layer (recipes, spectral slotting, auto-diff) is a convenience tool, never a replacement for the underlying primitives. The AI must always be able to wire modulation manually, set EQ bands directly, or run render/diff as separate steps. Abstractions that hide primitives violate the instrument principle — you can't play an instrument that won't let you touch the controls. This follows directly from principle #7 in the AI interface design principles: constrain physics, free aesthetics. A recipe that provides good defaults is a physics constraint (saves time, prevents bad values). A recipe that *replaces* manual wiring is an aesthetic constraint (forces one way of doing things).

6. **Lint, don't gate.** When tools detect potentially problematic states (frequency masking, unusually high parameter values, missing spectral slots), they should return **advisory warnings in the tool result**, not block execution. The AI reads the warning, decides if it's relevant to the current creative intent, and moves on. A My Bloody Valentine shoegaze track *wants* a muddy mix — a gate that prevents frequency overlap would kill the genre. A warning that says "4 tracks overlap in the low-mids" lets the AI decide whether that's a problem or the point. This is the same model as ESLint: warn about `any`, don't prevent compilation.

## Identified Workflows

### 1. Verify & Diff

**Intent:** Confirm that an edit had the intended sonic effect.

**When:** After any sound design or mix change where the human asked for a specific outcome ("make it darker", "bring up the bass", "reduce harshness").

**Pattern:**
- Render snapshot (before state — often already exists from previous turn)
- Make edits
- Render snapshot (after state)
- analyze(types: ['diff']) — compare the two snapshots
- Report: did the measured change match the intent?

**Status:** The system prompt already describes this (line 452-457). The gap is that Gluon doesn't reliably trigger it — it often makes edits and claims success without measuring. Two possible interventions:
- **Tool-level:** The sketch/edit tools could auto-render before/after and return a diff summary alongside the edit result, so verification is zero-cost.
- **Prompt-level:** Strengthen the hint to say "you MUST verify with diff when the human's request implies a measurable change."

### 2. Top-Down Spectral Slotting

**Intent:** Proactively assign frequency ranges before mixing, rather than reactively fixing mud.

**When:** After adding a new track to a mix with 3+ active tracks, or when starting a new section.

**Pattern:**
- Review all active tracks' musical roles
- Run assign_spectral_slot to allocate non-overlapping frequency bands by role priority
- Apply EQ/filter settings based on slot assignments
- Render and verify no masking between adjacent slots

**Status:** The `assign_spectral_slot` tool exists. The gap is proactive use — Gluon only slots reactively when it hears problems. The hint should frame slotting as a "setup" step when adding tracks, not a "fix" step.

### 3. Macro Arrangement (Section Building)

**Intent:** Turn a loop into a multi-section song structure.

**When:** When the human says "let's make this into a full track" or "build an intro/drop/breakdown."

**Pattern:**
- Identify the core groove pattern
- For each target section: sketch new patterns (not just duplicate-and-modify — sections need distinct identity)
- Set section metadata (energy, density targets)
- Sequence the sections across all tracks consistently
- Verify energy arc: render section transitions, listen for contrast

**Status:** The arrangement thinking section (line 519-551) covers this well at a procedural level. The gap is that Gluon doesn't treat it as a coherent workflow — it builds one track's arrangement, then another, losing cross-track consistency. The hint should emphasize "build all tracks for one section before moving to the next section."

### 4. Modulation Recipes

**Intent:** Apply common modulation patterns by musical name rather than manual wiring.

**When:** When the human asks for a musical effect that implies modulation ("slow filter sweep", "pulsing pad", "wobble bass", "ducking sidechain").

**Pattern:**
- Map the musical intent to a modulation configuration (modulator type, rate, depth, target)
- Add modulator to track
- Wire modulation route
- Set parameters to match the named recipe
- Render and verify the modulation is audible and at appropriate depth

**Status:** `apply_modulation` exists but has no named recipe system. Two options:
- **Tool-level:** Add a `recipe` parameter that maps musical names to configurations. The tool resolves the recipe to concrete parameters.
- **Prompt-level:** Include a lookup table of common recipes in the system prompt so the AI can set parameters directly.

Tool-level is preferred — it keeps the prompt shorter and recipes maintainable.

## Implementation Strategy

| Workflow | Intervention | Issue |
|----------|-------------|-------|
| Verify & Diff | Auto-diff in sketch/edit tools + stronger prompt hint | #877 |
| Spectral Slotting | Prompt hint: slot proactively on track addition | #878 |
| Macro Arrangement | Prompt hint: build sections cross-track, not per-track | #879 |
| Modulation Recipes | Tool-level recipe parameter on apply_modulation | #881 |

The bars default fix (#871 → PR #880) is the template: when the system already has the context, make the tool use it rather than relying on the AI to pass it explicitly. Apply this principle to each workflow before falling back to prompt hints.

## Non-Goals

- No hard-coded macro system or "workflow engine"
- No removing AI discretion — these are hints, not mandates
- No prompt bloat — hints should be 2-3 lines each, not paragraphs
- **No hiding primitives behind abstractions.** Every convenience layer (recipes, auto-slotting, auto-diff) must leave the underlying tools fully accessible. The AI should be able to ignore any abstraction and wire things manually. If an abstraction replaces a primitive instead of wrapping it, it's wrong.
