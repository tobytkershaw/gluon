// src/ui/StepGrid.tsx
import type { StepGrid as StepGridType } from '../engine/sequencer-types';

interface Props {
  pattern: StepGridType;
  currentStep: number;
  playing: boolean;
  page: number;
  selectedStep: number | null;
  onToggleGate: (stepIndex: number) => void;
  onToggleAccent: (stepIndex: number) => void;
  onStepSelect: (stepIndex: number | null) => void;
}

const STEPS_PER_PAGE = 16;

export function StepGrid({
  pattern, currentStep, playing, page, selectedStep,
  onToggleGate, onToggleAccent, onStepSelect,
}: Props) {
  const startIndex = page * STEPS_PER_PAGE;
  const endIndex = Math.min(startIndex + STEPS_PER_PAGE, pattern.length);
  const visibleSteps = pattern.steps.slice(startIndex, endIndex);

  return (
    <div className="flex gap-1">
      {visibleSteps.map((step, i) => {
        const globalIndex = startIndex + i;
        const isPlayhead = playing && currentStep === globalIndex;
        const isActive = globalIndex < pattern.length;
        const hasLock = step.params !== undefined;
        const isSelected = selectedStep === globalIndex;

        return (
          <button
            key={globalIndex}
            onClick={() => onToggleGate(globalIndex)}
            onContextMenu={(e) => { e.preventDefault(); onToggleAccent(globalIndex); }}
            onPointerDown={(e) => {
              // Middle-click or shift+click to toggle step lock selection
              if (e.shiftKey || e.button === 1) {
                e.preventDefault();
                onStepSelect(isSelected ? null : globalIndex);
              }
            }}
            className={`
              relative w-10 h-12 rounded transition-all flex-shrink-0
              ${!isActive ? 'opacity-30 pointer-events-none' : ''}
              ${isSelected ? 'ring-2 ring-blue-400/80' : ''}
              ${isPlayhead && !isSelected ? 'ring-1 ring-amber-400/60' : ''}
              ${step.gate
                ? step.accent
                  ? 'bg-amber-500/70 border border-amber-400/60'
                  : 'bg-amber-500/30 border border-amber-500/30'
                : 'bg-zinc-800/60 border border-zinc-700/40 hover:border-zinc-600'
              }
            `}
          >
            {/* Beat marker: thicker left border on beat boundaries (every 4 steps) */}
            {globalIndex % 4 === 0 && (
              <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-zinc-600/40 rounded-l" />
            )}

            {/* Param lock indicator */}
            {hasLock && (
              <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-blue-400/60" />
            )}

            {/* Step number (1-based) */}
            <span className="text-[9px] text-zinc-600 absolute top-0.5 left-1">
              {globalIndex + 1}
            </span>
          </button>
        );
      })}
    </div>
  );
}
