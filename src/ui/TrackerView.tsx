// src/ui/TrackerView.tsx
// Thin shell: full-height Tracker (top bar moved to AppShell)
import type { MutableRefObject } from 'react';
import type { Session, Voice } from '../engine/types';
import type { MusicalEvent } from '../engine/canonical-types';
import type { EventSelector } from '../engine/event-primitives';
import { getModelName } from '../audio/instrument-registry';
import { getVoiceLabel } from '../engine/voice-labels';
import { Tracker } from './Tracker';
import { TrackerCheatSheet } from './TrackerCheatSheet';

interface Props {
  session: Session;
  activeVoice: Voice;
  // Transport (position only)
  playing: boolean;
  globalStep: number;
  // Tracker editing
  onEventUpdate: (selector: EventSelector, updates: Partial<MusicalEvent>) => void;
  onEventDelete: (selector: EventSelector) => void;
  /** When true, in-progress inline edits should be discarded on blur. */
  cancelEditRef?: MutableRefObject<boolean>;
}

export function TrackerView({
  session, activeVoice,
  playing, globalStep,
  onEventUpdate, onEventDelete,
  cancelEditRef,
}: Props) {
  const currentStep = Math.floor(globalStep % activeVoice.pattern.length);

  return (
    <div className="flex flex-col h-full">
      {/* Main content */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 flex flex-col gap-3 p-4">
          {/* Voice header */}
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-medium tracking-wider uppercase text-zinc-300">
              {getVoiceLabel(activeVoice)}
            </span>
            <span className="text-[10px] text-zinc-500">
              {getModelName(activeVoice.model)}
            </span>
            <div className="ml-auto">
              <TrackerCheatSheet />
            </div>
          </div>

          {/* Full-height tracker scroll container */}
          <div className="flex-1 min-h-0 overflow-y-auto rounded border border-zinc-800/50 bg-zinc-900/40">
            {activeVoice.regions.length > 0 ? (
              <Tracker
                region={activeVoice.regions[0]}
                currentStep={currentStep}
                playing={playing}
                onUpdate={onEventUpdate}
                onDelete={onEventDelete}
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
