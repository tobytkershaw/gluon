// src/ui/Tracker.tsx
import { useRef, useEffect, useMemo, type MutableRefObject } from 'react';
import type { Region, MusicalEvent, ParameterEvent } from '../engine/canonical-types';
import type { EventSelector } from '../engine/event-primitives';
import { TrackerRow, type AvailableControl } from './TrackerRow';
import { getEngineByIndex, getProcessorInstrument } from '../audio/instrument-registry';
import type { ProcessorConfig } from '../engine/types';

interface Props {
  region: Region;
  currentStep: number;
  playing: boolean;
  /** Engine model index for the track (used to derive available controls). */
  engineModel?: number;
  /** Processor chain for the track (used to derive processor controls). */
  processors?: ProcessorConfig[];
  onUpdate?: (selector: EventSelector, updates: Partial<MusicalEvent>) => void;
  onDelete?: (selector: EventSelector) => void;
  /** Callback to add a new parameter event (for empty FX cell picker). */
  onAddParamEvent?: (at: number, controlId: string, value: number) => void;
  /** Callback to add a note event at a given step. */
  onAddNote?: (step: number) => void;
  /** When true, in-progress inline edits should be discarded on blur. */
  cancelEditRef?: MutableRefObject<boolean>;
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

/**
 * Compute available controls from the engine model and processor chain.
 */
function computeAvailableControls(
  engineModel?: number,
  processors?: ProcessorConfig[],
): AvailableControl[] {
  const controls: AvailableControl[] = [];

  // Source engine controls (Plaits default: brightness, richness, texture, pitch)
  if (engineModel !== undefined) {
    const engine = getEngineByIndex(engineModel);
    if (engine) {
      for (const ctrl of engine.controls) {
        controls.push({ id: ctrl.id, label: ctrl.name });
      }
    }
  }

  // Processor controls
  if (processors) {
    for (const proc of processors) {
      const inst = getProcessorInstrument(proc.type);
      if (inst && inst.engines.length > 0) {
        // Use the processor's current engine mode
        const engine = inst.engines[proc.model] ?? inst.engines[0];
        for (const ctrl of engine.controls) {
          controls.push({
            id: `${proc.type}.${ctrl.id}`,
            label: `${proc.type}:${ctrl.name}`,
          });
        }
      }
    }
  }

  return controls;
}

export function Tracker({ region, currentStep, playing, engineModel, processors, onUpdate, onDelete, onAddParamEvent, onAddNote, cancelEditRef }: Props) {
  const playheadRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    if (playing && playheadRef.current) {
      playheadRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentStep, playing]);

  const events = region.events;
  const playheadAt = currentStep % region.duration;

  // Compute next available step for the add button
  const nextStep = useMemo(() => {
    if (events.length === 0) return 0;
    const lastAt = events[events.length - 1].at;
    return Math.floor(lastAt) + 1;
  }, [events]);

  const availableControls = useMemo(
    () => computeAvailableControls(engineModel, processors),
    [engineModel, processors],
  );

  return (
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
            onAddNote ? (
              <tr>
                <td colSpan={5} className="px-4 py-3 text-center">
                  <button
                    className="text-[10px] text-zinc-500 hover:text-amber-400 transition-colors"
                    onClick={() => onAddNote(0)}
                    title="Add note at step 0"
                  >
                    + add note
                  </button>
                </td>
              </tr>
            ) : (
              <tr>
                <td colSpan={5} className="px-4 py-3 text-center text-[10px] text-zinc-600 italic">
                  ---
                </td>
              </tr>
            )
          ) : (
            <>
              {events.map((event, i) => {
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
                    availableControls={availableControls}
                    onAddParamEvent={onAddParamEvent}
                    cancelEditRef={cancelEditRef}
                    ref={isAtPlayhead ? playheadRef : undefined}
                  />
                );
              })}
              {onAddNote && (
                <tr>
                  <td colSpan={5} className="px-4 py-1.5 text-center">
                    <button
                      className="text-[10px] text-zinc-600 hover:text-amber-400 transition-colors"
                      onClick={() => onAddNote(nextStep)}
                      title={`Add note at step ${nextStep}`}
                    >
                      + add note
                    </button>
                  </td>
                </tr>
              )}
            </>
          )}
        </tbody>
      </table>
  );
}
