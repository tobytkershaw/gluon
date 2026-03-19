// src/ui/DrumLaneTracker.tsx
// Lane-based tracker view for drum rack tracks.
// Renders one column per pad, one row per step, bypassing the standard
// slot grid and projecting directly from canonical TriggerEvents grouped by padId.

import { useMemo } from 'react';
import type { Pattern, TriggerEvent } from '../engine/canonical-types';
import type { DrumPad } from '../engine/types';
import { velocityToGridChar } from '../engine/drum-grid';

interface Props {
  region: Pattern;
  pads: DrumPad[];
  /** Current playhead step (integer), or null when in a different pattern. */
  playheadStep: number | null;
  playing: boolean;
  /** Steps per beat for beat separator lines. Default: 4. */
  stepsPerBeat?: number;
}

/** Map triggers into a 2D lookup: step -> padId -> TriggerEvent */
function buildDrumGrid(
  events: TriggerEvent[],
  padIds: string[],
  stepCount: number,
): Map<number, Map<string, TriggerEvent>> {
  const grid = new Map<number, Map<string, TriggerEvent>>();
  const padSet = new Set(padIds);

  for (const event of events) {
    if (!event.padId || !padSet.has(event.padId)) continue;
    const step = Math.floor(event.at);
    if (step < 0 || step >= stepCount) continue;

    let row = grid.get(step);
    if (!row) {
      row = new Map();
      grid.set(step, row);
    }
    row.set(event.padId, event);
  }

  return grid;
}

/**
 * DrumLaneTracker — read-only lane-based tracker for drum rack tracks.
 *
 * Columns: Step | Pad1 | Pad2 | ... | PadN
 * Each cell shows the grid character for the trigger at that step+pad,
 * colour-coded by velocity.
 */
export function DrumLaneTracker({
  region,
  pads,
  playheadStep,
  playing,
  stepsPerBeat = 4,
}: Props) {
  const stepCount = Math.max(1, Math.floor(region.duration));
  const padIds = useMemo(() => pads.map(p => p.id), [pads]);

  // Extract only trigger events
  const triggerEvents = useMemo(
    () => region.events.filter((e): e is TriggerEvent => e.kind === 'trigger'),
    [region.events],
  );

  const grid = useMemo(
    () => buildDrumGrid(triggerEvents, padIds, stepCount),
    [triggerEvents, padIds, stepCount],
  );

  const playheadAt = playheadStep !== null ? playheadStep % region.duration : null;

  if (pads.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-[11px] text-zinc-600 italic">
        No drum pads configured
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse select-none font-mono">
        <thead>
          <tr className="text-[10px] text-zinc-600 uppercase tracking-wider sticky top-0 bg-zinc-900/95 backdrop-blur-sm border-b border-zinc-800/50">
            <th className="px-1.5 py-1 text-left w-8">Pos</th>
            {pads.map((pad) => (
              <th
                key={pad.id}
                className="px-1 py-1 text-center min-w-[2rem]"
                title={pad.name}
              >
                {abbreviatePadName(pad.name)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: stepCount }, (_, step) => {
            const isAtPlayhead = playing && playheadAt !== null && Math.floor(playheadAt) === step;
            const isBeatBoundary = step > 0 && step % stepsPerBeat === 0;
            const beatIndex = Math.floor(step / stepsPerBeat);
            const isOddBeat = beatIndex % 2 === 1;
            const row = grid.get(step);

            return (
              <tr
                key={step}
                className={`text-[11px] leading-tight transition-colors ${
                  isAtPlayhead
                    ? 'bg-amber-500/15'
                    : isOddBeat
                      ? 'bg-zinc-800/20'
                      : ''
                } ${isBeatBoundary ? 'border-t border-zinc-700/40' : ''}`}
              >
                {/* Step number */}
                <td className="px-1.5 py-0.5 text-zinc-600 tabular-nums text-right">
                  {String(step).padStart(2, '0')}
                </td>
                {/* Pad cells */}
                {padIds.map((padId) => {
                  const trigger = row?.get(padId);
                  const char = trigger ? velocityToGridChar(trigger.velocity ?? 0.75) : '.';
                  const hasHit = trigger !== undefined && (trigger.velocity ?? 0.75) > 0;

                  return (
                    <td
                      key={padId}
                      className="px-1 py-0.5 text-center tabular-nums"
                      style={{
                        color: hasHit ? velocityColor(trigger!.velocity ?? 0.75) : 'rgb(63,63,70)',
                      }}
                    >
                      {char}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Abbreviate pad names for column headers (max 3-4 chars). */
function abbreviatePadName(name: string): string {
  const abbrevs: Record<string, string> = {
    'Kick': 'KCK',
    'Snare': 'SNR',
    'Closed Hat': 'CHH',
    'Open Hat': 'OHH',
    'Hi-Hat': 'HH',
    'Clap': 'CLP',
    'Rim': 'RIM',
    'Tom': 'TOM',
    'Low Tom': 'LTM',
    'Mid Tom': 'MTM',
    'High Tom': 'HTM',
    'Crash': 'CRS',
    'Ride': 'RDE',
    'Cowbell': 'COW',
    'Perc': 'PRC',
    'Shaker': 'SHK',
  };
  return abbrevs[name] ?? name.slice(0, 3).toUpperCase();
}

/** Map velocity to a colour from dim to bright. */
function velocityColor(velocity: number): string {
  if (velocity >= 0.9) return 'rgb(251,191,36)';  // amber-400 — accent
  if (velocity >= 0.75) return 'rgb(212,212,216)'; // zinc-300 — normal
  if (velocity >= 0.5) return 'rgb(161,161,170)';  // zinc-400 — soft
  return 'rgb(113,113,122)';                        // zinc-500 — ghost
}
