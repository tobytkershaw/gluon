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

/** Get step cells from a rendered container. */
function getStepCells(container: HTMLElement) {
  return container.querySelectorAll('[data-step-index]');
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
    const stepCells = getStepCells(container);
    expect(stepCells.length).toBe(8);
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
    const stepCells = getStepCells(container);
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
    const stepCells = getStepCells(container);
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
    const stepCells = getStepCells(container);
    const step4 = stepCells[4] as HTMLElement;
    // Should have opacity set (active gate)
    expect(step4.style.opacity).toBe('0.3');
  });

  it('calls onStepToggle with trackId and step index on pointerdown', () => {
    const onStepToggle = vi.fn();
    const track = makeTrack({ patterns: [makePattern()] });
    const { container } = render(
      <StepGridModule
        module={makeModule()}
        track={track}
        onStepToggle={onStepToggle}
      />,
    );
    const stepCells = getStepCells(container);
    fireEvent.pointerDown(stepCells[5]);
    expect(onStepToggle).toHaveBeenCalledWith('trk-1', 5, 'pat-1');
  });

  it('does not call onInteractionStart/End for discrete step toggles', () => {
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
    const stepCells = getStepCells(container);
    fireEvent.pointerDown(stepCells[2]);
    // Fire pointerup on document to end the paint gesture
    fireEvent.pointerUp(document);
    expect(onStepToggle).toHaveBeenCalledTimes(1);
    // Single-step click should NOT trigger interaction boundary
    expect(onInteractionStart).not.toHaveBeenCalled();
    expect(onInteractionEnd).not.toHaveBeenCalled();
  });

  it('does not call onStepToggle when callback is absent (read-only)', () => {
    const track = makeTrack({ patterns: [makePattern()] });
    const { container } = render(
      <StepGridModule
        module={makeModule()}
        track={track}
      />,
    );
    const stepCells = getStepCells(container);
    // Should not throw when clicking without callback
    fireEvent.pointerDown(stepCells[0]);
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
    const stepCells = getStepCells(container);
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
    const stepCells = getStepCells(container);
    expect(stepCells[0].className).not.toContain('cursor-pointer');
  });

  it('uses bound pattern when region binding is present', () => {
    const boundPat = makePattern({ id: 'pat-bound', duration: 4, events: [triggerAt(0)] });
    const activePat = makePattern({ id: 'pat-1', duration: 16, events: [] });
    const track = makeTrack({ patterns: [activePat, boundPat] });
    const mod = makeModule({
      bindings: [{ role: 'region', trackId: 'trk-1', target: 'pat-bound' }],
    });
    const { container } = render(
      <StepGridModule
        module={mod}
        track={track}
      />,
    );
    // Should show 4 steps (from bound pattern), not 16
    const stepCells = getStepCells(container);
    expect(stepCells.length).toBe(4);
  });

  it('passes bound patternId through onStepToggle callback', () => {
    const onStepToggle = vi.fn();
    const boundPat = makePattern({ id: 'pat-bound', duration: 4, events: [] });
    const activePat = makePattern({ id: 'pat-1', duration: 16, events: [] });
    const track = makeTrack({ patterns: [activePat, boundPat] });
    const mod = makeModule({
      bindings: [{ role: 'region', trackId: 'trk-1', target: 'pat-bound' }],
    });
    const { container } = render(
      <StepGridModule
        module={mod}
        track={track}
        onStepToggle={onStepToggle}
      />,
    );
    const stepCells = getStepCells(container);
    fireEvent.pointerDown(stepCells[1]);
    expect(onStepToggle).toHaveBeenCalledWith('trk-1', 1, 'pat-bound');
  });

  // ── Drag-to-paint tests ────────────────────────────────────────

  describe('drag-to-paint', () => {
    it('paints ON direction when starting from empty step', () => {
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
      const stepCells = getStepCells(container);
      const stepContainer = stepCells[0].parentElement!;

      // pointerdown on step 0 (empty → enables)
      fireEvent.pointerDown(stepCells[0]);
      expect(onStepToggle).toHaveBeenCalledWith('trk-1', 0, 'pat-1');

      // Mock document.elementFromPoint to return step 1
      const originalElementFromPoint = document.elementFromPoint;
      document.elementFromPoint = vi.fn().mockReturnValue(stepCells[1]);

      // pointermove → should paint step 1
      fireEvent.pointerMove(stepContainer, { clientX: 50, clientY: 10 });
      expect(onInteractionStart).toHaveBeenCalledTimes(1);
      expect(onStepToggle).toHaveBeenCalledWith('trk-1', 1, 'pat-1');

      // pointermove → should paint step 2
      document.elementFromPoint = vi.fn().mockReturnValue(stepCells[2]);
      fireEvent.pointerMove(stepContainer, { clientX: 100, clientY: 10 });
      expect(onStepToggle).toHaveBeenCalledWith('trk-1', 2, 'pat-1');

      // pointerup ends gesture
      fireEvent.pointerUp(document);
      expect(onInteractionEnd).toHaveBeenCalledTimes(1);

      // Total: 3 step toggles (steps 0, 1, 2)
      expect(onStepToggle).toHaveBeenCalledTimes(3);

      document.elementFromPoint = originalElementFromPoint;
    });

    it('paints OFF direction when starting from active step', () => {
      const onStepToggle = vi.fn();
      const pattern = makePattern({
        events: [triggerAt(0), triggerAt(1), triggerAt(2)],
      });
      const track = makeTrack({ patterns: [pattern] });
      const { container } = render(
        <StepGridModule
          module={makeModule()}
          track={track}
          onStepToggle={onStepToggle}
          onInteractionStart={vi.fn()}
          onInteractionEnd={vi.fn()}
        />,
      );
      const stepCells = getStepCells(container);
      const stepContainer = stepCells[0].parentElement!;

      // pointerdown on step 0 (active → disables)
      fireEvent.pointerDown(stepCells[0]);
      expect(onStepToggle).toHaveBeenCalledWith('trk-1', 0, 'pat-1');

      const originalElementFromPoint = document.elementFromPoint;

      // Drag to step 1 (active → should be toggled off)
      document.elementFromPoint = vi.fn().mockReturnValue(stepCells[1]);
      fireEvent.pointerMove(stepContainer, { clientX: 50, clientY: 10 });
      expect(onStepToggle).toHaveBeenCalledWith('trk-1', 1, 'pat-1');

      // Drag to step 2 (active → should be toggled off)
      document.elementFromPoint = vi.fn().mockReturnValue(stepCells[2]);
      fireEvent.pointerMove(stepContainer, { clientX: 100, clientY: 10 });
      expect(onStepToggle).toHaveBeenCalledWith('trk-1', 2, 'pat-1');

      fireEvent.pointerUp(document);
      expect(onStepToggle).toHaveBeenCalledTimes(3);

      document.elementFromPoint = originalElementFromPoint;
    });

    it('does not revisit already-painted steps', () => {
      const onStepToggle = vi.fn();
      const track = makeTrack({ patterns: [makePattern()] });
      const { container } = render(
        <StepGridModule
          module={makeModule()}
          track={track}
          onStepToggle={onStepToggle}
          onInteractionStart={vi.fn()}
          onInteractionEnd={vi.fn()}
        />,
      );
      const stepCells = getStepCells(container);
      const stepContainer = stepCells[0].parentElement!;

      fireEvent.pointerDown(stepCells[0]);

      const originalElementFromPoint = document.elementFromPoint;

      // Move to step 1
      document.elementFromPoint = vi.fn().mockReturnValue(stepCells[1]);
      fireEvent.pointerMove(stepContainer, { clientX: 50, clientY: 10 });

      // Move back to step 0 (already visited — should NOT toggle again)
      document.elementFromPoint = vi.fn().mockReturnValue(stepCells[0]);
      fireEvent.pointerMove(stepContainer, { clientX: 10, clientY: 10 });

      fireEvent.pointerUp(document);
      // Only 2 toggles: step 0 (pointerdown) + step 1 (first visit)
      expect(onStepToggle).toHaveBeenCalledTimes(2);

      document.elementFromPoint = originalElementFromPoint;
    });
  });

  // ── Shift+click accent tests ───────────────────────────────────

  describe('shift+click accent toggle', () => {
    it('calls onStepAccentToggle with correct args on shift+pointerdown', () => {
      const onStepToggle = vi.fn();
      const onStepAccentToggle = vi.fn();
      const pattern = makePattern({ events: [triggerAt(3)] });
      const track = makeTrack({ patterns: [pattern] });
      const { container } = render(
        <StepGridModule
          module={makeModule()}
          track={track}
          onStepToggle={onStepToggle}
          onStepAccentToggle={onStepAccentToggle}
        />,
      );
      const stepCells = getStepCells(container);
      fireEvent.pointerDown(stepCells[3], { shiftKey: true });
      expect(onStepAccentToggle).toHaveBeenCalledWith('trk-1', 3, 'pat-1');
    });

    it('does NOT call onStepToggle on shift+click', () => {
      const onStepToggle = vi.fn();
      const onStepAccentToggle = vi.fn();
      const pattern = makePattern({ events: [triggerAt(3)] });
      const track = makeTrack({ patterns: [pattern] });
      const { container } = render(
        <StepGridModule
          module={makeModule()}
          track={track}
          onStepToggle={onStepToggle}
          onStepAccentToggle={onStepAccentToggle}
        />,
      );
      const stepCells = getStepCells(container);
      fireEvent.pointerDown(stepCells[3], { shiftKey: true });
      expect(onStepToggle).not.toHaveBeenCalled();
    });

    it('does NOT start a paint gesture on shift+click', () => {
      const onStepToggle = vi.fn();
      const onStepAccentToggle = vi.fn();
      const onInteractionStart = vi.fn();
      const pattern = makePattern({ events: [triggerAt(3)] });
      const track = makeTrack({ patterns: [pattern] });
      const { container } = render(
        <StepGridModule
          module={makeModule()}
          track={track}
          onStepToggle={onStepToggle}
          onStepAccentToggle={onStepAccentToggle}
          onInteractionStart={onInteractionStart}
        />,
      );
      const stepCells = getStepCells(container);
      const stepContainer = stepCells[0].parentElement!;

      fireEvent.pointerDown(stepCells[3], { shiftKey: true });

      const originalElementFromPoint = document.elementFromPoint;
      document.elementFromPoint = vi.fn().mockReturnValue(stepCells[4]);
      fireEvent.pointerMove(stepContainer, { clientX: 50, clientY: 10 });

      // No paint should have happened — only the accent toggle
      expect(onStepToggle).not.toHaveBeenCalled();
      expect(onInteractionStart).not.toHaveBeenCalled();

      fireEvent.pointerUp(document);
      document.elementFromPoint = originalElementFromPoint;
    });
  });
});
