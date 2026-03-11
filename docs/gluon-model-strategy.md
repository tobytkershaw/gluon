# Gluon: AI Model Strategy

**Status:** Planning document for Phase 2
**Date:** March 2026

---

## The Problem

Phase 1 uses a single LLM (Claude Sonnet via the Anthropic API) for all AI reasoning. The AI sees parameter values as numbers and responds with structured JSON actions. This works for basic parameter tweaking and natural language dialogue, but has two fundamental limitations:

1. **The AI cannot hear.** It knows timbre is at 0.45 and morph is at 0.72, but it doesn't know what that sounds like. It infers from training data. This breaks down with multiple interacting voices, with effects chains, and with any situation where the perceptual quality of the sound matters more than the parameter values.

2. **The AI cannot create audio.** It can write MIDI patterns and set parameter values, but it cannot generate a drum loop, a texture, a vocal sample, or any raw audio material. Everything must be synthesised through Gluon's engines.

Both limitations can be addressed by moving from a single-model architecture to a multi-model architecture where each model does what it's genuinely best at.

---

## Model Roles

The Gluon AI companion needs to operate at four different timescales and across several different capabilities. No single model is best at all of them.

### 1. The Thinker (Compositional Reasoning)

**What it does:** Translates natural language into protocol actions. Reasons about musical structure. Sketches arrangements. Writes MIDI patterns. Responds to "make it darker" or "sketch a B section that drops the energy."

**Timescale:** 2-30 seconds (compositional), human-paced (conversational)

**Requirements:** Strong structured output (JSON action arrays), music theory knowledge, ability to follow the Gluon protocol spec, nuanced natural language understanding.

**Best model:** Gemini 3 Flash or Gemini 3.1 Pro

Gemini 3 Flash combines Pro-grade reasoning with Flash-level latency and cost efficiency. For Gluon, the reasoning improvements over 2.5 mean better compositional planning, better pattern generation, and stronger adherence to structured output schemas. The dynamic thinking feature lets us set thinking_level to "low" for fast parameter decisions and "high" for complex arrangement sketching, paying for reasoning only when needed.

Gemini 3.1 Pro is the option for the most demanding reasoning tasks (complex multi-voice arrangement, long compositional arcs), but at higher latency and cost. Could be reserved for explicit "sketch" requests where the human is willing to wait.

**Why not Claude?** Claude is excellent at structured output and protocol adherence. It remains a strong alternative for the Thinker role. The advantage of Gemini here is not that it's necessarily better at reasoning, but that it keeps the entire model stack within one provider, simplifying API management, authentication, and billing. The Gluon protocol is model-agnostic, so switching between Claude and Gemini for this role should be straightforward.

### 2. The Listener (Real-Time Audio Understanding)

**What it does:** Processes the actual audio output of the Gluon session in real time. Understands what the sound actually sounds like, not just what the parameter values are. Detects when things sound harsh, muddy, resonant, rhythmically aligned, or harmonically interesting. Responds to the perceptual qualities of the music.

**Timescale:** 1-3 seconds (interactive)

**Requirements:** Native audio input processing, low latency, ability to reason about audio content and output structured responses (not just speech).

**Best model:** Gemini 2.5 Flash Native Audio (via the Live API)

This is the transformative capability. The Gemini 2.5 Native Audio model processes raw audio natively through a single model, not through a speech-to-text pipeline. It can understand tone, timbre, and musical qualities directly from the audio stream. The Live API provides a WebSocket connection for streaming audio in and getting structured responses back.

For Gluon, this means:

- Pipe the Web Audio output (or a mix of it) to the Gemini Live API as a continuous stream
- The AI hears what the human hears
- It can respond to perceptual qualities: "I can hear the filter is getting harsh in the upper register" rather than just knowing "morph is at 0.85"
- It can understand the interaction between multiple voices in a way that parameter-only reasoning cannot
- When hardware synths are involved (Phase 3+), the AI hears the actual hardware output rather than guessing from CC values

**Why this is novel:** Nobody is building a music collaboration tool where the AI actually hears what you're making in real time. Every existing AI music tool either generates audio (Suno, Lyria) or reasons about symbolic representations (MIDI, parameter values). An AI that listens and responds to the real sound is a different category of collaboration.

**Limitations:** The 2.5 Native Audio model is optimised for speech and conversational audio. Its ability to reason about musical timbre, harmony, and rhythm is not well documented. This needs experimentation. It may understand "this sounds bright and metallic" without understanding "this is a detuned sawtooth with high resonance." The gap between speech understanding and music understanding is an open question.

### 3. The Generator (Audio Material Creation)

**What it does:** Creates raw audio material: drum loops, textures, vocal snippets, ambient pads, one-shots. This material gets loaded into a sampler voice within Gluon for the human to chop, process, and arrange.

**Timescale:** 5-30 seconds (compositional, on request)

**Requirements:** High-quality audio generation with creative control over style, instrumentation, and mood. The output is raw material, not a finished track.

**Best model:** Lyria RealTime or Lyria 3

Lyria RealTime generates music in two-second streaming chunks that can be steered with text prompts in real time. This could serve as a live texture source within Gluon: the AI generates a rhythmic bed or ambient texture that evolves based on the session context, and the human can sample from it, process it, or just let it run alongside the Plaits voices.

Lyria 3 generates complete 30-second tracks from prompts with control over style, vocals, and tempo. For Gluon, this is less about generating finished tracks and more about generating source material: "give me a breakbeat loop at 140 BPM with a dusty vinyl feel" that then gets loaded into a sampler and manipulated within the session.

**Important distinction:** Using Lyria within Gluon is not the same as Suno-style generation. The generated audio flows through Gluon's instrument (loaded into a sampler voice, processed through effects, parameter-locked per step in the sequencer). The human manipulates it through the same protocol as everything else. It's raw material, not a finished product.

**Availability note:** Lyria RealTime is available via the Gemini API. Lyria 3 is rolling out via the Gemini app and YouTube Dream Track. API access for Lyria 3 specifically may need to be confirmed for developer use outside of Google's own products.

### 4. The Reflex (Sub-Second Reactive Response)

**What it does:** Responds within milliseconds to what the human just did. Nudges a complementary parameter when the human opens a filter. Adds subtle movement to a sound the human is holding. Follows the human's gestural intent in real time.

**Timescale:** 50-500ms

**Requirements:** Extreme low latency. Cannot involve an API round-trip. Must run locally.

**Best approach:** A lightweight local model or rule-based system running in the browser

No cloud API can reliably respond within 50-500ms including network round-trip. For the Reflex layer, the options are:

- **Rule-based automation:** The Thinker sets up automation curves and parameter relationships ("when timbre goes up, nudge resonance down slightly"). A local engine executes these rules without any model inference. This is what Phase 1's AutomationEngine already does.

- **Small local model:** A distilled model running in WASM in the browser. Trained or fine-tuned to map parameter states to suggested movements. Input: current parameter values + recent trajectory. Output: small delta for one or two parameters. This could be trained on data collected from Gluon sessions where the Thinker's suggestions were committed.

- **Gemini 3.1 Flash-Lite:** At $0.25 per million input tokens and 2.5x faster time-to-first-token than 2.5 Flash, this could potentially serve reactive responses if network latency is acceptable. But for truly sub-second response, local execution is still preferred.

For Phase 2, the rule-based approach (already implemented) is sufficient. A local model is a Phase 3+ consideration.

---

## Architecture

```
                          Human
                            |
                       [Gluon UI]
                            |
                    [Protocol Engine]
                     /      |      \
                    /       |       \
         [The Thinker]  [The Listener]  [The Generator]
         Gemini 3 Flash  Gemini 2.5     Lyria RealTime
         or 3.1 Pro      Native Audio   or Lyria 3
              |               |               |
         Structured      Audio stream    Audio output
         JSON actions    analysis        (samples)
              |               |               |
              +-------+-------+-------+-------+
                      |               |
               [Protocol Engine]  [Sampler Voice]
                      |
                 [Audio Engine]
                      |
                  [The Reflex]
                  Local rules /
                  automation
                      |
                   Speaker
```

All three cloud models feed into the same protocol engine. The Thinker produces `move`, `suggest`, `audition`, `sketch`, and `say` actions. The Listener produces `say` actions (describing what it hears) and can trigger `suggest` or `nudge` actions based on audio analysis. The Generator produces audio buffers that get loaded into sampler voices. The Reflex operates locally on the audio engine, executing automation curves and parameter relationships set up by the Thinker.

The protocol doesn't care which model issued an action. All actions flow through the same arbitration rules, the same undo stack, the same agency permissions. The human's hands always win regardless of which model is trying to act.

---

## Implementation Sequence

### Phase 2a: Switch to Gemini 3 Flash as the Thinker

**Effort:** Low. Replace the Anthropic API client with the Google Gen AI SDK. Update the system prompt. The protocol layer is unchanged.

This gives immediate benefits: lower latency for interactive responses, dynamic thinking levels for cost control, and alignment with the rest of the Google model stack.

Keep the Anthropic client as an option (environment variable or settings toggle) so users can choose their preferred model.

### Phase 2b: Add the Listener (Gemini 2.5 Native Audio)

**Effort:** Medium. This requires:

1. Capture the Web Audio output as a stream (MediaStreamDestination node)
2. Open a WebSocket connection to the Gemini Live API
3. Stream audio chunks to the API continuously
4. Receive structured responses (not speech output, but text/JSON analysis of the audio)
5. Parse responses into protocol actions (primarily `say` for descriptions, `suggest` for parameter recommendations)

The Live API supports function calling during dialogue, which maps naturally to Gluon's protocol primitives. The AI could call a `suggest` function or a `nudge` function as tool calls rather than generating JSON that needs parsing.

**Key experiment:** Test whether the 2.5 Native Audio model can meaningfully reason about synthesiser output (as opposed to speech). If it can distinguish "bright and harsh" from "warm and smooth" in synthesised audio, that's enough. If it can identify specific qualities like "there's a resonant peak around 2kHz" or "the two oscillators are slightly detuned," that's exceptional.

### Phase 2c: Add the Generator (Lyria)

**Effort:** Medium-High. This requires:

1. API integration with Lyria RealTime or Lyria 3
2. A sampler voice in Gluon that can load and play back audio buffers
3. UI for requesting and managing generated audio
4. Integration with the sequencer (the sampler voice should be sequenceable)

This is less urgent than the Listener because it adds a new capability (audio generation) rather than improving an existing one (AI responsiveness). It could be Phase 3 instead.

---

## Cost Considerations

Running three models simultaneously is more expensive than one. Rough estimates per hour of active jamming:

| Model | Role | Call Frequency | Est. Cost/Hour |
|---|---|---|---|
| Gemini 3 Flash | Thinker | ~60 calls/hour (1/min avg) | ~$0.10-0.30 |
| Gemini 2.5 Native Audio | Listener | Continuous stream | ~$0.50-2.00 (TBD) |
| Lyria RealTime | Generator | On demand, ~5-10 calls/hour | ~$0.10-0.50 |
| **Total** | | | **~$0.70-2.80/hour** |

These are rough estimates. The Listener is the most expensive because it's a continuous audio stream. Whether that cost is acceptable depends on the value it adds. If the AI being able to hear makes the collaboration dramatically better, it's worth it. If it's a marginal improvement over parameter-only reasoning, it might not be.

The system should degrade gracefully. If the Listener is disabled (to save cost, or because the API is unavailable), the Thinker still works using parameter values alone, exactly as Phase 1 does now. Each model layer is additive, not required.

---

## The Google Advantage

Using the Google model stack (Gemini + Lyria) has a practical advantage beyond model quality: everything is accessible through one API provider, one authentication system, one billing account. The alternative (Claude for thinking, Gemini for listening, Lyria for generation) works technically but means managing three separate API integrations.

That said, the Gluon protocol is explicitly model-agnostic. The AI layer is pluggable. Users should be able to:

- Use Claude for the Thinker if they prefer (or if they have an Anthropic API key and not a Google one)
- Disable the Listener entirely (parameter-only mode, lower cost)
- Disable the Generator entirely (synthesis-only mode, no sampled audio)
- Run a local model for the Thinker (for offline use or privacy)

The model strategy is a recommendation, not a requirement. The protocol doesn't change regardless of which models sit behind it.

---

## What This Enables

With the full multi-model stack, a Gluon session could look like this:

1. You start playing with a Plaits voice. The Thinker (Gemini 3 Flash) observes your parameter movements.

2. You open the filter slowly. The Reflex (local automation) nudges the resonance to complement your movement.

3. The Listener (Gemini 2.5 Native Audio) hears the actual sound and says: "Nice metallic resonance building. If you push morph a bit further you'll hit a sweet spot where the harmonics lock in."

4. You ask: "Give me a dusty breakbeat loop to go with this." The Thinker sends a request to the Generator (Lyria). A few seconds later, a drum loop appears in a sampler voice, already tempo-matched to your session.

5. You start arranging: the Thinker sketches a 16-step pattern for the bass voice, the Listener notices the kick and bass are clashing and suggests a frequency adjustment, and the Reflex keeps the filter movement smooth as you perform.

6. Throughout all of this, the leash controls how much each model does, the agency settings control which voices they can touch, and the undo stack catches everything. Your hands always win.

That's a qualitatively different experience from Phase 1's single-voice parameter tweaking. And it's built entirely on the same protocol.
