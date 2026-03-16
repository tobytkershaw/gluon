# Sampling Brief

## Why This Matters

Sampling and resampling are foundational to modern electronic music — not a niche feature. Hip-hop, jungle, garage, house, techno, ambient, IDM, and nearly every electronic genre relies on some combination of:

- Playing back recorded audio (one-shots, loops, textures)
- Manipulating that audio (pitch-shift, time-stretch, slice, reverse, granular)
- Resampling — capturing processed output and feeding it back as new material
- Building and navigating a library of sounds

Gluon currently has synthesis (Plaits), resonant processing (Rings), granular processing (Clouds), and modulation (Tides). All of these generate or transform sound from parameters. None of them start from recorded audio.

This is a significant gap. A musician who works primarily with samples — which is most electronic musicians — currently has no entry point into Gluon.

## Three Layers

Sampling in Gluon touches three layers, each independently valuable:

### Layer 1: Sampler source module

A new source type that plays back audio files. The minimum:

- Load a WAV/MP3/OGG file
- One-shot or looped playback
- Pitch control (transpose from root note)
- Amplitude envelope (at minimum: attack, decay)
- Start/end point selection (play a slice of a longer file)

This slots into the existing architecture as a new `SourceAdapter` alongside Plaits. A track with a sampler source has a processor chain, modulation, sends, and everything else — it's just the sound source that's different.

The canonical model already supports this:

```typescript
// Existing SourceAdapter pattern
interface SourceAdapter {
  id: string;               // 'sampler'
  controls: ControlSchema[];
  // ...
}
```

The `ControlSchema` for a sampler might include: `sample_id`, `root_note`, `start`, `end`, `loop_mode`, `attack`, `decay`, `pitch`, `playback_speed`.

### Layer 2: Sample library with AI-generated metadata

This is where Gluon differentiates. Every DAW has a sample browser. Gluon's should be AI-native.

**What the library stores per sample:**

```typescript
interface SampleMetadata {
  id: string;
  filePath: string;

  // Audio properties (auto-detected)
  duration: number;           // seconds
  sampleRate: number;
  channels: number;

  // Musical properties (AI-analyzed via Gemini)
  rootNote?: number;          // MIDI note, detected from pitch content
  key?: string;               // detected key/scale if tonal
  tempo?: number;             // BPM if rhythmic
  timeSignature?: string;     // if rhythmic

  // AI-generated descriptions
  character?: string;         // "dark, gritty, sub-heavy bass hit"
  category?: string;          // "drums/kick", "bass/one-shot", "texture/pad", "vocal/chop"
  tags?: string[];            // ["dark", "808", "sub", "trap"]

  // Structural analysis
  transients?: number[];      // positions of detected transients (for slicing)
  slices?: SampleSlice[];     // named regions within the sample
  loopPoints?: { start: number; end: number };

  // Provenance
  source?: 'imported' | 'resampled' | 'generated';
  resampledFrom?: string;     // if this was created by resampling, what was the source
}

interface SampleSlice {
  id: string;
  name: string;               // "kick", "snare", "hat-open"
  start: number;              // sample offset
  end: number;
  rootNote?: number;
}
```

**How metadata gets generated:**

When a sample is imported (or resampled), analysis happens in two tiers:

1. **CLI tool analysis** (on import, fast, deterministic): Use established audio analysis tools for the reliable, solved problems:
   - **Pitch/root note**: `aubio pitch`, `crepe` (ML-based, more accurate for polyphonic), or `essentia`
   - **Tempo/BPM**: `aubio tempo`, `essentia`'s `RhythmExtractor`
   - **Onset/transient detection**: `aubio onset`, `essentia`'s `OnsetDetection`
   - **Key detection**: `essentia`'s `KeyExtractor`
   - **Format/duration/sample rate**: `ffprobe` (already ubiquitous)
   - **Waveform stats**: `sox --stat` for RMS, peak, DC offset

   These are solved problems with reliable CLI tools. They're faster, cheaper, and more deterministic than sending audio to a model. The results are quantitative and trustworthy.

2. **Gemini analysis** (async, richer, qualitative): Listen to the sample and generate what CLI tools can't:
   - Character description: "dark, gritty, sub-heavy bass hit with a saturated low-end"
   - Category and tags: not just "drum" but "lo-fi hip-hop kick with vinyl texture"
   - Musical context: "sounds like it could be from a jungle or drum & bass context"
   - Content description for complex samples: "a filtered breakbeat with a heavy snare on 2 and 4"
   - Fit assessment: "this would work well with the pad you have on track 2"

The split is: **CLI tools for measurement, Gemini for judgment**. Root note detection is a measurement. "This sample sounds dark and would fit your track" is a judgment.

**Candidate CLI tools:**

| Tool | What it does | Install |
|------|-------------|---------|
| **aubio** | Pitch, tempo, onset, beat tracking. Fast, lightweight. | `brew install aubio` / `pip install aubio` |
| **essentia** | Comprehensive MIR library. Key, tempo, onset, pitch, spectral features. | `pip install essentia` |
| **crepe** | ML pitch detection. More accurate than autocorrelation for complex signals. | `pip install crepe` |
| **ffprobe** | Format, duration, sample rate, channels, codec. | Ships with ffmpeg |
| **sox** | Stats, format conversion, basic processing. | `brew install sox` |

For V1, `aubio` + `ffprobe` covers the basics (pitch, tempo, onsets, format). `essentia` is the upgrade path for key detection and richer spectral features.

The CLI analysis happens on import (instant, < 1 second for a typical sample). The Gemini analysis can happen in the background and enrich the metadata over time.

**How the AI uses the library:**

When the human says "add a kick drum", the AI can:
- Search the library by category and character
- Listen to candidates and pick the best match for the current project
- Suggest alternatives: "I found three kicks — a tight 808, a distorted acoustic, and a synthetic click. Which fits the vibe?"

When the AI is composing, it can reason about samples the same way it reasons about synth parameters — but grounded in what the samples actually sound like, not just their names.

### Layer 3: Advanced sample manipulation

Beyond basic playback, tools for transforming samples:

### The split: CLI tools do the work, Gemini makes the decisions

Sample manipulation is mostly deterministic operations. The AI needs the right tools (CLI commands, Web Audio APIs) and Gemini's judgment about *which* operations to apply and *how*.

**Slicing and chopping:**

| Operation | How (CLI/engine) | Gemini's role |
|-----------|-----------------|---------------|
| Auto-slice on transients | `aubio onset` → slice points | — (not needed) |
| Intelligent slicing | `aubio onset` → candidates | Label slices: "this is a kick, this is a snare, this is a ghost note" |
| Slice rearrangement | Reorder and sequence slices | Decide the arrangement: "make this half-time" or "rearrange as UK garage" |
| Map slices to sequence | Assign slices to step triggers | Choose which slices go where musically |

**Time and pitch:**

| Operation | How (CLI/engine) | Gemini's role |
|-----------|-----------------|---------------|
| Time-stretch | `rubberband` CLI or Web Audio `playbackRate` | Judge quality: did it artifact? Is it better to pitch-shift instead for this genre? |
| Pitch-shift | `rubberband` CLI or `soundstretch` | Judge context: "this loop is 140 BPM, your project is 170 — stretch or pitch up?" |
| Reverse | `sox reverse` or buffer manipulation | — (trivial operation, no judgment needed) |
| Trim | `sox trim` or start/end points | Content-aware: "trim the silence and the reverb tail" |

**Granular:**
- Clouds is already a granular processor. With a sampler source feeding into Clouds, you get granular sampling for free — the existing chain model handles this.
- A dedicated granular *source* that reads from a sample buffer with position/density/size controls would be different — more like a granular playback engine than a real-time processor. Future work.

**Resampling:**
- Capture the output of a track (or the master bus) as a new sample
- The offline render infrastructure already exists — `buildRenderSpec` + render worker
- Resampled audio goes into the library with `source: 'resampled'` and provenance tracking
- This is the creative feedback loop: synthesize → process → resample → chop → sequence → process → resample...

**Source separation** (ambitious, future):
- "Isolate the vocal from this sample" or "remove the kick and keep the rest"
- CLI tools exist (`demucs`, `htdemucs`) but quality varies
- Gemini's role: decide *what* to isolate ("the interesting part is the bass line in the second half") and evaluate *whether the result is usable*

**Key CLI tools for manipulation:**

| Tool | What it does |
|------|-------------|
| **rubberband** | High-quality time-stretch and pitch-shift. `rubberband -t 1.2 -p 3 in.wav out.wav` |
| **sox** | Swiss army knife: trim, reverse, fade, normalize, format conversion, effects |
| **ffmpeg** | Format conversion, basic processing, sample rate conversion |
| **demucs** | ML source separation (vocals, drums, bass, other) |

## How This Fits the Architecture

### Canonical model
A sampler is a `SourceAdapter` like Plaits. It has `ControlSchema` entries for its parameters. The AI interacts with it via the same `move` and `sketch` tools. A `NoteEvent` with `pitch: 60` means "play the sample at its root note." A `ParameterEvent` with `controlId: 'start'` means "change the playback start point."

### Processor chains
A sampler source feeds into the same chain as Plaits: sampler → Rings → Clouds → output. All existing processing works. Modulation from Tides works. Bus sends work.

### Sequencing
Sample playback is triggered by the same `NoteEvent` and `TriggerEvent` types. A drum machine is just a sampler source with multiple samples mapped to different pitches or trigger indices. The tracker, automation, and everything else works unchanged.

### AI contract
The AI needs new tools:
- **`import_sample`**: bring a file into the library
- **`analyze_sample`**: trigger Gemini analysis of a sample
- **`search_samples`**: query the library by character, category, tags
- **`slice_sample`**: auto-slice or AI-directed slicing
- **`resample`**: capture a track or bus output as a new sample

These follow the existing tool patterns — structured operations with undo.

## What About Lyria? (#6)

Lyria (Google's music generation model) is a different bet: AI *generates* audio from scratch. Sampling is about working with *existing* audio. They're complementary:

- Lyria generates a texture or loop → it goes into the sample library → you chop and manipulate it
- You import a sample → Lyria generates variations of it
- You resample your project → Lyria extends or completes it

Lyria is generative. Sampling is transformative. Both belong in a complete music tool, and they compose well. But sampling is more fundamental — it's been core to electronic music for 40 years. Lyria is additive capability on top.

## Resampling Deserves Special Attention

Resampling is the creative feedback loop that makes sampling more than just "play a file." It's how:

- A simple synth line becomes a chopped, rearranged rhythmic pattern
- A full mix gets bounced and used as a texture in a new context
- Accidents and glitches get captured and turned into intentional elements
- Multiple layers get consolidated into a single waveform for further manipulation

In Gluon's context, resampling is especially powerful because:

1. The offline render infrastructure already exists
2. The AI can resample its own work — synthesize something, listen to it, resample the good parts, build on them
3. It creates a natural iteration loop: generate → evaluate → capture → transform → generate...
4. It's the bridge between synthesis and sampling — you don't need external samples if you can resample your own output

## Analysis Pipeline Validation

### Approach

Use well-tagged open source sample libraries as ground truth. Strip the metadata, run our analysis pipeline, compare results against the known labels.

**Test libraries:**
- [VCSL (Versilian Community Sample Library)](https://github.com/sgossner/VCSL) — CC0, tagged with instrument, root note, articulation. Covers pitched instruments, percussion, and textures.
- [Freesound CC0 packs](https://freesound.org) — community-tagged samples with category and description metadata.
- [sfzinstruments](https://sfzinstruments.github.io/) — CC0 instruments with SFZ mappings (root note, key range, velocity layers all specified in the SFZ files).

### What to measure

| Property | Ground truth source | CLI tool to test | Gemini to test |
|----------|-------------------|-----------------|----------------|
| Root note | SFZ mapping / filename convention | `aubio pitch`, `crepe` | Pitch perception |
| Tempo/BPM | Known loop tempos | `aubio tempo` | Tempo perception |
| Key | Tagged key in metadata | `essentia KeyExtractor` | Key perception |
| Onsets | Manual annotation or known grid positions | `aubio onset` | — |
| Category | Library folder structure / tags | — | Category classification |
| Character | Human descriptions in library metadata | — | Character description |

### What this reveals

- **Where CLI tools are sufficient**: if `aubio pitch` nails root note on 95% of single-note samples, don't send those to Gemini
- **Where CLI tools fail**: polyphonic samples, noisy textures, strong harmonics that confuse pitch detection — these are the samples that need Gemini
- **Where Gemini adds unique value**: category, character, musical context — the qualitative layer that CLI tools can't provide
- **Regression baseline**: as the pipeline improves, re-run against the same stripped dataset and measure accuracy changes

### SFZ files as ground truth

SFZ instrument definitions are particularly valuable because they specify exact MIDI note mappings:

```
<region> sample=cello_C3.wav lokey=48 hikey=52 pitch_keycenter=48
```

`pitch_keycenter` is the ground truth root note. `lokey`/`hikey` define the range. This gives us thousands of labeled test cases for pitch detection without any manual annotation.

## Priority and Phasing

### Phase A: Basic sampler source
- WAV/MP3 playback as a new SourceAdapter
- Root note, start/end, pitch, basic envelope
- Manual sample loading (file picker)
- Works with existing chains, sequencing, AI tools
- **This is the minimum that unblocks sampling-based music in Gluon**

### Phase B: AI-powered sample library
- Library data model with metadata
- Auto-detection of root note, tempo, transients (local analysis)
- Gemini analysis for character, category, tags (async)
- AI search and suggestion tools
- **This is where Gluon differentiates from every other tool**

### Phase C: Resampling
- Capture track or bus output as a new sample
- Provenance tracking (resampled from what?)
- Resampled audio enters the library with full metadata
- AI can resample its own work as part of its creative workflow

### Phase D: Advanced manipulation
- Intelligent slicing (transient and AI-directed)
- Slice-to-sequence mapping
- Time-stretch and pitch-shift
- Granular source module
- Source separation (ambitious, evaluate feasibility)

### Phase E: Lyria integration (#6)
- AI-generated audio as sample source
- Variation generation from existing samples
- Extension/completion of partial recordings

## Open Questions

1. **Where do samples live?** In the project file (embedded)? In a shared library on disk? Both? Embedded is simpler but bloats project files. Shared library needs path management.

2. **Multi-sample instruments?** A "drum kit" is multiple samples mapped to different notes. Is this one sampler source with a sample map, or multiple sampler sources on the same track? The canonical model's one-source-per-track assumption may need revisiting.

3. **Streaming vs. loading?** Short one-shots can load into memory. Longer samples (ambient recordings, full loops) may need streaming from disk. Web Audio's `AudioBuffer` has memory limits.

4. **Sample rate conversion?** Samples may not match the project sample rate. Web Audio handles this internally for `AudioBufferSourceNode`, but quality varies.

5. **Legal/copyright?** If the AI is suggesting samples, does it need to know about licensing? Probably not for V1 — the human is responsible for what they import. But worth noting.

6. **Web platform constraints?** File system access in the browser is limited. The File System Access API exists but isn't universal. A drag-and-drop import model may be more practical initially.
