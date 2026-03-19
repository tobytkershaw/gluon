// src/ui/ModuleBrowser.tsx
// Slide-out panel for browsing and adding modules to tracks.
import { useEffect, useRef } from 'react';
import type { Track } from '../engine/types';
import {
  getRegisteredProcessorTypes,
  getProcessorInstrument,
  getRegisteredModulatorTypes,
  getModulatorInstrument,
} from '../audio/instrument-registry';

interface ModuleBrowserProps {
  activeTrack: Track;
  onAddProcessor: (type: string) => void;
  onAddModulator: (type: string) => void;
  onClose: () => void;
  // Replace mode (optional)
  replaceProcessorId?: string;
  replaceProcessorType?: string;
  onReplaceProcessor?: (newType: string) => void;
}

const MAX_PROCESSORS = 2;
const MAX_MODULATORS = 2;

const MODULE_DESCRIPTIONS: Record<string, string> = {
  rings: 'Physical modelling resonator',
  clouds: 'Granular texture processor',
  beads: 'Granular, delay, wavetable synth — Clouds successor',
  ripples: 'Analog filter — LP/BP/HP resonator',
  eq: 'Parametric EQ — 4-band and 8-band mixing',
  compressor: 'Dynamics compressor with character modes',
  tides: 'Multi-function LFO / envelope',
};

export function ModuleBrowser({
  activeTrack,
  onAddProcessor,
  onAddModulator,
  onClose,
  replaceProcessorId,
  replaceProcessorType,
  onReplaceProcessor,
}: ModuleBrowserProps) {
  const isReplaceMode = !!replaceProcessorId && !!onReplaceProcessor;
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const processorTypes = getRegisteredProcessorTypes();
  const modulatorTypes = getRegisteredModulatorTypes();
  const processorCount = (activeTrack.processors ?? []).length;
  const modulatorCount = (activeTrack.modulators ?? []).length;
  const processorsAtMax = processorCount >= MAX_PROCESSORS;
  const modulatorsAtMax = modulatorCount >= MAX_MODULATORS;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />

      {/* Slide-out panel */}
      <div
        ref={panelRef}
        className="fixed top-0 right-0 bottom-0 w-80 bg-zinc-900 border-l border-zinc-700/50 z-50 flex flex-col overflow-hidden"
        style={{ animation: 'slide-in-right 150ms ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
            {isReplaceMode ? 'Swap Processor' : 'Add Module'}
          </span>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 text-sm leading-none px-1"
          >
            &#x2715;
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Processors section */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-sky-400">
                Processors
              </span>
              <span className="text-[11px] font-mono text-zinc-500">
                {processorCount}/{MAX_PROCESSORS} used
              </span>
            </div>
            <div className="space-y-2">
              {processorTypes.map((type) => {
                const inst = getProcessorInstrument(type);
                if (!inst) return null;
                const shortName = inst.label.replace('Mutable Instruments ', '');
                const isSameType = isReplaceMode && type === replaceProcessorType;
                return (
                  <ModuleCard
                    key={type}
                    name={shortName}
                    description={MODULE_DESCRIPTIONS[type] ?? ''}
                    engines={inst.engines.map((e) => e.label)}
                    accentColor="sky"
                    disabled={isSameType || (!isReplaceMode && processorsAtMax)}
                    onClick={() => {
                      if (isReplaceMode) {
                        onReplaceProcessor!(type);
                      } else {
                        onAddProcessor(type);
                        onClose();
                      }
                    }}
                  />
                );
              })}
            </div>
          </section>

          {/* Modulators section (hidden in replace mode) */}
          {!isReplaceMode && <section>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-violet-400">
                Modulators
              </span>
              <span className="text-[11px] font-mono text-zinc-500">
                {modulatorCount}/{MAX_MODULATORS} used
              </span>
            </div>
            <div className="space-y-2">
              {modulatorTypes.map((type) => {
                const inst = getModulatorInstrument(type);
                if (!inst) return null;
                const shortName = inst.label.replace('Mutable Instruments ', '');
                return (
                  <ModuleCard
                    key={type}
                    name={shortName}
                    description={MODULE_DESCRIPTIONS[type] ?? ''}
                    engines={inst.engines.map((e) => e.label)}
                    accentColor="violet"
                    disabled={modulatorsAtMax}
                    onClick={() => {
                      onAddModulator(type);
                      onClose();
                    }}
                  />
                );
              })}
            </div>
          </section>}
        </div>
      </div>

      {/* Keyframe animation */}
      <style>{`
        @keyframes slide-in-right {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}

// --- Module card sub-component ---

interface ModuleCardProps {
  name: string;
  description: string;
  engines: string[];
  accentColor: 'sky' | 'violet';
  disabled: boolean;
  onClick: () => void;
}

const ACCENT_STYLES = {
  sky: {
    border: 'border-sky-400/20',
    hoverBorder: 'hover:border-sky-400/40',
    name: 'text-sky-300',
    chip: 'bg-sky-400/10 text-sky-300/80 border-sky-400/20',
  },
  violet: {
    border: 'border-violet-400/20',
    hoverBorder: 'hover:border-violet-400/40',
    name: 'text-violet-300',
    chip: 'bg-violet-400/10 text-violet-300/80 border-violet-400/20',
  },
};

function ModuleCard({ name, description, engines, accentColor, disabled, onClick }: ModuleCardProps) {
  const styles = ACCENT_STYLES[accentColor];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left p-3 rounded bg-zinc-800 border transition-colors ${
        disabled
          ? 'border-zinc-700/30 opacity-40 cursor-not-allowed'
          : `${styles.border} ${styles.hoverBorder} cursor-pointer hover:bg-zinc-700/50`
      }`}
    >
      <div className={`text-xs font-mono font-medium ${disabled ? 'text-zinc-500' : styles.name}`}>
        {name}
      </div>
      <div className="text-[11px] text-zinc-500 mt-0.5">
        {description}
      </div>
      <div className="flex flex-wrap gap-1 mt-2">
        {engines.map((engine) => (
          <span
            key={engine}
            className={`text-[10px] px-1.5 py-0.5 rounded border ${
              disabled ? 'bg-zinc-800 text-zinc-600 border-zinc-700/30' : styles.chip
            }`}
          >
            {engine}
          </span>
        ))}
      </div>
    </button>
  );
}
