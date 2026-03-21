import type { Track, SurfaceModule, ModuleVisualContext } from '../../engine/types';
import type { MusicalEvent } from '../../engine/canonical-types';
import type { SurfacePalette, PaletteColor } from './palette';

export interface ModuleRendererProps {
  module: SurfaceModule;
  track: Track;
  /** Visual context derived from the track's visual identity (Score system) */
  visualContext?: ModuleVisualContext;
  /** Full Surface palette derived from the track's base hue */
  palette?: SurfacePalette;
  /** The palette color for this specific module's role */
  roleColor?: PaletteColor;
  /** Called when module changes a source param — no per-frame undo */
  onParamChange?: (controlId: string, value: number) => void;
  /** Called when module changes a processor param — no per-frame undo */
  onProcessorParamChange?: (processorId: string, controlId: string, value: number) => void;
  /** Called when module changes a drum pad param — no per-frame undo */
  onDrumPadParamChange?: (padId: string, param: string, value: number) => void;
  /** Gesture start — surface handler captures all state for undo */
  onInteractionStart?: () => void;
  /** Gesture end — surface handler diffs and pushes undo */
  onInteractionEnd?: () => void;
  /** Toggle processor enabled/bypass — goes through session state + undo */
  onToggleProcessorEnabled?: (processorId: string) => void;
  /** Toggle a step gate on/off. patternId targets a specific pattern (for bound regions). */
  onStepToggle?: (trackId: string, stepIndex: number, patternId?: string, options?: { pushUndo?: boolean; padId?: string }) => void;
  /** Toggle accent on an active step. patternId targets a specific pattern (for bound regions). */
  onStepAccentToggle?: (trackId: string, stepIndex: number, patternId?: string, padId?: string) => void;
  /** Called when a paint gesture completes to push a single grouped undo entry. */
  onPaintComplete?: (trackId: string, patternId: string | undefined, prevEvents: MusicalEvent[]) => void;
}
