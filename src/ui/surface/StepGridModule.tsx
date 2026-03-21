import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ModuleRendererProps } from './ModuleRendererProps';
import type { TriggerEvent, NoteEvent } from '../../engine/canonical-types';
import { getActivePattern } from '../../engine/types';
import { resolveBinding } from '../../engine/binding-resolver';
import { getAccentColor } from './visual-utils';
import { ensureTypedTarget } from './binding-helpers';

interface PaintState {
  active: boolean;
  direction: 'on' | 'off';
  visitedSteps: Set<number>;
}

/**
 * StepGridModule — TR-style interactive step display for the Surface.
 *
 * Binds to a region via module.bindings and reads trigger events from
 * the track's active pattern. Shows up to 16 steps with gate/accent
 * indicators and beat-boundary markers.
 *
 * Interactions:
 * - Click a step: toggle gate on/off (discrete undo)
 * - Shift+click an active step: toggle accent
 * - Drag across steps: paint on/off (grouped undo via onInteractionStart/End)
 */
export function StepGridModule({
  module,
  track,
  visualContext,
  roleColor,
  onStepToggle,
  onStepAccentToggle,
  onInteractionStart,
  onInteractionEnd,
}: ModuleRendererProps) {
  // Step grid uses base role — pattern output is the track's identity
  const accent = roleColor?.full ?? getAccentColor(visualContext);

  // Resolve pattern from region binding through the binding contract
  const regionBinding = module.bindings.find(b => b.role === 'region');

  const { pattern, isDisconnected, disconnectReason } = useMemo(() => {
    if (!regionBinding) {
      // No region binding — fall back to active pattern
      const fallback = track.patterns.length > 0 ? getActivePattern(track) : null;
      return { pattern: fallback, isDisconnected: false, disconnectReason: '' };
    }

    const target = ensureTypedTarget(regionBinding, module.type, module.config);
    const resolved = resolveBinding(track, target);

    if (resolved.status === 'stale') {
      return { pattern: null, isDisconnected: true, disconnectReason: resolved.reason };
    }
    if (resolved.status === 'unsupported') {
      return { pattern: null, isDisconnected: true, disconnectReason: resolved.reason };
    }

    if (resolved.kind === 'region') {
      // Reconstruct a pattern-like object from the resolved region
      const trackPattern = track.patterns.find(p => p.id === resolved.patternId);
      return { pattern: trackPattern ?? null, isDisconnected: false, disconnectReason: '' };
    }

    // Unexpected binding kind for a region role — treat as disconnected
    return { pattern: null, isDisconnected: true, disconnectReason: `unexpected binding kind for region role` };
  }, [regionBinding, module.type, module.config, track]);

  // Paint state ref — survives re-renders without causing them
  const paintingRef = useRef<PaintState>({ active: false, direction: 'on', visitedSteps: new Set() });

  // Disconnected state — binding target no longer exists
  if (isDisconnected) {
    return (
      <div
        className="h-full flex flex-col p-2 opacity-40"
        title={`Disconnected: ${disconnectReason}`}
      >
        <span className="text-xs text-zinc-400 font-medium truncate">
          {module.label}
        </span>
        <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs">
          Disconnected
        </div>
      </div>
    );
  }

  const interactive = !!onStepToggle;

  if (!pattern) {
    return (
      <div className="h-full flex flex-col p-2">
        <span className="text-xs text-zinc-400 font-medium truncate">
          {module.label}
        </span>
        <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs">
          No pattern
        </div>
      </div>
    );
  }

  // Extract gate events (trigger or note) from the pattern, keyed by integer step position
  const stepCount = Math.min(Math.floor(pattern.duration), 16);
  const gatesByStep = new Map<number, TriggerEvent | NoteEvent>();
  for (const event of pattern.events) {
    if (event.kind === 'trigger' || event.kind === 'note') {
      const stepPos = Math.floor(event.at);
      if (stepPos >= 0 && stepPos < stepCount) {
        gatesByStep.set(stepPos, event as TriggerEvent | NoteEvent);
      }
    }
  }

  /** Check if a step has an active gate (non-zero velocity). */
  const stepHasGate = (stepIndex: number): boolean => {
    const ev = gatesByStep.get(stepIndex);
    return ev !== undefined && (ev.velocity ?? 0) !== 0;
  };

  // Step toggles are discrete actions (not continuous gestures like knob drags),
  // so they don't use onInteractionStart/End. toggleStepGate manages its own undo.
  const handleStepClick = useCallback(
    (stepIndex: number) => {
      if (!onStepToggle) return;
      onStepToggle(track.id, stepIndex, pattern?.id);
    },
    [onStepToggle, track.id, pattern],
  );

  const handleStepAccentClick = useCallback(
    (stepIndex: number) => {
      if (!onStepAccentToggle) return;
      onStepAccentToggle(track.id, stepIndex, pattern?.id);
    },
    [onStepAccentToggle, track.id, pattern],
  );

  /** Apply paint direction to a step (toggle on or off). */
  const applyPaintToStep = useCallback(
    (stepIndex: number) => {
      if (!onStepToggle) return;
      const state = paintingRef.current;
      if (state.visitedSteps.has(stepIndex)) return;
      state.visitedSteps.add(stepIndex);

      const hasGate = stepHasGate(stepIndex);
      // Only toggle if the step's current state doesn't match the paint direction
      if ((state.direction === 'on' && !hasGate) || (state.direction === 'off' && hasGate)) {
        onStepToggle(track.id, stepIndex, pattern?.id);
      }
    },
    [onStepToggle, track.id, pattern, gatesByStep],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, stepIndex: number) => {
      if (!interactive) return;

      // Shift+click = accent toggle, not paint
      if (e.shiftKey) {
        e.preventDefault();
        handleStepAccentClick(stepIndex);
        return;
      }

      e.preventDefault();

      const hasGate = stepHasGate(stepIndex);
      // First toggle determines direction: if step was off, we're painting ON; if on, painting OFF
      const direction: 'on' | 'off' = hasGate ? 'off' : 'on';

      paintingRef.current = {
        active: true,
        direction,
        visitedSteps: new Set([stepIndex]),
      };

      // Toggle the first step (discrete — own undo entry via toggleStepGate)
      handleStepClick(stepIndex);
    },
    [interactive, handleStepClick, handleStepAccentClick, gatesByStep],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!paintingRef.current.active) return;

      // Find which step element the pointer is over using data-step-index
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el) return;

      const stepEl = (el as HTMLElement).closest('[data-step-index]');
      if (!stepEl) return;

      const stepIndex = parseInt(stepEl.getAttribute('data-step-index') ?? '', 10);
      if (isNaN(stepIndex)) return;

      const state = paintingRef.current;
      if (state.visitedSteps.has(stepIndex)) return;

      // If this is the second step being painted, start the interaction group
      if (state.visitedSteps.size === 1) {
        onInteractionStart?.();
      }

      applyPaintToStep(stepIndex);
    },
    [applyPaintToStep, onInteractionStart],
  );

  // Document-level pointerup to end paint gesture
  const endPaint = useCallback(() => {
    const state = paintingRef.current;
    if (!state.active) return;

    // Only call onInteractionEnd if we painted multiple steps (interaction group was started)
    if (state.visitedSteps.size > 1) {
      onInteractionEnd?.();
    }

    paintingRef.current = { active: false, direction: 'on', visitedSteps: new Set() };
  }, [onInteractionEnd]);

  useEffect(() => {
    const handler = () => endPaint();
    document.addEventListener('pointerup', handler);
    return () => document.removeEventListener('pointerup', handler);
  }, [endPaint]);

  return (
    <div className="h-full flex flex-col p-2">
      <span className="text-xs text-zinc-400 font-medium truncate mb-1">
        {module.label}
      </span>
      <div
        className="flex-1 flex items-center gap-0.5"
        style={{ touchAction: 'none' }}
        onPointerMove={interactive ? handlePointerMove : undefined}
      >
        {Array.from({ length: stepCount }, (_, i) => {
          const gateEvent = gatesByStep.get(i);
          // velocity=0 is the disabled sentinel — treat as no gate
          const velocity = gateEvent?.velocity ?? 0;
          const hasGate = gateEvent !== undefined && velocity !== 0;
          const hasAccent = hasGate && gateEvent.kind === 'trigger' && (gateEvent as TriggerEvent).accent === true;
          const isBeatBoundary = i % 4 === 0;

          return (
            <div
              key={i}
              data-no-select
              data-step-index={i}
              className={`relative flex-1 min-w-0 h-full rounded-sm transition-colors border${interactive ? ' cursor-pointer hover:brightness-125 active:brightness-150' : ''}`}
              style={hasGate
                ? {
                    backgroundColor: accent,
                    opacity: hasAccent ? 0.7 : 0.3,
                    borderColor: accent,
                  }
                : {
                    backgroundColor: 'rgba(39,39,42,0.6)',
                    borderColor: 'rgba(63,63,70,0.4)',
                  }
              }
              onPointerDown={interactive ? (e) => handlePointerDown(e, i) : undefined}
            >
              {/* Beat boundary marker */}
              {isBeatBoundary && (
                <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-zinc-500/40 rounded-l" />
              )}

              {/* Step number */}
              <span className="absolute top-0.5 left-0.5 text-[9px] text-zinc-600 leading-none select-none">
                {i + 1}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
