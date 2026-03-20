// src/ui/ModelStatusIndicator.tsx
// Compact status indicator showing AI model layer availability.

interface Props {
  plannerConfigured: boolean;
  listenerConfigured: boolean;
  /** When true, show only the status dot (no label). Used in the topbar. */
  compact?: boolean;
}

export function ModelStatusIndicator({ plannerConfigured, listenerConfigured, compact }: Props) {
  let dotClass: string;
  let label: string;

  if (plannerConfigured && listenerConfigured) {
    // Both available — teal dot, solid
    dotClass = 'bg-teal-400';
    label = 'Connected';
  } else if (!plannerConfigured && !listenerConfigured) {
    // Both unavailable — zinc dot
    dotClass = 'bg-zinc-600';
    label = 'Disconnected';
  } else if (!plannerConfigured) {
    // Planner unavailable, listener available — amber dot
    dotClass = 'bg-amber-400';
    label = 'Manual mode';
  } else {
    // Planner available, listener unavailable — teal dot with amber ring
    dotClass = 'bg-teal-400';
    label = 'Connected (no audio eval)';
  }

  // "no audio eval" ring: teal dot with 2px surface gap + amber outer ring
  const isNoAudioEval = plannerConfigured && !listenerConfigured;
  const ringStyle = isNoAudioEval
    ? { boxShadow: '0 0 0 2px var(--tw-shadow-color, #1c1917), 0 0 0 3.5px #fbbf24' }
    : undefined;

  const dotSize = compact ? 'w-1.5 h-1.5' : 'w-1.5 h-1.5';

  if (compact) {
    return (
      <span
        className={`${dotSize} rounded-full shrink-0 ${dotClass}`}
        style={ringStyle}
        title={label}
        data-testid="model-status-dot"
      />
    );
  }

  return (
    <span className="flex items-center gap-1.5 text-[11px] text-zinc-500 select-none" data-testid="model-status">
      <span className={`${dotSize} rounded-full shrink-0 ${dotClass}`} style={ringStyle} data-testid="model-status-dot" />
      <span data-testid="model-status-label">{label}</span>
    </span>
  );
}
