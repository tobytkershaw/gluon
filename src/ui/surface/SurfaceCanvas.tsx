import { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import RGL from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import type { Track, SurfaceModule } from '../../engine/types';
import type { MusicalEvent } from '../../engine/canonical-types';
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
  /** Called for drum pad param changes. No per-frame undo. */
  onDrumPadParamChange?: (padId: string, param: string, value: number) => void;
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
  /** Toggle a step gate on/off. patternId targets a specific pattern (for bound regions). */
  onStepToggle?: (trackId: string, stepIndex: number, patternId?: string, options?: { pushUndo?: boolean; padId?: string }) => void;
  /** Toggle accent on an active step. patternId targets a specific pattern (for bound regions). */
  onStepAccentToggle?: (trackId: string, stepIndex: number, patternId?: string, padId?: string) => void;
  /** Called when a paint gesture completes to push a single grouped undo entry. */
  onPaintComplete?: (trackId: string, patternId: string | undefined, prevEvents: MusicalEvent[]) => void;
  /** Whether transport is currently playing */
  playing?: boolean;
  /** Raw global step from scheduler (fractional, ~25ms updates) */
  globalStep?: number;
  /** Current BPM for playhead interpolation */
  bpm?: number;
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
  onDrumPadParamChange,
  onInteractionStart,
  onInteractionEnd,
  onAddModule,
  onUpdateModule,
  onRemoveModule,
  onToggleProcessorEnabled,
  onStepToggle,
  onStepAccentToggle,
  onPaintComplete,
  playing,
  globalStep,
  bpm,
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
  const [hoveredModuleId, setHoveredModuleId] = useState<string | null>(null);

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

  /** Toggle position-lock on a module (undoable via onUpdateModule). */
  const handleToggleLock = useCallback((moduleId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const mod = modules.find(m => m.id === moduleId);
    if (!mod) return;
    onUpdateModule?.({ ...mod, locked: !mod.locked });
  }, [modules, onUpdateModule]);

  /** Auto-unlock a module when the human drags or resizes it. */
  const handleDragStop = useCallback((_layout: RGL.Layout[], _oldItem: RGL.Layout, newItem: RGL.Layout) => {
    const mod = modules.find(m => m.id === newItem.i);
    if (mod?.locked) {
      onUpdateModule?.({ ...mod, position: { x: newItem.x, y: newItem.y, w: newItem.w, h: newItem.h }, locked: false });
    } else if (mod) {
      onUpdateModule?.({ ...mod, position: { x: newItem.x, y: newItem.y, w: newItem.w, h: newItem.h } });
    }
  }, [modules, onUpdateModule]);

  const handleResizeStop = useCallback((_layout: RGL.Layout[], _oldItem: RGL.Layout, newItem: RGL.Layout) => {
    const mod = modules.find(m => m.id === newItem.i);
    if (mod?.locked) {
      onUpdateModule?.({ ...mod, position: { x: newItem.x, y: newItem.y, w: newItem.w, h: newItem.h }, locked: false });
    } else if (mod) {
      onUpdateModule?.({ ...mod, position: { x: newItem.x, y: newItem.y, w: newItem.w, h: newItem.h } });
    }
  }, [modules, onUpdateModule]);

  const selectedModule = selectedModuleId
    ? modules.find((m) => m.id === selectedModuleId) ?? null
    : null;

  const addButton = onAddModule ? (
    <>
      <button
        onClick={() => setPickerOpen(prev => !prev)}
        className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center justify-center cursor-pointer hover:bg-zinc-800 transition-colors z-10"
        style={{
          width: 24,
          height: 96,
          background: 'var(--bg-surface, #1c1917)',
          border: '1px solid rgba(61,57,53,0.6)',
          borderRight: 'none',
          borderRadius: '6px 0 0 6px',
          color: 'var(--text-faint, #57534e)',
          writingMode: 'vertical-rl' as const,
          letterSpacing: '0.06em',
        }}
        title="Add module"
      >
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono, monospace)', textTransform: 'uppercase' }}>+ Module</span>
      </button>
      {pickerOpen && (
        <div className="absolute right-8 top-1/2 -translate-y-1/2 z-50">
          <ModulePicker
            track={track}
            onAddModule={handleAddModule}
            onClose={() => setPickerOpen(false)}
          />
        </div>
      )}
    </>
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
          onDragStop={handleDragStop}
          onResizeStop={handleResizeStop}
          compactType="vertical"
          margin={[8, 8] as [number, number]}
        >
          {modules.map((mod) => {
            const Renderer = moduleRenderers[mod.type] ?? PlaceholderModule;
            const isSelected = mod.id === selectedModuleId;
            const isHovered = mod.id === hoveredModuleId;
            const isLocked = !!mod.locked;
            const containerStyle = getModuleContainerStyle(visualContext);
            const role = getPaletteRole(mod.type, mod.config as Record<string, unknown>);
            const roleColor = palette[role];
            return (
              <div
                key={mod.id}
                className={`bg-zinc-900 border rounded-lg overflow-hidden cursor-pointer transition-colors relative ${
                  isSelected
                    ? 'ring-1 ring-zinc-500/50'
                    : ''
                }`}
                style={isSelected
                  ? { ...containerStyle, borderColor: roleColor.tint }
                  : { ...containerStyle, borderColor: roleColor.tint }
                }
                onClick={(e) => handleModuleClick(mod.id, e)}
                onMouseEnter={() => setHoveredModuleId(mod.id)}
                onMouseLeave={() => setHoveredModuleId(null)}
              >
                {/* Lock toggle — always visible when locked, visible on hover/select when unlocked */}
                {onUpdateModule && (isLocked || isHovered || isSelected) && (
                  <button
                    data-no-select
                    onClick={(e) => handleToggleLock(mod.id, e)}
                    className="absolute top-1 right-1 z-10 flex items-center justify-center rounded transition-opacity cursor-pointer"
                    style={{
                      width: 20,
                      height: 20,
                      opacity: isLocked ? 0.8 : 0.4,
                      color: isLocked ? '#a1a1aa' : '#71717a',
                      background: 'rgba(24,24,27,0.7)',
                    }}
                    title={isLocked ? 'Unlock position (AI can reposition)' : 'Lock position (AI cannot reposition)'}
                  >
                    {isLocked ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                      </svg>
                    )}
                  </button>
                )}
                <Renderer
                  module={mod}
                  track={track}
                  visualContext={visualContext}
                  palette={palette}
                  roleColor={roleColor}
                  onParamChange={onParamChange}
                  onProcessorParamChange={onProcessorParamChange}
                  onDrumPadParamChange={onDrumPadParamChange}
                  onInteractionStart={onInteractionStart}
                  onInteractionEnd={onInteractionEnd}
                  onToggleProcessorEnabled={onToggleProcessorEnabled}
                  onStepToggle={onStepToggle}
                  onStepAccentToggle={onStepAccentToggle}
                  onPaintComplete={onPaintComplete}
                  playing={playing}
                  globalStep={globalStep}
                  bpm={bpm}
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
