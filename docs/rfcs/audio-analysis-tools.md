# RFC: Audio Rendering and Analysis Tools

Status: **Implemented.** All 6 tools shipped (render, listen, spectral, dynamics, rhythm, masking/diff). Composable primitives with confidence signals. Compare mode operational.

Related documents:
- AI Contract
- AI Musical Environment
- AI Capability Doctrine
- AI Interface Design Principles
- Canonical Musical Model

---

## 1. Purpose

Gluon's AI currently evaluates its own edits by sending rendered audio to a multimodal model via the `listen` tool. This produces useful perceptual feedback but has limitations: model perception is inconsistent across calls, vague on quantitative questions, and expensive per invocation.

This RFC introduces a complementary set of **deterministic audio analysis tools** that the AI can use alongside `listen`. These tools extract structured musical features from rendered audio — spectral characteristics, dynamics, rhythmic properties — giving the AI precise, repeatable measurements to reason with.

The core principle:

**Give the AI both measurement and perception as separate tools. Trust it to choose the right one for the question it's asking.**

The goal is not to replace perceptual listening. It is to give the AI cheap, precise instruments that anchor its reasoning when precision matters, while preserving `listen` for holistic perceptual judgement.

---

## 2. Design Posture

### 2.1 Tools, not a pipeline

Analysis capabilities are exposed as **separate, named tools** in the AI's action space. They sit alongside `listen` in the inspect-and-collaborate tool family. The AI chooses which tools to call and in what combination, based on what it needs to know.

This follows the capability doctrine: constrain at the product boundary, empower aggressively inside it. The AI should spend its reasoning on musical questions — "did that actually get darker?" — not on protocol mechanics.

### 2.2 Explicit rendering

The AI controls **what** gets rendered. A dedicated `render` tool captures an audio snapshot with explicit scope — a single track, a set of tracks, or the full mix. Analysis and listening tools then operate on that snapshot.

Rendering is separated from analysis because:

- Most edits target individual tracks. Analysing the full mix after changing one parameter wastes signal in noise.
- Multiple tools should evaluate the same audio. Render once, analyse many ways.
- The AI should decide what to listen to, not the runtime.

### 2.3 Composable primitives

Each tool does one thing. The AI composes them freely:

- `render` then `spectral` — measure brightness after a timbre change
- `render` then `listen` — get a perceptual check on a groove
- `render` then `spectral` then `listen` — measure first, get a second opinion
- `diff` — compare before and after an edit
- `render` then `dynamics` then `render` (different scope) then `dynamics` — compare levels across tracks

No hidden orchestration. No bundled pipelines. Tools on a workbench.

### 2.4 Confidence over false precision

Audio analysis on short renders with overlapping harmonics can produce misleading numbers. Every analysis result includes a confidence signal so the AI knows when to trust the measurement and when to discount it.

---

## 3. Tool Set

Six tools. One for rendering, one for perceptual listening (existing), four for deterministic analysis.

---

### 3.1 `render`

Capture an audio snapshot with explicit scope.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `scope` | string or string[] | no | Track ID (`"t0"`), array of track IDs (`["t0", "t2"]`), or omit for full mix |
| `bars` | number | no | Duration to render. Default: one full pattern cycle (derived from the primary region's duration). Explicit value overrides. |

Returns:

```json
{
  "snapshotId": "snapshot_42",
  "scope": ["t0", "t1"],
  "bars": 2
}
```

The response includes the scope and duration so the AI can confirm what was captured without relying on memory of the call it just made. This prevents subtle errors when the AI is composing multiple render/analyse sequences in a single turn.

Snapshots are ephemeral. They persist for the duration of the current tool loop (so the AI can render in one round and analyse in the next) and are discarded when the tool loop ends.

**Scope options:**

- **Single track** (`"t1"`) — isolate one sound. Use for timbre evaluation, rhythmic density, pitch analysis.
- **Track group** (`["t0", "t2"]`) — hear how specific tracks interact. Use for checking kick/bass relationship, percussion balance, melodic interplay.
- **Full mix** (omit `scope`) — the whole project. Use for overall balance, dynamics, energy.

The AI should choose the narrowest scope that answers its question.

**Render duration guidance:**

Different analysis tools benefit from different render lengths. The default of one pattern cycle is usually right. These are recommendations for when an explicit override makes sense:

| Tool | Recommended bars | Why |
|------|-----------------|-----|
| `spectral` | 1–2 | Timbral character is usually stable within a bar or two |
| `dynamics` | 2–4 | Longer renders give more reliable loudness and dynamic range measurements |
| `rhythm` | 2–4 | Tempo and swing estimation improves with more material |
| `listen` | 2–8 | Perceptual evaluation benefits from hearing phrases develop |
| `diff` | default | Should match pattern cycle for consistent comparison |

For ambient or slowly evolving material, longer renders (4–8 bars) give both measurement and perception more to work with.

---

### 3.2 `listen`

Send a rendered snapshot to the multimodal model for perceptual evaluation. **Existing tool, extended.**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `snapshotId` | string | no | Snapshot from `render`. If provided, evaluates that snapshot. |
| `scope` | string or string[] | no | Convenience shortcut: renders internally with this scope, then evaluates. Ignored if `snapshotId` is provided. |
| `bars` | number | no | Duration for convenience render. Only used with `scope`. |
| `question` | string | yes | What to evaluate |

Returns: text critique from the multimodal model, plus `snapshotId` of the (provided or internally rendered) snapshot.

**Two usage modes:**

Composed (explicit render):
```
render({ scope: "t1" })                    → { snapshotId: "snapshot_1" }
listen({ snapshotId: "snapshot_1", question: "Does the bass groove feel right?" })
```

Convenience (inline render):
```
listen({ scope: "t1", question: "Does the bass groove feel right?" })
```

The convenience form exists because "just listen to what I did" is the most common case and shouldn't cost an extra tool round-trip. The composed form is for when the AI wants to run multiple analysis tools on the same render.

`listen` is the only tool that involves a model call. It is the most expensive inspection tool and the most useful for holistic, taste-level questions: "does this groove feel right?", "is there enough contrast between the two sections?", "does the bass sit well under the lead?"

The multimodal model evaluates the audio **without seeing the structured analysis results**. This preserves the independence of perceptual and measurement-based evaluation. The AI agent reconciles the two perspectives in its own reasoning.

---

### 3.3 `spectral`

Measure timbral characteristics of a rendered snapshot.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `snapshotId` | string | yes | Snapshot from `render` |

Returns:

```json
{
  "spectral_centroid": 0.42,
  "spectral_rolloff": 0.38,
  "spectral_flatness": 0.15,
  "spectral_bandwidth": 0.31,
  "fundamental_estimate": 146.8,
  "pitch_stability": 0.92,
  "signal_type": "tonal",
  "confidence": 0.91
}
```

Spectral features normalised 0.0–1.0. Pitch values in Hz.

Interpretation:

- **centroid** — perceived brightness. Low values = dark, warm. High values = bright, harsh.
- **rolloff** — high-frequency energy. Indicates how much of the spectrum extends into the upper range.
- **flatness** — noise vs tonal character. Low = tonal, pitched. High = noisy, unpitched.
- **bandwidth** — harmonic spread. Narrow = focused, pure. Wide = complex, rich.
- **fundamental_estimate** — estimated fundamental frequency in Hz. Most meaningful for tonal signals. For noise/transient signals, this value is unreliable (reflected in pitch_stability).
- **pitch_stability** — how consistent the detected pitch is across the render. High = stable pitch, low = drifting, noisy, or unpitched. Values below 0.3 indicate the fundamental_estimate should be disregarded.
- **signal_type** — classification hint: `"tonal"` (clear pitch), `"transient"` (percussive, short), `"noise"` (unpitched, broadband), or `"mixed"` (combination). Helps the AI interpret the other values — spectral centroid means different things for a bass note vs a hi-hat.

**When confidence drops:**

- Very short renders (< 1 bar)
- Noise-heavy percussion (flatness and centroid become less meaningful)
- Near-silent audio

**Good for:** verifying timbre changes ("did it actually get darker?"), verifying pitch edits ("did the note land where I intended?"), comparing tonal character across tracks, checking that a brightness adjustment moved in the intended direction.

---

### 3.4 `dynamics`

Measure loudness and dynamic range.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `snapshotId` | string | yes | Snapshot from `render` |

Returns:

```json
{
  "lufs": -14.2,
  "rms": -18.5,
  "peak": -3.1,
  "crest_factor": 15.4,
  "dynamic_range": 12.3,
  "confidence": 0.88
}
```

Values in dB (LUFS, RMS, peak) or ratio (crest factor, dynamic range).

Interpretation:

- **lufs** — integrated loudness (EBU R128). The best single measure of perceived loudness.
- **rms** — average signal level.
- **peak** — maximum sample level. Close to 0 dB means low headroom.
- **crest_factor** — peak-to-RMS ratio. High = transient, punchy. Low = compressed, sustained.
- **dynamic_range** — difference between loud and quiet passages.

**When confidence drops:**

- Very quiet or near-silent renders
- Sub-1-bar renders

**Good for:** checking balance between tracks, detecting over-compression, verifying that a level change had the intended effect, ensuring headroom.

---

### 3.5 `rhythm`

Measure rhythmic properties.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `snapshotId` | string | yes | Snapshot from `render` |

Returns:

```json
{
  "tempo_estimate": 140,
  "onset_count": 12,
  "onset_times": [0.0, 0.214, 0.428],
  "rhythmic_density": 0.75,
  "swing_estimate": 0.03,
  "confidence": 0.85
}
```

Interpretation:

- **tempo_estimate** — detected BPM.
- **onset_count** — number of detected events.
- **onset_times** — event positions in seconds.
- **rhythmic_density** — proportion of possible slots filled. 0.0 = empty, 1.0 = every slot.
- **swing_estimate** — detected swing amount. 0.0 = straight, higher = more swing.

**When confidence drops:**

- Sustained or ambient textures with no clear onsets
- Pads and drones
- Very short renders where tempo estimation is unreliable

**Good for:** verifying pattern density after thinning or thickening a groove, confirming swing adjustments, checking that a rhythmic edit produced the intended feel, comparing onset patterns between tracks.

---

### 3.6 `diff`

Compare the current snapshot against the pre-edit state.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `snapshotId` | string | yes | Snapshot from `render` (the "after") |

The "before" state is reconstructed lazily when `diff` is called (see section 7). The AI does not need to plan ahead or explicitly capture a baseline.

Returns:

```json
{
  "before": {
    "spectral": { "spectral_centroid": 0.58, "spectral_rolloff": 0.52, "spectral_flatness": 0.12, "spectral_bandwidth": 0.35, "fundamental_estimate": 146.8, "pitch_stability": 0.94, "signal_type": "tonal" },
    "dynamics": { "lufs": -12.8, "rms": -16.2, "peak": -2.4, "crest_factor": 13.8, "dynamic_range": 10.1 },
    "rhythm": { "onset_count": 16, "rhythmic_density": 1.0, "swing_estimate": 0.02 }
  },
  "after": {
    "spectral": { "spectral_centroid": 0.42, "spectral_rolloff": 0.38, "spectral_flatness": 0.15, "spectral_bandwidth": 0.31, "fundamental_estimate": 146.8, "pitch_stability": 0.91, "signal_type": "tonal" },
    "dynamics": { "lufs": -14.2, "rms": -18.5, "peak": -3.1, "crest_factor": 15.4, "dynamic_range": 12.3 },
    "rhythm": { "onset_count": 12, "rhythmic_density": 0.75, "swing_estimate": 0.03 }
  },
  "delta": {
    "spectral_centroid_change": -0.16,
    "loudness_change": -1.4,
    "density_change": -0.25,
    "swing_change": 0.01,
    "fundamental_change": 0.0
  },
  "confidence": 0.89
}
```

Returning both full feature sets and the computed deltas allows the AI to reason about what specifically changed, not just that something changed.

**Good for:** verifying that edits produced the intended effect, detecting unintended side effects, supporting the collaboration model's refinement phase where checking for regressions matters.

---

## 4. Render Scope Guidance

The AI should choose the **narrowest useful scope** for the question it's asking.

| Question | Scope |
|----------|-------|
| "Did the bass get darker?" | Single track: `"t1"` |
| "How does the kick sit with the bass?" | Track group: `["t0", "t1"]` |
| "Is the percussion too busy?" | Track group: `["t2", "t3"]` |
| "How's the overall balance?" | Full mix: omit scope |
| "Does the mix have enough headroom?" | Full mix: omit scope |

Per-track rendering is the common case. Full mix is for balance, dynamics, and holistic evaluation.

---

## 5. Tool Selection Guidance

The AI should choose tools based on what kind of answer it needs.

| Need | Tool |
|------|------|
| "Did the brightness actually change?" | `spectral` |
| "Did the pitch land where I intended?" | `spectral` (check `fundamental_estimate`) |
| "Is this track too loud?" | `dynamics` |
| "Did the pattern get thinner?" | `rhythm` |
| "What exactly changed?" | `diff` |
| "Does this groove feel right?" | `listen` |
| "Is there enough tension in the build?" | `listen` |
| "Did my edit work, and how does it sound?" | `diff` + `listen` |

**`listen` is expensive.** It requires a multimodal model call. The AI should prefer measurement tools when the question is quantitative and use `listen` when the question is perceptual, holistic, or taste-based.

**Measurement tools are cheap.** The AI should use them freely — after any non-trivial edit, a quick `spectral` or `rhythm` check costs almost nothing and catches mistakes early.

**Combining tools is encouraged.** Measure first, then listen. The measurement gives the AI a concrete anchor; the perceptual evaluation catches what numbers miss.

---

## 6. Worked Examples

### Example 1: "Make the bass darker and less busy"

The AI reduces brightness and thins the pattern, then verifies.

```
move({ trackId: "t1", param: "brightness", target: { absolute: 0.20 } })
sketch({ trackId: "t1", description: "Thinner bass pattern", events: [...] })
```

Actions applied. The AI renders and checks:

```
render({ scope: "t1" })                    → { snapshotId: "snapshot_1", scope: "t1", bars: 2 }
diff({ snapshotId: "snapshot_1" })
```

Diff result:

```json
{
  "before": {
    "spectral": { "spectral_centroid": 0.58, "signal_type": "tonal" },
    "rhythm": { "rhythmic_density": 1.0, "onset_count": 16 }
  },
  "after": {
    "spectral": { "spectral_centroid": 0.34, "signal_type": "tonal" },
    "rhythm": { "rhythmic_density": 0.5, "onset_count": 8 }
  },
  "delta": {
    "spectral_centroid_change": -0.24,
    "density_change": -0.5
  },
  "confidence": 0.92
}
```

AI reasoning: centroid dropped significantly, density halved. Both changes align with the goal. No need for a `listen` call — the question was quantitative and the diff answers it.

AI responds: "Pulled the brightness down and thinned the pattern to half density. Should feel darker and more spacious."

---

### Example 2: "Does the kick sit well with the bass?"

This is a relationship and feel question — measurement alone won't answer it.

```
render({ scope: ["t0", "t1"] })             → { snapshotId: "snapshot_2", scope: ["t0", "t1"], bars: 2 }
dynamics({ snapshotId: "snapshot_2" })
listen({ snapshotId: "snapshot_2", question: "Do the kick and bass compete or complement each other?" })
```

Dynamics result:

```json
{
  "lufs": -11.8,
  "peak": -1.2,
  "crest_factor": 10.6,
  "confidence": 0.87
}
```

Listen result:

"The kick and bass overlap heavily in the low-mids. The kick's punch is masked by the bass sustain. The bass could use a shorter decay or the kick could use more attack definition."

AI reasoning: dynamics confirm the combined level is high and crest factor is low (not much transient distinction). The perceptual critique identifies the specific problem — masking in the low-mids. The AI can now make a targeted edit.

---

### Example 3: Quick verification after a small parameter tweak

The AI just nudged texture on t2. A lightweight check is enough.

```
render({ scope: "t2" })                     → { snapshotId: "snapshot_3", scope: "t2", bars: 2 }
spectral({ snapshotId: "snapshot_3" })
```

Spectral result:

```json
{
  "spectral_centroid": 0.45,
  "spectral_flatness": 0.28,
  "spectral_bandwidth": 0.52,
  "fundamental_estimate": 220.0,
  "pitch_stability": 0.88,
  "signal_type": "tonal",
  "confidence": 0.90
}
```

AI sees bandwidth increased and flatness went up — the texture change added complexity as intended. No further tools needed.

---

### Example 4: Quick perceptual check (convenience form)

The AI just made a groove edit and wants a quick perceptual sanity check without composing tools.

```
listen({ scope: "t0", question: "Does the kick pattern feel tight and punchy?" })
```

The runtime renders t0 internally, sends to the multimodal model, returns the critique and the snapshot ID. If the AI later wants to run `spectral` on the same audio, it can use the returned `snapshotId`.

---

## 7. Lazy Before-Snapshots

The `diff` tool compares a post-edit snapshot against the pre-edit state. The before-state is **reconstructed lazily** — only when `diff` is actually called, not preemptively before every action group.

Implementation:

- **On action group dispatch:** The runtime records the pre-edit session state (already captured by the undo system as part of action group snapshots). No audio is rendered at this point.
- **On `diff` call:** The runtime takes the scope and duration from the provided post-edit snapshot, reconstructs the pre-edit audio by rendering from the undo snapshot's session state, runs all analysis tools on both, and returns the comparison.
- **Scope matching:** The runtime renders the before-snapshot with the same scope and duration as the after-snapshot. If the after-snapshot captured track t1 for 2 bars, the before-snapshot renders t1 for 2 bars from the pre-edit state.
- **Lifecycle:** Before-state references (session snapshots, not audio) persist for the duration of the current tool loop. Reconstructed audio is discarded after the `diff` response is returned.

This design avoids the cost of pre-rendering every track before every action group. The undo system already captures the session state needed for reconstruction — `diff` simply uses it.

If the undo snapshot is unavailable (e.g., the action group predates the current tool loop), `diff` returns an error rather than fabricating a comparison.

---

## 8. Confidence Signals

Every analysis tool includes a `confidence` value (0.0–1.0) in its response.

Confidence reflects whether the measurement is meaningful for the signal being analysed. It is **not** a measure of audio quality.

Factors that reduce confidence:

- Very short renders (< 1 bar)
- Near-silent audio
- Signal characteristics that don't match the tool's assumptions (e.g., rhythm analysis on a drone, spectral analysis on silence)

The AI should treat low-confidence results (< 0.5) as unreliable and prefer `listen` for perceptual evaluation in those cases.

Confidence calculation is an implementation detail. The runtime may use signal-level heuristics (energy threshold, onset density for rhythm, spectral clarity for pitch-related metrics) or model-specific quality indicators.

---

## 9. Relationship to the Existing `listen` Tool

The current `listen` tool in the AI contract renders audio and sends it to the multimodal model. This RFC changes `listen` in two ways:

1. **It can accept a `snapshotId`** to evaluate a previously rendered snapshot (composed mode).
2. **It retains convenience rendering** via optional `scope`/`bars` parameters (inline mode).

The convenience form preserves the current one-call experience for the common case. The composed form enables render-once-analyse-many workflows.

The multimodal model used by `listen` does **not** receive the structured analysis results. It evaluates the audio blind. This preserves two genuinely independent evaluation channels:

- Measurement tools: precise, repeatable, cheap, narrow
- `listen`: holistic, perceptual, expensive, broad

The AI reconciles them. If the spectral measurement says brightness dropped but `listen` says the sound still feels bright, that's a signal worth reasoning about — maybe the perceived brightness comes from a resonant peak that the centroid doesn't capture.

---

## 10. Implementation

Analysis runs behind a stable tool interface. The implementation technology is intentionally unspecified.

The only requirement is that the runtime produces the structured outputs defined in this RFC when the AI calls the corresponding tools.

Possible implementations include:

- AudioWorklet-based analysis
- WASM DSP modules
- Native libraries called from the runtime
- Python prototypes during development

The tool interface is the contract. The implementation can change without affecting the AI's action vocabulary.

---

## 11. Future Extensions

Deferred capabilities that do not block the initial implementation:

**Harmonic analysis** — estimated key, pitch class distribution, dissonance, chord detection. Useful for melodic and harmonic reasoning beyond the basic fundamental estimation in `spectral`. Deferred because chord/key detection requires significantly more DSP complexity than fundamental tracking.

**Reference comparison** — compare a render against a user-supplied reference track. Useful for "make it sound more like this" workflows. Deferred because it introduces format handling, length matching, and level normalisation complexity that doesn't belong in v1.

**Source separation** — isolate components within a mix render. Useful when per-track rendering isn't sufficient (e.g., analysing reverb tails or bleed). Deferred until the need is proven.

**Groove analysis** — deeper rhythmic characterisation beyond onset times (swing profiles, microtiming patterns, feel classification). Deferred until basic rhythm analysis is validated in practice.

---

## 12. Acceptance Criteria

This RFC succeeds when:

1. The AI can render audio with explicit scope control (single track, track group, full mix), defaulting to pattern-cycle duration.
2. The AI can choose independently between measurement tools and perceptual listening based on the question it's asking.
3. Measurement tools produce structured, repeatable results with confidence signals and signal-type classification.
4. The `spectral` tool provides basic pitch estimation alongside timbral features, enabling the AI to verify note/pitch edits.
5. Version comparison (`diff`) works reliably with lazy before-snapshot reconstruction from undo state, requiring no advance planning from the AI.
6. `listen` supports both composed (snapshot reference) and convenience (inline render) modes.
7. The AI combines measurement and perception to produce better-grounded musical feedback than either alone.

---

## 13. Summary

Gluon's AI gains a workbench of audio inspection tools:

| Tool | Purpose | Cost |
|------|---------|------|
| `render` | Capture audio with explicit scope | Cheap |
| `listen` | Perceptual evaluation via multimodal model | Expensive (model call) |
| `spectral` | Timbral measurement + pitch estimation | Cheap |
| `dynamics` | Loudness and dynamic range | Cheap |
| `rhythm` | Rhythmic properties and onset detection | Cheap |
| `diff` | Before/after comparison (lazy reconstruction) | Cheap |

The AI decides what to render, what to measure, and when to listen. Each tool does one thing. The AI composes them.

`listen` remains the tool for holistic perceptual judgement. The measurement tools give the AI precise, cheap, repeatable anchors for quantitative questions. Together they make the AI's listening more grounded, more efficient, and more consistent.
