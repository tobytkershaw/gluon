# Gluon

Gluon is a self-configuring intelligent instrument for human-AI music collaboration.

You play it. It responds. It adapts its controls to the music, remembers what you liked, knows what to protect, and has two kinds of intelligence — structural reasoning and sonic intuition — that inform each other before it acts.

Not generative AI that writes songs for you. Not an easier DAW. An instrument with deep intelligence that the human plays.

## Why This Exists

The AI music space has bifurcated into two dead ends:

**Generative music** (Suno, Udio): AI generates complete audio from text prompts. The human is a prompter, not a musician. There is no collaboration, no iteration at the parameter level, no connection to real instruments.

**AI-assisted DAWs** (WavTool, DAW plugins): AI bolted onto a studio workflow. Stem splitting, auto-mixing, MIDI generation. The AI makes the studio easier. The studio itself doesn't change.

Neither of these is collaboration. Gluon is designed around collaboration from the ground up.

## How It Works

1. You describe what you want in natural language.
2. The AI reads the current project state and optionally listens to a rendered audio clip.
3. The AI makes structured edits to tracks, patterns, parameters, or arrangement.
4. You listen to the result.
5. You continue the conversation, override, or undo.

The AI only acts when asked. The human's hands always win. Undo is always one action away.

## What It Can Do

- **Synthesis**: Mutable Instruments Plaits, Rings (resonator), Clouds (granular), Tides (modulation) — DSP compiled to WebAssembly
- **Sequencing**: canonical region/event model with tracker view, step grid, parameter automation
- **Mixing**: per-track volume/pan/mute/solo, bus tracks with sends, master bus
- **Four views**: Surface (AI-curated), Rack (all parameters), Patch (node graph), Tracker (event editor)
- **AI reasoning**: GPT-5.4 planner with structured tool use, Gemini 3 Flash listener for audio evaluation
- **AI collaboration**: preservation contracts, reaction history, observed patterns, restraint guidance, taste emergence
- **Persistence**: project save/load, offline audio rendering, undo across human and AI edits

## Principles

- **The human's hands always win.** Arbitration rule — human input overrides AI in real time.
- **The AI plays the instrument; it does not replace it.** The AI is a collaborator, not a generator.
- **The AI acts when asked.** No unsolicited actions.
- **The AI can hear its own work.** Audio snapshots sent to a multimodal model for self-evaluation.
- **Undo is always one action away.** All actions (human and AI) reversible in LIFO order.
- **Intelligent instrument, not easier DAW.** Features make the instrument more expressive, not the studio more efficient. See [`docs/principles/product-identity.md`](./docs/principles/product-identity.md).

## Architecture

- **Browser-based**: React + TypeScript + Vite + Tailwind CSS
- **Audio**: Mutable Instruments DSP (Plaits, Rings, Clouds, Tides) compiled to WebAssembly via Emscripten, running in AudioWorklets
- **AI (reasoning)**: GPT-5.4 for project-state reasoning and structured edits
- **AI (audio eval)**: Gemini 3 Flash native audio model for listening to rendered audio snapshots
- **Protocol**: Custom interaction protocol — [`docs/gluon-interaction-protocol-v05.md`](./docs/gluon-interaction-protocol-v05.md)

## Project Structure

```text
src/
  audio/       # WASM bridge, AudioWorklet, Web Audio setup, voice pools
  engine/      # Protocol types, session state, undo stack, scheduler
  ai/          # AI provider abstraction, state compression, tool schemas
  ui/          # React components (Surface, Rack, Patch, Tracker, chat, sidebar)
wasm/          # Plaits/Rings/Clouds/Tides C++ source and Emscripten build
docs/          # Architecture docs, principles, RFCs, and briefs
```

## Development

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run wasm:build   # Compile MI modules to WASM
```

## Reference Docs

- [`docs/gluon-architecture.md`](./docs/gluon-architecture.md) — Full vision and architecture
- [`docs/roadmap.md`](./docs/roadmap.md) — Implementation roadmap
- [`docs/status.md`](./docs/status.md) — Current build status and milestone tracking
- [`docs/gluon-interaction-protocol-v05.md`](./docs/gluon-interaction-protocol-v05.md) — Protocol spec (v0.5.0)

### Principles — [`docs/principles/`](./docs/principles/)
- [`product-identity.md`](./docs/principles/product-identity.md) — Intelligent instrument, not DAW. Read before proposing features.
- [`ai-capability-doctrine.md`](./docs/principles/ai-capability-doctrine.md) — Hard boundaries, then maximize AI usefulness inside them
- [`ai-interface-design-principles.md`](./docs/principles/ai-interface-design-principles.md) — How the AI layer exposes state, tools, and feedback
- [`ai-collaboration-model.md`](./docs/principles/ai-collaboration-model.md) — Collaboration phases, posture, roles
- [`human-capability-parity.md`](./docs/principles/human-capability-parity.md) — Anything the AI can do, the human should have a means to do

### AI Contract — [`docs/ai/`](./docs/ai/)
- [`ai-contract.md`](./docs/ai/ai-contract.md) — What the AI needs at inference time: tools, state, validation
- [`ai-musical-environment.md`](./docs/ai/ai-musical-environment.md) — Target AI environment: layered state, actions, structured listening
- [`aesthetic-direction.md`](./docs/ai/aesthetic-direction.md) — How taste emerges from enriched collaboration state

### RFCs — [`docs/rfcs/`](./docs/rfcs/)
- [`canonical-musical-model.md`](./docs/rfcs/canonical-musical-model.md) — Canonical musical model: Voice, Region, MusicalEvent, ControlSchema
- [`view-architecture.md`](./docs/rfcs/view-architecture.md) — Four views: Surface, Rack, Patch, Tracker
- [`ai-curated-surfaces.md`](./docs/rfcs/ai-curated-surfaces.md) — AI-curated UI surfaces
- [`preservation-contracts.md`](./docs/rfcs/preservation-contracts.md) — Runtime enforcement of approved material
- [`parameter-automation-research.md`](./docs/rfcs/parameter-automation-research.md) — Automation architecture research
- [`audio-analysis-tools.md`](./docs/rfcs/audio-analysis-tools.md) — Composable audio analysis primitives

### Briefs — [`docs/briefs/`](./docs/briefs/)
- [`sampling.md`](./docs/briefs/sampling.md) — Sampling strategy: sampler module, AI-powered library, resampling
- [`cross-model-consultation.md`](./docs/briefs/cross-model-consultation.md) — GPT consults Gemini before committing edits
- [`sequencer.md`](./docs/briefs/sequencer.md) — Sequencing strategy and product boundaries

## License

Open source. See LICENSE file.
