import type { Track, SurfaceModule, ModuleVisualContext } from '../../engine/types';

export interface ModuleRendererProps {
  module: SurfaceModule;
  track: Track;
  /** Visual context derived from the track's visual identity (Score system) */
  visualContext?: ModuleVisualContext;
  /** Called when module changes a source param — no per-frame undo */
  onParamChange?: (controlId: string, value: number) => void;
  /** Called when module changes a processor param — no per-frame undo */
  onProcessorParamChange?: (processorId: string, controlId: string, value: number) => void;
  /** Gesture start — surface handler captures all state for undo */
  onInteractionStart?: () => void;
  /** Gesture end — surface handler diffs and pushes undo */
  onInteractionEnd?: () => void;
}
