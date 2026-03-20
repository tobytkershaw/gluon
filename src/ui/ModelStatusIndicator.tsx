// src/ui/ModelStatusIndicator.tsx
// Compact status indicator showing AI model layer availability.

interface Props {
  plannerConfigured: boolean;
  listenerConfigured: boolean;
}

export function ModelStatusIndicator({ plannerConfigured, listenerConfigured }: Props) {
  let dotClass: string;
  let label: string;

  if (plannerConfigured && listenerConfigured) {
    // Both available — breathing animation while idle
    dotClass = 'bg-teal-500 animate-breathing';
    label = 'AI Connected';
  } else if (!plannerConfigured && !listenerConfigured) {
    // Both unavailable — static low-opacity dot
    dotClass = 'bg-zinc-600';
    label = 'No AI';
  } else if (!plannerConfigured) {
    // Planner unavailable, listener available
    dotClass = 'bg-amber-500';
    label = 'Manual mode';
  } else {
    // Planner available, listener unavailable — breathing with amber ring
    dotClass = 'bg-teal-500 ring-1 ring-amber-500/60 animate-breathing';
    label = 'AI Connected (no audio eval)';
  }

  return (
    <span className="flex items-center gap-1.5 text-[11px] text-zinc-500 select-none" data-testid="model-status">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} data-testid="model-status-dot" />
      <span data-testid="model-status-label">{label}</span>
    </span>
  );
}
