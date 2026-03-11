# Gluon

Gluon is the Claude Code of music: an open source platform built around an AI-legible musical core that you can glue instruments, workflows, and hardware onto.

You describe what you want. The AI reads the current project state, makes structured changes, and you listen, iterate, or undo. The point is not to have AI generate finished songs for you. The point is to build a shared musical system that both humans and models can understand and act on.

## Product Thesis

At the centre of Gluon is an AI-legible musical model. That core makes musical state explicit enough for an AI to reason about, edit, and evaluate, while still being playable and steerable by a human.

Today Gluon runs as a browser instrument with Plaits synthesis and Gemini-backed reasoning. The architecture is designed to support external instruments, DAWs, and hardware integrations as the project grows.

Because the core is legible and structured, you can glue other things onto it:

- software instruments
- DAWs like Ableton
- external hardware instruments
- browser-native interfaces
- future protocol adapters and controllers

## Core Loop

1. You describe what you want in natural language.
2. The AI reads the current project state.
3. The AI makes structured edits to voices, patterns, parameters, or arrangement.
4. You listen to the result.
5. You continue the conversation or undo.

## Principles

- The human's hands always win.
- The AI plays the instrument; it does not replace it.
- The AI acts when asked.
- The AI can hear its own work.
- Undo is always one action away.

## Architecture

- **Browser-based**: React + TypeScript + Vite
- **Audio**: Mutable Instruments Plaits DSP compiled to WebAssembly via Emscripten, running in an AudioWorklet
- **AI (reasoning)**: Google Gemini API (`@google/genai`) for project-state reasoning and structured edits
- **AI (audio eval)**: Gemini native audio model for listening to rendered audio snapshots
- **Protocol**: Custom interaction protocol in [`docs/gluon-interaction-protocol-v03.md`](./docs/gluon-interaction-protocol-v03.md)

## Project Structure

```text
src/
  audio/       # WASM bridge, AudioWorklet, Web Audio setup
  engine/      # Protocol types, session state, undo stack
  ai/          # Gemini API, state compression, response parsing
  ui/          # React components (parameter space, chat, controls)
wasm/          # Plaits C++ source and Emscripten build
docs/          # Architecture docs and protocol spec
```

## Development

```bash
npm run dev
npm run build
npm run wasm:build
```

## Reference Docs

- [`docs/gluon-architecture.md`](./docs/gluon-architecture.md)
- [`docs/gluon-interaction-protocol-v03.md`](./docs/gluon-interaction-protocol-v03.md)
- [`docs/gluon-phase1-build.md`](./docs/gluon-phase1-build.md)
