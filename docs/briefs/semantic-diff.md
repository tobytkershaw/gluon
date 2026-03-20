# Semantic Musical Diffs

## Event-level change descriptions in musical language

---

## Status

Brief. Ready for implementation.

**Depends on:** Nothing — all prerequisites are shipped.

---

## The Problem

When the AI edits a pattern, the system can describe what changed in two ways:

1. **Audio-domain** — `analyzeDiff()` compares rendered PCM and produces spectral/dynamics/rhythm deltas: "centroid shifted +200 Hz", "onset count increased by 3". This is the current auto-diff pipeline (`runAutoDiffVerification` in `api.ts`). It requires rendering audio, is approximate, and describes acoustic properties rather than musical intent.

2. **Preservation-domain** — `generatePreservationReport()` compares event arrays and returns boolean flags: rhythm positions preserved (yes/no), event count preserved (yes/no), pitch contour preserved (yes/no). This runs during sketch actions for tracks with approval ≥ `liked`. It answers "was the approved material damaged?" but not "what actually changed?"

Neither produces what a musician would say: "added a syncopated hit on the and-of-3", "transposed the phrase up a minor third", "chord progression changed from Cm–Fm to Cm–Gm", "density doubled but rhythm feel preserved."

The AI currently receives auto-diff summaries via `CompressedAutoDiffSummary` in the compressed state. These summaries come from audio-domain analysis. They're useful but imprecise — the AI knows "something got brighter" but not "the melody moved up an octave."

---

## Design

### One new pure function

```typescript
function generateSemanticDiff(
  oldEvents: MusicalEvent[],
  newEvents: MusicalEvent[],
  context: SemanticDiffContext,
): SemanticDiff
```

**`SemanticDiffContext`** provides musical framing:
```typescript
interface SemanticDiffContext {
  trackId: string;
  patternDuration: number;    // beats
  stepsPerBeat: number;       // for grid quantization reference
  scale?: { root: number; mode: string };  // for pitch class naming
}
```

**`SemanticDiff`** is the output:
```typescript
interface SemanticDiff {
  trackId: string;
  dimensions: DiffDimension[];
  summary: string;            // rendered from dimensions
}

interface DiffDimension {
  kind: DiffDimensionKind;
  description: string;        // human-readable: "Density increased from 3 to 7 events"
  before: string;             // "3 events/bar"
  after: string;              // "7 events/bar"
  magnitude: 'minor' | 'moderate' | 'major';
  confidence: number;         // 0.0–1.0, per-dimension
}

type DiffDimensionKind =
  | 'density'
  | 'pitch_range'
  | 'contour'
  | 'transposition'
  | 'rhythm_placement'
  | 'chord_quality'
  | 'velocity_profile';
```

### Separation: detection → phrasing

The function has two internal phases:

1. **Detect** — compute structured facts from event comparison. Each detector is a pure function that takes old/new events and returns a `DiffDimension | null`. Detectors are independently testable.

2. **Phrase** — render the dimension array into a `summary` string. This is a separate pass so wording changes never destabilize detection logic.

---

## v1 Dimensions

### density

Compare sound event counts (notes + triggers, excluding parameter events).

```
before: 4 sound events, after: 8 sound events
→ "Density doubled from 4 to 8 events"
```

**Thresholds:**
- minor: ≤25% change
- moderate: 25–100% change
- major: >100% change or events added/removed entirely

**Confidence:** always 1.0 (deterministic count).

### pitch_range

Compare min/max MIDI pitch of note events. Report in note names using scale context if available.

```
before: C3–G4 (48–67), after: C4–G5 (60–79)
→ "Pitch range shifted up one octave, span preserved"
```

**Thresholds:**
- minor: range shift ≤3 semitones, span change ≤2
- moderate: range shift 4–11 semitones or span change 3–6
- major: range shift ≥12 semitones or span change >6

**Confidence:** 1.0 when notes exist in both; 0.0 when either has no notes (dimension omitted).

### contour

Compare the direction sequence of pitch intervals. Reuses the interval-sign comparison already in `generatePreservationReport()`.

```
before: [up, down, up], after: [down, up, down]
→ "Pitch contour inverted"
```

Detects three cases:
- **preserved** — same interval directions (not reported as a change)
- **inverted** — all directions flipped
- **modified** — some directions changed

**Thresholds:**
- minor: ≤1 direction change
- moderate: 2+ direction changes but not full inversion
- major: full inversion or complete rewrite (different note count)

**Confidence:** 1.0 when note counts match; 0.5 when counts differ (contour comparison is approximate).

### transposition

Detect uniform pitch shift across all note events. Only fires when every note moved by the same interval.

```
before: [C3, E3, G3], after: [Eb3, G3, Bb3]
→ "Transposed up a minor third (+3 semitones)"
```

Uses interval names for common transpositions (minor second through octave). Reports raw semitones for larger shifts.

**Thresholds:**
- minor: ≤2 semitones
- moderate: 3–6 semitones
- major: ≥7 semitones

**Confidence:** 1.0 when all notes shift uniformly; dimension not emitted otherwise (partial transposition is better described by contour and pitch_range).

### rhythm_placement

Compare event positions against the beat grid. Classify each event as on-beat (within threshold of integer beat), off-beat (within threshold of half-beat), or syncopated (everything else).

```
before: 4 on-beat hits, after: 2 on-beat + 2 syncopated
→ "Rhythm shifted from straight to syncopated"
```

**Grid-aware classification:** use `stepsPerBeat` from context to build the full grid of valid positions. An event is "on-grid" if within `0.05` of any grid position (e.g. on a 4-step grid: 0, 0.25, 0.5, 0.75). Within on-grid events, distinguish "on-beat" (integer beat) from "on-subdivision" (other grid positions). An event is "syncopated" only if it falls off-grid entirely — not quantized to any subdivision.

This avoids misclassifying normal 16th-note patterns as syncopated. A hit on 1.2.1 (quarter-step position) is an on-subdivision grid hit, not syncopation. Syncopation means the event is placed between grid lines, which is a deliberate timing choice.

**Derived metrics:**
- on-beat ratio: on-beat events / total sound events
- syncopation ratio: syncopated events / total sound events
- These ratios are compared before/after

**Thresholds:**
- minor: syncopation ratio change ≤0.1
- moderate: syncopation ratio change 0.1–0.3
- major: syncopation ratio change >0.3

**Confidence:** 1.0 when event counts ≥4 in both; 0.6 when either has <4 events (small samples make ratio comparison noisy).

### chord_quality

Run `recogniseChord()` on simultaneous note groups in both event arrays. Compare the chord sequences.

```
before: Cm | Fm, after: Cm | Gm
→ "Chord progression changed: Cm–Fm → Cm–Gm"
```

Only fires when the pattern contains harmonic content: ≥2 simultaneous note groups where each group has ≥3 notes and average note duration ≥1 beat. This is a self-contained musical predicate evaluated by the detector, not a dependency on state compression's role classification. It restricts chord reporting to genuinely harmonic patterns, avoiding false reports on stacked voicings, decorative simultaneities, or briefly overlapping melodic notes.

Monophonic patterns and patterns without sustained chordal groups skip this dimension entirely.

**Simultaneous group detection:** notes within `0.05` beats of each other are grouped.

**Thresholds:**
- minor: same chord roots, quality changed (e.g. Cm → Cm7)
- moderate: some chord roots changed
- major: all chords changed or chord count changed

**Confidence:** derived from `recogniseChord()` — 1.0 when all groups match known chord types, reduced proportionally for unrecognised groups.

### velocity_profile

Compare velocity distribution of sound events: mean, range (max−min), and dynamic shape (are accents in the same positions?).

```
before: mean 0.7, range 0.3, after: mean 0.5, range 0.1
→ "Dynamics flattened: narrower velocity range, lower average"
```

**Thresholds:**
- minor: mean change ≤0.1 and range change ≤0.1
- moderate: mean change 0.1–0.3 or range change 0.1–0.3
- major: mean change >0.3 or range change >0.3

**Confidence:** 1.0 when event counts ≥4 in both; 0.6 for smaller samples.

---

## Deferred dimensions (v2+)

These are useful but risk false positives in v1:

- **structure** — section-level changes (requires arrangement context beyond a single pattern)
- **augmentation** — time-stretch detection (requires matching against motif-development transforms with tolerance)
- **retrograde** — reversed event sequence (false positives when events are simply reordered)
- **inversion** — pitch-axis mirror (conflicts with contour detection; defer until motif identity tracking exists)

---

## Integration

### 1. Semantic diff as an independent path (not gated on audio render)

`runAutoDiffVerification()` in `api.ts:1119` currently returns early when `renderOfflinePcm` is unavailable. Semantic diff must not be gated on audio rendering — event-level comparison is pure computation and should always run.

**Implementation:** extract semantic diff generation into a separate function called from the auto-diff collection point (where `turnAutoDiffs` is assembled), not from inside `runAutoDiffVerification()`. The two paths run independently:

```typescript
// Semantic diff: always available, event-level
function runSemanticDiffForTrack(
  beforeSession: Session,
  afterSession: Session,
  trackId: string,
): CompressedAutoDiffSummary | null {
  const beforePattern = getActivePattern(beforeSession, trackId);
  const afterPattern = getActivePattern(afterSession, trackId);
  if (!beforePattern || !afterPattern) return null;

  const diff = generateSemanticDiff(
    beforePattern.events,
    afterPattern.events,
    { trackId, patternDuration: afterPattern.duration, stepsPerBeat: 4, scale: ... },
  );
  if (diff.dimensions.length === 0) return null;
  return { trackId, summary: diff.summary, confidence: Math.min(...diff.dimensions.map(d => d.confidence)) };
}

// Audio diff: optional, render-gated (existing runAutoDiffVerification)
// When both produce summaries for the same track, merge: semantic first, audio second.
```

This ensures semantic diffs work in all environments, including when offline render is unavailable (e.g. no WASM, test environments, lightweight clients). Audio diffs supplement when rendering is available.

### 2. Enrich preservation reports

`generatePreservationReport()` in `operation-executor.ts:775` currently produces string literals like `"2 events added"`, `"pitch contour modified"`. Augment these with semantic diff descriptions where a matching dimension exists, but retain the existing strings as fallbacks for changes that v1 semantic diff does not cover (notably: parameter event additions/removals, velocity change counts).

```typescript
// For dimensions that semantic diff covers, use the richer description:
// Instead of: changed.push('pitch contour modified')
// Use: changed.push(contourDimension.description)
// → "Pitch contour inverted" or "2 interval directions changed"

// For changes not covered by semantic diff v1, keep the existing strings:
// "3 parameter events added" — no semantic diff dimension covers this
// "2 velocity values modified" — velocity_profile covers distribution but not per-event counts
```

This is additive — the `changed: string[]` type doesn't change, and no existing information is lost.

### 3. No new AI tools

The semantic diff appears in the AI's context automatically via `CompressedAutoDiffSummary`, which is already included in `compressState()` and passed to the system prompt. The AI doesn't need to call anything — it sees "what changed musically" as ambient context on its next turn.

---

## What this does NOT do

- **No new state to persist.** Diffs are computed on the fly from undo snapshots. They appear in compressed state for one turn, then age out.
- **No audio rendering required.** Event-level comparison is pure computation on arrays. The audio diff pipeline continues to run alongside for timbral changes.
- **No canonical model migration.** Works with the current Track/Pattern/MusicalEvent types as-is.
- **No UI changes.** The AI reads diffs in state and reports them in chat. A future UI could render `DiffDimension[]` as a structured change report, but that's separate work.

---

## Implementation shape

| Piece | Location | Size |
|---|---|---|
| `SemanticDiff` types | `src/engine/semantic-diff.ts` (new) | ~40 lines |
| 7 dimension detectors | `src/engine/semantic-diff.ts` | ~200 lines |
| Summary renderer | `src/engine/semantic-diff.ts` | ~30 lines |
| Wire into `runAutoDiffVerification` | `src/ai/api.ts` | ~15 lines |
| Enrich `generatePreservationReport` | `src/engine/operation-executor.ts` | ~20 lines |
| Tests: dimension detectors | `tests/engine/semantic-diff.test.ts` (new) | ~250 lines |
| Tests: integration | `tests/engine/semantic-diff-integration.test.ts` (new) | ~80 lines |
| **Total** | | **~635 lines** |

Single PR. No dependencies. All dimension detectors are independently testable pure functions.

---

## Success criteria

The feature is working when:

1. After an AI sketch action, the AI's next-turn compressed state includes a `recentAutoDiffs` entry with a musical-language summary (not just audio metrics)
2. The AI can read "Density doubled, rhythm shifted to syncopated, chord changed from Cm to Gm" and use that to inform its next response
3. Preservation reports for approved tracks contain specific musical descriptions instead of generic strings
4. All dimension detectors have test coverage with explicit threshold verification

---

## Relationship to other docs

- [ai-collaboration-model.md](../principles/ai-collaboration-model.md) — semantic diffs improve the AI's ability to "explain what changed and why" during guided iteration (Phase 3)
- [aesthetic-direction.md](../ai/aesthetic-direction.md) — enriches the reaction/observation evidence the AI uses for taste reasoning
- [preservation-contracts.md](../rfcs/preservation-contracts.md) — preservation reports gain musical-language descriptions
- [audio-analysis-tools.md](../rfcs/audio-analysis-tools.md) — complements audio-domain `analyzeDiff()` with event-domain analysis
- [ai-interface-design-principles.md](../principles/ai-interface-design-principles.md) — rule 6 ("return consequences, not just acknowledgements") is the core motivation
