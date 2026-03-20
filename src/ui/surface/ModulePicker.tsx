import { useEffect, useRef } from 'react';
import { getPickableModuleDefs } from '../../engine/surface-module-registry';
import type { SurfaceModule, ModuleBinding, Track } from '../../engine/types';
import { getActivePattern } from '../../engine/types';

interface ModulePickerProps {
  track: Track;
  onAddModule: (module: SurfaceModule) => void;
  onClose: () => void;
}

export function ModulePicker({ track, onAddModule, onClose }: ModulePickerProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on click-outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Delay listener to avoid closing on the same click that opened the picker
    const id = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const defs = getPickableModuleDefs();

  function seedDefaultBindings(type: string): ModuleBinding[] {
    const bindings: ModuleBinding[] = [];

    if (type === 'step-grid' || type === 'piano-roll') {
      // Seed a region binding pointing to the track's active pattern
      const pattern = track.patterns.length > 0 ? getActivePattern(track) : null;
      if (pattern) {
        bindings.push({ role: 'region', trackId: track.id, target: pattern.id });
      }
    } else if (type === 'chain-strip') {
      // Seed a chain binding pointing to this track
      bindings.push({ role: 'chain', trackId: track.id, target: track.id });
    } else if (type === 'knob-group' || type === 'macro-knob' || type === 'xy-pad' || type === 'pad-grid') {
      // Control modules need a control binding to the track's source
      bindings.push({ role: 'control', trackId: track.id, target: 'source' });
    } else if (type === 'level-meter') {
      // Level meter binds to the track output
      bindings.push({ role: 'control', trackId: track.id, target: 'output' });
    }

    return bindings;
  }

  function handleSelect(type: string) {
    const def = defs.find(d => d.type === type);
    if (!def) return;

    const module: SurfaceModule = {
      type: def.type,
      id: `${def.type}-${Date.now()}`,
      label: def.name,
      bindings: seedDefaultBindings(def.type),
      position: { x: 0, y: 0, w: def.defaultSize.w, h: def.defaultSize.h },
      config: {},
    };
    onAddModule(module);
    onClose();
  }

  return (
    <div
      ref={panelRef}
      className="w-80 max-h-96 overflow-y-auto
        bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl"
    >
      <div className="px-3 py-2 border-b border-zinc-800 text-xs font-medium text-zinc-400 uppercase tracking-wider">
        Add Module
      </div>
      <div className="p-1">
        {defs.map(def => (
          <button
            key={def.type}
            onClick={() => handleSelect(def.type)}
            className="w-full text-left px-3 py-2 rounded-md hover:bg-zinc-800
              transition-colors group cursor-pointer"
          >
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-zinc-200 group-hover:text-white">
                {def.name}
              </span>
              <span className="text-xs text-zinc-600 ml-2">
                {def.defaultSize.w}x{def.defaultSize.h}
              </span>
            </div>
            <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">
              {def.description}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
