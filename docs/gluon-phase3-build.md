# Gluon: Phase 3 — Agentic Music Assistant
## Claude Code Implementation Brief

---

## Context

Phase 1 (PoC) and Phase 2 (Sequence & Layers) are complete. The codebase has a working browser synth with 4 voices, step sequencer, Gemini chat integration, undo, and arbitration. A spike proved that Gemini's native audio model can meaningfully listen to and describe Plaits synthesis in real-time.

The codebase currently carries two conceptual models: the **reactive jam partner** (leash slider, suggest/audition actions, pending overlay, reactive loop, 3-state agency) and the **agentic assistant** that the architecture docs now describe. Phase 3 resolves this by removing the reactive machinery entirely and building the agentic model clean.

This document describes what to build for Phase 3. Read `docs/status.md` for a detailed inventory of what currently exists.

---

## What Phase 3 Is

The pivot from "AI jam partner" to "Claude Code for music." After Phase 3:

1. The human types what they want in the chat panel
2. The AI reads the full project state, makes structured edits, and reports what it changed
3. Changes apply immediately — if they sound wrong, undo reverses the whole action group
4. Optionally, the human can ask the AI to listen to the result via an audio snapshot
5. The AI evaluates its own work and suggests further refinements

The UI is multi-view, inspired by Ableton Live (Session/Arrangement views) and Google Antigravity (full IDE vs. agent-only): a **Chat view** for pure conversation with the AI, and an **Instrument view** showing the parameter space, step grid, and controls. Both views are always available; the musician switches between them based on workflow. The chat is the primary way to direct the AI, but you shouldn't have to stare at a chat window while you're tweaking knobs.

The AI only acts when asked. There is no leash, no pending approval flow, no reactive loop.

---

## Architecture After Phase 3

```
Browser
+----------------------------------------------------------+
|                                                          |
|  React UI (multi-view)                                   |
|  - Chat view: full-screen conversation with AI           |
|  - Instrument view: param space, step grid, controls     |
|  - Shared: transport, undo, voice selector, agency       |
|  - View switcher (keyboard shortcut + UI toggle)         |
|                                                          |
|  Gluon Engine                                            |
|  - Session state (voices, patterns, transport, context)  |
|  - Protocol primitives: move, sketch, say                |
|  - Action group undo stack                               |
|  - Arbitration (human's hands always win)                |
|                                                          |
|  AI Layer                                                |
|  - Gemini API (reasoning + structured edits)             |
|  - System prompt (agentic assistant model)               |
|  - State compression (session → compact JSON)            |
|  - Response parsing (JSON → protocol actions)            |
|  - Conversation history (sliding window)                 |
|                                                          |
|  Audio Eval (optional per-request)                       |
|  - MediaRecorder capture (N bars, real-time)             |
|  - Gemini native audio model (discrete eval call)        |
|  - Text assessment returned to chat                      |
|                                                          |
|  Audio Engine                                            |
|  - Plaits WASM (4 voices, AudioWorklet)                  |
|  - Sequencer/scheduler                                   |
|  - MediaStreamDestination (for capture)                  |
|                                                          |
+----------------------------------------------------------+
```

---

## Step-by-Step Build Plan

### Step 1: Remove the Reactive Model

**Goal:** Delete every trace of the old reactive/jam-partner model. After this step, the codebase has one clean conceptual model: the agentic assistant.

**Why this is first:** Every subsequent step builds on this foundation. Leaving stale reactive code creates confusion for both humans and AI working on the codebase. The system prompt currently references leash-aware behaviour and five action types — if we change the engine without updating the prompt, the AI will emit actions the system no longer understands.

**What to remove:**

1. **Agency**: Change from `'OFF' | 'SUGGEST' | 'PLAY'` to `'OFF' | 'ON'`
   - Update `Agency` type in `src/engine/types.ts`
   - Replace `AgencyToggle.tsx` (3-button) with a simple ON/OFF toggle
   - Update all agency checks throughout the codebase

2. **Leash slider**: Delete entirely
   - Remove `LeashSlider.tsx` component
   - Remove `leash` from `Session` type and `session.ts`
   - Remove leash from state compression
   - Remove leash references from system prompt

3. **Reactive loop**: Delete the `react()` method and its 15s interval
   - Remove `react()` from `GluonAI` class in `src/ai/api.ts`
   - Remove the reactive interval timer from `App.tsx`
   - The AI now only responds to `ask()` calls

4. **Pending actions system**: Delete entirely
   - Remove `suggest` and `audition` action types from `AIAction` union
   - Remove `PendingAction` type and all pending state from `Session`
   - Remove `applySuggest()`, `applyAudition()`, `applySketchPending()`, `commitPending()`, `dismissPending()` from primitives
   - Remove `PendingOverlay.tsx` component
   - Remove audition expiry loop from `App.tsx`
   - Remove commit/dismiss handlers from `App.tsx`

5. **Listener spike UI**: Remove `ListenerSpike.tsx` (functionality will be rebuilt properly in Step 4)

6. **System prompt rewrite** (do this as part of Step 1, not later):
   - Remove all leash-aware behaviour references
   - Reduce action types from 5 to 3: `move`, `sketch`, `say`
   - Reframe the AI's role: "You are an assistant that makes changes when asked. You do not act autonomously."
   - Update the response format documentation
   - Add scope control rule: "By default, make minimal and local edits. Only make broad changes across multiple voices when the human clearly asks for it."

7. **`sketch` semantics**: Define `sketch` as immediate (like `move`). All AI changes apply on receipt, undo to revert. No proposal/approval flow for any action type.

   **Note on sketch blast radius:** `sketch` covers a wider range of changes than `move` — from toggling a few steps in a kick pattern to rewriting an entire 64-step sequence with parameter locks. For Phase 3, all sketches apply immediately and are undoable. If user testing reveals that larger structural sketches (arrangement changes, multi-voice rewrites) feel too aggressive as immediate-apply, a lighter staging mechanism for those cases can be added in polish — but do not reintroduce the old pending machinery.

**What to keep:**
- `move` action type (apply immediately, push to undo stack)
- `sketch` action type (apply immediately, push to undo stack)
- `say` action type (display in chat)
- `ask()` method on `GluonAI`
- Arbitration (human's hands always win)
- Automation engine (smooth parameter interpolation for `move` with `over`)
- State compression (update to remove leash/pending fields)

**Agency rule — OFF means hands-off, not blind:**
When a voice is OFF, the AI cannot modify it but can still observe it for context. This lets the AI reason about the full mix ("the kick on v0 is at 120 BPM, so I'll write a bass pattern that locks to it") without being able to change protected voices.

**Success criteria:** The app compiles, runs, and the only way the AI acts is when the human types a message and sends it. No leash, no pending overlays, no reactive loop. The system prompt matches the new model exactly.

---

### Step 1b: Audio Quality Audit

**Goal:** Fix audio artifacts in the Plaits WASM implementation. The synth currently produces audible glitches, clicks, and tonal artifacts that undermine the entire experience. If the instrument sounds broken, nothing else matters — the AI could make perfect decisions and the result would still sound wrong.

**Why now:** This sits between cleanup (Step 1) and feature work (Steps 2–4) because it's foundational. Every step after this — chat-driven editing, audio snapshots, AI evaluation — depends on the instrument sounding right. Audio artifacts also confuse the AI's audio evaluation: if Gemini hears clicks and distortion, it can't distinguish "the sound design is harsh" from "the implementation has bugs."

**What to investigate:**

1. **Sample rate and buffer alignment**: Check that the AudioWorklet buffer size, WASM render block size, and Web Audio sample rate (48kHz) are all aligned. Mismatches cause clicks at buffer boundaries.

2. **Parameter smoothing**: Plaits on hardware receives smoothed CV inputs. In WASM, parameter changes arrive as discrete jumps (especially from mouse/touch). Abrupt parameter changes mid-render-block cause discontinuities. Check whether we need to interpolate parameters between render calls.

3. **Voice triggering**: Check the trigger/gate logic. Plaits expects specific trigger pulse behaviour; incorrect triggering causes tonal artifacts, especially on the physical modelling engines (modal resonator, string, drums).

4. **Render block size**: Plaits was designed for small block sizes (typically 24 samples on STM32). Check what block size we're using in the AudioWorklet and whether it matches what Plaits expects. Too-large blocks can cause issues with some engines.

5. **Model-specific issues**: Some Plaits models may have specific requirements (e.g., the speech model needs particular parameter ranges, the drum models need trigger pulses not gates). Test each of the 16 models systematically.

6. **Reference comparison**: The `plaits/test/plaits_test.cc` command-line test renders to WAV. Render the same parameter settings in our WASM build and in the test program, compare the output. Any differences point to integration bugs.

**Approach:** This is primarily investigation and targeted fixes, not a rewrite. Start with the reference comparison (point 6) — if the WASM output matches the test program output, the issue is in the Web Audio integration layer. If it doesn't match, the issue is in the WASM compilation or wrapper.

**Success criteria:** All 16 Plaits models produce clean, artifact-free audio. Sweeping parameters smoothly across the 2D space produces smooth timbral changes with no clicks or glitches. The drum models (kick, snare, hat) trigger cleanly.

---

### Step 2: Richer Chat + Action Log + Multi-View UI

**Goal:** Build the two-view UI and make the chat the primary way to direct the AI. The human asks, the AI acts, and the chat shows exactly what changed.

**Why before undo:** Once the new product loop is visible and testable (ask → act → see what changed → iterate), we can see more clearly what the grouped undo UX needs to look like.

**What to build:**

1. **Two-view layout**: Implement a view switcher between:
   - **Chat view**: Full-screen (or near-full-screen) conversation with the AI. Minimal instrument chrome — just transport, undo, and a compact voice/agency indicator. This is where you direct the AI and read its responses. Think Antigravity's agent-manager mode.
   - **Instrument view**: The current layout — parameter space, step grid, voice selector, model picker, visualiser. A compact chat input/last-message strip stays visible so you can still talk to the AI while tweaking. Think Ableton's Session view.
   - **Shared elements**: Transport bar, undo button, and voice agency toggles are visible in both views.
   - **Switching**: A keyboard shortcut (e.g., Tab or Cmd+1/Cmd+2) and a visible toggle. The switch should be instant — no loading, no animation delay.
   - **Future view**: A tracker/timeline view is likely needed later (Phase 4+), but don't build infrastructure for it now. Just make the view-switching pattern clean enough that adding a third view later is straightforward.

3. **Inline action log**: When the AI responds with `move` or `sketch` actions alongside a `say`, display the changes inline in the chat:
   ```
   AI: Made the bass darker. Here's what I changed:
     ▸ v1 (bass): timbre 0.7 → 0.3, morph 0.5 → 0.2
     ▸ v1 (bass): model → Filtered Noise
   ```
   The action log should be concise and scannable. Show param names, old→new values, voice labels.

4. **Conversation history**: Send recent conversation history to Gemini alongside the compressed project state.
   - **Start simple:** keep the last **10–12 exchanges** (human+AI pairs) in full
   - Always include the full compressed project state with each request — this is the source of truth, not the conversation history
   - Only build a rolling summary/compression mechanism if testing reveals context-window or coherence problems over longer sessions. Don't overbuild this before it's needed.

5. **Model configuration**: Extract the model name to a single constant that's easy to change. Stay on `gemini-2.5-flash` (which is already working) unless testing reveals that reasoning quality is insufficient for multi-step edits. The constant makes upgrading to `gemini-2.5-pro` or `gemini-3-flash` a one-line change — do it when you need it, not preemptively.

6. **Improved `dispatchAIActions()`**: Currently in `App.tsx`, this function applies actions and adds chat messages. Refactor it to:
   - Collect all actions from a single AI response
   - Apply them as a batch
   - Generate a single action log entry for the chat
   - Return the action descriptions for undo labelling (used in Step 3)

**Success criteria:** You can switch between Chat view and Instrument view instantly. In Chat view, you have a multi-turn conversation with the AI and each response shows what it changed inline. In Instrument view, you can tweak parameters directly while still seeing a compact chat strip. The conversation flows naturally over 20+ exchanges without degradation.

---

### Step 3: Action Group Undo

**Goal:** When the AI makes a coordinated change across multiple parameters or voices, one undo reverses the whole thing.

**What to change:**

1. **New Snapshot type**: Replace the current flat snapshot with grouped snapshots:
   ```typescript
   type Snapshot = {
     type: 'group'
     description: string           // "Made bass darker (3 changes)"
     changes: IndividualChange[]   // The actual param/pattern snapshots to restore
     timestamp: number
   }

   type IndividualChange = ParamChange | PatternChange

   type ParamChange = {
     type: 'param'
     voiceId: string
     param: string
     previousValue: number
   }

   type PatternChange = {
     type: 'pattern'
     voiceId: string
     previousPattern: Pattern
   }
   ```

2. **Action group creation**: When `dispatchAIActions()` processes a response:
   - Snapshot all affected params/patterns **before** applying changes
   - Apply all changes
   - Push a single `Snapshot` with the description from the AI's `say` text (or a generated summary if no `say`)
   - One undo pops the whole group

3. **Undo UI**: The undo button should show what it will revert:
   - Tooltip or small label: "Undo: made bass darker (3 changes)"
   - After undo, briefly show what was reverted in the chat: "Undid: made bass darker"

4. **Stack limit**: Keep at 100 groups (not 100 individual changes).

5. **Human actions remain ungrouped and excluded from undo**: The undo stack only contains AI action groups. Human parameter changes via direct manipulation are not on the undo stack (this is unchanged from Phase 2).

**Success criteria:** "Make it darker" touches 3 params across 2 voices → one undo reverses all 3. The undo button shows what it will revert. The chat shows "Undid: ..." after undoing.

---

### Step 4: Audio Snapshot Evaluation

**Goal:** The AI can listen to the result of its changes and evaluate whether it achieved what the human asked for.

**Important:** This step has two unresolved technical questions. **Run both mini-spikes before starting the full integration.** If Mini-Spike A fails, the fallback path (wrapping the Live API for one-shot use) adds 1–2 days of complexity to this step.

**Step 4 is an extension, not a blocker.** The core Phase 3 value — ask/edit/explain/undo — is delivered by Steps 1–3. Audio eval makes the experience richer but the product is useful without it. If the spikes reveal unexpected complexity, ship Steps 1–3 and defer audio eval to Phase 3b.

#### Mini-Spike A: Discrete Audio Eval via Standard API

**Question:** Can we send an audio buffer to Gemini's standard `generateContent` API (not the Live API) and get a text evaluation back?

**Why this matters:** The native audio spike used the Live API (`bidiGenerateContent`) with streaming WebSocket. For Phase 3's discrete render-then-evaluate pattern, a standard API call with an inline audio part would be much simpler. If it works, we avoid the complexity of managing a Live API session for a one-shot evaluation.

**Test:**
1. Capture a few seconds of audio via MediaRecorder
2. Encode as base64 WAV/WebM
3. Send to `gemini-2.5-flash` (or `gemini-2.5-pro`) via `generateContent` with an inline audio part and a text prompt: "Describe the tonal quality of this synthesizer audio."
4. Check if we get a useful text response

**If it works:** Use standard `generateContent` for audio eval. Simple, stateless, no WebSocket management.
**If it doesn't:** Wrap the Live API in a "connect → send audio → get one text response → close" pattern. More complex but proven by the spike.

#### Mini-Spike B: MediaRecorder Capture Timing

**Question:** How long does it take to capture N bars of audio via MediaRecorder, and is the UX acceptable?

**Test:**
1. Start MediaRecorder on the existing MediaStreamDestination
2. Play 4 bars at 120 BPM (8 seconds of real-time audio)
3. Stop recording, extract the blob
4. Measure total wall-clock time from "start capture" to "blob ready"

**Expected:** ~8-9 seconds for 4 bars at 120 BPM. This is the real-time cost.

**Decision:** Start with MediaRecorder for Phase 3. Accept the real-time wait. Note OfflineAudioContext rendering as a Phase 4 optimisation (renders faster than real-time but requires reconstructing the full audio graph offline — significant engineering).

#### Full Integration (after spikes pass)

1. **Trigger:** The human explicitly asks for audio evaluation. Examples:
   - "How does this sound?"
   - "Listen to what you just did"
   - "Does this match what I asked for?"

   The AI does **not** automatically listen after every change. This keeps latency low and avoids doubling API cost per interaction. Automatic listening can be considered as a future enhancement once the basic loop works.

2. **Capture flow:**
   - Show a "Listening..." indicator in the chat
   - If transport is playing: capture N bars from current position via MediaRecorder
   - If transport is stopped: require the human to start playback first. The AI responds: "Start playback and ask me again — or I can describe what I expect based on the project state alone." Auto-starting playback would surprise the musician.
   - Default: 4 bars (configurable, could be shorter for quick checks)
   - **MediaRecorder is the pragmatic first cut, not the ideal architecture.** It captures in real-time (8 seconds for 4 bars at 120 BPM). OfflineAudioContext would render faster than real-time but requires reconstructing the full audio graph offline — that's Phase 4.

3. **Eval call:**
   - Send the audio buffer + text prompt to Gemini
   - Prompt includes: what the human asked for, what changes the AI made, and "evaluate whether the audio achieves the requested change"
   - Return text assessment to chat

4. **Chat integration:**
   ```
   Human: Make the bass darker and more sub-heavy
   AI: Done. Here's what I changed:
     ▸ v1 (bass): timbre 0.7 → 0.25, morph 0.5 → 0.15
     ▸ v1 (bass): model → Waveshaping Oscillator

   Human: How does it sound?
   AI: [Listening... 4 bars at 120 BPM]
   AI: The bass is noticeably darker — the high harmonics are gone and
       there's more energy in the low-mids. But it's lost some presence
       in the mix. Want me to add a touch of morph back to give it more
       body without brightening it?
   ```

5. **No automatic iteration:** The AI reports what it hears. The human decides whether to ask for further changes. The AI does not auto-modify based on its own evaluation (that would violate "AI acts when asked").

**Success criteria:** Human says "how does it sound?" → system captures audio → AI describes what it hears → human can direct further changes based on the AI's assessment.

---

### Step 5: Polish

**Goal:** Clean up rough edges and remove dead code.

1. **Dead code removal**: Sweep for any remaining references to leash, suggest, audition, pending, SUGGEST/PLAY agency, reactive loop, listener spike
2. **Chat panel improvements**: Better styling for action logs, expandable details for large changes, scroll behaviour
3. **Undo UX**: Keyboard shortcut hint, visual feedback on undo
4. **Error handling**: Graceful handling of Gemini API errors, rate limits, empty responses
5. **System prompt tuning**: Iterate on the prompt based on testing — does the AI make good changes? Does it stay within scope? Does it describe changes well?

---

## Key Design Decisions

### Agency: OFF means hands-off, not blind
The AI can observe OFF voices for context but cannot modify them. This lets the AI reason about the full mix without touching protected voices.

### All changes are immediate
No pending/approval flow. The AI's changes apply the moment they're parsed. If the human doesn't like it, undo. This matches how you'd work with a session musician: they play something, you either nod or say "not that."

### Minimal and local by default
The system prompt instructs the AI to make minimal, targeted edits unless the human clearly asks for broad changes. "Make the bass darker" should touch the bass voice, not rewrite the whole arrangement. This is the new scope control mechanism, replacing the old leash.

### Audio eval is human-triggered
The human decides when the AI should listen. This keeps response times fast for simple edits and avoids unnecessary API costs. The AI can suggest listening ("Want me to check how that sounds?") but doesn't do it automatically.

### Conversation history starts simple
Last 10–12 exchanges in full, compressed project state as source of truth. Only add rolling summaries or compression if testing reveals it's needed. Don't overbuild context management before you have evidence of the problem.

### `sketch` covers a wide blast radius
A sketch can be anything from "toggle three steps" to "rewrite a 64-step pattern with locks." All sketches apply immediately for Phase 3. If larger structural sketches feel too aggressive in testing, that's a polish-step refinement, not a reason to reintroduce pending flows.

---

## What This Does NOT Include

- OfflineAudioContext rendering (Phase 4 — faster-than-realtime audio snapshots)
- Automatic audio evaluation (Phase 4 — AI decides when to listen)
- Session persistence / save-load (Phase 4)
- MIDI output to hardware (Phase 4)
- DAW integration (Phase 5)
- Multiple synthesis engines beyond Plaits (future)

---

## Risks

**Audio quality:** The current Plaits WASM implementation has audible artifacts. The root cause is unknown — could be buffer alignment, parameter smoothing, trigger logic, or render block size. Step 1b is an investigation, and the fix could be trivial (a smoothing filter) or significant (reworking the AudioWorklet integration). Budget accordingly and use the reference comparison approach (WASM output vs. `plaits_test.cc` output) to isolate the problem quickly.

**Audio eval API path:** The spike used the Live API for streaming audio. Phase 3 needs discrete eval via the standard API. If the standard API doesn't accept audio inline, we'll need to wrap the Live API for one-shot use, which is messier. Mini-Spike A resolves this.

**MediaRecorder latency:** Capturing 4 bars at 120 BPM takes 8 real seconds. This is acceptable for Phase 3 but may feel slow. OfflineAudioContext rendering in Phase 4 would eliminate this wait.

**Gemini reasoning quality:** The agentic model requires stronger multi-step reasoning than the old reactive model (multi-param changes, pattern writing, arrangement decisions). If `gemini-2.5-flash` isn't sufficient, upgrading to `gemini-2.5-pro` or `gemini-3-flash` may be necessary. The model name should be easy to swap.

**Context window growth:** Even with the sliding window strategy, long sessions with audio eval will accumulate tokens. Monitor token usage and adjust the window size or compression strategy if needed.

---

## Success Criteria

### Core (Steps 1–1b–2–3) — Phase 3 ships when these work

1. All 16 Plaits models produce clean, artifact-free audio. Sweeping parameters produces smooth timbral changes with no clicks or glitches.
2. You open the app and can switch between Chat view and Instrument view
3. You type "Give me a four-on-the-floor kick with some swing"
4. The AI writes the pattern, the chat shows exactly what it created
5. You type "Make the bass darker and more sub-heavy"
6. The AI adjusts parameters on the bass voice only, the chat shows "v1 (bass): timbre 0.7 → 0.25"
7. You type "Push it further"
8. The AI makes more changes
9. You press undo — all the changes from step 8 revert as one group
10. The undo button showed "Undo: pushed bass further (2 changes)" before you clicked it
11. You type "Make the bass darker" with the bass voice agency set to OFF — the AI explains it can't modify that voice and suggests turning agency on
12. You type "Darken the bass" — the AI changes only the bass voice, not the kick, lead, or pad (scope control proof)

### Extended (Step 4) — Phase 3 bonus, not a blocker

13. You type "How does that sound?"
14. The system captures 4 bars (transport must be playing), the AI listens and says "The bass is darker but could use more body in the low-mids"
15. You can direct further changes based on the AI's assessment

That's the "Claude Code for music" experience. Direct, transparent, reversible.

---

## Reference Documents

- `docs/gluon-architecture.md` — Full vision and architecture (updated for agentic pivot)
- `docs/gluon-interaction-protocol-v03.md` — Protocol spec (v0.4.0)
- `docs/gluon-phase1-build.md` — Phase 1 build plan (for format reference)
- `docs/status.md` — Current build status and gap analysis
