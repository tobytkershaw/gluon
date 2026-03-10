# Gluon Interaction Protocol

**Version:** 0.3.1 (Draft)

---

## What This Defines

How a human musician and an AI share control of a musical instrument. The verbs, the state, and the one rule that matters: the human's hands always win.

---

## Principles

**1. The human's hands always win.** If you touch a parameter, the AI gets out of the way. Immediately. No negotiation.

**2. The AI plays the instrument. It does not replace it.** The AI's contributions flow through the same engines, parameters, and signal chain as the human's. What it does is exposed, tweakable, and designed to be reversible. This is not a prompt-to-track generator. It's a shared instrument.

**3. One knob controls how much the AI does.** The leash. Turn it down for silence. Turn it up for a full collaborator. Everything in between is a gradient, not a mode switch.

**4. The AI shuts up unless asked.** No running commentary. No explaining every nudge. If you want to know why it did something, ask. Otherwise it just plays.

**5. Undo is always one action away.** You never need to think about how to get back. Just undo.

---

## State

### Session

```
Session {
  voices: [Voice]
  leash: f32                    // 0.0 (AI silent) to 1.0 (full co-creation)
  undo_stack: [Snapshot]        // Most recent state on top
  pending: [PendingAction]      // Suggestions, auditions, and sketches awaiting response
  context: MusicalContext       // Inferred, human can override
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

What the AI can do to a voice. Set per-voice by the musician.

```
enum Agency {
  OFF           // AI does not act on this voice, but may still observe it for context.
  SUGGEST       // AI can propose changes. Nothing sounds until you accept.
  PLAY          // AI can move parameters and play notes freely.
}
```

Three levels. That's it. OFF means hands off. SUGGEST means show me ideas. PLAY means jam with me. The leash dial scales how active the AI is within whatever level you've set.

There is no strict ordering requirement. You might have one voice on PLAY and another on SUGGEST. You might have everything on PLAY with the leash at 0.1 so the AI barely touches anything. The leash and the per-voice agency interact: a low leash with PLAY permission means the AI can act but mostly chooses not to. A high leash with SUGGEST permission means the AI has lots of ideas but still waits for your approval.

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

Touch a parameter. Move a knob. Play a note. This is the primary interaction and it always takes priority over everything the AI is doing.

#### `ask`

Talk to the AI in natural language.

- "Make it darker"
- "Surprise me on the bass"
- "Sketch a 4-bar pattern that complements this"
- "Why did you change the filter?"
- "More like that, but weirder"

#### `undo`

Go back one step. The most recent AI action (or action group) is reversed. If the AI made a coordinated change across three voices, undo reverses all three at once.

Multiple undos walk back through the stack. Undo never reverses the human's own actions, only the AI's.

#### `commit`

Accept a pending suggestion or audition from the AI. "Yes, keep that."

#### `dismiss`

Wave away a pending suggestion or audition. Not a formal rejection with structured feedback. Just "nah." The AI should read the room from the pattern of what you commit and what you dismiss, without requiring you to explain yourself.

#### `leash` (up / down)

The single most important control in Gluon. One continuous value from 0.0 to 1.0. Should map to a physical knob or slider.

At 0.0 the AI is silent. It's watching, building its model, but doing nothing.

At 0.25 it might occasionally suggest something on voices set to SUGGEST.

At 0.5 it's an active participant. Suggesting regularly, nudging parameters on PLAY voices, responding to what you do.

At 0.75 it's assertive. Taking initiative, making bigger moves, introducing ideas you didn't ask for.

At 1.0 it's a full co-creator. Jamming freely on any voice set to PLAY.

The exact mapping from leash value to AI behaviour is an implementation concern, not a protocol concern. The protocol just says: there is one scalar that controls how much the AI does, and the human can change it at any time.

---

## What the AI Does

#### `suggest`

Propose a change without making it. The suggestion appears visually (a ghost on the parameter space, a highlighted region, whatever the UI decides). Nothing sounds until the human commits.

```
suggest {
  voice: VoiceID
  changes: [(ParamID, f32)]
  reason: Option<String>        // Available if the human asks "why?"
}
```

**Requires:** voice agency SUGGEST or PLAY.

Suggestions expire naturally. If you don't commit within a reasonable window, they fade away. No cleanup needed from the human.

#### `audition`

Temporarily apply a change so the human can hear it. After a few seconds, it reverts automatically unless the human commits.

```
audition {
  voice: VoiceID
  changes: [(ParamID, f32)]
  duration: Duration
}
```

**Requires:** voice agency PLAY.

This is the AI saying "what about this?" and trying it. If you like it, commit. If not, it goes away on its own. Committing an audition preserves its current state instead of reverting at expiry. If you touch any of the auditioned parameters during the audition, your value wins and the audition for that parameter is cancelled.

Only one audition per voice at a time. A new audition replaces the old one.

#### `move`

Change a parameter. This is the AI playing the instrument. It's immediately audible.

```
move {
  voice: VoiceID
  param: ParamID
  target: { absolute: f32 } | { relative: f32 }
  over: Option<Duration>        // If set, drift smoothly over this time
}
```

**Requires:** voice agency PLAY.

If `over` is set, the AI is creating a smooth automation curve rather than a step change. "Slowly open the filter over 8 bars" is a `move` with a long `over` duration. The local engine handles the interpolation; no LLM round-trip per sample.

Moves are the primary unit of undo. Each move (or group of coordinated moves) pushes one entry onto the undo stack.

#### `sketch`

Create new content: a MIDI pattern, a parameter automation curve, a new voice configuration.

```
sketch {
  type: "pattern" | "automation" | "voice" | "arrangement"
  content: SketchContent
  target: Option<VoiceID>
  description: String
}
```

Sketches are always provisional. They appear in the pending list with a description. The human commits to apply them or dismisses to discard. The AI can offer to audition a sketch ("want to hear it?").

In typical use, the AI sketches in response to a human `ask` rather than unsolicited. Implementations may restrict unsolicited sketches even on voices set to PLAY.

#### `say`

Talk back to the human.

```
say {
  text: String
}
```

The AI speaks when spoken to (responding to `ask`), or when it has something genuinely worth saying. It does not narrate its own actions by default. Good AI behaviour is like a good session musician: mostly you communicate through the instrument, not through words.

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

## Timescales

Different AI actions have different speed requirements.

**Continuous:** Smooth parameter drifts (`move` with `over`). Handled by a local automation engine after the LLM sets the trajectory. No per-sample LLM calls.

**Reactive:** Responding to what the human just did. The AI notices you opened the filter and nudges the resonance to complement it. Needs to happen within 1-2 seconds to feel alive. Fast LLM call or local model.

**Compositional:** Sketching a pattern, writing an arrangement. The human asked for something and is willing to wait a few seconds for a considered response.

**Conversational:** Natural language dialogue. Normal LLM call speed.

If the AI can't respond fast enough at any timescale, it does nothing. Late is worse than absent.

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

A Gluon session has **voices** (things that make sound), a **leash** (how much the AI does), and **agency per voice** (OFF / SUGGEST / PLAY).

The human **plays**, **asks**, **undoes**, **commits**, and **dismisses**. The human also controls the **leash**.

The AI **suggests**, **auditions**, **moves**, **sketches**, and **says**. Every AI action is undoable. The AI only acts within the agency and leash the human has set.

When human and AI collide on the same parameter, the human wins. Always. Instantly.

That's Gluon.
