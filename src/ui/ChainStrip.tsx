// src/ui/ChainStrip.tsx
// Chain strip: shows source + processor badges with arrows. Processor badges are clickable.
import type { Track } from '../engine/types';
import { getModelName, getProcessorInstrument, getModulatorInstrument } from '../audio/instrument-registry';

interface Props {
  track: Track;
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
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onClick(); } }}
      className="ml-1 text-zinc-600 hover:text-zinc-300 transition-colors"
    >
      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 10 10">
        <path d="M3 2L7 5L3 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function ChainStrip({ track, selectedProcessorId, selectedModulatorId, onSelectProcessor, onSelectModulator, onNodeClick }: Props) {
  const processors = track.processors ?? [];
  const modulators = track.modulators ?? [];
  const sourceLabel = getModelName(track.model);

  return (
    <div className="flex items-center gap-2 py-2 px-4 border-b"
      style={{ background: 'var(--bg-surface, #1c1917)', borderColor: 'rgba(61,57,53,0.6)' }}
    >
      {/* Source badge */}
      <span
        className="flex items-center gap-1 px-2.5 py-0.5 rounded font-mono text-[10px] font-medium cursor-pointer truncate max-w-[140px]"
        style={{
          background: 'rgba(251,191,36,0.1)',
          color: '#fbbf24',
          border: '1px solid rgba(251,191,36,0.2)',
        }}
      >
        {sourceLabel}
        {onNodeClick && (
          <ChevronButton onClick={() => onNodeClick('source')} />
        )}
      </span>

      {processors.map((proc) => {
        const isSelected = selectedProcessorId === proc.id;
        return (
          <div key={proc.id} className="flex items-center gap-2">
            <span className="text-[10px]" style={{ color: 'var(--text-faint, #57534e)' }}>{'\u2192'}</span>
            <button
              onClick={() => onSelectProcessor?.(isSelected ? null : proc.id)}
              className={`flex items-center gap-1 px-2.5 py-0.5 rounded font-mono text-[10px] font-medium truncate max-w-[180px] transition-colors ${
                proc.enabled === false ? 'opacity-40 line-through' : ''
              }`}
              style={{
                background: isSelected ? 'rgba(56,189,248,0.2)' : 'rgba(56,189,248,0.08)',
                color: isSelected ? '#bae6fd' : '#38bdf8',
                border: isSelected ? '2px solid rgba(56,189,248,0.4)' : '1px solid rgba(56,189,248,0.15)',
              }}
            >
              {getProcessorLabel(proc.type, proc.model)}
              {onNodeClick && (
                <ChevronButton onClick={() => onNodeClick(proc.id)} />
              )}
            </button>
          </div>
        );
      })}

      {/* Output badge */}
      <span className="text-[10px]" style={{ color: 'var(--text-faint, #57534e)' }}>{'\u2192'}</span>
      <span
        className="px-2.5 py-0.5 rounded font-mono text-[10px] font-medium"
        style={{
          background: 'var(--bg-raised, #282523)',
          color: 'var(--text-muted, #7c776e)',
          border: '1px solid rgba(61,57,53,0.3)',
        }}
      >
        Output
      </span>

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
            className={`flex items-center px-2.5 py-0.5 rounded font-mono text-[10px] font-medium truncate max-w-[140px] transition-colors ${
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
