# Chat UX: Collaboration Loop

**Status:** Design
**Milestone:** Finalization
**Depends on:** #945 (resilient agentic architecture) informs phase/step labels

---

## Problem

The chat panel works — streaming text, action diffs, tool call transparency, reactions, undo — but it doesn't yet feel like the collaboration loop described in `docs/principles/ai-collaboration-model.md`. The desired loop is:

> brief → small change → audible result → reaction → next step

Several UX gaps make this loop harder than it should be:

1. **Empty state is blank.** No indication of what Gluon can do or what kinds of requests work well.
2. **Progress is opaque.** "thinking", "listening", "working" don't communicate what the AI is actually doing or which collaboration phase it's in.
3. **Per-turn outcomes are implicit.** The user sees accumulated action diffs but no summary of what changed, why, or what to do next.
4. **Feedback is too binary.** Approve/reject captures a verdict but doesn't help the user steer the next move.
5. **Transparency is developer-shaped.** Tool call counts and truncated args are useful for debugging, not musical comprehension.
6. **Listening is invisible.** When the AI renders and evaluates audio, the user sees "Listened to audio" — they can't hear what the AI heard.
7. **Scope is hidden.** The user doesn't know which tracks the AI is about to touch or whether agency is ON/OFF until after the turn.

---

## Design

Seven changes, ordered by build sequence. Each is independently shippable.

### 1. Empty state with context-aware starters

Replace the blank chat with 4–6 contextual prompt chips that adapt to project state.

**Empty project:** "Start a dark techno kick", "Sketch a bass gesture", "What can you do?"
**Tracks exist:** "Make the hats looser", "Listen and tell me what clashes", "Give me two directions for the bass"
**Mid-session resume:** "Remind me where we left off", "What's the current mix state?"

Chips send a pre-formed message on click. They disappear after the first user message.

**Touches:** `ChatMessages.tsx`, `ChatComposer.tsx`

### 2. Collaboration phase labels

Replace generic status text ("thinking", "listening", "working") with explicit phase labels derived from the collaboration model:

| Phase | When | Label |
|-------|------|-------|
| Framing | AI is asking clarifying questions | "Framing — narrowing the brief" |
| Sketching | AI is writing patterns / setting params | "Sketching — 4-bar kick loop" |
| Listening | AI is rendering + evaluating audio | "Listening — bass solo, bars 1–4" |
| Applying | AI is executing validated actions | "Applying 3 changes" |
| Waiting | AI has finished and is offering choices | "Your turn" |

The phase label comes from the AI layer (planner knows which phase it's in). Fallback to current generic labels if the planner doesn't signal a phase.

**Touches:** `ChatMessages.tsx`, AI planner system prompt, potentially new `phase` field on streaming callbacks

**Dependency:** Benefits from #945's decomposed step execution, which would make phases structurally explicit rather than inferred.

### 3. Per-turn summary card ("what happened / what next")

After every AI turn, show a compact card:

```
Changed: bass timbre + swing
Why: more pressure, less brightness
Next: [more weight] [less motion] [A/B compare] [undo]
```

- **Changed:** derived from the action log entries already captured
- **Why:** extracted from the AI's text response (or a dedicated `summary` field in the turn output)
- **Next:** 2–4 contextual follow-up chips, clickable to send as the next message

The follow-up chips are the highest-value part — they turn the collaboration loop into a one-click cycle instead of requiring the user to re-articulate intent every turn.

**Touches:** `ChatMessages.tsx`, AI planner (to suggest follow-ups), `ActionDiffView.tsx`

### 4. Musical reaction controls

Replace binary approve/reject with domain-specific quick reactions:

**Quick chips (contextual, AI-suggested):**
"more tense", "less busy", "keep groove", "undo timbre only", "brighter", "darker"

**Always available:**
- Approve (keep everything)
- Undo (revert entire turn)
- Free-text annotation

The reaction chips double as follow-up messages — clicking "more tense" sends it as the next user message with the reaction context attached.

**Touches:** `ChatMessages.tsx` (reaction UI), reaction type definitions in `types.ts`

### 5. Scope and agency badges

Before the AI acts, show which tracks it's about to touch and their agency state:

```
Scope: kick (ON) · bass (ON) · hats (OFF — will skip)
```

This can appear at the top of the streaming area as soon as the AI signals its target tracks. It makes permission boundaries visible *before* action, reducing surprise.

After the turn, the same info persists as metadata on the message.

**Touches:** `ChatMessages.tsx`, AI tool call metadata, `ActionDiffView.tsx`

### 6. First-class listen events

When the AI renders and evaluates audio, show it as a meaningful musical event:

- Inline waveform thumbnail of the rendered audio
- Play button so the user can hear exactly what the AI heard
- The AI's evaluation summary (from Gemini listener) shown alongside
- Before/after comparison if the AI rendered a diff

This closes the biggest feedback gap in the collaboration loop — the user can verify the AI's hearing.

**Touches:** `ChatMessages.tsx`, `ToolCallsView.tsx`, audio snapshot storage, new `ListenEventView` component

### 7. Keyboard-driven workflow

Musicians often have one hand on a controller. Support:

- `Cmd+L` — focus chat composer (like browser URL bar)
- `Escape` — return focus to instrument view
- `Up arrow` in empty composer — recall last message for editing
- Follow-up chip selection via number keys (1, 2, 3, 4)

**Touches:** `ChatComposer.tsx`, `AppShell.tsx` (key bindings)

---

## Build Order

1. **Empty state + starters** — lowest effort, highest new-user impact
2. **Phase labels + per-turn summary cards** — together these make the collaboration loop visible
3. **Musical reaction controls** — upgrades feedback from binary to directional
4. **Scope/agency badges** — reduces fear, makes permissions obvious
5. **First-class listen events** — most technically involved, biggest payoff for iteration quality
6. **Keyboard workflow** — polish pass, low urgency

Items 1–3 are the core. Items 4–7 are valuable but can follow independently.

---

## Non-goals

- **Chat history / persistence across sessions** — separate concern, not part of this brief
- **Multi-modal input** (audio recording, MIDI input in chat) — future work
- **Surface view integration in chat** — gated on Surface view completion (#527)
- **Replacing the tool call view** — keep it as a collapsible developer detail, just make the musical summary more prominent

---

## Relationship to other docs

- `docs/principles/ai-collaboration-model.md` — the behavioral contract this UI should make visible
- `docs/principles/ai-interface-design-principles.md` — transparency, legibility, composability
- `docs/rfcs/ai-curated-surfaces.md` — Surface modules may eventually appear inline in chat
- `docs/briefs/offline-listen.md` — audio rendering that powers listen events
- Issue #945 — resilient agentic architecture; decomposed steps feed phase labels naturally
