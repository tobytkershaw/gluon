# Audio Software Implementation Patterns

A survey of established patterns from DAWs, soft synths, and music software frameworks, assessed against Gluon's current implementation and roadmap. Organized by domain with coverage status and key references.

Last updated: 2026-03-15.

---

## Coverage Legend

- **Implemented** — in the codebase today
- **Planned** — designed in docs/RFCs but not yet built
- **Gap** — relevant to Gluon but not yet addressed in code or docs
- **N/A** — not applicable to Gluon's architecture

---

## 1. Parameter Smoothing

**Status: Implemented**

All three WASM engines (Plaits, Rings, Clouds) implement one-pole lowpass parameter smoothing at the C++ level. `SmoothedParam` applies per-block exponential smoothing with ~5ms settling time at 48kHz. This is the standard pattern used across the industry.

```cpp
// wasm/gluon_plaits.cpp
struct SmoothedParam {
  float current, target;
  void step(float coeff) { current += coeff * (target - current); }
};
```

Web Audio `AudioParam` methods (`linearRampToValueAtTime`, `setTargetAtTime`) provide additional smoothing at the graph level for gain nodes and other Web Audio-native parameters.

### References
- JUCE `SmoothedValue` class (linear and multiplicative smoothing)
- One-pole IIR: `y[n] = y[n-1] + alpha * (target - y[n-1])`
- Typical smoothing time: 5–50ms depending on parameter type

---

## 2. Denormal Protection

**Status: Implemented (PR #325)**

Denormal (subnormal) floating-point numbers are extremely small values near zero. When recursive algorithms (IIR filters, reverbs, feedback paths) decay toward silence, calculations with denormals can be 100x slower than normal floating-point operations, causing CPU spikes.

Native audio software sets FTZ (Flush To Zero) and DAZ (Denormals Are Zero) flags in the CPU's MXCSR register. **WebAssembly cannot do this** — it follows strict IEEE 754 semantics. This is a known, open problem for web audio (Mozilla Bug 1027624).

Gluon's WASM code (`gluon_plaits.cpp`, `gluon_rings.cpp`, `gluon_clouds.cpp`) does not currently include denormal protection. The Mutable Instruments upstream DSP may have some internal guards, but our wrappers add none.

### Workarounds for WASM
- Add a tiny DC offset (~1e-25) to signals before recursive processing
- Manually clamp near-zero values in feedback paths
- Both add minor overhead but prevent catastrophic slowdown

### When This Matters
- Long decay tails (Rings resonator ringing out)
- Clouds feedback at low density
- Any silence after active playback where filters haven't been reset

### References
- [Floating point denormals — EarLevel Engineering](https://www.earlevel.com/main/2019/04/19/floating-point-denormals/)
- [Mozilla Bug 1027624](https://bugzilla.mozilla.org/show_bug.cgi?id=1027624) — WASM denormal issue
- [Rust WASM denormal discussion](https://users.rust-lang.org/t/floating-point-denormal-flush-to-zero-possible-in-wasm32/112200)

---

## 3. Non-Destructive Modulation

**Status: Partially Implemented / Planned**

CLAP's parameter model separates the "base value" (what the user set) from "modulation offsets" (temporary modifications from modulators). When modulation stops, the parameter returns to its base value automatically. This is a protocol-level innovation that VST3 and AU lack.

This maps directly to Gluon's arbitration principle: the human's value is the base, the AI's modifications could be modeled as offsets, and human touch always wins by resetting the offset.

### Current State in Gluon
- Provenance tracking (`ControlState` with human/AI attribution) is the precursor
- `ModulationRouting` stores sourceModuleId, target, and bipolar depth (-1.0 to 1.0)
- Web Audio routing connects modulator output through a `GainNode` (depth) to target `AudioParam`
- Modulation currently overwrites rather than offsetting

### What the Pattern Recommends
- Plugin maintains `base_value + modulation_offset` internally
- Display shows modulated value, state save stores only base value
- Per-note modulation extends to individual voices (CLAP's "MPE on steroids")
- Thread-safe parameter sync uses wait-free queues, not mutexes

### Three-Layer Composition Model (Industry Consensus)

Research across CLAP, Bitwig, Ableton, and Pro Tools converges on three composable parameter layers:

```
effective_value = clamp(base_value + automation_delta + sum(modulation_offsets))
```

| Layer | What | Persisted |
|-------|------|-----------|
| **Base** | The knob position. Set by human or AI `move`. | Yes |
| **Automation** | Time-varying value from `ParameterEvent` in regions. | Yes |
| **Modulation** | Real-time offsets from LFOs, envelopes, expression. Non-destructive. | Config only |

Gluon's current `ControlValue.value` is the base layer. `ParameterEvent` in regions is the automation layer. Modulation offset has no representation yet. See `docs/rfcs/parameter-automation-research.md` for full research and #307 for implementation tracking.

### References
- [CLAP: The New Audio Plug-in Standard — Bitwig](https://www.bitwig.com/stories/clap-the-new-audio-plug-in-standard-201/)
- [CLAP GitHub Repository](https://github.com/free-audio/clap)
- [CLAP params.h — event types](https://github.com/free-audio/clap/blob/main/include/clap/ext/params.h)
- [CLAP Tutorial Part 2 — modulation implementation](https://nakst.gitlab.io/tutorial/clap-part-2.html)
- [Bitwig Unified Modulation System](https://www.bitwig.com/userguide/latest/the_unified_modulation_system/)
- [Ableton Automation and Clip Envelopes](https://www.ableton.com/en/manual/automation-and-editing-envelopes/)
- [Pro Tools Trim Automation](https://www.production-expert.com/production-expert-1/trim-mode-in-pro-tools-automation-what-you-should-know)
- `docs/rfcs/parameter-automation-research.md` — full research report

---

## 4. Voice Allocation and Stealing

**Status: Implemented (PR #337, Issue #296)**

Gluon currently has one synth instance per track — no polyphony within a track. The transport reset added `ActiveVoices` tracking, which is the prerequisite for voice allocation.

### Allocation Strategies
- **Round robin**: Cycle through voices sequentially. Avoids reusing a voice whose reverb tail is still audible. Best default for most synths.
- **Least recently used (LRU)**: Pick the voice idle longest. Maximizes time between reuse.
- **First available**: Simple but can cause uneven voice aging.

### Stealing Strategies (when no free voices)
- **Steal released notes first**: Voices in release phase are safest to steal
- **Steal oldest held note**: The note held longest is assumed least important
- **Protect extremes**: Never steal the highest or lowest sounding note (bass line, melody are most prominent)
- **Steal quietest**: The note closest to silence is least audible to lose

### Note Priority Modes (monophonic/legato)
- **Last note priority**: New note always takes over. Standard for leads.
- **Low note priority**: Lowest held note sounds. Standard for bass.
- **High note priority**: Highest held note sounds. Good for melody.

### References
- [Voice Allocation — Electronic Music Wiki](https://electronicmusic.fandom.com/wiki/Voice_allocation)
- [Synth Voice Allocation Schemes — PresetPatch](https://www.presetpatch.com/articles/synth-voice-allocation-schemes)
- Sequential Prophet series: pioneered sophisticated voice allocation
- Bitwig: per-voice modulation system handles voice identity elegantly

---

## 5. Tempo Maps

**Status: Gap (data model ready, scheduler needs work)**

Real music rarely has constant tempo. Tempo maps define how BPM changes over the course of a project — ramps, step changes, and curves. They bridge musical time (bars, beats, ticks) and absolute time (seconds, samples).

### Current State in Gluon
- Single global BPM on `TransportState`
- Global swing percentage
- Fixed 4/4 time signature (hardcoded assumption)
- Canonical model supports fractional beat positions (`MusicalEvent.at`), so the data model is ready
- Scheduler converts between beat time and audio time assuming constant tempo

### What the Pattern Recommends

Ardour v7.0 is the gold standard:
- Two canonical time domains: audio time and musical time
- "Superclock" (508,032,000 ticks/sec) avoids floating-point rounding in conversions
- Store tempo events as `(position, BPM, curve_type)` tuples
- Minimize cross-domain conversions — each operation stays in its canonical domain
- Every duration in musical time requires a position context (N beats maps to different sample counts depending on where those beats fall in the tempo map)

### Time Signatures
- Beats per bar and beat value can change independently of tempo
- Polymetric sequences (different tracks at different time signatures) are an advanced feature few DAWs support well

### What Gluon Needs
- A `TempoMap` object that both the scheduler and UI can query
- Scheduler's beat↔audio-time conversion must consult the tempo map instead of assuming constant BPM
- Transport generation should increment on tempo map changes

### References
- [Ardour Timing Architecture](https://ardour.org/timing.html)
- [Tempo-Based Timing](https://dobrian.github.io/cmp/topics/tempo-based-timing/1.tempo-based-timing.html)
- Ableton Link timeline model: beat time, tempo, and start/stop intent as explicit transport concepts

---

## 6. Lock-Free Communication (SharedArrayBuffer)

**Status: Gap**

Chrome's recommended pattern for AudioWorklet ↔ main thread communication is `SharedArrayBuffer` + lock-free single-producer single-consumer (SPSC) ring buffers. Gluon currently uses `postMessage` for worklet communication, which copies data and has unpredictable latency.

### Why This Matters
- `postMessage` copies data (allocation + GC pressure on the audio thread)
- Delivery timing is unpredictable (messages queue behind other work)
- For high-frequency parameter streaming and meter feedback, SharedArrayBuffer reduces jitter

### The Pattern
- Allocate a `SharedArrayBuffer` visible to both main thread and AudioWorklet
- Use atomic operations for producer/consumer coordination
- Paul Adenot's `ringbuf.js` is the reference implementation for Web Audio
- Chrome's official "Audio Worklet Design Pattern" documents this architecture

### When to Adopt
- When parameter update frequency increases (modulation at control rate)
- When meter/waveform display feedback from the worklet is needed
- When GC pauses on the audio thread become measurable

### References
- [ringbuf.js — Wait-free SPSC ring buffer for the web](https://github.com/padenot/ringbuf.js/)
- [Audio Worklet Design Pattern — Chrome Developers](https://developer.chrome.com/blog/audio-worklet-design-pattern)
- [A wait-free SPSC ring buffer for the Web — Paul Adenot](https://blog.paul.cx/post/a-wait-free-spsc-ringbuffer-for-the-web/)
- [Real-time audio programming 101 — Ross Bencina](http://www.rossbencina.com/code/real-time-audio-programming-101-time-waits-for-nothing)

---

## 7. Audio Graph Topological Sort

**Status: N/A now, needed for cross-track routing**

When an audio engine has interconnected processing nodes (synths, effects, mixers, sends), the engine must determine processing order via topological sort on the directed acyclic graph (DAG).

### Current State in Gluon
- All chains are linear: source → processor 1 → processor 2 → output
- Phase 4A explicitly bans cycles
- No cross-track routing yet

### When This Becomes Relevant
- Cross-track sends and sidechains (M7 roadmap)
- Parallel processing paths within a track
- Feedback loops require a one-sample delay element to break the cycle for sort purposes

### The Pattern
- Sort on a non-real-time thread when graph changes
- Atomically swap the processing order on the audio thread
- Nodes at the same topological level can run in parallel (but synchronization overhead often exceeds benefit unless nodes are heavy)

### References
- JUCE `AudioProcessorGraph`: maintains DAG with topological sort, provides I/O nodes
- SuperCollider `scsynth`: tree of Nodes (Synths and Groups), execution follows tree traversal
- `supernova` (SC parallel server): Parallel Groups whose children execute on separate cores

---

## 8. Preset Morphing and A/B Comparison

**Status: Planned (Surface modules)**

### Current State in Gluon
- Undo/redo provides implicit A/B comparison
- `ControlState` snapshots exist with provenance tracking

### Planned (design-references.md)
- Morph Slider module: interpolates between two saved parameter states
- Vector Pad module: blends between four corner states (A, B, C, D)
- Constraint Surface module: makes approval boundaries tangible and editable

### The Pattern
- Linear interpolation: `param = A.param * (1-t) + B.param * t` for continuous parameters
- Discrete parameters (waveform select, filter type): snap at 50%, or exclude from morphing
- Constrained randomization: limit random values to the range between A and B
- A/B comparison stores two complete parameter snapshots with instant toggle

### References
- Arturia PolyBrute: hardware morphing knob between Preset A and Preset B
- [Edisyn — Universal Synth Editor](https://github.com/eclab/edisyn): morphing, blending, nudging, hill-climbing
- [Morph and Randomize Tools — Cantabile](https://www.cantabilesoftware.com/guides/morphRandomize)

---

## 9. Session Persistence and Crash Recovery

**Status: Partially Implemented**

### Current State in Gluon
- Full project serialization to JSON (localStorage or file export)
- Session state includes tracks, patterns, parameters, modulation, undo stack
- No incremental auto-save or explicit crash recovery

### The Pattern
- Auto-save interval: 1–5 minutes, user-configurable
- Must not cause audio dropouts — serialize on a background thread (Web Worker)
- Incremental saves (deltas from last full save) are faster for large projects
- Recovery files stored separately from main project to prevent corruption of both
- Ableton Live: recovery files in date-stamped subfolders with separate undo history
- Reaper: built-in crash recovery mode, periodic auto-save backups

### For Gluon (browser context)
- `IndexedDB` with periodic JSON serialization on a Web Worker
- Service Worker could enable offline access and background saves
- Preservation contracts (M6) go further than most DAWs by formally tracking approved vs. tentative material

### References
- [DAWproject — Bitwig](https://github.com/bitwig/dawproject): open XML-based exchange format
- Reaper `.RPP`: human-readable text format, amenable to git version control

---

## 10. Keyboard Accessibility

**Status: Gap**

Audio software is historically one of the worst accessibility domains due to heavy reliance on visual metaphors (waveforms, knobs, meters). Browser-based tools like Gluon have an advantage: WCAG compliance, ARIA roles, and keyboard-only workflows are achievable with standard React patterns.

### Gold Standards
- **Reaper + OSARA**: comprehensive screen reader support via MSAA/UIA (Windows) and VoiceOver (Mac). Speaks track names, parameter values, transport state. Full keyboard navigation.
- **Surge XT**: the accessibility benchmark for open-source synth plugins. Full keyboard navigation with Tab/Shift+Tab, arrow keys for parameter adjustment, Alt+Period/Comma for section jumping.
- **Ableton Live 12**: comprehensive keyboard navigation and screen reader accessibility added recently.

### What Good Looks Like
- **Tab order**: logical flow through UI sections, not DOM render order. Group related controls.
- **Parameter announcement**: screen readers need parameter name, current value in human-readable units ("Filter cutoff: 1200 hertz"), and role (slider, button, menu).
- **Keyboard-only workflow**: every mouse action achievable by keyboard. Arrow keys for parameter adjustment, Enter for toggle, Escape for cancel.
- **Section jumping**: shortcuts to jump between major UI regions (tracks, transport, chat, parameter space).
- **High contrast mode**: respect OS-level settings, provide dedicated theme.

### References
- [OSARA — Open Source Accessibility for REAPER](https://osara.reaperaccessibility.com/)
- [Surge XT Accessibility](https://surge-synthesizer.github.io/accessibility/)
- [Building Inclusive Audio Tools — ADC 2025](https://conference.audio.dev/session/2025/building-inclusive-audio-tools)
- [Evaluating Accessibility of DAWs (PDF)](https://www.scitepress.org/Papers/2020/101670/101670.pdf)

---

## 11. Transport Sync Protocols

**Status: Planned (M7)**

### Ableton Link
Peer-to-peer tempo and phase synchronization over LAN. No master/slave — any participant can change tempo and all others follow. Open source.

- Operates on three concepts: tempo (BPM), beat phase (position within a quantum), start/stop state
- Uses UDP multicast for discovery
- For browser-based Gluon: requires a WebSocket bridge to a native Link peer (no raw UDP in browsers)
- [Ableton Link Documentation](https://ableton.github.io/link/)

### MIDI Time Code (MTC)
SMPTE timecode over MIDI. Encodes absolute position (hours:minutes:seconds:frames). Master-slave model. Not suitable for tempo-varying music since it encodes wall-clock position, not musical position.

### MIDI Machine Control (MMC)
Transport commands (play, stop, locate, record) over MIDI. Typically paired with MTC.

---

## 12. MIDI and Expressive Input

**Status: Planned (M7)**

### MPE (MIDI Polyphonic Expression)
Dedicates one MIDI channel per active note, enabling per-note pitch bend, pressure, and slide. Maximum polyphony is 15 notes with single-zone MPE.

- Channel 1 = Manager Channel (global), channels 2–16 = Member Channels (per-note)
- Per-note pitch bend typically +/- 48 semitones
- Relevant when Gluon adds MIDI input from expressive controllers (Roli Seaboard, Linnstrument)
- [MPE Specification (PDF)](https://d30pueezughrda.cloudfront.net/campaigns/mpe/mpespec.pdf)

### MIDI 2.0
Native per-note controllers at 32-bit resolution (supersedes MPE's channel-per-note workaround). Also adds Property Exchange (JSON-based device querying) and profile configuration. Adoption is early but growing.

- [Details about MIDI 2.0 — MIDI.org](https://midi.org/details-about-midi-2-0-midi-ci-profiles-and-property-exchange-updated-june-2023)

---

## 13. Portamento and Glissando

**Status: Gap (minor)**

Portamento smoothly slides pitch between notes. Implemented as a slew limiter (lag generator) on the pitch control signal.

### Key Variants
- **Constant time**: slide always takes N ms regardless of interval
- **Constant rate**: slide speed is fixed, larger intervals take longer
- **Legato portamento**: only slides when notes overlap
- **Curve shape**: exponential is more musical (pitch perception is logarithmic)

### For Gluon
Would be a per-track parameter applied in the worklet before pitch reaches Plaits. Low implementation cost, nice expressiveness gain.

---

## 14. Real-Time Thread Safety

**Status: Partially Implemented**

The fundamental rule: the audio thread must never block. It cannot allocate memory, acquire mutexes, perform I/O, or call any function with unpredictable execution time.

### Current State in Gluon
- AudioWorklet `process()` runs in a dedicated thread with ~2.9ms budget at 44.1kHz
- WASM heap memory is separate from AudioWorklet I/O arrays
- Parameter updates via `postMessage` (async, non-blocking)
- No SharedArrayBuffer communication yet (see section 6)

### Communication Patterns Between Threads
| Pattern | Use Case |
|---------|----------|
| **Lock-free SPSC ring buffer** | Parameter changes (UI→audio), meter values (audio→UI), MIDI events |
| **Atomic flags/values** | Simple single-value communication (transport state) |
| **Double/triple buffering** | Producer writes to back buffer, atomically swaps pointer |
| **Message queues** | Complex operations (preset changes, graph reconfiguration) |

### References
- [Real-time audio programming 101 — Ross Bencina](http://www.rossbencina.com/code/real-time-audio-programming-101-time-waits-for-nothing)
- [Lock-free algorithms — Ross Bencina](http://www.rossbencina.com/code/lockfree)
- [Using locks in real-time audio processing, safely — timur.audio](https://timur.audio/using-locks-in-real-time-audio-processing-safely)
- [Audio Worklet Design Pattern — Chrome Developers](https://developer.chrome.com/blog/audio-worklet-design-pattern)

---

## 15. Parameter Normalization and Mapping

**Status: Implemented**

Gluon normalizes all parameters to 0.0–1.0 (a core design principle). The literature confirms this is the right approach — VST3 enforces the same range.

### Mapping Functions (for display and future use)
| Function | When to Use |
|----------|-------------|
| **Linear** | Uniform perceptual distribution (pan, mix, balance) |
| **Logarithmic/exponential** | Frequency parameters (equal knob rotation = equal octave change) |
| **Power curve (skew)** | Adjustable resolution concentration (filter cutoff) |
| **Decibel** | Gain parameters (`dB = 20 * log10(linear)`) |

### For Gluon
Currently the 0–1 range is used uniformly. If/when the UI adds knob displays with unit labels (Hz, dB, ms), the mapping functions become relevant for converting normalized values to display values.

---

## 16. Latency Compensation

**Status: N/A (currently)**

Plugin Delay Compensation (PDC) compensates for processing latency differences across parallel signal paths. Each plugin reports its latency; the host adds compensating delays to shorter paths.

### Why N/A for Gluon Now
- Mutable Instruments DSP is designed for real-time synthesis with minimal fixed latency
- All WASM modules process within the 128-sample AudioWorklet quantum
- No external plugins, no significant latency differences between chains

### When This Becomes Relevant
- If Gluon adds FFT-based effects (spectral processing, convolution reverb)
- If cross-track routing introduces parallel paths with different chain depths
- If lookahead processing is added (dynamics, limiting)

---

## 17. Oversampling for Nonlinear DSP

**Status: N/A (currently)**

Nonlinear processes (saturation, waveshaping, distortion) generate harmonics that can alias back into the audible spectrum. Oversampling (2x, 4x, 8x) processes at a higher sample rate with anti-aliasing filters to reduce this.

### Why N/A for Gluon Now
- Plaits handles its own aliasing internally (Mutable Instruments DSP is well-engineered for this)
- No standalone saturation/waveshaping effects in the chain

### When This Becomes Relevant
- If Gluon adds distortion, saturation, or waveshaping effects as chain processors

---

## Summary: Priority by Impact

| Priority | Pattern | Status | Effort | When |
|----------|---------|--------|--------|------|
| 1 | Denormal protection | Implemented (PR #325) | Low (~50 lines C++) | Done |
| 2 | SharedArrayBuffer ring buffers | Gap | Medium | When modulation/metering needs scale |
| 3 | Voice allocation / polyphony | Implemented (PR #337) | Medium-High | Done |
| 4 | Tempo maps | Gap | High | When sequencer needs tempo changes |
| 5 | Non-destructive modulation offsets | Partial | Medium | When modulation architecture matures |
| 6 | Keyboard accessibility | Gap | Medium | Ongoing — incremental adoption |
| 7 | Portamento/glissando | Gap | Low | When expressiveness is prioritized |
| 8 | Session auto-save | Partial | Medium | When sessions become complex |
| 9 | Transport sync (Link) | Planned | High | M7 (External Integration) |
| 10 | Audio graph topological sort | N/A | High | When cross-track routing arrives |
