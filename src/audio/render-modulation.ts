import type {
  RenderModulationSpec,
  RenderModulationTargetSpec,
  RenderProcessorSpec,
  RenderSynthPatch,
} from './render-spec';

export function averageSignal(samples: Float32Array, length = samples.length): number {
  if (length <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += samples[i];
  }
  return sum / length;
}

export function applySourceModulations(
  basePatch: RenderSynthPatch,
  routes: RenderModulationSpec[],
  modulatorValues: Record<string, number>,
): RenderSynthPatch {
  const next: RenderSynthPatch = { ...basePatch };
  for (const route of routes) {
    if (route.target.kind !== 'source') continue;
    next[route.target.param] = clamp01(next[route.target.param] + ((modulatorValues[route.modulatorId] ?? 0) * route.depth));
  }
  return next;
}

export function applyProcessorModulations(
  processor: RenderProcessorSpec,
  routes: RenderModulationSpec[],
  modulatorValues: Record<string, number>,
): Record<string, number> {
  const next = { ...processor.params };
  for (const route of routes) {
    if (!isProcessorTarget(route.target, processor.id)) continue;
    next[route.target.param] = clamp01((next[route.target.param] ?? 0.5) + ((modulatorValues[route.modulatorId] ?? 0) * route.depth));
  }
  return next;
}

function isProcessorTarget(
  target: RenderModulationTargetSpec,
  processorId: string,
): target is Extract<RenderModulationTargetSpec, { kind: 'processor' }> {
  return target.kind === 'processor' && target.processorId === processorId;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
