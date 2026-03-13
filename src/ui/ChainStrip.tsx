// src/ui/ChainStrip.tsx
// Chain strip: shows source + processor badges with arrows. Processor badges are clickable.
import type { Voice } from '../engine/types';
import { getModelName, getProcessorInstrument } from '../audio/instrument-registry';

interface Props {
  voice: Voice;
  selectedProcessorId?: string | null;
  onSelectProcessor?: (processorId: string | null) => void;
}

function getProcessorLabel(type: string, modelIndex: number): string {
  const inst = getProcessorInstrument(type);
  if (!inst) return type;
  const engine = inst.engines[modelIndex];
  return engine ? `${inst.label}: ${engine.label}` : inst.label;
}

export function ChainStrip({ voice, selectedProcessorId, onSelectProcessor }: Props) {
  const processors = voice.processors ?? [];
  const sourceLabel = getModelName(voice.model);

  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      {/* Source badge */}
      <span className="px-2 py-0.5 rounded bg-amber-400/10 border border-amber-400/20 text-amber-300 font-medium truncate max-w-[140px]">
        {sourceLabel}
      </span>

      {processors.map((proc) => {
        const isSelected = selectedProcessorId === proc.id;
        return (
          <div key={proc.id} className="flex items-center gap-1.5">
            <svg className="w-3 h-3 text-zinc-600 flex-shrink-0" viewBox="0 0 12 12" fill="none">
              <path d="M2 6H10M7.5 3.5L10 6L7.5 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <button
              onClick={() => onSelectProcessor?.(isSelected ? null : proc.id)}
              className={`px-2 py-0.5 rounded font-medium truncate max-w-[180px] transition-colors ${
                isSelected
                  ? 'bg-sky-400/20 border border-sky-400/40 text-sky-200'
                  : 'bg-sky-400/10 border border-sky-400/20 text-sky-300 hover:bg-sky-400/15 hover:border-sky-400/30'
              }`}
            >
              {getProcessorLabel(proc.type, proc.model)}
            </button>
          </div>
        );
      })}
    </div>
  );
}
