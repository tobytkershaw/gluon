import type { Track, SurfaceModule } from '../../engine/types';

export interface ModuleRendererProps {
  module: SurfaceModule;
  track: Track;
  /** Called when module changes a processor param */
  onProcessorParamChange?: (processorId: string, controlId: string, value: number) => void;
  /** Called on interaction start (for arbitration) */
  onInteractionStart?: () => void;
  /** Called on interaction end */
  onInteractionEnd?: () => void;
}
