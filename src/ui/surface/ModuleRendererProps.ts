import type { Track, SurfaceModule } from '../../engine/types';

export interface ModuleRendererProps {
  module: SurfaceModule;
  track: Track;
  /** Called when module changes a source param */
  onParamChange?: (controlId: string, value: number) => void;
  /** Called when module changes a processor param */
  onProcessorParamChange?: (processorId: string, controlId: string, value: number) => void;
  /** Called on source interaction start (for arbitration) */
  onInteractionStart?: () => void;
  /** Called on source interaction end */
  onInteractionEnd?: () => void;
  /** Called on processor interaction start — captures pre-state for undo */
  onProcessorInteractionStart?: (processorId: string) => void;
  /** Called on processor interaction end */
  onProcessorInteractionEnd?: (processorId: string) => void;
}
