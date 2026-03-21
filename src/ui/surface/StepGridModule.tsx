import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ModuleRendererProps } from './ModuleRendererProps';
import type { TriggerEvent, NoteEvent, MusicalEvent } from '../../engine/canonical-types';
import type { Pattern } from '../../engine/canonical-types';
import type { DrumPad } from '../../engine/types';
import { getActivePattern } from '../../engine/types';
import { resolveBinding } from '../../engine/binding-resolver';
import { getAccentColor } from './visual-utils';
import { ensureTypedTarget } from './binding-helpers';
import { usePlayheadPosition } from '../usePlayheadPosition';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PaintState {
  active: boolean;
  direction: 'on' | 'off';
  /** Encodes visited cells as "padId:stepIndex" or just stepIndex for single-row */
  visitedSteps: Set<string>;
  /** The padId being painted (for drum multi-row) */
  padId?: string;
  /** Pattern events captured before the first toggle — used for grouped undo. */
  preToggleEvents: MusicalEvent[];
}

/** Display mode for drum rack multi-row grid */
type DrumDisplayMode = 'colored' | 'velocity';

// ---------------------------------------------------------------------------
// Drum pad color palette — distinct hue per pad slot
// ---------------------------------------------------------------------------

const PAD_COLORS = [
  'hsl(25, 95%, 55%)',   // orange (kick)
  'hsl(43, 96%, 56%)',   // amber (snare)
  'hsl(185, 85%, 55%)',  // cyan (hat)
  'hsl(270, 75%, 65%)',  // violet (clap)
  'hsl(340, 85%, 60%)',  // rose (perc)
  'hsl(145, 70%, 50%)',  // green (tom)
  'hsl(55, 90%, 55%)',   // yellow
  'hsl(210, 80%, 60%)',  // blue
  'hsl(15, 90%, 60%)',   // red-orange
  'hsl(300, 70%, 60%)',  // magenta
  'hsl(160, 75%, 50%)',  // teal
  'hsl(90, 65%, 50%)',   // lime
  'hsl(0, 80%, 60%)',    // red
  'hsl(230, 75%, 65%)',  // indigo
  'hsl(60, 80%, 55%)',   // gold
  'hsl(195, 85%, 55%)',  // sky
];

function getPadColor(padIndex: number): string {
  return PAD_COLORS[padIndex % PAD_COLORS.length];
}

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

/** Build a map of step -> gate event for a given padId (or all events if padId is undefined) */
function buildGatesByStep(
  events: MusicalEvent[],
  stepCount: number,
  padId?: string,
): Map<number, TriggerEvent | NoteEvent> {
  const map = new Map<number, TriggerEvent | NoteEvent>();
  for (const event of events) {
    if (event.kind !== 'trigger' && event.kind !== 'note') continue;
    if (padId !== undefined) {
      const eventPadId = event.kind === 'trigger'
        ? (event as TriggerEvent).padId
        : (event as NoteEvent).padId;
      if (eventPadId !== padId) continue;
    }
    const stepPos = Math.floor(event.at);
    if (stepPos >= 0 && stepPos < stepCount) {
      map.set(stepPos, event as TriggerEvent | NoteEvent);
    }
  }
  return map;
}

/** Check if a gate event is accented */
function isAccented(ev: TriggerEvent | NoteEvent): boolean {
  if (ev.kind === 'trigger') return (ev as TriggerEvent).accent === true;
  // NoteEvents: velocity >= 0.95 is accent
  return (ev.velocity ?? 0) >= 0.95;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Render a single step cell in colored mode */
function ColoredStepCell({
  stepIndex,
  gateEvent,
  color,
  isPlayhead,
  isBeatBoundary,
  interactive,
  onPointerDown,
}: {
  stepIndex: number;
  gateEvent: TriggerEvent | NoteEvent | undefined;
  color: string;
  isPlayhead: boolean;
  isBeatBoundary: boolean;
  interactive: boolean;
  onPointerDown?: (e: React.PointerEvent, stepIndex: number) => void;
}) {
  const velocity = gateEvent?.velocity ?? 0;
  const hasGate = gateEvent !== undefined && velocity !== 0;
  const accent = hasGate && isAccented(gateEvent);

  return (
    <div
      data-no-select
      className={`relative flex-1 min-w-0 h-full rounded-sm transition-colors border${interactive ? ' cursor-pointer hover:brightness-125 active:brightness-150' : ''}`}
      style={hasGate
        ? {
            backgroundColor: color,
            opacity: accent ? 0.9 : 0.25 + velocity * 0.55,
            borderColor: isPlayhead ? 'rgba(255,255,255,0.7)' : color,
            boxShadow: isPlayhead ? `0 0 6px ${color}` : undefined,
          }
        : {
            backgroundColor: isPlayhead ? 'rgba(255,255,255,0.08)' : 'rgba(39,39,42,0.4)',
            borderColor: isPlayhead ? 'rgba(255,255,255,0.35)' : 'rgba(63,63,70,0.25)',
          }
      }
      onPointerDown={interactive && onPointerDown ? (e) => onPointerDown(e, stepIndex) : undefined}
    >
      {isBeatBoundary && (
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-zinc-500/40 rounded-l" />
      )}
    </div>
  );
}

/** Render a single step cell in velocity-bar mode */
function VelocityStepCell({
  stepIndex,
  gateEvent,
  color,
  isPlayhead,
  isBeatBoundary,
  interactive,
  onPointerDown,
}: {
  stepIndex: number;
  gateEvent: TriggerEvent | NoteEvent | undefined;
  color: string;
  isPlayhead: boolean;
  isBeatBoundary: boolean;
  interactive: boolean;
  onPointerDown?: (e: React.PointerEvent, stepIndex: number) => void;
}) {
  const velocity = gateEvent?.velocity ?? 0;
  const hasGate = gateEvent !== undefined && velocity !== 0;
  const accent = hasGate && isAccented(gateEvent);
  const barHeight = hasGate ? Math.max(10, velocity * 100) : 0;

  return (
    <div
      data-no-select
      className={`relative flex-1 min-w-0 h-full rounded-sm border flex items-end justify-center${interactive ? ' cursor-pointer hover:brightness-125 active:brightness-150' : ''}`}
      style={{
        backgroundColor: isPlayhead ? 'rgba(255,255,255,0.08)' : 'rgba(39,39,42,0.4)',
        borderColor: isPlayhead ? 'rgba(255,255,255,0.35)' : 'rgba(63,63,70,0.25)',
      }}
      onPointerDown={interactive && onPointerDown ? (e) => onPointerDown(e, stepIndex) : undefined}
    >
      {isBeatBoundary && (
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-zinc-500/40 rounded-l" />
      )}
      {hasGate && (
        <div className="relative w-[60%] rounded-t-sm" style={{ height: `${barHeight}%`, backgroundColor: color, opacity: 0.75 }}>
          {/* Accent cap */}
          {accent && (
            <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-sm" style={{ backgroundColor: color, opacity: 1, filter: 'brightness(1.5)' }} />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * StepGridModule — TR-style interactive step display for the Surface.
 *
 * For drum rack tracks, renders one row per pad with two display modes:
 * - Colored rows (B): filled squares with pad-specific colors, velocity via opacity
 * - Velocity bars (C): taller cells with proportional-height vertical bars
 *
 * For non-drum-rack tracks, renders a single row (original behavior).
 *
 * Interactions:
 * - Click a step: cycle empty -> note -> accent -> empty
 * - Shift+click an active step: direct accent toggle (power-user shortcut)
 * - Drag across steps: paint on/off (single grouped undo via onPaintComplete)
 */
export function StepGridModule({
  module,
  track,
  visualContext,
  roleColor,
  onStepToggle,
  onStepAccentToggle,
  onPaintComplete,
  playing = false,
  globalStep = 0,
  bpm = 120,
}: ModuleRendererProps) {
  const accent = roleColor?.full ?? getAccentColor(visualContext);

  // Display mode for drum rack multi-row view
  const [displayMode, setDisplayMode] = useState<DrumDisplayMode>(
    (module.config?.displayMode as DrumDisplayMode) ?? 'colored',
  );

  // Resolve pattern from region binding
  const regionBinding = module.bindings.find(b => b.role === 'region');

  const { pattern, isDisconnected, disconnectReason } = useMemo(() => {
    if (!regionBinding) {
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
      const trackPattern = track.patterns.find(p => p.id === resolved.patternId);
      return { pattern: trackPattern ?? null, isDisconnected: false, disconnectReason: '' };
    }

    return { pattern: null, isDisconnected: true, disconnectReason: `unexpected binding kind for region role` };
  }, [regionBinding, module.type, module.config, track]);

  // Paint state ref
  const paintingRef = useRef<PaintState>({ active: false, direction: 'on', visitedSteps: new Set(), preToggleEvents: [] });

  // Disconnected state
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

  const padIdFilter = (module.config?.padId as string | undefined) ?? undefined;
  const interactive = !!onStepToggle;
  const isDrumRack = !!track.drumRack?.pads?.length;

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

  // Playhead
  const patternDuration = pattern.duration;
  const rawLocalStep = patternDuration > 0 ? globalStep % patternDuration : 0;
  const { playheadStep } = usePlayheadPosition(rawLocalStep, playing, bpm, patternDuration);
  const activeColumn = playing ? playheadStep : -1;

  const stepCount = Math.min(Math.floor(pattern.duration), 16);

  // -----------------------------------------------------------------------
  // Drum rack: multi-row mode
  // -----------------------------------------------------------------------
  if (isDrumRack && !padIdFilter) {
    return (
      <DrumMultiRowGrid
        module={module}
        track={track}
        pattern={pattern}
        pads={track.drumRack!.pads}
        stepCount={stepCount}
        activeColumn={activeColumn}
        interactive={interactive}
        displayMode={displayMode}
        onDisplayModeToggle={() => setDisplayMode(m => m === 'colored' ? 'velocity' : 'colored')}
        onStepToggle={onStepToggle}
        onStepAccentToggle={onStepAccentToggle}
        onPaintComplete={onPaintComplete}
        paintingRef={paintingRef}
      />
    );
  }

  // -----------------------------------------------------------------------
  // Single-row mode (non-drum-rack or filtered to single pad)
  // -----------------------------------------------------------------------
  const gatesByStep = buildGatesByStep(pattern.events, stepCount, padIdFilter);

  /** Check if a step has an active gate (non-zero velocity). */
  const stepHasGate = (stepIndex: number): boolean => {
    const ev = gatesByStep.get(stepIndex);
    return ev !== undefined && (ev.velocity ?? 0) !== 0;
  };

  const handleStepAccentClick = useCallback(
    (stepIndex: number) => {
      if (!onStepAccentToggle) return;
      onStepAccentToggle(track.id, stepIndex, pattern?.id, padIdFilter);
    },
    [onStepAccentToggle, track.id, pattern, padIdFilter],
  );

  /** Apply paint direction to a step (toggle on or off, no undo). */
  const applyPaintToStep = useCallback(
    (stepIndex: number) => {
      if (!onStepToggle) return;
      const state = paintingRef.current;
      const key = String(stepIndex);
      if (state.visitedSteps.has(key)) return;
      state.visitedSteps.add(key);

      const hasGate = stepHasGate(stepIndex);
      if ((state.direction === 'on' && !hasGate) || (state.direction === 'off' && hasGate)) {
        onStepToggle(track.id, stepIndex, pattern?.id, { pushUndo: false, padId: padIdFilter });
      }
    },
    [onStepToggle, track.id, pattern, gatesByStep, padIdFilter],
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
        visitedSteps: new Set([String(stepIndex)]),
        preToggleEvents: pattern ? [...pattern.events] : [],
      };

      // Toggle the first step without undo — undo snapshot is pushed on paint end
      if (onStepToggle) {
        onStepToggle(track.id, stepIndex, pattern?.id, { pushUndo: false, padId: padIdFilter });
      }
    },
    [interactive, onStepToggle, handleStepAccentClick, gatesByStep, track.id, pattern, padIdFilter],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!paintingRef.current.active) return;

      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el) return;

      const stepEl = (el as HTMLElement).closest('[data-step-index]');
      if (!stepEl) return;

      const stepIndex = parseInt(stepEl.getAttribute('data-step-index') ?? '', 10);
      if (isNaN(stepIndex)) return;

      applyPaintToStep(stepIndex);
    },
    [applyPaintToStep],
  );

  const endPaint = useCallback(() => {
    const state = paintingRef.current;
    if (!state.active) return;

    if (state.visitedSteps.size > 0 && onPaintComplete && pattern) {
      onPaintComplete(track.id, pattern.id, state.preToggleEvents);
    }

    paintingRef.current = { active: false, direction: 'on', visitedSteps: new Set(), preToggleEvents: [] };
  }, [onPaintComplete, track.id, pattern]);

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
          const velocity = gateEvent?.velocity ?? 0;
          const hasGate = gateEvent !== undefined && velocity !== 0;
          const hasAccent = hasGate && isAccented(gateEvent);
          const isBeatBoundary = i % 4 === 0;
          const isPlayhead = i === activeColumn;

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
                    borderColor: isPlayhead ? 'rgba(255,255,255,0.7)' : accent,
                    boxShadow: isPlayhead ? `0 0 6px ${accent}` : undefined,
                  }
                : {
                    backgroundColor: isPlayhead ? 'rgba(255,255,255,0.08)' : 'rgba(39,39,42,0.6)',
                    borderColor: isPlayhead ? 'rgba(255,255,255,0.35)' : 'rgba(63,63,70,0.4)',
                  }
              }
              onPointerDown={interactive ? (e) => handlePointerDown(e, i) : undefined}
            >
              {isBeatBoundary && (
                <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-zinc-500/40 rounded-l" />
              )}

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

// ---------------------------------------------------------------------------
// DrumMultiRowGrid — one row per pad
// ---------------------------------------------------------------------------

function DrumMultiRowGrid({
  module,
  track,
  pattern,
  pads,
  stepCount,
  activeColumn,
  interactive,
  displayMode,
  onDisplayModeToggle,
  onStepToggle,
  onStepAccentToggle,
  onPaintComplete,
  paintingRef,
}: {
  module: ModuleRendererProps['module'];
  track: ModuleRendererProps['track'];
  pattern: Pattern;
  pads: DrumPad[];
  stepCount: number;
  activeColumn: number;
  interactive: boolean;
  displayMode: DrumDisplayMode;
  onDisplayModeToggle: () => void;
  onStepToggle: ModuleRendererProps['onStepToggle'];
  onStepAccentToggle: ModuleRendererProps['onStepAccentToggle'];
  onPaintComplete: ModuleRendererProps['onPaintComplete'];
  paintingRef: React.MutableRefObject<PaintState>;
}) {
  // Build per-pad gate maps
  const padGateMaps = useMemo(() => {
    return pads.map(pad => buildGatesByStep(pattern.events, stepCount, pad.id));
  }, [pads, pattern.events, stepCount]);

  const stepHasGateForPad = (padIndex: number, stepIndex: number): boolean => {
    const ev = padGateMaps[padIndex]?.get(stepIndex);
    return ev !== undefined && (ev.velocity ?? 0) !== 0;
  };

  const handleAccentClick = useCallback(
    (stepIndex: number, padId: string) => {
      if (!onStepAccentToggle) return;
      onStepAccentToggle(track.id, stepIndex, pattern.id, padId);
    },
    [onStepAccentToggle, track.id, pattern.id],
  );

  const applyPaintToStep = useCallback(
    (stepIndex: number, padId: string, padIndex: number) => {
      if (!onStepToggle) return;
      const state = paintingRef.current;
      // Only paint within the same pad row
      if (state.padId !== padId) return;
      const key = `${padId}:${stepIndex}`;
      if (state.visitedSteps.has(key)) return;
      state.visitedSteps.add(key);

      const hasGate = stepHasGateForPad(padIndex, stepIndex);
      if ((state.direction === 'on' && !hasGate) || (state.direction === 'off' && hasGate)) {
        onStepToggle(track.id, stepIndex, pattern.id, { pushUndo: false, padId });
      }
    },
    [onStepToggle, track.id, pattern.id, padGateMaps],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, stepIndex: number, padId: string, padIndex: number) => {
      if (!interactive) return;

      // Shift+click = accent toggle
      if (e.shiftKey) {
        e.preventDefault();
        handleAccentClick(stepIndex, padId);
        return;
      }

      e.preventDefault();

      const hasGate = stepHasGateForPad(padIndex, stepIndex);

      // Click-cycling: empty -> note -> accent -> empty
      if (hasGate) {
        const ev = padGateMaps[padIndex]?.get(stepIndex);
        const accented = ev && isAccented(ev);
        if (!accented) {
          // Has gate but not accented -> toggle accent (no drag)
          handleAccentClick(stepIndex, padId);
          return;
        }
        // Accented -> remove (toggle off) — single click only, no drag paint
        if (onStepToggle) {
          onStepToggle(track.id, stepIndex, pattern.id, { pushUndo: true, padId });
        }
        return;
      }

      // Empty -> note: arm drag paint in "on" direction
      paintingRef.current = {
        active: true,
        direction: 'on',
        padId,
        visitedSteps: new Set([`${padId}:${stepIndex}`]),
        preToggleEvents: [...pattern.events],
      };

      if (onStepToggle) {
        onStepToggle(track.id, stepIndex, pattern.id, { pushUndo: false, padId });
      }
    },
    [interactive, onStepToggle, handleAccentClick, padGateMaps, track.id, pattern],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!paintingRef.current.active) return;

      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el) return;

      const stepEl = (el as HTMLElement).closest('[data-step-index]');
      if (!stepEl) return;

      const stepIndex = parseInt(stepEl.getAttribute('data-step-index') ?? '', 10);
      const padId = stepEl.getAttribute('data-pad-id') ?? '';
      const padIndex = parseInt(stepEl.getAttribute('data-pad-index') ?? '', 10);
      if (isNaN(stepIndex) || !padId || isNaN(padIndex)) return;

      applyPaintToStep(stepIndex, padId, padIndex);
    },
    [applyPaintToStep],
  );

  const endPaint = useCallback(() => {
    const state = paintingRef.current;
    if (!state.active) return;

    if (state.visitedSteps.size > 0 && onPaintComplete && pattern) {
      onPaintComplete(track.id, pattern.id, state.preToggleEvents);
    }

    paintingRef.current = { active: false, direction: 'on', visitedSteps: new Set(), preToggleEvents: [] };
  }, [onPaintComplete, track.id, pattern]);

  useEffect(() => {
    const handler = () => endPaint();
    document.addEventListener('pointerup', handler);
    return () => document.removeEventListener('pointerup', handler);
  }, [endPaint]);

  const StepCell = displayMode === 'colored' ? ColoredStepCell : VelocityStepCell;
  const rowHeight = displayMode === 'colored' ? 'h-5' : 'h-8';

  return (
    <div className="h-full flex flex-col p-2 overflow-hidden">
      {/* Header: label + mode toggle */}
      <div className="flex items-center justify-between mb-1 flex-shrink-0">
        <span className="text-xs text-zinc-400 font-medium truncate">
          {module.label}
        </span>
        <button
          className="text-[10px] text-zinc-500 hover:text-zinc-300 px-1 py-0.5 rounded transition-colors"
          onClick={onDisplayModeToggle}
          title={displayMode === 'colored' ? 'Switch to velocity bars' : 'Switch to colored rows'}
        >
          {displayMode === 'colored' ? '\u2581\u2583\u2585\u2587' : '\u25A0\u25A0'}
        </button>
      </div>

      {/* Step number header */}
      <div className="flex items-center flex-shrink-0 mb-0.5">
        {/* Pad label spacer */}
        <div className="w-12 flex-shrink-0" />
        {/* Mute spacer */}
        <div className="w-4 flex-shrink-0" />
        <div className="flex-1 flex gap-0.5">
          {Array.from({ length: stepCount }, (_, i) => (
            <div
              key={i}
              className={`flex-1 min-w-0 text-center text-[8px] leading-none select-none ${i % 4 === 0 ? 'text-zinc-400' : 'text-zinc-600'}`}
            >
              {i + 1}
            </div>
          ))}
        </div>
      </div>

      {/* Pad rows */}
      <div
        className="flex-1 flex flex-col gap-0.5 overflow-y-auto min-h-0"
        style={{ touchAction: 'none' }}
        onPointerMove={interactive ? handlePointerMove : undefined}
      >
        {pads.map((pad, padIndex) => {
          const gateMap = padGateMaps[padIndex];
          const color = getPadColor(padIndex);
          // Truncate pad name to 3 chars for compact display
          const shortName = (pad.name ?? pad.id).slice(0, 3).toUpperCase();

          return (
            <div key={pad.id} className="flex items-center flex-shrink-0">
              {/* Pad label */}
              <div
                className="w-12 flex-shrink-0 text-[10px] font-medium truncate pr-1 select-none"
                style={{ color }}
                title={pad.name ?? pad.id}
              >
                {shortName}
              </div>

              {/* Per-row mute (placeholder - visual indicator) */}
              <div className="w-4 flex-shrink-0 flex items-center justify-center">
                <div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: color, opacity: 0.6 }}
                />
              </div>

              {/* Step cells */}
              <div className={`flex-1 flex gap-0.5 ${rowHeight}`}>
                {Array.from({ length: stepCount }, (_, i) => {
                  const gateEvent = gateMap?.get(i);
                  const isPlayhead = i === activeColumn;
                  const isBeatBoundary = i % 4 === 0;

                  return (
                    <div
                      key={i}
                      data-step-index={i}
                      data-pad-id={pad.id}
                      data-pad-index={padIndex}
                      className="flex-1 min-w-0"
                    >
                      <StepCell
                        stepIndex={i}
                        gateEvent={gateEvent}
                        color={color}
                        isPlayhead={isPlayhead}
                        isBeatBoundary={isBeatBoundary}
                        interactive={interactive}
                        onPointerDown={interactive
                          ? (e, si) => handlePointerDown(e, si, pad.id, padIndex)
                          : undefined
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
