// src/ui/SemanticInspector.tsx
// Popover showing weight mapping for a semantic control.
import { useRef, useEffect } from 'react';
import type { SemanticControlDef } from '../engine/types';

interface SemanticInspectorProps {
  control: SemanticControlDef;
  /** Resolve moduleId to a human-readable label. */
  resolveModuleLabel: (moduleId: string) => string;
  onClose: () => void;
}

const TRANSFORM_LABEL: Record<string, string> = {
  linear: '',
  inverse: 'inverse',
  bipolar: 'bipolar',
};

export function SemanticInspector({ control, resolveModuleLabel, onClose }: SemanticInspectorProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 w-64 bg-zinc-900 border border-emerald-400/20 rounded-lg p-3 shadow-xl"
    >
      <div className="text-[11px] font-medium text-emerald-300 mb-1">{control.name}</div>
      {control.description && (
        <div className="text-[11px] text-zinc-500 mb-2">{control.description}</div>
      )}
      <div className="space-y-1">
        {control.weights.map((w, i) => {
          const pct = Math.round(w.weight * 100);
          const transformTag = TRANSFORM_LABEL[w.transform];
          return (
            <div key={i} className="flex items-center gap-1 text-[11px]">
              <span className="text-zinc-400 truncate flex-1">
                {resolveModuleLabel(w.moduleId)}:{w.controlId}
              </span>
              <span className="text-emerald-400 font-mono w-8 text-right">{pct}%</span>
              {transformTag && (
                <span className="text-zinc-600 italic">{transformTag}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
