# Gluon: Phase 1 Prototype
## Claude Code Implementation Brief

---

## Context

Gluon is an open source platform for human-AI music collaboration. The human and an AI share control of a musical instrument. The AI can suggest, audition, and directly move synthesis parameters, but the human's hands always win.

The full protocol spec is in `gluon-interaction-protocol-v05.md`. Read it first. It's short.

This document describes what to build for Phase 1: a browser-based proof of concept that demonstrates the core Gluon interaction.

---

## What Phase 1 Is

A web application where:

1. A Mutable Instruments Plaits synthesis engine runs in the browser (compiled to WebAssembly)
2. The human explores a 2D parameter space (TIMBRE x COLOR) by clicking/touching
3. An AI (Claude, via the Anthropic API) can describe what the human is hearing, suggest parameter moves, audition changes, and respond to natural language instructions
4. A leash slider controls how active the AI is
5. Per-voice agency can be set to OFF / SUGGEST / PLAY
6. Undo reverses AI actions

This is Jam Mode, standalone, single voice to start. No DAW integration, no hardware MIDI, no sequencer yet. Just a human and an AI exploring a shared synthesiser.

---

## Technical Architecture

```
Browser
+----------------------------------------------------------+
|                                                          |
|  React UI                                                |
|  - 2D parameter space (canvas)                           |
|  - Engine selector (Plaits model picker)                 |
|  - Leash slider                                          |
|  - Agency toggle per voice                               |
|  - Chat panel (human <-> AI)                             |
|  - Undo button                                           |
|  - Waveform/spectrum visualiser                          |
|                                                          |
|  Gluon Engine (TypeScript)                               |
|  - Session state management                              |
|  - Protocol primitive dispatch                           |
|  - Undo stack                                            |
|  - Pending action management                             |
|  - AI action scheduling                                  |
|                                                          |
|  AI Layer (TypeScript)                                   |
|  - Anthropic API calls                                   |
|  - State compression (session -> prompt)                 |
|  - Response parsing (text -> protocol primitives)        |
|  - Smooth parameter automation (local, no API call)      |
|                                                          |
|  Audio Engine                                            |
|  - Plaits WASM module (C++ compiled via Emscripten)      |
|  - AudioWorklet for real-time audio processing           |
|  - Web Audio API output                                  |
|                                                          |
+----------------------------------------------------------+
```

---

## Step-by-Step Build Plan

### Step 1: Get Plaits Making Sound in the Browser

**Goal:** A web page where you can hear Plaits synthesis.

**Source code:** Clone `github.com/pichenettes/eurorack`. The Plaits source is in `plaits/`. The DSP code is in `plaits/dsp/` and is cleanly separated from the hardware drivers in `plaits/drivers/`.

**Approach:**

1. Extract the Plaits DSP code (the `dsp/` directory and its dependencies from `stmlib/`). You need:
   - `plaits/dsp/` (all synthesis models, the voice class, the modulations)
   - `stmlib/dsp/` (common DSP utilities: filters, oscillators, math)
   - `stmlib/utils/` (ring buffer, etc.)
   - You do NOT need the `drivers/` directory (that's STM32 hardware-specific)

2. Create a thin C++ wrapper that exposes a simple interface:
   ```cpp
   // gluon_plaits.cpp
   extern "C" {
     void* plaits_create();                    // Create a voice instance
     void plaits_set_model(void* v, int model); // Set synthesis model (0-15)
     void plaits_set_params(void* v, float harmonics, float timbre, float morph, float freq, float note);
     void plaits_render(void* v, float* out_buffer, int num_frames);
     void plaits_destroy(void* v);
   }
   ```

   Internally this wraps `plaits::Voice` and `plaits::Patch` / `plaits::Modulations`.

3. Compile to WebAssembly with Emscripten:
   ```bash
   emcc gluon_plaits.cpp plaits/dsp/*.cc stmlib/dsp/*.cc \
     -I. -O2 -s WASM=1 \
     -s EXPORTED_FUNCTIONS='["_plaits_create","_plaits_set_model","_plaits_set_params","_plaits_render","_plaits_destroy","_malloc","_free"]' \
     -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
     -o plaits.js
   ```

   Note: This command is indicative. The actual compilation will require resolving include paths and potentially stubbing out any remaining hardware dependencies. The Plaits code uses floating-point DSP and should compile cleanly once hardware-specific includes are removed.

4. Create an AudioWorklet that calls `plaits_render()` to fill audio buffers:
   ```javascript
   // plaits-worklet.js
   class PlaitsProcessor extends AudioWorkletProcessor {
     process(inputs, outputs, parameters) {
       // Call into WASM to render audio
       // Copy output buffer to outputs[0]
       return true;
     }
   }
   ```

5. Connect the AudioWorklet to the Web Audio API output.

**Success criteria:** You hear Plaits synthesis in the browser. You can change the model and hear different sounds.

**Prior art to study:**
- VCV Rack's Audible Instruments (Plaits port): `github.com/VCVRack/AudibleInstruments`
- vb.mi.plaits Max/MSP port: `github.com/v7b1/vb.mi-dev`
- The Plaits source itself has a `plaits/test/` directory with a command-line test program that renders to WAV. This is the simplest reference for how to call the DSP code outside of the hardware context.

### Step 2: 2D Parameter Space UI

**Goal:** A visual interface where clicking/touching moves TIMBRE and COLOR, and you hear the result in real time.

**Approach:**

1. Create a React app with a canvas element that represents the TIMBRE (x-axis) x COLOR (y-axis) parameter space.

2. On mouse/touch interaction, update the Plaits parameters in real time via the WASM bridge.

3. Show a dot or crosshair at the current position.

4. Add a frequency/pitch control (could be a slider, a keyboard, or just a few preset notes).

5. Add a model selector (dropdown or grid of the 16 Plaits models).

6. Add a simple waveform visualiser (AnalyserNode from Web Audio API).

**UI notes:**
- The parameter space should feel like an instrument, not a settings panel. Think XY pad, not form fields.
- The response to touch/mouse must be immediate. No perceptible latency between moving your finger and hearing the change.
- Consider a dark theme. This is a musical instrument, not a productivity app.

### Step 3: Gluon Engine (State and Protocol)

**Goal:** Implement the session state model and protocol primitives from the spec.

**Approach:**

1. Define TypeScript types matching the protocol:
   ```typescript
   interface Session {
     voices: Voice[];
     leash: number;          // 0.0 - 1.0
     undoStack: Snapshot[];
     pending: PendingAction[];
     context: MusicalContext;
   }

   interface Voice {
     id: string;
     engine: string;
     params: Record<string, number>;  // All 0.0 - 1.0
     agency: 'OFF' | 'SUGGEST' | 'PLAY';
   }
   ```

2. Implement the human primitives:
   - `play`: Update voice params, push to WASM, notify AI layer
   - `undo`: Pop from undo stack, restore state
   - `commit`: Accept pending suggestion/audition
   - `dismiss`: Remove pending action
   - `setLeash`: Update leash value

3. Implement the AI primitives:
   - `suggest`: Add to pending, render ghost in UI
   - `audition`: Apply changes, schedule auto-revert, add to pending
   - `move`: Apply change, push to undo stack
   - `say`: Display in chat panel

4. Implement arbitration: if the human is currently interacting with a parameter (mousedown/touchstart active, or changed within last 500ms), block AI moves on that parameter.

5. Implement action groups: multiple related moves are one undo entry.

### Step 4: AI Layer

**Goal:** Connect Claude to the Gluon engine so it can reason about the session state and issue protocol primitives.

**Approach:**

1. **State compression:** Convert the current session state to a concise JSON prompt. Example:

   ```json
   {
     "voice": {
       "engine": "plaits:modal_resonator",
       "params": { "timbre": 0.45, "color": 0.72, "pitch": 60, "level": 0.8 },
       "agency": "PLAY"
     },
     "leash": 0.5,
     "context": { "energy": 0.4, "density": 0.2 },
     "recent_human_actions": ["color: 0.65 -> 0.72 over 8s (rising)"],
     "pending": [],
     "human_message": "make it ring more"
   }
   ```

2. **System prompt:** Instruct Claude to respond with structured actions:

   ```
   You are the AI collaborator in Gluon, a shared musical instrument.
   You are currently playing a Plaits synthesiser with the human.

   Your available actions:
   - suggest: Propose a parameter change (appears as a ghost, human must commit)
   - audition: Temporarily apply a change for 3 seconds (auto-reverts unless committed)
   - move: Change a parameter directly (immediately audible)
   - say: Speak to the human

   The voice agency is currently PLAY, meaning you can suggest, audition, and move.
   The leash is at 0.5, meaning you should be an active but not dominant participant.

   Respond with a JSON array of actions. Example:
   [
     { "type": "move", "param": "timbre", "target": { "absolute": 0.55 } },
     { "type": "say", "text": "Pushed timbre toward the resonant peak. Should ring more." }
   ]

   Be musical. Be concise. Don't over-explain.
   If the human hasn't asked you anything and the leash is low, you can just respond with [].
   ```

3. **API call pattern:**
   - On human `ask`: always call the API with the message and current state
   - On human `play` with leash > 0.3 and voice on PLAY: call the API at the reactive timescale (debounced, max once per 2 seconds) to see if the AI wants to respond
   - With leash > 0.6: the AI may also initiate periodically (every 5-10 seconds) without human prompting

4. **Response parsing:** Parse the JSON action array from the API response and dispatch each action through the Gluon engine.

5. **Smooth automation:** For `move` actions with an `over` duration, implement a local interpolation loop (requestAnimationFrame or setInterval at ~60fps) that smoothly transitions the parameter. No API call per frame.

6. **Anthropic API integration:**
   Use the Anthropic JS SDK. The API key should be entered by the user in a settings panel (this is a client-side app, there's no backend server in Phase 1). Alternatively, provide an option to enter a key or use a proxy endpoint.

   ```typescript
   import Anthropic from '@anthropic-ai/sdk';

   const client = new Anthropic({ apiKey: userProvidedKey });

   async function callAI(sessionState: CompressedState, humanMessage?: string) {
     const response = await client.messages.create({
       model: 'claude-sonnet-4-20250514',
       max_tokens: 500,
       system: GLUON_SYSTEM_PROMPT,
       messages: [{ role: 'user', content: JSON.stringify(sessionState) }]
     });
     return parseActions(response.content[0].text);
   }
   ```

### Step 5: Polish and Integration

**Goal:** Wire everything together into a cohesive experience.

1. Leash slider prominently placed, always visible
2. Agency toggle (OFF / SUGGEST / PLAY) per voice
3. Undo button (and keyboard shortcut: Cmd/Ctrl+Z)
4. Chat panel showing `say` messages from the AI and `ask` input from the human
5. Pending suggestions rendered as ghosts/highlights on the parameter space
6. Active auditions shown with a countdown indicator
7. Smooth transitions on all parameter changes

---

## Key Source Files to Study

From `github.com/pichenettes/eurorack`:

- `plaits/dsp/voice.h` and `voice.cc`: The main Voice class. This is what you instantiate and call `Render()` on.
- `plaits/dsp/engine/` directory: Individual synthesis model implementations (one file per model).
- `plaits/dsp/speech/` and `plaits/dsp/physical_modelling/`: Additional DSP for specific models.
- `plaits/resources.h` and `resources.cc`: Lookup tables and wavetables.
- `plaits/test/plaits_test.cc`: Command-line test program. **Start here.** This shows exactly how to create a Voice, set parameters, and render audio without any hardware.
- `stmlib/dsp/`: Shared DSP utilities used across all MI modules.

The test program (`plaits_test.cc`) is the Rosetta Stone for this project. It demonstrates the minimal code needed to get Plaits producing audio.

---

## Technology Choices

| Component | Choice | Rationale |
|---|---|---|
| UI framework | React | Widely known, good for state management, works well with canvas |
| Build tool | Vite | Fast, good WASM support, modern |
| Language | TypeScript | Type safety for the protocol types |
| Audio | Web Audio API + AudioWorklet | Required for real-time audio in the browser |
| WASM compilation | Emscripten | Standard for C++ to WASM, well-documented |
| AI | Anthropic API (Claude Sonnet) | Good balance of speed and reasoning for interactive use |
| Styling | Tailwind CSS | Fast iteration, dark theme support |

---

## What Success Looks Like

When Phase 1 is done, the following experience should work:

1. You open the app in a browser
2. You see a dark 2D parameter space and a model selector
3. You click/touch the parameter space and hear Plaits synthesis responding in real time
4. You type "make it darker" in the chat panel
5. The AI responds by moving parameters (if agency is PLAY) or suggesting moves (if agency is SUGGEST)
6. You drag the leash slider up and the AI becomes more active, occasionally nudging parameters on its own
7. You drag the leash slider down and the AI goes quiet
8. You press undo and the last AI action is reversed
9. The AI says something like "You're in a metallic, bell-like space. Push color up for something more glassy." and you can try its suggestion

That's the demo. If that works and feels good, Phase 2 (multiple voices, effects, sequencer, MIDI output) has a solid foundation.

---

## Non-Goals for Phase 1

- No DAW integration
- No hardware MIDI
- No sequencer or pattern editor
- No multiple simultaneous voices (start with one)
- No audio input / sampling
- No user accounts or persistence
- No mobile-optimised layout (desktop browser first, touch support is nice-to-have)
- No local/offline AI (API only for now)

---

## Risks and Unknowns

**WASM compilation of Plaits:** This is the highest-risk step. The Plaits code was written for STM32 and uses some platform-specific features (lookup table generation, fixed-point math utilities). The DSP core should be portable, but there may be friction in the compilation. The VCV Rack and Max/MSP ports prove it's possible, but they compiled to native, not WASM. Budget extra time here.

**AudioWorklet + WASM integration:** Running WASM inside an AudioWorklet has some specific constraints (SharedArrayBuffer, cross-origin isolation headers). This is well-documented but fiddly. Make sure the dev server sets the right CORS headers.

**API latency for reactive timescale:** Claude Sonnet calls typically take 1-3 seconds. For the reactive timescale (responding to what the human just did), this may feel sluggish. If it does, consider: (a) using a faster/smaller model for reactive responses, (b) pre-computing likely responses, or (c) accepting that the reactive timescale is more like 2-3 seconds than the ideal 100ms-1s. For Phase 1, this is acceptable.

**API key management:** A client-side app with an API key is not secure for production, but it's fine for a prototype/demo. The user provides their own key. A later phase can add a backend proxy.

---

## File Structure

```
gluon/
  src/
    audio/
      plaits-wrapper.cpp        # C++ wrapper around Plaits DSP
      plaits-worklet.ts         # AudioWorklet processor
      audio-engine.ts           # Web Audio API setup, WASM loading
    engine/
      types.ts                  # Protocol types (Session, Voice, Agency, etc.)
      session.ts                # Session state management
      primitives.ts             # Protocol primitive implementations
      undo.ts                   # Undo stack
    ai/
      api.ts                    # Anthropic API calls
      state-compression.ts      # Session -> compressed prompt
      response-parser.ts        # API response -> protocol actions
      system-prompt.ts          # The AI's instructions
      automation.ts             # Local smooth parameter interpolation
    ui/
      App.tsx                   # Root component
      ParameterSpace.tsx        # 2D XY pad (canvas)
      ModelSelector.tsx         # Plaits model picker
      LeashSlider.tsx           # The leash control
      AgencyToggle.tsx          # OFF / SUGGEST / PLAY per voice
      ChatPanel.tsx             # Human <-> AI conversation
      Visualiser.tsx            # Waveform / spectrum display
      PendingOverlay.tsx        # Ghost suggestions, audition indicators
  wasm/
    build.sh                    # Emscripten compilation script
    plaits/                     # Extracted Plaits DSP source
    stmlib/                     # Extracted stmlib dependencies
  public/
    index.html
  package.json
  vite.config.ts
  tsconfig.json
  README.md
```

---

## Reference Documents

- `gluon-interaction-protocol-v05.md` - The protocol spec (read this first)
- `gluon-architecture.md` - The broader vision (Jam Mode, Studio Mode, hardware integration)
- `github.com/pichenettes/eurorack` - Mutable Instruments source code (MIT license for STM32 projects including Plaits)
- `github.com/AudibleInstruments` in the VCV Rack ecosystem - Reference for how others have ported the MI code
