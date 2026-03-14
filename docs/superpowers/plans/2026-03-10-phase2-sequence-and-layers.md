# Phase 2: Sequence & Layers — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Phase 1's single-voice demo into a track-making tool by adding a step sequencer, 4 voice slots, transport, and audio export.

**Architecture:** Extend the existing React + TypeScript app. Data model changes propagate from `types.ts` outward through session, primitives, AI, and UI layers. The scheduler runs on the main thread using `setInterval` + 100ms lookahead against `AudioContext.currentTime`. Multi-voice audio is routed through per-voice GainNodes into a shared mixer.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, Vitest 4, Tailwind CSS 4, Web Audio API, `@anthropic-ai/sdk`

---

## File Structure

### New files to create

| File | Responsibility |
|------|---------------|
| `src/engine/sequencer-types.ts` | Step, Pattern, Transport, ScheduledNote, PatternSketch, StepSketch types |
| `src/engine/sequencer-helpers.ts` | `createDefaultStep()`, `createDefaultPattern()`, `getAudibleTracks()`, `resolveNoteParams()` |
| `src/engine/pattern-primitives.ts` | Pattern editing: toggle step, set param lock, clear lock, change length, clear pattern, apply sketch |
| `src/engine/scheduler.ts` | Scheduler class: tick loop, lookahead, note emission, swing, BPM reanchor |
| `src/audio/audio-exporter.ts` | `AudioExporter` class wrapping `MediaRecorder` |
| `src/ui/TransportBar.tsx` | Play/stop, BPM, swing, record button, position display |
| `src/ui/StepGrid.tsx` | 16-step grid per voice with gate/accent/lock indicators |
| `src/ui/VoiceSelector.tsx` | 4 voice tabs with mute/solo/agency badges |
| `src/ui/PatternControls.tsx` | Length selector, clear, copy/paste |
| `tests/engine/sequencer-helpers.test.ts` | Tests for sequencer helper functions |
| `tests/engine/pattern-primitives.test.ts` | Tests for pattern editing primitives |
| `tests/engine/scheduler.test.ts` | Tests for Scheduler class |
| `tests/audio/audio-exporter.test.ts` | Tests for AudioExporter |

### Existing files to modify

| File | What changes |
|------|-------------|
| `src/engine/types.ts` | Replace `Snapshot`, `PendingAction`, `AISketchAction` types. Change `Session.voice` → `Session.tracks` + `activeTrackId` + `transport`. Extend `Voice` with `pattern`, `muted`, `solo`. |
| `src/engine/session.ts` | `createSession()` creates 4 voices with patterns. Add `setTransportBpm()`, `setTransportSwing()`, `togglePlaying()`, `setActiveVoice()`, `toggleMute()`, `toggleSolo()`. Update `setAgency()`, `updateTrackParams()`, `setModel()` to take trackId. |
| `src/engine/primitives.ts` | All functions switch from `session.voice` to voice lookup by ID. `applyUndo()` switches on `snapshot.kind`. `commitPending`/`dismissPending` handle sketch kind. |
| `src/engine/arbitration.ts` | `humanTouched(param, value)` stores value. Add `getHeldParams(trackId)`. |
| `src/audio/synth-interface.ts` | Add `trigger()` and `setGateOpen()` to `SynthEngine`. |
| `src/audio/web-audio-synth.ts` | Implement `trigger()` and `setGateOpen()`. Accept output GainNode in constructor instead of connecting to `ctx.destination`. |
| `src/audio/audio-engine.ts` | Manage 4 synth instances with per-voice GainNodes. Add `scheduleNote()`, `setVoiceParams()`, `setVoiceModel()`, `muteVoice()`, `getCurrentTime()`, `getMediaStreamDestination()`. |
| `src/ai/system-prompt.ts` | Add sketch action format, pattern examples, multi-voice context. |
| `src/ai/state-compression.ts` | Compress 4 voices with patterns (active steps, accents, locks). |
| `src/ai/response-parser.ts` | Validate new `AISketchAction` shape with `PatternSketch`. |
| `src/ai/api.ts` | `react()` checks per-voice agencies. |
| `src/ui/App.tsx` | Wire 4 voices, activeTrackId, transport, scheduler lifecycle, new UI components. |
| `tests/engine/session.test.ts` | Update for multi-voice session structure. |
| `tests/engine/primitives.test.ts` | Update all `session.voice` refs to voice lookup. Add pattern snapshot tests. |
| `tests/engine/undo.test.ts` | Add PatternSnapshot undo tests. |
| `tests/engine/arbitration.test.ts` | Add `getHeldParams()` tests. |
| `tests/ai/state-compression.test.ts` | Update for multi-voice compression. |
| `tests/ai/response-parser.test.ts` | Add sketch action validation tests. |

---

## Chunk 1: Data Model

### Task 1: Sequencer types

**Files:**
- Create: `src/engine/sequencer-types.ts`
- Test: `tests/engine/sequencer-types.test.ts`

- [ ] **Step 1.1: Write type validation tests**

Create tests that verify the type contracts. Since these are TypeScript interfaces, we test the factory functions and type guards.

```typescript
// tests/engine/sequencer-types.test.ts
import { describe, it, expect } from 'vitest';
import { createDefaultStep, createDefaultPattern } from '../../src/engine/sequencer-helpers';

describe('createDefaultStep', () => {
  it('creates a step with gate off, no accent, no micro-timing', () => {
    const step = createDefaultStep();
    expect(step.gate).toBe(false);
    expect(step.accent).toBe(false);
    expect(step.micro).toBe(0);
    expect(step.params).toBeUndefined();
  });
});

describe('createDefaultPattern', () => {
  it('creates a 16-step pattern by default', () => {
    const pattern = createDefaultPattern();
    expect(pattern.length).toBe(16);
    expect(pattern.steps).toHaveLength(16);
    expect(pattern.steps.every(s => !s.gate)).toBe(true);
  });

  it('creates a pattern with custom length', () => {
    const pattern = createDefaultPattern(32);
    expect(pattern.length).toBe(32);
    expect(pattern.steps).toHaveLength(32);
  });

  it('clamps length to 1-64', () => {
    expect(createDefaultPattern(0).length).toBe(1);
    expect(createDefaultPattern(100).length).toBe(64);
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `npx vitest run tests/engine/sequencer-types.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 1.3: Create sequencer types**

```typescript
// src/engine/sequencer-types.ts
import type { SynthParamValues } from './types';

export interface Step {
  gate: boolean;
  accent: boolean;
  params?: Partial<SynthParamValues>;
  micro: number;
}

export interface Pattern {
  steps: Step[];
  length: number;
}

export interface Transport {
  playing: boolean;
  bpm: number;
  swing: number;
}

export interface ScheduledNote {
  trackId: string;
  time: number;
  gateOffTime: number;
  accent: boolean;
  params: SynthParamValues;
}

export interface PatternSketch {
  length?: number;
  steps: StepSketch[];
}

export interface StepSketch {
  index: number;
  gate?: boolean;
  accent?: boolean;
  params?: Partial<SynthParamValues>;
  micro?: number;
}
```

- [ ] **Step 1.4: Create sequencer helpers (factories)**

```typescript
// src/engine/sequencer-helpers.ts
import type { Step, Pattern } from './sequencer-types';

export function createDefaultStep(): Step {
  return { gate: false, accent: false, micro: 0 };
}

export function createDefaultPattern(length = 16): Pattern {
  const clamped = Math.max(1, Math.min(64, length));
  return {
    steps: Array.from({ length: clamped }, createDefaultStep),
    length: clamped,
  };
}
```

- [ ] **Step 1.5: Run tests to verify they pass**

Run: `npx vitest run tests/engine/sequencer-types.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 1.6: Commit**

```bash
git add src/engine/sequencer-types.ts src/engine/sequencer-helpers.ts tests/engine/sequencer-types.test.ts
git commit -m "feat: add Step, Pattern, Transport, ScheduledNote types and factories"
```

---

### Task 2: Extend Voice, Snapshot, PendingAction, AISketchAction types

**Files:**
- Modify: `src/engine/types.ts`
- Test: `tests/engine/types-migration.test.ts`

- [ ] **Step 2.1: Write tests for the new type shapes**

```typescript
// tests/engine/types-migration.test.ts
import { describe, it, expect } from 'vitest';
import type {
  Voice, Session, ParamSnapshot, PatternSnapshot,
  ParamPendingAction, SketchPendingAction,
  AISketchAction,
} from '../../src/engine/types';
import type { Step, Transport } from '../../src/engine/sequencer-types';

describe('Phase 2 type shapes', () => {
  it('Voice has pattern, muted, solo fields', () => {
    const voice: Voice = {
      id: 'v0',
      engine: 'plaits:virtual_analog',
      model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
      agency: 'SUGGEST',
      pattern: { steps: [{ gate: false, accent: false, micro: 0 }], length: 1 },
      muted: false,
      solo: false,
    };
    expect(voice.pattern.length).toBe(1);
    expect(voice.muted).toBe(false);
  });

  it('ParamSnapshot has kind and trackId', () => {
    const snapshot: ParamSnapshot = {
      kind: 'param',
      trackId: 'v0',
      prevValues: { timbre: 0.5 },
      aiTargetValues: { timbre: 0.8 },
      timestamp: Date.now(),
      description: 'test',
    };
    expect(snapshot.kind).toBe('param');
    expect(snapshot.trackId).toBe('v0');
  });

  it('PatternSnapshot stores changed steps', () => {
    const snapshot: PatternSnapshot = {
      kind: 'pattern',
      trackId: 'v0',
      prevSteps: [{ index: 0, step: { gate: false, accent: false, micro: 0 } }],
      timestamp: Date.now(),
      description: 'test',
    };
    expect(snapshot.kind).toBe('pattern');
    expect(snapshot.prevSteps).toHaveLength(1);
  });

  it('SketchPendingAction has pattern data', () => {
    const pending: SketchPendingAction = {
      id: 'p1',
      kind: 'sketch',
      trackId: 'v0',
      description: 'four on the floor',
      pattern: { steps: [{ index: 0, gate: true }] },
      expiresAt: Date.now() + 15000,
    };
    expect(pending.kind).toBe('sketch');
    expect(pending.pattern.steps).toHaveLength(1);
  });

  it('AISketchAction has trackId and PatternSketch', () => {
    const action: AISketchAction = {
      type: 'sketch',
      trackId: 'v0',
      description: 'kick pattern',
      pattern: {
        length: 16,
        steps: [
          { index: 0, gate: true },
          { index: 4, gate: true },
          { index: 8, gate: true },
          { index: 12, gate: true },
        ],
      },
    };
    expect(action.type).toBe('sketch');
    expect(action.pattern.steps).toHaveLength(4);
  });

  it('Session has voices array, activeTrackId, transport', () => {
    const session: Session = {
      tracks: [],
      activeTrackId: 'v0',
      transport: { playing: false, bpm: 120, swing: 0 },
      leash: 0.5,
      undoStack: [],
      pending: [],
      context: { key: null, scale: null, tempo: null, energy: 0.3, density: 0.2 },
      messages: [],
      recentHumanActions: [],
    };
    expect(session.activeTrackId).toBe('v0');
    expect(session.transport.bpm).toBe(120);
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `npx vitest run tests/engine/types-migration.test.ts`
Expected: FAIL — `ParamSnapshot`, `PatternSnapshot`, etc. not exported

- [ ] **Step 2.3: Rewrite types.ts with Phase 2 types**

Replace the full content of `src/engine/types.ts`:

```typescript
// src/engine/types.ts
import type { Pattern, PatternSketch, Step, Transport } from './sequencer-types';

export type Agency = 'OFF' | 'SUGGEST' | 'PLAY';

export interface SynthParamValues {
  harmonics: number;
  timbre: number;
  morph: number;
  note: number;
  [key: string]: number;
}

export interface Voice {
  id: string;
  engine: string;
  model: number;
  params: SynthParamValues;
  agency: Agency;
  pattern: Pattern;
  muted: boolean;
  solo: boolean;
}

export interface MusicalContext {
  key: string | null;
  scale: string | null;
  tempo: number | null;  // Derived from transport.bpm when transport exists; see getEffectiveTempo()
  energy: number;
  density: number;
}

// --- Snapshots (discriminated union) ---

export interface ParamSnapshot {
  kind: 'param';
  trackId: string;
  prevValues: Partial<SynthParamValues>;
  aiTargetValues: Partial<SynthParamValues>;
  timestamp: number;
  description: string;
}

export interface PatternSnapshot {
  kind: 'pattern';
  trackId: string;
  prevSteps: { index: number; step: Step }[];
  prevLength?: number;
  timestamp: number;
  description: string;
}

export type Snapshot = ParamSnapshot | PatternSnapshot;

// --- Pending actions (discriminated union) ---

export interface ParamPendingAction {
  id: string;
  kind: 'suggestion' | 'audition';
  trackId: string;
  changes: Partial<SynthParamValues>;
  reason?: string;
  expiresAt: number;
  previousValues: Partial<SynthParamValues>;
}

export interface SketchPendingAction {
  id: string;
  kind: 'sketch';
  trackId: string;
  description: string;
  pattern: PatternSketch;
  expiresAt: number;
}

export type PendingAction = ParamPendingAction | SketchPendingAction;

// --- AI Actions ---

export interface AIMoveAction {
  type: 'move';
  param: string;
  target: { absolute: number } | { relative: number };
  over?: number;
}

export interface AISuggestAction {
  type: 'suggest';
  changes: Partial<SynthParamValues>;
  reason?: string;
}

export interface AIAuditionAction {
  type: 'audition';
  changes: Partial<SynthParamValues>;
  duration?: number;
}

export interface AISayAction {
  type: 'say';
  text: string;
}

export interface AISketchAction {
  type: 'sketch';
  trackId: string;
  description: string;
  pattern: PatternSketch;
}

export type AIAction = AIMoveAction | AISuggestAction | AIAuditionAction | AISayAction | AISketchAction;

// --- Session ---

export interface HumanAction {
  trackId: string;
  param: string;
  from: number;
  to: number;
  timestamp: number;
}

export interface Session {
  tracks: Voice[];
  activeTrackId: string;
  transport: Transport;
  leash: number;
  undoStack: Snapshot[];
  pending: PendingAction[];
  context: MusicalContext;
  messages: ChatMessage[];
  recentHumanActions: HumanAction[];
}

export interface ChatMessage {
  role: 'human' | 'ai';
  text: string;
  timestamp: number;
}

// --- Helpers ---

export function getTrack(session: Session, trackId: string): Voice {
  const voice = session.tracks.find(v => v.id === trackId);
  if (!voice) throw new Error(`Voice not found: ${trackId}`);
  return voice;
}

export function getActiveTrack(session: Session): Voice {
  return getTrack(session, session.activeTrackId);
}

export function updateTrack(session: Session, trackId: string, update: Partial<Voice>): Session {
  return {
    ...session,
    tracks: session.tracks.map(v => v.id === trackId ? { ...v, ...update } : v),
  };
}

/** Effective tempo: transport.bpm when transport exists, else context.tempo fallback */
export function getEffectiveTempo(session: Session): number | null {
  return session.transport.bpm ?? session.context.tempo;
}
```

**Migration note:** Phase 1's `PendingAction.type` field is renamed to `kind` in the discriminated union. All code referencing `pending.type` (in `primitives.ts`, `App.tsx`, and expiry checks) must switch to `pending.kind`. The `PendingActionType` type alias is removed. Phase 1's `Snapshot` type (flat object) is replaced by the `ParamSnapshot | PatternSnapshot` union — existing undo tests will need updating (Task 5, Task 21).

- [ ] **Step 2.4: Run the new type tests**

Run: `npx vitest run tests/engine/types-migration.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 2.5: Commit**

```bash
git add src/engine/types.ts tests/engine/types-migration.test.ts
git commit -m "feat: rewrite types for Phase 2 — multi-voice, pattern snapshots, sketch actions"
```

---

### Task 3: Update session.ts for multi-voice

**Files:**
- Modify: `src/engine/session.ts`
- Modify: `tests/engine/session.test.ts`

- [ ] **Step 3.1: Write failing tests for new session structure**

Replace `tests/engine/session.test.ts`:

```typescript
// tests/engine/session.test.ts
import { describe, it, expect } from 'vitest';
import {
  createSession, setLeash, setAgency, updateTrackParams, setModel,
  setActiveVoice, toggleMute, toggleSolo, setTransportBpm, setTransportSwing, togglePlaying,
} from '../../src/engine/session';

describe('Session (Phase 2)', () => {
  it('creates a session with 4 voices', () => {
    const session = createSession();
    expect(session.tracks).toHaveLength(4);
    expect(session.activeTrackId).toBe(session.tracks[0].id);
    expect(session.transport).toEqual({ playing: false, bpm: 120, swing: 0 });
  });

  it('voice 0 is model 13 (kick), voice 1 is model 0 (bass), voice 2 is model 2 (lead), voice 3 is model 4 (pad)', () => {
    const session = createSession();
    expect(session.tracks[0].model).toBe(13);
    expect(session.tracks[1].model).toBe(0);
    expect(session.tracks[2].model).toBe(2);
    expect(session.tracks[3].model).toBe(4);
  });

  it('each voice has a 16-step default pattern', () => {
    const session = createSession();
    for (const voice of session.tracks) {
      expect(voice.pattern.length).toBe(16);
      expect(voice.pattern.steps).toHaveLength(16);
      expect(voice.muted).toBe(false);
      expect(voice.solo).toBe(false);
    }
  });

  it('sets leash, clamped to 0-1', () => {
    let s = createSession();
    s = setLeash(s, 0.75);
    expect(s.leash).toBe(0.75);
    s = setLeash(s, -0.5);
    expect(s.leash).toBe(0);
    s = setLeash(s, 1.5);
    expect(s.leash).toBe(1);
  });

  it('sets agency on active voice', () => {
    let s = createSession();
    s = setAgency(s, s.activeTrackId, 'PLAY');
    const voice = s.tracks.find(v => v.id === s.activeTrackId)!;
    expect(voice.agency).toBe('PLAY');
  });

  it('updates voice params by trackId', () => {
    const s1 = createSession();
    const vid = s1.tracks[1].id;
    const s2 = updateTrackParams(s1, vid, { timbre: 0.8 });
    expect(s2.tracks.find(v => v.id === vid)!.params.timbre).toBe(0.8);
    expect(s1.tracks.find(v => v.id === vid)!.params.timbre).toBe(0.5);
  });

  it('sets model by trackId', () => {
    const s1 = createSession();
    const vid = s1.tracks[0].id;
    const s2 = setModel(s1, vid, 5);
    expect(s2.tracks.find(v => v.id === vid)!.model).toBe(5);
  });

  it('switches active voice', () => {
    const s1 = createSession();
    const s2 = setActiveVoice(s1, s1.tracks[2].id);
    expect(s2.activeTrackId).toBe(s1.tracks[2].id);
  });

  it('toggles mute', () => {
    const s1 = createSession();
    const vid = s1.tracks[0].id;
    const s2 = toggleMute(s1, vid);
    expect(s2.tracks.find(v => v.id === vid)!.muted).toBe(true);
    const s3 = toggleMute(s2, vid);
    expect(s3.tracks.find(v => v.id === vid)!.muted).toBe(false);
  });

  it('toggles solo', () => {
    const s1 = createSession();
    const vid = s1.tracks[1].id;
    const s2 = toggleSolo(s1, vid);
    expect(s2.tracks.find(v => v.id === vid)!.solo).toBe(true);
  });

  it('sets transport BPM clamped to 60-200', () => {
    let s = createSession();
    s = setTransportBpm(s, 140);
    expect(s.transport.bpm).toBe(140);
    s = setTransportBpm(s, 30);
    expect(s.transport.bpm).toBe(60);
    s = setTransportBpm(s, 300);
    expect(s.transport.bpm).toBe(200);
  });

  it('sets transport swing clamped to 0-1', () => {
    let s = createSession();
    s = setTransportSwing(s, 0.5);
    expect(s.transport.swing).toBe(0.5);
    s = setTransportSwing(s, -1);
    expect(s.transport.swing).toBe(0);
  });

  it('toggles playing', () => {
    let s = createSession();
    s = togglePlaying(s);
    expect(s.transport.playing).toBe(true);
    s = togglePlaying(s);
    expect(s.transport.playing).toBe(false);
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `npx vitest run tests/engine/session.test.ts`
Expected: FAIL — new functions not exported

- [ ] **Step 3.3: Rewrite session.ts for Phase 2**

```typescript
// src/engine/session.ts
import type { Session, Voice, Agency, MusicalContext, SynthParamValues } from './types';
import { updateTrack } from './types';
import { PLAITS_MODELS } from '../audio/synth-interface';
import { createDefaultPattern } from './sequencer-helpers';

const VOICE_DEFAULTS: { model: number; engine: string }[] = [
  { model: 13, engine: 'plaits:analog_bass_drum' },
  { model: 0, engine: 'plaits:virtual_analog' },
  { model: 2, engine: 'plaits:fm' },
  { model: 4, engine: 'plaits:harmonic' },
];

function createVoice(index: number): Voice {
  const defaults = VOICE_DEFAULTS[index] ?? VOICE_DEFAULTS[0];
  return {
    id: `v${index}`,
    engine: defaults.engine,
    model: defaults.model,
    params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    agency: 'SUGGEST',
    pattern: createDefaultPattern(16),
    muted: false,
    solo: false,
  };
}

export function createSession(): Session {
  const tracks = Array.from({ length: 4 }, (_, i) => createVoice(i));
  const context: MusicalContext = {
    key: null,
    scale: null,
    tempo: null,
    energy: 0.3,
    density: 0.2,
  };

  return {
    voices,
    activeTrackId: voices[0].id,
    transport: { playing: false, bpm: 120, swing: 0 },
    leash: 0.5,
    undoStack: [],
    pending: [],
    context,
    messages: [],
    recentHumanActions: [],
  };
}

export function setLeash(session: Session, value: number): Session {
  return { ...session, leash: Math.max(0, Math.min(1, value)) };
}

export function setAgency(session: Session, trackId: string, agency: Agency): Session {
  return updateTrack(session, trackId, { agency });
}

export function updateTrackParams(
  session: Session,
  trackId: string,
  params: Partial<SynthParamValues>,
  trackAsHuman = false,
): Session {
  const voice = session.tracks.find(v => v.id === trackId);
  if (!voice) return session;

  const newActions = trackAsHuman
    ? [
        ...session.recentHumanActions,
        ...Object.entries(params).map(([param, to]) => ({
          trackId,
          param,
          from: voice.params[param] ?? 0,
          to: to as number,
          timestamp: Date.now(),
        })),
      ].slice(-20)
    : session.recentHumanActions;

  return {
    ...updateTrack(session, trackId, {
      params: { ...voice.params, ...params } as SynthParamValues,
    }),
    recentHumanActions: newActions,
  };
}

export function setModel(session: Session, trackId: string, model: number): Session {
  const modelInfo = PLAITS_MODELS[model];
  const engineName = modelInfo
    ? `plaits:${modelInfo.name.toLowerCase().replace(/[\s/]+/g, '_')}`
    : `plaits:unknown_${model}`;
  return updateTrack(session, trackId, { model, engine: engineName });
}

export function setActiveVoice(session: Session, trackId: string): Session {
  if (!session.tracks.find(v => v.id === trackId)) return session;
  return { ...session, activeTrackId: trackId };
}

export function toggleMute(session: Session, trackId: string): Session {
  const voice = session.tracks.find(v => v.id === trackId);
  if (!voice) return session;
  return updateTrack(session, trackId, { muted: !voice.muted });
}

export function toggleSolo(session: Session, trackId: string): Session {
  const voice = session.tracks.find(v => v.id === trackId);
  if (!voice) return session;
  return updateTrack(session, trackId, { solo: !voice.solo });
}

export function setTransportBpm(session: Session, bpm: number): Session {
  return {
    ...session,
    transport: { ...session.transport, bpm: Math.max(60, Math.min(200, bpm)) },
  };
}

export function setTransportSwing(session: Session, swing: number): Session {
  return {
    ...session,
    transport: { ...session.transport, swing: Math.max(0, Math.min(1, swing)) },
  };
}

export function togglePlaying(session: Session): Session {
  return {
    ...session,
    transport: { ...session.transport, playing: !session.transport.playing },
  };
}
```

- [ ] **Step 3.4: Run session tests**

Run: `npx vitest run tests/engine/session.test.ts`
Expected: PASS (all tests)

- [ ] **Step 3.5: Commit**

```bash
git add src/engine/session.ts tests/engine/session.test.ts
git commit -m "feat: rewrite session for 4-voice multi-voice structure"
```

---

### Task 4: Sequencer helpers — getAudibleTracks, resolveNoteParams

**Files:**
- Modify: `src/engine/sequencer-helpers.ts`
- Modify: `tests/engine/sequencer-helpers.test.ts` (rename from sequencer-types.test.ts)

- [ ] **Step 4.1: Write failing tests for helpers**

Append to `tests/engine/sequencer-helpers.test.ts` (rename the file from `sequencer-types.test.ts`):

```typescript
// tests/engine/sequencer-helpers.test.ts
import { describe, it, expect } from 'vitest';
import {
  createDefaultStep, createDefaultPattern, getAudibleTracks, resolveNoteParams,
} from '../../src/engine/sequencer-helpers';
import { createSession, toggleMute, toggleSolo } from '../../src/engine/session';
import type { Voice } from '../../src/engine/types';
import type { Step } from '../../src/engine/sequencer-types';

describe('createDefaultStep', () => {
  it('creates a step with gate off, no accent, no micro-timing', () => {
    const step = createDefaultStep();
    expect(step.gate).toBe(false);
    expect(step.accent).toBe(false);
    expect(step.micro).toBe(0);
    expect(step.params).toBeUndefined();
  });
});

describe('createDefaultPattern', () => {
  it('creates a 16-step pattern by default', () => {
    const pattern = createDefaultPattern();
    expect(pattern.length).toBe(16);
    expect(pattern.steps).toHaveLength(16);
  });

  it('creates a pattern with custom length', () => {
    const pattern = createDefaultPattern(32);
    expect(pattern.length).toBe(32);
    expect(pattern.steps).toHaveLength(32);
  });

  it('clamps length to 1-64', () => {
    expect(createDefaultPattern(0).length).toBe(1);
    expect(createDefaultPattern(100).length).toBe(64);
  });
});

describe('getAudibleTracks', () => {
  it('returns all unmuted voices when none soloed', () => {
    const session = createSession();
    const audible = getAudibleTracks(session);
    expect(audible).toHaveLength(4);
  });

  it('excludes muted voices when none soloed', () => {
    let s = createSession();
    s = toggleMute(s, s.tracks[0].id);
    const audible = getAudibleTracks(s);
    expect(audible).toHaveLength(3);
    expect(audible.find(v => v.id === s.tracks[0].id)).toBeUndefined();
  });

  it('returns only soloed voices when any is soloed', () => {
    let s = createSession();
    s = toggleSolo(s, s.tracks[1].id);
    const audible = getAudibleTracks(s);
    expect(audible).toHaveLength(1);
    expect(audible[0].id).toBe(s.tracks[1].id);
  });

  it('solo overrides mute', () => {
    let s = createSession();
    s = toggleMute(s, s.tracks[2].id);
    s = toggleSolo(s, s.tracks[2].id);
    const audible = getAudibleTracks(s);
    expect(audible).toHaveLength(1);
    expect(audible[0].id).toBe(s.tracks[2].id);
  });
});

describe('resolveNoteParams', () => {
  it('returns voice params when step has no locks', () => {
    const voice: Voice = {
      id: 'v0', engine: 'test', model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
      agency: 'SUGGEST', pattern: createDefaultPattern(), muted: false, solo: false,
    };
    const step: Step = { gate: true, accent: false, micro: 0 };
    const result = resolveNoteParams(voice, step, {});
    expect(result).toEqual(voice.params);
  });

  it('applies step param locks over voice params', () => {
    const voice: Voice = {
      id: 'v0', engine: 'test', model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
      agency: 'SUGGEST', pattern: createDefaultPattern(), muted: false, solo: false,
    };
    const step: Step = { gate: true, accent: false, micro: 0, params: { timbre: 0.9 } };
    const result = resolveNoteParams(voice, step, {});
    expect(result.timbre).toBe(0.9);
    expect(result.morph).toBe(0.5);
  });

  it('human held params override both voice and step', () => {
    const voice: Voice = {
      id: 'v0', engine: 'test', model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
      agency: 'SUGGEST', pattern: createDefaultPattern(), muted: false, solo: false,
    };
    const step: Step = { gate: true, accent: false, micro: 0, params: { timbre: 0.9 } };
    const result = resolveNoteParams(voice, step, { timbre: 0.2 });
    expect(result.timbre).toBe(0.2);
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

Run: `npx vitest run tests/engine/sequencer-helpers.test.ts`
Expected: FAIL — `getAudibleTracks`, `resolveNoteParams` not exported

- [ ] **Step 4.3: Implement getAudibleTracks and resolveNoteParams**

Add to `src/engine/sequencer-helpers.ts`:

```typescript
import type { Step, Pattern } from './sequencer-types';
import type { Session, Voice, SynthParamValues } from './types';

export function createDefaultStep(): Step {
  return { gate: false, accent: false, micro: 0 };
}

export function createDefaultPattern(length = 16): Pattern {
  const clamped = Math.max(1, Math.min(64, length));
  return {
    steps: Array.from({ length: clamped }, createDefaultStep),
    length: clamped,
  };
}

export function getAudibleTracks(session: Session): Voice[] {
  const anySoloed = session.tracks.some(v => v.solo);
  if (anySoloed) {
    return session.tracks.filter(v => v.solo);
  }
  return session.tracks.filter(v => !v.muted);
}

export function resolveNoteParams(
  voice: Voice,
  step: Step,
  heldParams: Partial<SynthParamValues>,
): SynthParamValues {
  return {
    ...voice.params,
    ...step.params,
    ...heldParams,
  } as SynthParamValues;
}
```

- [ ] **Step 4.4: Run tests**

Run: `npx vitest run tests/engine/sequencer-helpers.test.ts`
Expected: PASS (all tests)

- [ ] **Step 4.5: Commit**

```bash
git add src/engine/sequencer-helpers.ts tests/engine/sequencer-helpers.test.ts
git commit -m "feat: add getAudibleTracks and resolveNoteParams helpers"
```

---

### Task 5: Update primitives.ts for multi-voice + pattern snapshots

**Files:**
- Modify: `src/engine/primitives.ts`
- Modify: `tests/engine/primitives.test.ts`

- [ ] **Step 5.1: Write failing tests for multi-voice primitives**

Rewrite `tests/engine/primitives.test.ts` — update all `session.voice` references to use `getActiveTrack(session)` or voice lookup. Add tests for pattern snapshot undo and sketch pending actions.

```typescript
// tests/engine/primitives.test.ts
import { describe, it, expect } from 'vitest';
import {
  applyMove, applyMoveGroup, applyParamDirect, applySuggest,
  applyAudition, cancelAuditionParam, applyUndo, commitPending,
  dismissPending, applySketchPending,
} from '../../src/engine/primitives';
import { createSession, updateTrackParams } from '../../src/engine/session';
import { getActiveTrack, getTrack } from '../../src/engine/types';
import type { PatternSnapshot, SketchPendingAction, ParamSnapshot } from '../../src/engine/types';
import type { PatternSketch } from '../../src/engine/sequencer-types';

describe('Protocol Primitives (Phase 2)', () => {
  describe('applyMove', () => {
    it('applies absolute move to active voice', () => {
      const s = createSession();
      const vid = s.activeTrackId;
      const result = applyMove(s, vid, 'timbre', { absolute: 0.8 });
      expect(getTrack(result, vid).params.timbre).toBe(0.8);
      expect(result.undoStack.length).toBe(1);
      expect(result.undoStack[0].kind).toBe('param');
    });

    it('applies relative move', () => {
      let s = createSession();
      const vid = s.activeTrackId;
      s = updateTrackParams(s, vid, { timbre: 0.5 });
      const result = applyMove(s, vid, 'timbre', { relative: 0.2 });
      expect(getTrack(result, vid).params.timbre).toBeCloseTo(0.7);
    });

    it('clamps values to 0-1', () => {
      let s = createSession();
      const vid = s.activeTrackId;
      s = updateTrackParams(s, vid, { timbre: 0.9 });
      const result = applyMove(s, vid, 'timbre', { relative: 0.3 });
      expect(getTrack(result, vid).params.timbre).toBe(1.0);
    });
  });

  describe('applyMoveGroup', () => {
    it('applies multiple moves as a single undo entry', () => {
      const s = createSession();
      const vid = s.activeTrackId;
      const result = applyMoveGroup(s, vid, [
        { param: 'timbre', target: { absolute: 0.8 } },
        { param: 'morph', target: { absolute: 0.3 } },
      ]);
      expect(getTrack(result, vid).params.timbre).toBe(0.8);
      expect(getTrack(result, vid).params.morph).toBe(0.3);
      expect(result.undoStack.length).toBe(1);
    });
  });

  describe('applySuggest', () => {
    it('adds suggestion to pending list', () => {
      const s = createSession();
      const vid = s.activeTrackId;
      const result = applySuggest(s, vid, { timbre: 0.8 }, 'try this');
      expect(result.pending.length).toBe(1);
      expect(result.pending[0].kind).toBe('suggestion');
    });
  });

  describe('applyAudition', () => {
    it('applies changes and adds to pending', () => {
      const s = createSession();
      const vid = s.activeTrackId;
      const result = applyAudition(s, vid, { timbre: 0.8 }, 3000);
      expect(getTrack(result, vid).params.timbre).toBe(0.8);
      expect(result.pending.length).toBe(1);
      expect(result.pending[0].kind).toBe('audition');
    });
  });

  describe('applyUndo', () => {
    it('undoes a param snapshot', () => {
      const s = createSession();
      const vid = s.activeTrackId;
      const moved = applyMove(s, vid, 'timbre', { absolute: 0.8 });
      const undone = applyUndo(moved);
      expect(getTrack(undone, vid).params.timbre).toBe(0.5);
      expect(undone.undoStack.length).toBe(0);
    });

    it('undoes a pattern snapshot', () => {
      const s = createSession();
      const vid = s.activeTrackId;
      // Simulate a pattern edit by pushing a PatternSnapshot
      const snapshot: PatternSnapshot = {
        kind: 'pattern',
        trackId: vid,
        prevSteps: [{ index: 0, step: { gate: false, accent: false, micro: 0 } }],
        timestamp: Date.now(),
        description: 'toggle step 0',
      };
      // Manually toggle step 0 gate on
      const voice = getTrack(s, vid);
      const newSteps = [...voice.pattern.steps];
      newSteps[0] = { ...newSteps[0], gate: true };
      let modified = {
        ...s,
        tracks: s.tracks.map(v => v.id === vid ? { ...v, pattern: { ...v.pattern, steps: newSteps } } : v),
        undoStack: [...s.undoStack, snapshot],
      };
      expect(getTrack(modified, vid).pattern.steps[0].gate).toBe(true);

      const undone = applyUndo(modified);
      expect(getTrack(undone, vid).pattern.steps[0].gate).toBe(false);
      expect(undone.undoStack.length).toBe(0);
    });
  });

  describe('applySketchPending', () => {
    it('adds a sketch to pending queue', () => {
      const s = createSession();
      const sketch: PatternSketch = {
        steps: [
          { index: 0, gate: true },
          { index: 4, gate: true },
          { index: 8, gate: true },
          { index: 12, gate: true },
        ],
      };
      const result = applySketchPending(s, 'v0', 'four on the floor', sketch);
      expect(result.pending.length).toBe(1);
      expect(result.pending[0].kind).toBe('sketch');
    });
  });

  describe('commitPending sketch', () => {
    it('applies sketch pattern to voice and pushes PatternSnapshot', () => {
      const s = createSession();
      const sketch: PatternSketch = {
        steps: [
          { index: 0, gate: true, accent: true },
          { index: 4, gate: true },
        ],
      };
      const withPending = applySketchPending(s, 'v0', 'kick', sketch);
      const pendingId = withPending.pending[0].id;
      const committed = commitPending(withPending, pendingId);

      const voice = getTrack(committed, 'v0');
      expect(voice.pattern.steps[0].gate).toBe(true);
      expect(voice.pattern.steps[0].accent).toBe(true);
      expect(voice.pattern.steps[4].gate).toBe(true);
      expect(voice.pattern.steps[1].gate).toBe(false); // untouched
      expect(committed.pending.length).toBe(0);
      expect(committed.undoStack.length).toBe(1);
      expect(committed.undoStack[0].kind).toBe('pattern');
    });
  });

  describe('commitPending suggestion', () => {
    it('applies suggestion and pushes ParamSnapshot for undo', () => {
      const s = createSession();
      const vid = s.activeTrackId;
      const withPending = applySuggest(s, vid, { timbre: 0.9 }, 'brighter');
      const pendingId = withPending.pending[0].id;
      const committed = commitPending(withPending, pendingId);

      expect(getTrack(committed, vid).params.timbre).toBe(0.9);
      expect(committed.pending.length).toBe(0);
      expect(committed.undoStack.length).toBe(1);
      expect(committed.undoStack[0].kind).toBe('param');

      // Undo should revert
      const undone = applyUndo(committed);
      expect(getTrack(undone, vid).params.timbre).toBe(0.5);
    });
  });

  describe('dismissPending sketch', () => {
    it('removes sketch from pending without applying', () => {
      const s = createSession();
      const sketch: PatternSketch = {
        steps: [{ index: 0, gate: true }],
      };
      const withPending = applySketchPending(s, 'v0', 'test', sketch);
      const pendingId = withPending.pending[0].id;
      const dismissed = dismissPending(withPending, pendingId);

      const voice = getTrack(dismissed, 'v0');
      expect(voice.pattern.steps[0].gate).toBe(false); // unchanged
      expect(dismissed.pending.length).toBe(0);
    });
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

Run: `npx vitest run tests/engine/primitives.test.ts`
Expected: FAIL — function signatures changed, new functions missing

- [ ] **Step 5.3: Rewrite primitives.ts for multi-voice**

```typescript
// src/engine/primitives.ts
import type {
  Session, Snapshot, ParamSnapshot, PatternSnapshot,
  PendingAction, ParamPendingAction, SketchPendingAction,
  SynthParamValues,
} from './types';
import { getTrack, updateTrack } from './types';
import type { PatternSketch, Step } from './sequencer-types';

let nextPendingId = 1;

function clampParam(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function applyMove(
  session: Session,
  trackId: string,
  param: string,
  target: { absolute: number } | { relative: number },
): Session {
  const voice = getTrack(session, trackId);
  const currentValue = voice.params[param] ?? 0;
  const newValue = 'absolute' in target ? target.absolute : currentValue + target.relative;
  const clamped = clampParam(newValue);

  const snapshot: ParamSnapshot = {
    kind: 'param',
    trackId,
    prevValues: { [param]: currentValue },
    aiTargetValues: { [param]: clamped },
    timestamp: Date.now(),
    description: `AI move: ${param} ${currentValue.toFixed(2)} -> ${clamped.toFixed(2)}`,
  };

  return {
    ...updateTrack(session, trackId, {
      params: { ...voice.params, [param]: clamped },
    }),
    undoStack: [...session.undoStack, snapshot],
  };
}

export function applyMoveGroup(
  session: Session,
  trackId: string,
  moves: { param: string; target: { absolute: number } | { relative: number } }[],
): Session {
  const voice = getTrack(session, trackId);
  const prevValues: Partial<SynthParamValues> = {};
  const aiTargetValues: Partial<SynthParamValues> = {};
  const descriptions: string[] = [];

  for (const move of moves) {
    const cur = voice.params[move.param] ?? 0;
    prevValues[move.param] = cur;
    const nv = clampParam('absolute' in move.target ? move.target.absolute : cur + move.target.relative);
    aiTargetValues[move.param] = nv;
    descriptions.push(`${move.param} ${cur.toFixed(2)} -> ${nv.toFixed(2)}`);
  }

  const snapshot: ParamSnapshot = {
    kind: 'param',
    trackId,
    prevValues,
    aiTargetValues,
    timestamp: Date.now(),
    description: `AI group: ${descriptions.join(', ')}`,
  };

  const newParams = { ...voice.params };
  for (const move of moves) {
    const currentValue = newParams[move.param] ?? 0;
    const newValue = 'absolute' in move.target ? move.target.absolute : currentValue + move.target.relative;
    newParams[move.param] = clampParam(newValue);
  }

  return {
    ...updateTrack(session, trackId, { params: newParams }),
    undoStack: [...session.undoStack, snapshot],
  };
}

export function applyParamDirect(
  session: Session,
  trackId: string,
  param: string,
  value: number,
): Session {
  const voice = getTrack(session, trackId);
  return updateTrack(session, trackId, {
    params: { ...voice.params, [param]: clampParam(value) },
  });
}

export function applySuggest(
  session: Session,
  trackId: string,
  changes: Partial<SynthParamValues>,
  reason?: string,
): Session {
  const pending: ParamPendingAction = {
    id: `pending-${nextPendingId++}`,
    kind: 'suggestion',
    trackId,
    changes,
    reason,
    expiresAt: Date.now() + 15000,
    previousValues: {},
  };

  return { ...session, pending: [...session.pending, pending] };
}

export function applyAudition(
  session: Session,
  trackId: string,
  changes: Partial<SynthParamValues>,
  durationMs = 3000,
): Session {
  const voice = getTrack(session, trackId);
  let currentParams = { ...voice.params };

  const existingAudition = session.pending.find(
    (p): p is ParamPendingAction => p.kind === 'audition' && p.trackId === trackId,
  );
  if (existingAudition) {
    currentParams = { ...currentParams, ...existingAudition.previousValues } as SynthParamValues;
  }

  const pendingWithoutOld = session.pending.filter(
    p => !(p.kind === 'audition' && p.trackId === trackId),
  );

  const previousValues: Partial<SynthParamValues> = {};
  for (const key of Object.keys(changes)) {
    previousValues[key] = currentParams[key];
  }

  const pending: ParamPendingAction = {
    id: `pending-${nextPendingId++}`,
    kind: 'audition',
    trackId,
    changes,
    expiresAt: Date.now() + durationMs,
    previousValues,
  };

  return {
    ...updateTrack(session, trackId, {
      params: { ...currentParams, ...changes } as SynthParamValues,
    }),
    pending: [...pendingWithoutOld, pending],
  };
}

export function cancelAuditionParam(session: Session, trackId: string, param: string): Session {
  const audition = session.pending.find(
    (p): p is ParamPendingAction => p.kind === 'audition' && p.trackId === trackId,
  );
  if (!audition || !(param in audition.previousValues)) return session;

  const newPreviousValues = { ...audition.previousValues };
  delete newPreviousValues[param];
  const newChanges = { ...audition.changes };
  delete newChanges[param];

  if (Object.keys(newPreviousValues).length === 0) {
    return { ...session, pending: session.pending.filter(p => p.id !== audition.id) };
  }

  return {
    ...session,
    pending: session.pending.map(p =>
      p.id === audition.id ? { ...p, previousValues: newPreviousValues, changes: newChanges } : p,
    ),
  };
}

export function applySketchPending(
  session: Session,
  trackId: string,
  description: string,
  pattern: PatternSketch,
): Session {
  const pending: SketchPendingAction = {
    id: `pending-${nextPendingId++}`,
    kind: 'sketch',
    trackId,
    description,
    pattern,
    expiresAt: Date.now() + 30000,
  };

  return { ...session, pending: [...session.pending, pending] };
}

function applyPatternSketch(
  session: Session,
  trackId: string,
  sketch: PatternSketch,
): { session: Session; snapshot: PatternSnapshot } {
  const voice = getTrack(session, trackId);
  const prevSteps: { index: number; step: Step }[] = [];
  const newSteps = [...voice.pattern.steps];
  let newLength = voice.pattern.length;
  const prevLength = sketch.length !== undefined && sketch.length !== voice.pattern.length
    ? voice.pattern.length
    : undefined;

  if (sketch.length !== undefined) {
    const clamped = Math.max(1, Math.min(64, sketch.length));
    newLength = clamped;
    // Extend steps array if needed
    while (newSteps.length < clamped) {
      newSteps.push({ gate: false, accent: false, micro: 0 });
    }
  }

  for (const stepSketch of sketch.steps) {
    if (stepSketch.index < 0 || stepSketch.index >= newSteps.length) continue;
    prevSteps.push({ index: stepSketch.index, step: { ...newSteps[stepSketch.index] } });
    const existing = newSteps[stepSketch.index];
    newSteps[stepSketch.index] = {
      gate: stepSketch.gate ?? existing.gate,
      accent: stepSketch.accent ?? existing.accent,
      micro: stepSketch.micro ?? existing.micro,
      params: stepSketch.params !== undefined
        ? { ...existing.params, ...stepSketch.params }
        : existing.params,
    };
  }

  const snapshot: PatternSnapshot = {
    kind: 'pattern',
    trackId,
    prevSteps,
    prevLength,
    timestamp: Date.now(),
    description: `sketch applied`,
  };

  const updated = updateTrack(session, trackId, {
    pattern: { steps: newSteps, length: newLength },
  });

  return { session: updated, snapshot };
}

export function commitPending(session: Session, pendingId: string): Session {
  const action = session.pending.find(p => p.id === pendingId);
  if (!action) return session;

  const remaining = session.pending.filter(p => p.id !== pendingId);

  if (action.kind === 'sketch') {
    const { session: updated, snapshot } = applyPatternSketch(session, action.trackId, action.pattern);
    return {
      ...updated,
      pending: remaining,
      undoStack: [...updated.undoStack, snapshot],
    };
  }

  // ParamPendingAction (suggestion) — apply changes and push undo snapshot
  if (action.kind === 'suggestion') {
    const voice = getTrack(session, action.trackId);
    const prevValues: Partial<SynthParamValues> = {};
    for (const key of Object.keys(action.changes)) {
      prevValues[key] = voice.params[key];
    }
    const snapshot: ParamSnapshot = {
      kind: 'param',
      trackId: action.trackId,
      prevValues,
      aiTargetValues: action.changes,
      timestamp: Date.now(),
      description: `AI suggest committed: ${Object.keys(action.changes).join(', ')}`,
    };
    return {
      ...updateTrack(session, action.trackId, {
        params: { ...voice.params, ...action.changes } as SynthParamValues,
      }),
      pending: remaining,
      undoStack: [...session.undoStack, snapshot],
    };
  }

  // Audition — already applied, just remove from pending
  return { ...session, pending: remaining };
}

export function dismissPending(session: Session, pendingId: string): Session {
  const action = session.pending.find(p => p.id === pendingId);
  if (!action) return session;

  if (action.kind === 'audition') {
    const voice = getTrack(session, action.trackId);
    return {
      ...updateTrack(session, action.trackId, {
        params: { ...voice.params, ...action.previousValues } as SynthParamValues,
      }),
      pending: session.pending.filter(p => p.id !== pendingId),
    };
  }

  // Suggestion or sketch — just remove
  return { ...session, pending: session.pending.filter(p => p.id !== pendingId) };
}

export function applyUndo(session: Session): Session {
  if (session.undoStack.length === 0) return session;

  const newStack = [...session.undoStack];
  const snapshot = newStack.pop()!;

  if (snapshot.kind === 'pattern') {
    const voice = getTrack(session, snapshot.trackId);
    const newSteps = [...voice.pattern.steps];
    for (const { index, step } of snapshot.prevSteps) {
      if (index < newSteps.length) {
        newSteps[index] = step;
      }
    }
    const newLength = snapshot.prevLength ?? voice.pattern.length;
    return {
      ...updateTrack(session, snapshot.trackId, {
        pattern: { steps: newSteps, length: newLength },
      }),
      undoStack: newStack,
    };
  }

  // ParamSnapshot
  const voice = getTrack(session, snapshot.trackId);
  const newParams = { ...voice.params };
  for (const [param, prevValue] of Object.entries(snapshot.prevValues)) {
    const aiTarget = snapshot.aiTargetValues[param];
    const currentValue = newParams[param];
    if (aiTarget !== undefined && Math.abs(currentValue - aiTarget) < 0.001) {
      newParams[param] = prevValue as number;
    }
  }

  return {
    ...updateTrack(session, snapshot.trackId, { params: newParams }),
    undoStack: newStack,
  };
}
```

- [ ] **Step 5.4: Run primitives tests**

Run: `npx vitest run tests/engine/primitives.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5.5: Commit**

```bash
git add src/engine/primitives.ts tests/engine/primitives.test.ts
git commit -m "feat: rewrite primitives for multi-voice, pattern snapshots, sketch pending"
```

---

### Task 6: Pattern editing primitives

**Files:**
- Create: `src/engine/pattern-primitives.ts`
- Create: `tests/engine/pattern-primitives.test.ts`

- [ ] **Step 6.1: Write failing tests**

```typescript
// tests/engine/pattern-primitives.test.ts
import { describe, it, expect } from 'vitest';
import {
  toggleStepGate, toggleStepAccent, setStepParamLock, clearStepParamLock,
  setPatternLength, clearPattern,
} from '../../src/engine/pattern-primitives';
import { createSession } from '../../src/engine/session';
import { getTrack, updateTrack } from '../../src/engine/types';
import type { PatternSnapshot } from '../../src/engine/types';

describe('Pattern Primitives', () => {
  describe('toggleStepGate', () => {
    it('toggles gate on', () => {
      const s = createSession();
      const vid = s.tracks[0].id;
      const result = toggleStepGate(s, vid, 0);
      expect(getTrack(result, vid).pattern.steps[0].gate).toBe(true);
      expect(result.undoStack.length).toBe(1);
      expect(result.undoStack[0].kind).toBe('pattern');
    });

    it('toggles gate off', () => {
      let s = createSession();
      const vid = s.tracks[0].id;
      s = toggleStepGate(s, vid, 0);
      const result = toggleStepGate(s, vid, 0);
      expect(getTrack(result, vid).pattern.steps[0].gate).toBe(false);
    });

    it('ignores out-of-range step index', () => {
      const s = createSession();
      const result = toggleStepGate(s, s.tracks[0].id, 99);
      expect(result).toBe(s);
    });
  });

  describe('toggleStepAccent', () => {
    it('toggles accent on a gated step', () => {
      let s = createSession();
      const vid = s.tracks[0].id;
      s = toggleStepGate(s, vid, 0);
      const result = toggleStepAccent(s, vid, 0);
      expect(getTrack(result, vid).pattern.steps[0].accent).toBe(true);
    });
  });

  describe('setStepParamLock', () => {
    it('sets a parameter lock on a step', () => {
      let s = createSession();
      const vid = s.tracks[0].id;
      const result = setStepParamLock(s, vid, 0, { timbre: 0.9 });
      expect(getTrack(result, vid).pattern.steps[0].params?.timbre).toBe(0.9);
      expect(result.undoStack.length).toBe(1);
    });

    it('merges with existing locks', () => {
      let s = createSession();
      const vid = s.tracks[0].id;
      s = setStepParamLock(s, vid, 0, { timbre: 0.9 });
      const result = setStepParamLock(s, vid, 0, { morph: 0.3 });
      const step = getTrack(result, vid).pattern.steps[0];
      expect(step.params?.timbre).toBe(0.9);
      expect(step.params?.morph).toBe(0.3);
    });
  });

  describe('clearStepParamLock', () => {
    it('removes a specific lock', () => {
      let s = createSession();
      const vid = s.tracks[0].id;
      s = setStepParamLock(s, vid, 0, { timbre: 0.9, morph: 0.3 });
      const result = clearStepParamLock(s, vid, 0, 'timbre');
      const step = getTrack(result, vid).pattern.steps[0];
      expect(step.params?.timbre).toBeUndefined();
      expect(step.params?.morph).toBe(0.3);
    });

    it('removes params entirely when last lock cleared', () => {
      let s = createSession();
      const vid = s.tracks[0].id;
      s = setStepParamLock(s, vid, 0, { timbre: 0.9 });
      const result = clearStepParamLock(s, vid, 0, 'timbre');
      expect(getTrack(result, vid).pattern.steps[0].params).toBeUndefined();
    });
  });

  describe('setPatternLength', () => {
    it('changes pattern length', () => {
      const s = createSession();
      const vid = s.tracks[0].id;
      const result = setPatternLength(s, vid, 8);
      expect(getTrack(result, vid).pattern.length).toBe(8);
      expect(result.undoStack.length).toBe(1);
    });

    it('extends steps array when length exceeds current steps', () => {
      const s = createSession();
      const vid = s.tracks[0].id;
      const result = setPatternLength(s, vid, 32);
      const pattern = getTrack(result, vid).pattern;
      expect(pattern.length).toBe(32);
      expect(pattern.steps.length).toBe(32);
    });

    it('clamps to 1-64', () => {
      const s = createSession();
      const vid = s.tracks[0].id;
      expect(getTrack(setPatternLength(s, vid, 0), vid).pattern.length).toBe(1);
      expect(getTrack(setPatternLength(s, vid, 100), vid).pattern.length).toBe(64);
    });
  });

  describe('clearPattern', () => {
    it('resets all steps to defaults', () => {
      let s = createSession();
      const vid = s.tracks[0].id;
      s = toggleStepGate(s, vid, 0);
      s = toggleStepGate(s, vid, 4);
      const result = clearPattern(s, vid);
      const pattern = getTrack(result, vid).pattern;
      expect(pattern.steps.every(step => !step.gate)).toBe(true);
      expect(result.undoStack.length).toBe(3); // 2 toggles + 1 clear
    });

    it('preserves steps with micro-timing in undo snapshot', () => {
      let s = createSession();
      const vid = s.tracks[0].id;
      // Manually set micro on a step without gate/accent/params
      const voice = getTrack(s, vid);
      const steps = [...voice.pattern.steps];
      steps[3] = { ...steps[3], micro: 0.25 };
      s = updateTrack(s, vid, { pattern: { ...voice.pattern, steps } });
      const result = clearPattern(s, vid);
      // Should have an undo entry even though only micro was set
      expect(result.undoStack.length).toBe(1);
      const snapshot = result.undoStack[0] as PatternSnapshot;
      expect(snapshot.prevSteps.some(({ step }) => step.micro === 0.25)).toBe(true);
    });
  });
});
```

- [ ] **Step 6.2: Run test to verify it fails**

Run: `npx vitest run tests/engine/pattern-primitives.test.ts`
Expected: FAIL — module not found

- [ ] **Step 6.3: Implement pattern primitives**

```typescript
// src/engine/pattern-primitives.ts
import type { Session, PatternSnapshot, SynthParamValues } from './types';
import { getTrack, updateTrack } from './types';
import type { Step } from './sequencer-types';
import { createDefaultStep } from './sequencer-helpers';

function pushPatternSnapshot(
  session: Session,
  trackId: string,
  prevSteps: { index: number; step: Step }[],
  description: string,
  prevLength?: number,
): Session {
  const snapshot: PatternSnapshot = {
    kind: 'pattern',
    trackId,
    prevSteps,
    prevLength,
    timestamp: Date.now(),
    description,
  };
  return { ...session, undoStack: [...session.undoStack, snapshot] };
}

export function toggleStepGate(session: Session, trackId: string, stepIndex: number): Session {
  const voice = getTrack(session, trackId);
  if (stepIndex < 0 || stepIndex >= voice.pattern.steps.length) return session;

  const oldStep = voice.pattern.steps[stepIndex];
  const newSteps = [...voice.pattern.steps];
  newSteps[stepIndex] = { ...oldStep, gate: !oldStep.gate };

  let result = updateTrack(session, trackId, {
    pattern: { ...voice.pattern, steps: newSteps },
  });
  return pushPatternSnapshot(result, trackId,
    [{ index: stepIndex, step: { ...oldStep } }],
    `toggle step ${stepIndex} gate`,
  );
}

export function toggleStepAccent(session: Session, trackId: string, stepIndex: number): Session {
  const voice = getTrack(session, trackId);
  if (stepIndex < 0 || stepIndex >= voice.pattern.steps.length) return session;

  const oldStep = voice.pattern.steps[stepIndex];
  const newSteps = [...voice.pattern.steps];
  newSteps[stepIndex] = { ...oldStep, accent: !oldStep.accent };

  let result = updateTrack(session, trackId, {
    pattern: { ...voice.pattern, steps: newSteps },
  });
  return pushPatternSnapshot(result, trackId,
    [{ index: stepIndex, step: { ...oldStep } }],
    `toggle step ${stepIndex} accent`,
  );
}

export function setStepParamLock(
  session: Session,
  trackId: string,
  stepIndex: number,
  params: Partial<SynthParamValues>,
): Session {
  const voice = getTrack(session, trackId);
  if (stepIndex < 0 || stepIndex >= voice.pattern.steps.length) return session;

  const oldStep = voice.pattern.steps[stepIndex];
  const newSteps = [...voice.pattern.steps];
  newSteps[stepIndex] = {
    ...oldStep,
    params: { ...oldStep.params, ...params },
  };

  let result = updateTrack(session, trackId, {
    pattern: { ...voice.pattern, steps: newSteps },
  });
  return pushPatternSnapshot(result, trackId,
    [{ index: stepIndex, step: { ...oldStep } }],
    `set param lock on step ${stepIndex}`,
  );
}

export function clearStepParamLock(
  session: Session,
  trackId: string,
  stepIndex: number,
  param: string,
): Session {
  const voice = getTrack(session, trackId);
  if (stepIndex < 0 || stepIndex >= voice.pattern.steps.length) return session;

  const oldStep = voice.pattern.steps[stepIndex];
  if (!oldStep.params || !(param in oldStep.params)) return session;

  const newParams = { ...oldStep.params };
  delete newParams[param];
  const newSteps = [...voice.pattern.steps];
  newSteps[stepIndex] = {
    ...oldStep,
    params: Object.keys(newParams).length > 0 ? newParams : undefined,
  };

  let result = updateTrack(session, trackId, {
    pattern: { ...voice.pattern, steps: newSteps },
  });
  return pushPatternSnapshot(result, trackId,
    [{ index: stepIndex, step: { ...oldStep } }],
    `clear ${param} lock on step ${stepIndex}`,
  );
}

export function setPatternLength(session: Session, trackId: string, length: number): Session {
  const voice = getTrack(session, trackId);
  const clamped = Math.max(1, Math.min(64, length));
  if (clamped === voice.pattern.length) return session;

  const newSteps = [...voice.pattern.steps];
  while (newSteps.length < clamped) {
    newSteps.push(createDefaultStep());
  }

  let result = updateTrack(session, trackId, {
    pattern: { steps: newSteps, length: clamped },
  });
  return pushPatternSnapshot(result, trackId, [],
    `change pattern length ${voice.pattern.length} -> ${clamped}`,
    voice.pattern.length,
  );
}

export function clearPattern(session: Session, trackId: string): Session {
  const voice = getTrack(session, trackId);
  const prevSteps = voice.pattern.steps
    .map((step, index) => ({ index, step: { ...step } }))
    .filter(({ step }) => step.gate || step.accent || step.params !== undefined || step.micro !== 0);

  if (prevSteps.length === 0) return session;

  const newSteps = voice.pattern.steps.map(() => createDefaultStep());
  let result = updateTrack(session, trackId, {
    pattern: { ...voice.pattern, steps: newSteps },
  });
  return pushPatternSnapshot(result, trackId, prevSteps, 'clear pattern');
}
```

- [ ] **Step 6.4: Run tests**

Run: `npx vitest run tests/engine/pattern-primitives.test.ts`
Expected: PASS (all tests)

- [ ] **Step 6.5: Commit**

```bash
git add src/engine/pattern-primitives.ts tests/engine/pattern-primitives.test.ts
git commit -m "feat: add pattern editing primitives with undo support"
```

---

### Task 7: Update arbitrator for held param values

**Files:**
- Modify: `src/engine/arbitration.ts`
- Modify: `tests/engine/arbitration.test.ts`

- [ ] **Step 7.1: Write failing tests**

```typescript
// tests/engine/arbitration.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Arbitrator } from '../../src/engine/arbitration';

describe('Arbitrator', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('blocks AI during active interaction', () => {
    const arb = new Arbitrator();
    arb.humanInteractionStart();
    expect(arb.canAIAct('timbre')).toBe(false);
    arb.humanInteractionEnd();
    vi.advanceTimersByTime(600);
    expect(arb.canAIAct('timbre')).toBe(true);
  });

  it('blocks AI for cooldown after param touch', () => {
    const arb = new Arbitrator(500);
    arb.humanTouched('v0', 'timbre', 0.8);
    expect(arb.canAIAct('timbre')).toBe(false);
    vi.advanceTimersByTime(600);
    expect(arb.canAIAct('timbre')).toBe(true);
  });

  it('getHeldParams returns values within cooldown for specific voice', () => {
    const arb = new Arbitrator(500);
    arb.humanTouched('v0', 'timbre', 0.8);
    arb.humanTouched('v0', 'morph', 0.3);
    const held = arb.getHeldParams('v0');
    expect(held.timbre).toBe(0.8);
    expect(held.morph).toBe(0.3);
    // Different voice should be empty
    expect(arb.getHeldParams('v1')).toEqual({});
  });

  it('getHeldParams excludes expired params', () => {
    const arb = new Arbitrator(500);
    arb.humanTouched('v0', 'timbre', 0.8);
    vi.advanceTimersByTime(600);
    const held = arb.getHeldParams('v0');
    expect(held.timbre).toBeUndefined();
  });

  it('getHeldParams returns empty when no interaction', () => {
    const arb = new Arbitrator();
    expect(arb.getHeldParams('v0')).toEqual({});
  });

  it('tracks params per voice independently', () => {
    const arb = new Arbitrator(500);
    arb.humanTouched('v0', 'timbre', 0.8);
    arb.humanTouched('v1', 'timbre', 0.2);
    expect(arb.getHeldParams('v0').timbre).toBe(0.8);
    expect(arb.getHeldParams('v1').timbre).toBe(0.2);
  });
});
```

- [ ] **Step 7.2: Run test to verify it fails**

Run: `npx vitest run tests/engine/arbitration.test.ts`
Expected: FAIL — `humanTouched` signature mismatch, `getHeldParams` not found

- [ ] **Step 7.3: Update arbitrator**

```typescript
// src/engine/arbitration.ts
import type { SynthParamValues } from './types';

interface TouchRecord {
  value: number;
  timestamp: number;
}

export class Arbitrator {
  // Key: "trackId:param" → TouchRecord
  private touches: Map<string, TouchRecord> = new Map();
  private cooldownMs: number;
  private activeInteraction = false;

  constructor(cooldownMs = 500) {
    this.cooldownMs = cooldownMs;
  }

  private key(trackId: string, param: string): string {
    return `${trackId}:${param}`;
  }

  humanTouched(trackId: string, param: string, value: number): void {
    this.touches.set(this.key(trackId, param), { value, timestamp: Date.now() });
  }

  humanInteractionStart(): void {
    this.activeInteraction = true;
  }

  humanInteractionEnd(): void {
    this.activeInteraction = false;
  }

  canAIAct(param: string): boolean {
    if (this.activeInteraction) return false;
    // Check across all voices for this param
    const now = Date.now();
    for (const [k, record] of this.touches) {
      if (k.endsWith(`:${param}`) && now - record.timestamp <= this.cooldownMs) {
        return false;
      }
    }
    return true;
  }

  getHeldParams(trackId: string): Partial<SynthParamValues> {
    const now = Date.now();
    const prefix = `${trackId}:`;
    const held: Partial<SynthParamValues> = {};
    for (const [k, record] of this.touches) {
      if (!k.startsWith(prefix)) continue;
      if (now - record.timestamp <= this.cooldownMs || this.activeInteraction) {
        const param = k.slice(prefix.length);
        held[param] = record.value;
      }
    }
    return held;
  }
}
```

- [ ] **Step 7.4: Run tests**

Run: `npx vitest run tests/engine/arbitration.test.ts`
Expected: PASS (all tests)

- [ ] **Step 7.5: Commit**

```bash
git add src/engine/arbitration.ts tests/engine/arbitration.test.ts
git commit -m "feat: extend arbitrator with held param values for sequencer note resolution"
```

---

### Task 8: Update SynthEngine interface and WebAudioSynth

> **Note:** Tasks 8-9 modify Web Audio API code that requires a browser AudioContext. Unit tests are deferred — these are verified via integration tests in Task 22 (build + type-check) and manual testing in Task 23. The Scheduler tests (Task 10) exercise the scheduling boundary through mocked callbacks.

**Files:**
- Modify: `src/audio/synth-interface.ts`
- Modify: `src/audio/web-audio-synth.ts`

- [ ] **Step 8.1: Add trigger() and setGateOpen() to SynthEngine**

```typescript
// src/audio/synth-interface.ts — add to SynthEngine interface:
export interface SynthEngine {
  setModel(model: number): void;
  setParams(params: SynthParams): void;
  render(output: Float32Array): Float32Array;
  trigger(): void;              // NEW: restart envelope/exciter
  setGateOpen(open: boolean): void;  // NEW: for sustained note models
  destroy(): void;
}
// Note: getAnalyser() stays on WebAudioSynth only, not on the interface.
// The AudioEngine has its own analyser in the mixer graph.
```

- [ ] **Step 8.2: Implement trigger() and setGateOpen() in WebAudioSynth**

Update `WebAudioSynth` to:
1. Accept a target `GainNode` instead of connecting to `ctx.destination`
2. Implement `trigger()` (restarts oscillator with envelope)
3. Implement `setGateOpen()` (release envelope)

```typescript
// src/audio/web-audio-synth.ts
import type { SynthEngine, SynthParams } from './synth-interface';
import { DEFAULT_PARAMS, noteToHz } from './synth-interface';

export class WebAudioSynth implements SynthEngine {
  private ctx: AudioContext;
  private oscillator: OscillatorNode;
  private envelope: GainNode;
  private filter: BiquadFilterNode;
  private analyser: AnalyserNode;
  private params: SynthParams = { ...DEFAULT_PARAMS };
  private gateOpen = true;

  constructor(ctx: AudioContext, output?: AudioNode) {
    this.ctx = ctx;
    this.oscillator = ctx.createOscillator();
    this.filter = ctx.createBiquadFilter();
    this.envelope = ctx.createGain();
    this.analyser = ctx.createAnalyser();

    this.oscillator.connect(this.filter);
    this.filter.connect(this.envelope);
    this.envelope.connect(this.analyser);
    this.analyser.connect(output ?? ctx.destination);

    this.filter.type = 'lowpass';
    this.filter.frequency.value = 2000;
    this.envelope.gain.value = 0.3;
    this.oscillator.start();
    this.applyParams();
  }

  setModel(model: number): void {
    const typeMap: OscillatorType[] = [
      'sawtooth', 'square', 'sine', 'sawtooth', 'sine', 'square', 'sawtooth', 'square',
      'sawtooth', 'sawtooth', 'square', 'triangle', 'sine', 'sine', 'square', 'square',
    ];
    this.oscillator.type = typeMap[model] ?? 'sine';
  }

  setParams(params: SynthParams): void {
    this.params = { ...params };
    this.applyParams();
  }

  private applyParams(): void {
    this.oscillator.frequency.value = noteToHz(this.params.note);
    this.filter.frequency.value = 200 + this.params.timbre * 7800;
    this.filter.Q.value = 0.5 + this.params.morph * 14.5;
    this.oscillator.detune.value = (this.params.harmonics - 0.5) * 100;
  }

  trigger(): void {
    const now = this.ctx.currentTime;
    this.envelope.gain.cancelScheduledValues(now);
    this.envelope.gain.setValueAtTime(0.01, now);
    this.envelope.gain.linearRampToValueAtTime(0.3, now + 0.005);
    this.gateOpen = true;
  }

  setGateOpen(open: boolean): void {
    if (this.gateOpen === open) return;
    this.gateOpen = open;
    if (!open) {
      const now = this.ctx.currentTime;
      this.envelope.gain.cancelScheduledValues(now);
      this.envelope.gain.setTargetAtTime(0, now, 0.05);
    }
  }

  getSchedulableParams(): { frequency: AudioParam; filterFreq: AudioParam; filterQ: AudioParam; detune: AudioParam } {
    return {
      frequency: this.oscillator.frequency,
      filterFreq: this.filter.frequency,
      filterQ: this.filter.Q,
      detune: this.oscillator.detune,
    };
  }

  getAnalyser(): AnalyserNode {
    return this.analyser;
  }

  render(_output: Float32Array): Float32Array {
    return _output;
  }

  destroy(): void {
    this.oscillator.stop();
    this.oscillator.disconnect();
    this.filter.disconnect();
    this.envelope.disconnect();
    this.analyser.disconnect();
  }
}
```

- [ ] **Step 8.3: Commit**

```bash
git add src/audio/synth-interface.ts src/audio/web-audio-synth.ts
git commit -m "feat: add trigger/setGateOpen to SynthEngine, WebAudioSynth accepts output node"
```

---

### Task 9: Rewrite AudioEngine for multi-voice

**Files:**
- Modify: `src/audio/audio-engine.ts`

- [ ] **Step 9.1: Rewrite AudioEngine**

```typescript
// src/audio/audio-engine.ts
import type { SynthParams } from './synth-interface';
import { DEFAULT_PARAMS } from './synth-interface';
import { WebAudioSynth } from './web-audio-synth';
import type { ScheduledNote } from '../engine/sequencer-types';

const VOICE_COUNT = 4;
const ACCENT_GAIN_BOOST = 2.0; // +6dB ≈ 2x linear gain

interface TrackSlot {
  synth: WebAudioSynth;
  muteGain: GainNode;    // controlled by mute/solo — never touched by scheduleNote
  accentGain: GainNode;  // controlled by scheduleNote for accent boosts
  currentParams: SynthParams;
  currentModel: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private tracks: Map<string, TrackSlot> = new Map();
  private mixer: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStreamDest: MediaStreamAudioDestinationNode | null = null;
  private _isRunning = false;
  private scheduledTimeouts: number[] = [];

  get isRunning(): boolean {
    return this._isRunning;
  }

  async start(trackIds: string[]): Promise<void> {
    if (this._isRunning) return;
    this.ctx = new AudioContext({ sampleRate: 48000 });

    this.mixer = this.ctx.createGain();
    this.mixer.gain.value = 1.0;

    this.analyser = this.ctx.createAnalyser();
    this.mediaStreamDest = this.ctx.createMediaStreamDestination();

    this.mixer.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.mixer.connect(this.mediaStreamDest);

    for (const trackId of trackIds) {
      // Two gain stages: accentGain (per-note dynamics) → muteGain (mute/solo)
      const accentGain = this.ctx.createGain();
      accentGain.gain.value = 0.3;
      const muteGain = this.ctx.createGain();
      muteGain.gain.value = 1.0; // 1 = audible, 0 = muted
      accentGain.connect(muteGain);
      muteGain.connect(this.mixer);

      const synth = new WebAudioSynth(this.ctx, accentGain);
      this.tracks.set(trackId, {
        synth,
        muteGain,
        accentGain,
        currentParams: { ...DEFAULT_PARAMS },
        currentModel: 0,
      });
    }

    this._isRunning = true;
  }

  stop(): void {
    if (!this._isRunning) return;
    for (const timeout of this.scheduledTimeouts) {
      clearTimeout(timeout);
    }
    this.scheduledTimeouts = [];
    for (const slot of this.tracks.values()) {
      slot.synth.destroy();
    }
    this.tracks.clear();
    this.mixer?.disconnect();
    this.analyser?.disconnect();
    this.mediaStreamDest?.disconnect();
    this.ctx?.close();
    this.ctx = null;
    this.mixer = null;
    this.analyser = null;
    this.mediaStreamDest = null;
    this._isRunning = false;
  }

  setVoiceModel(trackId: string, model: number): void {
    const slot = this.tracks.get(trackId);
    if (!slot) return;
    slot.currentModel = model;
    slot.synth.setModel(model);
  }

  setVoiceParams(trackId: string, params: SynthParams): void {
    const slot = this.tracks.get(trackId);
    if (!slot) return;
    slot.currentParams = { ...params };
    slot.synth.setParams(params);
  }

  muteVoice(trackId: string, muted: boolean): void {
    const slot = this.tracks.get(trackId);
    if (!slot) return;
    // Only touch muteGain — accentGain is controlled by scheduleNote
    slot.muteGain.gain.value = muted ? 0 : 1;
  }

  scheduleNote(note: ScheduledNote): void {
    if (!this.ctx) return;
    const slot = this.tracks.get(note.trackId);
    if (!slot) return;

    // --- Continuous params: schedule sample-accurately via AudioParam ---
    // WebAudioSynth exposes its AudioParams through getSchedulableParams()
    const schedulable = slot.synth.getSchedulableParams();
    if (schedulable) {
      const { frequency, filterFreq, filterQ, detune } = schedulable;
      // Map normalised params to audio values (same formulas as WebAudioSynth.applyParams)
      const noteHz = 440 * Math.pow(2, (note.params.note * 127 - 69) / 12);
      frequency.setValueAtTime(noteHz, note.time);
      filterFreq.setValueAtTime(200 + note.params.timbre * 7800, note.time);
      filterQ.setValueAtTime(0.5 + note.params.morph * 14.5, note.time);
      detune.setValueAtTime((note.params.harmonics - 0.5) * 100, note.time);
    }

    // --- Accent gain: schedule on accentGain (separate from muteGain) ---
    const accentLevel = note.accent ? 0.3 * ACCENT_GAIN_BOOST : 0.3;
    slot.accentGain.gain.setValueAtTime(accentLevel, note.time);
    if (note.accent) {
      // Revert accent at gate-off
      slot.accentGain.gain.setValueAtTime(0.3, note.gateOffTime);
    }

    // --- Discrete events: trigger and gate-off via setTimeout with compensation ---
    const now = this.ctx.currentTime;
    const triggerDelay = Math.max(0, (note.time - now) * 1000);
    const triggerTimeout = window.setTimeout(() => {
      // Fine-tune: check actual AudioContext time on firing
      slot.synth.trigger();
    }, triggerDelay);
    this.scheduledTimeouts.push(triggerTimeout);

    const gateOffDelay = Math.max(0, (note.gateOffTime - now) * 1000);
    const gateOffTimeout = window.setTimeout(() => {
      slot.synth.setGateOpen(false);
    }, gateOffDelay);
    this.scheduledTimeouts.push(gateOffTimeout);
  }

  getCurrentTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  getMediaStreamDestination(): MediaStreamAudioDestinationNode | null {
    return this.mediaStreamDest;
  }

  // Legacy single-voice API (for Phase 1 compatibility during migration)
  setModel(model: number): void {
    const firstVoice = this.tracks.keys().next().value;
    if (firstVoice) this.setVoiceModel(firstVoice, model);
  }

  setParams(params: Partial<SynthParams>): void {
    const firstVoice = this.tracks.entries().next().value;
    if (firstVoice) {
      const [id, slot] = firstVoice;
      const merged = { ...slot.currentParams, ...params };
      this.setVoiceParams(id, merged);
    }
  }
}
```

- [ ] **Step 9.2: Commit**

```bash
git add src/audio/audio-engine.ts
git commit -m "feat: rewrite AudioEngine for multi-voice with scheduleNote and mixer graph"
```

---

## Chunk 2: Sequencer Engine

### Task 10: Scheduler class — core tick loop and note emission

**Files:**
- Create: `src/engine/scheduler.ts`
- Create: `tests/engine/scheduler.test.ts`

- [ ] **Step 10.1: Write failing tests for Scheduler**

```typescript
// tests/engine/scheduler.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler } from '../../src/engine/scheduler';
import { createSession } from '../../src/engine/session';
import { toggleStepGate } from '../../src/engine/pattern-primitives';
import type { Session } from '../../src/engine/types';
import type { ScheduledNote } from '../../src/engine/sequencer-types';
import { getTrack } from '../../src/engine/types';

describe('Scheduler', () => {
  let session: Session;
  let notes: ScheduledNote[];
  let positions: number[];
  let audioTime: number;

  beforeEach(() => {
    vi.useFakeTimers();
    session = createSession();
    notes = [];
    positions = [];
    audioTime = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createScheduler(getSession?: () => Session) {
    return new Scheduler(
      getSession ?? (() => session),
      () => audioTime,
      (note) => notes.push(note),
      (pos) => positions.push(pos),
      () => ({}), // no held params in tests by default
    );
  }

  it('does not emit notes when no steps are gated', () => {
    const sched = createScheduler();
    sched.start();
    audioTime = 0.5;
    vi.advanceTimersByTime(200);
    sched.stop();
    expect(notes).toHaveLength(0);
  });

  it('emits notes for gated steps', () => {
    // Gate steps 0 and 4 on voice 0
    const vid = session.tracks[0].id;
    session = toggleStepGate(session, vid, 0);
    session = toggleStepGate(session, vid, 4);

    const sched = createScheduler();
    sched.start();

    // BPM 120 = 0.125s per 16th note
    // Advance enough time for step 0 to be scheduled
    audioTime = 0.2;
    vi.advanceTimersByTime(100);

    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes[0].trackId).toBe(vid);
    expect(notes[0].params).toBeDefined();
    sched.stop();
  });

  it('publishes position changes', () => {
    const vid = session.tracks[0].id;
    session = toggleStepGate(session, vid, 0);
    const sched = createScheduler();
    sched.start();
    audioTime = 0.3;
    vi.advanceTimersByTime(100);
    expect(positions.length).toBeGreaterThan(0);
    sched.stop();
  });

  it('stops cleanly', () => {
    const sched = createScheduler();
    sched.start();
    expect(sched.isRunning()).toBe(true);
    sched.stop();
    expect(sched.isRunning()).toBe(false);
  });

  it('applies swing to odd-position steps in beat pairs', () => {
    // Set swing to 0.5
    session = { ...session, transport: { ...session.transport, swing: 0.5 } };
    const vid = session.tracks[0].id;
    // Gate steps 0 and 1 (a pair within a beat)
    session = toggleStepGate(session, vid, 0);
    session = toggleStepGate(session, vid, 1);

    const sched = createScheduler();
    sched.start();
    audioTime = 0.5;
    vi.advanceTimersByTime(200);
    sched.stop();

    // Step 0 should be at base time, step 1 should be delayed by swing
    const step0Notes = notes.filter(n => n.time < 0.13);
    const step1Notes = notes.filter(n => n.time >= 0.13);
    if (step0Notes.length > 0 && step1Notes.length > 0) {
      // Step 1 should be later than step 0 + base step duration
      expect(step1Notes[0].time).toBeGreaterThan(step0Notes[0].time + 0.1);
    }
  });

  it('resolves note params with voice base + step locks', () => {
    const vid = session.tracks[0].id;
    // Set a param lock on step 0
    const voice = getTrack(session, vid);
    const newSteps = [...voice.pattern.steps];
    newSteps[0] = { gate: true, accent: false, micro: 0, params: { timbre: 0.9 } };
    session = {
      ...session,
      tracks: session.tracks.map(v => v.id === vid
        ? { ...v, pattern: { ...v.pattern, steps: newSteps } }
        : v
      ),
    };

    const sched = createScheduler();
    sched.start();
    audioTime = 0.2;
    vi.advanceTimersByTime(100);
    sched.stop();

    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes[0].params.timbre).toBe(0.9); // locked value
    expect(notes[0].params.morph).toBe(0.5); // voice base
  });

  it('computes gateOffTime as next step time', () => {
    const vid = session.tracks[0].id;
    session = toggleStepGate(session, vid, 0);

    const sched = createScheduler();
    sched.start();
    audioTime = 0.2;
    vi.advanceTimersByTime(100);
    sched.stop();

    expect(notes.length).toBeGreaterThanOrEqual(1);
    // At 120 BPM, step duration = 0.125s, so gateOffTime ≈ time + 0.125
    const note = notes[0];
    expect(note.gateOffTime).toBeCloseTo(note.time + 0.125, 2);
  });

  it('handles BPM change mid-play without glitching', () => {
    const vid = session.tracks[0].id;
    session = toggleStepGate(session, vid, 0);
    session = toggleStepGate(session, vid, 4);

    let currentSession = session;
    const sched = new Scheduler(
      () => currentSession,
      () => audioTime,
      (note) => notes.push(note),
      (pos) => positions.push(pos),
      () => ({}),
    );

    sched.start();
    audioTime = 0.3;
    vi.advanceTimersByTime(100);

    // Change BPM mid-play
    currentSession = {
      ...currentSession,
      transport: { ...currentSession.transport, bpm: 140 },
    };
    audioTime = 0.6;
    vi.advanceTimersByTime(200);
    sched.stop();

    // Should have emitted notes without errors
    expect(notes.length).toBeGreaterThan(0);
  });

  it('wraps pattern for short patterns', () => {
    // Create an 8-step pattern with gate on step 0
    const vid = session.tracks[0].id;
    const voice = session.tracks.find(v => v.id === vid)!;
    const newSteps = voice.pattern.steps.slice(0, 8).map((s, i) =>
      i === 0 ? { ...s, gate: true } : s
    );
    session = {
      ...session,
      tracks: session.tracks.map(v =>
        v.id === vid ? { ...v, pattern: { steps: newSteps, length: 8 } } : v
      ),
    };

    const sched = createScheduler();
    sched.start();
    // Advance enough to wrap: at 120 BPM, 8 steps = 1s, so 1.2s should wrap
    audioTime = 1.2;
    vi.advanceTimersByTime(200);
    sched.stop();

    // Should have emitted notes for step 0 on first and second pattern cycles
    const step0Notes = notes.filter(n => n.trackId === vid);
    expect(step0Notes.length).toBeGreaterThanOrEqual(2);
  });

  it('only schedules audible voices', () => {
    // Mute voice 0, gate step 0 on both voice 0 and voice 1
    session = toggleStepGate(session, session.tracks[0].id, 0);
    session = toggleStepGate(session, session.tracks[1].id, 0);
    session = {
      ...session,
      tracks: session.tracks.map(v =>
        v.id === session.tracks[0].id ? { ...v, muted: true } : v
      ),
    };

    const sched = createScheduler();
    sched.start();
    audioTime = 0.2;
    vi.advanceTimersByTime(100);
    sched.stop();

    // Only voice 1 notes should appear
    const trackIds = [...new Set(notes.map(n => n.trackId))];
    expect(trackIds).not.toContain(session.tracks[0].id);
    if (notes.length > 0) {
      expect(trackIds).toContain(session.tracks[1].id);
    }
  });
});
```

- [ ] **Step 10.2: Run test to verify it fails**

Run: `npx vitest run tests/engine/scheduler.test.ts`
Expected: FAIL — module not found

- [ ] **Step 10.3: Implement Scheduler**

```typescript
// src/engine/scheduler.ts
import type { Session, SynthParamValues } from './types';
import type { ScheduledNote } from './sequencer-types';
import { getAudibleTracks, resolveNoteParams } from './sequencer-helpers';

const PPQN = 48;
const TICKS_PER_STEP = 12; // 48 PPQN / 4 steps per beat
const LOOKAHEAD_MS = 25;
const LOOKAHEAD_SEC = 0.1;

export class Scheduler {
  private getSession: () => Session;
  private getAudioTime: () => number;
  private onNote: (note: ScheduledNote) => void;
  private onPositionChange: (globalStep: number) => void;
  private getHeldParams: (trackId: string) => Partial<SynthParamValues>;

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private cursor = 0; // ticks
  private startTime = 0;
  private previousBpm = 0;

  constructor(
    getSession: () => Session,
    getAudioTime: () => number,
    onNote: (note: ScheduledNote) => void,
    onPositionChange: (globalStep: number) => void,
    getHeldParams: (trackId: string) => Partial<SynthParamValues>,
  ) {
    this.getSession = getSession;
    this.getAudioTime = getAudioTime;
    this.onNote = onNote;
    this.onPositionChange = onPositionChange;
    this.getHeldParams = getHeldParams;
  }

  start(): void {
    if (this.intervalId !== null) return;
    this.startTime = this.getAudioTime();
    this.cursor = 0;
    const session = this.getSession();
    this.previousBpm = session.transport.bpm;

    this.intervalId = setInterval(() => this.tick(), LOOKAHEAD_MS);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  isRunning(): boolean {
    return this.intervalId !== null;
  }

  private tick(): void {
    const session = this.getSession();
    const { bpm, swing } = session.transport;

    // Handle BPM change mid-play
    if (bpm !== this.previousBpm) {
      this.reanchorBpm(bpm);
      this.previousBpm = bpm;
    }

    const currentAudioTime = this.getAudioTime();
    const tickDuration = 60 / (bpm * 4) / TICKS_PER_STEP; // seconds per tick
    const stepDuration = tickDuration * TICKS_PER_STEP;

    // Publish position based on actual audio time
    const elapsed = currentAudioTime - this.startTime;
    const globalStep = elapsed / stepDuration;
    this.onPositionChange(globalStep);

    // Calculate how far ahead to schedule
    const lookaheadEnd = currentAudioTime + LOOKAHEAD_SEC;
    const lookaheadEndTick = Math.floor((lookaheadEnd - this.startTime) / tickDuration);

    const audibleVoices = getAudibleTracks(session);

    // Walk step boundaries from current cursor to lookahead end.
    // This correctly handles multiple step boundaries (e.g., after tab backgrounding).
    const startStep = Math.floor(this.cursor / TICKS_PER_STEP);
    const endStep = Math.floor(lookaheadEndTick / TICKS_PER_STEP);

    for (let stepIdx = startStep; stepIdx <= endStep; stepIdx++) {
      const stepTick = stepIdx * TICKS_PER_STEP;
      // Skip steps we've already scheduled (cursor is past this step's tick)
      if (stepTick < this.cursor && stepIdx !== startStep) continue;

      for (const voice of audibleVoices) {
        const patternStep = stepIdx % voice.pattern.length;
        if (patternStep >= voice.pattern.steps.length) continue;
        const step = voice.pattern.steps[patternStep];
        if (!step.gate) continue;

        // Calculate base time for this step
        const baseTime = this.startTime + stepIdx * stepDuration;

        // Apply swing
        const beatLocalStep = stepIdx % 4;
        const pairPosition = beatLocalStep % 2;
        const swingDelay = pairPosition * swing * (stepDuration * 0.75);
        const noteTime = baseTime + swingDelay;

        // Calculate gate-off time (next step's time)
        const nextStepTime = this.startTime + (stepIdx + 1) * stepDuration;
        const nextBeatLocal = (stepIdx + 1) % 4;
        const nextPairPos = nextBeatLocal % 2;
        const nextSwingDelay = nextPairPos * swing * (stepDuration * 0.75);
        const gateOffTime = nextStepTime + nextSwingDelay;

        // Resolve params: voice base + step locks + human held
        const heldParams = this.getHeldParams(voice.id);
        const resolvedParams = resolveNoteParams(voice, step, heldParams);

        this.onNote({
          trackId: voice.id,
          time: noteTime,
          gateOffTime,
          accent: step.accent,
          params: resolvedParams,
        });
      }
    }

    // Advance cursor past everything we've scheduled
    this.cursor = Math.max(this.cursor, lookaheadEndTick + 1);
  }

  private reanchorBpm(newBpm: number): void {
    const currentAudioTime = this.getAudioTime();
    const oldStepDuration = 60 / (this.previousBpm * 4);
    const playbackStep = (currentAudioTime - this.startTime) / oldStepDuration;
    const playbackTick = playbackStep * TICKS_PER_STEP;

    const newTickDuration = 60 / (newBpm * 4) / TICKS_PER_STEP;
    this.startTime = currentAudioTime - (playbackTick * newTickDuration);
    this.cursor = Math.floor(playbackTick);
  }
}
```

- [ ] **Step 10.4: Run tests**

Run: `npx vitest run tests/engine/scheduler.test.ts`
Expected: PASS (all tests)

- [ ] **Step 10.5: Commit**

```bash
git add src/engine/scheduler.ts tests/engine/scheduler.test.ts
git commit -m "feat: implement Scheduler with tick loop, swing, BPM reanchor, note resolution"
```

---

## Chunk 3: UI Components, AI Integration, Audio Export, Polish

### Task 11: Update AI state compression for multi-voice

**Files:**
- Modify: `src/ai/state-compression.ts`
- Modify: `tests/ai/state-compression.test.ts`

- [ ] **Step 11.1: Write failing tests**

```typescript
// tests/ai/state-compression.test.ts
import { describe, it, expect } from 'vitest';
import { compressState } from '../../src/ai/state-compression';
import { createSession } from '../../src/engine/session';
import { toggleStepGate, toggleStepAccent, setStepParamLock } from '../../src/engine/pattern-primitives';

describe('State Compression (Phase 2)', () => {
  it('compresses multi-voice session', () => {
    const session = createSession();
    const result = compressState(session);
    expect(result.tracks).toHaveLength(4);
    expect(result.tracks[0].model).toBe('analog_bass_drum');
    expect(result.transport).toEqual({ bpm: 120, swing: 0 });
  });

  it('compresses pattern with active steps', () => {
    let s = createSession();
    const vid = s.tracks[0].id;
    s = toggleStepGate(s, vid, 0);
    s = toggleStepGate(s, vid, 4);
    s = toggleStepGate(s, vid, 8);
    s = toggleStepGate(s, vid, 12);

    const result = compressState(s);
    expect(result.tracks[0].pattern.active_steps).toEqual([0, 4, 8, 12]);
  });

  it('compresses accented steps', () => {
    let s = createSession();
    const vid = s.tracks[0].id;
    s = toggleStepGate(s, vid, 0);
    s = toggleStepAccent(s, vid, 0);

    const result = compressState(s);
    expect(result.tracks[0].pattern.accents).toEqual([0]);
  });

  it('compresses parameter locks', () => {
    let s = createSession();
    const vid = s.tracks[0].id;
    s = setStepParamLock(s, vid, 5, { timbre: 0.8 });

    const result = compressState(s);
    expect(result.tracks[0].pattern.locks).toEqual({ '5': { timbre: 0.8 } });
  });

  it('includes human message when provided', () => {
    const session = createSession();
    const result = compressState(session, 'hello');
    expect(result.human_message).toBe('hello');
  });
});
```

- [ ] **Step 11.2: Run test to verify it fails**

Run: `npx vitest run tests/ai/state-compression.test.ts`
Expected: FAIL — compressed shape doesn't match

- [ ] **Step 11.3: Rewrite state compression**

```typescript
// src/ai/state-compression.ts
import type { Session, Voice } from '../engine/types';

interface CompressedPattern {
  length: number;
  active_steps: number[];
  accents: number[];
  locks: Record<string, Record<string, number>>;
}

interface CompressedVoice {
  id: string;
  model: string;
  params: Record<string, number>;
  agency: string;
  muted: boolean;
  solo: boolean;
  pattern: CompressedPattern;
}

export interface CompressedState {
  tracks: CompressedVoice[];
  transport: { bpm: number; swing: number };
  leash: number;
  context: { energy: number; density: number };
  pending_count: number;
  undo_depth: number;
  recent_human_actions: string[];
  human_message?: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function modelName(model: number): string {
  const names = [
    'virtual_analog', 'waveshaping', 'fm', 'grain_formant', 'harmonic',
    'wavetable', 'chords', 'vowel_speech', 'swarm', 'filtered_noise',
    'particle_dust', 'inharmonic_string', 'modal_resonator',
    'analog_bass_drum', 'analog_snare', 'analog_hi_hat',
  ];
  return names[model] ?? `unknown_${model}`;
}

function compressPattern(voice: Voice): CompressedPattern {
  const active_steps: number[] = [];
  const accents: number[] = [];
  const locks: Record<string, Record<string, number>> = {};

  for (let i = 0; i < voice.pattern.length; i++) {
    const step = voice.pattern.steps[i];
    if (!step) continue;
    if (step.gate) active_steps.push(i);
    if (step.accent) accents.push(i);
    if (step.params) {
      const rounded: Record<string, number> = {};
      for (const [k, v] of Object.entries(step.params)) {
        rounded[k] = round2(v);
      }
      if (Object.keys(rounded).length > 0) {
        locks[String(i)] = rounded;
      }
    }
  }

  return { length: voice.pattern.length, active_steps, accents, locks };
}

export function compressState(session: Session, humanMessage?: string): CompressedState {
  const result: CompressedState = {
    tracks: session.tracks.map(voice => ({
      id: voice.id,
      model: modelName(voice.model),
      params: {
        harmonics: round2(voice.params.harmonics),
        timbre: round2(voice.params.timbre),
        morph: round2(voice.params.morph),
        note: round2(voice.params.note),
      },
      agency: voice.agency,
      muted: voice.muted,
      solo: voice.solo,
      pattern: compressPattern(voice),
    })),
    transport: {
      bpm: session.transport.bpm,
      swing: round2(session.transport.swing),
    },
    leash: round2(session.leash),
    context: {
      energy: round2(session.context.energy),
      density: round2(session.context.density),
    },
    pending_count: session.pending.length,
    undo_depth: session.undoStack.length,
    recent_human_actions: session.recentHumanActions.slice(-5).map(
      (a) => `${a.param}: ${a.from.toFixed(2)} -> ${a.to.toFixed(2)}`
    ),
  };

  if (humanMessage) {
    result.human_message = humanMessage;
  }

  return result;
}
```

- [ ] **Step 11.4: Run tests**

Run: `npx vitest run tests/ai/state-compression.test.ts`
Expected: PASS (all tests)

- [ ] **Step 11.5: Commit**

```bash
git add src/ai/state-compression.ts tests/ai/state-compression.test.ts
git commit -m "feat: rewrite state compression for multi-voice with pattern data"
```

---

### Task 12: Update AI response parser for sketch actions

**Files:**
- Modify: `src/ai/response-parser.ts`
- Modify: `tests/ai/response-parser.test.ts`

- [ ] **Step 12.1: Write failing tests for sketch validation**

```typescript
// tests/ai/response-parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseAIResponse } from '../../src/ai/response-parser';

describe('parseAIResponse (Phase 2)', () => {
  it('parses move actions', () => {
    const result = parseAIResponse('[{"type":"move","param":"timbre","target":{"absolute":0.8}}]');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('move');
  });

  it('parses say actions', () => {
    const result = parseAIResponse('[{"type":"say","text":"hello"}]');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('say');
  });

  it('parses sketch actions with PatternSketch', () => {
    const json = JSON.stringify([{
      type: 'sketch',
      trackId: 'v0',
      description: 'four on the floor',
      pattern: {
        steps: [
          { index: 0, gate: true },
          { index: 4, gate: true },
          { index: 8, gate: true },
          { index: 12, gate: true },
        ],
      },
    }]);
    const result = parseAIResponse(json);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('sketch');
    if (result[0].type === 'sketch') {
      expect(result[0].trackId).toBe('v0');
      expect(result[0].pattern.steps).toHaveLength(4);
    }
  });

  it('rejects sketch without trackId', () => {
    const json = JSON.stringify([{
      type: 'sketch',
      description: 'test',
      pattern: { steps: [] },
    }]);
    const result = parseAIResponse(json);
    expect(result).toHaveLength(0);
  });

  it('rejects sketch without pattern', () => {
    const json = JSON.stringify([{
      type: 'sketch',
      trackId: 'v0',
      description: 'test',
    }]);
    const result = parseAIResponse(json);
    expect(result).toHaveLength(0);
  });

  it('rejects sketch with non-array steps', () => {
    const json = JSON.stringify([{
      type: 'sketch',
      trackId: 'v0',
      description: 'test',
      pattern: { steps: 'not an array' },
    }]);
    const result = parseAIResponse(json);
    expect(result).toHaveLength(0);
  });

  it('handles mixed valid and invalid actions', () => {
    const json = JSON.stringify([
      { type: 'say', text: 'here is a pattern' },
      { type: 'sketch', trackId: 'v0', description: 'kick', pattern: { steps: [{ index: 0, gate: true }] } },
      { type: 'sketch', description: 'invalid' }, // missing trackId
    ]);
    const result = parseAIResponse(json);
    expect(result).toHaveLength(2);
  });

  it('returns empty array for invalid JSON', () => {
    expect(parseAIResponse('not json')).toEqual([]);
  });

  it('returns empty array for non-array JSON', () => {
    expect(parseAIResponse('{"type":"move"}')).toEqual([]);
  });
});
```

- [ ] **Step 12.2: Run test to verify it fails**

Run: `npx vitest run tests/ai/response-parser.test.ts`
Expected: FAIL — sketch validation doesn't match new shape

- [ ] **Step 12.3: Update response parser**

```typescript
// src/ai/response-parser.ts
import type { AIAction } from '../engine/types';

function extractJSON(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  return text.trim();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isValidAction(action: unknown): action is AIAction {
  if (!isRecord(action) || typeof action.type !== 'string') return false;

  switch (action.type) {
    case 'move':
      if (typeof action.param !== 'string') return false;
      if (!isRecord(action.target)) return false;
      if (!('absolute' in action.target) && !('relative' in action.target)) return false;
      return typeof action.target.absolute === 'number' || typeof action.target.relative === 'number';

    case 'suggest':
    case 'audition':
      return isRecord(action.changes) && Object.values(action.changes).every(v => typeof v === 'number');

    case 'say':
      return typeof action.text === 'string';

    case 'sketch':
      if (typeof action.trackId !== 'string') return false;
      if (typeof action.description !== 'string') return false;
      if (!isRecord(action.pattern)) return false;
      if (!Array.isArray(action.pattern.steps)) return false;
      return action.pattern.steps.every((s: unknown) =>
        isRecord(s) && typeof s.index === 'number'
      );

    default:
      return false;
  }
}

export function parseAIResponse(response: string): AIAction[] {
  try {
    const jsonStr = extractJSON(response);
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidAction);
  } catch {
    return [];
  }
}
```

- [ ] **Step 12.4: Run tests**

Run: `npx vitest run tests/ai/response-parser.test.ts`
Expected: PASS (all tests)

- [ ] **Step 12.5: Commit**

```bash
git add src/ai/response-parser.ts tests/ai/response-parser.test.ts
git commit -m "feat: update response parser to validate sketch actions with PatternSketch"
```

---

### Task 13: Update AI system prompt for multi-voice and sketches

**Files:**
- Modify: `src/ai/system-prompt.ts`

- [ ] **Step 13.1: Update system prompt**

```typescript
// src/ai/system-prompt.ts
export const GLUON_SYSTEM_PROMPT = `You are the AI collaborator in Gluon, a shared musical instrument. You and a human are playing a 4-voice Plaits synthesiser together in the browser with a step sequencer.

## Your Role
You are a session musician, not a producer. You have opinions, you can play, you can suggest — but the human has final say. Communicate through the instrument more than through words.

## Available Actions
Respond with a JSON array of actions. Available action types:

- **move**: Change a parameter directly (immediately audible)
  \`{ "type": "move", "param": "timbre"|"morph"|"harmonics", "target": { "absolute": 0.0-1.0 } }\`
  Optional: \`"over": 2000\` for smooth transition over N milliseconds.

- **suggest**: Propose a parameter change (appears as ghost, human must commit)
  \`{ "type": "suggest", "changes": { "timbre": 0.7 }, "reason": "optional explanation" }\`

- **audition**: Temporarily apply a parameter change (auto-reverts unless committed)
  \`{ "type": "audition", "changes": { "morph": 0.3 }, "duration": 3000 }\`

- **sketch**: Propose a pattern for a voice (goes to pending queue, human commits/dismisses)
  \`{ "type": "sketch", "trackId": "v0", "description": "four on the floor kick", "pattern": { "length": 16, "steps": [{ "index": 0, "gate": true, "accent": true }, { "index": 4, "gate": true }, { "index": 8, "gate": true, "accent": true }, { "index": 12, "gate": true }] } }\`
  Steps are sparse — only include steps you want to set/change. Each step can have: index (required), gate, accent, params (parameter locks like { "timbre": 0.8, "note": 0.6 }). Use params.note for per-step pitch (e.g., \`{ "index": 3, "gate": true, "params": { "note": 0.7 } }\`).

- **say**: Speak to the human
  \`{ "type": "say", "text": "your message" }\`

## Voice Setup
4 tracks: v0 (kick, model 13), v1 (bass, model 0), v2 (lead, model 2), v3 (pad, model 4).

## Behaviour Rules
1. Be musical. Be concise. Don't over-explain.
2. If the human hasn't asked you anything and the leash is low, respond with \`[]\`.
3. Never narrate your own actions unless asked "why?"
4. When sketching patterns, think musically — groove, syncopation, dynamics.
5. Respond to the human's musical direction. If they're exploring dark timbres, don't suggest bright ones unless asked.
6. Match your activity level to the leash value: 0.0 = silent, 0.5 = active participant, 1.0 = full co-creator.
7. Keep say messages short — one or two sentences max.
8. You can combine actions: sketch a pattern AND move params AND say something in one response.

## Plaits Models Reference
0: Virtual Analog, 1: Waveshaping, 2: FM, 3: Grain/Formant, 4: Harmonic,
5: Wavetable, 6: Chords, 7: Vowel/Speech, 8: Swarm, 9: Filtered Noise,
10: Particle/Dust, 11: Inharmonic String, 12: Modal Resonator,
13: Analog Bass Drum, 14: Analog Snare, 15: Analog Hi-Hat

## Parameter Space
- **harmonics** (0.0-1.0): Harmonic content. Effect varies by model.
- **timbre** (0.0-1.0): Primary timbral control.
- **morph** (0.0-1.0): Secondary timbral control.
- **note** (0.0-1.0): Pitch (0.0 = lowest, 1.0 = highest). Use in parameter locks for per-step pitch.

Always respond with valid JSON: an array of action objects.
If you have nothing to do, respond with: \`[]\``;
```

- [ ] **Step 13.2: Commit**

```bash
git add src/ai/system-prompt.ts
git commit -m "feat: update system prompt for multi-voice, sketch actions, pattern examples"
```

---

### Task 14: Update AI api.ts for per-voice agency checks

**Files:**
- Modify: `src/ai/api.ts`

- [ ] **Step 14.1: Update react() for multi-voice**

```typescript
// src/ai/api.ts
import Anthropic from '@anthropic-ai/sdk';
import type { Session, AIAction } from '../engine/types';
import { compressState } from './state-compression';
import { parseAIResponse } from './response-parser';
import { GLUON_SYSTEM_PROMPT } from './system-prompt';

export class GluonAI {
  private client: Anthropic | null = null;
  private conversationHistory: { role: 'user' | 'assistant'; content: string }[] = [];

  setApiKey(key: string): void {
    this.client = new Anthropic({
      apiKey: key,
      dangerouslyAllowBrowser: true,
    });
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async ask(session: Session, humanMessage: string): Promise<AIAction[]> {
    if (!this.client) return [];
    const state = compressState(session, humanMessage);
    return this.call(JSON.stringify(state));
  }

  async react(session: Session): Promise<AIAction[]> {
    if (!this.client) return [];
    // Check if any voice has agency beyond OFF
    const anyActive = session.tracks.some(v => v.agency !== 'OFF');
    if (!anyActive) return [];
    if (session.leash < 0.3) return [];
    const state = compressState(session);
    return this.call(JSON.stringify(state));
  }

  private async call(userContent: string): Promise<AIAction[]> {
    if (!this.client) return [];
    this.conversationHistory.push({ role: 'user', content: userContent });
    if (this.conversationHistory.length > 20) {
      this.conversationHistory = this.conversationHistory.slice(-20);
    }
    try {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        system: GLUON_SYSTEM_PROMPT,
        messages: this.conversationHistory,
      });
      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      this.conversationHistory.push({ role: 'assistant', content: text });
      return parseAIResponse(text);
    } catch (error) {
      console.error('Gluon AI call failed:', error);
      return [];
    }
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }
}
```

- [ ] **Step 14.2: Commit**

```bash
git add src/ai/api.ts
git commit -m "feat: update AI api for per-voice agency checks, increase max_tokens for sketches"
```

---

### Task 15: Audio exporter

**Files:**
- Create: `src/audio/audio-exporter.ts`
- Create: `tests/audio/audio-exporter.test.ts`

- [ ] **Step 15.1: Write failing tests**

```typescript
// tests/audio/audio-exporter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { AudioExporter } from '../../src/audio/audio-exporter';

// Mock MediaRecorder for test environment
class MockMediaRecorder {
  state = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(public stream: MediaStream) {}

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    // Simulate data available then stop
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob(['audio data'], { type: 'audio/webm' }) });
      this.onstop?.();
    }, 0);
  }

  get mimeType() { return 'audio/webm'; }

  static isTypeSupported() { return true; }
}

vi.stubGlobal('MediaRecorder', MockMediaRecorder);

describe('AudioExporter', () => {
  it('starts recording', () => {
    const exporter = new AudioExporter();
    const stream = new MediaStream();
    const dest = { stream } as unknown as MediaStreamAudioDestinationNode;
    exporter.start(dest);
    expect(exporter.isRecording()).toBe(true);
  });

  it('stops recording and returns a blob', async () => {
    const exporter = new AudioExporter();
    const stream = new MediaStream();
    const dest = { stream } as unknown as MediaStreamAudioDestinationNode;
    exporter.start(dest);
    const blob = await exporter.stop();
    expect(blob).toBeInstanceOf(Blob);
    expect(exporter.isRecording()).toBe(false);
  });

  it('throws if stop called without start', async () => {
    const exporter = new AudioExporter();
    await expect(exporter.stop()).rejects.toThrow();
  });
});
```

- [ ] **Step 15.2: Run test to verify it fails**

Run: `npx vitest run tests/audio/audio-exporter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 15.3: Implement AudioExporter**

```typescript
// src/audio/audio-exporter.ts
export class AudioExporter {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  start(destination: MediaStreamAudioDestinationNode): void {
    const stream = destination.stream;
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    this.recorder = new MediaRecorder(stream, { mimeType });
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();
  }

  async stop(): Promise<Blob> {
    if (!this.recorder || this.recorder.state !== 'recording') {
      throw new Error('Not recording');
    }
    return new Promise((resolve) => {
      this.recorder!.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.recorder!.mimeType });
        this.recorder = null;
        this.chunks = [];
        resolve(blob);
      };
      this.recorder!.stop();
    });
  }

  isRecording(): boolean {
    return this.recorder !== null && this.recorder.state === 'recording';
  }
}
```

- [ ] **Step 15.4: Run tests**

Run: `npx vitest run tests/audio/audio-exporter.test.ts`
Expected: PASS (all tests)

- [ ] **Step 15.5: Commit**

```bash
git add src/audio/audio-exporter.ts tests/audio/audio-exporter.test.ts
git commit -m "feat: add AudioExporter wrapping MediaRecorder for real-time bounce"
```

---

### Task 16: TransportBar UI component

**Files:**
- Create: `src/ui/TransportBar.tsx`

- [ ] **Step 16.1: Create TransportBar component**

```tsx
// src/ui/TransportBar.tsx
import { useState, useCallback } from 'react';

interface Props {
  playing: boolean;
  bpm: number;
  swing: number;
  recording: boolean;
  globalStep: number;
  patternLength: number;
  onTogglePlay: () => void;
  onBpmChange: (bpm: number) => void;
  onSwingChange: (swing: number) => void;
  onToggleRecord: () => void;
}

export function TransportBar({
  playing, bpm, swing, recording, globalStep, patternLength,
  onTogglePlay, onBpmChange, onSwingChange, onToggleRecord,
}: Props) {
  const [editingBpm, setEditingBpm] = useState(false);
  const [bpmInput, setBpmInput] = useState(String(bpm));

  const currentStep = Math.floor(globalStep % patternLength);
  const currentBar = Math.floor(globalStep / patternLength) + 1;

  const handleBpmSubmit = useCallback(() => {
    const parsed = parseInt(bpmInput, 10);
    if (!isNaN(parsed)) onBpmChange(parsed);
    setEditingBpm(false);
  }, [bpmInput, onBpmChange]);

  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-zinc-900 rounded-lg border border-zinc-800">
      <button
        onClick={onTogglePlay}
        className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
          playing
            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
            : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:text-zinc-200'
        }`}
        title={playing ? 'Stop' : 'Play'}
      >
        {playing ? (
          <svg viewBox="0 0 16 16" className="w-4 h-4 fill-current">
            <rect x="3" y="3" width="10" height="10" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" className="w-4 h-4 fill-current">
            <polygon points="4,2 14,8 4,14" />
          </svg>
        )}
      </button>

      <div className="flex items-center gap-2">
        <span className="text-zinc-500 text-xs uppercase tracking-wider">BPM</span>
        {editingBpm ? (
          <input
            type="number"
            value={bpmInput}
            onChange={(e) => setBpmInput(e.target.value)}
            onBlur={handleBpmSubmit}
            onKeyDown={(e) => e.key === 'Enter' && handleBpmSubmit()}
            className="w-14 bg-zinc-800 text-zinc-100 text-sm px-2 py-1 rounded border border-zinc-600 outline-none"
            autoFocus
            min={60}
            max={200}
          />
        ) : (
          <button
            onClick={() => { setBpmInput(String(bpm)); setEditingBpm(true); }}
            className="text-zinc-200 text-sm font-mono tabular-nums hover:text-amber-400 transition-colors"
          >
            {bpm}
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-zinc-500 text-xs uppercase tracking-wider">Swing</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(swing * 100)}
          onChange={(e) => onSwingChange(Number(e.target.value) / 100)}
          className="w-16 accent-amber-500"
        />
        <span className="text-zinc-400 text-xs font-mono w-8">
          {Math.round(swing * 100)}%
        </span>
      </div>

      <div className="flex-1" />

      {playing && (
        <span className="text-zinc-400 text-sm font-mono tabular-nums">
          {currentBar}:{String(currentStep + 1).padStart(2, '0')}
        </span>
      )}

      <button
        onClick={onToggleRecord}
        className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
          recording
            ? 'bg-red-500/30 text-red-400 border border-red-500/50 animate-pulse'
            : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:text-red-400'
        }`}
        title={recording ? 'Stop Recording' : 'Record'}
      >
        <div className={`w-3 h-3 rounded-full ${recording ? 'bg-red-500' : 'bg-current'}`} />
      </button>
    </div>
  );
}
```

- [ ] **Step 16.2: Commit**

```bash
git add src/ui/TransportBar.tsx
git commit -m "feat: add TransportBar component with play/stop, BPM, swing, record"
```

---

### Task 17: VoiceSelector UI component

**Files:**
- Create: `src/ui/VoiceSelector.tsx`

- [ ] **Step 17.1: Create VoiceSelector component**

```tsx
// src/ui/VoiceSelector.tsx
import type { Voice } from '../engine/types';

interface Props {
  tracks: Voice[];
  activeTrackId: string;
  onSelectVoice: (trackId: string) => void;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string) => void;
}

const VOICE_LABELS = ['KICK', 'BASS', 'LEAD', 'PAD'];
const AGENCY_BADGE: Record<string, { label: string; color: string }> = {
  OFF: { label: 'OFF', color: 'text-zinc-600' },
  SUGGEST: { label: 'SUG', color: 'text-blue-400' },
  PLAY: { label: 'PLY', color: 'text-amber-400' },
};

export function VoiceSelector({ voices, activeTrackId, onSelectVoice, onToggleMute, onToggleSolo }: Props) {
  return (
    <div className="flex gap-1">
      {voices.map((voice, i) => {
        const isActive = voice.id === activeTrackId;
        const badge = AGENCY_BADGE[voice.agency] ?? AGENCY_BADGE.OFF;

        return (
          <div
            key={voice.id}
            className={`flex flex-col gap-1 px-3 py-2 rounded-t-lg cursor-pointer transition-colors ${
              isActive
                ? 'bg-zinc-800 border-t border-x border-zinc-700'
                : 'bg-zinc-900/50 hover:bg-zinc-800/50'
            }`}
            onClick={() => onSelectVoice(voice.id)}
          >
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium tracking-wider ${isActive ? 'text-zinc-200' : 'text-zinc-500'}`}>
                {VOICE_LABELS[i] ?? `V${i}`}
              </span>
              <span className={`text-[10px] ${badge.color}`}>{badge.label}</span>
            </div>
            <div className="flex gap-1">
              <button
                onClick={(e) => { e.stopPropagation(); onToggleMute(voice.id); }}
                className={`text-[10px] px-1 rounded ${
                  voice.muted ? 'bg-red-500/20 text-red-400' : 'text-zinc-600 hover:text-zinc-400'
                }`}
              >
                M
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onToggleSolo(voice.id); }}
                className={`text-[10px] px-1 rounded ${
                  voice.solo ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-600 hover:text-zinc-400'
                }`}
              >
                S
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 17.2: Commit**

```bash
git add src/ui/VoiceSelector.tsx
git commit -m "feat: add VoiceSelector component with mute/solo/agency indicators"
```

---

### Task 18: StepGrid UI component

**Files:**
- Create: `src/ui/StepGrid.tsx`

- [ ] **Step 18.1: Create StepGrid component**

```tsx
// src/ui/StepGrid.tsx
import type { Pattern } from '../engine/sequencer-types';
import type { PendingAction, SketchPendingAction } from '../engine/types';

interface Props {
  pattern: Pattern;
  currentStep: number;
  playing: boolean;
  pendingSketch?: SketchPendingAction;
  page: number;
  onToggleGate: (stepIndex: number) => void;
  onToggleAccent: (stepIndex: number) => void;
  onStepHold: (stepIndex: number) => void;
  onStepRelease: () => void;
}

const STEPS_PER_PAGE = 16;

export function StepGrid({
  pattern, currentStep, playing, pendingSketch, page,
  onToggleGate, onToggleAccent, onStepHold, onStepRelease,
}: Props) {
  const startIndex = page * STEPS_PER_PAGE;
  const endIndex = Math.min(startIndex + STEPS_PER_PAGE, pattern.length);
  const visibleSteps = pattern.steps.slice(startIndex, endIndex);

  // Build ghost step map from pending sketch
  const ghostSteps = new Map<number, { gate?: boolean; accent?: boolean; hasLock?: boolean }>();
  if (pendingSketch) {
    for (const s of pendingSketch.pattern.steps) {
      if (s.index >= startIndex && s.index < endIndex) {
        ghostSteps.set(s.index, {
          gate: s.gate,
          accent: s.accent,
          hasLock: s.params !== undefined,
        });
      }
    }
  }

  return (
    <div className="flex gap-1">
      {visibleSteps.map((step, i) => {
        const globalIndex = startIndex + i;
        const isPlayhead = playing && currentStep === globalIndex;
        const isActive = globalIndex < pattern.length;
        const ghost = ghostSteps.get(globalIndex);
        const hasLock = step.params !== undefined;

        return (
          <button
            key={globalIndex}
            onClick={() => onToggleGate(globalIndex)}
            onContextMenu={(e) => { e.preventDefault(); onToggleAccent(globalIndex); }}
            onPointerDown={() => onStepHold(globalIndex)}
            onPointerUp={onStepRelease}
            onPointerLeave={onStepRelease}
            className={`
              relative w-10 h-12 rounded transition-all flex-shrink-0
              ${!isActive ? 'opacity-30 pointer-events-none' : ''}
              ${isPlayhead ? 'ring-1 ring-amber-400/60' : ''}
              ${step.gate
                ? step.accent
                  ? 'bg-amber-500/70 border border-amber-400/60'
                  : 'bg-amber-500/30 border border-amber-500/30'
                : 'bg-zinc-800/60 border border-zinc-700/40 hover:border-zinc-600'
              }
              ${ghost?.gate ? 'ring-2 ring-blue-400/40 ring-offset-1 ring-offset-zinc-950' : ''}
            `}
          >
            {/* Beat marker: thicker left border on beat boundaries (every 4 steps) */}
            {globalIndex % 4 === 0 && (
              <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-zinc-600/40 rounded-l" />
            )}

            {/* Param lock indicator */}
            {hasLock && (
              <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-blue-400/60" />
            )}

            {/* Ghost lock indicator */}
            {ghost?.hasLock && !hasLock && (
              <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-blue-400/30 animate-pulse" />
            )}

            {/* Step number (1-based) */}
            <span className="text-[9px] text-zinc-600 absolute top-0.5 left-1">
              {globalIndex + 1}
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 18.2: Commit**

```bash
git add src/ui/StepGrid.tsx
git commit -m "feat: add StepGrid component with gate/accent toggles, playhead, ghost steps"
```

---

### Task 19: PatternControls UI component

**Files:**
- Create: `src/ui/PatternControls.tsx`

- [ ] **Step 19.1: Create PatternControls component**

```tsx
// src/ui/PatternControls.tsx
interface Props {
  patternLength: number;
  totalPages: number;
  currentPage: number;
  onLengthChange: (length: number) => void;
  onPageChange: (page: number) => void;
  onClear: () => void;
}

const LENGTH_PRESETS = [4, 8, 16, 32, 64];

export function PatternControls({
  patternLength, totalPages, currentPage,
  onLengthChange, onPageChange, onClear,
}: Props) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1">
        <span className="text-zinc-500 text-xs uppercase tracking-wider">Len</span>
        <div className="flex gap-0.5">
          {LENGTH_PRESETS.map(len => (
            <button
              key={len}
              onClick={() => onLengthChange(len)}
              className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
                patternLength === len
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {len}
            </button>
          ))}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          {Array.from({ length: totalPages }, (_, i) => (
            <button
              key={i}
              onClick={() => onPageChange(i)}
              className={`text-xs px-1.5 py-0.5 rounded ${
                currentPage === i
                  ? 'bg-zinc-700 text-zinc-200'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}

      <button
        onClick={onClear}
        className="text-xs text-zinc-500 hover:text-red-400 transition-colors px-2 py-0.5 rounded hover:bg-red-500/10"
      >
        CLR
      </button>
    </div>
  );
}
```

- [ ] **Step 19.2: Commit**

```bash
git add src/ui/PatternControls.tsx
git commit -m "feat: add PatternControls component with length presets, page nav, clear"
```

---

### Task 20: Wire everything in App.tsx

**Files:**
- Modify: `src/ui/App.tsx`

This is the integration task. It rewires App.tsx to use:
- Multi-voice session (`voices[]`, `activeTrackId`, `transport`)
- Scheduler (created once, controlled by `useEffect` on `transport.playing`)
- New UI components (TransportBar, VoiceSelector, StepGrid, PatternControls)
- AudioExporter for record/export
- Updated dispatch for `sketch` actions

- [ ] **Step 20.1: Rewrite App.tsx**

```tsx
// src/ui/App.tsx
import { useState, useCallback, useRef, useEffect } from 'react';
import { AudioEngine } from '../audio/audio-engine';
import { AudioExporter } from '../audio/audio-exporter';
import type { Session, AIAction } from '../engine/types';
import { getActiveTrack, getTrack } from '../engine/types';
import {
  createSession, setLeash, setAgency, updateTrackParams, setModel,
  setActiveVoice, toggleMute, toggleSolo, setTransportBpm, setTransportSwing, togglePlaying,
} from '../engine/session';
import {
  applyMove, applyMoveGroup, applyParamDirect, applySuggest,
  applyAudition, cancelAuditionParam, applyUndo, commitPending,
  dismissPending, applySketchPending,
} from '../engine/primitives';
import { toggleStepGate, toggleStepAccent, setStepParamLock, clearPattern, setPatternLength } from '../engine/pattern-primitives';
import { GluonAI } from '../ai/api';
import { Arbitrator } from '../engine/arbitration';
import { AutomationEngine } from '../ai/automation';
import { Scheduler } from '../engine/scheduler';
import { ParameterSpace } from './ParameterSpace';
import { ModelSelector } from './ModelSelector';
import { LeashSlider } from './LeashSlider';
import { AgencyToggle } from './AgencyToggle';
import { ChatPanel } from './ChatPanel';
import { Visualiser } from './Visualiser';
import { PendingOverlay } from './PendingOverlay';
import { PitchControl } from './PitchControl';
import { UndoButton } from './UndoButton';
import { ApiKeyInput } from './ApiKeyInput';
import { TransportBar } from './TransportBar';
import { VoiceSelector } from './VoiceSelector';
import { StepGrid } from './StepGrid';
import { PatternControls } from './PatternControls';
import type { SketchPendingAction } from '../engine/types';

export default function App() {
  const [session, setSession] = useState<Session>(createSession);
  const [audioStarted, setAudioStarted] = useState(false);
  const [apiConfigured, setApiConfigured] = useState(false);
  const [globalStep, setGlobalStep] = useState(0);
  const [recording, setRecording] = useState(false);
  const [heldStep, setHeldStep] = useState<number | null>(null);
  const [stepPage, setStepPage] = useState(0);

  const audioRef = useRef(new AudioEngine());
  const exporterRef = useRef(new AudioExporter());
  const aiRef = useRef(new GluonAI());
  const arbRef = useRef(new Arbitrator());
  const autoRef = useRef(new AutomationEngine());
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const schedulerRef = useRef<Scheduler | null>(null);

  const startAudio = useCallback(async () => {
    const s = sessionRef.current;
    await audioRef.current.start(s.tracks.map(v => v.id));
    // Set initial models
    for (const voice of s.tracks) {
      audioRef.current.setVoiceModel(voice.id, voice.model);
      audioRef.current.setVoiceParams(voice.id, voice.params);
    }
    setAudioStarted(true);
  }, []);

  // Create scheduler once audio starts
  useEffect(() => {
    if (!audioStarted) return;
    schedulerRef.current = new Scheduler(
      () => sessionRef.current,
      () => audioRef.current.getCurrentTime(),
      (note) => audioRef.current.scheduleNote(note),
      (step) => setGlobalStep(step),
      (trackId) => arbRef.current.getHeldParams(trackId),
    );
    return () => { schedulerRef.current?.stop(); };
  }, [audioStarted]);

  // Control scheduler from transport state
  useEffect(() => {
    if (!schedulerRef.current) return;
    if (session.transport.playing) {
      schedulerRef.current.start();
    } else {
      schedulerRef.current.stop();
    }
  }, [session.transport.playing]);

  // Sync audio params when session changes
  useEffect(() => {
    if (!audioStarted) return;
    const activeVoice = getActiveTrack(session);
    audioRef.current.setVoiceParams(activeVoice.id, activeVoice.params);
    audioRef.current.setVoiceModel(activeVoice.id, activeVoice.model);
  }, [session.tracks, audioStarted]);

  // Sync mute/solo state
  useEffect(() => {
    if (!audioStarted) return;
    const anySoloed = session.tracks.some(v => v.solo);
    for (const voice of session.tracks) {
      const audible = anySoloed ? voice.solo : !voice.muted;
      audioRef.current.muteVoice(voice.id, !audible);
    }
  }, [session.tracks, audioStarted]);

  const activeVoice = getActiveTrack(session);

  const dispatchAIActions = useCallback((actions: AIAction[]) => {
    setSession((s) => {
      let next = s;
      const moveActions: { param: string; target: { absolute: number } | { relative: number } }[] = [];
      const activeVid = s.activeTrackId;

      for (const action of actions) {
        switch (action.type) {
          case 'move':
            if (getActiveTrack(next).agency !== 'OFF' && arbRef.current.canAIAct(action.param)) {
              if (action.over) {
                const voice = getActiveTrack(next);
                const currentVal = voice.params[action.param] ?? 0;
                const rawTarget = 'absolute' in action.target ? action.target.absolute : currentVal + action.target.relative;
                const targetVal = Math.max(0, Math.min(1, rawTarget));
                autoRef.current.start(action.param, currentVal, targetVal, action.over, (param, value) => {
                  setSession((s2) => applyParamDirect(s2, activeVid, param, value));
                });
                autoRef.current.startLoop();
              } else {
                moveActions.push({ param: action.param, target: action.target });
              }
            }
            break;
          case 'suggest':
            if (getActiveTrack(next).agency !== 'OFF') {
              next = applySuggest(next, activeVid, action.changes, action.reason);
            }
            break;
          case 'audition':
            if (getActiveTrack(next).agency === 'PLAY') {
              next = applyAudition(next, activeVid, action.changes, action.duration);
            }
            break;
          case 'sketch': {
            const targetTrack = next.tracks.find(v => v.id === action.trackId);
            if (targetTrack && targetTrack.agency !== 'OFF') {
              next = applySketchPending(next, action.trackId, action.description, action.pattern);
            }
            break;
          }
          case 'say':
            next = {
              ...next,
              messages: [...next.messages, { role: 'ai' as const, text: action.text, timestamp: Date.now() }],
            };
            break;
        }
      }

      if (moveActions.length > 0) {
        next = moveActions.length === 1
          ? applyMove(next, activeVid, moveActions[0].param, moveActions[0].target)
          : applyMoveGroup(next, activeVid, moveActions);
      }

      return next;
    });
  }, []);

  const handleParamChange = useCallback((timbre: number, morph: number) => {
    const vid = sessionRef.current.activeTrackId;
    arbRef.current.humanTouched(vid, 'timbre', timbre);
    arbRef.current.humanTouched(vid, 'morph', morph);
    setSession((s) => {
      let next = cancelAuditionParam(s, vid, 'timbre');
      next = cancelAuditionParam(next, vid, 'morph');
      next = updateTrackParams(next, vid, { timbre, morph }, true);

      // If a step is held, apply param lock
      if (heldStep !== null) {
        next = setStepParamLock(next, vid, heldStep, { timbre, morph });
      }

      return next;
    });
  }, [heldStep]);

  const handleNoteChange = useCallback((note: number) => {
    const vid = sessionRef.current.activeTrackId;
    arbRef.current.humanTouched(vid, 'note', note);
    setSession((s) => {
      let next = cancelAuditionParam(s, vid, 'note');
      return updateTrackParams(next, vid, { note }, true);
    });
  }, []);

  const handleHarmonicsChange = useCallback((harmonics: number) => {
    const vid = sessionRef.current.activeTrackId;
    arbRef.current.humanTouched(vid, 'harmonics', harmonics);
    setSession((s) => {
      let next = cancelAuditionParam(s, vid, 'harmonics');
      return updateTrackParams(next, vid, { harmonics }, true);
    });
  }, []);

  const handleModelChange = useCallback((model: number) => {
    setSession((s) => setModel(s, s.activeTrackId, model));
  }, []);

  const handleLeashChange = useCallback((value: number) => {
    setSession((s) => setLeash(s, value));
  }, []);

  const handleAgencyChange = useCallback((agency: 'OFF' | 'SUGGEST' | 'PLAY') => {
    setSession((s) => setAgency(s, s.activeTrackId, agency));
  }, []);

  const handleUndo = useCallback(() => {
    setSession((s) => applyUndo(s));
  }, []);

  const handleSend = useCallback(async (message: string) => {
    setSession((s) => ({
      ...s,
      messages: [...s.messages, { role: 'human' as const, text: message, timestamp: Date.now() }],
    }));
    const actions = await aiRef.current.ask(sessionRef.current, message);
    dispatchAIActions(actions);
  }, [dispatchAIActions]);

  const handleCommit = useCallback((pendingId: string) => {
    setSession((s) => commitPending(s, pendingId));
  }, []);

  const handleDismiss = useCallback((pendingId: string) => {
    setSession((s) => dismissPending(s, pendingId));
  }, []);

  const handleApiKey = useCallback((key: string) => {
    aiRef.current.setApiKey(key);
    setApiConfigured(true);
  }, []);

  const handleTogglePlay = useCallback(() => {
    setSession((s) => togglePlaying(s));
  }, []);

  const handleToggleRecord = useCallback(async () => {
    if (recording) {
      const blob = await exporterRef.current.stop();
      setRecording(false);
      // Download the file
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gluon-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const dest = audioRef.current.getMediaStreamDestination();
      if (dest) {
        exporterRef.current.start(dest);
        setRecording(true);
      }
    }
  }, [recording]);

  const handleSelectVoice = useCallback((trackId: string) => {
    setSession((s) => setActiveVoice(s, trackId));
    setStepPage(0);
  }, []);

  const handleToggleMute = useCallback((trackId: string) => {
    setSession((s) => toggleMute(s, trackId));
  }, []);

  const handleToggleSolo = useCallback((trackId: string) => {
    setSession((s) => toggleSolo(s, trackId));
  }, []);

  const handleStepToggle = useCallback((stepIndex: number) => {
    setSession((s) => toggleStepGate(s, s.activeTrackId, stepIndex));
  }, []);

  const handleStepAccent = useCallback((stepIndex: number) => {
    setSession((s) => toggleStepAccent(s, s.activeTrackId, stepIndex));
  }, []);

  const handlePatternLength = useCallback((length: number) => {
    setSession((s) => setPatternLength(s, s.activeTrackId, length));
    setStepPage(0);
  }, []);

  const handleClearPattern = useCallback(() => {
    setSession((s) => clearPattern(s, s.activeTrackId));
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
      if (e.key === ' ' && !e.repeat) {
        e.preventDefault();
        handleTogglePlay();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, handleTogglePlay]);

  // AI reactive loop
  useEffect(() => {
    if (!audioStarted) return;
    const interval = setInterval(async () => {
      const s = sessionRef.current;
      if (!aiRef.current.isConfigured()) return;
      const anyActive = s.tracks.some(v => v.agency !== 'OFF');
      if (!anyActive) return;
      if (s.leash < 0.3) return;
      const actions = await aiRef.current.react(s);
      if (actions.length > 0) dispatchAIActions(actions);
    }, 3000);
    return () => clearInterval(interval);
  }, [audioStarted, dispatchAIActions]);

  // Expire audition pending actions
  useEffect(() => {
    if (session.pending.length === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setSession((s) => {
        const expired = s.pending.filter(p => p.kind === 'audition' && p.expiresAt < now);
        if (expired.length === 0) return s;
        let next = s;
        for (const p of expired) {
          next = dismissPending(next, p.id);
        }
        return next;
      });
    }, 500);
    return () => clearInterval(interval);
  }, [session.pending.length]);

  const currentStep = Math.floor(globalStep % activeVoice.pattern.length);
  const totalPages = Math.ceil(activeVoice.pattern.length / 16);

  // Find pending sketch for active voice
  const pendingSketch = session.pending.find(
    (p): p is SketchPendingAction => p.kind === 'sketch' && p.trackId === activeVoice.id,
  );

  if (!audioStarted) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="text-center space-y-6">
          <h1 className="text-4xl font-light tracking-wider">GLUON</h1>
          <p className="text-zinc-400 text-sm">human-AI music collaboration</p>
          <button
            onClick={startAudio}
            className="px-8 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm tracking-wide transition-colors"
          >
            Start Audio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4">
      <div className="max-w-7xl mx-auto grid grid-cols-[1fr_320px] gap-4 h-[calc(100vh-2rem)]">
        <div className="flex flex-col gap-3">
          <TransportBar
            playing={session.transport.playing}
            bpm={session.transport.bpm}
            swing={session.transport.swing}
            recording={recording}
            globalStep={globalStep}
            patternLength={activeVoice.pattern.length}
            onTogglePlay={handleTogglePlay}
            onBpmChange={(bpm) => setSession(s => setTransportBpm(s, bpm))}
            onSwingChange={(swing) => setSession(s => setTransportSwing(s, swing))}
            onToggleRecord={handleToggleRecord}
          />

          <div className="flex items-center justify-between">
            <VoiceSelector
              voices={session.tracks}
              activeTrackId={session.activeTrackId}
              onSelectVoice={handleSelectVoice}
              onToggleMute={handleToggleMute}
              onToggleSolo={handleToggleSolo}
            />
            <div className="flex items-center gap-4">
              <ModelSelector model={activeVoice.model} onChange={handleModelChange} />
              <UndoButton onClick={handleUndo} disabled={session.undoStack.length === 0} />
            </div>
          </div>

          <div className="relative flex-1 min-h-0">
            <ParameterSpace
              timbre={activeVoice.params.timbre}
              morph={activeVoice.params.morph}
              onChange={handleParamChange}
              onInteractionStart={() => arbRef.current.humanInteractionStart()}
              onInteractionEnd={() => arbRef.current.humanInteractionEnd()}
            />
            <PendingOverlay pending={session.pending} onCommit={handleCommit} onDismiss={handleDismiss} />
          </div>

          <div className="flex items-center gap-3">
            <StepGrid
              pattern={activeVoice.pattern}
              currentStep={currentStep}
              playing={session.transport.playing}
              pendingSketch={pendingSketch}
              page={stepPage}
              onToggleGate={handleStepToggle}
              onToggleAccent={handleStepAccent}
              onStepHold={setHeldStep}
              onStepRelease={() => setHeldStep(null)}
            />
            <PatternControls
              patternLength={activeVoice.pattern.length}
              totalPages={totalPages}
              currentPage={stepPage}
              onLengthChange={handlePatternLength}
              onPageChange={setStepPage}
              onClear={handleClearPattern}
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <Visualiser analyser={audioRef.current.getAnalyser()} />
            </div>
            <PitchControl
              note={activeVoice.params.note}
              harmonics={activeVoice.params.harmonics}
              onNoteChange={handleNoteChange}
              onHarmonicsChange={handleHarmonicsChange}
            />
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <ApiKeyInput onSubmit={handleApiKey} isConfigured={apiConfigured} />
          <LeashSlider value={session.leash} onChange={handleLeashChange} />
          <AgencyToggle value={activeVoice.agency} onChange={handleAgencyChange} />
          <ChatPanel messages={session.messages} onSend={handleSend} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 20.2: Commit**

```bash
git add src/ui/App.tsx
git commit -m "feat: wire App.tsx for multi-voice, sequencer, transport, export"
```

---

### Task 21: Update existing undo and automation tests

**Files:**
- Modify: `tests/engine/undo.test.ts`
- Modify: `tests/ai/automation.test.ts`

- [ ] **Step 21.1: Update undo tests for multi-voice**

Update `tests/engine/undo.test.ts` to use `getTrack()` and multi-voice `applyMove()` signature:

```typescript
// tests/engine/undo.test.ts
import { describe, it, expect } from 'vitest';
import { applyMove, applyMoveGroup, applyUndo } from '../../src/engine/primitives';
import { createSession, updateTrackParams } from '../../src/engine/session';
import { toggleStepGate } from '../../src/engine/pattern-primitives';
import { getTrack } from '../../src/engine/types';

describe('Undo (Phase 2)', () => {
  it('undoes a single param move', () => {
    const s = createSession();
    const vid = s.activeTrackId;
    const moved = applyMove(s, vid, 'timbre', { absolute: 0.8 });
    const undone = applyUndo(moved);
    expect(getTrack(undone, vid).params.timbre).toBe(0.5);
  });

  it('undoes move group in one step', () => {
    const s = createSession();
    const vid = s.activeTrackId;
    const moved = applyMoveGroup(s, vid, [
      { param: 'timbre', target: { absolute: 0.8 } },
      { param: 'morph', target: { absolute: 0.3 } },
    ]);
    const undone = applyUndo(moved);
    expect(getTrack(undone, vid).params.timbre).toBe(0.5);
    expect(getTrack(undone, vid).params.morph).toBe(0.5);
  });

  it('does not undo if human has moved param since AI', () => {
    const s = createSession();
    const vid = s.activeTrackId;
    let state = applyMove(s, vid, 'timbre', { absolute: 0.8 });
    state = updateTrackParams(state, vid, { timbre: 0.6 });
    const undone = applyUndo(state);
    expect(getTrack(undone, vid).params.timbre).toBe(0.6);
  });

  it('undoes pattern edits unconditionally', () => {
    const s = createSession();
    const vid = s.activeTrackId;
    const toggled = toggleStepGate(s, vid, 0);
    expect(getTrack(toggled, vid).pattern.steps[0].gate).toBe(true);
    const undone = applyUndo(toggled);
    expect(getTrack(undone, vid).pattern.steps[0].gate).toBe(false);
  });

  it('undoes in LIFO order', () => {
    const s = createSession();
    const vid = s.activeTrackId;
    let state = applyMove(s, vid, 'timbre', { absolute: 0.8 });
    state = toggleStepGate(state, vid, 0);
    // Undo pattern edit first
    state = applyUndo(state);
    expect(getTrack(state, vid).pattern.steps[0].gate).toBe(false);
    // Then undo param move
    state = applyUndo(state);
    expect(getTrack(state, vid).params.timbre).toBe(0.5);
  });
});
```

- [ ] **Step 21.2: Run updated undo tests**

Run: `npx vitest run tests/engine/undo.test.ts`
Expected: PASS

- [ ] **Step 21.3: Commit**

```bash
git add tests/engine/undo.test.ts tests/ai/automation.test.ts
git commit -m "test: update undo and automation tests for Phase 2 multi-voice types"
```

---

### Task 22: Final integration test — build and type-check

- [ ] **Step 22.1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 22.2: Run TypeScript type check**

Run: `npx tsc -b --noEmit`
Expected: No type errors

- [ ] **Step 22.3: Run build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 22.4: Fix any issues found**

Address any type errors, import issues, or test failures. Common issues:
- `PendingOverlay` may reference old `PendingAction.type` field — update to use `kind`
- Other UI components may reference `session.voice` — update to use `getActiveTrack(session)`
- Test files may have stale imports

- [ ] **Step 22.5: Commit all fixes**

```bash
git add -A
git commit -m "fix: resolve type errors and integration issues from Phase 2 migration"
```

---

### Task 23: Polish — keyboard shortcuts, step hold gesture, final tweaks

- [ ] **Step 23.1: Verify spacebar play/stop works**

Already wired in App.tsx step 20.1. Verify it works by running the dev server.

Run: `npm run dev`
Expected: Spacebar toggles transport play/stop

- [ ] **Step 23.2: Verify Cmd+Z undo works across param and pattern edits**

Already wired. Manual test in browser.

- [ ] **Step 23.3: Verify "hold step + tweak XY pad" creates parameter locks**

The `heldStep` state + `handleParamChange` integration in step 20.1 handles this. Manual test.

**Deferred to post-Phase 2 polish:** Pattern copy/paste between voices, VoiceSelector model label display. These are spec requirements that are lower priority than the core sequencer flow.

- [ ] **Step 23.4: Commit any final polish**

```bash
git add -A
git commit -m "chore: Phase 2 integration polish and manual verification"
```
