import { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import RGL from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import type { Track, SurfaceModule } from '../../engine/types';
import type { ModuleRendererProps } from './ModuleRendererProps';
import { PlaceholderModule } from './PlaceholderModule';
import { KnobGroupModule } from './KnobGroupModule';
import { MacroKnobModule } from './MacroKnobModule';
import { XYPadModule } from './XYPadModule';
import { StepGridModule } from './StepGridModule';
import { ChainStripModule } from './ChainStripModule';
import { PianoRollModule } from './PianoRollModule';
import { LevelMeterModule } from './LevelMeterModule';
import { ModulePicker } from './ModulePicker';

interface SurfaceCanvasProps {
  track: Track;
  /** Called for source param changes — (controlId, value). No per-frame undo. */
  onParamChange?: (controlId: string, value: number) => void;
  /** Called for processor param changes. No per-frame undo. */
  onProcessorParamChange?: (processorId: string, controlId: string, value: number) => void;
  /** Gesture start — captures all source + processor state for single-gesture undo. */
  onInteractionStart?: () => void;
  /** Gesture end — diffs and pushes one grouped undo entry. */
  onInteractionEnd?: () => void;
  /** Called when a module is added via the picker. */
  onAddModule?: (module: SurfaceModule) => void;
}

const moduleRenderers: Record<string, React.ComponentType<ModuleRendererProps>> = {
  'knob-group': KnobGroupModule,
  'macro-knob': MacroKnobModule,
  'xy-pad': XYPadModule,
  'step-grid': StepGridModule,
  'chain-strip': ChainStripModule,
  'piano-roll': PianoRollModule,
  'level-meter': LevelMeterModule,
};

export function SurfaceCanvas({
  track,
  onParamChange,
  onProcessorParamChange,
  onInteractionStart,
  onInteractionEnd,
  onAddModule,
}: SurfaceCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1200);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
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
  }, []);

  const handleAddModule = useCallback((module: SurfaceModule) => {
    onAddModule?.(module);
  }, [onAddModule]);

  const addButton = onAddModule ? (
    <div className="relative">
      <button
        onClick={() => setPickerOpen(prev => !prev)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-1.5 px-3 py-2
          bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 rounded-lg
          text-sm text-zinc-300 hover:text-white transition-colors shadow-lg cursor-pointer"
      >
        <span className="text-base leading-none">+</span>
        <span>Add Module</span>
      </button>
      {pickerOpen && (
        <div className="fixed bottom-14 right-6 z-50">
          <ModulePicker
            onAddModule={handleAddModule}
            onClose={() => setPickerOpen(false)}
          />
        </div>
      )}
    </div>
  ) : null;

  if (modules.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm relative">
        <div className="text-center">
          <p>No surface modules configured.</p>
          <p className="mt-1">
            {onAddModule
              ? 'Click "+ Add Module" to get started, or ask the AI to set up controls.'
              : 'The AI will set up controls when you add processors.'}
          </p>
        </div>
        {addButton}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-auto p-2 relative">
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
      {addButton}
    </div>
  );
}
