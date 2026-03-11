# Gluon Interaction Protocol

**Version:** 0.4.0 (Draft)

---

## What This Defines

How a human musician and an AI share control of a musical instrument. The verbs, the state, and the one rule that matters: the human's hands always win.

---

## Principles

**1. The human's hands always win.** If you touch a parameter, the AI gets out of the way. Immediately. No negotiation.

**2. The AI plays the instrument. It does not replace it.** The AI's contributions flow through the same engines, parameters, and signal chain as the human's. What it does is exposed, tweakable, and designed to be reversible. This is not a prompt-to-track generator. It's a shared instrument.

**3. The AI acts when asked.** The human directs the AI via natural language prompts. The AI makes structured changes to the project and reports what it did. No unsolicited actions, no continuous streaming, no reactive nudges.

**4. The AI can hear its own work.** After making changes, the AI can request an audio snapshot (rendered clip) and evaluate whether it achieved what the human asked for. This is a discrete evaluation step, not continuous listening.

**5. Undo is always one action away.** You never need to think about how to get back. Just undo.

---

## State

### Session

```
Session {
  voices: [Voice]
  undo_stack: [Snapshot]        // Most recent state on top
  pending: [PendingAction]      // Sketches and changes awaiting human approval
  context: MusicalContext       // Inferred, human can override
  messages: [ChatMessage]       // Conversation history
}
```

### Voice

```
Voice {
  id: VoiceID
  engine: EngineType
  params: Map<ParamID, f32>     // Everything normalised 0.0-1.0
  agency: Agency                // What the AI can do to this voice
}
```

### Agency

What the AI is allowed to do to a voice. Set per-voice by the musician.

```
enum Agency {
  OFF           // AI does not act on this voice, but may still observe it for context.
  ON            // AI can modify this voice when asked by the human.
}
```

Two states. OFF means hands off. ON means the AI can make changes when you ask it to. The AI never acts unsolicited — it only modifies voices when responding to a human prompt, and only if that voice's agency is ON.

### Musical Context

```
MusicalContext {
  key: Option<Key>
  scale: Option<Scale>
  tempo: Option<f32>            // BPM, if a sequencer is running
  energy: f32                   // 0.0 to 1.0
  density: f32                  // 0.0 to 1.0
}
```

The AI infers this from what it hears and sees. The human can pin any field ("we're in D minor, don't leave") or leave it floating.

---

## What the Human Does

#### `play`

Touch a parameter. Move a knob. Play a note. Toggle a step. This is direct manipulation of the instrument and it always takes priority over AI changes.

#### `ask`

Talk to the AI in natural language. This is the primary way the human directs the AI.

- "Give me a four-on-the-floor kick pattern"
- "Make the bass darker and more sub-heavy"
- "Add syncopation to the lead"
- "That's too busy, strip it back"
- "Sketch a 4-bar pattern that complements this"
- "Why did you change the filter?"

The AI reads the full project state and responds with structured changes.

#### `undo`

Go back one step. The most recent AI action (or action group) is reversed. If the AI made a coordinated change across three voices, undo reverses all three at once.

Multiple undos walk back through the stack. Undo never reverses the human's own actions, only the AI's.

#### `commit`

Accept a pending change from the AI. "Yes, keep that."

#### `dismiss`

Wave away a pending change. Just "nah."

---

## What the AI Does

All AI actions are in response to a human `ask`. The AI never acts unsolicited.

#### `move`

Change a parameter on a voice.

```
move {
  voice: VoiceID
  param: ParamID
  target: { absolute: f32 } | { relative: f32 }
}
```

**Requires:** voice agency ON.

Moves are immediately applied and pushed onto the undo stack. Multiple related moves are grouped into a single undo entry (action group).

#### `sketch`

Create or modify a pattern, voice configuration, or arrangement element.

```
sketch {
  type: "pattern" | "voice" | "arrangement"
  content: SketchContent
  target: Option<VoiceID>
  description: String
}
```

**Requires:** voice agency ON.

Sketches are applied immediately with a description of what changed shown in the chat panel. The human can undo to revert.

#### `say`

Talk back to the human.

```
say {
  text: String
}
```

The AI explains what it did, answers questions, or describes what it hears. It should be concise — the changes speak louder than the words.

#### `listen`

Request an audio snapshot to evaluate the current state.

```
listen {
  bars: number              // how many bars to render
  reason: String            // what the AI wants to evaluate
}
```

The system renders the requested audio, sends it to the multimodal model, and returns a text assessment. The AI uses this to decide whether to iterate or report to the human. This is optional and happens within the AI's reasoning loop, not as a visible protocol action.

---

## Action Groups

When the AI makes a coordinated change across multiple parameters or voices ("make it darker" might touch filter cutoff on three voices and reverb send on two), those individual moves are bundled into an action group. An action group is the unit of undo: one undo reverses the whole group.

The AI should use action groups whenever changes are musically related. The protocol does not enforce this, but implementations that treat every move as independent will produce a frustrating undo experience.

---

## Arbitration

When human and AI both want to control the same parameter at the same time, the human wins. This is the only arbitration rule.

In practice this means:

- If the human is actively touching a parameter, the AI leaves it alone. No moves, no auditions on that parameter. Suggestions are still fine since they don't produce sound.

- If an audition is active and the human touches one of the auditioned parameters, the human's value sticks. When the audition expires, that parameter stays where the human put it. Other auditioned parameters revert normally.

- If the human undoes while the AI is mid-move, the move is cancelled.

The specific timing threshold for "actively touching" is an implementation detail. The principle is: the AI yields instantly and completely when the human asserts control.

---

## Timescale

The AI operates at a single timescale: **conversational**. The human asks, the AI responds within a few seconds. There is no reactive timescale, no continuous parameter modulation, no reflex responses. This dramatically simplifies the system and eliminates the latency sensitivity that made real-time jamming impractical.

The AI can make multiple changes in a single response (moving parameters across several voices and sketching a pattern), so complex operations don't require multiple round-trips.

---

## Hardware

When the AI controls external hardware (Elektron boxes, Eurorack, anything with MIDI), a hardware profile maps Gluon's normalised parameters to the device's CC numbers and ranges.

```yaml
name: "Elektron Digitone"
midi_channel: 1
params:
  timbre:
    cc: 74
    range: [0, 127]
    label: "Filter Cutoff"
  color:
    cc: 75
    range: [0, 127]
    label: "Filter Resonance"
```

The AI sees normalised 0.0-1.0 values and musical descriptions. The bridge translates. Hardware voices work exactly like native voices from the protocol's perspective.

Undo for hardware is best-effort. The system can re-send previous CC values, but analogue circuits don't always return to the same sound from the same numbers. That's fine. It's hardware. That's part of the charm.

---

## What This Does Not Define

**UI.** How suggestions look, how the parameter space is visualised, where the leash control lives. That's design work, not protocol work.

**AI behaviour.** How the AI decides what to suggest, when to nudge, what "darker" means in parameter terms. That's the intelligence layer. The protocol defines what the AI can do, not how it thinks.

**Taste and memory.** Whether the AI remembers your preferences across sessions, how it adapts to your style, what a preference profile contains. Implementations can do this however they want.

**Sound engine specifics.** The protocol doesn't care whether you're running Plaits, Braids, a hardware synth, or something entirely different. Voices have parameters. Parameters are 0.0-1.0. Everything else is on the other side of the boundary.

**Transport and networking.** How the protocol messages are serialised, transported, or synchronised. Could be in-process function calls, WebSocket messages, OSC, MIDI, whatever.

---

## The Whole Thing on One Page

A Gluon session has **voices** (things that make sound) and **agency per voice** (OFF / ON).

The human **plays** (direct manipulation), **asks** (natural language prompts), **undoes**, **commits**, and **dismisses**.

The AI **moves** parameters, **sketches** patterns and content, **says** things, and optionally **listens** to audio snapshots. Every AI action is undoable. The AI only acts when asked and only on voices with agency ON.

When human and AI collide on the same parameter, the human wins. Always. Instantly.

That's Gluon. The Claude Code of music.
