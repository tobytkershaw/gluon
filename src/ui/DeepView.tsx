// src/ui/DeepView.tsx
// Layer 3: read-only per-module inspector showing current values and provenance.
import type { Track } from '../engine/types';
import { getEngineByIndex, getProcessorInstrument, controlIdToRuntimeParam } from '../audio/instrument-registry';
import { getModelName } from '../audio/instrument-registry';

interface DeepViewProps {
  track: Track;
  focusedModuleId: string | null; // null = show all modules, 'source' = source only, processor ID = specific processor
  onClose: () => void;
}

type Provenance = 'default' | 'human' | 'ai';

const PROVENANCE_STYLE: Record<Provenance, string> = {
  default: 'text-zinc-600',
  human: 'text-amber-400',
  ai: 'text-teal-400',
};

function getSourceProvenance(track: Track, controlId: string): Provenance {
  const entry = track.controlProvenance?.[controlId];
  if (!entry) return 'default';
  return (entry.source as Provenance) ?? 'default';
}

export function DeepView({ track, focusedModuleId, onClose }: DeepViewProps) {
  const showSource = focusedModuleId === null || focusedModuleId === 'source';
  const processors = track.processors ?? [];
  const sourceEngine = getEngineByIndex(track.model);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-lg p-3 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium tracking-wider uppercase text-zinc-400">
          {focusedModuleId === null
            ? 'DEEP VIEW'
            : focusedModuleId === 'source'
            ? `Plaits — ${getModelName(track.model)}`
            : (() => {
                const proc = processors.find(p => p.id === focusedModuleId);
                if (!proc) return 'DEEP VIEW';
                const inst = getProcessorInstrument(proc.type);
                const eng = inst?.engines[proc.model];
                return `${inst?.label ?? proc.type} — ${eng?.label ?? ''}`;
              })()
          }
        </span>
        <button
          onClick={onClose}
          className="text-zinc-600 hover:text-zinc-300 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16">
            <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Source module */}
      {showSource && sourceEngine && (
        <ModuleBlock
          label={`Plaits — ${getModelName(track.model)}`}
          accentColor="amber"
        >
          {sourceEngine.controls.map(control => {
            const runtimeParam = controlIdToRuntimeParam[control.id] ?? control.id;
            const value = track.params[runtimeParam] ?? control.range?.default ?? 0.5;
            const provenance = getSourceProvenance(track, control.id);
            return (
              <ControlRow
                key={control.id}
                name={control.name}
                value={value}
                provenance={provenance}
              />
            );
          })}
        </ModuleBlock>
      )}

      {/* Processor modules */}
      {processors.map(proc => {
        if (focusedModuleId !== null && focusedModuleId !== proc.id) return null;
        const inst = getProcessorInstrument(proc.type);
        if (!inst) return null;
        const engine = inst.engines[proc.model] ?? inst.engines[0];
        if (!engine) return null;
        const label = `${inst.label} — ${engine.label}`;

        return (
          <ModuleBlock key={proc.id} label={label} accentColor="sky">
            {engine.controls.map(control => (
              <ControlRow
                key={control.id}
                name={control.name}
                value={proc.params[control.id] ?? control.range?.default ?? 0.5}
              />
            ))}
          </ModuleBlock>
        );
      })}
    </div>
  );
}

function ModuleBlock({ label, accentColor, children }: {
  label: string;
  accentColor: 'amber' | 'sky';
  children: React.ReactNode;
}) {
  const headerColor = accentColor === 'amber' ? 'text-amber-300' : 'text-sky-300';
  return (
    <div className="space-y-1.5">
      <div className={`text-[10px] font-medium ${headerColor}`}>{label}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function ControlRow({ name, value, provenance }: {
  name: string;
  value: number;
  provenance?: Provenance;
}) {
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="text-zinc-500 w-20 truncate">{name}</span>
      <span className="text-zinc-300 font-mono w-10 text-right">{value.toFixed(2)}</span>
      {provenance && (
        <span className={`uppercase text-[8px] tracking-wider ${PROVENANCE_STYLE[provenance]}`}>
          {provenance}
        </span>
      )}
    </div>
  );
}
