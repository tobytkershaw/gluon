import { useEffect, useState } from 'react';
import type { PendingAction } from '../engine/types';

interface Props {
  pending: PendingAction[];
  onCommit: (id: string) => void;
  onDismiss: (id: string) => void;
}

export function PendingOverlay({ pending, onCommit, onDismiss }: Props) {
  // Force re-render to update countdown timers
  const [, setTick] = useState(0);
  useEffect(() => {
    if (pending.length === 0) return;
    const interval = setInterval(() => setTick(n => n + 1), 200);
    return () => clearInterval(interval);
  }, [pending.length]);

  if (pending.length === 0) return null;

  return (
    <div className="absolute bottom-3 right-3 flex flex-col gap-2 max-w-[220px] z-10">
      {pending.map((p) => {
        const isAudition = p.type === 'audition';
        const remaining = Math.max(0, p.expiresAt - Date.now());
        const changes = Object.entries(p.changes)
          .map(([k, v]) => `${k}: ${(v as number).toFixed(2)}`)
          .join(', ');

        return (
          <div
            key={p.id}
            className={`rounded-lg p-2.5 backdrop-blur-md border ${
              isAudition
                ? 'bg-amber-950/40 border-amber-500/20'
                : 'bg-teal-950/40 border-teal-500/20'
            }`}
            style={{ animation: 'fade-up 0.15s ease-out' }}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className={`text-[8px] font-mono uppercase tracking-[0.15em] ${
                isAudition ? 'text-amber-400' : 'text-teal-400'
              }`}>
                {isAudition ? 'Audition' : 'Suggestion'}
              </span>
              {isAudition && remaining > 0 && (
                <span className="text-[9px] font-mono text-amber-400/50 tabular-nums">
                  {Math.ceil(remaining / 1000)}s
                </span>
              )}
            </div>

            <div className="text-[9px] font-mono text-zinc-400 mb-2 leading-relaxed">
              {changes}
            </div>

            {p.reason && (
              <div className="text-[9px] text-zinc-500 mb-2 italic leading-relaxed">
                {p.reason}
              </div>
            )}

            {/* Progress bar for auditions */}
            {isAudition && (
              <div className="h-px bg-zinc-800 mb-2 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-400/40 transition-[width] duration-200"
                  style={{ width: `${Math.max(0, (remaining / (p.expiresAt - (p.expiresAt - 3000))) * 100)}%` }}
                />
              </div>
            )}

            <div className="flex gap-1.5">
              <button
                onClick={() => onCommit(p.id)}
                className={`flex-1 text-[8px] font-mono uppercase tracking-wider py-1 rounded transition-colors ${
                  isAudition
                    ? 'bg-amber-400/15 text-amber-300 hover:bg-amber-400/25'
                    : 'bg-teal-400/15 text-teal-300 hover:bg-teal-400/25'
                }`}
              >
                Keep
              </button>
              <button
                onClick={() => onDismiss(p.id)}
                className="flex-1 text-[8px] font-mono uppercase tracking-wider py-1 text-zinc-600 hover:text-zinc-400 rounded transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
