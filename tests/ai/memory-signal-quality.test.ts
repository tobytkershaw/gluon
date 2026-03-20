// tests/ai/memory-signal-quality.test.ts
//
// Signal quality tests for AI memory (#1268).
// These verify that the memory system produces actionable, well-structured
// memories — not just that the plumbing works (which is covered in
// src/engine/save-memory.test.ts and src/engine/operation-executor-memory.test.ts).

import { describe, it, expect } from 'vitest';
import { compressMemories } from '../../src/ai/state-compression';
import { executeOperations } from '../../src/engine/operation-executor';
import { Arbitrator } from '../../src/engine/arbitration';
import { MAX_PROJECT_MEMORIES } from '../../src/engine/types';
import type {
  ProjectMemory,
  Session,
  AIAction,
  AISaveMemoryAction,
} from '../../src/engine/types';
import type { SourceAdapter } from '../../src/engine/canonical-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMemory(
  overrides: Partial<ProjectMemory> & Pick<ProjectMemory, 'type' | 'content'>,
): ProjectMemory {
  return {
    id: `mem-${Math.random().toString(36).slice(2, 8)}`,
    confidence: 0.85,
    evidence: 'test evidence',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeSession(overrides?: Partial<Session>): Session {
  return {
    tracks: [
      {
        id: 'v0',
        engine: 'plaits',
        model: 0,
        params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
        muted: false,
        solo: false,
        stepGrid: { steps: [], length: 16 },
        patterns: [],
        processors: [],
        modulators: [],
        modulations: [],
        surface: { modules: [], thumbprint: { type: 'static-color' } },
        volume: 0.8,
        pan: 0,
        sequence: [],
      },
      {
        id: 'v1',
        engine: 'plaits',
        model: 2,
        params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
        muted: false,
        solo: false,
        stepGrid: { steps: [], length: 16 },
        patterns: [],
        processors: [],
        modulators: [],
        modulations: [],
        surface: { modules: [], thumbprint: { type: 'static-color' } },
        volume: 0.8,
        pan: 0,
        sequence: [],
      },
    ],
    activeTrackId: 'v0',
    transport: { status: 'stopped', bpm: 120, swing: 0 },
    master: { volume: 0.8, pan: 0 },
    undoStack: [],
    redoStack: [],
    context: { key: null, scale: null, tempo: null, energy: 0.5, density: 0.5 },
    messages: [],
    recentHumanActions: [],
    ...overrides,
  } as Session;
}

const stubAdapter: SourceAdapter = {
  id: 'test',
  name: 'Test Adapter',
  mapControl: () => ({ target: 'source' as const, runtimeParam: 'harmonics' }),
  applyControlChanges: () => {},
  mapEvents: (events) => events,
  readControlState: () => ({}),
  readRegions: () => [],
  mapRuntimeParamKey: () => null,
  getControlSchemas: () => [],
  validateOperation: () => ({ valid: true }),
  midiToNormalisedPitch: (midi: number) => midi / 127,
  normalisedPitchToMidi: (norm: number) => Math.round(norm * 127),
};

function run(session: Session, actions: AIAction[]) {
  return executeOperations(session, actions, stubAdapter, new Arbitrator());
}

function makeSaveAction(overrides?: Partial<AISaveMemoryAction>): AISaveMemoryAction {
  return {
    type: 'save_memory',
    memoryType: 'direction',
    content: 'Dark minimal techno — Surgeon reference.',
    evidence: 'Human said "dark and minimal"',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Signal quality: content that explains *why*, not just *what*
// ---------------------------------------------------------------------------

describe('Signal quality: direction memories', () => {
  it('a good direction memory explains why, not just what', () => {
    // "Rejected because too fizzy" is actionable.
    // "Set timbre to 0.3" is noise — it duplicates state already in compressed output.
    const goodMemory = makeMemory({
      type: 'direction',
      content: 'Rejected bright textures — user wants dark, thick low-end only.',
      evidence: 'User undid bright patch twice and said "too fizzy"',
    });
    const badMemory = makeMemory({
      type: 'direction',
      content: 'Set timbre to 0.3',
      evidence: 'parameter change',
    });

    // Good memory compresses to actionable text
    const goodResult = compressMemories([goodMemory]);
    expect(goodResult).not.toBeNull();
    expect(goodResult).toContain('Rejected bright textures');

    // Bad memory compresses too, but the content is not actionable —
    // it duplicates parameter state. The system should carry *reasons*.
    const badResult = compressMemories([badMemory]);
    expect(badResult).not.toBeNull();
    // Both compress, but the point is that the good one carries intent.
    // We verify the good memory preserves the reasoning language.
    expect(goodResult!).toContain('dark');
    expect(goodResult!).toContain('thick low-end');
  });

  it('direction memory with uncertain confidence gets qualifier', () => {
    const uncertain = makeMemory({
      type: 'direction',
      content: 'Might want to go ambient later — not confirmed.',
      confidence: 0.3,
    });
    const certain = makeMemory({
      type: 'direction',
      content: 'Committed to 130bpm four-on-floor foundation.',
      confidence: 0.9,
    });

    const result = compressMemories([certain, uncertain]);
    expect(result).not.toBeNull();
    // The uncertain one should be flagged
    expect(result).toContain('uncertain:');
    // The certain one should not
    const lines = result!.split('\n').filter(l => l.includes('Direction:'));
    const certainLine = lines.find(l => l.includes('130bpm'));
    expect(certainLine).not.toContain('uncertain');
  });
});

describe('Signal quality: track-narrative memories', () => {
  it('a good track-narrative summarizes the journey, not just final state', () => {
    // Good: captures the evolution and decisions made
    const goodNarrative = makeMemory({
      type: 'track-narrative',
      content: 'Started as acid bass, stripped back after 3 iterations. Now a dry sub-bass anchor — user approved.',
      trackId: 'v0',
    });

    const result = compressMemories([goodNarrative]);
    expect(result).not.toBeNull();
    // Should preserve narrative arc keywords
    expect(result).toContain('Started as acid bass');
    expect(result).toContain('stripped back');
    expect(result).toContain('approved');
  });

  it('track-narrative is associated with its track in compressed output', () => {
    const narrative = makeMemory({
      type: 'track-narrative',
      content: 'Kick is settled — four-on-floor, dry, punchy.',
      trackId: 'v0',
    });

    const result = compressMemories([narrative]);
    expect(result).not.toBeNull();
    // Should reference the track
    expect(result).toContain('Track v0:');
    expect(result).toContain('Kick is settled');
  });
});

// ---------------------------------------------------------------------------
// Superseding: replaces without growing
// ---------------------------------------------------------------------------

describe('Signal quality: superseding memories', () => {
  it('superseding replaces the old memory — count stays the same', () => {
    const memories = [
      makeMemory({ id: 'mem-old', type: 'direction', content: 'Bright and airy.' }),
      makeMemory({ id: 'mem-other', type: 'decision', content: 'Intro is 8 bars.' }),
    ];
    const session = makeSession({ memories });

    const result = run(session, [
      makeSaveAction({
        content: 'Dark and heavy — user reversed direction.',
        supersedes: 'mem-old',
      }),
    ]);

    expect(result.accepted).toHaveLength(1);
    expect(result.session.memories).toHaveLength(2); // count unchanged
    // Old content gone
    expect(result.session.memories!.find(m => m.content === 'Bright and airy.')).toBeUndefined();
    // New content present
    expect(result.session.memories!.find(m => m.content === 'Dark and heavy — user reversed direction.')).toBeDefined();
    // Other memory untouched
    expect(result.session.memories!.find(m => m.id === 'mem-other')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Compressed index size: stays reasonable for typical memory sets
// ---------------------------------------------------------------------------

describe('Compressed memory index size', () => {
  it('10 memories of various types produce a reasonably-sized index', () => {
    const memories: ProjectMemory[] = [
      makeMemory({ type: 'direction', content: 'Dark minimal techno, Surgeon reference.' }),
      makeMemory({ type: 'direction', content: 'No reverb on kick — keep it bone-dry.' }),
      makeMemory({ type: 'direction', content: 'Sparse arrangements, never more than 4 elements at once.' }),
      makeMemory({ type: 'track-narrative', content: 'Kick settled after 2 iterations — punchy, dry.', trackId: 'v0' }),
      makeMemory({ type: 'track-narrative', content: 'Bass started acid, now sub-only.', trackId: 'v1' }),
      makeMemory({ type: 'decision', content: '8-bar intro, kick enters bar 9.' }),
      makeMemory({ type: 'decision', content: 'Break at bar 33 — strip to hats and reverb tail.' }),
      makeMemory({ type: 'decision', content: 'Use FM synthesis for metallic texture on track 3.' }),
      makeMemory({ type: 'direction', content: 'User prefers gradual builds over sudden drops.' }),
      makeMemory({ type: 'track-narrative', content: 'Hi-hat pattern approved — offbeat, subtle velocity variation.', trackId: 'v0' }),
    ];

    const result = compressMemories(memories);
    expect(result).not.toBeNull();

    // 10 memories should produce something under 2000 chars — enough to be
    // useful in a context window without dominating it.
    expect(result!.length).toBeLessThan(2000);
    // But also non-trivial (at least 200 chars to carry real content)
    expect(result!.length).toBeGreaterThan(200);

    // Should contain the count
    expect(result).toContain('10 memories');
  });

  it('30 memories (full cap) still produce a bounded index', () => {
    const memories: ProjectMemory[] = Array.from({ length: 30 }, (_, i) =>
      makeMemory({
        type: i % 3 === 0 ? 'direction' : i % 3 === 1 ? 'track-narrative' : 'decision',
        content: `Memory ${i}: some useful content about the project direction.`,
        ...(i % 3 === 1 ? { trackId: 'v0' } : {}),
      }),
    );

    const result = compressMemories(memories);
    expect(result).not.toBeNull();
    // Even at full cap, should stay under 6000 chars (each memory is ~60 chars
    // content + ~20 chars overhead = ~80 chars * 30 = ~2400 + header)
    expect(result!.length).toBeLessThan(6000);
    expect(result).toContain('30 memories');
  });
});

// ---------------------------------------------------------------------------
// Integration: realistic multi-memory scenario
// ---------------------------------------------------------------------------

describe('Integration: realistic memory scenario', () => {
  it('mixed memory types produce a coherent, well-grouped index', () => {
    const memories: ProjectMemory[] = [
      makeMemory({ type: 'direction', content: 'Dark minimal techno — Surgeon, Regis references.' }),
      makeMemory({ type: 'direction', content: 'No melodic content until user asks for it.', confidence: 0.7 }),
      makeMemory({ type: 'track-narrative', content: 'Kick: four-on-floor, dry, 909-style. Approved.', trackId: 'v0' }),
      makeMemory({ type: 'track-narrative', content: 'Bass: sub-only, FM-based. Settled after 3 tries.', trackId: 'v1' }),
      makeMemory({ type: 'decision', content: 'Arrangement: 8-bar intro (hats only), kick enters bar 9.' }),
      makeMemory({ type: 'decision', content: 'Break at bar 33: strip to reverb tail and noise sweep.' }),
    ];

    const result = compressMemories(memories);
    expect(result).not.toBeNull();

    // Header
    expect(result).toContain('## Project Memory (6 memories)');

    // Directions come first, then narratives, then decisions
    const lines = result!.split('\n').filter(l => l.startsWith('- '));
    expect(lines).toHaveLength(6);

    // First two should be directions
    expect(lines[0]).toContain('Direction:');
    expect(lines[1]).toContain('Direction:');

    // Next two should be track narratives
    expect(lines[2]).toContain('Track v0:');
    expect(lines[3]).toContain('Track v1:');

    // Last two should be decisions
    expect(lines[4]).toContain('Decision:');
    expect(lines[5]).toContain('Decision:');

    // Content preserved
    expect(result).toContain('Surgeon');
    expect(result).toContain('four-on-floor');
    expect(result).toContain('8-bar intro');

    // No JSON artifacts
    expect(result).not.toContain('{');
    expect(result).not.toContain('"type"');
  });

  it('recall filters by trackId at execution level', () => {
    const memories: ProjectMemory[] = [
      makeMemory({ id: 'mem-v0-1', type: 'track-narrative', content: 'Kick is settled', trackId: 'v0' }),
      makeMemory({ id: 'mem-v0-2', type: 'direction', content: 'Global direction', trackId: 'v0' }),
      makeMemory({ id: 'mem-v1-1', type: 'track-narrative', content: 'Bass narrative', trackId: 'v1' }),
      makeMemory({ id: 'mem-global', type: 'direction', content: 'Project-wide direction' }),
    ];
    const session = makeSession({ memories });

    // recall_memories is read-only at operation-executor level (filtering in api.ts),
    // but prevalidation rejects bad trackIds. Verify that.
    const validRecall: AIAction = { type: 'recall_memories', trackId: 'v0' };
    const result = run(session, [validRecall]);
    expect(result.accepted).toHaveLength(1);
    // Session memories not mutated
    expect(result.session.memories).toHaveLength(4);

    // Invalid trackId is rejected
    const invalidRecall: AIAction = { type: 'recall_memories', trackId: 'nonexistent' };
    const badResult = run(session, [invalidRecall]);
    expect(badResult.rejected).toHaveLength(1);
    expect(badResult.rejected[0].reason).toContain('Track not found');
  });

  it('memory cap end-to-end: save 30, 31st is rejected', () => {
    // Fill to cap
    const memories = Array.from({ length: MAX_PROJECT_MEMORIES }, (_, i) =>
      makeMemory({
        id: `mem-${i}`,
        type: 'direction',
        content: `Direction memory ${i}`,
      }),
    );
    const session = makeSession({ memories });

    // Try to save one more without supersedes
    const result = run(session, [
      makeSaveAction({ content: 'One too many.' }),
    ]);

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('Memory cap reached');
    expect(result.session.memories).toHaveLength(MAX_PROJECT_MEMORIES);
  });

  it('memory cap: supersedes still works at cap', () => {
    const memories = Array.from({ length: MAX_PROJECT_MEMORIES }, (_, i) =>
      makeMemory({
        id: `mem-${i}`,
        type: 'direction',
        content: `Direction memory ${i}`,
      }),
    );
    const session = makeSession({ memories });

    // Supersede an existing memory — should succeed
    const result = run(session, [
      makeSaveAction({
        content: 'Updated direction — supersedes mem-10.',
        supersedes: 'mem-10',
      }),
    ]);

    expect(result.accepted).toHaveLength(1);
    expect(result.session.memories).toHaveLength(MAX_PROJECT_MEMORIES);
    expect(result.session.memories!.find(m => m.id === 'mem-10')).toBeUndefined();
    expect(
      result.session.memories!.find(m => m.content === 'Updated direction — supersedes mem-10.'),
    ).toBeDefined();
  });
});
