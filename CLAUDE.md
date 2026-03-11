# Gluon

## What This Is

Gluon is the Claude Code of music: an open source platform where you describe what you want and an AI makes it happen on a shared instrument. The human directs the AI via natural language, the AI makes structured changes to the project, the human listens and iterates.

## Architecture

- **Browser-based**: React + TypeScript + Vite
- **Audio**: Mutable Instruments Plaits DSP compiled to WebAssembly via Emscripten, running in an AudioWorklet
- **AI (reasoning)**: Google Gemini API (`@google/genai`) for project state reasoning and structured edits
- **AI (audio eval)**: Gemini native audio model for listening to rendered audio snapshots
- **Protocol**: Custom interaction protocol (see `docs/gluon-interaction-protocol-v03.md`)

## Key Concepts

- **Voices**: Things that make sound, with parameters normalised 0.0-1.0
- **Agency**: Per-voice AI permission (OFF / ON) — AI only modifies voices with agency ON, and only when asked
- **Arbitration**: Human's hands always win when both touch the same parameter
- **Undo**: Reverses AI actions only, grouped by action groups
- **Audio snapshots**: Rendered clips sent to multimodal model for AI self-evaluation

## Project Structure

```
src/
  audio/       # WASM bridge, AudioWorklet, Web Audio setup
  engine/      # Protocol types, session state, undo stack
  ai/          # Gemini API, state compression, response parsing
  ui/          # React components (parameter space, chat, controls)
wasm/          # Plaits C++ source and Emscripten build
docs/          # Architecture docs and protocol spec
```

## Tech Stack

- TypeScript, React, Vite, Tailwind CSS
- Emscripten (C++ to WASM)
- Web Audio API + AudioWorklet
- Google GenAI SDK (`@google/genai`)

## Development Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run wasm:build   # Compile Plaits to WASM
```

## Key Design Principles

1. The human's hands always win (arbitration rule)
2. The AI plays the instrument, it does not replace it
3. The AI acts when asked (no unsolicited actions)
4. The AI can hear its own work (audio snapshots)
5. Undo is always one action away

## Reference Docs

- `docs/gluon-architecture.md` - Full vision and architecture
- `docs/gluon-interaction-protocol-v03.md` - Protocol spec (v0.4.0)
- `docs/gluon-phase1-build.md` - Phase 1 implementation brief
