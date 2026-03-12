# AI Contract

What the AI agent needs at inference time to interact with Gluon's canonical musical model.

**Architecture:** The AI uses Gemini native function calling. The model receives compressed session state with each turn, reasons about the request, and invokes tools to make changes. Tool calls are validated against live session state before the model sees a success response. Actions are collected and dispatched after the tool loop completes.

---

## Tools

The AI has four tools, declared as Gemini function declarations:

### `move`

Change a control parameter value on a voice.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `param` | string | yes | Semantic control ID (`brightness`, `richness`, `texture`, `pitch`) |
| `target` | object | yes | `{ absolute: number }` (0.0–1.0) or `{ relative: number }` (-1.0 to 1.0) |
| `voiceId` | string | no | Target voice (`v0`–`v3`). Defaults to active voice. |
| `over` | number | no | Smooth transition duration in milliseconds |

### `sketch`

Apply a rhythmic or melodic pattern to a voice using musical events.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `voiceId` | string | yes | Target voice ID |
| `description` | string | yes | Short human-readable summary |
| `events` | array | yes | Sparse list of musical events (see below) |

**Event kinds:**
- `trigger` — percussion hit. Fields: `at` (step 0–15), `velocity` (0.0–1.0), `accent` (boolean)
- `note` — melodic note. Fields: `at`, `pitch` (MIDI 0–127), `velocity`, `duration` (always 0.25)
- `parameter` — per-step param lock. Fields: `at`, `controlId` (semantic name), `value` (0.0–1.0)

### `listen`

Capture audio and evaluate how it sounds. Requires transport to be playing.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `question` | string | yes | What to evaluate (e.g. "how does the kick sound?") |

The tool captures 2 bars of rendered audio, converts to WAV, and sends it with a critique prompt to the model. Returns a text critique.

### `set_transport`

Change tempo, swing, or play/stop state. At least one parameter must be provided.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `bpm` | number | no | Tempo (60–200) |
| `swing` | number | no | Swing amount (0.0–1.0, 0 = straight) |
| `playing` | boolean | no | true to start, false to stop |

---

## Tool Loop

The AI runs in a multi-round tool loop (up to 5 rounds per turn):

1. Model receives compressed state + human message
2. Model responds with text and/or function calls
3. Each function call is **pre-validated** against live session state
4. Tool responses report success or rejection with a reason
5. Model sees the tool responses and may make additional calls
6. Loop ends when the model responds with no function calls, or after 5 rounds

All accepted actions are collected and dispatched together after the loop completes.

---

## Serialised State Format

Each turn, the AI receives compressed session state as JSON:

```json
{
  "voices": [
    {
      "id": "v0",
      "model": "analog_bass_drum",
      "params": { "brightness": 0.65, "richness": 0.30, "texture": 0.20, "pitch": 0.40 },
      "agency": "ON",
      "muted": false,
      "solo": false,
      "pattern": {
        "length": 16,
        "active_steps": [0, 4, 8, 12],
        "accents": [0, 8],
        "locks": {}
      }
    }
  ],
  "activeVoiceId": "v0",
  "transport": { "bpm": 120, "swing": 0.00, "playing": true },
  "context": { "energy": 0.50, "density": 0.30 },
  "undo_depth": 2,
  "recent_human_actions": [
    { "voiceId": "v0", "param": "brightness", "from": 0.80, "to": 0.65, "age_ms": 3200 }
  ]
}
```

Fields:
- **voices[]** — each voice's current state, parameters (semantic names), agency, and pattern
- **activeVoiceId** — the voice the human currently has selected
- **pattern.locks** — per-step parameter overrides, keyed by step index, using semantic control names
- **transport** — tempo, swing, and playing state
- **context** — global energy and density (0.0–1.0)
- **undo_depth** — how many AI action groups can be undone
- **recent_human_actions** — last 5 parameter changes with voice, semantic param name, values, and age

---

## Semantic Controls

Four controls per voice, all 0.0–1.0:

| Control        | Meaning                                 | Maps to Plaits |
|---------------|----------------------------------------|----------------|
| **brightness** | Spectral content. Dark to bright.      | `timbre`       |
| **richness**   | Harmonic complexity. Simple to dense.  | `harmonics`    |
| **texture**    | Surface character. Smooth to textured. | `morph`        |
| **pitch**      | Fundamental pitch. Low to high.        | `note`         |

The compressed state and tool parameters use semantic names. The runtime handles the mapping to Plaits parameters internally.

For note events in sketches, pitch is specified as MIDI (0–127), not normalised.

---

## Validation Invariants

Hard rules. The runtime enforces these; violating them means the action is rejected with an error in the tool response.

1. All param values are **0.0–1.0**.
2. `voiceId` must reference an existing voice (`v0`–`v3`).
3. Agency must be **ON** for the target voice. Actions targeting an OFF voice are rejected.
4. `at` in events is a **0-based step index** (0–15 for a 16-step pattern).
5. MIDI pitch in note events is **0–127**.
6. `duration` in note events is always **0.25**.
7. `controlId` in parameter events must be a known semantic control (`brightness`, `richness`, `texture`, `pitch`).
8. `listen` requires the transport to be playing.
9. `set_transport` requires at least one of `bpm`, `swing`, or `playing`.
10. Invalid tool calls get error responses; valid calls in the same round are unaffected.

---

## Undo

- AI actions are grouped per turn into a single undo entry
- Transport changes are included in the undo group
- The human can undo with Cmd+Z; one press reverts the entire AI turn
- `undo_depth` in the state tells the model how many groups can be undone

---

## Worked Examples

### Example 1: "Make the kick darker"

The model calls:
```
move({ param: "brightness", voiceId: "v0", target: { absolute: 0.25 } })
```

Tool response: `{ queued: true, param: "brightness", voiceId: "v0", target: { absolute: 0.25 } }`

Model follows up with text: "Pulled the kick's brightness way down — should sit deeper now."

### Example 2: "Write a four-on-the-floor kick pattern"

The model calls:
```
sketch({
  voiceId: "v0",
  description: "Four-on-the-floor kick",
  events: [
    { kind: "trigger", at: 0, velocity: 1.0, accent: true },
    { kind: "trigger", at: 4, velocity: 0.85 },
    { kind: "trigger", at: 8, velocity: 0.9, accent: true },
    { kind: "trigger", at: 12, velocity: 0.85 }
  ]
})
```

### Example 3: "Start it up and tell me how it sounds"

The model calls two tools in sequence:
```
set_transport({ playing: true })
listen({ question: "How does the overall mix sound?" })
```

The `listen` tool captures 2 bars and returns a text critique that the model incorporates into its response.

---

## Positive Instructions

- Be musical, not mechanical. Patterns should groove, not just fill slots.
- Prefer small changes over wholesale rewrites. Nudge a parameter rather than replacing an entire pattern.
- When sketching patterns, think in terms of groove and dynamics — vary velocity, use accents for emphasis.
- Combine tool calls in one turn when it makes sense: sketch + move, set_transport + listen.
- Keep text responses short — one or two sentences. The human is listening, not reading an essay.
- When unsure, ask. A short clarifying question is better than a wrong guess.
