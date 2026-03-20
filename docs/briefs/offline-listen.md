# Offline Audio Rendering for the `listen` Tool

**Status:** Implemented
**Milestone:** M4 (AI evaluation quality)
**Depends on:** Plaits WASM + Rings WASM already compiled and served (PRs #98, #99)

> **Implementation note:** Offline render is fully operational. The `listen` tool renders audio offline (no transport dependency), supports voice isolation via track selection, and produces beat-synced captures. See `src/audio/offline-render.ts`.

---

## 1. Current State and Why It Is Limiting

The `listen` tool works by:

1. Tapping the live `MediaStreamAudioDestinationNode` off the mixer (`audio-engine.ts:50–54`)
2. Running a `MediaRecorder` for a timer-calculated duration (`audio-exporter.ts:49–89`)
3. Transcoding the WebM blob to WAV via `OfflineAudioContext.decodeAudioData` (`wav-encode.ts`)
4. Sending the WAV to Gemini for evaluation (`api.ts:730–772`)

A hard transport guard at `api.ts:705–707` rejects the call when the sequencer is stopped.

### Problems

**Transport dependency.** The AI cannot evaluate audio unless the human has pressed play. This breaks the most common agentic workflow: the AI designs a voice, wants to check how it sounds, but the human hasn't started playback yet. The AI has to ask the human to press play before it can hear anything.

**No voice isolation.** The capture records the same mixed audio the human hears. The AI cannot listen to a single voice in isolation — it hears whatever mute/solo state the human has set. If the AI is designing a bass sound, it hears the kick, hats, and everything else bleeding in.

**Timer-based, not beat-synced.** Capture starts at whatever phase the sequencer is currently in, not at beat 0. A two-bar capture may straddle pattern boundaries with different parameter lock states.

**Human disruption.** The AI's capture and the human's listening share the same audio graph. Any future change to the AudioContext (sample rate, buffer size) would interrupt the human's playback during an AI listen call.

---

## 2. Target Behavior

1. The AI can render audio at any time, whether or not the transport is playing
2. The AI can render a subset of voices (e.g., just the bass it's designing) or the full mix
3. The human's playback is completely unaffected — no shared state, no interruption
4. Render always starts at beat 0 — beat-sync is guaranteed by construction
5. The transport guard is removed from the listen tool

---

## 3. Approach: Worker-Based WASM Render

### Why not OfflineAudioContext?

`AudioWorkletNode` cannot be constructed inside an `OfflineAudioContext` in any major browser. The Web Audio spec allows `AudioWorklet.addModule()` on `BaseAudioContext`, but `new AudioWorkletNode(offlineCtx, ...)` throws `NotSupportedError`. This is a known spec gap with no near-term browser fix.

### Why a Worker works

Both Plaits and Rings expose a clean C ABI that the worklet processors call directly:

**Plaits** (`plaits-worklet.ts`):
- `_plaits_create(sampleRate)` → handle
- `_plaits_set_model(handle, model)`
- `_plaits_set_patch(handle, harmonics, timbre, morph, note)`
- `_plaits_trigger(handle, accentLevel)`
- `_plaits_set_gate(handle, open)`
- `_plaits_render(handle, outputPtr, frames)` → rendered frame count

**Rings** (`rings-worklet.ts`):
- `_rings_create()` → handle
- `_rings_set_model(handle, model)`
- `_rings_set_patch(handle, structure, brightness, damping, position)`
- `_rings_set_note(handle, tonic, note)`
- `_rings_render(handle, inputPtr, outputPtr, frames)` → rendered frame count

These functions have no Web Audio dependency. A Worker can load the same WASM binaries, instantiate the modules via `createPlaitsModule()` / `createRingsModule()`, and call `_plaits_render` / `_rings_render` in a loop to produce PCM samples. No AudioContext needed at all.

The worklet processors already demonstrate the complete render pattern: load binary, create handle, manage HEAPF32 buffers, render in 128-frame blocks with sub-block event scheduling. The Worker replicates this logic in virtual time rather than real time.

---

## 4. Architecture

```
Main thread                          Worker thread
───────────                          ─────────────
listen tool called
  │
  ├─ Build RenderSpec from session
  │   (voices, params, events,
  │    processors, BPM, bars)
  │
  ├─ postMessage(renderSpec) ──────► Worker receives spec
  │                                    │
  │                                    ├─ Load WASM binaries
  │                                    ├─ Create Plaits/Rings handles
  │                                    ├─ Schedule events in virtual time
  │                                    ├─ Render 128-frame blocks
  │                                    │   (Plaits → Rings chain per voice)
  │                                    ├─ Mix selected voices
  │                                    └─ postMessage(Float32Array) ──►
  │                                                                    │
  ◄── Receive PCM buffer ─────────────────────────────────────────────┘
  │
  ├─ Encode to WAV (wav-encode.ts)
  ├─ Send to Gemini for evaluation
  └─ Return critique to tool loop
```

### RenderSpec (serializable, main thread → Worker)

```typescript
interface RenderSpec {
  sampleRate: number;       // 48000
  bpm: number;
  bars: number;             // how many bars to render
  tracks: RenderTrackSpec[];
}

interface RenderTrackSpec {
  id: string;
  model: number;            // Plaits model index
  params: SynthPatch;       // { harmonics, timbre, morph, note }
  events: RenderEvent[];    // triggers, gates, param locks — in beat time
  processors: RenderProcessorSpec[];
}

interface RenderProcessorSpec {
  type: 'rings';
  model: number;
  params: RingsPatch;       // { structure, brightness, damping, position }
}

interface RenderEvent {
  beatTime: number;         // absolute beat position (0-based)
  type: 'trigger' | 'gate-on' | 'gate-off' | 'set-patch' | 'set-note';
  // payload varies by type
  accentLevel?: number;
  patch?: Partial<SynthPatch>;
  note?: number;
}
```

### Worker render loop (pseudocode)

```
for each voice in spec.tracks:
  plaitsHandle = createPlaits(48000)
  setPatch(plaitsHandle, voice.params)
  setModel(plaitsHandle, voice.model)

  if voice.processors has rings:
    ringsHandle = createRings()
    setRingsPatch(ringsHandle, rings.params)

  sort events by beatTime
  totalFrames = bars * stepsPerBar * framesPerStep
  output = new Float32Array(totalFrames)

  for frame 0..totalFrames in 128-frame blocks:
    apply any events whose beatTime falls in this block
    plaitsRender(handle, blockBuffer, 128)
    if rings:
      ringsRender(handle, blockBuffer, ringsOutput, 128)
      blockBuffer = ringsOutput
    copy blockBuffer to output

mix all voice outputs → final Float32Array
postMessage(final)
```

### Event scheduling

Convert canonical `MusicalEvent` (with fractional `at` positions) to absolute frame offsets:

```
framesPerStep = (60 / bpm) * sampleRate / 4   // one 16th note
frameOffset = event.at * framesPerStep
```

This reuses the same math as the live scheduler but in virtual time. Microtiming (`event.at = 4.3`) maps naturally.

---

## 5. Implementation Steps

### Step 1: Offline render Worker

Create `src/audio/render-worker.ts`.

- Accept `RenderSpec` via `postMessage`
- Load Plaits and Rings WASM binaries (passed as `ArrayBuffer` in the message, or fetched from known URLs)
- Instantiate WASM modules, create handles
- Render each voice independently in 128-frame blocks
- Chain Plaits → Rings when processors are present (Plaits output becomes Rings input)
- Mix all requested voices to mono
- Post back `Float32Array` PCM buffer

Key detail: The WASM binaries (`plaits.wasm`, `rings.wasm`) are already served from `/audio/`. The Worker can fetch them, or the main thread can pass them as transferable `ArrayBuffer`s to avoid re-fetching.

### Step 2: RenderSpec builder

Create `src/audio/render-spec.ts`.

- `buildRenderSpec(session, trackIds?, bars?)` → `RenderSpec`
- Converts canonical regions/events to `RenderEvent[]` with absolute beat times
- Applies parameter locks as `set-patch` events at the correct beat times
- Handles microtiming (fractional `at` values)
- If `trackIds` is omitted, includes all unmuted voices
- Respects mute state but ignores solo (the AI is choosing what to render explicitly)

### Step 3: Update ListenContext interface

Replace the current `ListenContext` (which requires `MediaStreamAudioDestinationNode` and `captureNBars`) with:

```typescript
interface ListenContext {
  renderOffline: (session: Session, trackIds?: string[], bars?: number) => Promise<ArrayBuffer>;
  onListening?: (active: boolean) => void;
}
```

The `renderOffline` function handles: build spec → post to Worker → receive PCM → encode WAV → return buffer.

### Step 4: Update listenHandler in api.ts

- Remove the transport guard (`if (!session.transport.playing)`)
- Call `listen.renderOffline(session, trackIds, bars)` instead of `listen.captureNBars(...)`
- Pass the WAV buffer to `evaluateAudio` as before

### Step 5: Update listen tool declaration

Add optional parameters to the `listen` tool:

```typescript
{
  question: string;        // what to evaluate (existing)
  trackIds?: string[];     // which voices to render (new, default: all unmuted)
  bars?: number;           // how many bars (new, default: 2)
}
```

This lets the AI say "listen to just the bass for 4 bars" — a capability that doesn't exist today.

### Step 6: Update system prompt and AI contract

- Remove "transport must be playing" from listen preconditions
- Document voice isolation: the AI can listen to individual voices or subsets
- Document that listen renders from beat 0 (no mid-pattern capture)
- Update `ai-contract.md` validation invariant 8 ("listen requires transport to be playing")

### Step 7: Remove or repurpose live capture path

The `MediaStreamAudioDestinationNode` tap and `AudioExporter.captureNBars` are no longer needed for the listen tool. They may still be useful for manual audio export (the download button). Keep the export path; remove the listen dependency on it.

---

## 6. Edge Cases

**Parameter locks:** Each step with a param lock generates a `set-patch` event at the corresponding beat time. The render Worker applies these the same way the live worklet does — sub-block scheduling handles the frame-accurate timing.

**Microtiming:** Fractional `at` values (e.g., 4.3) convert to fractional frame offsets. The sub-block render loop handles this naturally.

**Rings chain order:** Plaits renders first, its output becomes Rings' input — the same signal flow as the live audio graph. The Worker processes one voice at a time, so there's no routing complexity.

**Rings sample rate:** Rings is hardcoded to 48 kHz (`rings-worklet.ts:94`). The render Worker must use 48000 as its sample rate. This matches the live AudioContext.

**Empty patterns:** If a voice has no events, it still renders (Plaits produces continuous output based on its current patch). This is correct — the AI might want to hear a drone or continuous tone.

**Multiple processors:** Currently only Rings exists, but the architecture supports chaining: each processor's output becomes the next processor's input. The `RenderProcessorSpec` array preserves order.

---

## 7. Verification

- [ ] Offline render of a single Plaits voice matches the live output (within floating-point tolerance)
- [ ] Offline render with Rings chain matches live output
- [ ] Listen works with transport stopped
- [ ] Listen works with transport playing (human hears no interruption)
- [ ] Voice isolation: rendering one voice produces audio from only that voice
- [ ] Parameter locks are applied at correct beat positions
- [ ] Microtiming events land at correct frame offsets
- [ ] WAV encoding produces valid audio accepted by Gemini
- [ ] Listen tool declaration accepts `trackIds` and `bars` parameters
- [ ] System prompt and AI contract updated — no transport precondition
- [ ] Manual audio export (download button) still works via the live capture path

---

## 8. What This Enables

Beyond fixing the transport dependency, offline rendering opens up capabilities that weren't possible before:

- **Voice isolation:** The AI evaluates one voice at a time, giving more focused critique
- **A/B comparison:** Render the same voice with two different parameter sets and compare
- **Pre-commit evaluation:** The AI renders a change before applying it, listens, then decides whether to commit — true "think before you act"
- **Longer renders:** No timer jitter, no real-time constraint — render 16 bars if needed
- **Batch evaluation:** Render multiple variations in parallel Workers

These are future capabilities, not scope for this brief. But the architecture supports them without additional changes.
