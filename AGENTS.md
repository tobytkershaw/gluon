# Gluon

## What This Is

Gluon is an open source platform for human-AI music collaboration. A shared instrument where both human and AI can control synthesis parameters, with the human always having final say.

## Architecture

- **Browser-based** (Phase 1): React + TypeScript + Vite
- **Audio**: Mutable Instruments Plaits DSP compiled to WebAssembly via Emscripten, running in an AudioWorklet
- **AI**: Anthropic API (Codex) for reasoning about musical state and issuing protocol actions
- **Protocol**: Custom interaction protocol (see `docs/gluon-interaction-protocol-v03.md`)

## Key Concepts

- **Voices**: Things that make sound, with parameters normalised 0.0-1.0
- **Agency**: Per-voice AI permission level (OFF / SUGGEST / PLAY)
- **Leash**: Single 0.0-1.0 scalar controlling how active the AI is
- **Arbitration**: Human's hands always win when both touch the same parameter
- **Undo**: Reverses AI actions only, grouped by action groups

## Project Structure

```
src/
  audio/       # WASM bridge, AudioWorklet, Web Audio setup
  engine/      # Protocol types, session state, undo stack
  ai/          # Anthropic API, state compression, response parsing
  ui/          # React components (parameter space, chat, controls)
wasm/          # Plaits C++ source and Emscripten build
docs/          # Architecture docs and protocol spec
```

## Tech Stack

- TypeScript, React, Vite, Tailwind CSS
- Emscripten (C++ to WASM)
- Web Audio API + AudioWorklet
- Anthropic SDK (`@anthropic-ai/sdk`)

## Development Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run wasm:build   # Compile Plaits to WASM
```

## Key Design Principles

1. The human's hands always win (arbitration rule)
2. The AI plays the instrument, it does not replace it
3. One knob (leash) controls how much the AI does
4. The AI shuts up unless asked
5. Undo is always one action away

## Reference Docs

- `docs/gluon-architecture.md` - Full vision and architecture
- `docs/gluon-interaction-protocol-v03.md` - Protocol spec
- `docs/gluon-phase1-build.md` - Phase 1 implementation brief
