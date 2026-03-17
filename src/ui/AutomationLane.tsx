// src/ui/AutomationLane.tsx
// Breakpoint envelope editor for parameter automation.
// Renders an SVG lane showing ParameterEvents as breakpoints with interpolation curves.

import { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import type { ParameterEvent, MusicalEvent } from '../engine/canonical-types';
import { interpolateParameterValue } from '../engine/interpolation';

interface Breakpoint {
  at: number;
  value: number;
  interpolation: 'step' | 'linear' | 'curve';
  tension: number;
  /** Index into the region's event array (for updates/deletes). */
  eventIndex: number;
}

interface Props {
  /** All events in the region (used to filter ParameterEvents for the selected controlId). */
  events: MusicalEvent[];
  /** Which parameter this lane edits. */
  controlId: string;
  /** Region duration in beats. */
  duration: number;
  /** Display label for the parameter. */
  label: string;
  /** Current playback position (region-local, for playhead). */
  currentStep?: number;
  /** Whether transport is playing. */
  playing?: boolean;
  /** Callbacks to mutate events. */
  onAddBreakpoint: (at: number, value: number, interpolation: 'step' | 'linear' | 'curve') => void;
  onRemoveBreakpoint: (at: number) => void;
  onMoveBreakpoint: (fromAt: number, toAt: number, toValue: number) => void;
  onUpdateInterpolation: (at: number, interpolation: 'step' | 'linear' | 'curve', tension?: number) => void;
  /** Height in pixels. */
  height?: number;
}

const PADDING_LEFT = 28;
const PADDING_RIGHT = 8;
const PADDING_TOP = 4;
const PADDING_BOTTOM = 14;
const POINT_RADIUS = 5;
const POINT_HIT_RADIUS = 10;
const CURVE_SAMPLES = 32;

export function AutomationLane({
  events,
  controlId,
  duration,
  label,
  currentStep,
  playing,
  onAddBreakpoint,
  onRemoveBreakpoint,
  onMoveBreakpoint,
  onUpdateInterpolation,
  height = 100,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [svgWidth, setSvgWidth] = useState(400);

  // Measure SVG width
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      for (const entry of entries) {
        setSvgWidth(entry.contentRect.width);
      }
    });
    obs.observe(el);
    setSvgWidth(el.clientWidth);
    return () => obs.disconnect();
  }, []);

  // Extract breakpoints from events
  const breakpoints = useMemo<Breakpoint[]>(() => {
    const bps: Breakpoint[] = [];
    events.forEach((e, idx) => {
      if (e.kind !== 'parameter') return;
      const pe = e as ParameterEvent;
      if (pe.controlId !== controlId) return;
      if (typeof pe.value !== 'number') return;
      bps.push({
        at: pe.at,
        value: pe.value,
        interpolation: pe.interpolation ?? 'step',
        tension: pe.tension ?? 0,
        eventIndex: idx,
      });
    });
    // Already sorted by `at` due to region normalization
    return bps;
  }, [events, controlId]);

  // Coordinate transforms
  const drawWidth = svgWidth - PADDING_LEFT - PADDING_RIGHT;
  const drawHeight = height - PADDING_TOP - PADDING_BOTTOM;

  const beatToX = useCallback((beat: number) => {
    return PADDING_LEFT + (beat / duration) * drawWidth;
  }, [duration, drawWidth]);

  const valueToY = useCallback((val: number) => {
    // 0 at bottom, 1 at top
    return PADDING_TOP + (1 - val) * drawHeight;
  }, [drawHeight]);

  const xToBeat = useCallback((x: number) => {
    const raw = ((x - PADDING_LEFT) / drawWidth) * duration;
    return Math.max(0, Math.min(duration - 0.001, raw));
  }, [duration, drawWidth]);

  const yToValue = useCallback((y: number) => {
    const raw = 1 - (y - PADDING_TOP) / drawHeight;
    return Math.max(0, Math.min(1, raw));
  }, [drawHeight]);

  // Build SVG path for interpolation curves
  const curvePath = useMemo(() => {
    if (breakpoints.length === 0) return '';

    const segments: string[] = [];
    // Start with a move to the first point
    segments.push(`M ${beatToX(breakpoints[0].at)} ${valueToY(breakpoints[0].value)}`);

    for (let i = 0; i < breakpoints.length - 1; i++) {
      const from = breakpoints[i];
      const to = breakpoints[i + 1];
      const mode = from.interpolation;

      if (mode === 'step') {
        // Horizontal then vertical
        segments.push(`L ${beatToX(to.at)} ${valueToY(from.value)}`);
        segments.push(`L ${beatToX(to.at)} ${valueToY(to.value)}`);
      } else if (mode === 'linear') {
        segments.push(`L ${beatToX(to.at)} ${valueToY(to.value)}`);
      } else if (mode === 'curve') {
        // Sample the curve using the interpolation engine
        const fromEvent: ParameterEvent = {
          kind: 'parameter',
          at: from.at,
          controlId,
          value: from.value,
          interpolation: 'curve',
          tension: from.tension,
        };
        const toEvent: ParameterEvent = {
          kind: 'parameter',
          at: to.at,
          controlId,
          value: to.value,
        };
        for (let s = 1; s <= CURVE_SAMPLES; s++) {
          const t = s / CURVE_SAMPLES;
          const sampleAt = from.at + t * (to.at - from.at);
          const val = interpolateParameterValue(fromEvent, toEvent, sampleAt);
          if (val !== undefined) {
            segments.push(`L ${beatToX(sampleAt)} ${valueToY(val)}`);
          }
        }
      }
    }

    return segments.join(' ');
  }, [breakpoints, beatToX, valueToY, controlId]);

  // Mouse event helpers
  const getSvgPoint = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }, []);

  const findBreakpointAtPoint = useCallback((px: number, py: number): number | null => {
    for (let i = 0; i < breakpoints.length; i++) {
      const bx = beatToX(breakpoints[i].at);
      const by = valueToY(breakpoints[i].value);
      const dist = Math.sqrt((px - bx) ** 2 + (py - by) ** 2);
      if (dist <= POINT_HIT_RADIUS) return i;
    }
    return null;
  }, [breakpoints, beatToX, valueToY]);

  // --- Interaction handlers ---

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const { x, y } = getSvgPoint(e);
    const hitIdx = findBreakpointAtPoint(x, y);

    if (hitIdx !== null) {
      if (e.button === 2 || e.altKey) {
        // Right-click or Alt+click: remove breakpoint
        onRemoveBreakpoint(breakpoints[hitIdx].at);
      } else {
        // Start drag
        setDragIndex(hitIdx);
      }
    } else if (e.button === 0) {
      // Click on empty space: add breakpoint
      const beat = xToBeat(x);
      const value = yToValue(y);
      // Default to linear interpolation for new points
      onAddBreakpoint(beat, value, 'linear');
    }
  }, [getSvgPoint, findBreakpointAtPoint, breakpoints, onRemoveBreakpoint, xToBeat, yToValue, onAddBreakpoint]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const { x, y } = getSvgPoint(e);

    if (dragIndex !== null) {
      const bp = breakpoints[dragIndex];
      if (!bp) return;
      const newBeat = xToBeat(x);
      const newValue = yToValue(y);
      onMoveBreakpoint(bp.at, newBeat, newValue);
    } else {
      // Hover detection
      const hitIdx = findBreakpointAtPoint(x, y);
      setHoverIndex(hitIdx);
    }
  }, [getSvgPoint, dragIndex, breakpoints, xToBeat, yToValue, onMoveBreakpoint, findBreakpointAtPoint]);

  const handleMouseUp = useCallback(() => {
    setDragIndex(null);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setDragIndex(null);
    setHoverIndex(null);
  }, []);

  // Prevent context menu on the SVG
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // Cycle interpolation on double-click
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const { x, y } = getSvgPoint(e);
    const hitIdx = findBreakpointAtPoint(x, y);
    if (hitIdx === null) return;

    const bp = breakpoints[hitIdx];
    const modes: Array<'step' | 'linear' | 'curve'> = ['step', 'linear', 'curve'];
    const currentIdx = modes.indexOf(bp.interpolation);
    const nextMode = modes[(currentIdx + 1) % modes.length];
    onUpdateInterpolation(bp.at, nextMode, nextMode === 'curve' ? 0 : undefined);
  }, [getSvgPoint, findBreakpointAtPoint, breakpoints, onUpdateInterpolation]);

  // Grid lines (beat markers)
  const gridLines = useMemo(() => {
    const lines: number[] = [];
    for (let beat = 0; beat <= duration; beat++) {
      lines.push(beat);
    }
    return lines;
  }, [duration]);

  // Value grid lines (0.25 increments)
  const valueGridLines = [0, 0.25, 0.5, 0.75, 1.0];

  // Playhead position
  const playheadX = currentStep !== undefined ? beatToX(currentStep % duration) : null;

  return (
    <div className="relative">
      {/* Label */}
      <div className="absolute top-0 left-0 z-10 px-1 py-0.5 text-[12px] font-medium tracking-wider uppercase text-zinc-500 select-none">
        {label}
      </div>

      <svg
        ref={svgRef}
        width="100%"
        height={height}
        className="block cursor-crosshair select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onContextMenu={handleContextMenu}
        onDoubleClick={handleDoubleClick}
      >
        {/* Background */}
        <rect x={0} y={0} width="100%" height={height} fill="transparent" />

        {/* Value grid lines */}
        {valueGridLines.map(v => (
          <line
            key={`vg-${v}`}
            x1={PADDING_LEFT}
            y1={valueToY(v)}
            x2={svgWidth - PADDING_RIGHT}
            y2={valueToY(v)}
            stroke="rgb(63 63 70)"
            strokeWidth={v === 0 || v === 1 ? 0.5 : 0.3}
            strokeDasharray={v === 0.5 ? undefined : '2,3'}
          />
        ))}

        {/* Beat grid lines */}
        {gridLines.map(beat => (
          <g key={`bg-${beat}`}>
            <line
              x1={beatToX(beat)}
              y1={PADDING_TOP}
              x2={beatToX(beat)}
              y2={height - PADDING_BOTTOM}
              stroke="rgb(63 63 70)"
              strokeWidth={beat % 4 === 0 ? 0.5 : 0.3}
            />
            <text
              x={beatToX(beat)}
              y={height - 2}
              textAnchor="middle"
              fill="rgb(113 113 122)"
              fontSize={8}
            >
              {beat}
            </text>
          </g>
        ))}

        {/* Y-axis value labels */}
        {[0, 0.5, 1].map(v => (
          <text
            key={`vl-${v}`}
            x={PADDING_LEFT - 4}
            y={valueToY(v) + 3}
            textAnchor="end"
            fill="rgb(113 113 122)"
            fontSize={8}
          >
            {v.toFixed(1)}
          </text>
        ))}

        {/* Interpolation curves */}
        {curvePath && (
          <path
            d={curvePath}
            fill="none"
            stroke="rgb(245 158 11)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Breakpoint dots */}
        {breakpoints.map((bp, idx) => {
          const cx = beatToX(bp.at);
          const cy = valueToY(bp.value);
          const isHovered = hoverIndex === idx;
          const isDragging = dragIndex === idx;
          const isActive = isHovered || isDragging;

          // Interpolation mode indicator shape
          const modeColor = bp.interpolation === 'step'
            ? 'rgb(161 161 170)' // zinc-400
            : bp.interpolation === 'curve'
              ? 'rgb(168 85 247)' // purple-400
              : 'rgb(245 158 11)'; // amber-500

          return (
            <g key={`bp-${idx}`}>
              {/* Hit area (invisible) */}
              <circle
                cx={cx}
                cy={cy}
                r={POINT_HIT_RADIUS}
                fill="transparent"
                style={{ cursor: 'grab' }}
              />
              {/* Visible dot */}
              <circle
                cx={cx}
                cy={cy}
                r={isActive ? POINT_RADIUS + 2 : POINT_RADIUS}
                fill={modeColor}
                stroke={isActive ? 'white' : 'rgb(39 39 42)'}
                strokeWidth={isActive ? 1.5 : 1}
                style={{ transition: 'r 0.1s' }}
              />
              {/* Value tooltip on hover */}
              {isActive && (
                <text
                  x={cx}
                  y={cy - POINT_RADIUS - 6}
                  textAnchor="middle"
                  fill="rgb(212 212 216)"
                  fontSize={9}
                  fontFamily="monospace"
                >
                  {bp.value.toFixed(2)}
                </text>
              )}
            </g>
          );
        })}

        {/* Playhead */}
        {playing && playheadX !== null && (
          <line
            x1={playheadX}
            y1={PADDING_TOP}
            x2={playheadX}
            y2={height - PADDING_BOTTOM}
            stroke="rgb(245 158 11 / 0.6)"
            strokeWidth={1}
          />
        )}
      </svg>
    </div>
  );
}
