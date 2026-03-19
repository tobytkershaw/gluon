import type { OpenDecision } from '../engine/types';

interface Props {
  decisions: OpenDecision[];
  onRespond: (decision: OpenDecision, response: string) => void;
}

function buttonTone(label: string): string {
  const normalized = label.toLowerCase();
  if (normalized.includes('allow') || normalized.includes('approve') || normalized.includes('yes')) {
    return 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border-emerald-500/30';
  }
  if (normalized.includes('deny') || normalized.includes('reject') || normalized.includes('no')) {
    return 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 border-rose-500/30';
  }
  return 'bg-zinc-800/90 text-zinc-200 hover:bg-zinc-700/90 border-zinc-700';
}

export function OpenDecisionsPanel({ decisions, onRespond }: Props) {
  if (decisions.length === 0) return null;

  return (
    <div className="pointer-events-auto w-full max-w-sm space-y-2">
      {decisions.map((decision) => {
        const options = decision.options && decision.options.length > 0 ? decision.options : ['Acknowledge'];
        return (
          <div
            key={decision.id}
            className="rounded-2xl border border-amber-500/30 bg-zinc-950/95 shadow-[0_16px_48px_rgba(0,0,0,0.35)] backdrop-blur-sm"
          >
            <div className="border-b border-amber-500/15 px-4 py-3">
              <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-amber-300/70">
                Decision Needed
              </div>
              <div className="mt-1 text-sm font-medium text-zinc-100">
                {decision.question}
              </div>
              {decision.context && (
                <div className="mt-1 text-xs leading-relaxed text-zinc-400">
                  {decision.context}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 px-4 py-3">
              {options.map((option) => (
                <button
                  key={option}
                  onClick={() => onRespond(decision, option)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${buttonTone(option)}`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
