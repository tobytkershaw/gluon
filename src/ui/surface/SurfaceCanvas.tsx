import { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import RGL from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import type { Track } from '../../engine/types';
import type { ModuleRendererProps } from './ModuleRendererProps';
import { PlaceholderModule } from './PlaceholderModule';
import { KnobGroupModule } from './KnobGroupModule';
import { MacroKnobModule } from './MacroKnobModule';
import { XYPadModule } from './XYPadModule';

interface SurfaceCanvasProps {
  track: Track;
  onParamChange?: (controlId: string, value: number) => void;
  onProcessorParamChange?: (processorId: string, controlId: string, value: number) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
}

// Module type -> renderer component mapping.
// Starts with PlaceholderModule for all types.
// Individual renderers will replace these as #1053-#1055 land.
const moduleRenderers: Record<string, React.ComponentType<ModuleRendererProps>> = {
  'knob-group': KnobGroupModule,
  'macro-knob': MacroKnobModule,
  'xy-pad': XYPadModule,
  'step-grid': PlaceholderModule,
  'chain-strip': PlaceholderModule,
};

export function SurfaceCanvas({
  track,
  onParamChange,
  onProcessorParamChange,
  onInteractionStart,
  onInteractionEnd,
}: SurfaceCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1200);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    // Set initial width
    setContainerWidth(el.clientWidth || 1200);
    return () => observer.disconnect();
  }, []);

  const modules = track.surface.modules;

  const layout = useMemo(
    () =>
      modules.map((m) => ({
        i: m.id,
        x: m.position.x,
        y: m.position.y,
        w: m.position.w,
        h: m.position.h,
      })),
    [modules],
  );

  const handleLayoutChange = useCallback((_newLayout: RGL.Layout[]) => {
    // Future: dispatch layout update to state.
    // For now, layout changes are visual-only (not persisted).
  }, []);

  if (modules.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
        No surface modules configured. The AI will set up controls when you add
        processors.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-auto p-2">
      <RGL
        className="layout"
        layout={layout}
        cols={12}
        rowHeight={60}
        width={containerWidth}
        isDraggable={true}
        isResizable={true}
        onLayoutChange={handleLayoutChange}
        compactType="vertical"
        margin={[8, 8] as [number, number]}
      >
        {modules.map((mod) => {
          const Renderer = moduleRenderers[mod.type] ?? PlaceholderModule;
          return (
            <div
              key={mod.id}
              className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden"
            >
              <Renderer
                module={mod}
                track={track}
                onParamChange={onParamChange}
                onProcessorParamChange={onProcessorParamChange}
                onInteractionStart={onInteractionStart}
                onInteractionEnd={onInteractionEnd}
              />
            </div>
          );
        })}
      </RGL>
    </div>
  );
}
