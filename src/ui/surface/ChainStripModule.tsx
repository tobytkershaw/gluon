import type { ModuleRendererProps } from './ModuleRendererProps';
import { getAccentColor } from './visual-utils';

/**
 * ChainStripModule — horizontal signal flow diagram with bypass toggles
 * for the track's processor chain.
 *
 * Shows: Source → [Processor 1] → [Processor 2] → ... → Out
 * Each processor has a bypass toggle that dims the box when bypassed.
 * The bypass toggle dispatches through the session state (with undo support)
 * via the onToggleProcessorEnabled callback.
 */
export function ChainStripModule({ module, track, visualContext, onToggleProcessorEnabled }: ModuleRendererProps) {
  const accent = getAccentColor(visualContext);
  const processors = track.processors ?? [];

  return (
    <div className="h-full flex flex-col p-2">
      {/* Header */}
      <div className="flex items-center gap-1 mb-1">
        <span className="text-xs font-medium truncate" style={{ color: accent }}>
          {module.label}
        </span>
      </div>

      {/* Signal flow strip */}
      <div className="flex-1 flex items-center gap-0 overflow-x-auto min-w-0">
        {/* Source node */}
        <div
          className="flex-shrink-0 px-2 py-1 rounded bg-zinc-800 border"
          style={{ borderColor: accent }}
        >
          <span className="text-[11px] font-medium" style={{ color: accent }}>Source</span>
        </div>

        {processors.map((proc) => {
          const enabled = proc.enabled !== false;
          return (
            <div key={proc.id} className="flex items-center gap-0 flex-shrink-0">
              {/* Arrow connector */}
              <div className="flex items-center px-1">
                <div className="w-3 h-px bg-zinc-600" />
                <div className="w-0 h-0 border-t-[3px] border-t-transparent border-b-[3px] border-b-transparent border-l-[4px] border-l-zinc-600" />
              </div>

              {/* Processor node */}
              <div
                className={`flex items-center gap-1.5 px-2 py-1 rounded border transition-colors ${
                  enabled
                    ? 'bg-zinc-800 border-zinc-700'
                    : 'bg-zinc-900 border-zinc-800 opacity-40'
                }`}
              >
                <span
                  className={`text-[11px] font-medium transition-colors ${
                    enabled ? 'text-zinc-300' : 'text-zinc-500 line-through'
                  }`}
                >
                  {proc.type}
                </span>

                {/* Bypass toggle button */}
                <button
                  type="button"
                  title={enabled ? 'Bypass processor' : 'Enable processor'}
                  className={`flex-shrink-0 w-4 h-4 flex items-center justify-center rounded-sm transition-colors ${
                    enabled
                      ? 'text-emerald-400 hover:bg-zinc-700'
                      : 'text-zinc-600 hover:bg-zinc-800'
                  }`}
                  onClick={() => onToggleProcessorEnabled?.(proc.id)}
                >
                  {/* Power icon (simple circle with line) */}
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  >
                    <path d="M5 1v3" />
                    <path d="M2.5 3.2a3.2 3.2 0 1 0 5 0" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}

        {/* Arrow to output */}
        <div className="flex items-center px-1 flex-shrink-0">
          <div className="w-3 h-px bg-zinc-600" />
          <div className="w-0 h-0 border-t-[3px] border-t-transparent border-b-[3px] border-b-transparent border-l-[4px] border-l-zinc-600" />
        </div>

        {/* Output node */}
        <div className="flex-shrink-0 px-2 py-1 rounded bg-zinc-800 border border-zinc-700">
          <span className="text-[11px] text-zinc-300 font-medium">Out</span>
        </div>
      </div>
    </div>
  );
}
