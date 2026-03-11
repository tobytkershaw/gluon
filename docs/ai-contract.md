# AI Contract

What the AI agent needs at inference time to interact with Gluon's canonical musical model.

---

## Type Definitions

### Actions

The AI responds with one or more actions per turn:

```typescript
type AIAction = AIMoveAction | AISayAction | AISketchAction;

interface AIMoveAction {
  type: 'move';
  param: string;                                    // semantic control id
  target: { absolute: number } | { relative: number }; // 0.0–1.0
  voiceId?: string;                                 // defaults to active voice
  over?: number;                                    // transition time in seconds
}

interface AISayAction {
  type: 'say';
  text: string;
}

interface AISketchAction {
  type: 'sketch';
  voiceId: string;
  description: string;          // short human-readable summary
  events: MusicalEvent[];
}
```

### Musical Events

Events describe what happens inside a pattern sketch:

```typescript
type MusicalEvent = TriggerEvent | NoteEvent | ParameterEvent;

interface TriggerEvent {
  kind: 'trigger';
  at: number;           // 0-based step index (0–15 for 16-step pattern)
  velocity?: number;    // 0.0–1.0, default 1.0
  accent?: boolean;
}

interface NoteEvent {
  kind: 'note';
  at: number;           // step index
  pitch: number;        // MIDI note number (0–127)
  velocity: number;     // 0.0–1.0
  duration: 0.25;       // always 0.25 (one quarter-step)
}

interface ParameterEvent {
  kind: 'parameter';
  at: number;           // step index
  controlId: string;    // semantic control id (see below)
  value: number;        // 0.0–1.0
}
```

---

## Serialised State Format

Each turn, the AI receives compressed session state as JSON. Example:

```json
{
  "voices": [
    {
      "id": "v0",
      "model": "analog_bass_drum",
      "params": { "harmonics": 0.30, "timbre": 0.65, "morph": 0.20, "note": 0.40 },
      "agency": "ON",
      "muted": false,
      "solo": false,
      "pattern": {
        "length": 16,
        "active_steps": [0, 4, 8, 12],
        "accents": [0, 8],
        "locks": {}
      }
    },
    {
      "id": "v1",
      "model": "analog_hi_hat",
      "params": { "harmonics": 0.50, "timbre": 0.70, "morph": 0.40, "note": 0.60 },
      "agency": "OFF",
      "muted": false,
      "solo": false,
      "pattern": {
        "length": 16,
        "active_steps": [2, 6, 10, 14],
        "accents": [],
        "locks": {}
      }
    }
  ],
  "transport": { "bpm": 120, "swing": 0.00 },
  "context": { "energy": 0.50, "density": 0.30 },
  "undo_depth": 2,
  "recent_human_actions": ["timbre: 0.80 -> 0.65"],
  "human_message": "Make the kick darker"
}
```

Fields:
- **voices[]** — each voice's current state, parameters, agency, and pattern
- **pattern.active_steps** — which steps have gates on (0-indexed)
- **pattern.accents** — which active steps are accented
- **pattern.locks** — per-step parameter overrides, keyed by step index
- **transport** — tempo and swing
- **context** — global energy and density (0.0–1.0)
- **undo_depth** — how many AI actions can be undone
- **recent_human_actions** — last 5 parameter changes the human made
- **human_message** — the human's chat message (present when they typed something)

---

## Semantic Controls

Four controls per voice, all 0.0–1.0:

| Control      | Meaning                    | Range        | Maps to Plaits   |
|-------------|----------------------------|--------------|-------------------|
| **brightness** | Spectral content. Dark to bright. | 0.0–1.0 | `timbre`       |
| **richness**   | Harmonic complexity. Simple to dense. | 0.0–1.0 | `harmonics` |
| **texture**    | Surface character. Smooth to textured. | 0.0–1.0 | `morph`     |
| **pitch**      | Fundamental pitch. Low to high. | 0.0–1.0 | `note`          |

In the current build, serialised state still uses the Plaits parameter names (`timbre`, `harmonics`, `morph`, `note`). The semantic names above are what the AI should reason about; the mapping is 1:1.

For note events, pitch is specified as MIDI (0–127), not normalised.

---

## Worked Examples

### Example 1: "Make the kick darker"

**State (relevant portion):**
```json
{
  "voices": [{
    "id": "v0",
    "model": "analog_bass_drum",
    "params": { "harmonics": 0.30, "timbre": 0.65, "morph": 0.20, "note": 0.40 },
    "agency": "ON"
  }],
  "human_message": "Make the kick darker"
}
```

**Reasoning:** "Darker" means less brightness. The kick is v0, agency is ON. Brightness maps to `timbre`, currently at 0.65. Bring it down to ~0.25.

**Response:**
```json
[
  { "type": "move", "voiceId": "v0", "param": "timbre", "target": { "absolute": 0.25 } },
  { "type": "say", "text": "Pulled the kick's brightness way down — should sit deeper now." }
]
```

### Example 2: "Write a four-on-the-floor kick pattern"

**State (relevant portion):**
```json
{
  "voices": [{
    "id": "v0",
    "model": "analog_bass_drum",
    "params": { "harmonics": 0.30, "timbre": 0.25, "morph": 0.20, "note": 0.40 },
    "agency": "ON",
    "pattern": { "length": 16, "active_steps": [], "accents": [], "locks": {} }
  }],
  "human_message": "Write a four-on-the-floor kick pattern"
}
```

**Reasoning:** Four-on-the-floor = kick on every beat. At 16 steps (4 bars of 4), that's steps 0, 4, 8, 12. Accent the downbeat (step 0) for weight.

**Response:**
```json
[
  {
    "type": "sketch",
    "voiceId": "v0",
    "description": "Four-on-the-floor kick",
    "events": [
      { "kind": "trigger", "at": 0, "velocity": 1.0, "accent": true },
      { "kind": "trigger", "at": 4, "velocity": 0.85 },
      { "kind": "trigger", "at": 8, "velocity": 0.9, "accent": true },
      { "kind": "trigger", "at": 12, "velocity": 0.85 }
    ]
  },
  { "type": "say", "text": "Four on the floor with accents on 1 and 3." }
]
```

### Example 3: "Add a bass line in C minor"

**State (relevant portion):**
```json
{
  "voices": [
    { "id": "v0", "model": "analog_bass_drum", "agency": "ON" },
    {
      "id": "v1",
      "model": "virtual_analog",
      "params": { "harmonics": 0.40, "timbre": 0.50, "morph": 0.30, "note": 0.35 },
      "agency": "ON",
      "pattern": { "length": 16, "active_steps": [], "accents": [], "locks": {} }
    }
  ],
  "transport": { "bpm": 120, "swing": 0.00 },
  "human_message": "Add a bass line in C minor"
}
```

**Reasoning:** C minor scale root notes in the bass register: C2=36, Eb2=39, F2=41, G2=43, Ab2=44, Bb2=46. Write a simple groove on v1 (virtual_analog, agency ON). Use note events with MIDI pitches. Keep it rhythmic — root on beats, movement on off-beats.

**Response:**
```json
[
  {
    "type": "sketch",
    "voiceId": "v1",
    "description": "C minor bass line",
    "events": [
      { "kind": "note", "at": 0,  "pitch": 36, "velocity": 0.9,  "duration": 0.25 },
      { "kind": "note", "at": 3,  "pitch": 39, "velocity": 0.7,  "duration": 0.25 },
      { "kind": "note", "at": 4,  "pitch": 36, "velocity": 0.85, "duration": 0.25 },
      { "kind": "note", "at": 6,  "pitch": 43, "velocity": 0.7,  "duration": 0.25 },
      { "kind": "note", "at": 8,  "pitch": 36, "velocity": 0.9,  "duration": 0.25 },
      { "kind": "note", "at": 10, "pitch": 44, "velocity": 0.65, "duration": 0.25 },
      { "kind": "note", "at": 12, "pitch": 41, "velocity": 0.8,  "duration": 0.25 },
      { "kind": "note", "at": 14, "pitch": 46, "velocity": 0.7,  "duration": 0.25 }
    ]
  },
  { "type": "say", "text": "Laid down a C minor bass line — root on the downbeats with some scale movement." }
]
```

### Example 4: "Give the hi-hat more texture and swing"

**State (relevant portion):**
```json
{
  "voices": [{
    "id": "v2",
    "model": "analog_hi_hat",
    "params": { "harmonics": 0.50, "timbre": 0.60, "morph": 0.20, "note": 0.70 },
    "agency": "ON",
    "pattern": { "length": 16, "active_steps": [2, 6, 10, 14], "accents": [], "locks": {} }
  }],
  "human_message": "Give the hi-hat more texture and swing"
}
```

**Reasoning:** Texture maps to `morph`, currently 0.20 — push it up. Also add a parameter automation on morph across the pattern for variety. The human also asked for swing — but swing is a transport setting, not per-voice. Combine a move action with a say explaining the swing part.

**Response:**
```json
[
  { "type": "move", "voiceId": "v2", "param": "morph", "target": { "absolute": 0.65 } },
  { "type": "say", "text": "Pushed the hi-hat texture up. Swing is a global transport setting — want me to bump it to around 60%?" }
]
```

---

## Validation Invariants

Hard rules. The runtime enforces these; violating them means the action is dropped.

1. All param values are **0.0–1.0**.
2. `voiceId` must reference an existing voice (`v0`–`v3`).
3. Agency must be **ON** for the target voice. Actions targeting an OFF voice are dropped.
4. `at` in events is a **0-based step index** (0–15 for a 16-step pattern).
5. MIDI pitch in note events is **0–127**.
6. `duration` in note events is always **0.25**.
7. `controlId` in parameter events must be a known semantic control (`timbre`, `harmonics`, `morph`, `note`).
8. Unknown action types are silently dropped.
9. Invalid actions in a batch do not affect valid ones — each action is applied independently.

---

## Positive Instructions

- Be musical, not mechanical. Patterns should groove, not just fill slots.
- Prefer small changes over wholesale rewrites. Nudge a parameter rather than replacing an entire pattern.
- When sketching patterns, think in terms of groove and dynamics — vary velocity, use accents for emphasis.
- Combine actions in one response when it makes sense: sketch + move + say.
- Keep `say` messages short — one or two sentences. The human is listening, not reading an essay.
- When unsure, ask. A short clarifying question is better than a wrong guess.
