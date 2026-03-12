// src/ui/Tracker.tsx
import { useRef, useEffect } from 'react';
import type { Region, MusicalEvent, ParameterEvent } from '../engine/canonical-types';
import type { EventSelector } from '../engine/event-primitives';
import { TrackerRow } from './TrackerRow';

interface Props {
  region: Region;
  currentStep: number;
  playing: boolean;
  onUpdate?: (selector: EventSelector, updates: Partial<MusicalEvent>) => void;
  onDelete?: (selector: EventSelector) => void;
}

/**
 * Show a beat separator when crossing a beat boundary (every 4 steps).
 */
function shouldShowBeatSeparator(event: MusicalEvent, prevEvent: MusicalEvent | null): boolean {
  if (!prevEvent) return false;
  return Math.floor(event.at / 4) > Math.floor(prevEvent.at / 4);
}

/**
 * Stable key for an event row. Uses the canonical dedup invariants:
 * - triggers: unique per position
 * - notes: unique per position (monophonic)
 * - parameters: unique per (position, controlId)
 */
function eventKey(event: MusicalEvent, index: number): string {
  if (event.kind === 'parameter') {
    return `P-${event.at}-${(event as ParameterEvent).controlId}`;
  }
  return `${event.kind[0].toUpperCase()}-${event.at}-${index}`;
}

export function Tracker({ region, currentStep, playing, onUpdate, onDelete }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    if (playing && playheadRef.current && scrollRef.current) {
      playheadRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentStep, playing]);

  const events = region.events;
  const playheadAt = currentStep % region.duration;

  return (
    <div
      ref={scrollRef}
      className="overflow-y-auto max-h-52 rounded border border-zinc-800/50 bg-zinc-900/40"
    >
      <table className="w-full border-collapse select-none">
        <thead>
          <tr className="text-[9px] text-zinc-600 uppercase tracking-widest sticky top-0 bg-zinc-900/95 backdrop-blur-sm border-b border-zinc-800/50">
            <th className="px-1.5 py-1 text-right w-[3.5rem]">Pos</th>
            <th className="px-1 py-1 text-center w-6"></th>
            <th className="px-1.5 py-1 text-left w-[3.5rem]">Note</th>
            <th className="px-1.5 py-1 text-right w-12">Val</th>
            <th className="px-1.5 py-1 text-right w-12">Dur</th>
          </tr>
        </thead>
        <tbody>
          {events.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-3 text-center text-[10px] text-zinc-600 italic">
                ---
              </td>
            </tr>
          ) : (
            events.map((event, i) => {
              const nextAt = i < events.length - 1 ? events[i + 1].at : region.duration;
              const isAtPlayhead = playing && playheadAt >= event.at && playheadAt < nextAt;

              return (
                <TrackerRow
                  key={eventKey(event, i)}
                  event={event}
                  isAtPlayhead={isAtPlayhead}
                  showBeatSeparator={shouldShowBeatSeparator(event, i > 0 ? events[i - 1] : null)}
                  onUpdate={onUpdate}
                  onDelete={onDelete}
                  ref={isAtPlayhead ? playheadRef : undefined}
                />
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
