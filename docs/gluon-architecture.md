# Gluon
## The binding force between human and AI music-making
### An open source platform for human-AI music collaboration

---

## What This Is

Gluon is an open source platform where a human musician and an AI collaborate on music in real time. Not generative AI that writes songs for you. Not a chatbot that suggests chord progressions. A shared instrument where both participants can reach for the same knobs, listen to the same output, and build on each other's ideas.

The AI's role is closer to a session musician than a producer: it has opinions, it can play, it can suggest, but the human always has final say. It can be as passive as a gentle nudge on a filter parameter, or as active as sketching an entire B-section arrangement. The human sets the leash.

The platform has two modes that share a single brain:

**Jam Mode** is a standalone instrument with world-class synthesis engines (Mutable Instruments Plaits/Braids, compiled natively) and a visual interface designed for real-time exploration. The human and AI explore sound together. Touch a parameter, the AI responds. Ask for "something darker," the AI translates that into parameter movements it understands at the DSP level because the engines are running inside the same process.

**Studio Mode** extends the same AI outward into a production environment. It integrates with Ableton Live (and other DAWs) via MIDI, OSC, and the Ableton Link/Push protocols. It can send MIDI CC to hardware synthesizers (Elektron boxes, Eurorack, whatever is in the studio). It can write MIDI clips, set up parameter automation, sketch arrangements. The Mutable Instruments engines remain available as software instruments within the DAW session, but the AI also speaks to external hardware through configurable parameter maps.

Both modes share the same conversation, the same musical memory, and the same constraint system that governs what the AI is and isn't allowed to touch.

---

## Why This Doesn't Exist Yet

The AI music space has bifurcated into two dead ends:

**Generative music** (Suno, Udio, Google Lyria): AI generates complete audio from text prompts. The human is a prompter, not a musician. There is no collaboration, no iteration at the parameter level, no connection to real instruments. The output is a WAV file. It's a content machine.

**AI-assisted composition** (WavTool, various MIDI generators): AI generates MIDI clips or chord progressions. Text in, MIDI out. The AI doesn't listen, doesn't watch what you're doing, doesn't share control of a sound. It's a suggestion box.

Neither of these is collaboration. Collaboration requires:
- Shared access to the same instrument/parameters
- Real-time listening and response from both parties
- A spectrum of control from human-led to AI-led
- Transparency about what the AI is doing and why
- The ability to undo, override, or redirect at any moment
- A shared context that builds over the session

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
|  | (MI Plaits/Braids  |  | (what's playing,    |  |
|  |  compiled natively)|  |  parameter history,  |  |
|  +-------------------+  |  session context)    |  |
|                          +---------------------+  |
|  +-------------------+  +---------------------+  |
|  | AI Reasoning      |  | Constraint Engine    |  |
|  | (LLM interface,   |  | (what AI can/cannot  |  |
|  |  parameter mapping,|  |  touch, leash level, |  |
|  |  musical intent)   |  |  per-track perms)   |  |
|  +-------------------+  +---------------------+  |
|                                                   |
+--------------------------------------------------+
         |              |              |
    +---------+   +-----------+   +----------+
    | Audio   |   | MIDI/OSC  |   | UI       |
    | Engine  |   | Bridge    |   | Layer    |
    | (ALSA/  |   | (to DAW,  |   | (visual  |
    |  CoreA, |   |  hardware |   |  param   |
    |  WebAu) |   |  synths)  |   |  space)  |
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

**Braids** (predecessor with 33 synthesis models):
Additional models including CZ-style phase distortion, vowel/formant synthesis, Karplus-Strong plucked strings, bowed strings, reed and flute physical models, particle synthesis, and more.

**Additional MI modules** (all open source, all portable):
- **Rings**: Resonator (sympathetic strings, modal synthesis)
- **Clouds/Beads**: Granular processor (for audio input processing)
- **Elements**: Full physical modelling voice
- **Tides**: Function generator / complex LFO
- **Warps**: Signal crossfader/wavefolder/vocoder

These would be compiled to:
- **Native** (Rust wrapper around C++ DSP, or direct C++ with Rust orchestration)
- **WebAssembly** (for browser-based Jam Mode)
- **VST/AU plugin** (for DAW integration in Studio Mode)

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

The interface between the musical state and an LLM (Anthropic API, or a local model for latency-sensitive operations).

The AI operates at multiple timescales:

**Real-time (< 50ms):** Parameter modulation, LFO-like continuous changes. These cannot go through an LLM round-trip. Instead, a lightweight local model or rule-based system handles continuous parameter movement once the LLM has set a trajectory. "Slowly open the filter over 8 bars" becomes a local automation curve, not 1000 API calls.

**Interactive (100ms - 2s):** Responding to what the human just did. "They just dropped the bass note an octave, let's widen the stereo field on the pad." This can be a fast LLM call with the current state compressed into a concise prompt.

**Compositional (seconds to minutes):** Sketching sections, writing MIDI patterns, suggesting arrangement changes. "Build me a breakdown that strips back to just the kick and a filtered version of this lead." This is a standard LLM interaction with rich context.

**Conversational (human-paced):** Natural language dialogue. "Make it more like early Autechre." "I want something that sounds like machinery winding down." This is where LLMs shine, translating subjective descriptions into concrete parameter and compositional decisions.

The AI also needs a "taste model" that develops over sessions. Not a fine-tuned LLM, but a structured preference profile: this human tends to prefer darker timbres, shorter decay times, odd time signatures, etc. This informs the AI's suggestions without requiring explicit instruction every time.

### 4. Constraint Engine

The system that governs the AI's permissions. Inspired by the principle that useful AI collaboration requires bounded, verifiable agency.

Constraints are set per-session and can be adjusted on the fly:

**Per-track permissions:**
- LOCKED: AI cannot touch this track at all
- SUGGEST: AI can propose changes but human must approve
- NUDGE: AI can make small parameter adjustments within defined ranges
- CO-PILOT: AI has free rein within musical constraints
- SKETCH: AI can write new content (MIDI patterns, automation)

**Global leash level:**
- 0%: AI is silent, just observing
- 25%: AI only responds when asked
- 50%: AI makes gentle suggestions and occasional nudges
- 75%: Active co-creation, AI takes initiative
- 100%: AI is jamming freely (within per-track permissions)

**Musical constraints:**
- Key/scale lock
- Tempo range
- Complexity ceiling (max simultaneous voices, max note density)
- "Stay in the neighbourhood" (limit how far AI moves from current state)

**Hardware safety:**
- Never send MIDI that could damage equipment (e.g., certain sysex)
- Respect hardware-specific parameter ranges
- Rate-limit CC messages to avoid overwhelming MIDI bus

### 5. MIDI/OSC Bridge

The bridge between Gluon and the outside world.

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

**Jam Mode UI:**

The centerpiece is a 2D parameter space visualiser. For each Mutable Instruments engine, TIMBRE and COLOR map to X and Y axes. The human touches/clicks to explore. The AI's influence appears as a gentle pull or glow indicating "interesting regions." The current position, recent trajectory, and AI suggestions are all visible.

Additional UI elements:
- Engine selector (switch between Plaits models, Braids models, etc.)
- Effects chain (Rings, Clouds, etc.)
- Pattern sequencer (simple step sequencer for building loops)
- Conversation panel (natural language interaction with the AI)
- Constraint controls (leash level, permissions)
- Waveform/spectrum visualiser

**Studio Mode UI:**

A control surface that lives alongside the DAW (separate window, or embedded via Max for Live). Shows:
- Active tracks with AI permission levels
- Hardware synth parameter maps
- AI activity log (what it changed, when, why)
- Conversation panel
- Arrangement sketch view

---

## Technical Stack

### Core (shared between modes)

- **Language:** Rust for the audio engine and MIDI/OSC bridge. Python for the AI reasoning layer and DAW scripting.
- **DSP:** Mutable Instruments C++ code, wrapped in Rust via FFI, or compiled separately and linked. Also compiled to WASM for browser mode.
- **AI:** Anthropic API for reasoning (Claude). Local small model for latency-sensitive continuous parameter modulation.
- **MIDI:** midir (Rust), python-rtmidi (Python) for MIDI I/O. Virtual MIDI ports for DAW communication.
- **OSC:** rosc (Rust), python-osc (Python).
- **Audio:** CPAL (Rust cross-platform audio), or JACK for pro audio integration.

### Jam Mode (standalone)

- **Desktop app:** Rust + egui or similar immediate-mode GUI. Or Tauri (Rust backend, web frontend).
- **Browser version:** Rust/WASM for DSP, React + Canvas/WebGL for UI, Web Audio API for output, WebMIDI for controller input.
- **Touch support:** Native on browser/tablet. Dedicated touch handling in desktop app.

### Studio Mode (DAW integration)

- **Ableton integration:** Python Remote Script, AbletonOSC, and/or Max for Live device.
- **Generic DAW:** Virtual MIDI ports (works with any DAW). MCP server exposing MIDI tools.
- **Hardware:** MIDI output to Elektron/other hardware via USB or DIN MIDI.
- **Plugin format:** VST3/AU wrapper around the MI engines for use as instruments within the DAW.

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

## Development Phases

### Phase 1: Proof of Concept
- Mutable Instruments Plaits compiled and running (native + WASM)
- Basic 2D parameter space UI
- LLM can describe current sound state and suggest parameter changes
- Single synth voice, no sequencing

### Phase 2: Jam Mode MVP
- Multiple MI engines available
- Effects chain (Rings, Clouds)
- Simple step sequencer
- AI can modulate parameters in real time via local automation
- Natural language control ("make it darker," "add some chaos")
- Touch-friendly UI

### Phase 3: MIDI Bridge
- MIDI output to hardware synths
- Hardware profile system
- AI can send CC to Elektron boxes (and other gear)
- MIDI input monitoring (AI listens to what you play)

### Phase 4: Studio Mode / DAW Integration
- Ableton Live integration (Remote Script + OSC)
- AI can write MIDI clips and automation
- Arrangement sketching
- Multi-track constraint/permission system
- Session memory across conversations

### Phase 5: Community and Ecosystem
- Community-contributed hardware profiles
- Shared "taste models" (optional)
- Plugin format (VST3/AU) for MI engines
- Mobile/tablet-optimised Jam Mode

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
