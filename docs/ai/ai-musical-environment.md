# AI Musical Environment
## Designing the world a strong model reasons and acts within

---

## Status

Forward-looking design document. Describes the target environment for Gluon's AI layer. Does not replace the current implementation contract (`ai-contract.md`). Defines where the interface should move next.

---

## Core Test

**Can the model form a musical intention in Gluon-native terms, then express that intention through available actions without unreasonable translation loss?**

If the answer is no, the model will behave like a cautious parameter bot even if it is musically sophisticated. That is an environment failure before it is a model failure.

---

## Why The Current Contract Is Not Enough

The current contract is strong at low-level editing: move a parameter, sketch a pattern, listen to audio, control transport. That is enough for local musical changes. It is not enough for:

- reasoning about project phase
- preserving approved ideas during later edits
- operating at phrase or loop-structure level
- understanding track roles and structural intent directly
- distinguishing exploratory material from established material
- moving cleanly between musical abstraction levels

The environment described here keeps raw control available but places it inside a more musically legible world.

---

## Design Principle

**Expose both the full control surface and a higher-level musical layer, with clear movement between them.**

This is similar to giving a programmer both a high-level language and C. Precision is still available. It is just not the only way to express intent.

Practical rule: **expose the full control surface, but do not make the model live there by default.**

- keep raw parameters accessible when they are musically important
- add higher-level musical handles where intent is easier to express that way
- let high-level actions compile into inspectable low-level changes
- let low-level changes be summarized back into musical terms

---

## Layered Session State

Each turn, the model should receive structured state with multiple layers.

### 1. Control layer

The raw and exact layer. Includes: tracks, engine/model identifiers, parameters, transport, event data, parameter locks, routing and mute/solo state, agency state.

### 2. Track layer

Musically legible summary of each track:

- role: kick, bass, lead, pad, texture, percussion, utility
- register: low, mid, high, wide
- timbral summary: dark, bright, noisy, tonal, metallic, soft, sharp
- rhythmic function: anchor, syncopated support, offbeat pulse, fill, sparse punctuation
- density and stability estimates
- foreground vs support
- status: exploratory, liked, approved, anchor (see [preservation-contracts.md](../rfcs/preservation-contracts.md))

Each track should also expose **importance metadata** — why the track matters and what must survive edits:

- function: what role this track plays in the overall piece (e.g. "core identity carrier", "textural bed", "rhythmic anchor")
- must_preserve: specific aspects that define this track's identity (e.g. "descending contour", "sub weight", "bar-4 anticipation")
- may_change: aspects explicitly open for modification (e.g. "surface texture", "stereo width")
- risk_if_changed: what the piece loses if this track is altered carelessly (e.g. "drop loses heaviness", "groove loses momentum")

This reduces guesswork when the model edits tracks that interact with approved material.

### 3. Pattern and phrase layer

Local identity rather than only note/event content:

- current motif summary
- anchor loop summary and alternate loop summaries
- repetition horizon: how long the current idea can likely repeat before change is useful
- variation points: bar 4, 8, 16, etc.
- phrase function: anchor, buildup, release, turnaround, answer
- preserved elements: rhythm, contour, timbral gesture, register

### 4. Session and collaboration layer

The project as an evolving collaboration:

- current project phase: framing, sketching, guided_iteration, expansion, refinement
- active brief
- approved and rejected directions (with rationale — see [aesthetic-direction.md](./aesthetic-direction.md))
- current comparison candidates
- reaction history: rolling log of concrete human reactions with context
- observed patterns: natural-language summary of recurring aesthetic tendencies
- restraint guidance: current intervention size bias and its evidence basis
- latest listener observations
- undo depth
- open decisions: unresolved aesthetic or structural questions the model should surface

Open decisions help the model ask useful questions rather than guessing:

```json
{
  "open_decisions": [
    {
      "kind": "taste",
      "question": "Should the bass stay dry or widen in the high-energy variant?",
      "affects": ["loop_b"]
    },
    {
      "kind": "structure",
      "question": "Is the turnaround every 8 bars too frequent?",
      "affects": ["loop_a", "loop_b"]
    }
  ]
}
```

### 5. Structural layer

The current shape of the piece, whether sectional or loop-native (see below).

### Example session state

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
    "rejected_directions": ["Overly bright hi-hats"],
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
  "tracks": [
    {
      "id": "v0",
      "engine_model": "analog_bass_drum",
      "agency": "ON",
      "control": {
        "params": { "brightness": 0.28, "richness": 0.31, "texture": 0.18, "pitch": 0.34 },
        "mute": false, "solo": false
      },
      "track_summary": {
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
  "transport": { "bpm": 140, "swing": 0.02, "playing": true },
  "recent_human_reactions": [
    { "target": "bass", "reaction": "too wide and fizzy", "age_ms": 9500 }
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

## Layered Actions

Multiple action layers, all first-class. Higher-level tools do not replace lower-level tools.

### 1. Micro layer

Exact, local control: move a parameter, add/remove a note or trigger, add a parameter lock, adjust transport, mute/solo/route a track.

### 2. Pattern layer

Loop and motif work: sketch a loop, vary a motif, thin or densify a groove, add syncopation, preserve rhythm while changing timbre, preserve motif while altering ending.

### 3. Phrase layer

Larger than one loop, smaller than full-project arrangement: extend a 4-bar idea into 16 bars, create a controlled variation cycle, add a turnaround, build tension over 8 bars, create a sparse answer phrase to a dense anchor phrase.

### 4. Project layer

Collaboration flow and structural intent: declare or update current phase, mark an idea as approved, preserve a loop as anchor material, choose between alternatives, move from sketching to refinement.

The runtime may internally derive low-level operations from higher-level actions, but the model should speak and act at the level the task demands.

---

## Tool Families

Tools grouped by musical purpose.

### A. Inspect and collaborate

Help the model reason before acting: `listen(question)`, `compare(candidateIds, question)`, `explain_chain(trackId)`, `ask_clarifying(question)`.

### B. Micro edit

Exact control: `move(...)`, `edit_pattern(...)`, `set_transport(...)`, `set_track_meta(...)`. Close to the current contract.

### C. Pattern edit

Loop and motif work: `sketch_pattern(...)`, `vary_pattern(...)`, `transform_pattern(...)`, `preserve_and_modify(...)`.

Examples: preserve the rhythm, alter note contour. Reduce density by 20% without changing downbeats.

### D. Phrase and structure edit

Larger musical motion: `extend_phrase(...)`, `create_variation_cycle(...)`, `create_turnaround(...)`, `add_contrast_state(...)`, `evolve_timbre_over_time(...)`.

Especially important for loop-native structure.

### E. Collaboration and memory

Staged human-AI work rather than direct sound changes: `set_track_meta(approval: ...)`, `set_intent(...)`, `set_section(...)`, `set_tension(...)`, `raise_decision(...)`.

Partially landed: `set_track_meta` covers approval levels and importance. `set_intent` and `set_section` cover project phase and direction. Preservation constraints are enforced by the approval system. Remaining gap: explicit `preserve_material(...)` and `name_structure_role(...)` tools for fine-grained preservation annotations.

---

## Tool Semantics

Each tool should be explicit about:

- target scope
- abstraction level
- preservation rules
- whether the result is exploratory or committal
- whether the action creates a new variant or rewrites existing material

"Create a restrained variant" should not silently destroy the original loop. It should produce an inspectable relationship between source and result.

---

## Consequence Reporting

Tool responses should report both mechanical and musical consequence.

Weak: `{ "ok": true }`

Strong:
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

This helps the model continue collaborating rather than chaining tool calls blindly.

---

## Structured Listening

Listening should support decisions rather than produce vague feedback. The `listen` and `compare` tools should be question-oriented.

### Question-based listening

Every listen call should target a specific question:

```
listen(question="Did the bass widening reduce kick punch?")
compare(candidates=["loop_a", "loop_b"], question="Which groove feels tighter?")
```

Open-ended listening ("how does it sound?") is appropriate early in a session but becomes less useful as the piece develops. As material matures, listening should get more specific.

### Listening lenses

When evaluating, the listener should focus on specific dimensions relevant to the question:

- low-end separation
- punch and transient clarity
- groove stability and swing feel
- variation salience (can you hear the difference?)
- energy progression
- frequency masking between tracks

### When to listen

Listening should typically occur:

- after edits, to check for regressions
- during candidate comparison, to inform selection
- during refinement, to diagnose specific issues

It should **not** occur automatically every turn. The model should listen when it has a specific question, not as a habit.

### Listener output

Listener responses should be structured enough to act on:

```json
{
  "comparison": "loop_a vs loop_b",
  "observations": [
    {
      "lens": "punch",
      "winner": "loop_a",
      "confidence": "high",
      "reason": "bass in loop_b masks kick transient"
    }
  ],
  "uncertainties": [
    "difference may shrink if bass width is reduced in loop_b"
  ]
}
```

The model should report listener findings to the human but never substitute them for human judgment. The listener is a diagnostic tool, not a taste arbiter.

---

## Loop-Native Structure

Song structure should not be reduced to traditional verse/chorus arrangement thinking.

Much modern electronic music is structurally loop-based. That does not mean it lacks form. It means the form often emerges through repetition, mutation, density, and controlled contrast rather than through conventional song sections.

### Two structural modes

Gluon should support both:

**Sectional mode** — for verse/chorus forms, pop structures, breakdown/drop planning, explicit section contrast.

**Loop-evolution mode** — for techno, dubstep, ambient, electro, groove-led instrumental forms.

In loop-evolution mode, the model should reason in terms such as:

- anchor loop
- restrained variant / high-energy variant
- density ramp
- textural mutation
- periodic turnaround
- stable state versus unstable state

### Loop-based structure is still structure

In many genres, form comes from:

- introduction and withdrawal
- density ramps
- timbral evolution
- periodic mutations
- phrase-length expectation
- contrast between loop states
- selective repetition and interruption

These are first-class structural concerns, not lesser versions of song sections.

### Tooling implication

The environment should make loop-native structural moves expressible:

- mark this as the anchor loop
- create a restrained variant
- create a higher-energy variant
- preserve the motif but vary the ending
- evolve the timbre over 8 bars
- thin the groove without losing momentum
- add a short turnaround every 16 bars
- alternate stable and unstable versions of the same idea

These are structural moves even when no traditional section labels are involved.

---

## Musical Vocabulary

The internal language of the system matters. If the model has to think in one vocabulary and act in another, collaboration quality drops.

Musical intent is often formed in terms like: role, weight, brightness, tension, release, density, contrast, movement, groove, phrase, motif, variation, foreground, support, stability, instability.

Gluon should prefer language that reflects those concepts. Engine-native language and raw parameter names should remain available where precision matters — the issue is relying on them as the only stable language of action.

---

## Failure Modes

Signs that the environment is not yet meeting a strong model halfway:

- the model makes safe but musically weak parameter nudges
- the model over-explains because it cannot act cleanly at the intended level
- the model jumps to large rewrites because it lacks intermediate action surfaces
- the model ignores important established ideas during expansion
- the model asks generic questions because it lacks project-phase and approval context
- the model can describe musical intent better than it can execute it
- tool use is correct but the musical outcome feels arbitrary

These are environment failures before they are model failures.

---

## Three AI Environment Layers

The AI's working environment exists at three levels. Each is documented, each is real — they differ in implementation status, not in seriousness.

| Layer | What it is | Document | Status |
|-------|-----------|----------|--------|
| **Current contract** | The tools, state format, and validation rules the AI operates with today. ~40 tools, up to 16 tracks, multiple Plaits engines and processor/modulator types, canonical events, semantic controls. | [ai-contract.md](./ai-contract.md) | Implemented |
| **Canonical model** | The data model that all current and future tools operate on. Voices, regions, events, control schemas, adapters, provenance. Defines the stable internal vocabulary. | [canonical-musical-model.md](../rfcs/canonical-musical-model.md) | Partially implemented (regions, events, provenance landed; adapters, full schema in progress) |
| **Musical environment** (this document) | The target environment where the AI reasons about project phase, track roles, structural intent, preservation, and phrase-level editing. Layered state and layered actions. | This document | Design — not yet implemented |

The current contract is what the AI sees today. The canonical model is the platform being built underneath it. This document is where the environment is headed once the canonical model is stable.

Each layer subsumes the one below it: the musical environment will be expressed through canonical model types, which will be exposed through contract tools. Nothing in this document requires discarding what exists — it extends it.

---

## Migration Strategy

Status as of Finalization phase (M0–M6 complete):

Much of what was planned for M4 and M5 has landed: the current contract includes approval levels, preservation constraints, reaction history, restraint guidance, pattern management, sequence management, motif development, and arrangement tools. The remaining gap is phrase-level editing (extend a 4-bar idea into 16 bars, create controlled variation cycles) and the full track-layer summaries described above. These are post-Finalization work.

---

## Relationship To Other AI Docs

- [ai-capability-doctrine](../principles/ai-capability-doctrine.md) — where to draw the line between constraint and empowerment
- [ai-interface-design-principles](../principles/ai-interface-design-principles.md) — how to build AI interfaces that respect model intelligence
- [ai-collaboration-model](../principles/ai-collaboration-model.md) — what good collaboration looks like: phases, posture, roles
- [aesthetic-direction](./aesthetic-direction.md) — how taste emerges from enriched collaboration state
- [preservation-contracts](../rfcs/preservation-contracts.md) — runtime enforcement of approved material during AI edits
