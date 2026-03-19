# Turn Contract: AI Turn Mechanics

**Status:** Design (forward-looking target — not yet enforced by runtime)
**Milestone:** Finalization
**Depends on:** `docs/principles/ai-collaboration-model.md` (phases), `docs/briefs/chat-ux.md` (UI rendering), `docs/ai/ai-contract.md` (tools/state)

> **Implementation note:** This document describes target behavior. The current orchestrator and system prompt do not enforce turn classification or mandatory verification. The system prompt has a hard rule that open-ended requests on near-empty projects must frame with text only — the guidance here intentionally relaxes that once implemented.

---

## What This Defines

How a single AI turn should work — from user message to yield. The collaboration model defines *phases*. The chat-ux brief defines *what the UI shows*. The AI contract defines *what tools exist*. This document defines the turn-level mechanics that connect them.

The approach: give the AI a legible world, useful feedback, and worked examples of good judgment — then let it decide. Per the capability doctrine, the hard constraints protect the product boundary (human authority, inspectability, undoability). Everything else is guidance.

---

## Turn Vocabulary

These are names for common turn shapes, not categories the runtime enforces. A turn may blend elements — diagnose something, realize the fix is obvious, and execute it. The vocabulary exists so we can talk about turns, evaluate them, and show examples.

- **Conversational** — the AI speaks, no state changes
- **Framing** — the AI narrows an ambiguous brief, may set session metadata
- **Execute** — the AI makes audible changes, then yields for feedback
- **Diagnose** — the AI inspects and reports
- **Fix** — the AI addresses a reported problem and verifies the result

---

## What Good Turns Look Like

### Framing: "make a dub techno track"

The project is empty. The request is broad. Multiple valid directions exist.

```
USER: make a dub techno track

GLUON: I'm thinking 118 BPM, F minor — a deep rolling kick,
a sub-bass that sits underneath, and a reverb-drenched chord stab.
Should I start with the kick and sub foundation, or the chord stab?

  tool calls: set_intent({ genre: ["dub techno"], mood: ["deep", "hypnotic"] })
  Changed: intent updated
```

**Why this is good:** The AI proposed a concrete direction and yielded at the first real decision point. It set intent to record the emerging direction but didn't touch sound. The user can steer before anything lands.

**When to skip framing:** If the request is groove-led or timbre-led ("give me a shuffling hat pattern", "make something that sounds like tape"), a short audible sketch may collapse ambiguity faster than discussion. The heuristic: if the user would need to *hear* it to know whether they want it, prototype. If they could steer with a one-sentence answer, frame.

### Execute: "yes, start with the kick"

The direction is confirmed. The AI builds one coherent musical idea.

```
USER: yes, start with the kick and sub

GLUON: Here's the foundation — analog bass drum at 118 BPM with
a four-on-the-floor pattern, and a sub-bass with a syncopated
line underneath. How's the low end sitting?

  tool calls: set_transport, set_scale, manage_track (×2),
    set_model (×2), sketch (×2), apply_chain_recipe (×2),
    set_mix_role (×2), shape_timbre (×2)
  Changed: +Kick track, +Sub track, 118 BPM, F minor
```

**Why this is good:** One musical idea (the rhythmic foundation), executed completely, then yielded with a specific question about the result. The kick and sub are one idea because they're musically interdependent — you can't evaluate the kick without the sub.

**What "one idea" means in practice:** Could the user undo this turn and lose exactly one musical decision? If undoing would lose multiple *independent* decisions (kick sound + unrelated chord stab), the turn tried to do too much. But interdependent elements (kick + sub that share a frequency relationship) are one idea.

### Diagnose: "listen to the sub and tell me what you hear"

The user asked the AI to inspect, not to fix.

```
USER: the sub sounds broken — can you listen and tell me what you hear?

GLUON: I rendered the sub in isolation and ran spectral analysis.
The fundamental is at 52Hz which is right, but there's significant
energy at 800Hz–2kHz — way too much midrange for a sub. The
harmonics control is at 0.66 which adds detuning and buzz.
I'd suggest either dropping harmonics to near zero, or swapping
to the waveshaping engine for a cleaner sine. Want me to try one
of those?

  tool calls: render({ scope: "Sub" }), analyze({ types: ["spectral"] })
  Changed: (none — read-only)
```

**Why this is good:** The user said "tell me what you hear" — the AI listened, reported what it found with specifics, and proposed two fixes without executing either. The user stays in control of the decision.

**Contrast with a bad version:** The AI listens, swaps the engine, and says "I fixed it — how's that?" The user didn't ask for a fix. Even if the AI's judgment was right, it skipped the user's decision point.

**When blending is appropriate:** If the user says "the sub sounds broken, fix it" — that's a fix request, not a diagnose request. The AI should act. The distinction is in the user's intent, not in a mechanical rule about which tools are allowed.

### Fix: "make the kick deeper"

The user reported a problem. The AI should fix it *and verify*.

```
USER: the kick is too bright, make it deeper

GLUON: I pulled the timbre down to 0.15 and dropped the frequency
to 0.20 for more sub weight. Spectral diff shows the centroid
moved from 180Hz to 95Hz — significantly darker. How does it
feel now?

  tool calls: move(timbre, 0.15), move(frequency, 0.20),
    render(), analyze({ types: ["diff"] })
  Changed: Kick timbre, Kick frequency
  Verified: spectral centroid 180Hz → 95Hz
```

**Why this is good:** The AI made targeted changes, then verified with the cheapest sufficient tool (deterministic spectral diff, not the expensive qualitative listener). It reported the verification result so the user can trust the handoff.

**Verification guidance:** After fixing a reported problem, check your own work before handing back. Use the cheapest tool that answers the question:

- **Read state** (free) — "Did my param change apply?"
- **`analyze`** (cheap) — "Is this actually darker?" "Does the spectral content look right?"
- **`listen`** (expensive) — "Does this *feel* right in context?" Reserve for vibe questions.

If verification shows the fix didn't work, try one more approach. If that also fails, yield honestly rather than handing back confidently.

### Fix with failure: "remove the midrange buzz"

Sometimes the first attempt doesn't work.

```
USER: the sub still has midrange buzz

GLUON: I swapped the engine to waveshaping and zeroed the
harmonics for a pure sine. But the spectral analysis still
shows energy at 1.2kHz — the EQ's mid-band gain is boosting
there. Let me also pull that down.

  [step 1] set_model(waveshaping), move(harmonics, 0.0)
  [step 2] render(), analyze() → still has 1.2kHz energy
  [step 3] move(eq/mid1-gain, 0.35)
  [step 4] render(), analyze() → clean below 200Hz ✓

  Changed: Sub engine → Waveshaper, harmonics, EQ mid-gain
  Verified: spectral content clean below 200Hz
```

**Why this is good:** The AI verified after step 1, found it wasn't enough, diagnosed why (EQ mid-band), made a second targeted fix, and verified again. It didn't just hand back after the engine swap and hope.

### Partial execution

Some actions succeed, some fail. The turn should be honest about both.

```
GLUON: I set up the pattern and timbre, but couldn't add a second
processor — you already have two on this track. You could remove
the EQ if you want the reverb instead.

  Changed: pattern (4 events), timbre 0.50 → 0.30
  Failed: add processor (max 2 per track)
```

**Why this is good:** Successful actions commit (they're not rolled back because of unrelated failures). The AI explains what worked, what didn't, and suggests a path forward.

---

## Hard Constraints

These protect the product boundary. They are enforced by the runtime, not by prompt guidance.

### Undo
- All committed actions in a turn are grouped as one undo entry.
- Undo is always one action away. This is the primary safety net — the user can always get back.
- If a turn is interrupted, the committed actions still form an undo group.

### Permission gate
- The AI's actions pass through a permission gate before execution. The gate surfaces what the AI is about to do and lets the user approve or deny.
- The user can interrupt at any time. The current in-flight step completes, no further steps start.

### Inspectability
- Every tool call is logged and visible (collapsed by default, expandable).
- Parameter changes show before→after values.
- The summary card reflects what actually happened, not what was attempted.

---

## Interrupted Turns

When the user sends a message, clicks a chip, tweaks a knob, or hits undo during AI execution:

1. The current in-flight step completes (actions already dispatched are not cancelled).
2. No further steps start.
3. Committed actions are grouped for undo.
4. Whatever text/tool-log was produced renders as-is — no yield text is fabricated.
5. The summary card shows committed actions only. Follow-up chips are omitted (the user already indicated their next intent by interrupting).
6. A truncation indicator appears: "Interrupted — N actions applied."
7. The new user action (message, knob, undo) takes effect with fresh state.

---

## Scope Visibility

Before execution, the UI should surface which tracks the AI is about to touch: `Kick · Sub · Hats`. This appears as scope badges when the first tool call signals its target tracks. Approval level is shown when a track is `liked`, `approved`, or `anchor` — these carry preservation expectations the user should see.

---

## Turn Rendering Sequence

1. **User message** renders in chat.
2. **Phase label** in footer: `Thinking...`
3. **Scope badges** appear (if target tracks known from first tool call).
4. **Streaming text** appears incrementally.
5. **Phase label** updates: `Applying N changes` (N increments live from executor, not planner).
6. **Tool call log** renders below text, collapsed by default.
7. **Phase label** updates: `Listening...` or `Verifying...` if a verification step runs.
8. **Yield text** renders **below** the tool call log — this is the handoff, the last thing the user reads. Chat auto-scrolls to it.
9. **Summary card**: Changed / Why / follow-up chips / undo.

**Key:** yield text must be the last content block before the summary card. The user should never scroll up to find the AI's question.

### Data sources

| Element | Source | Notes |
|---------|--------|-------|
| Phase label | Executor state | Authoritative — not inferred from AI text |
| Changed | Committed action log | Only successful actions |
| Why | Structured turn output, fallback to first sentence of AI text | Prefer structured field when available |
| Follow-up chips | `suggest_reactions` tool, fallback to category heuristic | AI-suggested preferred |
| Scope badges | First tool call targets + agency/approval lookup | Approval shown only for non-exploratory tracks |

---

## Relationship to Other Docs

- `docs/principles/ai-collaboration-model.md` — phase-level behavior (frame/sketch/iterate/expand/refine). This doc adds turn-level mechanics.
- `docs/principles/ai-interface-design-principles.md` — the design rules this doc follows: treat the model as intelligent, guide rather than hard-route, constrain to musical dimensions.
- `docs/principles/ai-capability-doctrine.md` — hard boundaries stay hard, everything else empowers. This doc's hard constraints section maps directly to the doctrine's boundaries.
- `docs/briefs/chat-ux.md` — UI rendering of turns (summary cards, phase labels, scope badges). This doc defines what data those components consume.
- `docs/ai/ai-contract.md` — tool definitions, state format, validation rules. This doc shows how to use those tools well.
