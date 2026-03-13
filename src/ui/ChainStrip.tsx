// src/ui/ChainStrip.tsx
// Chain strip: shows source + processor badges with arrows. Processor badges are clickable.
import type { Voice } from '../engine/types';
import { getModelName, getProcessorInstrument, getModulatorInstrument } from '../audio/instrument-registry';

interface Props {
  voice: Voice;
  selectedProcessorId?: string | null;
  selectedModulatorId?: string | null;
  onSelectProcessor?: (processorId: string | null) => void;
  onSelectModulator?: (modulatorId: string | null) => void;
  onNodeClick?: (moduleId: string) => void;
}

function getProcessorLabel(type: string, modelIndex: number): string {
  const inst = getProcessorInstrument(type);
  if (!inst) return type;
  const engine = inst.engines[modelIndex];
  return engine ? `${inst.label}: ${engine.label}` : inst.label;
}

function getModulatorLabel(type: string, modelIndex: number): string {
  const inst = getModulatorInstrument(type);
  if (!inst) return type;
  const engine = inst.engines[modelIndex];
  return engine ? `${engine.label}` : inst.label;
}

function ChevronButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="ml-1 text-zinc-600 hover:text-zinc-300 transition-colors"
    >
      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 10 10">
        <path d="M3 2L7 5L3 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export function ChainStrip({ voice, selectedProcessorId, selectedModulatorId, onSelectProcessor, onSelectModulator, onNodeClick }: Props) {
  const processors = voice.processors ?? [];
  const modulators = voice.modulators ?? [];
  const sourceLabel = getModelName(voice.model);

  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      {/* Source badge */}
      <span className="flex items-center px-2 py-0.5 rounded bg-amber-400/10 border border-amber-400/20 text-amber-300 font-medium truncate max-w-[140px]">
        {sourceLabel}
        {onNodeClick && (
          <ChevronButton onClick={() => onNodeClick('source')} />
        )}
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
              className={`flex items-center px-2 py-0.5 rounded font-medium truncate max-w-[180px] transition-colors ${
                isSelected
                  ? 'bg-sky-400/20 border border-sky-400/40 text-sky-200'
                  : 'bg-sky-400/10 border border-sky-400/20 text-sky-300 hover:bg-sky-400/15 hover:border-sky-400/30'
              }`}
            >
              {getProcessorLabel(proc.type, proc.model)}
              {onNodeClick && (
                <ChevronButton onClick={() => onNodeClick(proc.id)} />
              )}
            </button>
          </div>
        );
      })}

      {/* Modulator badges (visually separated) */}
      {modulators.length > 0 && (
        <span className="mx-1 text-zinc-700">|</span>
      )}

      {modulators.map((mod) => {
        const isSelected = selectedModulatorId === mod.id;
        return (
          <button
            key={mod.id}
            onClick={() => onSelectModulator?.(isSelected ? null : mod.id)}
            className={`flex items-center px-2 py-0.5 rounded font-medium truncate max-w-[140px] transition-colors ${
              isSelected
                ? 'bg-violet-400/20 border border-violet-400/40 text-violet-200'
                : 'bg-violet-400/10 border border-violet-400/20 text-violet-300 hover:bg-violet-400/15 hover:border-violet-400/30'
            }`}
          >
            {getModulatorLabel(mod.type, mod.model)}
          </button>
        );
      })}
    </div>
  );
}
