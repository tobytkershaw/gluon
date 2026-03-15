# Orthodoxy Audit: Planned Features

For each planned feature in RFCs and briefs, this document identifies the orthodox pattern to follow before implementation begins. Features that are genuinely novel (AI-specific) are noted but not audited against prior art.

Last updated: 2026-03-15.

---

## Canonical Musical Model RFC (`docs/rfcs/canonical-musical-model.md`)

### Event Model

**Orthodox pattern to follow:** MIDI + Tracker hybrid

The canonical event model (`NoteEvent`, `TriggerEvent`, `ParameterEvent`) already follows orthodox patterns well. Key guidance for future work:

| Feature | Orthodox pattern | Reference |
|---------|-----------------|-----------|
| Pitched events | MIDI NoteOn/NoteOff model: pitch (0–127), velocity, duration | MIDI 1.0 spec |
| Unpitched events | Trigger with velocity and accent flag | Elektron parameter lock model |
| Parameter automation | Events with controlId + value + interpolation mode | Ableton automation lanes, Bitwig |
| Event collision rules | Dedup by position+kind (Gluon's current invariants are correct) | Standard in all sequencers |

**Gotcha to avoid:** Don't introduce a separate "automation lane" data structure. Keep automation events (`ParameterEvent`) inline with note/trigger events in the same `Region.events` array. This is simpler than parallel data structures and matches Renoise's approach (effects in the same row as notes).

### ControlSchema & Semantic Controls

**Orthodox pattern:** VST3/CLAP parameter descriptors + NKS pages

| Feature | Orthodox pattern | Reference |
|---------|-----------------|-----------|
| Parameter metadata | ID, name, range, default, step count, units | VST3 `ParameterInfo`, CLAP `clap_param_info_t` |
| Semantic grouping | Pages of 8 parameters, named groups | NKS (Native Kontrol Standard), Bitwig Remote Controls |
| Visibility tiers | Automated / Stored / Hidden | Max's parameter window, NKS visibility attribute |

**Where Gluon diverges (justifiably):** The `SemanticRole` enum (`brightness`, `texture`, `decay`, etc.) and the weighted mapping (`SemanticControlWeight`) are novel. NKS pages are manually authored by sound designers; Gluon's semantic controls are AI-generated with explicit weight visibility. This is a justified divergence — it's the core product innovation.

### SourceAdapter Interface

**Orthodox pattern:** VST/AU plugin hosting abstraction

| Aspect | Orthodox pattern | Gluon adaptation |
|--------|-----------------|-----------------|
| Write path | Host sends parameter changes via standardized API | `applyControlChanges(changes)` |
| Read path | Host polls plugin state | `readControlState()`, `readRegions()` |
| Validation | Host validates parameter ranges | `validateOperation(op)` |
| Schema discovery | Plugin declares parameters at load time | `getControlSchemas(engineId)` |

The adapter pattern is standard. The novel aspect is that adapters translate between **musical semantics** (brightness, texture) and **runtime parameters** (Plaits timbre, MIDI CC74). This abstraction level is higher than VST/AU, which operate at the raw parameter level.

---

## View Architecture RFC (`docs/rfcs/view-architecture.md`)

### Tracker View

**Orthodox pattern to follow:** Renoise Pattern Editor

| Feature | Orthodox pattern | Reference |
|---------|-----------------|-----------|
| Row layout | Note column + instrument column + volume column + effect columns | Renoise, OpenMPT |
| Navigation | Cursor-based (arrow keys), page up/down by pattern page size | Every tracker |
| Editing | Type to enter values at cursor; Tab/Shift+Tab between columns | Renoise |
| Selection | Block selection with Ctrl+click or Shift+arrows | Renoise |
| Row resolution | Configurable (1 row = 1/4 beat, 1/8 beat, etc.) | Renoise "lines per beat" |

**Key principle:** Every cell in the tracker must be editable. The current step grid limits TriggerEvent rows to gate/accent only (no pitch, no volume column). The tracker must expose all event fields at every position.

**Open-source reference to study:** [MilkyTracker source](https://github.com/milkytracker/MilkyTracker) — clean tracker implementation.

### Rack View

**Orthodox pattern to follow:** Guitar Rig rack

| Feature | Orthodox pattern | Reference |
|---------|-----------------|-----------|
| Layout | Vertical stack, signal flows top to bottom | Guitar Rig |
| Module display | Each module shows all its controls inline | Guitar Rig, Reason |
| Module reordering | Drag to reorder (insert FX position) | Guitar Rig |
| Bypass toggle | Per-module bypass button | Every DAW channel strip |
| Collapse/expand | Module can be collapsed to a header bar | Guitar Rig |

**Gotcha:** The rack must show controls from the `ControlSchema`, not hardcoded parameter UIs. This ensures new instrument types (future adapters) get correct UI automatically.

### Patch View (Node Graph)

**Orthodox pattern to follow:** Max/MSP patcher (constrained)

| Feature | Orthodox pattern | Reference |
|---------|-----------------|-----------|
| Nodes | One node per module (source, processors, modulators) | Max, Pure Data, Reaktor |
| Connections | Directed edges from output to input | Max, PD, VCV Rack |
| Layout | Left-to-right for audio flow, top-to-bottom for modulation | Audulus, Cables.gl |
| Interaction | Click output → click input to connect; click connection to delete | Max, Cables.gl |
| Feedback | Highlight connected nodes when hovering a connection | Cables.gl |

**Gotchas from reference implementations:**
- Max/MSP: Overwhelming visual density — Gluon's constrained topology (linear chains + modulation) should be much simpler
- VCV Rack: Cable spaghetti — use straight lines or gentle curves, not physics-simulated cables
- Pure Data: Minimal visual feedback — ensure connections show data flow direction clearly

**Open-source web reference:** [Cables.gl](https://cables.gl/) — web-native node graph with clean UX

### Surface View (Novel — skip orthodox audit)

The Surface view is genuinely novel (AI-curated UI composition). No orthodox pattern exists. The closest reference is NKS page authoring, but NKS is manually authored by sound designers, not AI-generated.

---

## Sequencer View Layer RFC (`docs/rfcs/sequencer-view-layer.md`)

### Step Grid (current)

**Already follows orthodox pattern:** Elektron-style step sequencer with gate, accent, and parameter locks.

**Gap:** No velocity column on the step grid. Standard step sequencers (Elektron Digitakt) allow per-step velocity editing. Current step grid only supports gate on/off and accent toggle.

### Piano Roll

**Orthodox pattern to follow:** Ableton / Logic piano roll

| Feature | Orthodox pattern | Reference |
|---------|-----------------|-----------|
| Note display | Rectangles: x=time, y=pitch, width=duration, color=velocity | Every DAW |
| Editing | Click to create note; drag edges to resize; drag to move | Ableton, Logic |
| Velocity lane | Below the piano roll, one bar per note | Ableton |
| Quantize | Snap to grid; grid resolution selectable | Every DAW |
| Selection | Box select, Ctrl+click multi-select | Every DAW |

**Key principle:** The piano roll reads and writes `NoteEvent` in the canonical `Region.events`. It must not maintain its own note list — it's a projection, not a source of truth (per the RFC's "editors are views" principle).

### Automation Lane

**Orthodox pattern to follow:** Ableton/Bitwig automation lanes

| Feature | Orthodox pattern | Reference |
|---------|-----------------|-----------|
| Display | Breakpoint envelope drawn over the pattern | Ableton, Bitwig |
| Editing | Click to add/move breakpoints; drag to create ramps | Ableton |
| Interpolation | Step, linear, curve (selectable per segment) | Bitwig |
| Parameter selection | Dropdown to select which parameter to automate | Every DAW |

**This directly uses `ParameterEvent.interpolation`** — the field that's currently declared but not implemented (DEV-E2 in the current audit). When automation lanes are built, implement interpolation in the scheduler.

---

## Phase 4A RFC (`docs/rfcs/phase4a.md`) and Brief (`docs/briefs/phase4a.md`)

### Insert FX Chains

**Orthodox pattern to follow:** Standard DAW channel strip inserts

| Feature | Orthodox pattern | Reference |
|---------|-----------------|-----------|
| Serial chain | Source → Insert 1 → Insert 2 → Output | Every DAW |
| Per-insert bypass | Bypass button per insert slot | Every DAW |
| Wet/dry mix | Per-insert mix control (0%=dry, 100%=wet) | Ableton, Bitwig |
| Insert reordering | Drag to reorder | Every DAW |
| Max chain length | Typically unlimited, but Gluon limits to 2 (correct for Phase 4A scope) | — |

**Already implemented correctly:** The audio engine's `rebuildChain()` with 2ms click-free ramp is the standard approach for chain reconfiguration.

**What's missing for Phase 4A completion:**
- Per-processor bypass (the `ProcessorConfig` type should have an `enabled` field)
- Wet/dry mix per processor (add a `mix` parameter, implemented as parallel dry path + wet path summed)

### Modulation (Tides)

**Orthodox pattern to follow:** Bitwig modulation + VCV Rack CV

| Feature | Orthodox pattern | Reference |
|---------|-----------------|-----------|
| Modulator output | Control-rate signal (one value per block) | Bitwig modulators |
| Routing | Modulator → depth control → target parameter | Bitwig, VCV Rack |
| Depth control | Bipolar (-1 to +1) gain applied to modulator output | Bitwig, CLAP |
| Non-destructive | Base value preserved; modulation is additive offset | CLAP |
| UI display | Ring/arc on target control showing modulation range | Bitwig |

**Already implemented correctly at the audio graph level:** Tides output → GainNode (depth) → target AudioParam. The Web Audio graph sums multiple inputs to the same AudioParam, which is the orthodox behavior.

**What needs to change for orthodox compliance:**
1. Main-thread `ControlState` must track base/offset separately (DEV-A3 from current audit)
2. When modulation is disconnected, parameter must return to base value (currently happens naturally at audio level but not tracked in state)

---

## Audio Analysis Tools RFC (`docs/rfcs/audio-analysis-tools.md`)

### Spectral Analysis

**Orthodox pattern to follow:** Standard FFT-based analysis

| Feature | Orthodox pattern | Reference |
|---------|-----------------|-----------|
| FFT | Web Audio `AnalyserNode.getFloatFrequencyData()` or custom FFT on rendered PCM | W3C Web Audio spec |
| Spectral centroid | Weighted mean of frequency bins: `Σ(f × magnitude) / Σ(magnitude)` | Standard MIR |
| Spectral spread | Standard deviation of frequency distribution | Standard MIR |
| Window size | 2048 or 4096 samples typical | Standard DSP |
| Window function | Hann or Blackman-Harris | Standard DSP |

### Dynamics Analysis

**Orthodox pattern to follow:** Standard RMS/peak metering

| Feature | Orthodox pattern | Reference |
|---------|-----------------|-----------|
| Peak level | Maximum absolute sample value in window | Every DAW meter |
| RMS level | Root mean square of samples: `sqrt(Σx²/n)` | Every DAW meter |
| LUFS | ITU-R BS.1770 loudness measurement | EBU R128, broadcast standard |
| Dynamic range | Peak-to-RMS ratio (crest factor) | Standard mastering metric |

### Offline Render

**Orthodox pattern to follow:** Bounce-to-disk

| Feature | Orthodox pattern | Reference |
|---------|-----------------|-----------|
| Offline render | Process audio faster than real-time, output to buffer/file | Every DAW ("bounce", "render", "export") |
| Deterministic | Same input produces identical output regardless of CPU load | Standard for offline rendering |
| Voice isolation | Solo/mute specific tracks before render | Every DAW |

**Gluon's worker-based WASM render** (`docs/briefs/offline-listen.md`) is the correct adaptation for the browser constraint (AudioWorkletNode can't be constructed in OfflineAudioContext). The approach — load WASM in a Worker, render in virtual time — is sound and deterministic.

**Open-source reference:** Tone.js `Offline` function renders using `OfflineAudioContext` — but this doesn't work with AudioWorklet, so Gluon's Worker approach is the correct alternative.

---

## Sequencer Brief (`docs/briefs/sequencer.md`)

### Pattern-Based vs Arrangement-Based Sequencing

**Orthodox patterns:**

| Mode | Description | When to use | Reference |
|------|-------------|-------------|-----------|
| Pattern loop | Single pattern repeats | Live performance, sound design | TR-808, Elektron, Gluon current |
| Pattern chain / song mode | Ordered list of patterns | Composition with repeating sections | Renoise, Elektron |
| Clip launching | Patterns triggered independently per track | Live improvisation | Ableton Session View |
| Linear arrangement | Clips placed on timeline | Final composition | Every DAW arrangement view |

**Recommendation for Gluon:** Stay with pattern loop for now (correct). When arrangement is needed:
1. Add pattern chain (song mode) first — it's the simplest extension from the current model
2. Clip launching (Ableton Session View style) is more complex and should be deferred until there's a clear product need
3. Linear arrangement is the eventual endpoint but requires a timeline UI

### Quantize

**Orthodox pattern:** Snap event positions to nearest grid point

Already implemented correctly in `pattern-primitives.ts:quantizeRegion()`. The implementation snaps to configurable grid size (default 0.25 = sixteenth note) and clamps to valid range. This matches the standard approach.

### MIDI Clock

**Orthodox pattern:** 24 PPQ (pulses per quarter note) clock sent/received over MIDI

| Message | Function |
|---------|----------|
| `0xF8` | Timing Clock (24 per beat) |
| `0xFA` | Start |
| `0xFB` | Continue |
| `0xFC` | Stop |
| `0xF2` | Song Position Pointer |

**Browser constraint:** No raw MIDI output in most browsers (Web MIDI API exists but has limited support). For M7, a bridge service or native companion app may be needed.

---

## Phase 4A Brief (`docs/briefs/phase4a.md`)

### FX Chain Insert/Bypass/Reorder

**Orthodox pattern:** Already covered in Phase 4A RFC section above.

**Status of implementation:**
- ✅ Serial chain routing (source → processors → output)
- ✅ Add/remove processor (AI tools + undo)
- ✅ Processor parameter control
- ❌ Per-processor bypass (not yet wired)
- ❌ Wet/dry mix (not yet implemented)
- ❌ Chain reordering UI (not yet implemented)

All missing items are standard patterns with no orthodoxy concerns.

---

## Offline Listen Brief (`docs/briefs/offline-listen.md`)

### Worker-Based WASM Render

**Orthodox deviation (justified):** Standard offline rendering uses `OfflineAudioContext`, but `AudioWorkletNode` can't be constructed in an offline context. The worker approach — load WASM directly, render in virtual time — is the correct adaptation.

**Key orthodoxy to maintain in implementation:**
1. **Deterministic:** Same state → same audio output, always. No dependence on real-time clock or CPU scheduling.
2. **Beat-synced:** Render always starts at beat 0. No phase ambiguity.
3. **Voice isolation:** Render a subset of tracks by only instantiating selected voices in the worker.
4. **No shared state with live playback:** Worker has its own WASM instances, completely independent of the AudioContext graph.

All four points are documented in the brief and follow standard offline-render orthodoxy.

---

## Preservation Contracts RFC (`docs/rfcs/preservation-contracts.md`)

**Novel — skip orthodox audit.** No prior art in audio software for runtime enforcement of AI edit constraints.

The closest analogue is Ableton's "Freeze Track" (locks audio output, prevents further editing) and "Collect All and Save" (preserves all referenced files). But these are coarse-grained and user-initiated, not fine-grained runtime constraints on an AI agent.

---

## AI-Curated Surfaces RFC (`docs/rfcs/ai-curated-surfaces.md`)

**Novel — skip orthodox audit.** No prior art for AI-generated UI composition in audio software.

The closest reference is NKS (Native Kontrol Standard) page authoring, where sound designers manually create pages of 8 parameters mapped to hardware knobs. Gluon automates this via AI, which is a justified divergence from the manual authoring pattern.

---

## Summary: Orthodox Patterns for Planned Features

| Feature | Orthodox pattern | Key reference | Notes |
|---------|-----------------|---------------|-------|
| Tracker view | Renoise pattern editor | MilkyTracker (OSS) | Full cell editability required |
| Rack view | Guitar Rig rack | Guitar Rig, Reason | Controls from ControlSchema, not hardcoded |
| Patch view (node graph) | Max/MSP patcher (constrained) | Cables.gl (web-native) | Keep simple — Gluon's topology is constrained |
| Piano roll | Ableton/Logic piano roll | — | Projection over NoteEvent, not separate model |
| Automation lanes | Ableton/Bitwig automation | — | Implements ParameterEvent.interpolation |
| FX chain bypass | Standard DAW insert bypass | — | Per-processor enabled flag |
| FX wet/dry mix | Parallel dry + wet sum | — | Per-processor mix parameter |
| Modulation routing | Bitwig + CLAP non-destructive | Bitwig, CLAP | Base/offset separation in ControlState |
| Spectral analysis | Standard FFT (2048/4096) | Web Audio AnalyserNode | Hann window, standard MIR metrics |
| Dynamics analysis | RMS/peak/LUFS | ITU-R BS.1770 | Standard metering |
| Offline render | Worker-based WASM render | — | Justified deviation from OfflineAudioContext |
| Pattern arrangement | Pattern chain → clip launching → timeline | Renoise → Ableton | Incremental: chain first, clips later |
| Tempo maps | Position-aware beat↔time conversion | Ardour v7.0 | Needed before variable tempo |
| Transport sync | Ableton Link | Link SDK | Needs WebSocket bridge for browser |
| MIDI I/O | Web MIDI API | MIDI 1.0 spec | Limited browser support |
| Voice allocation | Round-robin + steal released first | JUCE Synthesiser | Before polyphony support |
| SharedArrayBuffer | Lock-free SPSC ring buffer | ringbuf.js | When control-rate modulation scales |

### Features with no orthodox concern (genuinely novel)

| Feature | Why no prior art |
|---------|-----------------|
| AI-curated surfaces | No audio software has AI-composed UI |
| Preservation contracts | No audio software has runtime AI mutation constraints |
| Aesthetic direction | No audio software derives taste from collaboration history |
| Surface Score visual language | No audio software ties visual identity to sonic properties systematically |
| Semantic control weights (AI-generated) | NKS is manually authored; AI generation is new |
