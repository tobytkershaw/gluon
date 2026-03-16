// src/ui/TrackerView.tsx
// Thin shell: full-height Tracker (top bar moved to AppShell)
import type { MutableRefObject } from 'react';
import type { Session, Track } from '../engine/types';
import type { MusicalEvent } from '../engine/canonical-types';
import type { EventSelector } from '../engine/event-primitives';
import { getModelName } from '../audio/instrument-registry';
import { getTrackLabel } from '../engine/track-labels';
import { Tracker } from './Tracker';
import { TrackerCheatSheet } from './TrackerCheatSheet';

interface Props {
  session: Session;
  activeTrack: Track;
  // Transport (position only)
  playing: boolean;
  globalStep: number;
  // Tracker editing
  onEventUpdate: (selector: EventSelector, updates: Partial<MusicalEvent>) => void;
  onEventDelete: (selector: EventSelector) => void;
  onEventAdd: (step: number, event: MusicalEvent) => void;
  /** Quantize all events in the active region to the nearest grid position. */
  onQuantize?: () => void;
  /** When true, in-progress inline edits should be discarded on blur. */
  cancelEditRef?: MutableRefObject<boolean>;
}

export function TrackerView({
  session, activeTrack,
  playing, globalStep,
  onEventUpdate, onEventDelete, onEventAdd,
  onQuantize,
  cancelEditRef,
}: Props) {
  const currentStep = Math.floor(globalStep % activeTrack.pattern.length);
  const hasEvents = activeTrack.regions.length > 0 && activeTrack.regions[0].events.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Main content */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 flex flex-col gap-3 p-4">
          {/* Track header */}
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-medium tracking-wider uppercase text-zinc-300">
              {getTrackLabel(activeTrack)}
            </span>
            <span className="text-[10px] text-zinc-500">
              {getModelName(activeTrack.model)}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {onQuantize && hasEvents && (
                <button
                  className="px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
                  onClick={onQuantize}
                  title="Snap all events to the nearest grid position (undoable)"
                >
                  Quantize
                </button>
              )}
              <TrackerCheatSheet />
            </div>
          </div>

          {/* Full-height tracker scroll container */}
          <div className="flex-1 min-h-0 overflow-y-auto rounded border border-zinc-800/50 bg-zinc-900/40">
            {activeTrack.regions.length > 0 ? (
              <Tracker
                region={activeTrack.regions[0]}
                currentStep={currentStep}
                playing={playing}
                onUpdate={onEventUpdate}
                onDelete={onEventDelete}
                onAddEvent={onEventAdd}
                cancelEditRef={cancelEditRef}
              />
            ) : (
              <div className="px-4 py-8 text-center text-[10px] text-zinc-600 italic">
                No regions
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
