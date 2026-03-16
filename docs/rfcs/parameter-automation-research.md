# Parameter Automation Research

Research into leading approaches to parameter automation, modulation, and control in music software. Conducted to inform Gluon's automation architecture — specifically the tensions between inline-with-note storage, expressiveness, absolute vs relative values, and modulation offsets.

## Table of Contents

1. [Absolute vs Relative Parameter Changes](#1-absolute-vs-relative-parameter-changes)
2. [Inline Storage vs Separate Automation Lanes](#2-inline-storage-vs-separate-automation-lanes)
3. [Interpolation Between Parameter Events](#3-interpolation-between-parameter-events)
4. [Modulation vs Automation Distinction](#4-modulation-vs-automation-distinction)
5. [Parameter Change Models in AI/Generative Music](#5-parameter-change-models-in-aigenerative-music)
6. [Gluon Current State and Gaps](#6-gluon-current-state-and-gaps)
7. [Recommended Design Direction](#7-recommended-design-direction)

---

## 1. Absolute vs Relative Parameter Changes

### CLAP's Parameter Model

CLAP makes the cleanest architectural distinction in the industry between **automation** (changing the actual value) and **modulation** (adding a temporary offset). Two distinct event types:

- **`CLAP_EVENT_PARAM_VALUE`** — the host sends this to change the actual persisted value (user moves a dial, automation playback). Absolute.
- **`CLAP_EVENT_PARAM_MOD`** — non-destructive, potentially polyphonic modulation. Specifies a voice or set of voices and an **offset amount** added to the base value.

Implementation in a plugin's Voice struct:

```c
float volume = FloatClamp01(plugin->parameters[P_VOLUME] + voice->parameterOffsets[P_VOLUME]);
```

Parameters declare capabilities via flags: `CLAP_PARAM_IS_AUTOMATABLE`, `CLAP_PARAM_IS_MODULATABLE`, `CLAP_PARAM_IS_MODULATABLE_PER_NOTE_ID`. Modulation is non-destructive — when it ends, the parameter returns to its base value. Multiple modulation sources are additive.

**Source**: [CLAP params.h](https://github.com/free-audio/clap/blob/main/include/clap/ext/params.h), [CLAP tutorial part 2](https://nakst.gitlab.io/tutorial/clap-part-2.html)

### VST3's Parameter Normalization

VST3 normalizes all parameter values to `[0.0, 1.0]` floating-point. The controller provides bidirectional conversion (`normalizedParamToPlain` / `plainParamToNormalized`) for non-linear mappings like decibel scales. Automation data arrives as `IParameterChanges` containing `IParamValueQueues` with sample-accurate automation points sorted by sample offset within processing blocks.

Key architectural constraint: "no automated parameter must influence another automated parameter" — this prevents cascading side-effects during automation playback.

VST3 does **not** have a first-class concept of modulation-as-offset; modulation in VST3 must be handled internally by the plugin or approximated by the host writing automation.

**Source**: [VST3 Parameters and Automation](https://steinbergmedia.github.io/vst3_dev_portal/pages/Technical+Documentation/Parameters+Automation/Index.html)

### Bitwig's Unified Modulation System

Bitwig's modulation operates entirely as **relative offsets from base parameter values**. The modulation range is set relatively and "does not directly correspond to the parameter's values" — you can twist modulation past the parameter's nominal range. Each modulation connection has its own transfer function (linear, exponential, logarithmic, absolute, toward-zero, positives-only, negatives-only) and can be scaled by another modulation source.

Key distinction: **monophonic modulators (blue)** apply one signal to all voices; **polyphonic modulators (green)** generate unique signals per note event. Voice Stacking distributes modulation bipolarly across up to 16 stacked voices.

**Source**: [Bitwig Unified Modulation System](https://www.bitwig.com/userguide/latest/the_unified_modulation_system/)

### Ableton's Automation vs Clip Envelopes

Ableton makes a critical architectural split:

- **Arrangement automation** (track-level): defines the **absolute value** of a control at any point in time.
- **Clip envelopes** (clip-level): function as **relative modulation offsets**. A volume clip envelope's output is interpreted as a percentage of the current gain value — it can reduce but never exceed the absolute setting.

The interaction rule: "the decreasing automated value meets with the increasing modulation envelope value" — automation forces the absolute ceiling down, and clip modulation operates within that ceiling. This means automation and modulation compose multiplicatively for volume, not additively.

Ableton also has an **automation override** mechanism: manually adjusting an automated parameter temporarily disables automation (indicated by a dimmed LED), preserving the original curve for later re-enablement.

**Source**: [Ableton Automation Manual](https://www.ableton.com/en/manual/automation-and-editing-envelopes/), [Ableton Clip Envelopes](https://www.ableton.com/en/manual/clip-envelopes/)

### The Destructive Automation Problem

Standard automation recording modes:

| Mode | Behaviour |
|------|-----------|
| **Write** | Most destructive — overwrites everything from transport start to stop |
| **Latch** | Begins when you touch a control, continues recording until transport stops |
| **Touch** | Records only while actively touching, reverts to existing automation on release |

**Pro Tools' Trim mode** is the industry's best solution: it creates a **secondary automation lane** containing relative offsets that sum with the original automation. The original data is preserved intact. "Coalescing" merges the trim layer into the base layer when desired, resetting the trim fader to 0 dB.

**Source**: [Pro Tools Trim Automation](https://www.production-expert.com/production-expert-1/trim-mode-in-pro-tools-automation-what-you-should-know), [Logic Automation Modes](https://www.macprovideo.com/article/logic-pro/quick-tip-logics-automation-modes-explained)

---

## 2. Inline Storage vs Separate Automation Lanes

### Tracker-Style: Inline with Notes

**Renoise** supports a hybrid approach:

- **Effect columns** in the pattern editor: inline parameter changes at tick resolution (e.g., `xyzz` where x=device, y=parameter, zz=value 00-FF). Execute discretely per tick.
- **Graphical automation envelopes**: separate envelope editor with Points (step), Lines (linear with handles), and Curves (cubic easing) interpolation modes. Resolution down to 1/256th of a line.

Both can coexist on the same parameter — Renoise shows icons indicating whether automation comes from effect commands, envelopes, or both. The recording setting determines which method captures real-time changes.

**Source**: [Renoise Graphical Automation](https://tutorials.renoise.com/wiki/Graphical_Automation), [Renoise Effect Commands](https://tutorials.renoise.com/wiki/Effect_Commands)

**OpenMPT** offers Parameter Control Events (PC Events) as an inline automation mechanism: the volume column holds the parameter index (0-999), the effect column holds the value (000-999). The "Interpolate Effect" action can linearly interpolate across a selection of PC Events.

**Source**: [OpenMPT Parameter Control Events](https://wiki.openmpt.org/Manual:_Parameter_Control_Events)

### DAW-Style: Separate Automation Lanes

Ableton, Logic, Pro Tools, Bitwig, and Reaper all use **separate automation lanes** displayed beneath or alongside the track. Automation data is stored as breakpoint envelopes with time positions and values, independent of note/clip data. Ardour provides "sample accurate automation for everything."

### Elektron's Parameter Locks: The Step Sequencer Hybrid

Elektron's parameter locks are the closest hardware analog to Gluon's current inline `ParameterEvent`:

- Hold a step trig and adjust any parameter knob to lock that parameter's value at that step
- **Trigless locks**: parameter changes without retriggering the sound (no envelope restart)
- **Slide trigs**: enable **smooth interpolation** between locked values. "The speed of the slide is relative to the current tempo and the slide is completed when the next trig is reached."
- Parameter locks "outrank standard step conditions" — they override the track's default parameter state only at that step

This is essentially per-step absolute overrides (like Gluon's `ParameterEvent`) plus an optional interpolation flag (like Gluon's `interpolation?: 'step' | 'linear' | 'curve'`).

**Source**: [Elektron Parameter Locks (Gearspace)](https://gearspace.com/board/electronic-music-instruments-and-electronic-music-production/616415-educate-me-what-parameter-locks.html), [Elektron Analog Four Manual](https://www.manualslib.com/manual/703011/Elektron-Analog-Four.html?page=35)

### SuperCollider's Pattern System

SuperCollider's `Pbind` represents a different paradigm: parameter values are specified per-event using pattern expressions. Continuous automation requires wrapping dynamic values in `Pfunc` (function pattern), which re-evaluates every time an event is generated. Essentially "inline parameter specification as code" — highly flexible but requires a programming mental model.

### Trade-off Summary

| Approach | Expressiveness | Editability | AI-Legibility | Storage Complexity |
|---|---|---|---|---|
| **Inline (tracker)** | Per-step discrete; smooth requires many entries | Excellent for discrete; poor for curves | High — flat array, explicit values, text-scannable | Low — events in sorted array |
| **Separate lanes (DAW)** | Continuous curves with arbitrary interpolation | Excellent for curves; poor for per-note correlation | Medium — separate data structure, harder to correlate with notes | Medium — parallel breakpoint arrays |
| **Parameter locks (Elektron)** | Per-step with optional slide; no free curves | Good for step-based; limited for continuous | High — per-step overrides with explicit slide flag | Low — sparse overrides on steps |
| **Pattern code (SuperCollider)** | Unlimited (code) | Low (requires programming) | Low (arbitrary code) | Low (code is compact) |
| **Hybrid (Renoise)** | Full — both inline and envelopes | Best of both but two mental models | Medium — two representations to parse | Medium — dual storage |

---

## 3. Interpolation Between Parameter Events

### Step vs Linear vs Curve

Most systems support at least three modes:

- **Step/Hold**: value jumps instantly at each point (Bitwig: press `[H]` on a point; Renoise: "Points" mode)
- **Linear**: straight-line interpolation between points (the default in most DAWs)
- **Curve/Bezier**: shaped transitions between points

### Tracker Smooth Sweeps

Trackers achieve smooth parameter changes through two mechanisms:

1. **Effect commands that execute per-tick**: Renoise's `-Uxx` (pitch up by xx/16 semitones per tick), `-Ixx` (volume fade in by xx units per tick), `-Gxx` (glide toward target note). These update at **tick rate** (default 12 ticks per line), providing sub-line resolution. The delay column adds 1/256th-line precision.

2. **Graphical automation envelopes** (Renoise): separate from the pattern editor, offering Points, Lines (with adjustable handles), and Curves (cubic easing). Resolution down to 1/256th of a line with snap-to-grid options.

### Bezier Curve Automation

**Reaper**: stores bezier tension per automation point (shape value 5). The UI provides ALT+drag on envelope segments to edit curvature. Internally, the RPP file saves "timings of points and curvature for every point, and Reaper interpolates between the points on the fly."

**Bitwig**: ALT+click+drag between two points bends the curve. Hold mode added in Bitwig 6 for step automation. Curve editing in the Inspector panel. Limited compared to Reaper's flexibility.

**Ableton**: offers shape insertion tools (sine, triangle, sawtooth, square, ADSR ramps) that scale to time selections. Envelope simplification automatically reduces breakpoint count while preserving shape.

### Block-Based Processing Reality

A critical finding from AdmiralBumbleBee's DAW comparison: automation speed varies **dramatically** between DAWs. Pro Tools achieves sub-0.5ms fades; Studio One had 320ms fades (15,360 samples). Most DAWs use block-based processing where the plugin receives one parameter value per audio block, requiring smoothing to avoid zipper noise. VST3's `IParamValueQueue` enables sample-accurate automation by providing a queue of timestamped automation points within each processing block.

**Source**: [DAW Automation Speed Comparison](https://www.admiralbumblebee.com/music/2019/05/25/Daw-V-Daw-Automation-Part-2.html), [Reaper Bezier Curves](https://reaper.blog/2017/03/bezier-curves/), [Bitwig Automation](https://www.bitwig.com/userguide/latest/automation/)

---

## 4. Modulation vs Automation Distinction

### Are They the Same Thing?

Architecturally distinct in leading systems, but exist on a spectrum:

- **Automation**: replaces the base value at a given time. Persisted. Deterministic playback. Usually drawn or recorded.
- **Modulation**: offsets from whatever the current value is. Usually generated in real-time (LFO, envelope follower, expression input). Often non-persisted or persisted only as modulator configuration, not the output signal.

Bitwig's analysis reveals a limitation: "It doesn't seem that you can record modulation as automation" — the modulation output cannot be captured as automation data. This reflects a deliberate architectural boundary.

### Stacking/Composition Order

The standard composition model (CLAP, Bitwig):

```
effective_value = clamp(base_value + automation_delta + sum(modulation_offsets))
```

For Ableton, composition is multiplicative for volume:

```
effective_volume = automation_value * clip_envelope_modulation
```

Bitwig's modulation connections each have a **transfer function** applied before summation, and **modulation scaling** allows one modulator to control the depth of another, enabling:

```
effective_offset = transfer_function(modulator_output) * scaling_source_output * depth
```

### Non-Destructive Modulation in Practice

CLAP's implementation is the clearest: `CLAP_EVENT_PARAM_MOD` events target specific voices via matching criteria (key, note_id, channel — using -1 as wildcard). The offset is stored per-voice and added at render time. When the modulation stops, the parameter returns to its base+automation value.

VST3 has no first-class modulation concept — plugins must manage this internally. Bitwig works around this for CLAP plugins natively and approximates it for VST3 via its modulator system.

**Source**: [Bitwig Modulators Analysis](https://www.admiralbumblebee.com/music/2017/06/23/Bitwig-Modulators.html), [CLAP Tutorial](https://nakst.gitlab.io/tutorial/clap-part-2.html), [u-he CLAP](https://u-he.com/community/clap/)

---

## 5. Parameter Change Models in AI/Generative Music

### Current AI Music Tools (Udio, Suno)

These operate at a fundamentally different level — they generate audio waveforms directly from text prompts, not symbolic parameter sequences. Parameter control is achieved through:

- **Text conditioning**: "sad jazz ballad" implies tempo, dynamics, timbre
- **Metatags**: Udio uses `[tag]` syntax for in-line control within lyrics
- No exposed parameter automation model; the model's latent space encodes these implicitly

**Source**: [Suno/Udio Analysis](https://arxiv.org/html/2509.11824v1)

### Symbolic Music Tokenization for ML

MidiTok provides the definitive survey of how symbolic music is tokenized for neural networks:

- **REMI**: `Bar → Position → Pitch → Velocity → Duration` tokens. Optional Tempo tokens at specific positions. No continuous parameter curves.
- **Compound Word**: pools Pitch/Velocity/Duration into single embeddings, reducing sequence length (critical for transformer quadratic complexity)
- **Octuple**: pools eight token types per note into one compound token
- **MIDI-Like**: direct MIDI message translation (NoteOn, NoteOff, TimeShift)

**Critical finding**: None of the major tokenization schemes represent continuous controller automation (CC, pitch bend, expression) as tokenizable sequences. Velocity is per-note only. Tempo changes are discrete tokens at specific positions. This is a significant gap — continuous parameter automation is essentially unrepresented in current AI music generation.

The FIGARO paper (ICLR 2023) addresses fine-grained control over instruments, chords, note density, and mean pitch through "description-to-sequence" modeling, but not time-varying parameter curves.

**Source**: [MidiTok Tokenizations](https://miditok.readthedocs.io/en/latest/tokenizations.html), [FIGARO Paper](https://arxiv.org/abs/2201.10936)

### Expressive Performance Modeling

Recent work (Scientific Reports, 2025) shows that continuous expression is poorly handled:

- MIDI velocities normalized to [0,1] for neural network input
- Tempo variation captured via onset detection post-hoc, not as control sequences
- Models achieve 79.4% harmonic consistency but score notably lower than humans on expressiveness (MOS 4.3 vs 4.8)
- "Emotional inadequacy since [AI] fails to match human vocal expressions involving phrasing, rubato, and dynamic range adjustments"

**Source**: [Expressive Music Composition Paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC12314053/)

### MIDI 2.0 Per-Note Controllers

MIDI 2.0 is the most relevant standard for expressive per-note parameter control:

- **32-bit resolution** for all controllers (up from 7-bit), eliminating zipper noise
- **Per-note pitch bend**: individual notes in a chord can be bent independently
- **Per-note controllers**: independent modulation per note on a single channel (replaces MPE's multi-channel workaround)
- **Note On attributes**: Attribute Type + Attribute Data fields carry per-note metadata (articulation, microtuning to 1/512th semitone)
- **Orchestral Articulation Profile (M2-123)**: standardizes articulation encoding across eight instrument categories

Directly relevant to Gluon — MIDI 2.0's per-note parameter model maps cleanly to inline `ParameterEvent` with `controlId` targeting specific parameters.

**Source**: [MIDI 2.0 State Update](https://midi.org/the-state-of-midi-2-0-high-resolution-performance-and-the-rise-of-profiles-update-feb-2026)

---

## 6. Gluon Current State and Gaps

### What We Have

Gluon's current model already has solid foundations:

**Two parameter change mechanisms coexist:**

1. **Timeless parameter state** (`Track.params: SynthParamValues`) — the "now" value, written by AI `move` or human knob twists. Provenance tracked via `ControlState` (`source: 'human' | 'ai' | 'default'`). Full undo via `ParamSnapshot`.

2. **Temporal parameter events** (`ParameterEvent` in `Region.events[]`) — per-step param locks, stored inline with notes and triggers in the same sorted event array. Collision rules prevent duplicate `(controlId, at)` pairs.

```ts
interface ParameterEvent extends BaseEvent {
  kind: 'parameter';
  controlId: string;
  value: number | string | boolean;
  interpolation?: 'step' | 'linear' | 'curve';
}
```

**Scheduler dispatch** handles parameter events in two paths:
- Standalone: `onParameterEvent` callback → mutates `track.params` at runtime
- Co-located with triggers/notes: resolved inline via `resolveEventParams`

**AI tools**: `move` (instantaneous or timed drift via `AutomationEngine`) and `sketch` (writes events including `ParameterEvent` to regions).

**Views**: Tracker renders parameter events inline. Rack shows current values. Patch shows modulation routing.

### What's Missing

| Gap | Description | Backlog |
|-----|-------------|---------|
| **Interpolation runtime** | `interpolation` field exists on type but scheduler treats all events as step | #408 (M5) |
| **Automation drawing UI** | No breakpoint envelope editor; can record live but not draw/edit | #432 (M5) |
| **Non-destructive offsets** | Modulation overwrites rather than offsetting; no base+offset separation | #307 (unscheduled) |
| **Smooth UI transitions** | `move` with duration in UI | #378 (unscheduled) |
| **Automation lane regions** | `RegionKind = 'automation_lane'` declared but no code creates/reads them | — |
| **Curve tension/shape** | `interpolation: 'curve'` has no tension parameter | — |
| **Playback param drift** | `onParameterEvent` mutates `track.params` with no undo snapshot | By design, but worth documenting |

### Key Tensions

1. **Inline storage vs expressiveness**: Storing parameter events in the same array as notes works perfectly for the tracker view and for Elektron-style step automation. But it's a poor fit for continuous automation curves (filter sweeps, volume swells) — you'd need hundreds of events to approximate a smooth curve, bloating the event array and the AI's context window.

2. **Absolute values only**: `ParameterEvent.value` is always absolute. There's no way to express "increase brightness by 0.1 from whatever it is now" as a sequenced event. The `MoveOp` supports `{ relative: number }` but the persisted event model doesn't. This limits composability — you can't layer relative automation on top of other automation.

3. **No base/automation/modulation separation**: The current model conflates the knob position, automation-driven values, and modulation. CLAP, Bitwig, and Pro Tools all demonstrate that separating these layers is essential for non-destructive workflows.

4. **AI legibility vs density**: Sparse per-step parameter locks (Elektron-style) are extremely AI-friendly — the AI can read and write them as compact event lists. Dense breakpoint envelopes are much harder for the AI to reason about, inspect, or modify precisely.

---

## 7. Recommended Design Direction

### Three-Layer Parameter Model

Following CLAP's architecture and informed by Bitwig, Pro Tools, and Ableton:

```
effective_value = clamp(base_value + automation_delta + sum(modulation_offsets))
```

| Layer | What | Persisted | AI-visible | Undo |
|-------|------|-----------|-----------|------|
| **Base value** | The knob position. Set by human or AI `move`. | Yes | Yes (`track.params`) | Yes (`ParamSnapshot`) |
| **Automation** | Time-varying value from `ParameterEvent` in regions. Replaces base during playback. | Yes | Yes (compressed as `param_locks`) | Yes (`RegionSnapshot`) |
| **Modulation** | Real-time offsets from LFOs, envelope followers, expression. Non-destructive, additive, per-voice capable. | Config only (routing, not output) | Routing visible, output transient | Routing undoable |

### Dual Storage: Inline Locks + Automation Lanes (Renoise Model)

The Renoise hybrid is the right model for Gluon:

1. **Inline `ParameterEvent`s in pattern regions** — for per-step parameter locks. This is the tracker-native, AI-friendly representation. Sparse, explicit, text-scannable. Stays exactly as it is.

2. **Dedicated `automation_lane` regions** — for continuous automation curves. A separate region per `(trackId, controlId)` pair, containing breakpoint events with interpolation and curve tension. The `RegionKind = 'automation_lane'` type already exists; it just needs runtime support.

The two representations compose at playback: automation lane values provide the baseline curve, inline parameter locks override at specific steps. This matches how Renoise's effect commands and graphical envelopes coexist.

### Interpolation: Minimal Extension

Extend `ParameterEvent` with an optional tension parameter for curve shaping:

```ts
interface ParameterEvent extends BaseEvent {
  kind: 'parameter';
  controlId: string;
  value: number | string | boolean;
  interpolation?: 'step' | 'linear' | 'curve';
  tension?: number;  // -1.0 to 1.0, controls curve shape (0 = linear)
}
```

This matches Reaper's model (per-point curvature) without requiring full bezier control points. The scheduler computes intermediate values between consecutive events based on the interpolation mode and tension.

### AI-Legibility Strategy

The AI's compressed state representation should distinguish the two automation modes:

- **Inline locks**: continue as `param_locks: { at, params }[]` — sparse, per-step, high signal
- **Automation curves**: compress as `automation: { controlId, points: { at, value, curve? }[] }[]` — breakpoint summary, not sample-level

For AI *writing*, inline locks are preferred for discrete per-step changes, while automation curves are preferred for sweeps and continuous movements. The AI should be able to choose the right tool for each situation.

### Priority Order

1. **Implement interpolation runtime** (#408) — highest impact, unblocks expressiveness with existing data model
2. **Automation lane regions** — activate the existing `RegionKind`, add scheduler support, enables #432
3. **Automation drawing UI** (#432) — human-facing complement to what AI can already write via sketch
4. **Non-destructive modulation offsets** (#307) — important but can be deferred until the automation foundation is solid

---

## Sources

### Plugin APIs
- [CLAP params.h](https://github.com/free-audio/clap/blob/main/include/clap/ext/params.h)
- [CLAP Tutorial Part 2](https://nakst.gitlab.io/tutorial/clap-part-2.html)
- [VST3 Parameters and Automation](https://steinbergmedia.github.io/vst3_dev_portal/pages/Technical+Documentation/Parameters+Automation/Index.html)
- [u-he CLAP](https://u-he.com/community/clap/)

### DAWs and Hosts
- [Bitwig Unified Modulation System](https://www.bitwig.com/userguide/latest/the_unified_modulation_system/)
- [Bitwig Modulators Analysis](https://www.admiralbumblebee.com/music/2017/06/23/Bitwig-Modulators.html)
- [Bitwig Automation](https://www.bitwig.com/userguide/latest/automation/)
- [Ableton Automation Manual](https://www.ableton.com/en/manual/automation-and-editing-envelopes/)
- [Ableton Clip Envelopes](https://www.ableton.com/en/manual/clip-envelopes/)
- [Reaper Bezier Curves](https://reaper.blog/2017/03/bezier-curves/)
- [Pro Tools Trim Automation](https://www.production-expert.com/production-expert-1/trim-mode-in-pro-tools-automation-what-you-should-know)
- [Logic Automation Modes](https://www.macprovideo.com/article/logic-pro/quick-tip-logics-automation-modes-explained)
- [Ardour Automation](https://manual.ardour.org/mixing/automation/controlling-a-track-with-automation/)
- [DAW Automation Speed Comparison](https://www.admiralbumblebee.com/music/2019/05/25/Daw-V-Daw-Automation-Part-2.html)

### Trackers
- [Renoise Graphical Automation](https://tutorials.renoise.com/wiki/Graphical_Automation)
- [Renoise Effect Commands](https://tutorials.renoise.com/wiki/Effect_Commands)
- [OpenMPT Parameter Control Events](https://wiki.openmpt.org/Manual:_Parameter_Control_Events)

### Hardware
- [Elektron Parameter Locks (Gearspace)](https://gearspace.com/board/electronic-music-instruments-and-electronic-music-production/616415-educate-me-what-parameter-locks.html)
- [Elektron Analog Four Manual](https://www.manualslib.com/manual/703011/Elektron-Analog-Four.html?page=35)

### Modular / Patching
- [VCV Rack Voltage Standards](https://vcvrack.com/manual/VoltageStandards)
- [Max/MSP Presets and Interpolation](https://docs.cycling74.com/userguide/presets_and_interpolation/)

### AI and Music
- [MidiTok Tokenizations](https://miditok.readthedocs.io/en/latest/tokenizations.html)
- [FIGARO Paper (ICLR 2023)](https://arxiv.org/abs/2201.10936)
- [Expressive Music Composition (2025)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12314053/)
- [Suno/Udio Analysis](https://arxiv.org/html/2509.11824v1)
- [MIDI 2.0 State Update](https://midi.org/the-state-of-midi-2-0-high-resolution-performance-and-the-rise-of-profiles-update-feb-2026)

### Community
- [KVR DAW vs Tracker Discussion](https://www.kvraudio.com/forum/viewtopic.php?t=530933)
- [KVR Sample-Accurate Automation Discussion](https://www.kvraudio.com/forum/viewtopic.php?t=545573)
