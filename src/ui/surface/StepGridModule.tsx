import type { ModuleRendererProps } from './ModuleRendererProps';
import type { TriggerEvent } from '../../engine/canonical-types';
import { getActivePattern } from '../../engine/types';
import { getAccentColor } from './visual-utils';

/**
 * StepGridModule — TR-style read-only step display for the Surface.
 *
 * Binds to a region via module.bindings and reads trigger events from
 * the track's active pattern. Shows up to 16 steps with gate/accent
 * indicators and beat-boundary markers.
 */
export function StepGridModule({ module, track, visualContext, roleColor }: ModuleRendererProps) {
  // Step grid uses base role — pattern output is the track's identity
  const accent = roleColor?.full ?? getAccentColor(visualContext);
  // Resolve pattern from region binding, falling back to active pattern
  const regionBinding = module.bindings.find(b => b.role === 'region');
  const boundPattern = regionBinding
    ? track.patterns.find(p => p.id === regionBinding.target) ?? null
    : null;
  const pattern = boundPattern ?? (track.patterns.length > 0 ? getActivePattern(track) : null);

  if (!pattern) {
    return (
      <div className="h-full flex flex-col p-2">
        <span className="text-xs text-zinc-400 font-medium truncate">
          {module.label}
        </span>
        <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs">
          No pattern
        </div>
      </div>
    );
  }

  // Extract trigger events from the pattern, keyed by integer step position
  const stepCount = Math.min(Math.floor(pattern.duration), 16);
  const triggersByStep = new Map<number, TriggerEvent>();
  for (const event of pattern.events) {
    if (event.kind === 'trigger') {
      const stepPos = Math.floor(event.at);
      if (stepPos >= 0 && stepPos < stepCount) {
        triggersByStep.set(stepPos, event as TriggerEvent);
      }
    }
  }

  return (
    <div className="h-full flex flex-col p-2">
      <span className="text-xs text-zinc-400 font-medium truncate mb-1">
        {module.label}
      </span>
      <div className="flex-1 flex items-center gap-0.5">
        {Array.from({ length: stepCount }, (_, i) => {
          const trigger = triggersByStep.get(i);
          const hasGate = trigger !== undefined;
          const hasAccent = hasGate && trigger.accent === true;
          const isBeatBoundary = i % 4 === 0;

          return (
            <div
              key={i}
              className="relative flex-1 min-w-0 h-full rounded-sm transition-colors border"
              style={hasGate
                ? {
                    backgroundColor: accent,
                    opacity: hasAccent ? 0.7 : 0.3,
                    borderColor: accent,
                  }
                : {
                    backgroundColor: 'rgba(39,39,42,0.6)',
                    borderColor: 'rgba(63,63,70,0.4)',
                  }
              }
            >
              {/* Beat boundary marker */}
              {isBeatBoundary && (
                <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-zinc-500/40 rounded-l" />
              )}

              {/* Step number */}
              <span className="absolute top-0.5 left-0.5 text-[9px] text-zinc-600 leading-none select-none">
                {i + 1}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
