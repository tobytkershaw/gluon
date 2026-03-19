# Brief: Role-Aware State Compression

## Context

Gluon compresses session state into a JSON snapshot each AI turn. The compressed pattern format is currently role-agnostic: every track emits the same `{ triggers, notes, accents, param_locks, density }` structure regardless of whether it's a kick drum, a bassline, or a sustained pad.

Structured interviews with Gluon's AI (Gemini) during the drum rack design process revealed that the model spontaneously produces structurally different notations for different musical roles — grid strings for drums, tracker rows for bass, chord blocks for pads, motif cells for riffs. The current generic event list forces the AI to reconstruct musical meaning from raw coordinates every turn.

This brief proposes making `compressPattern()` role-aware: emitting different compressed representations depending on what kind of musical content the track contains.

Related:
- `docs/rfcs/drum-rack.md` — drum rack RFC, where this idea originated
- `docs/principles/ai-interface-design-principles.md` — principles 3 (legible state) and 7 (constrain to musical dimensions)
- `docs/ai/ai-musical-environment.md` — layered state vision (control layer vs pattern/phrase layer)
- `src/ai/state-compression.ts` — current compression implementation

---

## The Principle

**State compression should match how a musician thinks about the pattern, not mirror internal data structures.**

A kick pattern is "four on the floor with a pickup." A bassline is "root-fifth in F minor with staccato articulation." A pad is "Fm9 resolving to Ebmaj9 with smooth voice-leading." The closer the compressed representation is to that mental model, the less translation work the AI spends before it can reason musically.

This is directly AI interface design principle 7: "The AI's decisions should be 'which groove feel?' not 'what timing offset on step 7?'"

### Epistemic stance

The AI interview that generated these format proposals is hypothesis generation, not validation. The AI's introspective claims about its own processing are unreliable — LLMs don't have trustworthy self-knowledge about attention patterns. What IS meaningful:

1. **Behavioural output** — the model reached for different notations without being asked to differentiate, reflecting training-data priors that translate to pattern-completion advantages.
2. **Token economics** — compact role-specific formats are measurably fewer tokens than generic event lists.
3. **Information co-location** — grid characters encode position + intensity together; tracker rows encode pitch + position + duration together. Transformer attention between co-located information is cheaper than cross-referencing separated arrays.

The formats should be validated empirically before we commit to all of them. The drum rack grid is strong enough to ship on structural arguments alone. The melodic formats need A/B testing.

---

## Proposed Formats

### 1. Percussion grid (single-voice trigger tracks)

**Current:**
```json
{ "triggers": [{"at": 0, "vel": 0.9}, {"at": 4, "vel": 0.8}, {"at": 8, "vel": 0.9}, {"at": 12, "vel": 0.8}] }
```

**Proposed:**
```
grid: x...o...|x...o...
legend: x=accent o=hit .=rest |=bar
```

**Role detection:** Pattern contains only `trigger` events (no `note` events, no pitched content).

**Confidence:** High. Token reduction is ~5x. Grid notation is ubiquitous in drum machine documentation and music forums (strong training-data priors). Co-locates position and velocity in single characters. Ships with or before drum rack.

### 2. Drum rack stacked lanes

**Current:** N/A (drum rack is new)

**Proposed:**
```
kick:     x...o...|x..o....
snare:    .x.....x|.x.....x
hat:      hHh.hHh.|hHh.hHh.
open-hat: .......O|.......O
detail: { "hat@2.4.3": { offset: +0.05 } }
legend: x=accent o=hit g=ghost H=loud h=soft O=open .=rest |=bar
```

**Role detection:** Track has `engine === 'drum-rack'`.

**Confidence:** High. Same structural arguments as percussion grid, extended to named lanes. The stacked layout enables cross-lane reasoning (AI can "read vertically" — or more accurately, adjacent tokens in the stacked lanes are the ones that need to be attended to together). Ships with drum rack.

### 3. Bass tracker rows

**Current:**
```json
{ "notes": [{"at": 0, "pitch": 41, "vel": 0.9}, {"at": 2, "pitch": 44, "vel": 0.7}, {"at": 4, "pitch": 39, "vel": 0.8}] }
```

**Proposed:**
```
F1@1.1.3(0.5) Ab1@1.2.4(0.5) Eb1@1.3.2(2.0) F1@1.4.4(0.5)
```

Format: `PITCH@POSITION(DURATION)`. Velocity omitted when in the normal range (0.6–0.9); appended as `v0.3` when exceptional.

**Role detection:** Pattern contains only `note` events, mostly monophonic (≤1 simultaneous note at any position), with varied durations.

**Confidence:** Medium. Pitch names are more legible than MIDI numbers (the model's training data uses note names far more than MIDI integers). Duration is the key musical dimension for bass (staccato vs legato), and this format co-locates it with pitch and position. Needs A/B validation.

### 4. Pad chord blocks

**Current:**
```json
{ "notes": [
  {"at": 0, "pitch": 53, "vel": 0.7, "dur": 16},
  {"at": 0, "pitch": 56, "vel": 0.7, "dur": 16},
  {"at": 0, "pitch": 60, "vel": 0.7, "dur": 16},
  {"at": 0, "pitch": 63, "vel": 0.7, "dur": 16},
  {"at": 0, "pitch": 67, "vel": 0.7, "dur": 16}
]}
```

**Proposed:**
```
Fm9[F2,Ab2,C3,Eb3,G3]@1(16) → Ebmaj9[Eb2,G2,Bb2,D3,F3]@2(16)
```

Format: `CHORD[VOICING]@BAR(DURATION)`. Arrow indicates progression.

**Role detection:** Pattern contains only `note` events, polyphonic (≥3 simultaneous notes), with long durations (≥4 steps).

**Confidence:** Medium-low. Chord recognition is real music theory work, but we're compressing our own state — we know exactly what notes went in, so recognition is deterministic lookup rather than fuzzy matching. The bigger question is whether chord symbols improve the AI's harmonic reasoning or whether the note list is already sufficient. Needs A/B validation.

### 5. Motif cell notation

**Current:**
```json
{ "notes": [{"at": 0, "pitch": 65, "vel": 0.8}, {"at": 0.75, "pitch": 72, "vel": 0.6}, {"at": 1.5, "pitch": 68, "vel": 0.6}, ...repeating...] }
```

**Proposed:**
```
cell:[F3,C4,Ab3] rhythm:dotted-8th accent:first repeats:8
```

**Role detection:** Pattern contains repeating pitch sequences with consistent rhythm.

**Confidence:** Low. Pattern detection with variation tolerance is fragile. False positives (detecting a "motif" in a through-composed melody) would produce worse compression than the generic format. **Recommend deferring** until the simpler formats are validated and we have better heuristics for repetition detection.

---

## Hypothesis Testing Plan

### What we're testing

**H1:** Role-specific compression formats improve AI musical output quality compared to the current generic event list.

**H2:** Role-specific compression formats reduce token consumption for pattern state.

H2 is measurable by counting tokens. H1 requires qualitative evaluation.

### Test protocol

For each format (bass, pad), run paired trials:

1. **Setup:** Create a session with 2–3 tracks at a specific point in composition (not empty, not finished). Save the session state.

2. **Prompt:** Give the AI the same musical prompt (e.g., "the bassline is too stiff, loosen it up" or "voice-lead the pad chord changes more smoothly").

3. **Condition A:** Compress the state with the current generic format. Run the prompt. Capture the AI's response and the resulting musical output.

4. **Condition B:** Compress the state with the proposed role-specific format. Run the same prompt. Capture the response and output.

5. **Evaluate:**
   - Did the AI's reasoning reference musical concepts more directly in one condition?
   - Did the output require fewer correction turns?
   - Was the token count for the compressed state lower?
   - Did the AI produce musically appropriate changes on the first attempt?

6. **Repeat** with 3–5 different prompts per format to avoid overfitting to a single example.

### What counts as validation

- **Token reduction** is objective. If a format saves >30% tokens for typical patterns in its role, that's a structural win regardless of output quality.
- **Output quality** is subjective. We're looking for directional signal, not statistical significance. If 3 out of 5 prompts produce noticeably better first-attempt output, that's enough to ship.
- **False positive rate** for role detection matters. If the detector misclassifies tracks >10% of the time, the format needs better heuristics or a manual override.

### What we're NOT testing

- Whether the AI "thinks" in the proposed format (unknowable).
- Whether the format is optimal (impossible to prove — we're looking for "better than current", not "best possible").
- Whether the format helps with all possible prompts (we test common cases, not edge cases).

---

## Implementation Plan

### Stage 1: Percussion grid (ships with drum rack)

**Scope:** Single-voice trigger tracks + drum rack lanes.

1. Add grid string serialiser to `state-compression.ts`
   - Role detection: pattern has only `trigger` events
   - Velocity → character mapping with configurable legend
   - Bar line insertion based on time signature
2. Add grid string parser to sketch execution path in `operation-executor.ts`
   - Character → `TriggerEvent` with velocity from category midpoint
   - Bar line stripping
   - Length validation against pattern duration
3. Add `grid` parameter to sketch tool schema in `tool-schemas.ts`
   - Alternative to `events` array for trigger-only patterns
   - `kit` parameter for drum rack (record of lane grids)
4. Update system prompt to describe grid format
5. Tests: round-trip (compress → parse → events match), edge cases (empty patterns, fractional steps in detail map, non-4/4 time signatures)

**Dependencies:** None for single-voice percussion. Drum rack lanes depend on drum rack types/engine work.

**Exit criteria:** The AI reads grid notation in compressed state and writes grid notation via sketch. Round-trip is lossless for categorical velocity. Detail map handles exceptions.

### Stage 2: Bass tracker rows (first melodic format)

**Scope:** Monophonic note tracks with varied duration.

1. Run A/B validation (see test protocol above) with 3–5 bass-specific prompts
2. If validated:
   - Add tracker-row serialiser to `state-compression.ts`
   - Role detection: pattern has only `note` events, ≤1 simultaneous note per position
   - Format: `PITCH@POSITION(DURATION)` with velocity omission for normal range
   - Pitch name resolution using existing `src/engine/scale.ts` utilities
3. Add tracker-row parser to sketch execution
   - Regex: `/([A-G][#b]?\d)@([\d.]+)\(([\d.]+)\)(?:v([\d.]+))?/`
   - Pitch name → MIDI number (existing utility)
4. Add `bass` or `tracker` parameter to sketch tool schema (or auto-detect from string format)
5. Tests: round-trip, pitch name edge cases (Cb, B#), duration parsing

**Dependencies:** Stage 1 (establishes the pattern for alternative sketch formats).

**Gate:** A/B validation must show directional improvement. If results are neutral, defer.

### Stage 3: Pad chord blocks

**Scope:** Polyphonic note tracks with long durations.

1. Run A/B validation with 3–5 pad/chord-specific prompts
2. If validated:
   - Add chord recognition to `state-compression.ts`
   - Build chord dictionary (triads, 7ths, 9ths, sus, aug, dim — the chords that matter for pop/electronic music)
   - Recognition: sort note pitches, compute intervals, match against dictionary
   - Fallback: if no chord matches, emit note list in pitch-name format (`[F2,Ab2,C3,Eb3,G3]@1(16)`)
   - Add chord symbol parser with voicing expansion
3. Add `chords` parameter to sketch tool schema
4. Tests: chord recognition accuracy across common voicings, inversions, incomplete chords, fallback to note list

**Dependencies:** Stage 2 (pitch name resolution shared). Chord utilities may partially exist in `src/engine/chords.ts`.

**Gate:** A/B validation + chord recognition accuracy >90% on common voicings. If recognition is unreliable, ship the note-list-with-pitch-names fallback instead of chord symbols.

### Stage 4: Review and generalise (deferred)

After stages 1–3 ship:

1. Measure aggregate token reduction across a typical session
2. Review whether role detection heuristics need manual override (`musicalRole` hint)
3. Decide whether motif cell notation is worth pursuing
4. Consider whether the compression format should be documented as a stable contract (for external tools, persistence, etc.) or remain an internal optimisation

---

## Scope Boundaries

### In scope
- Role-aware `compressPattern()` with format selection heuristics
- Grid string, tracker-row, and chord-block serialisers/parsers
- Alternative parameters on sketch tool (grid, kit, tracker rows, chords)
- System prompt documentation of new formats
- A/B validation protocol for melodic formats

### Out of scope
- Changes to the canonical event model (`MusicalEvent` types unchanged)
- Changes to undo system (compression is a serialisation layer, not a state change)
- Changes to audio engine
- Motif cell detection (deferred pending simpler format validation)
- Automation shape compression (speculative, no interview evidence)
- Role-aware compression for non-pattern state (processor params, modulation, surface)

---

## Relationship to Drum Rack

The drum rack RFC (`docs/rfcs/drum-rack.md`) implements Stage 1 of this plan as part of its own scope. The percussion grid format and drum rack stacked lanes are specified in that RFC and built during drum rack implementation.

This brief owns Stages 2–4 (melodic formats, hypothesis testing, generalisation). The drum rack is the proving ground; this brief is the extension.
