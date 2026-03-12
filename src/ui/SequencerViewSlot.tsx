// src/ui/SequencerViewSlot.tsx
import type { SequencerViewConfig } from '../engine/types';
import type { Pattern } from '../engine/sequencer-types';
import { StepGrid } from './StepGrid';
import { PatternControls } from './PatternControls';

interface Props {
  config: SequencerViewConfig;
  onRemove: (viewId: string) => void;
  // Step grid props (passed through when kind === 'step-grid')
  pattern: Pattern;
  currentStep: number;
  playing: boolean;
  stepPage: number;
  selectedStep: number | null;
  onStepToggle: (stepIndex: number) => void;
  onStepAccent: (stepIndex: number) => void;
  onStepSelect: (stepIndex: number | null) => void;
  onPatternLength: (length: number) => void;
  onPageChange: (page: number) => void;
  onClearPattern: () => void;
}

const VIEW_LABELS: Record<string, string> = {
  'step-grid': 'Step Grid',
  'piano-roll': 'Piano Roll',
};

export function SequencerViewSlot({
  config, onRemove,
  pattern, currentStep, playing,
  stepPage, selectedStep,
  onStepToggle, onStepAccent, onStepSelect,
  onPatternLength, onPageChange, onClearPattern,
}: Props) {
  const totalPages = Math.ceil(pattern.length / 16);

  return (
    <div className="relative group/view">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] text-zinc-600 uppercase tracking-widest">
          {VIEW_LABELS[config.kind] ?? config.kind}
        </span>
        <button
          className="text-zinc-700 hover:text-red-400 text-[10px] opacity-0 group-hover/view:opacity-100 transition-opacity"
          onClick={() => onRemove(config.id)}
          title="Remove view"
        >
          remove
        </button>
      </div>

      {config.kind === 'step-grid' && (
        <div className="flex items-center gap-3">
          <StepGrid
            pattern={pattern}
            currentStep={currentStep}
            playing={playing}
            page={stepPage}
            onToggleGate={onStepToggle}
            onToggleAccent={onStepAccent}
            selectedStep={selectedStep}
            onStepSelect={onStepSelect}
          />
          <PatternControls
            patternLength={pattern.length}
            totalPages={totalPages}
            currentPage={stepPage}
            onLengthChange={onPatternLength}
            onPageChange={onPageChange}
            onClear={onClearPattern}
          />
        </div>
      )}

      {config.kind === 'piano-roll' && (
        <div className="px-4 py-3 text-center text-[10px] text-zinc-600 italic border border-zinc-800/50 rounded">
          Piano roll — coming soon
        </div>
      )}
    </div>
  );
}
