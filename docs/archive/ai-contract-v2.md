# AI Contract v2
## A layered contract for musical reasoning, structural editing, and raw control

---

## Status

Forward-looking design document.

This document describes the target inference-time contract for Gluon's AI layer after the shift toward:

- staged human-AI collaboration
- model-agnostic behavior
- musically legible state
- layered action surfaces
- explicit support for loop-native and sectional structure

It does not replace the current implementation contract yet. It defines where the interface should move next.

---

## Why v2 Exists

The current contract is strong at low-level editing:

- move a parameter
- sketch a pattern
- listen to audio
- control transport

That is enough for local musical changes. It is not enough for the broader behavior Gluon now wants from the AI.

In particular, the current contract makes it too hard for the model to:

- reason about project phase
- preserve approved ideas during later edits
- operate at phrase or loop-structure level
- understand voice roles and structural intent directly
- distinguish exploratory material from established material
- move cleanly between musical abstraction levels

v2 keeps raw control available, but places it inside a more musically legible environment.

---

## Core Principle

**Expose both the full control surface and a higher-level musical layer, with clear movement between them.**

The model should be able to:

- act precisely when precision is needed
- act musically when musical intent is the important thing
- reason at one level and execute at another
- understand what should be preserved before making changes

The contract should not force a choice between bare parameters and musical abstractions. It should support both.

---

## Design Goals

v2 should let the model:

- read the session as a musical situation, not just a parameter dump
- choose whether to ask, sketch, edit, listen, vary, expand, or refine
- act at micro, pattern, phrase, and project levels
- preserve approved motifs, loops, and directions
- reason about both sectional and loop-native structure
- receive consequences in both mechanical and musical terms

It should do this while preserving Gluon's hard boundaries:

- the AI acts when asked
- the human's hands win
- per-voice agency is enforced
- AI actions are inspectable
- AI actions are undoable
- the engine remains the sole authority that applies state changes

---

## Contract Shape

The model receives:

1. a layered session state
2. tool declarations grouped by action level
3. current human message
4. recent conversation and approval context
5. tool results that report both execution detail and musical consequence

The model may:

- respond in text
- call one or more tools
- ask a clarifying question
- choose not to act

The model should not be forced to express all musical intent directly as low-level control moves.

---

## Action Layers

v2 exposes multiple action layers.

These are all first-class. Higher-level tools do not replace lower-level tools.

### 1. Micro layer

Used for exact, local control.

Examples:

- move a raw or semantic parameter
- add or remove a note
- add or remove a trigger
- add a parameter lock
- adjust transport
- mute, solo, or route a voice

### 2. Pattern layer

Used when the task is about a loop, motif, groove, or local texture shape.

Examples:

- sketch a loop
- vary a motif
- thin or densify a groove
- add syncopation
- preserve rhythm while changing timbre behavior
- preserve motif while altering ending

### 3. Phrase layer

Used when the task is larger than one loop but smaller than full-project arrangement.

Examples:

- extend a 4-bar idea into 16 bars
- create a controlled variation cycle
- add a turnaround
- build tension over 8 bars
- create a sparse answer phrase to a dense anchor phrase

### 4. Project layer

Used for collaboration flow and structural intent.

Examples:

- declare or update current phase
- mark an idea as approved
- preserve a specific loop as anchor material
- choose between alternatives
- move from sketching to refinement

The runtime may internally derive low-level operations from higher-level actions, but the model should be allowed to speak and act at the level the task actually demands.

---

## Layered Session State

Each turn, the model should receive structured state with multiple layers.

### 1. Control layer

This remains the raw and exact layer.

It includes:

- voices
- engine/model identifiers
- parameters
- transport
- event data
- parameter locks
- routing and mute/solo state
- agency state

### 2. Voice layer

This summarizes each voice in musically legible terms.

It may include:

- role: kick, bass, lead, pad, texture, percussion, utility
- register: low, mid, high, wide
- timbral summary: dark, bright, noisy, tonal, metallic, soft, sharp
- rhythmic function: anchor, syncopated support, offbeat pulse, fill, sparse punctuation
- density estimate
- stability estimate
- whether the voice is currently foreground or support
- whether the voice is exploratory, approved, or protected

### 3. Pattern and phrase layer

This describes local identity rather than only note/event content.

It may include:

- current motif summary
- anchor loop summary
- alternate loop summaries
- repetition horizon: how long the current idea can likely repeat before change is useful
- variation points: bar 4, 8, 16, etc.
- phrase function: anchor, buildup, release, turnaround, answer
- preserved elements: rhythm, contour, timbral gesture, register

### 4. Session and collaboration layer

This describes the project as an evolving collaboration.

It may include:

- current project phase: framing, sketching, guided_iteration, expansion, refinement
- active brief
- approved directions
- rejected directions
- current comparison candidates
- selected winner if a comparison has already happened
- latest human reactions in musical terms
- latest listener observations
- undo depth

### 5. Structural layer

This describes the current shape of the piece, whether sectional or loop-native.

It may include either or both:

- sectional structure: intro, verse, chorus, breakdown, drop, bridge
- loop-evolution structure: anchor loop, restrained variant, high-energy variant, density ramp, turnaround, textural drift

The model should not have to infer all structural meaning from raw loops alone.

---

## Example Session State

Illustrative shape only:

```json
{
  "project": {
    "phase": "guided_iteration",
    "brief": "Dark, pressure-heavy dubstep with a restrained intro and a heavier second loop state",
    "approved_directions": [
      "Kick remains dry and punchy",
      "Bass should feel heavy without becoming muddy"
    ],
    "rejected_directions": [
      "Overly bright hi-hats"
    ],
    "structure": {
      "mode": "loop_evolution",
      "anchor_loop_id": "loop_a",
      "variants": [
        { "id": "loop_a", "role": "anchor", "energy": 0.48 },
        { "id": "loop_b", "role": "high_energy_variant", "energy": 0.71 }
      ],
      "variation_points_bars": [4, 8, 16]
    }
  },
  "voices": [
    {
      "id": "v0",
      "engine_model": "analog_bass_drum",
      "agency": "ON",
      "control": {
        "params": {
          "brightness": 0.28,
          "richness": 0.31,
          "texture": 0.18,
          "pitch": 0.34
        },
        "mute": false,
        "solo": false
      },
      "voice_summary": {
        "role": "kick",
        "register": "low",
        "timbre": ["dry", "dark", "punchy"],
        "rhythmic_function": "anchor",
        "foreground": true,
        "status": "approved"
      },
      "pattern_summary": {
        "motif": "four-on-the-floor anchor with stronger accents on 1 and 3",
        "repetition_horizon_bars": 16,
        "preserve": ["pulse", "dry attack"]
      }
    }
  ],
  "transport": {
    "bpm": 140,
    "swing": 0.02,
    "playing": true
  },
  "recent_human_reactions": [
    {
      "target": "bass",
      "reaction": "too wide and fizzy",
      "age_ms": 9500
    }
  ],
  "listener": {
    "latest_observations": [
      "Kick and bass compete around the low-mid range",
      "The second loop state increases energy but loses punch"
    ]
  },
  "undo_depth": 4
}
```

---

## Tool Families

v2 should group tools by musical purpose, not only by implementation category.

### A. Inspect and collaborate

These tools help the model reason before acting.

Possible tools:

- `listen(question)`
- `compare(candidateIds, question)`
- `summarize_voice(voiceId)`
- `ask_clarifying(question)`

Note:

`ask_clarifying` may remain a conversational behavior rather than a literal tool, but it is listed here because it is part of the contract surface.

### B. Micro edit

These support exact control.

Possible tools:

- `move_param(...)`
- `edit_events(...)`
- `set_transport(...)`
- `set_voice_state(...)`

These are close to the current contract and should remain available.

### C. Pattern edit

These support loop and motif work.

Possible tools:

- `sketch_pattern(...)`
- `vary_pattern(...)`
- `transform_pattern(...)`
- `preserve_and_modify(...)`

Examples:

- preserve the rhythm, alter note contour
- preserve the motif, vary the ending
- reduce density by 20 percent without changing downbeats

### D. Phrase and structure edit

These support larger musical motion.

Possible tools:

- `extend_phrase(...)`
- `create_variation_cycle(...)`
- `create_turnaround(...)`
- `add_contrast_state(...)`
- `evolve_timbre_over_time(...)`

These are especially important for loop-native structure.

### E. Collaboration and memory

These support staged human-AI work rather than direct sound changes.

Possible tools:

- `mark_approved(...)`
- `mark_rejected(...)`
- `set_project_phase(...)`
- `preserve_material(...)`
- `name_structure_role(...)`

These tools help the model remember what must survive later edits.

---

## Tool Semantics

Each tool should be explicit about:

- target scope
- abstraction level
- preservation rules
- whether the result is exploratory or committal
- whether the action creates a new variant or rewrites existing material

This matters because higher-level tools are only useful if the runtime makes the consequences legible.

For example, "create a restrained variant" should not silently destroy the original loop. It should produce an inspectable relationship between source and result.

---

## Consequence Reporting

Tool responses in v2 should report both mechanical and musical consequence.

Weak result:

```json
{ "ok": true }
```

Stronger result:

```json
{
  "ok": true,
  "applied_actions": 6,
  "affected_voices": ["v1"],
  "created_material": ["loop_b"],
  "preserved": ["rhythmic motif", "bar-1 accent shape"],
  "changed": ["bass density reduced", "ending varied in bars 4 and 8"],
  "structural_effect": "Created a restrained answer variant of the anchor loop",
  "next_useful_step": "Compare loop_a and loop_b, then decide whether to expand to 16 bars"
}
```

This helps the model continue collaborating rather than merely chaining tool calls blindly.

---

## Expected Behavioral Guidance

The model should follow these behavioral defaults:

- treat broad prompts as briefs, not completion commands
- ask when the search space is broad and the next commitment is large
- sketch before expanding
- preserve approved ideas during later edits
- prefer human feedback for direction-setting
- use listening as support for diagnosis, comparison, and refinement
- use the narrowest useful intervention before escalating scope

The contract should make those behaviors easier, not rely on prompts alone to enforce them.

---

## Structural Reasoning Expectations

The model should be able to reason about structure in either of two broad modes.

### 1. Sectional mode

Suitable for:

- verse / chorus forms
- pop structures
- breakdown / drop planning
- explicit section contrast

### 2. Loop-evolution mode

Suitable for:

- techno
- dubstep
- ambient
- electro
- groove-led instrumental forms

In loop-evolution mode, the model should be able to think in terms such as:

- anchor loop
- restrained variant
- high-energy variant
- density ramp
- textural mutation
- periodic turnaround
- stable state versus unstable state

The contract should not assume traditional song sections are the only valid expression of form.

---

## Validation Invariants

Hard rules remain runtime-enforced.

Examples:

1. Target voices must exist.
2. Agency must permit mutation on targeted voices.
3. Human arbitration locks override AI actions.
4. Invalid actions are rejected with explicit reasons.
5. High-level actions must remain inspectable and undoable.
6. Higher-level tools may derive lower-level actions, but derived actions must stay within validated bounds.
7. Listening tools must respect playback and capture requirements.
8. Structural-memory tools must not directly mutate audio state unless paired with an editing action.

These protect the product boundary while allowing richer behavior inside it.

---

## Undo

Undo remains grouped around meaningful AI actions.

v2 should support:

- one undo step for a focused AI turn
- structural actions grouped coherently with their derived low-level edits
- creation of variants without destroying source material by default
- explicit reporting of what an undo will revert

The human should always be able to recover from a bad AI move in one step.

---

## Migration Strategy

v2 does not need to ship all at once.

Suggested sequence:

1. Keep current micro tools intact.
2. Expand state to include voice summaries, phase, approvals, and recent human reactions.
3. Add pattern-level preservation and variation tools.
4. Add structural memory tools such as `mark_approved` and `preserve_material`.
5. Add phrase and loop-evolution tools once the engine can represent the resulting material cleanly.

This keeps the interface usable during transition while moving toward a much better musical environment.

---

## Summary

AI Contract v2 keeps Gluon's raw control surface, but stops treating raw control as the whole environment.

The model should be able to read the session as music, reason at the right level, act through layered tools, preserve what matters, and move between exact control and musical abstraction without losing coherence.
