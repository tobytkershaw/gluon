# Gluon Phase 1: Proof of Concept Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-based proof of concept where a human and AI share control of a Plaits synthesiser, demonstrating the core Gluon interaction protocol.

**Architecture:** React SPA with a Web Audio fallback synth as the default audio engine, and a parallel WASM spike to compile Plaits DSP for richer synthesis. The Gluon engine manages session state, delta-based undo (AI actions only), and human-wins-always arbitration. An AI layer connects to the Anthropic API, compresses session state into prompts, and parses structured responses into protocol actions (move, suggest, audition, say). Action groups ensure multi-param AI changes are one undo step.

**Tech Stack:** TypeScript, React 18, Vite, Vitest, Tailwind CSS, Emscripten, Web Audio API, AudioWorklet, `@anthropic-ai/sdk`

**Spec documents:**
- `docs/gluon-interaction-protocol-v03.md` — Protocol spec
- `docs/gluon-phase1-build.md` — Phase 1 build brief
- `docs/gluon-architecture.md` — Full architecture vision

---

## Prerequisites

- Node.js 20+
- Emscripten SDK (for WASM compilation of Plaits)
- Git (to clone Mutable Instruments eurorack repo)
- An Anthropic API key (for AI integration)

---

## File Structure

```
gluon/
  src/
    audio/
      synth-interface.ts          # Abstract interface for synth engines
      web-audio-synth.ts          # Fallback synth (Web Audio oscillators)
      plaits-worklet.ts           # AudioWorklet processor for Plaits WASM
      audio-engine.ts             # Web Audio API setup, worklet/fallback management
    engine/
      types.ts                    # Protocol types (Session, Voice, Agency, etc.)
      undo.ts                     # Undo stack implementation
      session.ts                  # Session state management
      primitives.ts               # Protocol primitive dispatch (play, suggest, move, etc.)
      arbitration.ts              # Human-wins-always conflict resolution
    ai/
      system-prompt.ts            # AI system prompt template
      state-compression.ts        # Session state -> compressed JSON for prompt
      response-parser.ts          # AI response JSON -> protocol actions
      automation.ts               # Smooth parameter interpolation (local, no API)
      api.ts                      # Anthropic API client wrapper
    ui/
      App.tsx                     # Root component, wires everything together
      ParameterSpace.tsx          # 2D XY pad (canvas) for timbre x morph
      ModelSelector.tsx           # Plaits model picker (16 models)
      LeashSlider.tsx             # Leash control (0.0-1.0)
      AgencyToggle.tsx            # OFF / SUGGEST / PLAY toggle per voice
      ChatPanel.tsx               # Human <-> AI conversation
      Visualiser.tsx              # Waveform display (AnalyserNode)
      PendingOverlay.tsx          # Ghost suggestions, audition indicators
      UndoButton.tsx              # Undo control
      ApiKeyInput.tsx             # API key entry
      PitchControl.tsx            # Pitch/frequency control
    index.tsx                     # Entry point
    index.css                     # Tailwind imports + global styles
  tests/
    engine/
      undo.test.ts
      session.test.ts
      primitives.test.ts
      arbitration.test.ts
    ai/
      state-compression.test.ts
      response-parser.test.ts
      automation.test.ts
  wasm/
    gluon_plaits.cpp              # C++ wrapper around Plaits DSP
    build.sh                      # Emscripten build script
    plaits/                       # Extracted Plaits DSP source (from eurorack repo)
    stmlib/                       # Extracted stmlib dependencies (from eurorack repo)
  public/
    index.html
  package.json
  vite.config.ts
  tsconfig.json
  tailwind.config.ts
  postcss.config.js
```

---

## Chunk 1: Project Scaffolding + Audio Foundation

### Task 1: Scaffold Vite + React + TypeScript project

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.js`, `src/index.tsx`, `src/index.css`, `public/index.html`

- [ ] **Step 1: Create the project with Vite**

```bash
cd /Users/tobykershaw/Development/gluon
npm create vite@latest . -- --template react-ts
```

If the directory is not empty, Vite will ask — choose to proceed (it won't overwrite existing files like `docs/`).

- [ ] **Step 2: Install dependencies**

```bash
npm install
npm install -D tailwindcss @tailwindcss/vite vitest @testing-library/react @testing-library/jest-dom jsdom
npm install @anthropic-ai/sdk
```

- [ ] **Step 3: Configure Tailwind**

Replace `vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
```

Note: The COOP/COEP headers are required for `SharedArrayBuffer`, which AudioWorklet + WASM may need.

Replace `src/index.css`:

```css
@import "tailwindcss";
```

- [ ] **Step 4: Configure Vitest**

Add to `vite.config.ts` (merge with existing):

```typescript
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [],
  },
});
```

Add to `tsconfig.json` compilerOptions: `"types": ["vitest/globals"]`

- [ ] **Step 5: Verify scaffold works**

```bash
npm run dev
```

Expected: Dev server starts, default Vite React page loads at localhost:5173.

```bash
npx vitest run
```

Expected: Test runner executes (0 tests found is fine).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold Vite + React + TypeScript project with Tailwind and Vitest"
```

---

### Task 2: Define synth engine interface

**Files:**
- Create: `src/audio/synth-interface.ts`

- [ ] **Step 1: Create the interface file**

```typescript
// src/audio/synth-interface.ts

export interface SynthEngine {
  /** Set the synthesis model (0-15 for Plaits) */
  setModel(model: number): void;

  /** Set continuous parameters. All values normalised 0.0-1.0 */
  setParams(params: SynthParams): void;

  /** Render audio into the provided buffer. Returns the buffer. */
  render(output: Float32Array): Float32Array;

  /** Clean up resources */
  destroy(): void;
}

export interface SynthParams {
  harmonics: number;  // 0.0-1.0 (Plaits HARMONICS knob)
  timbre: number;     // 0.0-1.0 (Plaits TIMBRE knob) — X axis of parameter space
  morph: number;      // 0.0-1.0 (Plaits MORPH knob, called "color" in Gluon) — Y axis
  note: number;       // 0.0-1.0 normalised (maps to MIDI 0-127). Audio engine converts to Hz.
}

/** The 16 Plaits synthesis models */
export const PLAITS_MODELS = [
  { index: 0, name: 'Virtual Analog', description: 'VA oscillator with variable waveshape' },
  { index: 1, name: 'Waveshaping', description: 'Waveshaping oscillator' },
  { index: 2, name: 'FM', description: '2-operator FM synthesis' },
  { index: 3, name: 'Grain/Formant', description: 'Granular formant oscillator' },
  { index: 4, name: 'Harmonic', description: 'Additive harmonic oscillator' },
  { index: 5, name: 'Wavetable', description: 'Wavetable oscillator' },
  { index: 6, name: 'Chords', description: 'Chord engine' },
  { index: 7, name: 'Vowel/Speech', description: 'Speech synthesis' },
  { index: 8, name: 'Swarm', description: 'Swarm of 8 sawtooth oscillators' },
  { index: 9, name: 'Filtered Noise', description: 'Filtered noise generator' },
  { index: 10, name: 'Particle/Dust', description: 'Particle noise (dust)' },
  { index: 11, name: 'Inharmonic String', description: 'Inharmonic string model' },
  { index: 12, name: 'Modal Resonator', description: 'Struck objects, bells' },
  { index: 13, name: 'Analog Bass Drum', description: 'Analog bass drum' },
  { index: 14, name: 'Analog Snare', description: 'Analog snare drum' },
  { index: 15, name: 'Analog Hi-Hat', description: 'Analog hi-hat' },
] as const;

export const DEFAULT_PARAMS: SynthParams = {
  harmonics: 0.5,
  timbre: 0.5,
  morph: 0.5,
  note: 0.47,  // ≈ MIDI 60 (middle C)
};

/** Convert normalised note (0.0-1.0) to frequency in Hz */
export function noteToHz(note: number): number {
  const midiNote = note * 127;
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

/** Convert MIDI note number (0-127) to normalised (0.0-1.0) */
export function midiToNote(midi: number): number {
  return Math.max(0, Math.min(1, midi / 127));
}
```

- [ ] **Step 2: Commit**

```bash
git add src/audio/synth-interface.ts && git commit -m "feat(audio): define synth engine interface and Plaits model list"
```

---

### Task 3: Build Web Audio fallback synth

**Files:**
- Create: `src/audio/web-audio-synth.ts`

This is a simple synth using Web Audio API oscillators that implements `SynthEngine`. It allows UI and engine development to proceed before Plaits WASM is ready. It approximates each Plaits model with basic Web Audio nodes.

- [ ] **Step 1: Create the fallback synth**

```typescript
// src/audio/web-audio-synth.ts

import { SynthEngine, SynthParams, DEFAULT_PARAMS, noteToHz } from './synth-interface';

/**
 * Fallback synth using Web Audio API.
 * Approximates Plaits models with basic oscillator types.
 * Used for development before Plaits WASM is compiled.
 */
export class WebAudioSynth implements SynthEngine {
  private ctx: AudioContext;
  private oscillator: OscillatorNode;
  private gain: GainNode;
  private filter: BiquadFilterNode;
  private analyser: AnalyserNode;
  private model = 0;
  private params: SynthParams = { ...DEFAULT_PARAMS };

  constructor(ctx: AudioContext) {
    this.ctx = ctx;

    this.oscillator = ctx.createOscillator();
    this.filter = ctx.createBiquadFilter();
    this.gain = ctx.createGain();
    this.analyser = ctx.createAnalyser();

    this.oscillator.connect(this.filter);
    this.filter.connect(this.gain);
    this.gain.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this.filter.type = 'lowpass';
    this.filter.frequency.value = 2000;
    this.gain.gain.value = 0.3;
    this.oscillator.start();

    this.applyParams();
  }

  setModel(model: number): void {
    this.model = model;
    // Map models to oscillator types as rough approximation
    const typeMap: OscillatorType[] = [
      'sawtooth', // 0: Virtual Analog
      'square',   // 1: Waveshaping
      'sine',     // 2: FM
      'sawtooth', // 3: Grain
      'sine',     // 4: Harmonic
      'square',   // 5: Wavetable
      'sawtooth', // 6: Chords
      'square',   // 7: Vowel
      'sawtooth', // 8: Swarm
      'sawtooth', // 9: Noise (approximated)
      'square',   // 10: Particle
      'triangle', // 11: String
      'sine',     // 12: Modal
      'sine',     // 13: Bass Drum
      'square',   // 14: Snare
      'square',   // 15: Hi-Hat
    ];
    this.oscillator.type = typeMap[model] ?? 'sine';
  }

  setParams(params: SynthParams): void {
    this.params = { ...params };
    this.applyParams();
  }

  private applyParams(): void {
    // Convert normalised note to Hz at the audio boundary
    this.oscillator.frequency.value = noteToHz(this.params.note);
    // Timbre controls filter cutoff (200-8000 Hz)
    this.filter.frequency.value = 200 + this.params.timbre * 7800;
    // Morph controls filter resonance (0.5-15)
    this.filter.Q.value = 0.5 + this.params.morph * 14.5;
    // Harmonics controls gain/amplitude envelope character (mapped to detune for variety)
    this.oscillator.detune.value = (this.params.harmonics - 0.5) * 100;
  }

  getAnalyser(): AnalyserNode {
    return this.analyser;
  }

  render(_output: Float32Array): Float32Array {
    // Web Audio handles rendering internally via the audio graph.
    // This method exists to satisfy the interface but is not used
    // when running as a Web Audio graph (only for WASM-based engines).
    return _output;
  }

  destroy(): void {
    this.oscillator.stop();
    this.oscillator.disconnect();
    this.filter.disconnect();
    this.gain.disconnect();
    this.analyser.disconnect();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/audio/web-audio-synth.ts && git commit -m "feat(audio): add Web Audio fallback synth implementing SynthEngine interface"
```

---

### Task 4: Create audio engine manager

**Files:**
- Create: `src/audio/audio-engine.ts`

- [ ] **Step 1: Create the audio engine**

```typescript
// src/audio/audio-engine.ts

import { SynthParams, DEFAULT_PARAMS, noteToHz } from './synth-interface';
import { WebAudioSynth } from './web-audio-synth';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private synth: WebAudioSynth | null = null;
  private _isRunning = false;
  private currentParams: SynthParams = { ...DEFAULT_PARAMS };
  private currentModel = 0;

  get isRunning(): boolean {
    return this._isRunning;
  }

  async start(): Promise<void> {
    if (this._isRunning) return;
    this.ctx = new AudioContext({ sampleRate: 48000 });
    this.synth = new WebAudioSynth(this.ctx);
    this.synth.setModel(this.currentModel);
    this.synth.setParams(this.currentParams);
    this._isRunning = true;
  }

  stop(): void {
    if (!this._isRunning) return;
    this.synth?.destroy();
    this.ctx?.close();
    this.synth = null;
    this.ctx = null;
    this._isRunning = false;
  }

  setModel(model: number): void {
    this.currentModel = model;
    this.synth?.setModel(model);
  }

  setParams(params: Partial<SynthParams>): void {
    this.currentParams = { ...this.currentParams, ...params };
    this.synth?.setParams(this.currentParams);
  }

  getParams(): SynthParams {
    return { ...this.currentParams };
  }

  getAnalyser(): AnalyserNode | null {
    return this.synth?.getAnalyser() ?? null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/audio/audio-engine.ts && git commit -m "feat(audio): add AudioEngine manager with Web Audio fallback"
```

---

### Task 5: WASM Spike — Extract Plaits source and create WASM build

**Files:**
- Create: `wasm/gluon_plaits.cpp`, `wasm/build.sh`
- Clone (external): `plaits/` and `stmlib/` source into `wasm/`

**This is a spike, not a standard task.** It is the single highest-risk item in Phase 1. The Web Audio fallback synth is the default Phase 1 demo engine. This spike runs in parallel with Chunks 2-5 and succeeds only when ALL of these criteria are met:

1. Plaits C++ compiles to WASM without errors
2. WASM module loads in the browser
3. WASM instantiates inside an AudioWorklet context
4. Audible output for one fixed patch (e.g. model 0 at middle C)

If the spike is not complete by the time Chunk 5 finishes, Phase 1 ships with the fallback synth. That is an acceptable outcome for a proof of concept.

- [ ] **Step 1: Clone the eurorack repository and extract needed sources**

```bash
cd /Users/tobykershaw/Development/gluon
git clone --depth 1 https://github.com/pichenettes/eurorack.git /tmp/eurorack-source
mkdir -p wasm/plaits wasm/stmlib
cp -r /tmp/eurorack-source/plaits/dsp wasm/plaits/dsp
cp -r /tmp/eurorack-source/plaits/resources.h wasm/plaits/
cp -r /tmp/eurorack-source/plaits/resources.cc wasm/plaits/
cp -r /tmp/eurorack-source/stmlib/dsp wasm/stmlib/dsp
cp -r /tmp/eurorack-source/stmlib/utils wasm/stmlib/utils
cp -r /tmp/eurorack-source/stmlib/stmlib.h wasm/stmlib/
rm -rf /tmp/eurorack-source
```

Also study `plaits/test/plaits_test.cc` from the repo before deleting — it's the reference for how to call the DSP code.

- [ ] **Step 2: Create the C++ wrapper**

```cpp
// wasm/gluon_plaits.cpp

#include "plaits/dsp/voice.h"
#include "plaits/dsp/dsp.h"
#include <cstring>
#include <cstdlib>

// Plaits renders in blocks of 24 samples (kBlockSize in the original code)
// but we'll match the render call to arbitrary sizes by rendering in blocks.
static const int kBlockSize = 24;

struct GluonVoice {
  plaits::Voice voice;
  plaits::Patch patch;
  plaits::Modulations modulations;
  char shared_buffer[16384]; // Shared buffer for voice allocation
  float out_buffer[kBlockSize];
  float aux_buffer[kBlockSize];
};

extern "C" {

void* plaits_create() {
  GluonVoice* v = new GluonVoice();
  memset(v, 0, sizeof(GluonVoice));

  stmlib::BufferAllocator allocator(v->shared_buffer, sizeof(v->shared_buffer));
  v->voice.Init(&allocator);

  // Default patch
  v->patch.engine = 0;
  v->patch.note = 48.0f;
  v->patch.harmonics = 0.5f;
  v->patch.timbre = 0.5f;
  v->patch.morph = 0.5f;
  v->patch.frequency_modulation_amount = 0.0f;
  v->patch.timbre_modulation_amount = 0.0f;
  v->patch.morph_modulation_amount = 0.0f;
  v->patch.decay = 0.5f;
  v->patch.lpg_colour = 0.5f;

  // No modulations
  memset(&v->modulations, 0, sizeof(v->modulations));
  v->modulations.engine = 0.0f;
  v->modulations.note = 0.0f;
  v->modulations.frequency = 0.0f;
  v->modulations.harmonics = 0.0f;
  v->modulations.timbre = 0.0f;
  v->modulations.morph = 0.0f;
  v->modulations.trigger = 0.0f;
  v->modulations.level = 0.0f;
  v->modulations.frequency_patched = false;
  v->modulations.timbre_patched = false;
  v->modulations.morph_patched = false;
  v->modulations.trigger_patched = false;
  v->modulations.level_patched = false;

  return v;
}

void plaits_set_model(void* ptr, int model) {
  GluonVoice* v = (GluonVoice*)ptr;
  v->patch.engine = model;
}

void plaits_set_params(void* ptr, float harmonics, float timbre, float morph, float freq_hz, float note) {
  GluonVoice* v = (GluonVoice*)ptr;
  v->patch.harmonics = harmonics;
  v->patch.timbre = timbre;
  v->patch.morph = morph;
  v->patch.note = note;
}

// Render num_frames of audio. Caller provides output buffer of at least num_frames floats.
// Returns the number of frames actually rendered (always == num_frames).
int plaits_render(void* ptr, float* output, int num_frames) {
  GluonVoice* v = (GluonVoice*)ptr;
  int frames_rendered = 0;

  while (frames_rendered < num_frames) {
    plaits::Voice::Frame frame;
    v->voice.Render(v->patch, v->modulations, &frame, kBlockSize);

    int frames_to_copy = kBlockSize;
    if (frames_rendered + frames_to_copy > num_frames) {
      frames_to_copy = num_frames - frames_rendered;
    }

    for (int i = 0; i < frames_to_copy; i++) {
      output[frames_rendered + i] = frame.out[i] / 32768.0f; // Plaits outputs 16-bit range
    }
    frames_rendered += frames_to_copy;
  }

  return frames_rendered;
}

void plaits_destroy(void* ptr) {
  GluonVoice* v = (GluonVoice*)ptr;
  delete v;
}

} // extern "C"
```

Note: The exact field names and struct layout may need adjustment based on the actual Plaits source. Consult `plaits/dsp/voice.h` and `plaits/test/plaits_test.cc` for the correct API.

- [ ] **Step 3: Create the build script**

```bash
#!/bin/bash
# wasm/build.sh — Compile Plaits to WebAssembly

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Compiling Plaits to WebAssembly..."

# Collect all .cc source files from plaits/dsp
PLAITS_SOURCES=$(find plaits/dsp -name "*.cc" | tr '\n' ' ')

# Collect stmlib sources
STMLIB_SOURCES=$(find stmlib/dsp -name "*.cc" | tr '\n' ' ')

emcc gluon_plaits.cpp \
  plaits/resources.cc \
  $PLAITS_SOURCES \
  $STMLIB_SOURCES \
  -I. \
  -I./plaits \
  -I./stmlib \
  -DTEST \
  -O2 \
  -s WASM=1 \
  -s EXPORTED_FUNCTIONS='["_plaits_create","_plaits_set_model","_plaits_set_params","_plaits_render","_plaits_destroy","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=4194304 \
  -o ../public/plaits.js

echo "Done. Output: public/plaits.js and public/plaits.wasm"
```

Make it executable: `chmod +x wasm/build.sh`

- [ ] **Step 4: Attempt compilation**

```bash
cd /Users/tobykershaw/Development/gluon && bash wasm/build.sh
```

Expected: This may fail on the first attempt due to missing includes, platform-specific code, or struct mismatches. Debug iteratively:
1. Read error messages carefully
2. Check if hardware-specific headers are being included (remove them)
3. Check if `stmlib::BufferAllocator` needs a different include path
4. The `-DTEST` flag may help bypass hardware-specific code paths

If compilation succeeds, verify the output files exist: `public/plaits.js` and `public/plaits.wasm`.

- [ ] **Step 5: Commit (even if WASM build is still WIP)**

```bash
git add wasm/gluon_plaits.cpp wasm/build.sh && git commit -m "feat(wasm): add Plaits C++ wrapper and Emscripten build script"
```

Note: Don't commit the extracted `plaits/` and `stmlib/` source directories — add them to `.gitignore` and document the extraction step. Or commit them if you prefer a self-contained repo (they're MIT licensed).

---

### Task 6: WASM Spike (cont'd) — AudioWorklet for Plaits WASM

**Files:**
- Create: `src/audio/plaits-worklet.ts`

Part of the WASM spike. Only usable after Task 5 WASM compilation succeeds. The `initWasm()` method below is a skeleton — the main integration challenge is instantiating the Emscripten module inside the worklet context, which depends on how Emscripten structures its output. This will require iteration.

- [ ] **Step 1: Create the AudioWorklet processor**

```typescript
// src/audio/plaits-worklet.ts
// This file runs in the AudioWorklet scope, not the main thread.

declare const sampleRate: number;

interface PlaitsWasm {
  _plaits_create(): number;
  _plaits_set_model(ptr: number, model: number): void;
  _plaits_set_params(ptr: number, harmonics: number, timbre: number, morph: number, freqHz: number, note: number): void;
  _plaits_render(ptr: number, outputPtr: number, numFrames: number): number;
  _plaits_destroy(ptr: number): void;
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPF32: Float32Array;
}

class PlaitsProcessor extends AudioWorkletProcessor {
  private voicePtr = 0;
  private outputBufPtr = 0;
  private wasm: PlaitsWasm | null = null;
  private ready = false;
  private model = 0;
  private harmonics = 0.5;
  private timbre = 0.5;
  private morph = 0.5;
  private note = 0.47; // normalised, ≈ MIDI 60

  constructor() {
    super();
    this.port.onmessage = (e) => this.handleMessage(e.data);
  }

  private handleMessage(data: Record<string, unknown>): void {
    switch (data.type) {
      case 'init':
        this.initWasm(data.wasmModule as WebAssembly.Module);
        break;
      case 'setModel':
        this.model = data.model as number;
        if (this.ready) this.wasm!._plaits_set_model(this.voicePtr, this.model);
        break;
      case 'setParams':
        if (data.harmonics !== undefined) this.harmonics = data.harmonics as number;
        if (data.timbre !== undefined) this.timbre = data.timbre as number;
        if (data.morph !== undefined) this.morph = data.morph as number;
        if (data.note !== undefined) this.note = data.note as number;
        break;
    }
  }

  private async initWasm(wasmModule: WebAssembly.Module): Promise<void> {
    // TODO: Instantiate the WASM module in the worklet context
    // This requires the Emscripten glue code to be importable in the worklet
    // Implementation depends on how Emscripten outputs are structured
    this.port.postMessage({ type: 'ready' });
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
    if (!this.ready || !this.wasm) {
      // Output silence
      return true;
    }

    const output = outputs[0][0];
    const numFrames = output.length;

    // Convert normalised note (0-1) to MIDI note for Plaits
    const midiNote = this.note * 127;
    this.wasm._plaits_set_params(this.voicePtr, this.harmonics, this.timbre, this.morph, 0, midiNote);
    this.wasm._plaits_render(this.voicePtr, this.outputBufPtr, numFrames);

    // Copy from WASM heap to output
    const heapOffset = this.outputBufPtr / 4; // float32 = 4 bytes
    output.set(this.wasm.HEAPF32.subarray(heapOffset, heapOffset + numFrames));

    return true;
  }
}

registerProcessor('plaits-processor', PlaitsProcessor);
```

- [ ] **Step 2: Commit**

```bash
git add src/audio/plaits-worklet.ts && git commit -m "feat(audio): add AudioWorklet processor for Plaits WASM"
```

---

## Chunk 2: Protocol Engine

### Task 7: Protocol types

**Files:**
- Create: `src/engine/types.ts`

- [ ] **Step 1: Define all protocol types**

```typescript
// src/engine/types.ts

/** OFF = AI cannot act on this voice, but still observes it for context.
 *  SUGGEST = AI can propose changes; nothing sounds until human commits.
 *  PLAY = AI can move params and play freely. */
export type Agency = 'OFF' | 'SUGGEST' | 'PLAY';

/** All params normalised 0.0-1.0 per protocol spec.
 *  note: 0.0-1.0 maps to MIDI note 0-127 (middle C ≈ 0.47).
 *  The audio engine converts note → Hz at the boundary. */
export interface SynthParamValues {
  harmonics: number;  // 0.0-1.0
  timbre: number;     // 0.0-1.0
  morph: number;      // 0.0-1.0
  note: number;       // 0.0-1.0 (maps to MIDI 0-127)
  [key: string]: number;
}

export interface Voice {
  id: string;
  engine: string;         // e.g. "plaits:virtual_analog"
  model: number;          // engine model index
  params: SynthParamValues;
  agency: Agency;
}

export interface MusicalContext {
  key: string | null;     // e.g. "D minor", null = floating
  scale: string | null;
  tempo: number | null;   // BPM
  energy: number;         // 0.0-1.0
  density: number;        // 0.0-1.0
}

/**
 * Delta-based snapshot for undo. Stores the previous AND target values of ONLY the params
 * the AI touched. On undo, a param is only reverted if its current value still matches the
 * AI's target — meaning the human hasn't taken control of it since.
 * Protocol ref: "Undo never reverses the human's own actions, only the AI's."
 */
export interface Snapshot {
  prevValues: Partial<SynthParamValues>;    // values BEFORE the AI acted
  aiTargetValues: Partial<SynthParamValues>; // values the AI set them TO
  timestamp: number;
  description: string;
}

export type PendingActionType = 'suggestion' | 'audition';

export interface PendingAction {
  id: string;
  type: PendingActionType;
  trackId: string;
  changes: Partial<SynthParamValues>;
  reason?: string;
  expiresAt: number;      // timestamp
  previousValues: Partial<SynthParamValues>; // for reverting auditions
}

// AI action types (what the AI can emit)
export interface AIMoveAction {
  type: 'move';
  param: string;
  target: { absolute: number } | { relative: number };
  over?: number;          // duration in ms for smooth transition
}

export interface AISuggestAction {
  type: 'suggest';
  changes: Partial<SynthParamValues>;
  reason?: string;
}

export interface AIAuditionAction {
  type: 'audition';
  changes: Partial<SynthParamValues>;
  duration?: number;      // ms, default 3000
}

export interface AISayAction {
  type: 'say';
  text: string;
}

export interface AISketchAction {
  type: 'sketch';
  sketchType: 'pattern' | 'automation' | 'voice' | 'arrangement';
  description: string;
  content: unknown;       // Phase 1: not implemented, stub only
  target?: string;        // voice id
}

export type AIAction = AIMoveAction | AISuggestAction | AIAuditionAction | AISayAction | AISketchAction;

/** Tracks recent human parameter changes for AI context */
export interface HumanAction {
  param: string;
  from: number;
  to: number;
  timestamp: number;
}

export interface Session {
  voice: Voice;           // Single voice for Phase 1
  leash: number;          // 0.0-1.0
  undoStack: Snapshot[];
  pending: PendingAction[];
  context: MusicalContext;
  messages: ChatMessage[];
  recentHumanActions: HumanAction[]; // Last N human param changes, for AI context
}

export interface ChatMessage {
  role: 'human' | 'ai';
  text: string;
  timestamp: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/engine/types.ts && git commit -m "feat(engine): define protocol types (Phase 1 subset: single voice, simplified session)"
```

---

### Task 8: Undo stack (TDD)

**Files:**
- Create: `src/engine/undo.ts`, `tests/engine/undo.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/engine/undo.test.ts

import { describe, it, expect } from 'vitest';
import { UndoStack } from '../../src/engine/undo';
import { Snapshot } from '../../src/engine/types';

describe('UndoStack', () => {
  function makeSnapshot(desc: string): Snapshot {
    return {
      prevValues: { timbre: 0.5 },
      aiTargetValues: { timbre: 0.8 },
      timestamp: Date.now(),
      description: desc,
    };
  }

  it('starts empty', () => {
    const stack = new UndoStack();
    expect(stack.isEmpty()).toBe(true);
    expect(stack.size()).toBe(0);
  });

  it('pushes and pops snapshots', () => {
    const stack = new UndoStack();
    const s1 = makeSnapshot('action 1');
    const s2 = makeSnapshot('action 2');
    stack.push(s1);
    stack.push(s2);
    expect(stack.size()).toBe(2);
    expect(stack.pop()).toEqual(s2);
    expect(stack.pop()).toEqual(s1);
    expect(stack.isEmpty()).toBe(true);
  });

  it('returns undefined when popping empty stack', () => {
    const stack = new UndoStack();
    expect(stack.pop()).toBeUndefined();
  });

  it('clears all entries', () => {
    const stack = new UndoStack();
    stack.push(makeSnapshot('a'));
    stack.push(makeSnapshot('b'));
    stack.clear();
    expect(stack.isEmpty()).toBe(true);
  });

  it('peeks without removing', () => {
    const stack = new UndoStack();
    const s = makeSnapshot('test');
    stack.push(s);
    expect(stack.peek()).toEqual(s);
    expect(stack.size()).toBe(1);
  });

  it('limits max size, discarding oldest', () => {
    const stack = new UndoStack(3);
    stack.push(makeSnapshot('1'));
    stack.push(makeSnapshot('2'));
    stack.push(makeSnapshot('3'));
    stack.push(makeSnapshot('4'));
    expect(stack.size()).toBe(3);
    // Oldest ('1') was discarded
    const all = stack.toArray();
    expect(all[0].description).toBe('2');
  });
});
```

- [ ] **Step 2: Run tests — verify failure**

```bash
npx vitest run tests/engine/undo.test.ts
```

Expected: FAIL — module `../../src/engine/undo` not found.

- [ ] **Step 3: Implement**

```typescript
// src/engine/undo.ts

import { Snapshot } from './types';

export class UndoStack {
  private stack: Snapshot[] = [];
  private maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  push(snapshot: Snapshot): void {
    this.stack.push(snapshot);
    if (this.stack.length > this.maxSize) {
      this.stack.shift();
    }
  }

  pop(): Snapshot | undefined {
    return this.stack.pop();
  }

  peek(): Snapshot | undefined {
    return this.stack[this.stack.length - 1];
  }

  isEmpty(): boolean {
    return this.stack.length === 0;
  }

  size(): number {
    return this.stack.length;
  }

  clear(): void {
    this.stack = [];
  }

  toArray(): Snapshot[] {
    return [...this.stack];
  }
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
npx vitest run tests/engine/undo.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/undo.ts tests/engine/undo.test.ts && git commit -m "feat(engine): implement undo stack with TDD"
```

---

### Task 9: Session state management (TDD)

**Files:**
- Create: `src/engine/session.ts`, `tests/engine/session.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/engine/session.test.ts

import { describe, it, expect } from 'vitest';
import { createSession, setLeash, setAgency, updateTrackParams, setModel } from '../../src/engine/session';

describe('Session', () => {
  it('creates a default session', () => {
    const session = createSession();
    expect(session.leash).toBe(0.5);
    expect(session.voice.agency).toBe('SUGGEST');
    expect(session.voice.params.timbre).toBe(0.5);
    expect(session.undoStack).toEqual([]);
    expect(session.pending).toEqual([]);
    expect(session.messages).toEqual([]);
    expect(session.recentHumanActions).toEqual([]);
  });

  it('sets leash, clamped to 0-1', () => {
    let s = createSession();
    s = setLeash(s, 0.75);
    expect(s.leash).toBe(0.75);
    s = setLeash(s, -0.5);
    expect(s.leash).toBe(0);
    s = setLeash(s, 1.5);
    expect(s.leash).toBe(1);
  });

  it('sets agency', () => {
    let s = createSession();
    s = setAgency(s, 'PLAY');
    expect(s.voice.agency).toBe('PLAY');
    s = setAgency(s, 'OFF');
    expect(s.voice.agency).toBe('OFF');
  });

  it('updates voice params immutably', () => {
    const s1 = createSession();
    const s2 = updateTrackParams(s1, { timbre: 0.8 });
    expect(s2.voice.params.timbre).toBe(0.8);
    expect(s1.voice.params.timbre).toBe(0.5); // original unchanged
  });

  it('sets model', () => {
    let s = createSession();
    s = setModel(s, 5);
    expect(s.voice.model).toBe(5);
    expect(s.voice.engine).toBe('plaits:wavetable');
  });
});
```

- [ ] **Step 2: Run tests — verify failure**

```bash
npx vitest run tests/engine/session.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/engine/session.ts

import { Session, Voice, Agency, MusicalContext, SynthParamValues } from './types';
import { PLAITS_MODELS } from '../audio/synth-interface';

export function createSession(): Session {
  const voice: Voice = {
    id: 'voice-1',
    engine: 'plaits:virtual_analog',
    model: 0,
    params: {
      harmonics: 0.5,
      timbre: 0.5,
      morph: 0.5,
      note: 0.47,  // ≈ MIDI 60 (middle C)
    },
    agency: 'SUGGEST',
  };

  const context: MusicalContext = {
    key: null,
    scale: null,
    tempo: null,
    energy: 0.3,
    density: 0.2,
  };

  return {
    voice,
    leash: 0.5,
    undoStack: [],
    pending: [],
    context,
    messages: [],
    recentHumanActions: [],
  };
}

export function setLeash(session: Session, value: number): Session {
  return { ...session, leash: Math.max(0, Math.min(1, value)) };
}

export function setAgency(session: Session, agency: Agency): Session {
  return {
    ...session,
    voice: { ...session.voice, agency },
  };
}

export function updateTrackParams(session: Session, params: Partial<SynthParamValues>, trackAsHuman = false): Session {
  const newActions = trackAsHuman
    ? [
        ...session.recentHumanActions,
        ...Object.entries(params).map(([param, to]) => ({
          param,
          from: session.voice.params[param] ?? 0,
          to: to as number,
          timestamp: Date.now(),
        })),
      ].slice(-20) // Keep last 20 actions
    : session.recentHumanActions;

  return {
    ...session,
    voice: {
      ...session.voice,
      params: { ...session.voice.params, ...params },
    },
    recentHumanActions: newActions,
  };
}

export function setModel(session: Session, model: number): Session {
  const modelInfo = PLAITS_MODELS[model];
  const engineName = modelInfo
    ? `plaits:${modelInfo.name.toLowerCase().replace(/[\s/]+/g, '_')}`
    : `plaits:unknown_${model}`;
  return {
    ...session,
    voice: { ...session.voice, model, engine: engineName },
  };
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
npx vitest run tests/engine/session.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/engine/session.ts tests/engine/session.test.ts && git commit -m "feat(engine): implement session state management with TDD"
```

---

### Task 10: Protocol primitives (TDD)

**Files:**
- Create: `src/engine/primitives.ts`, `tests/engine/primitives.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/engine/primitives.test.ts

import { describe, it, expect, vi } from 'vitest';
import { applyMove, applyMoveGroup, applyParamDirect, applySuggest, applyAudition, cancelAuditionParam, applyUndo, commitPending, dismissPending } from '../../src/engine/primitives';
import { createSession, updateTrackParams, setAgency } from '../../src/engine/session';
import { Session } from '../../src/engine/types';

describe('Protocol Primitives', () => {
  describe('applyMove', () => {
    it('applies absolute move and pushes delta to undo stack', () => {
      const s = createSession();
      const result = applyMove(s, 'timbre', { absolute: 0.8 });
      expect(result.voice.params.timbre).toBe(0.8);
      expect(result.undoStack.length).toBe(1);
      expect(result.undoStack[0].prevValues.timbre).toBe(0.5);
      expect(result.undoStack[0].aiTargetValues.timbre).toBe(0.8);
    });

    it('applies relative move', () => {
      const s = updateTrackParams(createSession(), { timbre: 0.5 });
      const result = applyMove(s, 'timbre', { relative: 0.2 });
      expect(result.voice.params.timbre).toBeCloseTo(0.7);
    });

    it('clamps values to 0-1 for normalised params', () => {
      const s = updateTrackParams(createSession(), { timbre: 0.9 });
      const result = applyMove(s, 'timbre', { relative: 0.3 });
      expect(result.voice.params.timbre).toBe(1.0);
    });

    it('clamps values at 0 for negative relative moves', () => {
      const s = updateTrackParams(createSession(), { timbre: 0.1 });
      const result = applyMove(s, 'timbre', { relative: -0.5 });
      expect(result.voice.params.timbre).toBe(0.0);
    });
  });

  describe('applyMoveGroup (action groups)', () => {
    it('applies multiple moves as a single undo entry', () => {
      const s = createSession();
      const result = applyMoveGroup(s, [
        { param: 'timbre', target: { absolute: 0.8 } },
        { param: 'morph', target: { absolute: 0.3 } },
      ]);
      expect(result.voice.params.timbre).toBe(0.8);
      expect(result.voice.params.morph).toBe(0.3);
      expect(result.undoStack.length).toBe(1); // ONE entry, not two
    });

    it('undo reverses entire group at once', () => {
      let s = createSession();
      s = applyMoveGroup(s, [
        { param: 'timbre', target: { absolute: 0.8 } },
        { param: 'morph', target: { absolute: 0.3 } },
      ]);
      const result = applyUndo(s);
      expect(result.voice.params.timbre).toBe(0.5);
      expect(result.voice.params.morph).toBe(0.5);
    });
  });

  describe('applySuggest', () => {
    it('adds suggestion to pending list', () => {
      const s = createSession();
      const result = applySuggest(s, { timbre: 0.8 }, 'try this');
      expect(result.pending.length).toBe(1);
      expect(result.pending[0].type).toBe('suggestion');
      expect(result.pending[0].changes.timbre).toBe(0.8);
      expect(result.pending[0].reason).toBe('try this');
      // Voice params should NOT change
      expect(result.voice.params.timbre).toBe(0.5);
    });
  });

  describe('applyAudition', () => {
    it('applies changes and adds to pending with previous values', () => {
      const s = createSession();
      const result = applyAudition(s, { timbre: 0.8, morph: 0.3 }, 3000);
      expect(result.voice.params.timbre).toBe(0.8);
      expect(result.voice.params.morph).toBe(0.3);
      expect(result.pending.length).toBe(1);
      expect(result.pending[0].type).toBe('audition');
      expect(result.pending[0].previousValues.timbre).toBe(0.5);
      expect(result.pending[0].previousValues.morph).toBe(0.5);
    });

    it('replaces existing audition (one per voice)', () => {
      let s = createSession();
      s = applyAudition(s, { timbre: 0.8 }, 3000);
      s = applyAudition(s, { morph: 0.2 }, 3000);
      // Only one audition should exist
      const auditions = s.pending.filter((p) => p.type === 'audition');
      expect(auditions.length).toBe(1);
      expect(auditions[0].changes.morph).toBe(0.2);
      // Previous audition's param should be reverted
      expect(s.voice.params.timbre).toBe(0.5);
    });
  });

  describe('commitPending', () => {
    it('removes pending action and keeps current params', () => {
      let s = createSession();
      s = applySuggest(s, { timbre: 0.8 });
      const pendingId = s.pending[0].id;
      // For a suggestion, committing applies the changes
      const result = commitPending(s, pendingId);
      expect(result.pending.length).toBe(0);
      expect(result.voice.params.timbre).toBe(0.8);
    });
  });

  describe('dismissPending', () => {
    it('removes suggestion without applying', () => {
      let s = createSession();
      s = applySuggest(s, { timbre: 0.8 });
      const pendingId = s.pending[0].id;
      const result = dismissPending(s, pendingId);
      expect(result.pending.length).toBe(0);
      expect(result.voice.params.timbre).toBe(0.5); // unchanged
    });

    it('reverts audition to previous values', () => {
      let s = createSession();
      s = applyAudition(s, { timbre: 0.8 }, 3000);
      const pendingId = s.pending[0].id;
      const result = dismissPending(s, pendingId);
      expect(result.pending.length).toBe(0);
      expect(result.voice.params.timbre).toBe(0.5); // reverted
    });

    it('only reverts untouched params after human cancels one audition param', () => {
      let s = createSession();
      s = applyAudition(s, { timbre: 0.8, morph: 0.9 }, 3000);
      // Human touches timbre during audition — cancel that param
      s = cancelAuditionParam(s, 'timbre');
      const pendingId = s.pending[0].id;
      const result = dismissPending(s, pendingId);
      expect(result.pending.length).toBe(0);
      expect(result.voice.params.timbre).toBe(0.8); // human took control — stays
      expect(result.voice.params.morph).toBe(0.5);  // untouched — reverts
    });

    it('removes audition entirely if human cancels all params', () => {
      let s = createSession();
      s = applyAudition(s, { timbre: 0.8 }, 3000);
      s = cancelAuditionParam(s, 'timbre');
      expect(s.pending.length).toBe(0); // audition removed, no revert needed
    });
  });

  describe('applyUndo', () => {
    it('restores previous state from undo stack', () => {
      let s = createSession();
      s = applyMove(s, 'timbre', { absolute: 0.8 });
      expect(s.voice.params.timbre).toBe(0.8);
      const result = applyUndo(s);
      expect(result.voice.params.timbre).toBe(0.5); // restored
      expect(result.undoStack.length).toBe(0);
    });

    it('walks back through multiple undo entries', () => {
      let s = createSession();
      s = applyMove(s, 'timbre', { absolute: 0.6 });
      s = applyMove(s, 'timbre', { absolute: 0.8 });
      expect(s.undoStack.length).toBe(2);
      s = applyUndo(s);
      expect(s.voice.params.timbre).toBe(0.6);
      s = applyUndo(s);
      expect(s.voice.params.timbre).toBe(0.5);
    });

    it('returns session unchanged if undo stack is empty', () => {
      const s = createSession();
      const result = applyUndo(s);
      expect(result).toEqual(s);
    });

    it('does NOT wipe human edits on a different param made after AI action', () => {
      let s = createSession(); // timbre=0.5, morph=0.5
      s = applyMove(s, 'timbre', { absolute: 0.8 }); // AI changes timbre
      // Human changes morph AFTER the AI acted
      s = updateTrackParams(s, { morph: 0.9 });
      // Undo should revert timbre but preserve the human's morph change
      const result = applyUndo(s);
      expect(result.voice.params.timbre).toBe(0.5); // AI action reverted
      expect(result.voice.params.morph).toBe(0.9);  // human edit preserved
    });

    it('skips undo on a param the human has since overridden (same param)', () => {
      let s = createSession(); // timbre=0.5
      s = applyMove(s, 'timbre', { absolute: 0.8 }); // AI sets timbre to 0.8
      // Human takes timbre to 0.3 — overriding the AI's value
      s = updateTrackParams(s, { timbre: 0.3 });
      // Undo pops the stack entry, but timbre (0.3) != aiTarget (0.8), so no revert
      const result = applyUndo(s);
      expect(result.voice.params.timbre).toBe(0.3); // human's value preserved
      expect(result.undoStack.length).toBe(0);       // stack entry still consumed
    });
  });

  describe('applyParamDirect', () => {
    it('changes param without pushing to undo stack', () => {
      const s = createSession();
      const result = applyParamDirect(s, 'timbre', 0.7);
      expect(result.voice.params.timbre).toBe(0.7);
      expect(result.undoStack.length).toBe(0); // no undo entry
    });
  });
});
```

- [ ] **Step 2: Run tests — verify failure**

```bash
npx vitest run tests/engine/primitives.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/engine/primitives.ts

import { Session, Snapshot, PendingAction, SynthParamValues } from './types';

let nextPendingId = 1;

/** All params are normalised 0.0-1.0 per protocol spec. */
function clampParam(_name: string, value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function applyMove(
  session: Session,
  param: string,
  target: { absolute: number } | { relative: number },
): Session {
  const currentValue = session.voice.params[param] ?? 0;
  const newValue = 'absolute' in target ? target.absolute : currentValue + target.relative;
  const clamped = clampParam(param, newValue);

  const snapshot: Snapshot = {
    prevValues: { [param]: currentValue },
    aiTargetValues: { [param]: clamped },
    timestamp: Date.now(),
    description: `AI move: ${param} ${currentValue.toFixed(2)} -> ${clamped.toFixed(2)}`,
  };

  return {
    ...session,
    voice: {
      ...session.voice,
      params: { ...session.voice.params, [param]: clamped },
    },
    undoStack: [...session.undoStack, snapshot],
  };
}

/** Apply multiple moves as a single undo entry (action group).
 *  Required for Phase 1: "make it darker" touching 3 params = one undo step. */
export function applyMoveGroup(
  session: Session,
  moves: { param: string; target: { absolute: number } | { relative: number } }[],
): Session {
  const prevValues: Partial<SynthParamValues> = {};
  const aiTargetValues: Partial<SynthParamValues> = {};
  const descriptions: string[] = [];

  for (const move of moves) {
    const cur = session.voice.params[move.param] ?? 0;
    prevValues[move.param] = cur;
    const nv = clampParam(move.param, 'absolute' in move.target ? move.target.absolute : cur + move.target.relative);
    aiTargetValues[move.param] = nv;
    descriptions.push(`${move.param} ${cur.toFixed(2)} -> ${nv.toFixed(2)}`);
  }

  const snapshot: Snapshot = {
    prevValues,
    aiTargetValues,
    timestamp: Date.now(),
    description: `AI group: ${descriptions.join(', ')}`,
  };

  // Apply all moves
  const newParams = { ...session.voice.params };
  for (const move of moves) {
    const currentValue = newParams[move.param] ?? 0;
    const newValue = 'absolute' in move.target ? move.target.absolute : currentValue + move.target.relative;
    newParams[move.param] = clampParam(move.param, newValue);
  }

  return {
    ...session,
    voice: { ...session.voice, params: newParams },
    undoStack: [...session.undoStack, snapshot],
  };
}

/** Apply a param change WITHOUT pushing to the undo stack.
 *  Used by smooth automation ticks — the undo entry is created once at automation start. */
export function applyParamDirect(
  session: Session,
  param: string,
  value: number,
): Session {
  return {
    ...session,
    voice: {
      ...session.voice,
      params: { ...session.voice.params, [param]: clampParam(param, value) },
    },
  };
}

export function applySuggest(
  session: Session,
  changes: Partial<SynthParamValues>,
  reason?: string,
): Session {
  const pending: PendingAction = {
    id: `pending-${nextPendingId++}`,
    type: 'suggestion',
    trackId: session.voice.id,
    changes,
    reason,
    expiresAt: Date.now() + 15000, // 15 second expiry
    previousValues: {},
  };

  return {
    ...session,
    pending: [...session.pending, pending],
  };
}

export function applyAudition(
  session: Session,
  changes: Partial<SynthParamValues>,
  durationMs = 3000,
): Session {
  // Enforce one audition per voice: revert and remove any existing audition
  let currentParams = { ...session.voice.params };
  const existingAudition = session.pending.find(
    (p) => p.type === 'audition' && p.trackId === session.voice.id,
  );
  if (existingAudition) {
    // Revert the old audition's changes first
    currentParams = { ...currentParams, ...existingAudition.previousValues };
  }
  const pendingWithoutOldAudition = session.pending.filter(
    (p) => !(p.type === 'audition' && p.trackId === session.voice.id),
  );

  // Save previous values for the NEW audition (after reverting old one)
  const previousValues: Partial<SynthParamValues> = {};
  for (const key of Object.keys(changes)) {
    previousValues[key] = currentParams[key];
  }

  const pending: PendingAction = {
    id: `pending-${nextPendingId++}`,
    type: 'audition',
    trackId: session.voice.id,
    changes,
    expiresAt: Date.now() + durationMs,
    previousValues,
  };

  return {
    ...session,
    voice: {
      ...session.voice,
      params: { ...currentParams, ...changes },
    },
    pending: [...pendingWithoutOldAudition, pending],
  };
}

/** When the human touches a param that's part of an active audition,
 *  remove that param from the audition's revert set.
 *  The human's value sticks — only untouched auditioned params revert on expiry.
 *  If all params are cancelled, the audition is removed entirely. */
export function cancelAuditionParam(session: Session, param: string): Session {
  const audition = session.pending.find(
    (p) => p.type === 'audition' && p.trackId === session.voice.id,
  );
  if (!audition || !(param in audition.previousValues)) return session;

  const newPreviousValues = { ...audition.previousValues };
  delete newPreviousValues[param];
  const newChanges = { ...audition.changes };
  delete newChanges[param];

  // If no params remain, remove the audition entirely
  if (Object.keys(newPreviousValues).length === 0) {
    return {
      ...session,
      pending: session.pending.filter((p) => p.id !== audition.id),
    };
  }

  // Otherwise update the audition with the reduced param set
  return {
    ...session,
    pending: session.pending.map((p) =>
      p.id === audition.id
        ? { ...p, previousValues: newPreviousValues, changes: newChanges }
        : p,
    ),
  };
}

export function commitPending(session: Session, pendingId: string): Session {
  const action = session.pending.find((p) => p.id === pendingId);
  if (!action) return session;

  let newParams = session.voice.params;
  if (action.type === 'suggestion') {
    // Apply the suggested changes
    newParams = { ...newParams, ...action.changes };
  }
  // For auditions, the changes are already applied — just remove from pending

  return {
    ...session,
    voice: { ...session.voice, params: newParams },
    pending: session.pending.filter((p) => p.id !== pendingId),
  };
}

export function dismissPending(session: Session, pendingId: string): Session {
  const action = session.pending.find((p) => p.id === pendingId);
  if (!action) return session;

  let newParams = session.voice.params;
  if (action.type === 'audition') {
    // Revert to previous values
    newParams = { ...newParams, ...action.previousValues };
  }
  // For suggestions, nothing was applied — just remove

  return {
    ...session,
    voice: { ...session.voice, params: newParams },
    pending: session.pending.filter((p) => p.id !== pendingId),
  };
}

export function applyUndo(session: Session): Session {
  if (session.undoStack.length === 0) return session;

  const newStack = [...session.undoStack];
  const snapshot = newStack.pop()!;

  // Only revert params where the current value still matches what the AI set.
  // If the human has since changed the param, the current value won't match the AI's
  // target, and we skip it — the human's edit takes priority.
  const newParams = { ...session.voice.params };
  for (const [param, prevValue] of Object.entries(snapshot.prevValues)) {
    const aiTarget = snapshot.aiTargetValues[param];
    const currentValue = newParams[param];
    // Use small epsilon for float comparison
    if (aiTarget !== undefined && Math.abs(currentValue - aiTarget) < 0.001) {
      newParams[param] = prevValue as number;
    }
    // If currentValue !== aiTarget, the human has taken control — don't revert
  }

  return {
    ...session,
    voice: { ...session.voice, params: newParams },
    undoStack: newStack,
  };
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
npx vitest run tests/engine/primitives.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/engine/primitives.ts tests/engine/primitives.test.ts && git commit -m "feat(engine): implement protocol primitives (move, suggest, audition, undo, commit, dismiss)"
```

---

### Task 11: Arbitration logic (TDD)

**Files:**
- Create: `src/engine/arbitration.ts`, `tests/engine/arbitration.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/engine/arbitration.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Arbitrator } from '../../src/engine/arbitration';

describe('Arbitrator', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('allows AI action when human is not active', () => {
    const arb = new Arbitrator();
    expect(arb.canAIAct('timbre')).toBe(true);
  });

  it('blocks AI action on param human is actively touching', () => {
    const arb = new Arbitrator();
    arb.humanTouched('timbre');
    expect(arb.canAIAct('timbre')).toBe(false);
  });

  it('allows AI action on different param than human is touching', () => {
    const arb = new Arbitrator();
    arb.humanTouched('timbre');
    expect(arb.canAIAct('morph')).toBe(true);
  });

  it('allows AI action after cooldown expires', () => {
    const arb = new Arbitrator(500); // 500ms cooldown
    arb.humanTouched('timbre');
    expect(arb.canAIAct('timbre')).toBe(false);
    vi.advanceTimersByTime(501);
    expect(arb.canAIAct('timbre')).toBe(true);
  });

  it('resets cooldown on repeated touch', () => {
    const arb = new Arbitrator(500);
    arb.humanTouched('timbre');
    vi.advanceTimersByTime(400);
    arb.humanTouched('timbre'); // reset
    vi.advanceTimersByTime(400);
    expect(arb.canAIAct('timbre')).toBe(false);
    vi.advanceTimersByTime(101);
    expect(arb.canAIAct('timbre')).toBe(true);
  });

  it('blocks all AI actions when human is in active interaction', () => {
    const arb = new Arbitrator();
    arb.humanInteractionStart();
    expect(arb.canAIAct('timbre')).toBe(false);
    expect(arb.canAIAct('morph')).toBe(false);
    arb.humanInteractionEnd();
    expect(arb.canAIAct('timbre')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — verify failure**

```bash
npx vitest run tests/engine/arbitration.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/engine/arbitration.ts

export class Arbitrator {
  private lastTouched: Map<string, number> = new Map();
  private cooldownMs: number;
  private activeInteraction = false;

  constructor(cooldownMs = 500) {
    this.cooldownMs = cooldownMs;
  }

  /** Called when human changes a parameter */
  humanTouched(param: string): void {
    this.lastTouched.set(param, Date.now());
  }

  /** Called on mousedown/touchstart */
  humanInteractionStart(): void {
    this.activeInteraction = true;
  }

  /** Called on mouseup/touchend */
  humanInteractionEnd(): void {
    this.activeInteraction = false;
  }

  /** Can the AI act on this parameter right now? */
  canAIAct(param: string): boolean {
    if (this.activeInteraction) return false;
    const lastTouch = this.lastTouched.get(param);
    if (lastTouch === undefined) return true;
    return Date.now() - lastTouch > this.cooldownMs;
  }
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
npx vitest run tests/engine/arbitration.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/engine/arbitration.ts tests/engine/arbitration.test.ts && git commit -m "feat(engine): implement arbitration (human-wins-always) with TDD"
```

---

## Chunk 3: AI Layer

### Task 12: System prompt

**Files:**
- Create: `src/ai/system-prompt.ts`

- [ ] **Step 1: Create the system prompt**

```typescript
// src/ai/system-prompt.ts

export const GLUON_SYSTEM_PROMPT = `You are the AI collaborator in Gluon, a shared musical instrument. You and a human are playing a Plaits synthesiser together in the browser.

## Your Role
You are a session musician, not a producer. You have opinions, you can play, you can suggest — but the human has final say. Communicate through the instrument more than through words.

## Available Actions
Respond with a JSON array of actions. Available action types:

- **move**: Change a parameter directly (immediately audible)
  \`{ "type": "move", "param": "timbre"|"morph"|"harmonics", "target": { "absolute": 0.0-1.0 } }\`
  Optional: \`"over": 2000\` for smooth transition over N milliseconds.

- **suggest**: Propose a change (appears as ghost, human must commit)
  \`{ "type": "suggest", "changes": { "timbre": 0.7 }, "reason": "optional explanation" }\`

- **audition**: Temporarily apply a change for a few seconds (auto-reverts unless committed)
  \`{ "type": "audition", "changes": { "morph": 0.3 }, "duration": 3000 }\`

- **say**: Speak to the human
  \`{ "type": "say", "text": "your message" }\`

## Behaviour Rules
1. Be musical. Be concise. Don't over-explain.
2. If the human hasn't asked you anything and the leash is low, respond with \`[]\`.
3. Never narrate your own actions unless asked "why?"
4. When suggesting, describe what will change sonically, not just parameter numbers.
5. Respond to the human's musical direction. If they're exploring dark timbres, don't suggest bright ones unless asked.
6. Match your activity level to the leash value: 0.0 = silent, 0.5 = active participant, 1.0 = full co-creator.
7. Keep say messages short — one or two sentences max.

## Plaits Models Reference
0: Virtual Analog, 1: Waveshaping, 2: FM, 3: Grain/Formant, 4: Harmonic,
5: Wavetable, 6: Chords, 7: Vowel/Speech, 8: Swarm, 9: Filtered Noise,
10: Particle/Dust, 11: Inharmonic String, 12: Modal Resonator,
13: Analog Bass Drum, 14: Analog Snare, 15: Analog Hi-Hat

## Parameter Space
- **harmonics** (0.0-1.0): Controls the harmonic content. Effect varies by model.
- **timbre** (0.0-1.0): Primary timbral control. Maps to X-axis of the parameter pad.
- **morph** (0.0-1.0): Secondary timbral control (called "color"). Maps to Y-axis.

Always respond with valid JSON: an array of action objects. Example:
\`[{ "type": "move", "param": "timbre", "target": { "absolute": 0.55 } }, { "type": "say", "text": "Pushed toward the resonant peak." }]\`

If you have nothing to do, respond with: \`[]\``;
```

- [ ] **Step 2: Commit**

```bash
git add src/ai/system-prompt.ts && git commit -m "feat(ai): add system prompt for Claude AI collaborator"
```

---

### Task 13: State compression (TDD)

**Files:**
- Create: `src/ai/state-compression.ts`, `tests/ai/state-compression.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/ai/state-compression.test.ts

import { describe, it, expect } from 'vitest';
import { compressState } from '../../src/ai/state-compression';
import { createSession, setLeash, setAgency, updateTrackParams } from '../../src/engine/session';

describe('compressState', () => {
  it('compresses a default session', () => {
    const session = createSession();
    const compressed = compressState(session);
    expect(compressed.voice.engine).toBe('plaits:virtual_analog');
    expect(compressed.voice.params.timbre).toBe(0.5);
    expect(compressed.voice.agency).toBe('SUGGEST');
    expect(compressed.leash).toBe(0.5);
  });

  it('includes human message when provided', () => {
    const session = createSession();
    const compressed = compressState(session, 'make it darker');
    expect(compressed.human_message).toBe('make it darker');
  });

  it('omits human_message when not provided', () => {
    const session = createSession();
    const compressed = compressState(session);
    expect(compressed.human_message).toBeUndefined();
  });

  it('includes pending actions count', () => {
    const session = createSession();
    const compressed = compressState(session);
    expect(compressed.pending_count).toBe(0);
  });

  it('rounds param values to 2 decimal places', () => {
    const session = updateTrackParams(createSession(), { timbre: 0.33333 });
    const compressed = compressState(session);
    expect(compressed.voice.params.timbre).toBe(0.33);
  });

  it('includes recent human actions as formatted strings', () => {
    let session = createSession();
    session = updateTrackParams(session, { timbre: 0.8 }, true);
    const compressed = compressState(session);
    expect(compressed.recent_human_actions.length).toBe(1);
    expect(compressed.recent_human_actions[0]).toContain('timbre');
  });
});
```

- [ ] **Step 2: Run tests — verify failure**

```bash
npx vitest run tests/ai/state-compression.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/ai/state-compression.ts

import { Session } from '../engine/types';

export interface CompressedState {
  voice: {
    engine: string;
    model: number;
    params: Record<string, number>;
    agency: string;
  };
  leash: number;
  context: {
    energy: number;
    density: number;
  };
  pending_count: number;
  undo_depth: number;
  recent_human_actions: string[];
  human_message?: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function compressState(session: Session, humanMessage?: string): CompressedState {
  const result: CompressedState = {
    voice: {
      engine: session.voice.engine,
      model: session.voice.model,
      params: {
        harmonics: round2(session.voice.params.harmonics),
        timbre: round2(session.voice.params.timbre),
        morph: round2(session.voice.params.morph),
        note: round2(session.voice.params.note),
      },
      agency: session.voice.agency,
    },
    leash: round2(session.leash),
    context: {
      energy: round2(session.context.energy),
      density: round2(session.context.density),
    },
    pending_count: session.pending.length,
    undo_depth: session.undoStack.length,
    recent_human_actions: session.recentHumanActions.slice(-5).map(
      (a) => `${a.param}: ${a.from.toFixed(2)} -> ${a.to.toFixed(2)}`
    ),
  };

  if (humanMessage) {
    result.human_message = humanMessage;
  }

  return result;
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
npx vitest run tests/ai/state-compression.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/ai/state-compression.ts tests/ai/state-compression.test.ts && git commit -m "feat(ai): implement state compression with TDD"
```

---

### Task 14: Response parser (TDD)

**Files:**
- Create: `src/ai/response-parser.ts`, `tests/ai/response-parser.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/ai/response-parser.test.ts

import { describe, it, expect } from 'vitest';
import { parseAIResponse } from '../../src/ai/response-parser';

describe('parseAIResponse', () => {
  it('parses a move action', () => {
    const response = '[{ "type": "move", "param": "timbre", "target": { "absolute": 0.7 } }]';
    const actions = parseAIResponse(response);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('move');
    if (actions[0].type === 'move') {
      expect(actions[0].param).toBe('timbre');
      expect(actions[0].target).toEqual({ absolute: 0.7 });
    }
  });

  it('parses a say action', () => {
    const response = '[{ "type": "say", "text": "Hello" }]';
    const actions = parseAIResponse(response);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({ type: 'say', text: 'Hello' });
  });

  it('parses multiple actions', () => {
    const response = `[
      { "type": "move", "param": "morph", "target": { "absolute": 0.3 } },
      { "type": "say", "text": "Darkened the color." }
    ]`;
    const actions = parseAIResponse(response);
    expect(actions).toHaveLength(2);
  });

  it('parses suggest action', () => {
    const response = '[{ "type": "suggest", "changes": { "timbre": 0.8 }, "reason": "try this" }]';
    const actions = parseAIResponse(response);
    expect(actions[0].type).toBe('suggest');
  });

  it('parses audition action', () => {
    const response = '[{ "type": "audition", "changes": { "morph": 0.2 }, "duration": 3000 }]';
    const actions = parseAIResponse(response);
    expect(actions[0].type).toBe('audition');
  });

  it('returns empty array for empty response', () => {
    expect(parseAIResponse('[]')).toEqual([]);
  });

  it('returns empty array for invalid JSON', () => {
    expect(parseAIResponse('not json')).toEqual([]);
  });

  it('filters out actions with unknown types', () => {
    const response = '[{ "type": "unknown", "foo": "bar" }, { "type": "say", "text": "hi" }]';
    const actions = parseAIResponse(response);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('say');
  });

  it('extracts JSON from markdown code blocks', () => {
    const response = 'Here is my response:\n```json\n[{ "type": "say", "text": "hi" }]\n```';
    const actions = parseAIResponse(response);
    expect(actions).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests — verify failure**

```bash
npx vitest run tests/ai/response-parser.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/ai/response-parser.ts

import { AIAction } from '../engine/types';

const VALID_TYPES = ['move', 'suggest', 'audition', 'say', 'sketch'];

function extractJSON(text: string): string {
  // Try to extract JSON from markdown code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  return text.trim();
}

export function parseAIResponse(response: string): AIAction[] {
  try {
    const jsonStr = extractJSON(response);
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (action: Record<string, unknown>) =>
        action && typeof action.type === 'string' && VALID_TYPES.includes(action.type),
    ) as AIAction[];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
npx vitest run tests/ai/response-parser.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/ai/response-parser.ts tests/ai/response-parser.test.ts && git commit -m "feat(ai): implement response parser with TDD"
```

---

### Task 15: Parameter automation engine (TDD)

**Files:**
- Create: `src/ai/automation.ts`, `tests/ai/automation.test.ts`

Handles smooth parameter interpolation for `move` actions with an `over` duration.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/ai/automation.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutomationEngine } from '../../src/ai/automation';

describe('AutomationEngine', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('starts with no active automations', () => {
    const engine = new AutomationEngine();
    expect(engine.getActiveCount()).toBe(0);
  });

  it('interpolates a value over time', () => {
    const engine = new AutomationEngine();
    const values: number[] = [];
    engine.start('timbre', 0.0, 1.0, 1000, (param, value) => {
      values.push(value);
    });

    expect(engine.getActiveCount()).toBe(1);

    // Advance fake timers so Date.now() moves forward, then tick
    vi.advanceTimersByTime(500);
    engine.tick(Date.now());
    expect(values.length).toBe(1);
    expect(values[0]).toBeCloseTo(0.5, 1);

    // Advance to 1000ms total
    vi.advanceTimersByTime(500);
    engine.tick(Date.now());
    expect(values[values.length - 1]).toBeCloseTo(1.0, 1);
    expect(engine.getActiveCount()).toBe(0);
  });

  it('cancels an automation', () => {
    const engine = new AutomationEngine();
    const cb = vi.fn();
    engine.start('timbre', 0.0, 1.0, 1000, cb);
    engine.cancel('timbre');
    expect(engine.getActiveCount()).toBe(0);
    vi.advanceTimersByTime(500);
    engine.tick(Date.now());
    expect(cb).not.toHaveBeenCalled();
  });

  it('replaces existing automation on same param', () => {
    const engine = new AutomationEngine();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    engine.start('timbre', 0.0, 1.0, 1000, cb1);
    engine.start('timbre', 0.5, 0.8, 500, cb2);
    expect(engine.getActiveCount()).toBe(1);
    vi.advanceTimersByTime(250);
    engine.tick(Date.now());
    expect(cb2).toHaveBeenCalled();
    expect(cb1).toHaveBeenCalledTimes(0); // old one cancelled
  });
});
```

- [ ] **Step 2: Run tests — verify failure**

```bash
npx vitest run tests/ai/automation.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/ai/automation.ts

type AutomationCallback = (param: string, value: number) => void;

interface ActiveAutomation {
  param: string;
  startValue: number;
  endValue: number;
  durationMs: number;
  startTime: number;
  callback: AutomationCallback;
}

export class AutomationEngine {
  private automations: Map<string, ActiveAutomation> = new Map();
  private rafId: number | null = null;
  private lastTickTime = 0;

  start(
    param: string,
    startValue: number,
    endValue: number,
    durationMs: number,
    callback: AutomationCallback,
  ): void {
    this.automations.set(param, {
      param,
      startValue,
      endValue,
      durationMs,
      startTime: Date.now(),
      callback,
    });
  }

  cancel(param: string): void {
    this.automations.delete(param);
  }

  cancelAll(): void {
    this.automations.clear();
  }

  getActiveCount(): number {
    return this.automations.size;
  }

  /** Called externally (e.g. via requestAnimationFrame) with current timestamp */
  tick(now: number): void {
    const toRemove: string[] = [];

    for (const [key, auto] of this.automations) {
      const elapsed = now - auto.startTime;
      const progress = Math.min(1, elapsed / auto.durationMs);
      const value = auto.startValue + (auto.endValue - auto.startValue) * progress;
      auto.callback(auto.param, value);

      if (progress >= 1) {
        toRemove.push(key);
      }
    }

    for (const key of toRemove) {
      this.automations.delete(key);
    }
  }

  /** Start a requestAnimationFrame loop for browser use */
  startLoop(): void {
    const loop = () => {
      this.tick(Date.now());
      if (this.automations.size > 0) {
        this.rafId = requestAnimationFrame(loop);
      } else {
        this.rafId = null;
      }
    };
    if (this.rafId === null && this.automations.size > 0) {
      this.rafId = requestAnimationFrame(loop);
    }
  }

  stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
npx vitest run tests/ai/automation.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/ai/automation.ts tests/ai/automation.test.ts && git commit -m "feat(ai): implement parameter automation engine with TDD"
```

---

### Task 16: API client

**Files:**
- Create: `src/ai/api.ts`

- [ ] **Step 1: Create the API client**

```typescript
// src/ai/api.ts

import Anthropic from '@anthropic-ai/sdk';
import { Session, AIAction } from '../engine/types';
import { compressState } from './state-compression';
import { parseAIResponse } from './response-parser';
import { GLUON_SYSTEM_PROMPT } from './system-prompt';

export class GluonAI {
  private client: Anthropic | null = null;
  private conversationHistory: { role: 'user' | 'assistant'; content: string }[] = [];
  private lastCallTime = 0;
  private minCallInterval = 2000; // ms between reactive calls

  setApiKey(key: string): void {
    this.client = new Anthropic({
      apiKey: key,
      dangerouslyAllowBrowser: true,
    });
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  /** Call AI in response to human message */
  async ask(session: Session, humanMessage: string): Promise<AIAction[]> {
    if (!this.client) return [];
    const state = compressState(session, humanMessage);
    return this.call(JSON.stringify(state));
  }

  /** Call AI reactively. Rate limiting is handled by the caller (interval in App.tsx). */
  async react(session: Session): Promise<AIAction[]> {
    if (!this.client) return [];
    if (session.voice.agency === 'OFF') return [];
    if (session.leash < 0.3) return [];

    const state = compressState(session);
    return this.call(JSON.stringify(state));
  }

  private async call(userContent: string): Promise<AIAction[]> {
    if (!this.client) return [];
    this.lastCallTime = Date.now();

    this.conversationHistory.push({ role: 'user', content: userContent });

    // Keep conversation history manageable (last 10 exchanges)
    if (this.conversationHistory.length > 20) {
      this.conversationHistory = this.conversationHistory.slice(-20);
    }

    try {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system: GLUON_SYSTEM_PROMPT,
        messages: this.conversationHistory,
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      this.conversationHistory.push({ role: 'assistant', content: text });

      return parseAIResponse(text);
    } catch (error) {
      console.error('Gluon AI call failed:', error);
      return [];
    }
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ai/api.ts && git commit -m "feat(ai): add Anthropic API client for Gluon AI collaborator"
```

---

## Chunk 4: UI Components

### Task 17: App shell with dark theme

**Files:**
- Create: `src/ui/App.tsx`, update `src/index.tsx`, update `src/index.css`

- [ ] **Step 1: Set up entry point**

```typescript
// src/index.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './ui/App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 2: Create App shell**

```tsx
// src/ui/App.tsx
import { useState, useCallback, useRef, useEffect } from 'react';
import { AudioEngine } from '../audio/audio-engine';
import { Session, AIAction } from '../engine/types';
import { createSession, setLeash, setAgency, updateTrackParams, setModel } from '../engine/session';
import { applyMove, applyMoveGroup, applyParamDirect, applySuggest, applyAudition, cancelAuditionParam, applyUndo, commitPending, dismissPending } from '../engine/primitives';
import { GluonAI } from '../ai/api';
import { Arbitrator } from '../engine/arbitration';
import { AutomationEngine } from '../ai/automation';
import { ParameterSpace } from './ParameterSpace';
import { ModelSelector } from './ModelSelector';
import { LeashSlider } from './LeashSlider';
import { AgencyToggle } from './AgencyToggle';
import { ChatPanel } from './ChatPanel';
import { Visualiser } from './Visualiser';
import { PendingOverlay } from './PendingOverlay';
import { PitchControl } from './PitchControl';
import { UndoButton } from './UndoButton';
import { ApiKeyInput } from './ApiKeyInput';

export default function App() {
  const [session, setSession] = useState<Session>(createSession);
  const [audioStarted, setAudioStarted] = useState(false);
  const [apiConfigured, setApiConfigured] = useState(false);
  const audioRef = useRef(new AudioEngine());
  const aiRef = useRef(new GluonAI());
  const arbRef = useRef(new Arbitrator());
  const autoRef = useRef(new AutomationEngine());
  // Use a ref to avoid stale closure issues with session in async callbacks
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const startAudio = useCallback(async () => {
    await audioRef.current.start();
    setAudioStarted(true);
  }, []);

  // Sync params to audio engine whenever session changes
  useEffect(() => {
    if (!audioStarted) return;
    audioRef.current.setParams(session.voice.params);
    audioRef.current.setModel(session.voice.model);
  }, [session.voice.params, session.voice.model, audioStarted]);

  // Dispatch AI actions into the session
  const dispatchAIActions = useCallback((actions: AIAction[]) => {
    setSession((s) => {
      let next = s;
      // Collect move actions for grouping into a single undo entry
      const moveActions: { param: string; target: { absolute: number } | { relative: number } }[] = [];

      for (const action of actions) {
        switch (action.type) {
          case 'move':
            if (arbRef.current.canAIAct(action.param)) {
              if (action.over) {
                // Smooth automation: push ONE undo entry now, then use applyParamDirect for ticks
                const currentVal = next.voice.params[action.param] ?? 0;
                const targetVal = 'absolute' in action.target ? action.target.absolute : currentVal + action.target.relative;
                // Push undo entry capturing the pre-automation value
                next = {
                  ...next,
                  undoStack: [...next.undoStack, {
                    prevValues: { [action.param]: currentVal },
                    aiTargetValues: { [action.param]: targetVal },
                    timestamp: Date.now(),
                    description: `AI drift: ${action.param} ${currentVal.toFixed(2)} -> ${targetVal.toFixed(2)} over ${action.over}ms`,
                  }],
                };
                autoRef.current.start(action.param, currentVal, targetVal, action.over, (param, value) => {
                  // applyParamDirect does NOT push to undo — the entry was already created above
                  setSession((s2) => applyParamDirect(s2, param, value));
                });
                autoRef.current.startLoop();
              } else {
                moveActions.push({ param: action.param, target: action.target });
              }
            }
            break;
          case 'suggest':
            if (next.voice.agency !== 'OFF') {
              next = applySuggest(next, action.changes, action.reason);
            }
            break;
          case 'audition':
            if (next.voice.agency === 'PLAY') {
              next = applyAudition(next, action.changes, action.duration);
            }
            break;
          case 'say':
            next = {
              ...next,
              messages: [...next.messages, { role: 'ai' as const, text: action.text, timestamp: Date.now() }],
            };
            break;
          case 'sketch':
            // Phase 1 stub: log sketch but don't apply (no sequencer yet)
            next = {
              ...next,
              messages: [...next.messages, {
                role: 'ai' as const,
                text: `[Sketch: ${action.description}] (sketches not yet supported in Phase 1)`,
                timestamp: Date.now(),
              }],
            };
            break;
        }
      }

      // Apply collected moves as a single action group (one undo entry)
      if (moveActions.length > 0) {
        next = moveActions.length === 1
          ? applyMove(next, moveActions[0].param, moveActions[0].target)
          : applyMoveGroup(next, moveActions);
      }

      return next;
    });
  }, []);

  const handleParamChange = useCallback((timbre: number, morph: number) => {
    arbRef.current.humanTouched('timbre');
    arbRef.current.humanTouched('morph');
    setSession((s) => {
      // Cancel auditioned params the human is now controlling
      let next = cancelAuditionParam(s, 'timbre');
      next = cancelAuditionParam(next, 'morph');
      return updateTrackParams(next, { timbre, morph }, true);
    });
  }, []);

  const handleNoteChange = useCallback((note: number) => {
    arbRef.current.humanTouched('note');
    setSession((s) => {
      const next = cancelAuditionParam(s, 'note');
      return updateTrackParams(next, { note }, true);
    });
  }, []);

  const handleHarmonicsChange = useCallback((harmonics: number) => {
    arbRef.current.humanTouched('harmonics');
    setSession((s) => {
      const next = cancelAuditionParam(s, 'harmonics');
      return updateTrackParams(next, { harmonics }, true);
    });
  }, []);

  const handleModelChange = useCallback((model: number) => {
    setSession((s) => setModel(s, model));
  }, []);

  const handleLeashChange = useCallback((value: number) => {
    setSession((s) => setLeash(s, value));
  }, []);

  const handleAgencyChange = useCallback((agency: 'OFF' | 'SUGGEST' | 'PLAY') => {
    setSession((s) => setAgency(s, agency));
  }, []);

  const handleUndo = useCallback(() => {
    setSession((s) => applyUndo(s));
  }, []);

  const handleSend = useCallback(async (message: string) => {
    setSession((s) => ({
      ...s,
      messages: [...s.messages, { role: 'human' as const, text: message, timestamp: Date.now() }],
    }));

    // Use sessionRef to avoid stale closure
    const actions = await aiRef.current.ask(sessionRef.current, message);
    dispatchAIActions(actions);
  }, [dispatchAIActions]);

  const handleCommit = useCallback((pendingId: string) => {
    setSession((s) => commitPending(s, pendingId));
  }, []);

  const handleDismiss = useCallback((pendingId: string) => {
    setSession((s) => dismissPending(s, pendingId));
  }, []);

  const handleApiKey = useCallback((key: string) => {
    aiRef.current.setApiKey(key);
    setApiConfigured(true);
  }, []);

  // Keyboard shortcut for undo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo]);

  // Reactive AI: debounced calls when human changes params and leash > 0.3
  useEffect(() => {
    if (!audioStarted) return;
    const interval = setInterval(async () => {
      const s = sessionRef.current;
      if (!aiRef.current.isConfigured()) return;
      if (s.voice.agency === 'OFF') return;
      if (s.leash < 0.3) return;
      const actions = await aiRef.current.react(s);
      if (actions.length > 0) dispatchAIActions(actions);
    }, 3000); // Check every 3 seconds
    return () => clearInterval(interval);
  }, [audioStarted, dispatchAIActions]);

  // Audition auto-revert: dismiss expired auditions
  useEffect(() => {
    if (session.pending.length === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setSession((s) => {
        const expired = s.pending.filter((p) => p.type === 'audition' && p.expiresAt < now);
        if (expired.length === 0) return s;
        let next = s;
        for (const p of expired) {
          next = dismissPending(next, p.id);
        }
        return next;
      });
    }, 500);
    return () => clearInterval(interval);
  }, [session.pending.length]);

  if (!audioStarted) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="text-center space-y-6">
          <h1 className="text-4xl font-light tracking-wider">GLUON</h1>
          <p className="text-zinc-400 text-sm">human-AI music collaboration</p>
          <button
            onClick={startAudio}
            className="px-8 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm tracking-wide transition-colors"
          >
            Start Audio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4">
      <div className="max-w-7xl mx-auto grid grid-cols-[1fr_320px] gap-4 h-[calc(100vh-2rem)]">
        {/* Left column: Parameter space + visualiser */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-light tracking-wider text-zinc-400">GLUON</h1>
            <div className="flex items-center gap-4">
              <ModelSelector model={session.voice.model} onChange={handleModelChange} />
              <UndoButton onClick={handleUndo} disabled={session.undoStack.length === 0} />
            </div>
          </div>

          <div className="relative flex-1 min-h-0">
            <ParameterSpace
              timbre={session.voice.params.timbre}
              morph={session.voice.params.morph}
              onChange={handleParamChange}
              onInteractionStart={() => arbRef.current.humanInteractionStart()}
              onInteractionEnd={() => arbRef.current.humanInteractionEnd()}
            />
            <PendingOverlay pending={session.pending} onCommit={handleCommit} onDismiss={handleDismiss} />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <Visualiser analyser={audioRef.current.getAnalyser()} />
            </div>
            <PitchControl
              note={session.voice.params.note}
              harmonics={session.voice.params.harmonics}
              onNoteChange={handleNoteChange}
              onHarmonicsChange={handleHarmonicsChange}
            />
          </div>
        </div>

        {/* Right column: Controls + chat */}
        <div className="flex flex-col gap-4">
          <ApiKeyInput onSubmit={handleApiKey} isConfigured={apiConfigured} />
          <LeashSlider value={session.leash} onChange={handleLeashChange} />
          <AgencyToggle value={session.voice.agency} onChange={handleAgencyChange} />
          <ChatPanel messages={session.messages} onSend={handleSend} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/index.tsx src/ui/App.tsx && git commit -m "feat(ui): create App shell with dark theme and layout"
```

---

### Task 18: 2D Parameter Space component

**Files:**
- Create: `src/ui/ParameterSpace.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/ui/ParameterSpace.tsx
import { useRef, useEffect, useCallback } from 'react';

interface Props {
  timbre: number;    // 0-1, x-axis
  morph: number;     // 0-1, y-axis
  onChange: (timbre: number, morph: number) => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
}

export function ParameterSpace({ timbre, morph, onChange, onInteractionStart, onInteractionEnd }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDragging = useRef(false);

  const getPosition = useCallback((e: MouseEvent | Touch, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)); // invert Y
    return { x, y };
  }, []);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      const x = (i / 10) * w;
      const y = (i / 10) * h;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Axis labels
    ctx.fillStyle = '#555';
    ctx.font = '11px monospace';
    ctx.fillText('TIMBRE →', 10, h - 8);
    ctx.save();
    ctx.translate(12, h - 20);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('COLOR →', 0, 0);
    ctx.restore();

    // Crosshair
    const cx = timbre * w;
    const cy = (1 - morph) * h;

    ctx.strokeStyle = '#666';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
    ctx.setLineDash([]);

    // Dot
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#e4e4e7';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#18181b';
    ctx.fill();
  }, [timbre, morph]);

  // Mouse handlers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleDown = (e: MouseEvent) => {
      isDragging.current = true;
      onInteractionStart();
      const pos = getPosition(e, canvas);
      onChange(pos.x, pos.y);
    };

    const handleMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const pos = getPosition(e, canvas);
      onChange(pos.x, pos.y);
    };

    const handleUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        onInteractionEnd();
      }
    };

    // Touch handlers
    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      isDragging.current = true;
      onInteractionStart();
      const pos = getPosition(e.touches[0], canvas);
      onChange(pos.x, pos.y);
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (!isDragging.current) return;
      const pos = getPosition(e.touches[0], canvas);
      onChange(pos.x, pos.y);
    };

    const handleTouchEnd = () => {
      if (isDragging.current) {
        isDragging.current = false;
        onInteractionEnd();
      }
    };

    canvas.addEventListener('mousedown', handleDown);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      canvas.removeEventListener('mousedown', handleDown);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [onChange, onInteractionStart, onInteractionEnd, getPosition]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full rounded-lg cursor-crosshair"
      style={{ touchAction: 'none' }}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/ParameterSpace.tsx && git commit -m "feat(ui): add 2D parameter space XY pad with touch support"
```

---

### Task 19: Model selector

**Files:**
- Create: `src/ui/ModelSelector.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/ui/ModelSelector.tsx
import { PLAITS_MODELS } from '../audio/synth-interface';

interface Props {
  model: number;
  onChange: (model: number) => void;
}

export function ModelSelector({ model, onChange }: Props) {
  return (
    <select
      value={model}
      onChange={(e) => onChange(Number(e.target.value))}
      className="bg-zinc-800 text-zinc-200 text-sm rounded px-3 py-1.5 border border-zinc-700 focus:outline-none focus:border-zinc-500"
    >
      {PLAITS_MODELS.map((m) => (
        <option key={m.index} value={m.index}>
          {m.name}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/ModelSelector.tsx && git commit -m "feat(ui): add Plaits model selector dropdown"
```

---

### Task 20: Pitch and harmonics control

**Files:**
- Create: `src/ui/PitchControl.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/ui/PitchControl.tsx
import { midiToNote } from '../audio/synth-interface';

/** Preset notes as normalised values (MIDI / 127) */
const PRESET_NOTES = [
  { name: 'C2', note: midiToNote(36) },
  { name: 'C3', note: midiToNote(48) },
  { name: 'E3', note: midiToNote(52) },
  { name: 'G3', note: midiToNote(55) },
  { name: 'A3', note: midiToNote(57) },
  { name: 'C4', note: midiToNote(60) },
  { name: 'C5', note: midiToNote(72) },
];

interface Props {
  note: number;       // 0.0-1.0 normalised
  harmonics: number;
  onNoteChange: (note: number) => void;
  onHarmonicsChange: (harmonics: number) => void;
}

export function PitchControl({ note, harmonics, onNoteChange, onHarmonicsChange }: Props) {
  return (
    <div className="space-y-2 w-48">
      <div className="text-xs text-zinc-400">PITCH</div>
      <div className="flex flex-wrap gap-1">
        {PRESET_NOTES.map((preset) => (
          <button
            key={preset.name}
            onClick={() => onNoteChange(preset.note)}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              Math.abs(note - preset.note) < 0.01
                ? 'bg-zinc-600 text-zinc-100'
                : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-750'
            }`}
          >
            {preset.name}
          </button>
        ))}
      </div>
      <div className="text-xs text-zinc-400 mt-2">HARMONICS</div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={harmonics}
        onChange={(e) => onHarmonicsChange(Number(e.target.value))}
        className="w-full accent-zinc-400"
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/PitchControl.tsx && git commit -m "feat(ui): add pitch preset buttons and harmonics slider"
```

---

### Task 21: Leash slider

**Files:**
- Create: `src/ui/LeashSlider.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/ui/LeashSlider.tsx

interface Props {
  value: number;
  onChange: (value: number) => void;
}

export function LeashSlider({ value, onChange }: Props) {
  const label =
    value < 0.1 ? 'Silent' :
    value < 0.3 ? 'Observing' :
    value < 0.5 ? 'Gentle' :
    value < 0.75 ? 'Active' :
    value < 0.9 ? 'Assertive' :
    'Full co-creation';

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-zinc-400">
        <span>LEASH</span>
        <span>{label} ({(value * 100).toFixed(0)}%)</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-zinc-400"
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/LeashSlider.tsx && git commit -m "feat(ui): add leash slider with descriptive labels"
```

---

### Task 22: Agency toggle

**Files:**
- Create: `src/ui/AgencyToggle.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/ui/AgencyToggle.tsx
import { Agency } from '../engine/types';

interface Props {
  value: Agency;
  onChange: (agency: Agency) => void;
}

const OPTIONS: { value: Agency; label: string; desc: string }[] = [
  { value: 'OFF', label: 'OFF', desc: 'AI observes only' },
  { value: 'SUGGEST', label: 'SUGGEST', desc: 'AI proposes, you decide' },
  { value: 'PLAY', label: 'PLAY', desc: 'AI jams with you' },
];

export function AgencyToggle({ value, onChange }: Props) {
  return (
    <div className="space-y-2">
      <div className="text-xs text-zinc-400">AGENCY</div>
      <div className="flex gap-1">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            title={opt.desc}
            className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors ${
              value === opt.value
                ? 'bg-zinc-600 text-zinc-100'
                : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-750'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/AgencyToggle.tsx && git commit -m "feat(ui): add agency toggle (OFF/SUGGEST/PLAY)"
```

---

### Task 23: Chat panel

**Files:**
- Create: `src/ui/ChatPanel.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/ui/ChatPanel.tsx
import { useState, useRef, useEffect } from 'react';
import { ChatMessage } from '../engine/types';

interface Props {
  messages: ChatMessage[];
  onSend: (message: string) => void;
}

export function ChatPanel({ messages, onSend }: Props) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onSend(input.trim());
    setInput('');
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="text-xs text-zinc-400 mb-2">CHAT</div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-2 mb-2 min-h-0">
        {messages.length === 0 && (
          <p className="text-zinc-600 text-xs italic">Try: "make it darker" or "surprise me"</p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`text-sm ${msg.role === 'ai' ? 'text-zinc-300' : 'text-zinc-500'}`}>
            <span className="text-zinc-600 text-xs">{msg.role === 'ai' ? 'AI' : 'You'}:</span>{' '}
            {msg.text}
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Talk to the AI..."
          className="flex-1 bg-zinc-800 text-zinc-200 text-sm rounded px-3 py-2 border border-zinc-700 focus:outline-none focus:border-zinc-500"
        />
        <button
          type="submit"
          className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-sm rounded transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/ChatPanel.tsx && git commit -m "feat(ui): add chat panel for human-AI conversation"
```

---

## Chunk 5: Remaining UI + Integration

### Task 24: Undo button, API key input, and pending overlay

**Files:**
- Create: `src/ui/UndoButton.tsx`, `src/ui/ApiKeyInput.tsx`, `src/ui/PendingOverlay.tsx`

- [ ] **Step 1: Create UndoButton**

```tsx
// src/ui/UndoButton.tsx

interface Props {
  onClick: () => void;
  disabled: boolean;
}

export function UndoButton({ onClick, disabled }: Props) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title="Undo last AI action (Ctrl+Z)"
      className={`px-3 py-1.5 text-sm rounded transition-colors ${
        disabled
          ? 'bg-zinc-900 text-zinc-700 cursor-not-allowed'
          : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
      }`}
    >
      Undo
    </button>
  );
}
```

- [ ] **Step 2: Create ApiKeyInput**

```tsx
// src/ui/ApiKeyInput.tsx
import { useState } from 'react';

interface Props {
  onSubmit: (key: string) => void;
  isConfigured: boolean;
}

export function ApiKeyInput({ onSubmit, isConfigured }: Props) {
  const [key, setKey] = useState('');

  if (isConfigured) {
    return (
      <div className="text-xs text-emerald-600 bg-zinc-900 rounded px-3 py-2">
        API key set
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (key.trim()) onSubmit(key.trim()); }}
      className="flex gap-2"
    >
      <input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="Anthropic API key"
        className="flex-1 bg-zinc-800 text-zinc-200 text-xs rounded px-3 py-2 border border-zinc-700 focus:outline-none focus:border-zinc-500"
      />
      <button type="submit" className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-xs rounded transition-colors">
        Set
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Create PendingOverlay**

```tsx
// src/ui/PendingOverlay.tsx
import { PendingAction } from '../engine/types';

interface Props {
  pending: PendingAction[];
  onCommit: (id: string) => void;
  onDismiss: (id: string) => void;
}

export function PendingOverlay({ pending, onCommit, onDismiss }: Props) {
  if (pending.length === 0) return null;

  return (
    <div className="absolute bottom-4 left-4 right-4 space-y-2">
      {pending.map((p) => (
        <div
          key={p.id}
          className={`flex items-center justify-between rounded px-3 py-2 text-sm ${
            p.type === 'suggestion'
              ? 'bg-zinc-800/90 border border-zinc-600'
              : 'bg-amber-900/50 border border-amber-700'
          }`}
        >
          <div>
            <span className="text-xs text-zinc-400 uppercase mr-2">{p.type}</span>
            <span className="text-zinc-300">
              {Object.entries(p.changes)
                .map(([k, v]) => `${k}: ${(v as number).toFixed(2)}`)
                .join(', ')}
            </span>
            {p.reason && <span className="text-zinc-500 ml-2 text-xs">— {p.reason}</span>}
          </div>
          <div className="flex gap-2 ml-4">
            <button onClick={() => onCommit(p.id)} className="text-xs px-2 py-1 bg-zinc-700 hover:bg-zinc-600 rounded">
              Keep
            </button>
            <button onClick={() => onDismiss(p.id)} className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded">
              Nah
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/ui/UndoButton.tsx src/ui/ApiKeyInput.tsx src/ui/PendingOverlay.tsx && git commit -m "feat(ui): add undo button, API key input, and pending overlay"
```

---

### Task 25: Waveform visualiser

**Files:**
- Create: `src/ui/Visualiser.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/ui/Visualiser.tsx
import { useRef, useEffect } from 'react';

interface Props {
  analyser: AnalyserNode | null;
}

export function Visualiser({ analyser }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!analyser) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    analyser.fftSize = 2048;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    let animId: number;

    const draw = () => {
      animId = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      const w = rect.width;
      const h = rect.height;

      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, w, h);

      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#52525b';
      ctx.beginPath();

      const sliceWidth = w / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * h) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.lineTo(w, h / 2);
      ctx.stroke();
    };

    draw();
    return () => cancelAnimationFrame(animId);
  }, [analyser]);

  return <canvas ref={canvasRef} className="w-full h-16 rounded" />;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/Visualiser.tsx && git commit -m "feat(ui): add waveform visualiser using AnalyserNode"
```

---

### Task 26: Clean up and verify end-to-end

**Files:**
- Modify: `src/ui/App.tsx` (if needed), `public/index.html`

- [ ] **Step 1: Update index.html**

```html
<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Gluon</title>
  </head>
  <body class="bg-zinc-950">
    <div id="root"></div>
    <script type="module" src="/src/index.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Verify the app builds**

```bash
npx tsc --noEmit
```

Expected: No type errors (there may be some — fix them).

- [ ] **Step 3: Run all tests**

```bash
npx vitest run
```

Expected: All engine and AI layer tests pass.

- [ ] **Step 4: Run the dev server and manually test**

```bash
npm run dev
```

Manual test checklist:
1. App loads with "Start Audio" screen
2. Click "Start Audio" — hear synthesis
3. Click/drag the parameter space — sound changes in real time
4. Change the model — sound character changes
5. Move the leash slider — label updates
6. Toggle agency — buttons highlight
7. Enter API key — shows "API key set"
8. Type a message — it appears in chat
9. If API key is valid, AI responds with actions
10. Undo button reverses AI moves (grouped moves undo together)
11. Cmd/Ctrl+Z also triggers undo
12. Auditions auto-revert after a few seconds if not committed
13. With leash > 0.3 and agency PLAY, AI occasionally acts on its own
14. Pitch preset buttons change the note
15. Harmonics slider changes harmonic content

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: wire up Phase 1 end-to-end — Gluon proof of concept"
```

---

## Post-Completion Notes

### WASM Spike (Parallel Track)

Tasks 5-6 are a spike with explicit success criteria (see Task 5). They run independently of everything else. If the spike succeeds:

1. Update `AudioEngine` to detect and load the WASM module
2. Replace the fallback synth with the AudioWorklet processor
3. The rest of the app (engine, AI, UI) works unchanged since everything goes through `AudioEngine`

If the spike is incomplete at Phase 1 delivery, the fallback synth is the demo engine. The interaction loop is the deliverable, not the synthesis quality.

### Known Limitations

- **API key in browser**: Not secure for production. Phase 2 should add a backend proxy.
- **Single voice only**: The protocol defines `tracks: [Voice]` (array). Phase 1 simplifies to `voice: Voice`. This is a deliberate scope reduction, not protocol-aligned — the types will need to generalize for Phase 2.
- **Sketch primitive is stubbed**: `sketch` actions from the AI are logged to chat but not applied (no sequencer/pattern editor in Phase 1).
- **Agency enforcement is in the UI layer only**: This is a deliberate shortcut that weakens invariants. The engine primitives accept any action regardless of agency — the App component gates actions before dispatching. This means the protocol engine is not self-protecting. Phase 2 must move enforcement into the engine layer so that `applyMove` on an OFF voice returns the session unchanged.
- **Fallback synth is the default demo engine**: The Web Audio fallback is minimal (single oscillator + filter). If the WASM spike succeeds, the real Plaits engine provides rich timbral exploration. If not, the demo proves the interaction loop but undersells the synthesis quality.
