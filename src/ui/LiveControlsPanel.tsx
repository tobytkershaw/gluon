// src/ui/LiveControlsPanel.tsx
// Right panel in the Chat layout showing transient AI-proposed control modules.
// Width ~280px, violet accent, vertical stack of module cards.
import type { LiveControlModule, Track } from '../engine/types';
import { LiveModuleRenderer } from './LiveModuleRenderer';

interface LiveControlsPanelProps {
  modules: LiveControlModule[];
  tracks: Track[];
  onTouch: (moduleId: string) => void;
  onAddToSurface: (liveModule: LiveControlModule) => void;
  onParamChange?: (param: string, value: number) => void;
  onProcessorParamChange?: (processorId: string, param: string, value: number) => void;
}

export function LiveControlsPanel({ modules, tracks, onTouch, onAddToSurface, onParamChange, onProcessorParamChange }: LiveControlsPanelProps) {
  const trackById = (id: string) => tracks.find(t => t.id === id);

  return (
    <div
      className="w-[340px] shrink-0 flex flex-col border-l border-violet-500/20 bg-zinc-950/60 overflow-y-auto"
      data-testid="live-controls-panel"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-violet-500/10">
        <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-breathing shrink-0" />
        <span className="text-[10px] font-mono uppercase tracking-[0.06em] text-violet-400/70 select-none">
          Live Controls
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 p-3 flex flex-col gap-3">
        {modules.map((m) => (
          <LiveModuleRenderer
            key={m.id}
            liveModule={m}
            track={trackById(m.trackId)}
            onTouch={onTouch}
            onAddToSurface={onAddToSurface}
            onParamChange={onParamChange}
            onProcessorParamChange={onProcessorParamChange}
          />
        ))}

        {/* Empty state */}
        {modules.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-[10px] font-mono text-zinc-600 text-center leading-relaxed px-4">
              Controls appear here as Gluon works
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
