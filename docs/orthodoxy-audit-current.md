# Orthodoxy Audit: Current Implementation

Comparison of Gluon's current implementation against orthodox audio software patterns. Each deviation is classified as **justified** (WebAudio/browser forces it), **pragmatic** (simpler and currently sufficient), or **unjustified** (should be fixed).

Last updated: 2026-03-15.

---

## Methodology

For each subsystem, we compare the implementation against the orthodox pattern from `docs/orthodox-patterns-reference.md`. Deviations are rated by severity:

- **Blocker**: Has caused or will cause bugs
- **Debt**: Will cause bugs or friction as the system scales
- **Cosmetic**: Style/naming difference with no functional impact

---

## 1. Scheduler (`src/engine/scheduler.ts`, `src/engine/playback-plan.ts`)

### What's Orthodox

The scheduler correctly implements the "Two Clocks" pattern:
- JS timer at 25ms interval (`LOOKAHEAD_MS = 25`) ✓
- Lookahead window of 100ms (`LOOKAHEAD_SEC = 0.1`) ✓
- Playhead derived from `AudioContext.currentTime` minus reference start time — no cumulative drift ✓
- Binary search (`lowerBound`) for event lookup ✓
- Tab backgrounding handled gracefully (catch-up window capped at `MAX_CATCHUP_STEPS = 8`) ✓

### Deviations

#### DEV-S1: PlaybackPlan deduplication map instead of AudioParam scheduling

| | |
|---|---|
| **Orthodox** | Events scheduled via `AudioParam.setValueAtTime()` / `start(when)` — the audio thread owns timing and deduplication is implicit |
| **Gluon** | Events deduped via `PlaybackPlan` (a Map of string IDs), then sent to worklet via `postMessage` with wall-clock timestamps |
| **Justified?** | Yes — WebAudio `AudioParam` scheduling doesn't work for WASM worklet synthesis. Worklet parameters are k-rate scalars, not sample-accurate automation lanes. The PlaybackPlan is a correct adaptation. |
| **Severity** | N/A (justified) |

#### DEV-S2: Cursor/prune model complexity

| | |
|---|---|
| **Orthodox** | Simple: schedule events in lookahead window, advance cursor past them. No separate "prune" step needed because events are consumed by the audio thread. |
| **Gluon** | Three-step: (1) cursor tracks scheduling frontier, (2) `PlaybackPlan.pruneBeforeStep` removes old entries, (3) `invalidateTrack` rewinds cursor for live edits. The prune step exists because the PlaybackPlan is a growing Map that needs memory management. |
| **Justified?** | Partially — the prune step is needed because the dedup map would grow unboundedly. But the recent bug (pruning at cursor instead of playhead, #317) shows the model is error-prone. A simpler approach: clear the map on each loop cycle boundary instead of pruning by step. |
| **Severity** | **Debt** — the cursor vs playhead distinction creates a class of subtle bugs. The fix in #317 (prune at `min(cursor, globalStep)`) is correct but non-obvious. |
| **Fix** | Consider resetting the planned-event set at loop boundaries instead of step-based pruning. This eliminates the cursor/playhead ambiguity entirely. The loop cycle is already tracked in `getLocalSegments`. |

#### DEV-S3: Floating-point dust guard at loop boundaries

| | |
|---|---|
| **Orthodox** | Not typically needed — native DAWs use integer tick counts (PPQ), not floating-point step positions |
| **Gluon** | `if (localStart > 0 && localStart < 1e-9) localStart = 0` — guards against accumulated float error causing missed events at loop start |
| **Justified?** | Yes — this is inherent to using floating-point step positions. Native DAWs avoid it by using integer ticks (e.g., 480 PPQ). Switching to integer ticks would be a larger refactor. |
| **Severity** | **Cosmetic** — the guard works. The underlying issue (float accumulation) is a known WebAudio trade-off. |

#### DEV-S4: No tempo map support

| | |
|---|---|
| **Orthodox** | Scheduler consults a tempo map for beat↔time conversion (Ardour, Ableton, Bitwig) |
| **Gluon** | Constant BPM assumed; `reanchorBpm()` handles discrete BPM changes but not tempo curves |
| **Justified?** | Pragmatic — constant BPM is fine for current use. Deferred to M3. |
| **Severity** | **Debt** — must be addressed before variable tempo features |

#### DEV-S5: Gate-off not recomputed on BPM change

| | |
|---|---|
| **Orthodox** | Gate-off times are relative to the note-on event and computed at scheduling time using the tempo map |
| **Gluon** | Gate-off computed once at scheduling time; if BPM changes between note-on and gate-off, the gate-off lands at the wrong wall-clock time |
| **Justified?** | Pragmatic — documented as an M2 limitation (scheduler.ts:214–218). Real-world impact is minimal at current BPM change frequency. |
| **Severity** | **Debt** — will be audible if rapid tempo changes are used |

---

## 2. Transport (`src/engine/transport-controller.ts`, `src/engine/transport-runtime.ts`)

### What's Orthodox

- Clean state machine: stopped → playing → paused → stopped ✓
- State transitions trigger appropriate audio cleanup ✓
- Position tracking via RuntimeTransportState.playheadBeats ✓
- Separate pause (hold position) vs stop (reset to 0) ✓

### Deviations

#### DEV-T1: Generation counter for event invalidation

| | |
|---|---|
| **Orthodox** | Lifecycle callbacks (`prepareToPlay()`, `releaseResources()`, `setProcessing(false)`) — host calls processor methods synchronously to flush state |
| **Gluon** | Monotonic generation counter propagated to worklets via `postMessage`; worklet drops events with `fence < minFence` |
| **Justified?** | Yes — WebAudio worklets can't receive synchronous lifecycle callbacks from the main thread. The generation/fence model is a correct async adaptation. |
| **Severity** | N/A (justified) |

#### DEV-T2: Per-track fence independent of global generation

| | |
|---|---|
| **Orthodox** | Per-track invalidation is handled by per-track lifecycle methods (JUCE calls `prepareToPlay` on individual processors). No global generation needed for per-track changes. |
| **Gluon** | Global generation increments on transport state changes. Per-track fences on each `VoicePool` can advance independently for live edits without bumping the global generation. |
| **Justified?** | Yes — this is a clean separation. Global generation handles transport-level events (play/pause/stop). Per-track fences handle content-level events (pattern edits). The recent work (#317) proved this design correct. |
| **Severity** | N/A (justified, well-designed) |

#### DEV-T3: Arrangement signature hashing for change detection

| | |
|---|---|
| **Orthodox** | DAWs track dirty state per-clip/per-pattern with explicit flags set by edit operations |
| **Gluon** | `syncArrangement()` computes a string signature of each track's region content and compares against the previous signature |
| **Justified?** | Pragmatic — works correctly, simple to implement. The string hashing is O(events) per sync call, which is fine for current pattern sizes (< 64 events). At larger scales (hundreds of events), a dirty flag set by edit operations would be more efficient. |
| **Severity** | **Debt** — O(events) per sync tick will not scale to large arrangements. |
| **Fix** | Add a `dirty` flag to each track/region, set by edit operations, checked by `syncArrangement()`. Clear the flag after invalidation. |

---

## 3. Audio Engine (`src/audio/audio-engine.ts`)

### What's Orthodox

- Voice pool with round-robin allocation ✓
- Per-voice accent gain nodes ✓
- Linear insert chain (source → processors → output) ✓
- Master channel (gain → panner → analyser → destination) ✓
- Mute/solo via separate gain node (never touches accent gain) ✓
- Chain rebuild with click-free ramping (2ms fade-out/in) ✓

### Deviations

#### DEV-A1: No voice stealing strategy

| | |
|---|---|
| **Orthodox** | When no free voice exists: steal released notes first, then steal oldest held note, optionally protect extremes |
| **Gluon** | Round-robin wraps regardless — if both voices are active, the older one is overwritten without any release/fade |
| **Justified?** | Pragmatic — with `VOICES_PER_TRACK = 2` and short step-grid notes, collision is rare. The overlap handling from #317 (per-voice parameter isolation) mitigates the worst symptom (parameter bleed). |
| **Severity** | **Debt** — will be audible with polyphony > 2 or long note durations |
| **Fix** | Before allocating, check if any voice has passed its `gateOffTime` and prefer that voice. This is the "steal released first" strategy. Minimal code change in `VoicePool.allocate()`. |

#### DEV-A2: No pre-fader/post-fader send architecture

| | |
|---|---|
| **Orthodox** | Channel strip has explicit pre-fader and post-fader send points |
| **Gluon** | Signal chain is `sourceOut → processors → chainOutGain → muteGain → mixer`. No send points. |
| **Justified?** | Pragmatic — sends are not needed until cross-track routing (M7). The current linear chain is correct for the current feature set. |
| **Severity** | N/A — correctly deferred |

#### DEV-A3: Modulation overwrites rather than offsets

| | |
|---|---|
| **Orthodox** | CLAP model: `effective = clamp(base + modulation_offset)`. Base value preserved; modulation is additive and non-destructive. |
| **Gluon** | Modulation is applied as an additive offset at the worklet level (`flushPatch` adds `modTimbre` to `currentPatch.timbre`), but the main thread's `ControlState` doesn't maintain separate base/offset values. |
| **Justified?** | Partially — the worklet-level addition is correct. The gap is on the main thread: there's no way to read back the base value separately from the modulated value. This matters for UI display and for the AI's state compression. |
| **Severity** | **Debt** — will need to be fixed when modulation is more prominent in the UI |
| **Fix** | Track `baseValue` and `modulationOffset` separately in `ControlState`. Display modulated value in UI but persist only base value. |

---

## 4. Worklet (`src/audio/plaits-worklet.ts`)

### What's Orthodox

- Message queue with time-based event ordering ✓
- Sub-block event scheduling (render segments between events) ✓
- Monotonic sequence numbers for stable ordering ✓
- Patch dirty flag with deferred flush until trigger ✓
- K-rate modulation parameters via AudioParam descriptors ✓

### Deviations

#### DEV-W1: postMessage instead of SharedArrayBuffer

| | |
|---|---|
| **Orthodox** | SharedArrayBuffer + lock-free SPSC ring buffer for high-frequency communication |
| **Gluon** | All communication via `postMessage` (data is copied, delivery timing unpredictable) |
| **Justified?** | Pragmatic — postMessage is simpler and sufficient for current event rates (step-grid notes at 25ms intervals). SharedArrayBuffer becomes necessary when modulation operates at control rate or when meter feedback is needed at display rate. |
| **Severity** | **Debt** — will become a performance bottleneck when modulation/metering scales |
| **Fix** | Migrate to SharedArrayBuffer + ringbuf.js for parameter streaming when control-rate modulation is implemented. Keep postMessage for low-frequency configuration (model changes, WASM binary transfer). |

#### DEV-W2: Linear scan for next event in render loop

| | |
|---|---|
| **Orthodox** | For small queues (< 100 events), sorted array + linear scan is standard and sufficient |
| **Gluon** | `this.queue.find(event => ...)` — linear scan on each render segment |
| **Justified?** | Yes — queue size in practice is < 20 events. Linear scan is cache-friendly and simpler than a binary heap. Would need to change only if event density increases dramatically (e.g., sample-accurate CC streaming). |
| **Severity** | N/A (correct for current scale) |

#### DEV-W3: Queue sort on every message receipt

| | |
|---|---|
| **Orthodox** | Events arrive from the scheduler already sorted by time. The queue should maintain sort order via insertion sort (O(1) for already-sorted input). |
| **Gluon** | `this.queue.sort(...)` is called on every incoming message — full sort of entire queue |
| **Justified?** | No — the scheduler sends events in time order, so insertion at the correct position would be O(1) in the common case. Full sort is O(n log n) on every message. |
| **Severity** | **Cosmetic** — queue is small enough that performance impact is negligible, but it's a code smell |
| **Fix** | Replace `this.queue.push(msg); this.queue.sort(...)` with binary search insertion: find the insertion point and splice in. |

#### DEV-W4: No denormal protection in WASM rendering

| | |
|---|---|
| **Orthodox** | Set FTZ/DAZ flags (native), or add DC offset / clamp near-zero values (WASM) |
| **Gluon** | No denormal protection in any WASM engine (Plaits, Rings, Clouds) |
| **Justified?** | No — WebAssembly can't set FTZ/DAZ, but workarounds exist (DC offset, clamping). Mutable Instruments upstream DSP may have some internal guards, but our wrappers add none. |
| **Severity** | **Debt** — can cause 100x CPU slowdown on long decay tails (Rings resonator), Clouds at low feedback, or silence after active playback |
| **Fix** | Add `~1e-25` DC offset in the WASM render functions before recursive processing. ~50 lines of C++ across three engines. |

---

## 5. Event Model (`src/engine/canonical-types.ts`, `src/engine/sequencer-types.ts`)

### What's Orthodox

- Discriminated union event types (note, trigger, parameter) ✓
- Position as fractional beat value ✓
- Velocity normalized 0–1 ✓
- NoteEvent with pitch (MIDI 0–127) + duration + velocity ✓
- ParameterEvent with controlId + value ✓
- Region as time-bounded event container ✓
- Events sorted by position (invariant #4) ✓

### Deviations

#### DEV-E1: TriggerEvent used for pitched instruments

| | |
|---|---|
| **Orthodox** | Pitched instruments use NoteOn/NoteOff (MIDI) or NoteEvent (tracker). TriggerEvent is for unpitched percussion only. |
| **Gluon** | `toggleStepGate` creates `TriggerEvent` regardless of instrument type. The step grid has no pitch column. Issue #308 tracks this. |
| **Justified?** | Pragmatic — the step grid was built for percussion-style patterns. NoteEvent support exists but the step grid doesn't expose it. |
| **Severity** | **Debt** — limits the AI to percussion-only patterns via the step grid. The tracker view (M5) will need NoteEvent editing for pitched instruments. |
| **Fix** | When the tracker view is implemented, default to NoteEvent for pitched instruments and TriggerEvent for percussion. The canonical model already supports both. |

#### DEV-E2: ParameterEvent interpolation declared but not implemented

| | |
|---|---|
| **Orthodox** | Automation lanes with interpolation: step (instant), linear (ramp between values), curve (exponential/bezier) |
| **Gluon** | `ParameterEvent.interpolation` field exists (`'step' | 'linear' | 'curve'`) but the scheduler treats all parameter events as step changes |
| **Justified?** | Pragmatic — step interpolation is sufficient for current parameter-lock-style automation. Linear/curve interpolation is deferred. |
| **Severity** | **Cosmetic** — the type is there for future use. Not harmful. |

#### DEV-E3: Dual state model (Pattern + Region)

| | |
|---|---|
| **Orthodox** | Single source of truth for event data. Trackers have one event list; DAWs have one clip/pattern per track. |
| **Gluon** | Tracks have both `pattern: Pattern` (step grid view model) and `regions: Region[]` (canonical events). Region is the source of truth; Pattern is a projection derived via `reprojectTrackPattern`. |
| **Justified?** | Pragmatic — the Pattern type was the original model; Region was added later as the canonical model. The projection keeps backward compatibility with existing step grid code. |
| **Severity** | **Debt** — maintaining two representations increases bug surface. Every edit must either go through the canonical path (edit Region → reproject Pattern) or the legacy path (edit Pattern directly). The legacy fallback code in `pattern-primitives.ts` (when `track.regions.length === 0`) is dead code that adds maintenance burden. |
| **Fix** | Remove the legacy Pattern-direct editing path. All tracks should have regions by default (migration ensures this). The Pattern type becomes a pure view model — never edited directly, only derived from regions. |

---

## 6. Synth Interface (`src/audio/synth-interface.ts`, `src/audio/plaits-synth.ts`)

### What's Orthodox

- Clean engine interface with model/params/gate/trigger/silence lifecycle ✓
- Scheduled note method with time parameter ✓
- Destroy method for cleanup ✓
- Lazy WASM loading (one load per AudioContext) ✓

### Deviations

#### DEV-SI1: Conditional set-patch based on override detection

| | |
|---|---|
| **Orthodox** | Always send all parameters at note-on time. The synth's internal smoothing handles the transition. |
| **Gluon** | `scheduleNote` compares `note.params` against `note.baseParams` and only sends `set-patch` if there are overrides (delta > 0.001). Notes without overrides rely on the real-time sync effect to keep the worklet current. |
| **Justified?** | Yes — this is an optimization to avoid overwriting live human knob changes. The scheduler runs 100ms ahead, so a timed `set-patch` would overwrite any human parameter change made in that 100ms window. Skipping `set-patch` for non-override notes lets the real-time sync effect (which runs immediately) take precedence. |
| **Severity** | N/A (justified, well-documented in plaits-synth.ts:133–148) |

---

## 7. Session & State (`src/engine/types.ts`, `src/engine/session.ts`)

### What's Orthodox

- Session as a single state tree ✓
- Immutable update pattern (spread operator creates new objects) ✓
- Discriminated union for snapshot types ✓
- Action group snapshots for batched undo ✓

### Deviations

#### DEV-SS1: Undo stack stores full snapshots, not inverse operations

| | |
|---|---|
| **Orthodox** | Two approaches: (1) Command pattern with inverse operations (JUCE, most DAWs), (2) Full state snapshots (simpler, more memory) |
| **Gluon** | Each undo entry stores the *previous* values (e.g., `prevSteps`, `prevEvents`, `prevValues`). Undo restores these values. This is a hybrid: it stores deltas (only changed fields), not full state snapshots. |
| **Justified?** | Yes — the hybrid approach gives O(1) undo without the complexity of inverse operation computation. Memory usage is proportional to the size of changes, not the size of the project. |
| **Severity** | N/A (good design) |

---

## Summary: Deviation Table

| ID | Area | Severity | Orthodox Alternative | Justified? |
|----|------|----------|---------------------|------------|
| DEV-S2 | Scheduler cursor/prune | Debt | Reset dedup set at loop boundaries | Partially |
| DEV-S4 | No tempo map | Debt | TempoMap data structure | Pragmatic (deferred to M3) |
| DEV-S5 | Gate-off BPM sensitivity | Debt | Recompute gate-offs on tempo change | Pragmatic (deferred to M3) |
| DEV-T3 | Signature hashing O(n) | Debt | Dirty flag per region | No |
| DEV-A1 | No voice stealing | Debt | Steal released voices first | Pragmatic |
| DEV-A3 | Modulation overwrites base | Debt | Separate base/offset in ControlState | No |
| DEV-W1 | postMessage not SAB | Debt | SharedArrayBuffer + ringbuf.js | Pragmatic |
| DEV-W3 | Full sort on message receipt | Cosmetic | Binary search insertion | No |
| DEV-W4 | No denormal protection | Debt | DC offset in WASM engines | No |
| DEV-E1 | TriggerEvent for pitched | Debt | NoteEvent for pitched instruments | Pragmatic (#308) |
| DEV-E2 | Interpolation not implemented | Cosmetic | Implement linear/curve in scheduler | Pragmatic |
| DEV-E3 | Dual state (Pattern+Region) | Debt | Remove legacy Pattern editing path | No |

### Justified Deviations (no action needed)

| ID | Area | Why justified |
|----|------|--------------|
| DEV-S1 | PlaybackPlan dedup | WebAudio worklet can't use AudioParam scheduling for WASM synthesis |
| DEV-S3 | Float dust guard | Inherent to float step positions; integer PPQ would be a larger refactor |
| DEV-T1 | Generation counter | Async postMessage channel can't do synchronous lifecycle callbacks |
| DEV-T2 | Per-track fence | Clean separation of transport-level vs content-level invalidation |
| DEV-W2 | Linear scan in worklet | Correct for queue sizes < 100 |
| DEV-SI1 | Conditional set-patch | Prevents 100ms-ahead scheduling from overwriting live human knob changes |
| DEV-SS1 | Delta snapshots for undo | Efficient hybrid of command pattern and snapshot |

---

## Priority Fix Plan

### Immediate (Blocker-adjacent)

1. **DEV-W4: Denormal protection** — ~50 lines C++ across Plaits/Rings/Clouds WASM. Prevents silent CPU spikes.
2. **DEV-T3: Dirty flag for change detection** — Replace O(n) signature hashing with dirty flag. Simple, removes unnecessary work per tick.

### Next milestone

3. **DEV-E3: Remove dual state** — Delete legacy Pattern-direct editing. All edits go through canonical Region path. Reduces bug surface.
4. **DEV-A1: Voice stealing** — Add "steal released first" in `VoicePool.allocate()`. Prevents note collision artifacts.
5. **DEV-S2: Simplify cursor/prune** — Reset PlaybackPlan at loop boundaries instead of step-based pruning.

### When feature demands it

6. **DEV-A3: Base/offset modulation** — Separate values in ControlState when modulation UI is built.
7. **DEV-W1: SharedArrayBuffer** — Migrate to ringbuf.js when control-rate modulation or metering is implemented.
8. **DEV-S4/S5: Tempo map** — Implement when variable tempo is needed (M3+).
9. **DEV-E1: NoteEvent for pitched** — Implement when tracker view is built (M5).
