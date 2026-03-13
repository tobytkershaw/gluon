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
- understanding voice roles and structural intent directly
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

The raw and exact layer. Includes: voices, engine/model identifiers, parameters, transport, event data, parameter locks, routing and mute/solo state, agency state.

### 2. Voice layer

Musically legible summary of each voice:

- role: kick, bass, lead, pad, texture, percussion, utility
- register: low, mid, high, wide
- timbral summary: dark, bright, noisy, tonal, metallic, soft, sharp
- rhythmic function: anchor, syncopated support, offbeat pulse, fill, sparse punctuation
- density and stability estimates
- foreground vs support
- status: exploratory, approved, or protected

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
- approved and rejected directions
- current comparison candidates
- latest human reactions in musical terms
- latest listener observations
- undo depth

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
  "voices": [
    {
      "id": "v0",
      "engine_model": "analog_bass_drum",
      "agency": "ON",
      "control": {
        "params": { "brightness": 0.28, "richness": 0.31, "texture": 0.18, "pitch": 0.34 },
        "mute": false, "solo": false
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

Exact, local control: move a parameter, add/remove a note or trigger, add a parameter lock, adjust transport, mute/solo/route a voice.

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

Help the model reason before acting: `listen(question)`, `compare(candidateIds, question)`, `summarize_voice(voiceId)`, `ask_clarifying(question)`.

### B. Micro edit

Exact control: `move_param(...)`, `edit_events(...)`, `set_transport(...)`, `set_voice_state(...)`. Close to the current contract.

### C. Pattern edit

Loop and motif work: `sketch_pattern(...)`, `vary_pattern(...)`, `transform_pattern(...)`, `preserve_and_modify(...)`.

Examples: preserve the rhythm, alter note contour. Reduce density by 20% without changing downbeats.

### D. Phrase and structure edit

Larger musical motion: `extend_phrase(...)`, `create_variation_cycle(...)`, `create_turnaround(...)`, `add_contrast_state(...)`, `evolve_timbre_over_time(...)`.

Especially important for loop-native structure.

### E. Collaboration and memory

Staged human-AI work rather than direct sound changes: `mark_approved(...)`, `mark_rejected(...)`, `set_project_phase(...)`, `preserve_material(...)`, `name_structure_role(...)`.

These help the model remember what must survive later edits.

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
| **Current contract** | The tools, state format, and validation rules the AI operates with today. 10 tools, 4-voice Plaits/Rings, canonical events, semantic controls. | [ai-contract.md](./ai-contract.md) | Implemented |
| **Canonical model** | The data model that all current and future tools operate on. Voices, regions, events, control schemas, adapters, provenance. Defines the stable internal vocabulary. | [rfc-canonical-musical-model.md](./rfc-canonical-musical-model.md) | Partially implemented (regions, events, provenance landed; adapters, full schema in progress) |
| **Musical environment** (this document) | The target environment where the AI reasons about project phase, voice roles, structural intent, preservation, and phrase-level editing. Layered state and layered actions. | This document | Design — not yet implemented |

The current contract is what the AI sees today. The canonical model is the platform being built underneath it. This document is where the environment is headed once the canonical model is stable.

Each layer subsumes the one below it: the musical environment will be expressed through canonical model types, which will be exposed through contract tools. Nothing in this document requires discarding what exists — it extends it.

---

## Migration Strategy

Connected to project milestones:

1. **Now (current contract):** Keep micro tools intact. These work.
2. **M4:** Expand state to include voice summaries, phase, approvals, and recent human reactions. Add pattern-level preservation and variation tools. **Preservation semantics (`mark_approved`, `preserve_material`) must land before or alongside phrase-level editing tools** — otherwise the AI has the power to make large edits but no mechanism to protect established material.
3. **M5:** Add phrase and loop-evolution tools once the engine can represent the resulting material cleanly. Structural memory at this point should already be in place from M4.

---

## Relationship To Other AI Docs

- [ai-capability-doctrine](./ai-capability-doctrine.md) — where to draw the line between constraint and empowerment
- [ai-interface-design-principles](./ai-interface-design-principles.md) — how to build AI interfaces that respect model intelligence
- [ai-collaboration-model](./ai-collaboration-model.md) — what good collaboration looks like: phases, posture, roles
