# Orthodox Audio Patterns Reference

A lookup table mapping each standard audio subsystem to its canonical implementation pattern, with source citations. Built as a reference for auditing Gluon's current and planned implementation.

Last updated: 2026-03-15.

---

## 1. Scheduling & Timing

### The Orthodox Pattern: "A Tale of Two Clocks"

Chris Wilson's canonical Web Audio scheduling pattern separates two time sources:

1. **JavaScript timer** (`setInterval` or `setTimeout`) — fires imprecisely (~15–25ms) to schedule upcoming events
2. **Web Audio clock** (`AudioContext.currentTime`) — monotonic, sample-accurate, runs on the audio thread

The JS timer runs a **lookahead loop** that schedules all events falling within a window ahead of the current audio time. Events are scheduled using Web Audio's time-stamped methods (`start(when)`, `setValueAtTime(value, when)`, `linearRampToValueAtTime(value, when)`).

| Parameter | Standard Value | Source |
|-----------|---------------|--------|
| JS timer interval | 25ms | Wilson |
| Lookahead window | 100ms | Wilson |
| Minimum lookahead | 50ms | Wilson |

**Key principles:**
- Never derive playhead position by accumulating JS timer deltas — always compute from `AudioContext.currentTime` minus a reference start time
- The lookahead window must be larger than the timer interval to handle jitter and tab backgrounding
- Events scheduled in the audio thread's future are guaranteed sample-accurate; events scheduled in the past are best-effort

**Live edit handling (established approaches):**

| Tool | Pattern |
|------|---------|
| Ableton Live | Changes take effect at next quantize boundary (1 bar, 1 beat, or immediate) |
| Bitwig | Immediate at next quantize point; clip launching respects global quantize |
| Renoise | Immediate on next row (next tick in sub-row resolution) |
| Tone.js | `Transport.scheduleRepeat` — callback fires each repeat; edits to the callback data take effect at next invocation |

**The "can't retract events from the audio thread" problem:**
- `AudioParam.cancelScheduledValues(startTime)` cancels future automation events
- `AudioScheduledSourceNode.stop()` can stop a scheduled source
- For worklet-based scheduling: maintain a generation/fence counter; worklet ignores events from old generations

### References

- [A Tale of Two Clocks — Chris Wilson (2013)](https://web.dev/audio-scheduling/)
- [Tone.js Transport source](https://github.com/Tonejs/Tone.js/blob/main/Tone/core/clock/Transport.ts)
- [Web Audio API spec — timing model (W3C)](https://www.w3.org/TR/webaudio/#AudioContext)

---

## 2. Transport & Playback

### The Orthodox Pattern: State Machine + Separate Position Tracking

Every DAW models transport as a finite state machine with clean transitions:

```
        ┌──── play ────┐
        │              ▼
    STOPPED ◄── stop ── PLAYING
        ▲              │
        └── stop ──── PAUSED
                       ▲ │
                       └─┘ (pause/resume)
```

**State responsibilities:**

| State | Audio thread | Position | UI |
|-------|-------------|----------|-----|
| Stopped | Silent, all voices released | Reset to 0 (or last locate point) | Playhead at start |
| Playing | Scheduler active, voices triggered | Advancing from current position | Playhead follows |
| Paused | Voices held or released (DAW-specific) | Frozen at current position | Playhead frozen |

**Position tracking separation (JUCE AudioPlayHead):**
- Transport position is queried by the audio processor via a callback (`getPosition()`)
- Position includes: BPM, time signature, bar/beat/tick, sample position, loop boundaries, is-playing flag
- The audio thread never *sets* transport state — it reads it. The main thread owns state changes.

**Generation/invalidation patterns:**

| Tool | Pattern |
|------|---------|
| JUCE | `prepareToPlay()` / `releaseResources()` lifecycle — host calls these on transport changes; processor flushes internal state |
| VST3 | `setProcessing(true/false)` — explicit signal to flush |
| Ardour | Transport "locate" command causes all processors to flush, then resume from new position |
| Tone.js | `Transport.stop()` cancels all scheduled events via `cancelScheduledValues` |

The orthodox pattern for "flush pending audio events" is a **lifecycle callback**, not a generation counter. The generation counter is a valid Web Audio adaptation (since we can't call lifecycle methods on worklet processors synchronously), but it's worth noting it's a Gluon-specific adaptation.

### References

- [JUCE AudioPlayHead](https://docs.juce.com/master/classAudioPlayHead.html)
- [VST3 IComponent::setActive / IAudioProcessor::setProcessing](https://steinbergmedia.github.io/vst3_dev_portal/)
- [Tone.js Transport](https://tonejs.github.io/docs/Transport)

---

## 3. Voice Allocation & Audio Engine

### Voice Allocation

The orthodox voice allocation pattern has three components:

1. **Pool**: Fixed-size array of voice instances, all pre-allocated
2. **Allocation strategy**: How to pick the next voice for a new note
3. **Stealing strategy**: What to do when no free voice exists

**Allocation strategies:**

| Strategy | Description | When to use |
|----------|-------------|-------------|
| Round-robin | Cycle through voices sequentially | Default for most synths; avoids reusing a voice whose tail is still audible |
| Least recently used (LRU) | Pick voice idle longest | Maximizes time between reuse |
| First available | Simple scan for first free slot | Simple but can cause uneven voice aging |

**Stealing strategies (when pool exhausted):**

| Strategy | Description |
|----------|-------------|
| Steal released first | Voices in release phase are safest to steal |
| Steal oldest held | Note held longest is assumed least important |
| Protect extremes | Never steal highest or lowest sounding note |
| Steal quietest | Note closest to silence is least audible to lose |

**References:**
- JUCE `Synthesiser` — `findFreeVoice()` with optional stealing
- SuperCollider `SynthDef` — voices are independent synth nodes on the server
- Sequential Prophet series — pioneered sophisticated voice allocation hardware

### Signal Chain Architecture

The orthodox DAW channel strip:

```
Source (oscillator/sampler)
  → Insert FX slot 1
  → Insert FX slot 2
  → ...
  → Pre-fader send(s)
  → Channel fader (gain)
  → Post-fader send(s)
  → Pan
  → Bus output
```

**Key conventions:**
- Inserts are serial (one output feeds next input)
- Sends are parallel taps (signal is copied, not diverted)
- Pre-fader sends get signal before the fader (reverb sends are typically pre-fader so reverb tail persists when fader is pulled down)
- Post-fader sends track the fader level
- The fader position does NOT affect insert processing (inserts see full-level signal)

### Parameter Automation vs Real-Time Control

| Tool | Pattern |
|------|---------|
| Ableton | Two modes: "manual" (human knob overrides automation) and "automation" (follows the lane). Human touch switches to manual mode until re-enabled. |
| Bitwig | Similar to Ableton; explicit automation arm per parameter |
| Logic | "Touch" and "Latch" modes for automation recording |

Gluon's "arbitration" rule (human wins) is functionally equivalent to Ableton's "manual override" mode, which is the industry standard for human-vs-automation conflict resolution.

### References

- [JUCE Synthesiser](https://docs.juce.com/master/classSynthesiser.html)
- Ableton automation modes: [Ableton manual — Automation](https://www.ableton.com/en/manual/automation-and-editing-envelopes/)

---

## 4. Worklet Communication

### The Orthodox Pattern: SharedArrayBuffer + Lock-Free Ring Buffer

Chrome's recommended pattern for AudioWorklet ↔ main thread communication:

1. Allocate `SharedArrayBuffer` visible to both threads
2. Use `Atomics` for producer/consumer coordination
3. Single-Producer Single-Consumer (SPSC) ring buffer for lock-free data passing

**Paul Adenot's `ringbuf.js`** is the reference implementation:
- Wait-free SPSC ring buffer
- Atomic read/write cursors
- No allocation on the audio thread
- No GC pressure

**When `postMessage` is acceptable:**
- Low-frequency configuration changes (model switch, patch load)
- One-shot setup messages (WASM binary transfer)
- Debug/status messages (audio → main)

**When `SharedArrayBuffer` is needed:**
- High-frequency parameter streaming (modulation at control rate)
- Meter/waveform feedback (audio → main at 60fps)
- MIDI event passing (main → audio)

### Event Queue in Worklet

The orthodox pattern for timed events in a worklet:

| Approach | Pros | Cons |
|----------|------|------|
| Sorted array + linear scan | Simple, cache-friendly for small queues | O(n) per render block |
| Binary heap | O(log n) insert and extract-min | More complex, less cache-friendly |
| Ring buffer (pre-sorted by sender) | Zero allocation on audio thread | Requires sender to sort |

For small event queues (< 100 events in flight), sorted array with linear scan is standard and sufficient. Binary heap is warranted only for dense MIDI streams or high-polyphony scenarios.

### Fence/Generation Mechanism

There is no standard equivalent in the literature. This is a Gluon-specific adaptation to the "can't retract events from the worklet" problem. The closest analogues:

- `AudioParam.cancelScheduledValues(startTime)` — Web Audio's built-in mechanism for native AudioParams
- JUCE's `prepareToPlay()` / `releaseResources()` lifecycle — synchronous flush
- VST3's `setProcessing(false)` — synchronous flush

Gluon's generation/fence model is a valid adaptation for the async `postMessage` communication channel, where synchronous flush is impossible. It's pragmatic and correct, just non-standard.

### References

- [ringbuf.js — Paul Adenot](https://github.com/padenot/ringbuf.js/)
- [Audio Worklet Design Pattern — Chrome Developers](https://developer.chrome.com/blog/audio-worklet-design-pattern)
- [Real-time audio programming 101 — Ross Bencina](http://www.rossbencina.com/code/real-time-audio-programming-101-time-waits-for-nothing)

---

## 5. Sequencer & Event Model

### Step Sequencer

The orthodox step sequencer model (TR-808, Elektron, Renoise):

| Concept | Orthodox pattern |
|---------|-----------------|
| Step | Gate (on/off) + velocity + parameter locks |
| Pattern | Array of steps with fixed length |
| Parameter lock | Per-step parameter override that reverts after the step (Elektron's signature feature) |
| Accent | Binary flag or velocity threshold (> 0.95 = accent is common) |
| Pattern length | Variable (1–64 steps typical) |
| Swing | Delay odd-numbered steps by a percentage of the step duration |

### Tracker Event Model

The orthodox tracker model (Renoise, OpenMPT, MilkyTracker):

Each row contains independent columns:

| Column | Content |
|--------|---------|
| Note | Pitch (C-4, D#5, OFF, etc.) |
| Instrument | Which instrument plays this note |
| Volume | Per-row volume (00–FF or 00–80) |
| Effect | Effect command + parameter (e.g., 0Exx = retrigger, 09xx = sample offset) |

**Key principle:** Every musical parameter is editable at every row position. There is no concept of a "trigger-only" row with limited editability — the row is a full event slot.

### Piano Roll / MIDI

The orthodox MIDI event model:

| Event | Fields |
|-------|--------|
| Note On | pitch (0–127), velocity (0–127), channel |
| Note Off | pitch (0–127), velocity (0–127), channel |
| CC | controller number, value (0–127), channel |

Notes are represented as on/off pairs with implicit duration (the gap between on and off). Modern DAWs typically convert this to a "note rectangle" model: `(pitch, start_time, duration, velocity)`.

### Pattern Loop / Arrangement

| Mode | Description | Reference |
|------|-------------|-----------|
| Pattern loop | Single pattern repeats indefinitely | TR-808, Elektron, Gluon's current model |
| Pattern chain | Patterns play in sequence (song mode) | Elektron, Renoise |
| Clip launching | Patterns triggered independently per track | Ableton Session View |
| Arrangement | Linear timeline with clips placed on tracks | Ableton Arrangement View, all DAWs |

### References

- [Renoise Pattern Editor](https://tutorials.renoise.com/wiki/Pattern_Editor)
- [Elektron Parameter Locks](https://www.elektronauts.com/)
- [MIDI 1.0 Specification](https://midi.org/)

---

## 6. Routing & Modulation

### Send/Return Routing

The orthodox DAW routing model:

```
Track A ──┬── Insert chain ── Fader ── Pan ── Master Bus
          │
          └── Send (pre/post fader) ──── Return Track (FX) ── Master Bus

Track B ──┬── Insert chain ── Fader ── Pan ── Master Bus
          │
          └── Send ──────────────────── Return Track (FX)
```

**Sidechain routing:** The sidechain input reads audio from another track's output (or a specific bus) as a control signal. In SuperCollider, this is just "Synth A writes to Bus N, Synth B reads from Bus N as an input."

### Modulation Routing

| System | Pattern | Key feature |
|--------|---------|-------------|
| Bitwig | Per-device modulators, drag to assign | Unlimited modulators per device, all at audio rate |
| VCV Rack | Physical cables between module jacks | CV routing, no centralized matrix |
| Max/MSP | Signal patching between objects | Everything is a signal or message |
| CLAP | Base value + modulation offset | Non-destructive: modulation never overwrites the base |

**The CLAP non-destructive model** is the emerging standard:
- Plugin stores `base_value` (what the user set) and `modulation_offset` (sum of all modulator contributions)
- Effective value = `clamp(base_value + modulation_offset, min, max)`
- When modulation stops, parameter returns to base value automatically
- Display can show both base and modulated values simultaneously

### Node Graph

The orthodox node graph pattern (Max/MSP, Pure Data, Reaktor):

- Nodes have typed inlets (inputs) and outlets (outputs)
- Connections are directed edges from outlet to inlet
- Signal flow follows topological order
- The graph must be a DAG (directed acyclic graph) for audio; feedback requires a one-sample delay element
- Graph changes happen on a non-real-time thread; the audio thread atomically swaps to the new processing order

### References

- [SuperCollider Bus concept](https://doc.sccode.org/Classes/Bus.html)
- [CLAP Parameter Model](https://github.com/free-audio/clap)
- [Bitwig Modulation System](https://www.bitwig.com/)
- [Max/MSP Documentation](https://docs.cycling74.com/max8)
