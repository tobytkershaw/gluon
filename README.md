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

## Current State

- 4-voice Plaits WASM synthesis with Rings resonator as first processor module
- Processor chain architecture: source → processor(s) → gain staging
- Canonical region/event sequencing with event-centric tracker and addable views
- AI tool loop: `move`, `sketch`, `listen`, `set_transport`, `set_model`, `transform`, `add_view`, `remove_view`, `add_processor`, `remove_processor`
- Unified undo: all actions (human and AI) reversible in LIFO order
- Per-voice agency (AI-editable by default, human-protectable)
- Audio snapshot evaluation for AI self-assessment

See [`docs/status.md`](./docs/status.md) for detailed build status and milestone tracking.

## Architecture

- **Browser-based**: React + TypeScript + Vite
- **Audio**: Mutable Instruments Plaits and Rings DSP compiled to WebAssembly via Emscripten, running in AudioWorklets
- **AI (reasoning)**: Google Gemini API (`@google/genai`) for project-state reasoning and structured edits
- **AI (audio eval)**: Gemini native audio model for listening to rendered audio snapshots
- **Protocol**: Custom interaction protocol in [`docs/gluon-interaction-protocol-v05.md`](./docs/gluon-interaction-protocol-v05.md)

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

- [`docs/gluon-architecture.md`](./docs/gluon-architecture.md) — Full vision and architecture
- [`docs/gluon-interaction-protocol-v05.md`](./docs/gluon-interaction-protocol-v05.md) — Protocol spec (v0.5.0)
- [`docs/status.md`](./docs/status.md) — Current build status and milestone tracking

### Principles — [`docs/principles/`](./docs/principles/)
- [`ai-capability-doctrine.md`](./docs/principles/ai-capability-doctrine.md) — AI product posture: hard boundaries, then maximize usefulness
- [`ai-interface-design-principles.md`](./docs/principles/ai-interface-design-principles.md) — How the AI layer exposes state, tools, and feedback
- [`ai-collaboration-model.md`](./docs/principles/ai-collaboration-model.md) — Collaboration phases, posture, roles, and model evaluation

### AI Contract — [`docs/ai/`](./docs/ai/)
- [`ai-contract.md`](./docs/ai/ai-contract.md) — What the AI needs at inference time: tools, state, validation
- [`ai-musical-environment.md`](./docs/ai/ai-musical-environment.md) — Target AI environment: layered state, actions, and structure

### RFCs — [`docs/rfcs/`](./docs/rfcs/)
- [`canonical-musical-model.md`](./docs/rfcs/canonical-musical-model.md) — Canonical musical model: Voice, Region, MusicalEvent, ControlSchema
- [`ai-curated-surfaces.md`](./docs/rfcs/ai-curated-surfaces.md) — AI-curated UI surfaces
- [`sequencer-view-layer.md`](./docs/rfcs/sequencer-view-layer.md) — Sequencer views as projections over canonical events
- [`phase4a.md`](./docs/rfcs/phase4a.md) — Phase 4A: constrained patch chains
