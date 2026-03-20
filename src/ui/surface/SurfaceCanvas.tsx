import { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import RGL from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import type { Track, SurfaceModule } from '../../engine/types';
import type { ModuleRendererProps } from './ModuleRendererProps';
import { deriveModuleVisualContext } from '../../engine/visual-identity';
import { getModuleContainerStyle } from './visual-utils';
import { derivePalette, getPaletteRole } from './palette';
import { PlaceholderModule } from './PlaceholderModule';
import { KnobGroupModule } from './KnobGroupModule';
import { MacroKnobModule } from './MacroKnobModule';
import { XYPadModule } from './XYPadModule';
import { StepGridModule } from './StepGridModule';
import { ChainStripModule } from './ChainStripModule';
import { PianoRollModule } from './PianoRollModule';
import { LevelMeterModule } from './LevelMeterModule';
import { PadGridModule } from './PadGridModule';
import { ModulePicker } from './ModulePicker';
import { ModuleConfigPanel } from './ModuleConfigPanel';

interface SurfaceCanvasProps {
  track: Track;
  /** Index of the track in the session tracks array (for default hue distribution) */
  trackIndex?: number;
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
  /** Toggle processor enabled/bypass — goes through session state + undo. */
  onToggleProcessorEnabled?: (processorId: string) => void;
}

const moduleRenderers: Record<string, React.ComponentType<ModuleRendererProps>> = {
  'knob-group': KnobGroupModule,
  'macro-knob': MacroKnobModule,
  'xy-pad': XYPadModule,
  'step-grid': StepGridModule,
  'chain-strip': ChainStripModule,
  'piano-roll': PianoRollModule,
  'level-meter': LevelMeterModule,
  'pad-grid': PadGridModule,
};

export function SurfaceCanvas({
  track,
  trackIndex = 0,
  onParamChange,
  onProcessorParamChange,
  onInteractionStart,
  onInteractionEnd,
  onAddModule,
  onUpdateModule,
  onRemoveModule,
  onToggleProcessorEnabled,
}: SurfaceCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1200);

  // Derive visual context from the track's visual identity (Score system)
  const visualContext = useMemo(
    () => deriveModuleVisualContext(track, trackIndex),
    [track, trackIndex],
  );

  // Derive Surface palette from the track's base hue
  const palette = useMemo(
    () => derivePalette(visualContext.trackColour.hue),
    [visualContext.trackColour.hue],
  );

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
    <div className="absolute bottom-3 left-3 z-10">
      <button
        onClick={() => setPickerOpen(prev => !prev)}
        className="h-6 px-2 flex items-center gap-1 rounded border cursor-pointer transition-colors text-[11px] font-mono uppercase tracking-wider"
        style={{ background: '#282523', borderColor: 'rgba(61,57,53,0.6)', color: '#a8a39a' }}
        title="Add module"
      >
        <span className="text-sm leading-none">+</span>
        <span>Module</span>
      </button>
      {pickerOpen && (
        <div className="absolute bottom-full left-0 mb-1 z-50">
          <ModulePicker
            track={track}
            onAddModule={handleAddModule}
            onClose={() => setPickerOpen(false)}
          />
        </div>
      )}
    </div>
  ) : null;

  if (modules.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 text-sm relative">
        <div className="text-center">
          <p>No surface modules configured.</p>
          <p className="mt-1">
            {onAddModule
              ? 'Add a module to get started, or ask the AI to set up controls.'
              : 'The AI will set up controls when you add processors.'}
          </p>
        </div>
        {addButton}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-auto p-2 flex flex-col relative">
      {addButton}
      {/* Grid area */}
      <div className="flex-1 min-w-0 flex">
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
            const containerStyle = getModuleContainerStyle(visualContext);
            const role = getPaletteRole(mod.type, mod.config as Record<string, unknown>);
            const roleColor = palette[role];
            return (
              <div
                key={mod.id}
                className={`bg-zinc-900 border rounded-lg overflow-hidden cursor-pointer transition-colors ${
                  isSelected
                    ? 'ring-1 ring-zinc-500/50'
                    : ''
                }`}
                style={isSelected
                  ? { ...containerStyle, borderColor: roleColor.tint }
                  : { ...containerStyle, borderColor: roleColor.tint }
                }
                onClick={(e) => handleModuleClick(mod.id, e)}
              >
                <Renderer
                  module={mod}
                  track={track}
                  visualContext={visualContext}
                  palette={palette}
                  roleColor={roleColor}
                  onParamChange={onParamChange}
                  onProcessorParamChange={onProcessorParamChange}
                  onInteractionStart={onInteractionStart}
                  onInteractionEnd={onInteractionEnd}
                  onToggleProcessorEnabled={onToggleProcessorEnabled}
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
      </div>
    </div>
  );
}
