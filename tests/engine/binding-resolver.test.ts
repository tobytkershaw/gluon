import { describe, it, expect } from 'vitest';
import { resolveBinding, writeBinding, migrateBinding } from '../../src/engine/binding-resolver';
import type {
  Track,
  BindingTarget,
  ScalarTarget,
  SourceTarget,
  ProcessorTarget,
  ModulatorTarget,
  MixTarget,
  DrumPadTarget,
  WeightedTarget,
  RegionTarget,
  ChainTarget,
  KitTarget,
  ResolvedScalar,
  ResolvedWeighted,
  ResolvedRegion,
  ResolvedChain,
  ResolvedKit,
  BindingWriteResult,
  SemanticControlDef,
} from '../../src/engine/types';
import { createSession } from '../../src/engine/session';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTrack(overrides: Partial<Track> = {}): Track {
  const session = createSession();
  const base = session.tracks[0]; // default audio track 'v0'
  return { ...base, ...overrides };
}

function trackWithProcessor(): Track {
  return makeTrack({
    processors: [{
      id: 'reverb-1',
      type: 'rings',
      model: 0,
      params: { brightness: 0.7, structure: 0.3, damping: 0.5 },
    }],
  });
}

function trackWithModulator(): Track {
  return makeTrack({
    modulators: [{
      id: 'lfo-1',
      type: 'tides',
      model: 0,
      params: { rate: 0.4, shape: 0.6 },
    }],
  });
}

function trackWithDrumRack(): Track {
  return makeTrack({
    engine: 'drum-rack',
    drumRack: {
      pads: [
        {
          id: 'kick',
          name: 'Kick',
          source: { engine: 'plaits', model: 6, params: { timbre: 0.3, morph: 0.5 } },
          level: 0.8,
          pan: 0.5,
        },
        {
          id: 'snare',
          name: 'Snare',
          source: { engine: 'plaits', model: 7, params: { timbre: 0.6, morph: 0.4 } },
          level: 0.7,
          pan: 0.6,
        },
      ],
    },
  });
}

function trackWithPatterns(): Track {
  return makeTrack({
    patterns: [
      {
        id: 'pat-1',
        kind: 'pattern' as const,
        duration: 16,
        name: 'Main',
        events: [
          { at: 0, kind: 'trigger' as const, velocity: 1.0, accent: false },
          { at: 4, kind: 'trigger' as const, velocity: 0.8, accent: false },
        ],
      },
      {
        id: 'pat-2',
        kind: 'pattern' as const,
        duration: 8,
        name: 'Fill',
        events: [],
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// resolveBinding — scalar targets
// ---------------------------------------------------------------------------

describe('resolveBinding', () => {
  describe('source target', () => {
    it('resolves a source param using controlId-to-runtime mapping', () => {
      const track = makeTrack({ params: { note: 0.6, harmonics: 0.5, timbre: 0.5, morph: 0.5 } });
      const target: SourceTarget = { kind: 'source', param: 'frequency' };
      const result = resolveBinding(track, target);
      expect(result.status).toBe('ok');
      expect((result as ResolvedScalar).kind).toBe('scalar');
      expect((result as ResolvedScalar).value).toBe(0.6); // frequency -> note
      expect((result as ResolvedScalar).range).toEqual({ min: 0, max: 1 });
    });

    it('resolves a direct source param (no mapping needed)', () => {
      const track = makeTrack({ params: { note: 0.5, harmonics: 0.75, timbre: 0.5, morph: 0.5 } });
      const target: SourceTarget = { kind: 'source', param: 'harmonics' };
      const result = resolveBinding(track, target);
      expect(result.status).toBe('ok');
      expect((result as ResolvedScalar).value).toBe(0.75);
    });

    it('defaults to 0.5 for unknown source param', () => {
      const track = makeTrack();
      const target: SourceTarget = { kind: 'source', param: 'unknown-param' };
      const result = resolveBinding(track, target);
      expect(result.status).toBe('ok');
      expect((result as ResolvedScalar).value).toBe(0.5);
    });
  });

  describe('processor target', () => {
    it('resolves a processor param', () => {
      const track = trackWithProcessor();
      const target: ProcessorTarget = { kind: 'processor', processorId: 'reverb-1', param: 'brightness' };
      const result = resolveBinding(track, target);
      expect(result.status).toBe('ok');
      expect((result as ResolvedScalar).value).toBe(0.7);
    });

    it('returns stale for missing processor', () => {
      const track = makeTrack();
      const target: ProcessorTarget = { kind: 'processor', processorId: 'nonexistent', param: 'foo' };
      const result = resolveBinding(track, target);
      expect(result.status).toBe('stale');
      expect((result as { reason: string }).reason).toContain('nonexistent');
    });
  });

  describe('modulator target', () => {
    it('resolves a modulator param', () => {
      const track = trackWithModulator();
      const target: ModulatorTarget = { kind: 'modulator', modulatorId: 'lfo-1', param: 'rate' };
      const result = resolveBinding(track, target);
      expect(result.status).toBe('ok');
      expect((result as ResolvedScalar).value).toBe(0.4);
    });

    it('returns stale for missing modulator', () => {
      const track = makeTrack();
      const target: ModulatorTarget = { kind: 'modulator', modulatorId: 'gone', param: 'rate' };
      const result = resolveBinding(track, target);
      expect(result.status).toBe('stale');
    });
  });

  describe('mix target', () => {
    it('resolves volume', () => {
      const track = makeTrack({ volume: 0.6 });
      const target: MixTarget = { kind: 'mix', param: 'volume' };
      const result = resolveBinding(track, target);
      expect(result.status).toBe('ok');
      expect((result as ResolvedScalar).value).toBe(0.6);
      expect((result as ResolvedScalar).range).toEqual({ min: 0, max: 1 });
    });

    it('resolves pan with bipolar range', () => {
      const track = makeTrack({ pan: -0.5 });
      const target: MixTarget = { kind: 'mix', param: 'pan' };
      const result = resolveBinding(track, target);
      expect(result.status).toBe('ok');
      expect((result as ResolvedScalar).value).toBe(-0.5);
      expect((result as ResolvedScalar).range).toEqual({ min: -1, max: 1 });
    });
  });

  describe('drumPad target', () => {
    it('resolves drum pad level', () => {
      const track = trackWithDrumRack();
      const target: DrumPadTarget = { kind: 'drumPad', padId: 'kick', param: 'level' };
      const result = resolveBinding(track, target);
      expect(result.status).toBe('ok');
      expect((result as ResolvedScalar).value).toBe(0.8);
    });

    it('resolves drum pad pan', () => {
      const track = trackWithDrumRack();
      const target: DrumPadTarget = { kind: 'drumPad', padId: 'snare', param: 'pan' };
      const result = resolveBinding(track, target);
      expect(result.status).toBe('ok');
      expect((result as ResolvedScalar).value).toBe(0.6);
      expect((result as ResolvedScalar).range).toEqual({ min: 0, max: 1 });
    });

    it('resolves drum pad source param', () => {
      const track = trackWithDrumRack();
      const target: DrumPadTarget = { kind: 'drumPad', padId: 'kick', param: 'timbre' };
      const result = resolveBinding(track, target);
      expect(result.status).toBe('ok');
      expect((result as ResolvedScalar).value).toBe(0.3);
    });

    it('returns stale for missing pad', () => {
      const track = trackWithDrumRack();
      const target: DrumPadTarget = { kind: 'drumPad', padId: 'ghost', param: 'level' };
      const result = resolveBinding(track, target);
      expect(result.status).toBe('stale');
    });

    it('returns stale when track has no drum rack', () => {
      const track = makeTrack();
      const target: DrumPadTarget = { kind: 'drumPad', padId: 'kick', param: 'level' };
      const result = resolveBinding(track, target);
      expect(result.status).toBe('stale');
    });
  });

  describe('unsupported targets', () => {
    it('generator returns unsupported', () => {
      const track = makeTrack();
      const target: ScalarTarget = { kind: 'generator', generatorId: 'g1', param: 'x' };
      const result = resolveBinding(track, target);
      expect(result.status).toBe('unsupported');
    });

    it('paramShape returns unsupported', () => {
      const track = makeTrack();
      const target: ScalarTarget = { kind: 'paramShape', controlId: 'timbre' };
      const result = resolveBinding(track, target);
      expect(result.status).toBe('unsupported');
    });
  });

  // ---------------------------------------------------------------------------
  // resolveBinding — weighted targets
  // ---------------------------------------------------------------------------

  describe('weighted target', () => {
    it('computes weighted average of multiple source params', () => {
      const track = makeTrack({ params: { note: 0.5, harmonics: 0.8, timbre: 0.2, morph: 0.5 } });
      const target: WeightedTarget = {
        kind: 'weighted',
        mappings: [
          { target: { kind: 'source', param: 'harmonics' }, weight: 1.0 },
          { target: { kind: 'source', param: 'timbre' }, weight: 1.0 },
        ],
      };
      const result = resolveBinding(track, target);
      expect(result.status).toBe('ok');
      expect((result as ResolvedWeighted).kind).toBe('weighted');
      // (0.8 + 0.2) / 2 = 0.5
      expect((result as ResolvedWeighted).value).toBe(0.5);
      expect((result as ResolvedWeighted).componentValues).toHaveLength(2);
    });

    it('applies inverse transform when reading', () => {
      const track = makeTrack({ params: { note: 0.5, harmonics: 0.8, timbre: 0.5, morph: 0.5 } });
      const target: WeightedTarget = {
        kind: 'weighted',
        mappings: [
          { target: { kind: 'source', param: 'harmonics' }, weight: 1.0, transform: 'inverse' },
        ],
      };
      const result = resolveBinding(track, target);
      expect(result.status).toBe('ok');
      // inverse: 1 - 0.8 = 0.2
      expect((result as ResolvedWeighted).value).toBeCloseTo(0.2);
    });

    it('returns stale if any mapping target is stale', () => {
      const track = makeTrack();
      const target: WeightedTarget = {
        kind: 'weighted',
        mappings: [
          { target: { kind: 'processor', processorId: 'gone', param: 'x' }, weight: 1.0 },
        ],
      };
      const result = resolveBinding(track, target);
      expect(result.status).toBe('stale');
    });
  });

  // ---------------------------------------------------------------------------
  // resolveBinding — compound targets
  // ---------------------------------------------------------------------------

  describe('region target', () => {
    it('resolves pattern events', () => {
      const track = trackWithPatterns();
      const target: RegionTarget = { kind: 'region', patternId: 'pat-1' };
      const result = resolveBinding(track, target);
      expect(result.status).toBe('ok');
      expect((result as ResolvedRegion).kind).toBe('region');
      expect((result as ResolvedRegion).events).toHaveLength(2);
    });

    it('returns stale for missing pattern', () => {
      const track = trackWithPatterns();
      const target: RegionTarget = { kind: 'region', patternId: 'nonexistent' };
      const result = resolveBinding(track, target);
      expect(result.status).toBe('stale');
    });
  });

  describe('chain target', () => {
    it('resolves processor array', () => {
      const track = trackWithProcessor();
      const target: ChainTarget = { kind: 'chain' };
      const result = resolveBinding(track, target);
      expect(result.status).toBe('ok');
      expect((result as ResolvedChain).kind).toBe('chain');
      expect((result as ResolvedChain).processors).toHaveLength(1);
    });

    it('resolves empty chain for track without processors', () => {
      const track = makeTrack();
      const target: ChainTarget = { kind: 'chain' };
      const result = resolveBinding(track, target);
      expect(result.status).toBe('ok');
      expect((result as ResolvedChain).processors).toHaveLength(0);
    });
  });

  describe('kit target', () => {
    it('resolves drum rack pads', () => {
      const track = trackWithDrumRack();
      const target: KitTarget = { kind: 'kit' };
      const result = resolveBinding(track, target);
      expect(result.status).toBe('ok');
      expect((result as ResolvedKit).kind).toBe('kit');
      expect((result as ResolvedKit).pads).toHaveLength(2);
    });

    it('returns stale for track without drum rack', () => {
      const track = makeTrack();
      const target: KitTarget = { kind: 'kit' };
      const result = resolveBinding(track, target);
      expect(result.status).toBe('stale');
    });
  });
});

// ---------------------------------------------------------------------------
// writeBinding
// ---------------------------------------------------------------------------

describe('writeBinding', () => {
  describe('scalar targets', () => {
    it('writes source param', () => {
      const track = makeTrack();
      const target: SourceTarget = { kind: 'source', param: 'timbre' };
      const result = writeBinding(track, target, 0.7);
      expect(result.status).toBe('ok');
      const ok = result as { status: 'ok'; trackId: string; mutations: unknown[] };
      expect(ok.trackId).toBe(track.id);
      expect(ok.mutations).toHaveLength(1);
      expect(ok.mutations[0]).toEqual({ kind: 'sourceParam', param: 'timbre', value: 0.7 });
    });

    it('writes processor param', () => {
      const track = trackWithProcessor();
      const target: ProcessorTarget = { kind: 'processor', processorId: 'reverb-1', param: 'brightness' };
      const result = writeBinding(track, target, 0.9);
      expect(result.status).toBe('ok');
      const ok = result as { status: 'ok'; mutations: { kind: string; processorId: string; param: string; value: number }[] };
      expect(ok.mutations[0]).toEqual({ kind: 'processorParam', processorId: 'reverb-1', param: 'brightness', value: 0.9 });
    });

    it('writes modulator param', () => {
      const track = trackWithModulator();
      const target: ModulatorTarget = { kind: 'modulator', modulatorId: 'lfo-1', param: 'rate' };
      const result = writeBinding(track, target, 0.3);
      expect(result.status).toBe('ok');
      const ok = result as { status: 'ok'; mutations: { kind: string }[] };
      expect(ok.mutations[0]).toEqual({ kind: 'modulatorParam', modulatorId: 'lfo-1', param: 'rate', value: 0.3 });
    });

    it('writes mix volume (0-1 range)', () => {
      const track = makeTrack({ volume: 0.8 });
      const target: MixTarget = { kind: 'mix', param: 'volume' };
      const result = writeBinding(track, target, 0.5);
      expect(result.status).toBe('ok');
      const ok = result as { status: 'ok'; mutations: { kind: string; param: string; value: number }[] };
      expect(ok.mutations[0]).toEqual({ kind: 'mixParam', param: 'volume', value: 0.5 });
    });

    it('writes mix pan (denormalized from 0-1 to -1..1)', () => {
      const track = makeTrack({ pan: 0 });
      const target: MixTarget = { kind: 'mix', param: 'pan' };
      // 0.75 in 0-1 → -1 + 0.75 * 2 = 0.5 in native range
      const result = writeBinding(track, target, 0.75);
      expect(result.status).toBe('ok');
      const ok = result as { status: 'ok'; mutations: { value: number }[] };
      expect(ok.mutations[0].value).toBeCloseTo(0.5);
    });

    it('writes drum pad param', () => {
      const track = trackWithDrumRack();
      const target: DrumPadTarget = { kind: 'drumPad', padId: 'kick', param: 'level' };
      const result = writeBinding(track, target, 0.9);
      expect(result.status).toBe('ok');
      const ok = result as { status: 'ok'; mutations: { kind: string }[] };
      expect(ok.mutations[0]).toEqual({ kind: 'drumPadParam', padId: 'kick', param: 'level', value: 0.9 });
    });

    it('returns stale for missing processor', () => {
      const track = makeTrack();
      const target: ProcessorTarget = { kind: 'processor', processorId: 'gone', param: 'x' };
      const result = writeBinding(track, target, 0.5);
      expect(result.status).toBe('stale');
    });
  });

  describe('weighted targets', () => {
    it('produces multiple mutations with transform applied', () => {
      const track = makeTrack({ params: { note: 0.5, harmonics: 0.5, timbre: 0.5, morph: 0.5 } });
      const target: WeightedTarget = {
        kind: 'weighted',
        mappings: [
          { target: { kind: 'source', param: 'harmonics' }, weight: 0.5, transform: 'linear' },
          { target: { kind: 'source', param: 'timbre' }, weight: 0.5, transform: 'inverse' },
        ],
      };
      const result = writeBinding(track, target, 0.8);
      expect(result.status).toBe('ok');
      const ok = result as { status: 'ok'; mutations: { kind: string; param: string; value: number }[] };
      expect(ok.mutations).toHaveLength(2);
      // linear with weight 0.5: 0.5 + (0.8 - 0.5) * 0.5 * 2 = 0.5 + 0.3 = 0.8
      expect(ok.mutations[0].value).toBeCloseTo(0.8);
      // inverse with weight 0.5: 0.5 - (0.8 - 0.5) * 0.5 * 2 = 0.5 - 0.3 = 0.2
      expect(ok.mutations[1].value).toBeCloseTo(0.2);
    });

    it('returns stale if any component is stale', () => {
      const track = makeTrack();
      const target: WeightedTarget = {
        kind: 'weighted',
        mappings: [
          { target: { kind: 'processor', processorId: 'gone', param: 'x' }, weight: 1.0 },
        ],
      };
      const result = writeBinding(track, target, 0.5);
      expect(result.status).toBe('stale');
    });
  });

  describe('non-writable targets', () => {
    it('region returns unsupported', () => {
      const track = trackWithPatterns();
      const result = writeBinding(track, { kind: 'region', patternId: 'pat-1' }, 0.5);
      expect(result.status).toBe('unsupported');
    });

    it('chain returns unsupported', () => {
      const track = trackWithProcessor();
      const result = writeBinding(track, { kind: 'chain' }, 0.5);
      expect(result.status).toBe('unsupported');
    });

    it('kit returns unsupported', () => {
      const track = trackWithDrumRack();
      const result = writeBinding(track, { kind: 'kit' }, 0.5);
      expect(result.status).toBe('unsupported');
    });

    it('generator returns unsupported', () => {
      const track = makeTrack();
      const result = writeBinding(track, { kind: 'generator', generatorId: 'g1', param: 'x' }, 0.5);
      expect(result.status).toBe('unsupported');
    });

    it('paramShape returns unsupported', () => {
      const track = makeTrack();
      const result = writeBinding(track, { kind: 'paramShape', controlId: 'timbre' }, 0.5);
      expect(result.status).toBe('unsupported');
    });
  });
});

// ---------------------------------------------------------------------------
// migrateBinding
// ---------------------------------------------------------------------------

describe('migrateBinding', () => {
  it('migrates source param (known name)', () => {
    const result = migrateBinding(
      { role: 'control', trackId: 'v0', target: 'frequency' },
      'knob-group',
      {},
    );
    expect(result.role).toBe('control');
    expect(result.target).toEqual({ kind: 'source', param: 'frequency' });
  });

  it('migrates processor param (colon-separated)', () => {
    const result = migrateBinding(
      { role: 'control', trackId: 'v0', target: 'reverb-1:brightness' },
      'knob-group',
      {},
    );
    expect(result.target).toEqual({ kind: 'processor', processorId: 'reverb-1', param: 'brightness' });
  });

  it('migrates region binding', () => {
    const result = migrateBinding(
      { role: 'region', trackId: 'v0', target: 'pat-1' },
      'step-grid',
      {},
    );
    expect(result.role).toBe('region');
    expect(result.target).toEqual({ kind: 'region', patternId: 'pat-1' });
  });

  it('migrates chain binding', () => {
    const result = migrateBinding(
      { role: 'chain', trackId: 'v0', target: '' },
      'chain-strip',
      {},
    );
    expect(result.target).toEqual({ kind: 'chain' });
  });

  it('migrates kit binding', () => {
    const result = migrateBinding(
      { role: 'kit', trackId: 'v0', target: '' },
      'pad-grid',
      {},
    );
    expect(result.target).toEqual({ kind: 'kit' });
  });

  it('migrates macro-knob with semanticControl config to weighted target', () => {
    const config = {
      semanticControl: {
        id: 'brightness',
        name: 'Brightness',
        semanticRole: 'brightness',
        description: 'Overall brightness',
        weights: [
          { moduleId: 'source', controlId: 'harmonics', weight: 0.8, transform: 'linear' as const },
          { moduleId: 'reverb-1', controlId: 'brightness', weight: 0.5, transform: 'inverse' as const },
        ],
        range: { min: 0, max: 1, default: 0.5 },
      },
    };
    const result = migrateBinding(
      { role: 'control', trackId: 'v0', target: 'brightness' },
      'macro-knob',
      config,
    );
    expect(result.target).toEqual({
      kind: 'weighted',
      mappings: [
        { target: { kind: 'source', param: 'harmonics' }, weight: 0.8, transform: 'linear' },
        { target: { kind: 'processor', processorId: 'reverb-1', param: 'brightness' }, weight: 0.5, transform: 'inverse' },
      ],
    });
  });

  it('falls back to source for unknown bare string targets', () => {
    const result = migrateBinding(
      { role: 'control', trackId: 'v0', target: 'some-custom-param' },
      'knob-group',
      {},
    );
    expect(result.target).toEqual({ kind: 'source', param: 'some-custom-param' });
  });
});
