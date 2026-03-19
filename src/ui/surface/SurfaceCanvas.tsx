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
import { ModuleConfigPanel } from './ModuleConfigPanel';

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
  /** Called when a module is updated (label, bindings). */
  onUpdateModule?: (updated: SurfaceModule) => void;
  /** Called when a module is removed. */
  onRemoveModule?: (moduleId: string) => void;
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
  onUpdateModule,
  onRemoveModule,
}: SurfaceCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1200);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);

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

  // Clear selection when track changes
  useEffect(() => {
    setSelectedModuleId(null);
  }, [track.id]);

  // Clear selection if the selected module no longer exists
  useEffect(() => {
    if (selectedModuleId && !track.surface.modules.some(m => m.id === selectedModuleId)) {
      setSelectedModuleId(null);
    }
  }, [selectedModuleId, track.surface.modules]);

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

  const handleModuleClick = useCallback((moduleId: string, e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'SELECT' ||
      target.tagName === 'BUTTON' ||
      target.closest('canvas') ||
      target.closest('[data-no-select]')
    ) {
      return;
    }
    setSelectedModuleId((prev) => (prev === moduleId ? null : moduleId));
  }, []);

  const handleUpdateModule = useCallback(
    (updated: SurfaceModule) => {
      onUpdateModule?.(updated);
    },
    [onUpdateModule],
  );

  const handleRemoveModule = useCallback(
    (moduleId: string) => {
      setSelectedModuleId(null);
      onRemoveModule?.(moduleId);
    },
    [onRemoveModule],
  );

  const handleCloseConfig = useCallback(() => {
    setSelectedModuleId(null);
  }, []);

  const selectedModule = selectedModuleId
    ? modules.find((m) => m.id === selectedModuleId) ?? null
    : null;

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
    <div ref={containerRef} className="flex-1 overflow-auto p-2 flex relative">
      {/* Grid area */}
      <div className="flex-1 min-w-0">
        <RGL
          className="layout"
          layout={layout}
          cols={12}
          rowHeight={60}
          width={selectedModule ? containerWidth - 288 : containerWidth}
          isDraggable={true}
          isResizable={true}
          onLayoutChange={handleLayoutChange}
          compactType="vertical"
          margin={[8, 8] as [number, number]}
        >
          {modules.map((mod) => {
            const Renderer = moduleRenderers[mod.type] ?? PlaceholderModule;
            const isSelected = mod.id === selectedModuleId;
            return (
              <div
                key={mod.id}
                className={`bg-zinc-900 border rounded-lg overflow-hidden cursor-pointer transition-colors ${
                  isSelected
                    ? 'border-zinc-500 ring-1 ring-zinc-500/50'
                    : 'border-zinc-800 hover:border-zinc-700'
                }`}
                onClick={(e) => handleModuleClick(mod.id, e)}
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

      {/* Config panel */}
      {selectedModule && (
        <div className="ml-2 flex-shrink-0">
          <ModuleConfigPanel
            module={selectedModule}
            track={track}
            onUpdateModule={handleUpdateModule}
            onRemoveModule={handleRemoveModule}
            onClose={handleCloseConfig}
          />
        </div>
      )}

      {addButton}
    </div>
  );
}
