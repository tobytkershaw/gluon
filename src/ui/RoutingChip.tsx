// src/ui/RoutingChip.tsx
// Shared routing chip for modulation route display.
// Configurable interactivity: read-only (ExpandedTrack/Surface) or
// editable with depth drag + remove button (RackView).
import type { ModulationRouting, Track, ModulationTarget } from '../engine/types';
import { getProcessorInstrument } from '../audio/instrument-registry';
import { DraggableNumber } from './DraggableNumber';

/** Human-readable label for a modulation target */
export function formatRoutingTarget(target: ModulationTarget, track: Track): string {
  if (target.kind === 'source') {
    return `Source / ${target.param.charAt(0).toUpperCase() + target.param.slice(1)}`;
  }
  const proc = (track.processors ?? []).find(p => p.id === target.processorId);
  const procLabel = proc ? getProcessorInstrument(proc.type)?.label ?? proc.type : target.processorId;
  return `${procLabel} / ${target.param.charAt(0).toUpperCase() + target.param.slice(1)}`;
}

interface RoutingChipProps {
  route: ModulationRouting;
  track: Track;
  /** When true, shows depth editing + remove button. When false, read-only display. */
  interactive?: boolean;
  onDepthChange?: (routeId: string, depth: number) => void;
  onDepthCommit?: (routeId: string, depth: number) => void;
  onRemove?: (routeId: string) => void;
}

export function RoutingChip({
  route, track, interactive,
  onDepthChange, onDepthCommit, onRemove,
}: RoutingChipProps) {
  const label = formatRoutingTarget(route.target, track);

  if (interactive) {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[8px] px-1.5 py-0.5 rounded bg-violet-400/10 border border-violet-400/20 text-violet-300"
      >
        <span className="opacity-60">{'\u2192'}</span>
        <span className="truncate max-w-[80px]">{label}</span>
        <DraggableNumber
          value={route.depth}
          min={-1}
          max={1}
          step={0.01}
          decimals={2}
          className="text-violet-200 hover:text-violet-100"
          onChange={(depth) => onDepthChange?.(route.id, depth)}
          onCommit={(depth) => onDepthCommit?.(route.id, depth)}
        />
        <button
          type="button"
          onClick={() => onRemove?.(route.id)}
          className="ml-0.5 text-violet-400/40 hover:text-red-400 transition-colors leading-none"
          title="Remove route"
        >
          {'\u00d7'}
        </button>
      </span>
    );
  }

  // Read-only chip
  return (
    <span
      className="text-[9px] px-2 py-0.5 rounded bg-violet-400/10 border border-violet-400/20 text-violet-300"
    >
      {'\u2192'} {label} ({route.depth > 0 ? '+' : ''}{route.depth.toFixed(2)})
    </span>
  );
}

interface RoutingChipsProps {
  routings: ModulationRouting[];
  track: Track;
  interactive?: boolean;
  onDepthChange?: (routeId: string, depth: number) => void;
  onDepthCommit?: (routeId: string, depth: number) => void;
  onRemove?: (routeId: string) => void;
  /** Navigation link (e.g. "Edit routes in Patch") — only shown when interactive */
  onNavigateToPatch?: () => void;
}

/** Container for a set of routing chips with optional "Edit in Patch" link */
export function RoutingChips({
  routings, track, interactive,
  onDepthChange, onDepthCommit, onRemove,
  onNavigateToPatch,
}: RoutingChipsProps) {
  if (routings.length === 0) return null;

  if (interactive) {
    return (
      <div className="border-t border-zinc-800/40 pt-2 mt-auto">
        <div className="rounded bg-violet-400/5 border border-violet-400/10 p-1.5">
          <div className="text-[7px] font-mono uppercase tracking-widest text-violet-400/40 mb-1 px-0.5">
            Routes
          </div>
          <div className="flex flex-wrap gap-1">
            {routings.map(r => (
              <RoutingChip
                key={r.id}
                route={r}
                track={track}
                interactive
                onDepthChange={onDepthChange}
                onDepthCommit={onDepthCommit}
                onRemove={onRemove}
              />
            ))}
          </div>
          {onNavigateToPatch && (
            <button
              type="button"
              onClick={onNavigateToPatch}
              className="mt-1.5 text-[8px] font-mono uppercase tracking-wider text-violet-400/50 hover:text-violet-400 transition-colors"
            >
              Edit routes in Patch
            </button>
          )}
        </div>
      </div>
    );
  }

  // Read-only layout
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5 px-1">
      {routings.map(r => (
        <RoutingChip
          key={r.id}
          route={r}
          track={track}
        />
      ))}
    </div>
  );
}
