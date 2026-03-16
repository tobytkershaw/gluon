# Cross-Model Consultation Brief

## The Idea

Let the planner model (GPT) consult the listener model (Gemini) *before* committing changes, not just after. Turn the one-directional listen→evaluate flow into a creative dialogue.

## Why This Is Interesting

The model stack already has a natural division of labor:

| Model | Strength | Training signal |
|-------|----------|-----------------|
| **GPT-5.4** (planner) | Structured reasoning, constraint following, tool use, state management | Text, code, symbolic |
| **Gemini 3 Flash** (listener) | Audio understanding, timbral judgment, genre awareness, mix evaluation | Text, code, and likely a large corpus of real audio (YouTube-scale) |

GPT knows music theory. Gemini knows what music *sounds like*. That's a fundamentally different kind of knowledge — pattern-matched against real recordings rather than derived from symbolic descriptions.

Currently Gemini only speaks when asked to `listen` or `analyze` — post-hoc evaluation after GPT has already committed changes. The feedback loop is: plan → execute → evaluate → maybe undo and try again.

The consultation model tightens this to: plan → consult → adjust → execute. Cheaper to course-correct before writing than after.

## Current Flow

```
Human: "Add a bass line"
  → GPT plans sketch (symbolic reasoning)
  → GPT executes sketch
  → GPT optionally calls listen tool (post-hoc)
  → Gemini evaluates audio
  → GPT reports to human
  → Human: "That doesn't work" → undo, try again
```

## Proposed Flow

```
Human: "Add a bass line"
  → GPT plans sketch (symbolic reasoning)
  → GPT calls consult tool (pre-commit)
  → Gemini receives: current audio + proposed changes + question
  → Gemini: "The bass will clash with the pad in the low-mids.
     Try an octave higher or a brighter timbre."
  → GPT adjusts plan
  → GPT executes adjusted sketch
  → Human hears a better result on the first try
```

## What Gemini Brings to the Conversation

Gemini's audio training likely gives it abilities that GPT lacks:

- **Timbral reasoning**: "This synth patch will sound muddy in that register" — judgment from hearing thousands of mixes, not from frequency charts
- **Genre awareness**: "This rhythm pattern is more drum & bass than the UK garage you're going for" — pattern-matched against actual music
- **Mix intuition**: "You already have a lot going on in the 200-500Hz range" — from hearing what cluttered mixes sound like
- **Production conventions**: "Acid lines typically stay in a narrow pitch range with heavy filter modulation" — from hearing real acid tracks, not reading about them
- **Aesthetic feedback**: "This has a late-90s IDM quality" — associative judgment from audio exposure

This is knowledge that's hard to encode in prompts or tool schemas. It's experiential, not procedural.

## Tool Shape

A `consult` tool available to the planner:

```typescript
interface ConsultTool {
  // What GPT wants to know
  question: string;

  // Optional: what GPT is about to do (symbolic)
  proposedActions?: AIAction[];

  // Optional: reference audio snapshot
  snapshotId?: string;

  // Focus area for Gemini's response
  focus?: 'harmony' | 'timbre' | 'rhythm' | 'mix' | 'style' | 'general';
}

interface ConsultResponse {
  advice: string;           // Gemini's musical judgment
  confidence: number;       // 0-1, how sure Gemini is
  concerns?: string[];      // specific issues flagged
  suggestions?: string[];   // alternative approaches
}
```

## When Should GPT Consult?

Not every action — that would add latency and cost. GPT should consult when:

- **Uncertain**: "I'm not sure if this harmonic choice works" — the planner knows the limits of its own knowledge
- **High stakes**: About to modify approved/anchor material — preservation contracts make mistakes expensive
- **Genre-specific**: The human asked for something in a specific style that GPT can't confidently reason about symbolically
- **Mix decisions**: Adding new elements to a busy mix — spatial/spectral judgment is Gemini's strength
- **Human feedback suggests a miss**: After the human rejected a previous attempt, consult before the retry

GPT should NOT consult for:

- Simple parameter moves (turn up the volume)
- Mechanical operations (transpose, copy region)
- When the human gave explicit instructions ("set timbre to 0.3")

This mirrors real collaboration — you don't ask your bandmate's opinion on every note, but you do check in before committing to a direction.

## What the Human Sees

Full transparency. The consultation appears in the chat:

```
AI: I'm planning a bass line in F minor. Let me check how it'll
    sit with the existing pad...

[Consulting listener model...]

AI: The listener suggests the low register will compete with the
    pad. Moving the bass up an octave and using a brighter timbre.

[Executes adjusted sketch]
```

The human sees the reasoning, not just the result. This builds trust — the AI is showing its work.

## Interaction with Existing Systems

### Listen tool (post-hoc)
Consult doesn't replace listen. Listen evaluates what *happened*. Consult evaluates what *might happen*. Both are useful:

```
consult → "Will this work?"     (pre-commit, symbolic + audio context)
execute → commit changes
listen  → "Did it work?"        (post-commit, actual rendered audio)
```

If listen disagrees with consult's prediction, that's useful signal for calibrating trust.

### Preservation contracts (M6)
Consult is especially valuable when editing near preserved material. GPT can ask: "I want to add syncopation to the hi-hats — will this change the feel of the approved drum pattern?" Gemini can judge whether the proposed change crosses the preservation boundary better than a symbolic diff can.

### Reaction history (M6)
Over time, the planner accumulates evidence about whether Gemini's advice was good. If the human consistently accepts changes that followed Gemini's advice, GPT should consult more often. If the human overrides Gemini's suggestions, GPT should rely more on its own judgment. This is emergent — no special mechanism needed beyond the existing reaction history.

## Risks and Mitigations

### Latency
An extra round-trip (typically 1-3s for Gemini Flash) before each consulted action. Mitigated by:
- Only consulting when uncertain or high-stakes (not every action)
- Gemini Flash is fast — this is why we use Flash, not Pro
- The human sees "Consulting..." in chat, so the delay is legible

### Cost
Two model calls per consulted action. Mitigated by:
- Selective consultation (GPT decides when)
- Gemini Flash is cheap
- Better first-try results mean fewer undo→retry cycles (net cost may decrease)

### Disagreement loops
GPT and Gemini could go back and forth. Mitigated by:
- Cap at one consultation per action (no multi-turn debates)
- GPT has final decision authority — Gemini advises, GPT decides
- If they disagree, GPT should note the disagreement to the human

### Gemini hallucination
Gemini might give confidently wrong musical advice. Mitigated by:
- The listen tool provides ground truth after execution — bad advice gets caught
- Confidence scores let GPT weight the advice appropriately
- The human sees the consultation and can override

## Relationship to Web Search

Originally considered alongside a web search tool for musical references. But Gemini's audio training likely makes web search less important for musical knowledge — Gemini already has "heard" more music than any web search could surface. Web search might still be useful for:
- Specific factual lookups (what key is a specific song in?)
- Synthesis technique recipes (how to program a specific sound on a specific synth)
- Current trends (what's happening in music right now, post-training-cutoff)

But for "will this sound good?" and "what would a producer do here?" — Gemini's audio-grounded judgment is likely better than any text search result.

## Priority

This is a product design exploration, not a near-term implementation target. It depends on:
- The current model stack being stable (M6X, complete)
- The consultation adding measurable value over the existing listen→evaluate loop
- The latency/cost trade-off being acceptable in practice

A spike to test the consultation flow with a few hardcoded scenarios would answer the key question: **does Gemini's pre-commit advice actually improve first-try quality?** If yes, build the tool. If the advice is generic or unhelpful, the idea is interesting but not yet practical.

## Open Questions

1. **Should the human be able to trigger consultation explicitly?** ("Ask Gemini what it thinks before you do that.") This is capability parity — if the AI can consult, the human should be able to request it.

2. **Should Gemini have access to the full session state, or just audio?** Sending the compressed state gives Gemini symbolic context (what tracks exist, what parameters are set). But Gemini's strength is audio — maybe it's better to just send the audio snapshot and let it reason from what it hears.

3. **Could this extend to other "consultants"?** A rhythm-focused model, a mixing-focused model, a genre specialist. The `consult` tool could route to different experts based on `focus`. This is speculative but architecturally clean.

4. **How does this interact with the AI capability doctrine?** The doctrine says "keep boundaries hard, maximize usefulness inside them." Consultation expands the AI's usefulness without changing the boundaries (the human still directs, the AI still acts when asked, undo still works). It just makes the AI smarter within those boundaries.
