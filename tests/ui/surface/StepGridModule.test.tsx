import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StepGridModule } from '../../../src/ui/surface/StepGridModule';
import type { Track, SurfaceModule } from '../../../src/engine/types';
import type { Pattern, TriggerEvent, NoteEvent } from '../../../src/engine/canonical-types';

// ── Helpers ────────────────────────────────────────────────────

function makePattern(overrides: Partial<Pattern> = {}): Pattern {
  return {
    id: 'pat-1',
    label: 'Pattern 1',
    duration: 16,
    events: [],
    ...overrides,
  };
}

function makeModule(overrides: Partial<SurfaceModule> = {}): SurfaceModule {
  return {
    type: 'step-grid',
    id: 'mod-1',
    label: 'Steps',
    bindings: [],
    position: { x: 0, y: 0, w: 6, h: 2 },
    config: {},
    ...overrides,
  };
}

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'trk-1',
    engine: 'plaits',
    model: 0,
    params: { note: 0.5 } as Track['params'],
    stepGrid: { steps: [], length: 16, pageSize: 16 },
    patterns: [makePattern()],
    sequence: [],
    muted: false,
    solo: false,
    volume: 0.8,
    pan: 0,
    surface: { modules: [], thumbprint: { shape: 'circle', strokes: [] } },
    ...overrides,
  } as Track;
}

function triggerAt(step: number, opts: Partial<TriggerEvent> = {}): TriggerEvent {
  return { kind: 'trigger', at: step, velocity: 0.8, ...opts };
}

function noteAt(step: number, opts: Partial<NoteEvent> = {}): NoteEvent {
  return { kind: 'note', at: step, pitch: 60, velocity: 0.8, duration: 1, ...opts };
}

// ── Tests ──────────────────────────────────────────────────────

describe('StepGridModule', () => {
  it('renders "No pattern" when track has no patterns', () => {
    render(
      <StepGridModule
        module={makeModule()}
        track={makeTrack({ patterns: [] })}
      />,
    );
    expect(screen.getByText('No pattern')).toBeTruthy();
  });

  it('renders step cells matching pattern duration', () => {
    const { container } = render(
      <StepGridModule
        module={makeModule()}
        track={makeTrack({ patterns: [makePattern({ duration: 8 })] })}
      />,
    );
    // Each step has a step number span
    const stepNumbers = container.querySelectorAll('span');
    // label + 8 step numbers
    const numberSpans = Array.from(stepNumbers).filter(s => /^\d+$/.test(s.textContent ?? ''));
    expect(numberSpans.length).toBe(8);
  });

  it('shows active steps for triggers with non-zero velocity', () => {
    const pattern = makePattern({
      events: [triggerAt(0), triggerAt(3), triggerAt(7)],
    });
    const { container } = render(
      <StepGridModule
        module={makeModule()}
        track={makeTrack({ patterns: [pattern] })}
      />,
    );
    // Steps with gates get the accent color as background
    const stepCells = container.querySelectorAll('[data-no-select]');
    expect(stepCells.length).toBe(16);
    // Active steps (0, 3, 7) have opacity set via style
    const activeSteps = Array.from(stepCells).filter(
      el => (el as HTMLElement).style.opacity === '0.3' || (el as HTMLElement).style.opacity === '0.7',
    );
    expect(activeSteps.length).toBe(3);
  });

  it('treats velocity=0 triggers as disabled (no gate)', () => {
    const pattern = makePattern({
      events: [triggerAt(2, { velocity: 0 })],
    });
    const { container } = render(
      <StepGridModule
        module={makeModule()}
        track={makeTrack({ patterns: [pattern] })}
      />,
    );
    const stepCells = container.querySelectorAll('[data-no-select]');
    // Step 2 should NOT show as active (velocity=0)
    const step2 = stepCells[2] as HTMLElement;
    // Should not have opacity set (inactive gate style has no opacity)
    expect(step2.style.opacity).toBe('');
  });

  it('shows note events as active gates', () => {
    const pattern = makePattern({
      events: [noteAt(4)],
    });
    const { container } = render(
      <StepGridModule
        module={makeModule()}
        track={makeTrack({ patterns: [pattern] })}
      />,
    );
    const stepCells = container.querySelectorAll('[data-no-select]');
    const step4 = stepCells[4] as HTMLElement;
    // Should have opacity set (active gate)
    expect(step4.style.opacity).toBe('0.3');
  });

  it('calls onStepToggle with trackId and step index on click', () => {
    const onStepToggle = vi.fn();
    const track = makeTrack({ patterns: [makePattern()] });
    const { container } = render(
      <StepGridModule
        module={makeModule()}
        track={track}
        onStepToggle={onStepToggle}
      />,
    );
    const stepCells = container.querySelectorAll('[data-no-select]');
    fireEvent.click(stepCells[5]);
    expect(onStepToggle).toHaveBeenCalledWith('trk-1', 5);
  });

  it('calls onInteractionStart and onInteractionEnd around toggle', () => {
    const onStepToggle = vi.fn();
    const onInteractionStart = vi.fn();
    const onInteractionEnd = vi.fn();
    const track = makeTrack({ patterns: [makePattern()] });
    const { container } = render(
      <StepGridModule
        module={makeModule()}
        track={track}
        onStepToggle={onStepToggle}
        onInteractionStart={onInteractionStart}
        onInteractionEnd={onInteractionEnd}
      />,
    );
    const stepCells = container.querySelectorAll('[data-no-select]');
    fireEvent.click(stepCells[2]);
    expect(onInteractionStart).toHaveBeenCalledTimes(1);
    expect(onStepToggle).toHaveBeenCalledTimes(1);
    expect(onInteractionEnd).toHaveBeenCalledTimes(1);
  });

  it('does not call onStepToggle when callback is absent (read-only)', () => {
    const track = makeTrack({ patterns: [makePattern()] });
    const { container } = render(
      <StepGridModule
        module={makeModule()}
        track={track}
      />,
    );
    const stepCells = container.querySelectorAll('[data-no-select]');
    // Should not throw when clicking without callback
    fireEvent.click(stepCells[0]);
  });

  it('adds cursor-pointer class when interactive', () => {
    const onStepToggle = vi.fn();
    const track = makeTrack({ patterns: [makePattern()] });
    const { container } = render(
      <StepGridModule
        module={makeModule()}
        track={track}
        onStepToggle={onStepToggle}
      />,
    );
    const stepCells = container.querySelectorAll('[data-no-select]');
    expect(stepCells[0].className).toContain('cursor-pointer');
  });

  it('does not add cursor-pointer when read-only', () => {
    const track = makeTrack({ patterns: [makePattern()] });
    const { container } = render(
      <StepGridModule
        module={makeModule()}
        track={track}
      />,
    );
    const stepCells = container.querySelectorAll('[data-no-select]');
    expect(stepCells[0].className).not.toContain('cursor-pointer');
  });

  it('uses bound pattern when region binding is present', () => {
    const boundPat = makePattern({ id: 'pat-bound', duration: 4, events: [triggerAt(0)] });
    const activePat = makePattern({ id: 'pat-1', duration: 16, events: [] });
    const track = makeTrack({ patterns: [activePat, boundPat] });
    const mod = makeModule({
      bindings: [{ role: 'region', target: 'pat-bound' }],
    });
    const { container } = render(
      <StepGridModule
        module={mod}
        track={track}
      />,
    );
    // Should show 4 steps (from bound pattern), not 16
    const stepCells = container.querySelectorAll('[data-no-select]');
    expect(stepCells.length).toBe(4);
  });
});
