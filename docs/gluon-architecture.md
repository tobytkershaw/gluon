# Gluon
## The binding force between human and AI music-making
### An open source platform for human-AI music collaboration

---

## What This Is

Gluon is the Claude Code of music: an open source platform built around an AI-legible musical core that you can glue instruments, workflows, and hardware onto. Not generative AI that writes songs for you. Not a chatbot that suggests chord progressions. A conversation-driven music tool where you direct the AI to make changes to your project, and that same structured core can connect to software instruments, DAWs, and external hardware. You listen to the result, give further direction, or undo.

At the centre of Gluon is a shared musical model that is legible enough for an AI to reason about and concrete enough for a human to play, steer, and override. That is the deeper claim behind "the Claude Code of music": not just prompt-driven editing, but a musical system that both humans and models can work inside.

The AI's role is closer to a skilled assistant than a session musician: it understands synthesis, sequencing, and sound design at the parameter level. You say "give me a four-on-the-floor kick with some swing" and it writes the pattern. You say "make the bass darker and more sub-heavy" and it moves the parameters. You say "that's too busy, strip it back" and it simplifies. It can hear the result of its own changes via audio snapshots (rendered clips sent to a multimodal model) and evaluate whether it achieved what you asked for.

The core loop:

1. **You describe what you want** (natural language in the chat panel)
2. **The AI reads the current project state** (voices, patterns, parameters) and optionally listens to a rendered audio clip
3. **The AI makes changes** (parameter moves, pattern edits, voice configuration)
4. **You listen to the result**
5. **You give further direction or undo**

That's a conversation, not a performance. The AI only acts when asked. There is no continuous streaming, no real-time jamming, no latency pressure. The cost is per-request, not continuous.

---

## Why This Doesn't Exist Yet

The AI music space has bifurcated into two dead ends:

**Generative music** (Suno, Udio, Google Lyria): AI generates complete audio from text prompts. The human is a prompter, not a musician. There is no collaboration, no iteration at the parameter level, no connection to real instruments. The output is a WAV file. It's a content machine.

**AI-assisted composition** (WavTool, various MIDI generators): AI generates MIDI clips or chord progressions. Text in, MIDI out. The AI doesn't listen, doesn't watch what you're doing, doesn't share control of a sound. It's a suggestion box.

Neither of these is collaboration. Collaboration requires:
- An instrument the human and AI both understand at the parameter level
- The AI can hear its own output (not just reason about numbers)
- Transparency about what the AI changed and why
- The ability to undo, override, or redirect at any moment
- A shared context that builds over the session
- The human stays in control: the AI acts when asked, not continuously

Gluon is designed around all of these properties from the ground up.

---

## Architecture

### Core Components

```
+--------------------------------------------------+
|                  Gluon Core                        |
|                                                   |
|  +-------------------+  +---------------------+  |
|  | Synthesis Engines  |  | Musical State       |  |
|  | (MI Plaits/Braids  |  | (voices, patterns,  |  |
|  |  compiled to WASM) |  |  params, context)   |  |
|  +-------------------+  +---------------------+  |
|  +-------------------+  +---------------------+  |
|  | AI Reasoning      |  | Constraint Engine    |  |
|  | (Gemini API,      |  | (per-voice agency    |  |
|  |  state → actions)  |  |  OFF/ON)             |  |
|  +-------------------+  +---------------------+  |
|                                                   |
+--------------------------------------------------+
         |              |              |
    +---------+   +-----------+   +----------+
    | Audio   |   | Audio     |   | UI       |
    | Engine  |   | Eval      |   | Layer    |
    | (WebAu, |   | (render   |   | (chat,   |
    |  WASM)  |   |  snapshot  |   |  params, |
    |         |   |  → Gemini) |   |  grid)   |
    +---------+   +-----------+   +----------+
```

### 1. Synthesis Engines (Mutable Instruments)

The Mutable Instruments open source DSP code is the foundation. These are arguably the best digital synthesis algorithms ever written for embedded hardware, now running as the "native voice" of Gluon.

**Plaits** (macro oscillator with 16 synthesis models):
- Virtual analog (VA oscillator with continuously variable waveshape)
- Waveshaping oscillator
- FM oscillator (2-operator FM)
- Grain oscillator (granular formant synthesis)
- Additive oscillator (harmonic oscillator)
- Wavetable oscillator
- Chord engine
- Speech synthesis
- Swarm of 8 sawtooth oscillators
- Filtered noise
- Particle noise (dust)
- Inharmonic string model
- Modal resonator (struck objects, bells)
- Analog bass drum
- Analog snare drum
- Analog hi-hat

Each model exposes two continuous parameters (TIMBRE and COLOR) plus pitch, creating a 2D parameter space per model. This is the key to the AI integration: the AI can reason about, visualise, and navigate these spaces.

**Braids** (future — not yet compiled to WASM):
Predecessor with 33 synthesis models including CZ-style phase distortion, vowel/formant synthesis, Karplus-Strong plucked strings, bowed strings, reed and flute physical models, particle synthesis, and more.

**Additional MI modules** (all open source, compiled to WASM and shipping):
- **Rings**: Resonator (sympathetic strings, modal synthesis)
- **Clouds**: Granular processor (for audio input processing)
- **Beads**: Granular processor (Clouds successor, texture/reverb modes)
- **Elements**: Full physical modelling voice (source or processor)
- **Tides**: Function generator / complex LFO (modulator)
- **Warps**: Signal crossfader/wavefolder/vocoder

**Built-in processors** (Web Audio / custom WASM):
- **Ripples**: Resonant filter (LP/BP/HP)
- **EQ**: Parametric equalizer
- **Compressor**: Dynamics processor (4 character modes)
- **Chorus**: Chorus/flanger effect
- **Distortion**: Waveshaping distortion
- **Stereo**: Stereo width/panning processor

Future compilation targets:
- **Native** (future: Rust wrapper around C++ DSP for desktop app)
- **VST/AU plugin** (future: for DAW integration)

### 2. Musical State Engine

A persistent representation of what is happening musically, updated in real time from all input sources (human interaction, audio analysis, MIDI input from hardware, AI actions).

The state includes:
- Current parameter values for all active engines/tracks
- Recent parameter change history (trajectories, not just snapshots)
- Active notes, rhythms, patterns
- Session-level context (key, tempo, energy arc, structural position)
- Human intent signals (what the human said, what they're doing)
- AI intent signals (what the AI is planning, what it has done)

This is the shared ground truth that both human and AI reason about. It's also the audit trail: you can always see what the AI changed, when, and (if it offered one) why.

### 3. AI Reasoning Layer

The interface between the musical state and an LLM. The AI operates in a request-response pattern: the human asks for changes, the AI reads the current state, makes structured edits, and the human evaluates the result.

**The agentic loop:**

1. Human sends a prompt ("make it darker", "write a hi-hat pattern", "add syncopation to the bass")
2. AI receives the compressed project state (all voices, patterns, parameters, transport)
3. AI responds with structured actions: parameter moves, pattern sketches, voice configuration changes
4. Actions are applied to the project (with undo support)
5. Optionally: AI renders an audio snapshot of the result and evaluates it via a multimodal model (Gemini native audio) before committing

**Audio evaluation (listen-then-judge):**

The AI can "hear" its own work by rendering a few bars of audio and sending the clip to a Gemini audio-capable model. This is fundamentally different from continuous streaming — it's a discrete evaluation step, like a musician playing back a recording to check their work. The audio snapshot is rendered offline (not real-time streamed), uploaded as a clip, and the model returns a text assessment. This informs whether to commit the changes or iterate.

This architecture deliberately favors unary audio critique over a Live API session. A Live/native-audio listener remains a plausible future direction if Gluon later wants continuous real-time listening rather than discrete snapshot-based evaluation.

**Model strategy:**

The architecture defines stable internal roles (planner, editor, listener, engine) rather than stable provider choices. One capable model currently handles reasoning, structured edits, and conversation; a multimodal audio model handles audio evaluation. Model and provider choice is an open investigation — the collaboration behavior contract (see `ai-collaboration-model.md`) comes first, and models are evaluated against it.

**Taste and memory:** The AI develops understanding of the user's preferences through conversation context, not through a separate taste model. Session history provides this naturally.

**Capability posture:** Once Gluon's hard collaboration boundaries are enforced — human authority, inspectability, undoability, and explicit permission rules — the default move should be to increase the AI's useful capability rather than constrain it further. In practice that means preferring richer tools, clearer state, and better consequence feedback over prompt-only caution or manual workaround paths.

### 4. Constraint Engine

The system that governs the AI's permissions. Simple and transparent.

**Per-voice permissions:**

Each voice has an agency setting that tells the AI what it's allowed to touch:

- **OFF**: AI cannot modify this voice (but can observe it for context)
- **ON**: AI can make changes to this voice when asked

That's it. Two states. The AI only acts when the human asks, so the complex leash/suggest/play hierarchy is unnecessary. Agency per voice lets the musician protect specific voices from AI changes ("don't touch my kick, but feel free to rewrite the lead").

These are hard boundaries. Once they are explicit and enforced, Gluon should bias toward giving the AI more useful first-class operations rather than layering on extra restrictions.

**Musical constraints (future):**
- Key/scale lock
- Tempo range
- Complexity ceiling

**Hardware safety (future):**
- Respect hardware-specific parameter ranges
- Rate-limit CC messages to avoid overwhelming MIDI bus

### 5. MIDI/OSC Bridge (Future — M7)

The bridge between Gluon and the outside world. **Not yet implemented.** This section describes the intended architecture for M7: External Integration.

**MIDI Output** (to hardware synths and DAW):
- Note messages (note on/off, velocity, aftertouch)
- CC messages (continuous controllers for parameter control)
- Program changes (patch selection)
- MIDI clock (sync)
- NRPN for hardware that supports higher-resolution control

**MIDI Input** (from hardware controllers, DAW):
- Capture what the human is playing
- Monitor parameter changes on hardware
- Receive clock/sync from DAW

**OSC** (for richer communication):
- Higher resolution than MIDI (32-bit float vs 7-bit integer)
- Named parameters (/synth/filter/cutoff vs CC 43)
- Ableton Live integration via OSC
- TouchDesigner, Max/MSP, Pure Data integration

**Ableton-Specific Integration:**
- AbletonOSC or similar for clip launching, scene control
- Remote Script API for deep integration (Python)
- Ableton Link for tempo sync across devices
- Max for Live devices for embedding Gluon directly in the DAW

**Hardware Profiles:**
Configurable descriptions of hardware synths with their CC maps, parameter ranges, and musical descriptions. Example:

```yaml
name: "Elektron Digitone"
midi_channel: 1
parameters:
  - name: "Filter Cutoff"
    cc: 74
    range: [0, 127]
    description: "LP/HP filter cutoff frequency"
    musical_effect: "Brightness/darkness of the sound"
  - name: "Filter Resonance"
    cc: 75
    range: [0, 127]
    description: "Filter resonance/emphasis"
    musical_effect: "Adds nasal/ringing quality at frequency"
  - name: "FM Amount A"
    cc: 70
    range: [0, 127]
    description: "Operator A FM depth"
    musical_effect: "Adds harmonic complexity and metallic character"
  # ... etc
```

The AI uses these profiles to reason about what each knob turn will do musically, not just numerically.

### 6. UI Layer

The interface is built around the conversation. The chat panel is the primary interaction surface — where you tell the AI what to do and see what it did. The instrument controls (parameter space, step grid, voice selector) let you play and tweak directly, and show the AI's changes as they happen.

**Core UI elements:**
- **Chat panel** (primary): Natural language input, AI responses, action log showing what the AI changed
- **2D parameter space**: TIMBRE x COLOR XY pad per voice, for direct sound exploration
- **Step sequencer**: 16-step grid per voice, with parameter locks (Elektron-style)
- **Voice selector**: 4 voice slots with model, mute/solo, and agency (OFF/ON)
- **Transport**: Play/stop, BPM, swing
- **Model selector**: Plaits synthesis model picker per voice
- **Undo**: Reverses all actions in LIFO order (essential for the iterate-and-refine loop)
- **Audio export**: Record and download

The UI should feel like an instrument, not a productivity app. Dark theme. Musical aesthetic. The AI's changes should be visible and transparent — you should always be able to see what it changed and undo it.

---

## Technical Stack

### Browser-based (current focus)

- **UI:** React + TypeScript + Vite + Tailwind CSS
- **DSP:** Mutable Instruments modules (Plaits, Rings, Clouds, Beads, Elements, Warps, Tides) compiled to WebAssembly via Emscripten, plus built-in processors (Ripples, EQ, Compressor, Chorus, Distortion, Stereo), running in AudioWorklets
- **AI (reasoning):** Google Gemini API (`@google/genai` SDK) — Gemini 3.1 Pro for project state reasoning and structured edits
- **AI (audio evaluation):** Gemini Flash for listening to rendered audio snapshots
- **Audio:** Web Audio API + AudioWorklet for real-time synthesis and playback

### Future (not in current scope)

- **MIDI/hardware:** MIDI output to hardware synths, hardware profile system
- **DAW integration:** Ableton Live integration, clip writing, automation
- **Desktop app:** Tauri or Electron wrapper for native performance

---

## The AI's Musical Vocabulary

One of the most interesting design challenges: how does the AI think about music?

It doesn't need to think in music theory (though it can). It needs to think in terms that are useful for real-time collaboration:

**Parameter space navigation:**
"The current TIMBRE/COLOR position is in a region that produces vocal formant sounds. Moving COLOR up will transition toward nasal/reed-like timbres. Moving TIMBRE right will increase the breathiness."

**Energy and tension:**
"The current arrangement has been building energy for 16 bars. A drop or release is likely expected. Suggesting: pull back filter cutoffs across all tracks, reduce note density on the drum track, introduce a new pad element with slow attack."

**Textural description:**
"This sounds like: metallic, bell-like, with slow decay. Similar to: prepared piano, gamelan, ice cracking."

**Relational reasoning:**
"Track 2 (bass) is rhythmically aligned with Track 4 (kick). If we shift the bass pattern by an eighth note, we get a more syncopated feel that might complement the off-beat hats on Track 6."

**Hardware-aware reasoning:**
"The Digitone on channel 1 has its FM Amount at 45%. Pushing it to 70-80% will add the metallic overtones you're asking for, but we should also bring the filter down slightly to keep it from getting harsh."

The AI communicates all of this in natural language to the human, while simultaneously translating its decisions into concrete MIDI/parameter actions.

---

## What Makes This Open Source

Everything is open source:

- The Mutable Instruments DSP code is already MIT licensed
- The Gluon platform code would be MIT or Apache 2.0
- Hardware profiles for common synths would be community-contributed
- The AI reasoning prompts and parameter mapping logic are open
- The constraint/permission system is open and auditable

The only non-open component is the LLM API call, which is a service dependency. Users could swap in any LLM (local Llama, Mistral, etc.) with reduced capability. The system is designed so the AI layer is pluggable.

---

## Development Milestones

### Phase 1: Proof of Concept (COMPLETE)
Plaits WASM in browser, 2D parameter space UI, AI integration via Gemini, single voice, basic chat, undo.

### Phase 2: Sequence & Layers (COMPLETE)
4-voice step sequencer, parameter locks, transport, AI sketch actions, audio export, mute/solo.

### Phase 3: Agentic Music Assistant (COMPLETE)
Pivoted AI from live jam partner to agentic assistant. Chat as primary interface, multi-step structured edits, audio snapshots for AI self-evaluation, simplified agency (OFF/ON), unified undo.

### M0: Stabilization (COMPLETE)
Canonical musical model foundations, session persistence, agency default inversion.

### M1: Sequencer Foundations (COMPLETE)
Canonical regions/events as sequencing source of truth. `voice.pattern` becomes a derived projection.

### M2: Sequencer Expressivity (COMPLETE)
Microtiming, sub-step scheduling, transformation primitives (`rotate`, `transpose`, `reverse`, `duplicate`), dynamic voice-setup prompt, canonical state compression.

### M3: Sequencer Surfaces (COMPLETE)
Event-centric tracker as canonical truth view, addable sequencer views (step grid, piano roll placeholder), AI view operations (`add_view`, `remove_view`).

### M4: First Chain (COMPLETE)
Rings and Clouds WASM processors, processor chain architecture (source → processors → gain staging), AI structure tools, module inspector, chain editing, replace_processor, chain validation.

### Phase 4B: Modulation (COMPLETE)
Tides WASM function generator, modulation routing (modulator → GainNode depth → target AudioParam), AI modulation tools (`add_modulator`, `remove_modulator`, `connect_modulator`, `disconnect_modulator`).

### M0: Stabilization (COMPLETE)
Pre-M5 QA sweep: fix audio pipeline bugs, UI state issues, transport crashes, and worklet edge cases.

### M5: UI Layers (COMPLETE)
Project persistence, parameter and patch navigation, AI-curated surfaces, offline listen tool, AI action legibility.

### M6: AI Collaboration Quality (COMPLETE)
Preservation contracts, aesthetic direction, structured listening, environment legibility.

### Finalization (IN PROGRESS)
Complete all implemented elements to full song composition capability. See `docs/roadmap.md` for details.

### M7: External Integration (FUTURE)
MIDI output to hardware synths, hardware profiles, DAW integration (Ableton), external sequencer adapters, community ecosystem.

See `docs/roadmap.md` for the full implementation roadmap with dependencies and design doc mapping.

---

## Name

**Gluon**

In particle physics, a gluon is the carrier of the strong force: the particle that binds quarks together into protons and neutrons. Without gluons, matter falls apart. The name works on multiple levels:

- **Physics:** The binding force that holds things together. Gluon is what holds the human-AI collaboration together.
- **Music production:** "Glue" is studio slang for the quality that makes separate elements cohere into a unified mix. Bus compression is called "glue compression." Gluon is the force that makes human ideas and AI suggestions feel like they belong together.
- **Open source heritage:** Follows the tradition of Mutable Instruments naming modules after physical phenomena (Clouds, Rings, Tides, Elements, Warps).
- **Practical:** Short, punchy, memorable, easy to type, no collisions in the music software space.

---

## Prior Art and Inspirations

- **Dirtywave M8**: Proved that deep synthesis in a minimal interface is compelling
- **Mutable Instruments**: Open source DSP that is genuinely best-in-class
- **Elektron Overbridge**: Hardware/software integration done right
- **Ableton Push**: Physical interface for a DAW that feels like an instrument
- **ReaLJam**: Academic research on real-time human-AI music jamming
- **MCP MIDI Server**: Proof that LLM-to-MIDI bridging works
- **AgentVault**: Bounded, verifiable coordination between agents (the constraint model)
