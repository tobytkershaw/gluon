/**
 * Rendering smoke tests for Surface components.
 *
 * These tests catch React child-type crashes — e.g. when an object (like
 * BindingTarget) is accidentally rendered as a React child instead of being
 * converted to a string first.  The pattern is simple:
 *
 *   1. Build representative data that includes *typed* objects (not just strings).
 *   2. Render the component.
 *   3. Assert it didn't throw.
 *
 * If the component tries to render an object directly, React throws
 * "Objects are not valid as a React child" and the render call will throw.
 *
 * Ref: issue #1430
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  Track,
  SurfaceModule,
  ModuleBinding,
  BindingTarget,
  SourceTarget,
  ProcessorTarget,
  RegionTarget,
  WeightedTarget,
  DrumRackConfig,
} from '../../../src/engine/types';
import { ModuleConfigPanel } from '../../../src/ui/surface/ModuleConfigPanel';
import { KnobGroupModule } from '../../../src/ui/surface/KnobGroupModule';
import { StepGridModule } from '../../../src/ui/surface/StepGridModule';
import { PadGridModule } from '../../../src/ui/surface/PadGridModule';

// ── Fixtures ───────────────────────────────────────────────────────

/** Minimal Track that satisfies the type — extend via spread overrides. */
function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'trk-1',
    engine: 'plaits',
    model: 0,
    params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
    stepGrid: { steps: [], length: 16, pageSize: 16 },
    patterns: [{ id: 'pat-1', label: 'Pattern 1', duration: 16, events: [] }],
    sequence: [],
    muted: false,
    solo: false,
    volume: 0.8,
    pan: 0,
    surface: { modules: [], thumbprint: { type: 'static-color' } },
    processors: [
      { id: 'reverb', type: 'reverb', model: 0, params: { mix: 0.3, decay: 0.5 } },
    ],
    ...overrides,
  } as Track;
}

function makeModule(overrides: Partial<SurfaceModule> = {}): SurfaceModule {
  return {
    type: 'knob-group',
    id: 'mod-1',
    label: 'Test Module',
    bindings: [],
    position: { x: 0, y: 0, w: 4, h: 2 },
    config: {},
    ...overrides,
  };
}

// ── Typed binding target factories ──────────────────────────────────

function sourceTarget(param: string): SourceTarget {
  return { kind: 'source', param };
}

function processorTarget(processorId: string, param: string): ProcessorTarget {
  return { kind: 'processor', processorId, param };
}

function regionTarget(patternId: string): RegionTarget {
  return { kind: 'region', patternId };
}

function weightedTarget(): WeightedTarget {
  return {
    kind: 'weighted',
    mappings: [
      { target: sourceTarget('harmonics'), weight: 0.5 },
      { target: sourceTarget('timbre'), weight: 0.5 },
    ],
  };
}

function binding(role: string, target: string | BindingTarget): ModuleBinding {
  return { role, trackId: 'trk-1', target };
}

// ── Drum rack fixture ───────────────────────────────────────────────

function makeDrumRack(): DrumRackConfig {
  return {
    pads: [
      { id: 'kick', name: 'Kick', source: { engine: 'plaits', model: 0, params: { note: 0.3 } }, level: 0.8, pan: 0.5 },
      { id: 'snare', name: 'Snare', source: { engine: 'plaits', model: 1, params: { note: 0.5 } }, level: 0.8, pan: 0.5 },
      { id: 'hat', name: 'Hat', source: { engine: 'plaits', model: 5, params: { note: 0.7 } }, level: 0.7, pan: 0.5, chokeGroup: 1 },
    ],
  };
}

// ── ModuleConfigPanel smoke tests ───────────────────────────────────

describe('ModuleConfigPanel — rendering smoke', () => {
  const noop = vi.fn();

  it('renders without crash when bindings use SourceTarget objects', () => {
    const mod = makeModule({
      bindings: [
        binding('control', sourceTarget('harmonics')),
        binding('control', sourceTarget('timbre')),
      ],
    });
    const track = makeTrack();

    // If BindingTarget objects are rendered as React children, this will throw
    // "Objects are not valid as a React child"
    const { container } = render(
      <ModuleConfigPanel
        module={mod}
        track={track}
        onUpdateModule={noop}
        onRemoveModule={noop}
        onClose={noop}
      />,
    );
    expect(container.querySelector('[data-testid="module-config-panel"]')).toBeTruthy();
  });

  it('renders without crash when bindings use ProcessorTarget objects', () => {
    const mod = makeModule({
      bindings: [
        binding('control', processorTarget('reverb', 'mix')),
      ],
    });
    const track = makeTrack();

    const { container } = render(
      <ModuleConfigPanel
        module={mod}
        track={track}
        onUpdateModule={noop}
        onRemoveModule={noop}
        onClose={noop}
      />,
    );
    expect(container.querySelector('[data-testid="module-config-panel"]')).toBeTruthy();
  });

  it('renders without crash when bindings use RegionTarget objects', () => {
    const mod = makeModule({
      bindings: [
        binding('region', regionTarget('pat-1')),
      ],
    });
    const track = makeTrack();

    const { container } = render(
      <ModuleConfigPanel
        module={mod}
        track={track}
        onUpdateModule={noop}
        onRemoveModule={noop}
        onClose={noop}
      />,
    );
    expect(container.querySelector('[data-testid="module-config-panel"]')).toBeTruthy();
  });

  it('renders without crash when bindings use WeightedTarget objects', () => {
    const mod = makeModule({
      type: 'macro-knob',
      bindings: [
        binding('control', weightedTarget()),
      ],
    });
    const track = makeTrack();

    const { container } = render(
      <ModuleConfigPanel
        module={mod}
        track={track}
        onUpdateModule={noop}
        onRemoveModule={noop}
        onClose={noop}
      />,
    );
    expect(container.querySelector('[data-testid="module-config-panel"]')).toBeTruthy();
  });

  it('renders without crash when mixing string and BindingTarget bindings', () => {
    const mod = makeModule({
      bindings: [
        binding('control', 'harmonics'),                    // legacy string
        binding('control', sourceTarget('timbre')),          // typed SourceTarget
        binding('region', regionTarget('pat-1')),            // typed RegionTarget
        binding('control', processorTarget('reverb', 'mix')), // typed ProcessorTarget
      ],
    });
    const track = makeTrack();

    const { container } = render(
      <ModuleConfigPanel
        module={mod}
        track={track}
        onUpdateModule={noop}
        onRemoveModule={noop}
        onClose={noop}
      />,
    );
    // All four bindings should render
    const roleLabels = container.querySelectorAll('.uppercase');
    // Header type label + 4 binding role labels
    expect(roleLabels.length).toBeGreaterThanOrEqual(4);
  });

  it('renders without crash with ChainTarget and KitTarget bindings', () => {
    const mod = makeModule({
      bindings: [
        binding('chain', { kind: 'chain' }),
        binding('kit', { kind: 'kit' }),
      ],
    });
    const track = makeTrack();

    const { container } = render(
      <ModuleConfigPanel
        module={mod}
        track={track}
        onUpdateModule={noop}
        onRemoveModule={noop}
        onClose={noop}
      />,
    );
    expect(container.querySelector('[data-testid="module-config-panel"]')).toBeTruthy();
  });
});

// ── KnobGroupModule smoke tests ─────────────────────────────────────

describe('KnobGroupModule — rendering smoke', () => {
  it('renders without crash when bindings use typed BindingTarget objects', () => {
    const mod = makeModule({
      type: 'knob-group',
      bindings: [
        binding('control', sourceTarget('harmonics')),
        binding('control', processorTarget('reverb', 'mix')),
      ],
    });
    const track = makeTrack();

    // Should not throw "Objects are not valid as a React child"
    const { container } = render(
      <KnobGroupModule module={mod} track={track} />,
    );
    expect(container).toBeTruthy();
  });

  it('renders without crash when bindings use WeightedTarget (macro)', () => {
    const mod = makeModule({
      type: 'knob-group',
      bindings: [
        binding('control', weightedTarget()),
      ],
    });
    const track = makeTrack();

    const { container } = render(
      <KnobGroupModule module={mod} track={track} />,
    );
    expect(container).toBeTruthy();
  });
});

// ── StepGridModule smoke tests with region bindings ─────────────────

describe('StepGridModule — rendering smoke with BindingTarget', () => {
  it('renders without crash when region binding uses RegionTarget object', () => {
    const mod = makeModule({
      type: 'step-grid',
      bindings: [
        binding('region', regionTarget('pat-1')),
      ],
    });
    const track = makeTrack();

    const { container } = render(
      <StepGridModule module={mod} track={track} />,
    );
    expect(container).toBeTruthy();
  });

  it('renders without crash for drum rack track with region bindings', () => {
    const drumTrack = makeTrack({
      engine: 'drum-rack',
      drumRack: makeDrumRack(),
      patterns: [{
        id: 'pat-drum',
        label: 'Drum Pattern',
        duration: 16,
        events: [
          { kind: 'trigger', at: 0, velocity: 0.8, padId: 'kick' },
          { kind: 'trigger', at: 4, velocity: 0.8, padId: 'snare' },
          { kind: 'trigger', at: 8, velocity: 0.8, padId: 'kick' },
          { kind: 'trigger', at: 12, velocity: 0.8, padId: 'snare' },
        ],
      }],
    });
    const mod = makeModule({
      type: 'step-grid',
      bindings: [
        binding('region', regionTarget('pat-drum')),
      ],
    });

    const { container } = render(
      <StepGridModule module={mod} track={drumTrack} />,
    );
    expect(container).toBeTruthy();
  });
});

// ── PadGridModule smoke tests ───────────────────────────────────────

describe('PadGridModule — rendering smoke', () => {
  it('renders without crash for drum rack track', () => {
    const drumTrack = makeTrack({
      engine: 'drum-rack',
      drumRack: makeDrumRack(),
      patterns: [{
        id: 'pat-drum',
        label: 'Drum Pattern',
        duration: 16,
        events: [
          { kind: 'trigger', at: 0, velocity: 0.8, padId: 'kick' },
          { kind: 'trigger', at: 4, velocity: 0.8, padId: 'snare' },
        ],
      }],
    });
    const mod = makeModule({
      type: 'pad-grid',
      label: 'Drum Pads',
      bindings: [],
    });

    const { container } = render(
      <PadGridModule module={mod} track={drumTrack} />,
    );
    // Should render pad buttons
    expect(container.querySelectorAll('button').length).toBe(3);
  });

  it('renders without crash when drum rack track has no pads', () => {
    const drumTrack = makeTrack({
      engine: 'drum-rack',
      drumRack: { pads: [] },
    });
    const mod = makeModule({
      type: 'pad-grid',
      label: 'Drum Pads',
      bindings: [],
    });

    const { container } = render(
      <PadGridModule module={mod} track={drumTrack} />,
    );
    expect(screen.getByText('No pads configured')).toBeTruthy();
  });
});

// ── Reusable smoke-test pattern ─────────────────────────────────────

/**
 * assertRendersSafely — reusable pattern for component rendering smoke tests.
 *
 * Usage:
 *   assertRendersSafely(<MyComponent data={representativeData} />);
 *
 * If the component throws during render (e.g. "Objects are not valid as a
 * React child"), the test fails with a clear message.
 */
function assertRendersSafely(element: React.ReactElement) {
  let error: Error | null = null;
  try {
    render(element);
  } catch (e) {
    error = e as Error;
  }
  expect(error).toBeNull();
}

describe('assertRendersSafely helper', () => {
  it('passes for a component that renders cleanly', () => {
    assertRendersSafely(
      <ModuleConfigPanel
        module={makeModule({
          bindings: [binding('control', sourceTarget('harmonics'))],
        })}
        track={makeTrack()}
        onUpdateModule={vi.fn()}
        onRemoveModule={vi.fn()}
        onClose={vi.fn()}
      />,
    );
  });
});
