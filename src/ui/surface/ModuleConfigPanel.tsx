import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { Track, SurfaceModule, ModuleBinding, BindingTarget } from '../../engine/types';
import { targetLabel } from './binding-helpers';

interface ModuleConfigPanelProps {
  module: SurfaceModule;
  track: Track;
  onUpdateModule: (updated: SurfaceModule) => void;
  onRemoveModule: (moduleId: string) => void;
  onClose: () => void;
}

/** Safely convert a binding target (string or object) to a display string. */
function displayTarget(target: string | BindingTarget): string {
  if (typeof target === 'string') return target;
  return targetLabel(target);
}

/** Collect all available param targets from a track (source + processors). */
function getAvailableTargets(track: Track): { value: string; label: string; group: string }[] {
  const targets: { value: string; label: string; group: string }[] = [];

  // Source params
  for (const key of Object.keys(track.params)) {
    targets.push({ value: key, label: key, group: 'Source' });
  }

  // Processor params
  for (const proc of track.processors ?? []) {
    for (const key of Object.keys(proc.params)) {
      targets.push({
        value: `${proc.id}:${key}`,
        label: `${proc.id} / ${key}`,
        group: proc.type,
      });
    }
  }

  return targets;
}

export function ModuleConfigPanel({
  module,
  track,
  onUpdateModule,
  onRemoveModule,
  onClose,
}: ModuleConfigPanelProps) {
  const [label, setLabel] = useState(module.label);
  const panelRef = useRef<HTMLDivElement>(null);

  // Sync label when selected module changes
  useEffect(() => {
    setLabel(module.label);
  }, [module.id, module.label]);

  // Click-outside to dismiss
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Delay listener attachment to avoid the same click that opened the panel
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const availableTargets = useMemo(() => getAvailableTargets(track), [track]);

  const handleLabelCommit = useCallback(() => {
    if (label !== module.label) {
      onUpdateModule({ ...module, label });
    }
  }, [label, module, onUpdateModule]);

  const handleBindingTargetChange = useCallback(
    (bindingIndex: number, newTarget: string) => {
      const updatedBindings: ModuleBinding[] = module.bindings.map((b, i) =>
        i === bindingIndex ? { ...b, target: newTarget } : b,
      );
      onUpdateModule({ ...module, bindings: updatedBindings });
    },
    [module, onUpdateModule],
  );

  const handleRemove = useCallback(() => {
    onRemoveModule(module.id);
  }, [module.id, onRemoveModule]);

  return (
    <div
      ref={panelRef}
      className="w-72 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-4 flex flex-col gap-3 overflow-y-auto max-h-[80vh]"
      data-testid="module-config-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500 uppercase tracking-wider">
          {module.type}
        </span>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 text-sm leading-none px-1"
          aria-label="Close config panel"
        >
          &times;
        </button>
      </div>

      {/* Label */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-zinc-400">Label</label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={handleLabelCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleLabelCommit();
          }}
          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
        />
      </div>

      {/* Bindings */}
      {module.bindings.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-zinc-400">Bindings</span>
          {module.bindings.map((binding, idx) => (
            <div
              key={`${binding.role}-${idx}`}
              className="flex flex-col gap-1 bg-zinc-800/50 rounded p-2"
            >
              <span className="text-[10px] text-zinc-500 uppercase">
                {binding.role}
              </span>
              <select
                value={displayTarget(binding.target)}
                onChange={(e) => handleBindingTargetChange(idx, e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
              >
                {/* Keep current value even if not in available list */}
                {!availableTargets.some((t) => t.value === displayTarget(binding.target)) && (
                  <option value={displayTarget(binding.target)}>{displayTarget(binding.target)}</option>
                )}
                {availableTargets.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Remove button */}
      <button
        onClick={handleRemove}
        className="mt-2 px-3 py-1.5 text-sm rounded bg-red-900/40 text-red-400 hover:bg-red-900/60 hover:text-red-300 border border-red-900/50 transition-colors"
      >
        Remove Module
      </button>
    </div>
  );
}
