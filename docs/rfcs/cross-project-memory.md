# Cross-Project Memory

## Persistent user taste and workflow across projects

---

## Status

RFC. Explicitly revisits the deferral in [aesthetic-direction.md](../ai/aesthetic-direction.md) ("No persistent user taste. Cross-session taste is deferred.") and proposes conditions under which it should ship.

**Depends on:** [per-project memory brief](../briefs/ai-memory.md) — project-scoped memory tools must be implemented and validated first.

---

## The Case for Revisiting the Deferral

The aesthetic-direction doc deferred cross-session taste "pending evidence from real sessions." This RFC argues the evidence bar should be met by per-project memory before cross-project memory ships — but that the design should be ready.

The deferral was correct at the time. The collaboration state didn't yet exist. Now it does: reaction history, observed patterns, restraint level, approved/rejected directions. Per-project memory (the companion brief) makes that collaboration state durable within a project.

The remaining gap: when a user starts a new project, the AI has zero context about who they are. Every project is a blank slate. If the user has made 10 projects and rejected bright bass in 8 of them, the AI will still suggest bright bass in project 11.

Cross-project memory fills that gap. But it introduces a new persistence domain, a new privacy surface, and a new capability that the human must be able to inspect and control. This RFC defines all three.

---

## What This Supersedes

This RFC, if accepted, supersedes the following specific statements:

- aesthetic-direction.md line 171: "No persistent user taste."
- aesthetic-direction.md line 171: "Cross-session taste is deferred."

It does NOT supersede the core claim: "Taste is not a separate system." Cross-project memory is an extension of collaboration state, not a parallel subsystem. It uses the same natural-language format, the same advisory semantics, and the same tool-driven interface as per-project memory.

---

## Design

### Five memory types

All user-scoped. Stored in a dedicated IndexedDB object store, separate from projects.

**`taste`** — recurring aesthetic preferences observed across multiple projects.

```
"User has rejected bright bass in 4 of 6 projects. Confidence: high."
"User consistently approves dry percussion. Confidence: high."
"User tried Clouds-based textures in 5 projects — gravitates toward granular processing."
```

**`workflow`** — how the user works, regardless of genre or project.

```
"Usually starts with kick and bass, adds melody after groove is locked."
"Prefers to hear changes (listen tool) before committing."
"Gets impatient with long AI explanations — prefers terse responses."
```

**`profile`** — musical background, knowledge, and skill level.

```
"Familiar with modular synthesis concepts (Eurorack vocabulary)."
"Less comfortable with music theory — avoids discussing chord progressions abstractly."
"Has been making techno and ambient music."
```

**`correction`** — learned corrections to the AI's own understanding of Gluon's tools, parameters, and behavior. The docs and parameter descriptions can never be perfectly accurate. When the AI discovers through experience that something doesn't behave as documented, it records the correction so it doesn't repeat the mistake.

```
"analog-bass-drum frequency param: doc says 'fundamental pitch' but values below 0.3
produce a click with no tonal content. Usable kick range is roughly 0.3-0.6."
"Clouds feedback above 0.8 causes runaway gain in spectral mode — keep below 0.7
unless user explicitly wants chaos."
"shape_timbre 'darker' on modal-resonator mostly affects damping, not brightness —
for actual brightness reduction, use move on timbre directly."
```

This is the AI's errata sheet. Corrections are high-confidence by nature — they come from direct observation of tool behavior, not subjective preference. They should be specific (which parameter, which model, what happens) and actionable (what to do instead).

**`repertoire`** — the AI's awareness of its own creative habits and go-to patterns. Tracks what starting points, sound designs, and structural choices the AI has used across projects so it can balance reliability with variety.

```
"Last 4 techno projects started with analog-bass-drum kick + VA bass through Ripples LP4.
Works reliably but getting repetitive — try FM bass or waveshaping next time."
"Have used Clouds granular on pads in 6 of 8 projects. Consider Beads or Elements for texture."
"Default groove has been mpc_swing at 0.7 for every project. Branch out: garage, laid_back, dnb_break."
```

Repertoire memories are not preferences (those are `taste`) — they're self-knowledge. The AI should weight them as a nudge toward variety, not a prohibition. If a known-reliable pattern is the right call for the project, use it. But if the AI is reaching for the same starting point by default rather than by choice, repertoire memory makes that visible.

The balance: **known patterns are a feature, not a bug — but only when chosen deliberately, not by habit.** The AI should have a repertoire of approaches it knows work well, and should reach for them when they fit. But it should also notice when it's defaulting rather than choosing, and explore alternatives when the project context allows it.

### Memory structure

```typescript
interface UserMemory {
  id: string;
  type: 'taste' | 'workflow' | 'profile' | 'correction' | 'repertoire';
  content: string;          // natural language, 1-3 sentences
  confidence: number;       // 0.0-1.0, decays without reinforcement
  evidence: string;         // what produced this memory
  instanceCount: number;    // how many projects this pattern appeared in
  createdAt: number;
  updatedAt: number;
  lastReinforcedAt: number; // when evidence last confirmed this
}
```

### Storage

```
IndexedDB: gluon
├── projects        (existing)
├── patches         (existing)
└── user-memories   (new object store)
```

User memories are NOT part of any project. They persist independently.

### Tools

Same contract pattern as per-project memory. No hidden side effects.

#### `save_user_memory`

Save or update a user-level memory. Typically called when the AI recognizes a pattern that has appeared across multiple projects.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | yes | `taste`, `workflow`, `profile`, `correction`, or `repertoire` |
| `content` | string | yes | Natural language, 1-3 sentences |
| `evidence` | string | yes | What produced this memory |
| `supersedes` | string | no | User memory ID to replace |

Validation:
- Content must be non-empty, max 500 characters
- Max 30 user memories (tight cap — these should be high-signal)
- Appears in the action log

Not undoable via Cmd+Z (user memories are not part of session state). Instead, the human can delete them through the memory panel or by asking the AI to forget.

#### `recall_user_memories`

Load user memories. Returns all user memories (small set, ≤20).

Read-only.

#### `forget_user_memory`

Remove a user memory.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `memoryId` | string | yes | Memory ID to remove |
| `reason` | string | yes | Why this memory is being removed |

Appears in the action log.

### What goes in the context window

**Always loaded at session start:**

```
## User Profile (9 memories)
- Taste: dry percussion, subtractive bass, moderate density. Gravitates toward Clouds. Dislikes bright bass (high confidence, 4/6 projects).
- Workflow: rhythm-first. Prefers terse responses. Likes to listen before committing.
- Knowledge: modular-literate, theory-light.
- Corrections: analog-bass-drum frequency usable range 0.3-0.6 (below 0.3 = click, no tone). Clouds feedback >0.8 runaways in spectral mode.
- Repertoire: last 4 techno projects used same kick+VA-bass-Ripples starting point — vary. Default groove always mpc_swing 0.7 — branch out.
```

This is a few hundred tokens. Loaded at the start of every project, alongside the project's own memory index.

Corrections are loaded with high priority — they prevent known mistakes. Repertoire is loaded as a nudge — the AI sees its own patterns and can choose whether to follow or diverge.

### When to write each type

Cross-project memories are NOT automatically created by the runtime. The AI decides to save them via `save_user_memory`, same as any other tool call. Different types have different write triggers:

**Taste and workflow** — promoted from project-level patterns. The AI is prompted to consider promotion when it notices a direction that echoes what it's seen before:

```
Prompt guidance: "If a direction you're saving as a project memory matches a pattern
you've seen in previous sessions (visible in the user profile), consider whether
it's worth saving as a user memory via save_user_memory. Only promote patterns
that have appeared in 2+ projects — single instances stay project-scoped."
```

**Profile** — saved when the user explicitly states something about their background, or when the AI infers knowledge level from how the user talks about music.

**Correction** — saved when the AI discovers through experience that a tool or parameter doesn't behave as it expected. The trigger is surprise: the AI made a move expecting one outcome and got another. The correction should be specific and actionable — which parameter, which model/mode, what actually happens, what to do instead. Corrections don't need the 2-project threshold — a single verified observation is enough, because these are empirical facts about Gluon's behavior, not subjective preferences.

**Repertoire** — saved when the AI notices it's reaching for the same starting point or pattern it has used before. The trigger is self-recognition: "I'm about to set up the same kick I used last time." The memory should record what was used and suggest alternatives, not prohibit repetition. The AI is prompted to review its repertoire at project start and decide whether to follow a known pattern or try something different.

```
Prompt guidance: "At the start of a new project, check your repertoire memories.
If you're about to reach for the same starting point you've used in the last 2+
projects, note it and consider an alternative — unless the user's request
specifically calls for that approach. Known-good patterns are valuable; unconscious
defaults are not."
```

All of these are prompted judgment calls, not mechanical rules. The AI might be wrong. The human can correct it.

### Confidence decay

User memories that haven't been reinforced lose confidence over time. A taste memory from 6 months ago that hasn't been confirmed in any recent project drops from high to low confidence. The AI can still reference it but weights it lower.

Decay is simple: `confidence = base_confidence * recency_factor`, where recency drops linearly from 1.0 (reinforced today) to 0.3 (not reinforced in 90 days). The memory is never auto-deleted — just deprioritized.

When the AI encounters contradicting evidence ("user suddenly wants bright bass after rejecting it in 4 projects"), it updates or supersedes the memory via `save_user_memory`.

**Corrections decay differently.** A correction about parameter behavior is either still true or the code has changed. Corrections should not lose confidence over time — they lose confidence only when the AI observes that the corrected behavior no longer applies (e.g., after a Gluon update changes a parameter's range). In that case, the AI supersedes the correction.

**Repertoire memories are updated, not decayed.** They track recent history, not confidence. When the AI uses a new starting point, it updates the repertoire memory to reflect the new pattern. Old repertoire entries that no longer describe recent behavior get superseded.

---

## Human Capability Parity

**This is the hardest constraint.** Per human-capability-parity.md: anything the AI can do, the human should have a means to do.

Cross-project user memory MUST NOT ship without a human-facing surface. Specifically:

### Required at launch (non-negotiable)

1. **Memory panel** — a UI surface where the human can see all user memories, their confidence, their evidence, and when they were last reinforced.
2. **Delete** — the human can delete any user memory from the panel.
3. **Edit** — the human can edit the content of any user memory.
4. **Action log visibility** — every `save_user_memory` and `forget_user_memory` call appears in the chat action trail with full content.

### Nice to have

5. **Explicit "remember this"** — the human can type "remember that I prefer X" and the AI saves it as a user memory.
6. **Export/import** — user memories as JSON for backup or transfer between machines.
7. **Opt-out** — a setting to disable cross-project memory entirely. The AI falls back to blank-slate behavior.

Without items 1-4, cross-project memory violates parity. The AI would be a partial gatekeeper over hidden state that affects its own behavior.

---

## Privacy

User memories contain aesthetic preferences and workflow patterns, not personal data in a regulatory sense. But they are personal in a meaningful sense — they represent the AI's model of who the user is.

Principles:
- User memories are stored locally (IndexedDB), never transmitted to any server beyond what the AI model sees in its context window.
- The human can delete all user memories at once ("clear my profile").
- User memories are never included in project exports.
- The memory panel makes the AI's model of the user fully transparent.

---

## Relationship to existing docs

**aesthetic-direction.md**: this RFC supersedes the specific deferral of persistent user taste. It preserves the core claim that taste is not a separate system — cross-project memory uses the same natural-language, advisory, tool-driven approach as the session collaboration state.

**ai-interface-design-principles.md principle 8 (align conceptual and operational truth)**: user memory is fully represented in prompt (user profile section), tools (`save_user_memory`, `recall_user_memories`, `forget_user_memory`), state (memory panel), execution (validated tool calls), and feedback (action log).

**human-capability-parity.md**: the memory panel satisfies parity. The human can inspect, edit, and delete everything the AI writes. The AI has no hidden state.

---

## Prerequisite

Per-project memory (the companion brief) must be implemented and tested first. The walkthrough (#527) should demonstrate that durable project memory measurably improves AI decision quality. If project memory doesn't help, cross-project memory won't either.

Evidence bar for proceeding: in walkthrough sessions with project memory enabled, the AI avoids re-suggesting rejected approaches at least 80% of the time. If it can't do that within a single project, cross-project memory is premature.

---

## When this approach would be wrong

If users' taste is so variable that cross-project memory creates more false assumptions than useful warm starts. If the 30-memory cap is too tight to capture meaningful patterns. If confidence decay is too aggressive (good memories fade) or too conservative (stale memories persist).

If the memory panel becomes a maintenance burden — the user has to constantly correct the AI's model of them. That would mean the promotion logic is too aggressive or the memory content is too specific.

The escape hatch is the opt-out setting: disable cross-project memory entirely, and every project starts fresh. If most users prefer that, the feature failed.
