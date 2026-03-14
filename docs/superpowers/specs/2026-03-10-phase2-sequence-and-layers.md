# Gluon Phase 2: Sequence & Layers

**Goal:** Turn Phase 1's single-voice demo into something you can make tracks with by adding a step sequencer, multiple voices, and audio export.

**Reference docs:**
- `docs/gluon-architecture.md` — Full vision (Phase 2 = "Jam Mode MVP")
- `docs/gluon-interaction-protocol-v03.md` — Protocol spec v0.3.1
- `docs/gluon-phase1-build.md` — Phase 1 build brief

---

## Scope

### In Phase 2

1. **Step sequencer** — 16-step default, variable up to 64 per voice. Gate, accent, per-step pitch, parameter locks (Elektron-style). Swing and micro-timing fields stored from day one.
2. **Transport** — Global BPM, play/stop, swing. Controlled by React state, executed by scheduler.
3. **4 voice slots** — Fixed count. Each voice: own model, own pattern, own agency. Classic electronic structure (kick/bass/lead/pad).
4. **AI sequencer integration** — `sketch` writes patterns (whole or sparse updates). Pending/commit/dismiss flow for pattern proposals. `move` continues to work for real-time parameter tweaks.
5. **Audio export** — Real-time bounce via `MediaRecorder`. Hit record, play, stop, download.

### Out of Phase 2

- Plaits WASM (Phase 2.5 — swap synth engine behind existing `SynthEngine` interface)
- Effects chain (Rings, Clouds)
- Tracker view (future alternative view of same `Pattern` data)
- Touch-optimised UI
- MIDI/DAW integration
- Offline render
- Record mode for parameter locks (hold record + move XY pad)

### Design inspiration

Elektron step sequencers (Digitakt, Syntakt, Digitone). The "hold step + tweak knob" paradigm for parameter locks. Direct, immediate, performative.

---

## Data Model

Extends existing Phase 1 types in `src/engine/types.ts`.

### Step

The atomic unit of the sequencer.

```typescript
interface Step {
  gate: boolean;              // note on/off
  accent: boolean;            // emphasis (velocity boost)
  params?: Partial<SynthParamValues>;  // parameter locks, absent = inherit voice params
  micro: number;              // micro-timing offset: -0.5 to +0.5 of one step width
}
```

- `gate: false` = rest.
- `params` is optional. Absence means inherit all values from the voice's current params at playback time.
- **Per-step pitch** is a parameter lock on `note` within `params` (e.g., `params: { note: 0.5 }`). There is no separate `pitch` field — `SynthParamValues.note` is the single source of truth for pitch, whether set at voice level or per-step. This avoids dual-field ambiguity.
- `micro` is stored from day one but **ignored by the scheduler in Phase 2** (see Sequencer Engine section). Activating it later requires no data migration.

### Pattern

A sequence of steps for one voice.

```typescript
interface Pattern {
  steps: Step[];              // up to 64 steps
  length: number;             // active step count
}
```

**Invariants:**
- `0 < length <= steps.length <= 64`
- Changing `length` downward hides steps (data preserved, not deleted).
- Changing `length` upward past `steps.length` appends default empty steps (`{ gate: false, accent: false, micro: 0 }`).
- `steps` array is never truncated except by explicit "clear tail" action.
- Undo snapshots capture both `length` and the affected `steps` slice.

### Voice (extended from Phase 1)

```typescript
interface Voice {
  id: string;
  engine: string;
  model: number;              // Plaits model index (0-15)
  params: SynthParamValues;
  agency: Agency;             // 'OFF' | 'SUGGEST' | 'PLAY'
  pattern: Pattern;
  muted: boolean;
  solo: boolean;
}
```

Each voice owns its pattern. Mute/solo are per-voice transport controls.

**Solo semantics** (enforced at transport layer, not implied by booleans):
> If any voice has `solo: true`, only soloed voices produce audio (solo overrides mute, matching Elektron/DAW convention). If no voice is soloed, all voices where `!muted` produce audio.

Implemented as `getAudibleTracks(session): Voice[]` helper in the sequencer layer.

### Transport

Declarative state owned by React. The scheduler reads it, never writes it.

```typescript
interface Transport {
  playing: boolean;
  bpm: number;                // 60-200
  swing: number;              // 0.0-1.0
}
```

No `tick` or `position` in Session. The scheduler owns scheduling state internally and publishes derived playback position outward via callback.

### Snapshot (redesigned for multi-voice + patterns)

Phase 1's `Snapshot` stores `prevValues` and `aiTargetValues` as flat `Partial<SynthParamValues>` with no voice identifier. This breaks with multiple voices and cannot represent pattern edits. Phase 2 replaces it with a discriminated union:

```typescript
interface ParamSnapshot {
  kind: 'param';
  trackId: string;
  prevValues: Partial<SynthParamValues>;
  aiTargetValues: Partial<SynthParamValues>;
  timestamp: number;
  description: string;
}

interface PatternSnapshot {
  kind: 'pattern';
  trackId: string;
  prevSteps: { index: number; step: Step }[];  // only changed steps
  prevLength?: number;                          // if length changed
  timestamp: number;
  description: string;
}

type Snapshot = ParamSnapshot | PatternSnapshot;
```

`applyUndo()` switches on `snapshot.kind` to determine which restore logic to run. `ParamSnapshot` retains the existing Phase 1 semantics (check current value against `aiTargetValues` before reverting). `PatternSnapshot` restores previous step data unconditionally (pattern edits are always undoable, unlike parameter drifts).

All snapshots carry `trackId` so undo knows which voice to target.

### PendingAction (extended for sketches)

Phase 1's `PendingAction` stores `changes: Partial<SynthParamValues>`. Sketch proposals need pattern data instead. Phase 2 extends with a discriminated union:

```typescript
interface ParamPendingAction {
  id: string;
  kind: 'suggestion' | 'audition';
  trackId: string;
  changes: Partial<SynthParamValues>;
  reason?: string;
  expiresAt: number;
  previousValues: Partial<SynthParamValues>;
}

interface SketchPendingAction {
  id: string;
  kind: 'sketch';
  trackId: string;
  description: string;
  pattern: PatternSketch;     // the proposed pattern content
  expiresAt: number;
}

type PendingAction = ParamPendingAction | SketchPendingAction;
```

`commitPending` and `dismissPending` switch on `kind`. Committing a sketch applies the `PatternSketch` to the voice's pattern and pushes a `PatternSnapshot` onto the undo stack. Dismissing discards it.

### AISketchAction (replacing Phase 1 stub)

Phase 1 defined `AISketchAction` with generic `content: unknown` and `sketchType` fields. Phase 2 replaces this with the concrete pattern-focused type. The old type is removed.

```typescript
interface AISketchAction {
  type: 'sketch';
  trackId: string;
  description: string;
  pattern: PatternSketch;
}

interface PatternSketch {
  length?: number;              // if provided, sets pattern length
  steps: StepSketch[];          // sparse: only includes steps to change
}

interface StepSketch {
  index: number;                // which step (0-based)
  gate?: boolean;
  accent?: boolean;
  params?: Partial<SynthParamValues>;  // includes note for per-step pitch
  micro?: number;
}
```

The `AIAction` union type updates accordingly.

### Session (extended from Phase 1)

```typescript
interface Session {
  tracks: Voice[];            // 4 fixed voices
  activeTrackId: string;      // ID of currently focused voice (not index)
  transport: Transport;
  leash: number;              // 0.0-1.0
  undoStack: Snapshot[];
  pending: PendingAction[];
  context: MusicalContext;
  messages: ChatMessage[];
  recentHumanActions: HumanAction[];  // retained from Phase 1
}
```

- `activeTrackId` is a string ID, not an index. Survives reordering or future voice management changes.
- `recentHumanActions` retained from Phase 1 — the AI layer uses it for reactive responses.
- `MusicalContext.tempo` becomes a computed getter derived from `transport.bpm` when transport exists, falling back to the manually-set value. `transport.bpm` is the source of truth for tempo when a transport is present. The human can still override via `MusicalContext` for non-sequenced sessions (future use).

### Agency note

The architecture doc defines 5 permission levels (LOCKED, SUGGEST, NUDGE, CO-PILOT, SKETCH). The protocol and implementation use 3: OFF, SUGGEST, PLAY. PLAY subsumes all AI capabilities including `sketch` pattern writing. This is an intentional simplification for Phase 1-2. Finer-grained permissions may be reintroduced later.

### Default step factory

```typescript
function createDefaultStep(): Step {
  return { gate: false, accent: false, micro: 0 };
}
```

### Default pattern factory

```typescript
function createDefaultPattern(length = 16): Pattern {
  return {
    steps: Array.from({ length }, createDefaultStep),
    length,
  };
}
```

---

## Sequencer Engine

### Architecture

The scheduler runs in the main thread using `setInterval` + lookahead — the standard Web Audio scheduling pattern. It emits time-stamped musical events. The audio layer renders them. The UI reads derived transport state.

```
setInterval (~25ms tick loop)
  → getSession() snapshot via ref-backed getter
  → look ahead 100ms into the future
  → for each audible voice, compute which steps fall in the window
  → for each step with gate=true:
      → resolve full parameter bundle
      → compute exact AudioContext time (with swing offset)
      → emit ScheduledNote
  → advance internal cursor
  → publish derived playback position
```

### Why main thread?

The scheduler doesn't process audio — it decides *when* things happen. Keeping it in the main thread means it reads Session state via a simple getter, avoiding serialisation overhead to/from an AudioWorklet. The 100ms lookahead buffer absorbs main-thread jank.

### Scheduler interface

```typescript
interface ScheduledNote {
  trackId: string;
  time: number;               // AudioContext.currentTime for note-on
  gateOffTime: number;        // AudioContext.currentTime for note-off
  accent: boolean;
  params: SynthParamValues;   // fully resolved, ready to play (includes note)
}

class Scheduler {
  constructor(
    private getSession: () => Session,
    private getAudioTime: () => number,
    private onNote: (note: ScheduledNote) => void,
    private onPositionChange: (globalStep: number) => void
  );

  start(): void;              // captures startTime, resets cursor, begins tick loop
  stop(): void;               // clears interval
  isRunning(): boolean;
}
```

**Gate-off timing is computed by the scheduler**, which has the sequencer knowledge to determine it. The rule: a gate lasts until the time of the next step in that voice's pattern, regardless of whether the next step is gated or not. (If the next step is also gated, the new trigger immediately cuts the old gate — the audio layer doesn't need special logic for this since `scheduleNote` at time T implicitly supersedes a `scheduleGateOff` at the same time T.)

The `AudioEngine.scheduleNote(note)` implementation uses both `note.time` (for trigger + params) and `note.gateOffTime` (for `setGateOpen(false)`). `AudioEngine.scheduleGateOff` becomes an internal method, not part of the public API — the scheduler communicates everything through `ScheduledNote`.

### Internal state (scheduler owns)

```
cursor: number            // integer ticks at 48 PPQN, advances with lookahead
startTime: number         // AudioContext.currentTime when play started
previousBpm: number       // for detecting BPM changes mid-play
```

These are never exposed to React or the UI.

### Published state (for UI)

`onPositionChange(globalStep)` publishes a fractional global step index derived from `AudioContext.currentTime`, not from the internal cursor. This keeps step highlighting visually synced with what the user hears.

```
globalStep = (currentAudioTime - startTime) / stepDuration
```

The UI derives per-voice position locally: `globalStep % voice.pattern.length`.

### Resolution

> Phase 2 sequencer resolution is fixed at 16th notes. One step = one 16th note. One bar = 16 steps. 48 PPQN gives 12 ticks per step.

### Swing

Swing operates on pairs of steps within a beat. A beat = 4 steps (4 sixteenth notes per quarter note). Within each beat, steps are paired: (0,1), (2,3). The second step in each pair is delayed.

```
beat_local_step = step_index % 4
pair_position = beat_local_step % 2     // 0 = downbeat, 1 = upbeat
swing_delay = pair_position * swing * (step_duration * 0.75)
```

Max swing delays the upbeat to 75% of the step duration (approaching triplet feel). This definition is stable regardless of pattern length.

### Timing offset application order

Final note time = base step time + swing delay. **Micro-timing is stored in the data model but ignored by the Phase 2 scheduler.** When micro-timing is activated (future phase), the formula becomes: base step time + swing delay + (micro * step_duration). Swing is a grid-level feel; micro-timing will be a per-step nudge on top of the swung grid.

For Phase 2, `step.micro` is always 0 in the default step factory and the scheduler does not read it. The field exists so the data model doesn't need migration when micro-timing is activated.

### Tick-to-step mapping

The scheduler fires a note when the cursor crosses a step boundary:

```
stepIndex = Math.floor(cursor / 12)   // 12 ticks per 16th note at 48 PPQN
```

On each tick loop iteration, the scheduler compares the previous step index to the current one. If it has advanced, the new step(s) are candidates for note emission (after checking gate, computing time offsets, etc.). This handles both normal advancement and cases where the tick loop skips ahead (e.g., after a tab was backgrounded).

### Note triggering model

Phase 1's synth renders continuously — `SynthEngine.render()` fills audio buffers every frame. The step sequencer adds a gate/trigger model on top.

When the scheduler emits a `ScheduledNote`, the audio layer schedules the parameter change and trigger at the note's future `time` using the Web Audio API's built-in scheduling.

**The scheduling boundary lives in `AudioEngine`, not in `SynthEngine`.** The `SynthEngine` interface remains immediate-only (it doesn't know about time). The `AudioEngine` bridges the gap by using Web Audio's `AudioParam.setValueAtTime()` and scheduling trigger events via `setTimeout` with compensation for the AudioContext clock.

```typescript
// AudioEngine handles time-scheduled events:
class AudioEngine {
  scheduleNote(note: ScheduledNote): void;
  // Internally:
  //   1. At note.time, set params on the voice's synth
  //   2. At note.time, trigger the voice's envelope
  //   3. Schedule gate-off for the next step's time (or next gate-on)
  // Uses setTimeout with (note.time - ctx.currentTime) * 1000 offset,
  // fine-tuned against AudioContext.currentTime on firing.
}

// SynthEngine stays immediate-only (no time parameter):
interface SynthEngine {
  setParams(params: SynthParamValues): void;
  setModel(model: number): void;
  render(output: Float32Array): void;
  trigger(): void;              // NEW: restart envelope/exciter
  setGateOpen(open: boolean): void;  // NEW: for sustained note models
}
```

**Why `setTimeout` instead of `AudioParam` scheduling for everything?** The Web Audio `AudioParam.setValueAtTime()` works for continuous parameters (filter cutoff, gain), but `trigger()` is a discrete event that can't be expressed as an AudioParam transition. So the scheduling strategy is:

- **Continuous params** (timbre → filter cutoff, morph → filter Q): use `AudioParam.setValueAtTime(value, note.time)` for sample-accurate timing.
- **Discrete events** (trigger, gate-off): use `setTimeout` with compensation. The 100ms lookahead means the setTimeout fires ~100ms before the audio time, and the callback checks `AudioContext.currentTime` to fine-tune. This gives ~1-2ms jitter on discrete events, which is inaudible for trigger/gate operations.

`trigger()` restarts the sound — for percussive models (kick, snare, hat) this is the attack. For tonal models (VA, FM, chords), `trigger()` restarts the envelope and `setGateOpen(false)` releases it.

**Accent execution:** When `ScheduledNote.accent` is true, the audio layer applies a velocity boost. For the Phase 2 Web Audio synth, accent maps to a +6dB gain boost on the voice's gain node for that note (applied at `note.time`, reverted at `note.gateOffTime`). This is the simplest musically meaningful mapping — accented steps are louder. For the future Plaits WASM engine, accent can additionally drive the Plaits `trigger` level (Plaits distinguishes between soft and hard triggers), but the +6dB gain boost is the baseline contract that all engines must honor.

**Gate duration:** Computed by the scheduler and delivered as `gateOffTime` on `ScheduledNote` (see Scheduler interface section). A gate lasts until the next step's time. If the next step is also gated, the new trigger cuts the old gate naturally. `AudioEngine.scheduleNote()` schedules both the trigger at `note.time` and the gate-off at `note.gateOffTime`. This gives natural legato behavior for tonal patches and doesn't affect percussive models (which are self-decaying).

For Phase 2 with the Web Audio synth, `trigger()` maps to restarting the oscillator envelope. For the future Plaits WASM engine, it maps to the Plaits trigger input which naturally excites all models.

### Note resolution (parameter merge)

The scheduler resolves the full parameter bundle before emitting. The audio layer receives exactly what to play — no merging logic downstream.

Merge order:
1. Start with voice base `params` (from Session snapshot)
2. Apply step `params` overrides (parameter locks)
3. Apply human-held overrides (from arbitrator)

```typescript
function resolveNoteParams(
  voice: Voice,
  step: Step,
  heldParams: Partial<SynthParamValues>
): SynthParamValues {
  return {
    ...voice.params,
    ...step.params,
    ...heldParams,
  } as SynthParamValues;
}
```

### Arbitrator extension

The existing arbitrator is extended to store held parameter values, not just timestamps:

```typescript
// New method on Arbitrator
getHeldParams(trackId: string): Partial<SynthParamValues>
```

Returns current values of any params the human is actively controlling (within cooldown window) for that voice. Called by the scheduler during note resolution.

Requires updating `humanTouched(param, value)` to store both timestamp and value.

### BPM changes mid-play

When the scheduler detects BPM has changed (current snapshot vs previous), it reanchors without stopping. The reanchor is based on the **actual playback position** (derived from `AudioContext.currentTime`), not the lookahead cursor:

```
// Compute current playback position from real audio time (not from cursor, which runs ahead)
oldStepDuration = 60 / (oldBpm * 4)    // seconds per 16th note
playbackStep = (currentAudioTime - startTime) / oldStepDuration
playbackTick = playbackStep * 12        // convert to ticks

// Reanchor: recompute startTime so the new tempo maps to the same playback position
newTickDuration = 60 / (newBpm * 4) / 12
newStartTime = currentAudioTime - (playbackTick * newTickDuration)

// Reset cursor to match current playback position (not ahead of it)
// The next tick loop iteration will re-advance the cursor with lookahead
cursor = Math.floor(playbackTick)
```

This avoids the forward-shift that would occur if the cursor (which runs ahead by up to 100ms of lookahead) were used for reanchoring. Takes effect on the next tick iteration.

### Transport control

The scheduler is **controlled by React**, not self-watching. The App component observes `transport.playing` and explicitly calls `scheduler.start()` / `scheduler.stop()`:

```typescript
// In App.tsx (or a useScheduler hook):
useEffect(() => {
  if (session.transport.playing) {
    scheduler.start();
  } else {
    scheduler.stop();
  }
}, [session.transport.playing]);
```

This avoids the closed-loop problem: if `stop()` clears the tick interval, there's no internal loop to observe `playing` becoming `true` again. Instead, React owns the lifecycle. The scheduler's `start()` creates the tick interval; `stop()` clears it. The scheduler never reads `transport.playing` internally — it just runs when told to and stops when told to.

The tick loop still reads other session state via `getSession()` on each iteration (patterns, params, BPM, swing), but transport start/stop is externally driven.

### Integration rules

- **Playback is not undoable.** The sequencer playing notes is playback, not an action. Pattern *edits* (adding steps, changing parameter locks) are undoable.
- **AI moves during playback.** The AI can `move` voice parameters while the sequencer runs. Moves change the base values that non-locked steps inherit.
- **Human overrides parameter locks.** If the human is dragging a parameter, their value overrides the parameter lock on every triggered note for that voice until they release.

---

## Sequencer UI

### Step grid

The primary sequencer interface is a horizontal row of 16 step cells per voice. Each cell represents one 16th note.

- **Active step** (gate on): filled/lit cell
- **Accent**: brighter fill or ring
- **Parameter-locked step**: small indicator dot or colour shift
- **Current playback position**: highlighted cell (follows `globalStep % pattern.length`)
- **Inactive steps** (beyond `length` in variable-length patterns): dimmed/greyed

**Interactions:**
- Click a step to toggle gate on/off
- Hold a step + move XY pad to set parameter lock for that step (Elektron "hold step + tweak knob" paradigm)
- Right-click or long-press for step detail (pitch, accent, clear lock)

### Pattern controls

Per-voice controls adjacent to the step grid:
- Pattern length selector (1-64, default 16)
- Page indicator for patterns >16 steps (page 1/2/3/4, click to navigate)
- Clear pattern button
- Copy/paste pattern (between voices or as AI-addressable action)

### Voice selector

4 voice slots displayed as tabs or a row of labelled buttons. Each shows:
- Voice name/number
- Current model icon or label
- Mute/solo indicators
- Agency badge (OFF/SUGGEST/PLAY)

Clicking a voice tab switches `activeTrackId` and updates both the XY parameter space and the step grid to show that voice.

### Transport bar

A persistent bar (top or bottom of screen) showing:
- Play/stop button
- BPM display (editable, click to type or drag to change)
- Swing knob or slider
- Global position indicator (bar:step)
- Record button (for audio export)

### Layout

The existing Phase 1 layout is a two-column grid: parameter space + controls on the left, chat panel on the right. Phase 2 adds the step grid and transport. Proposed layout:

```
+--------------------------------------------------+----------+
| Transport bar                                     |          |
+--------------------------------------------------+ Chat     |
| Voice tabs  [1] [2] [3] [4]    | Model | Undo   | Panel    |
+----------------------------------+-------+--------+          |
| Parameter Space (XY pad)                          | API key  |
|                                                   | Leash    |
|                                                   | Agency   |
+---------------------------------------------------+          |
| Step grid  [1][2][3]...[16]  | Pattern controls  |          |
+---------------------------------------------------+          |
| Visualiser                   | Pitch | Harmonics |          |
+---------------------------------------------------+----------+
```

The step grid sits between the parameter space and the visualiser. Voice tabs sit above the parameter space. Transport bar is at the very top.

---

## AI Integration with Sequencer

### Extended action types

The `sketch` action type (defined in the protocol but unused in Phase 1) becomes the primary way the AI writes patterns. The `AISketchAction`, `PatternSketch`, and `StepSketch` types are defined in the Data Model section above.

Sketches go into the `pending` queue as `SketchPendingAction` entries. The human commits or dismisses. Committing applies the pattern and pushes a `PatternSnapshot` for undo. This extends the existing pending flow with pattern-specific commit logic.

### AI prompt changes

The system prompt is extended to include:
- Current patterns for all voices (compressed: step indices with gates, locked params)
- Transport state (bpm, swing, playing)
- The `sketch` action format with examples

Example prompt state compression:

```json
{
  "voices": [
    {
      "id": "v0",
      "model": "analog_bass_drum",
      "params": { "timbre": 0.45, "morph": 0.3, "note": 0.3, "harmonics": 0.5 },
      "agency": "PLAY",
      "pattern": {
        "length": 16,
        "active_steps": [0, 4, 8, 12],
        "accents": [0, 8],
        "locks": { "5": { "timbre": 0.8 } }
      }
    }
  ],
  "transport": { "bpm": 120, "swing": 0.0 },
  "leash": 0.6
}
```

Pattern compression: only list active step indices, accents, and non-empty parameter locks. A 16-step kick pattern compresses to a few numbers.

### AI sequencer operations

The AI can:
- **Write a new pattern**: `sketch` with full step data for a voice
- **Modify existing pattern**: `sketch` with sparse `StepSketch` (only changed steps)
- **Suggest a variation**: `sketch` goes to pending queue, human auditions and commits/dismisses
- **Change pattern length**: `sketch` with `length` field
- **Combine with moves**: A single AI response can `sketch` a pattern AND `move` parameters AND `say` something

Examples of natural language → AI actions:
- "Give me a four-on-the-floor kick" → `sketch` voice 0 with gates on steps 0,4,8,12
- "Make the hi-hat busier" → `sketch` voice 3 with more gates
- "Add syncopation to the bass" → `sketch` voice 1 with off-beat gates
- "Give me a variation" → `sketch` the active voice with modified pattern based on current

### Pending pattern display

When the AI proposes a pattern via `sketch`:
- Ghost steps appear on the step grid (dimmed/outlined, not filled)
- The `PendingOverlay` shows the pattern description and commit/dismiss buttons
- Optionally: an "audition" button that temporarily plays the proposed pattern

---

## Multi-Voice Audio Graph

Phase 1 has a single synth instance connected to the AudioContext destination. Phase 2 creates 4 synth instances routed through a mixer:

```
Voice 0 synth → GainNode (mute/volume) ─┐
Voice 1 synth → GainNode (mute/volume) ─┤
Voice 2 synth → GainNode (mute/volume) ─┼→ MixerGainNode → AnalyserNode → destination
Voice 3 synth → GainNode (mute/volume) ─┘                              → MediaStreamDestination (for export)
```

Each voice gets its own `WebAudioSynth` instance and a `GainNode` for mute control. `getAudibleTracks()` determines which gain nodes are set to 0 vs 1. The mixer feeds both the speaker output and a `MediaStreamAudioDestinationNode` for recording.

The `AudioEngine` is extended to manage N synth instances and expose both immediate and time-scheduled APIs:

```typescript
class AudioEngine {
  // Immediate (for UI-driven param changes, existing Phase 1 usage):
  setVoiceParams(trackId: string, params: SynthParamValues): void;
  setVoiceModel(trackId: string, model: number): void;
  muteVoice(trackId: string, muted: boolean): void;

  // Time-scheduled (for sequencer — bridges ScheduledNote to SynthEngine):
  scheduleNote(note: ScheduledNote): void;  // handles both note-on and gate-off timing

  // Existing:
  getAnalyser(): AnalyserNode | null;
  getMediaStreamDestination(): MediaStreamAudioDestinationNode | null;  // new
  getCurrentTime(): number;             // exposes AudioContext.currentTime
}
```

`scheduleNote` is the entry point for the scheduler's `onNote` callback. It handles all time-based scheduling internally (AudioParam for continuous params, setTimeout+compensation for trigger/gate events).

---

## Audio Export

Real-time bounce via `MediaRecorder` API.

```typescript
class AudioExporter {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  start(destination: MediaStreamAudioDestinationNode): void {
    const stream = destination.stream;
    this.recorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus'  // fallback to audio/webm
    });
    this.chunks = [];
    this.recorder.ondataavailable = (e) => this.chunks.push(e.data);
    this.recorder.start();
  }

  async stop(): Promise<Blob> {
    return new Promise((resolve) => {
      this.recorder!.onstop = () => {
        resolve(new Blob(this.chunks, { type: this.recorder!.mimeType }));
      };
      this.recorder!.stop();
    });
  }
}
```

`stop()` returns a `Promise<Blob>` because `MediaRecorder.stop()` is asynchronous — the final `dataavailable` event fires after `stop()` is called.

UI: a record button in the transport bar. Red when recording. Click stop → browser download dialog with the audio file.

---

## Undo Changes

Phase 2 extends the undo system to cover pattern edits. The `Snapshot` type is redesigned as a discriminated union (see Data Model section above).

**Undoable actions:**
- Step toggle (gate on/off)
- Step accent toggle
- Step pitch change
- Parameter lock set/clear
- Pattern length change
- Pattern clear
- AI `sketch` commit
- AI `move` (existing)
- AI `suggest` commit (existing)

**Not undoable:**
- Sequencer playback (playing notes)
- Transport play/stop/BPM/swing changes
- Voice mute/solo toggles
- Audio export start/stop

**Snapshot semantics:**
- `ParamSnapshot`: retains Phase 1 behavior — checks current value against `aiTargetValues` before reverting (human may have moved the param since the AI did).
- `PatternSnapshot`: restores previous step data unconditionally. Pattern edits are always reversible since there's no ambiguity about "who changed this step."
- Both types are sparse — only changed params/steps are stored.

Pattern edits from "hold step + tweak" gestures are grouped: holding one step and tweaking multiple parameters produces one undo entry, not one per parameter.

---

## Build Order

The implementation follows Approach C (data model first, layered build):

1. **Data model** — Extend `types.ts` with Step, Pattern, Transport. Extend Voice and Session. Update `session.ts` factories.
2. **Sequencer engine** — Scheduler class, note resolution, `getAudibleTracks` helper. Unit tests against the data model (no audio, no UI).
3. **Transport UI** — Play/stop, BPM, swing controls. Wire scheduler to audio engine.
4. **Step grid UI** — Step cells, gate toggle, playback position highlight.
5. **Parameter locks UI** — Hold-step-and-tweak gesture, lock indicators on grid.
6. **Multi-voice** — 4 voice slots, voice tabs, per-voice patterns and parameter spaces.
7. **AI sequencer integration** — Extend system prompt, `sketch` action handling, pattern compression, pending pattern display.
8. **Audio export** — `MediaRecorder` integration, record button in transport.
9. **Polish** — Pattern copy/paste, pattern length UI, clear pattern, voice mute/solo.

Each step produces testable, working software. Step 3 gives you a playing sequencer. Step 6 gives you 4 voices. Step 7 gives you AI-composed patterns.

---

## Migration from Phase 1

Phase 1's single-voice `Session` becomes a 4-voice session. The migration:

**Session state:**
- `session.voice` → `session.tracks[0]` (existing voice becomes voice 0)
- Add voices 1-3 with default patterns and different default models:
  - Voice 0: model 13 (analog bass drum) — kick
  - Voice 1: model 0 (virtual analog) — bass
  - Voice 2: model 2 (FM) — lead
  - Voice 3: model 4 (harmonic/additive) — pad
- Add `activeTrackId: voices[0].id`
- Add `transport: { playing: false, bpm: 120, swing: 0 }`
- Each voice gets `pattern: createDefaultPattern(16)`, `muted: false`, `solo: false`
- `recentHumanActions` retained, extended with `trackId` per action

**Undo stack:**
- Phase 1 `Snapshot` → Phase 2 `ParamSnapshot` with `kind: 'param'` discriminant added.
- Existing snapshots gain `trackId` pointing to voice 0 (the original single voice).
- `applyUndo()` is rewritten to switch on `snapshot.kind` and look up the target voice by `trackId`.
- The undo stack is cleared on Phase 2 upgrade (simpler than migrating old snapshots — the user is updating to a new version, not mid-session).

**PendingAction:**
- Phase 1 `PendingAction` → Phase 2 `ParamPendingAction` with `kind` discriminant.
- Pending actions already have `trackId` — no structural change needed beyond adding `kind`.

**SynthEngine interface:**
- Extended with `trigger()` and `setGateOpen()` methods.
- `WebAudioSynth` implements these (restart oscillator envelope / release).
- Phase 2 creates 4 synth instances instead of 1.
- Phase 2.5 swaps `WebAudioSynth` for `PlaitsSynth` behind the same interface.

**AISketchAction:**
- Phase 1's generic `AISketchAction` (with `content: unknown`) is replaced by the concrete pattern-focused type. The response parser's `isValidAction` is updated to validate the new shape.
