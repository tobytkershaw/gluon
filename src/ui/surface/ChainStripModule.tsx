import type { ModuleRendererProps } from './ModuleRendererProps';
import { getAccentColor } from './visual-utils';
import type { PaletteColor } from './palette';

/** Classify a processor type into a palette role for chain strip coloring. */
function getProcessorChainRole(procType: string): 'tonal' | 'spatial' | 'generative' | 'neutral' {
  const tonal = ['ripples', 'eq', 'filter', 'resonator'];
  const spatial = ['reverb', 'delay', 'chorus', 'phaser', 'flanger'];
  const generative = ['marbles', 'lfo', 'modulator', 'turing'];
  const lower = procType.toLowerCase();
  if (tonal.some(t => lower.includes(t))) return 'tonal';
  if (spatial.some(t => lower.includes(t))) return 'spatial';
  if (generative.some(t => lower.includes(t))) return 'generative';
  return 'neutral';
}

/**
 * ChainStripModule — horizontal signal flow diagram with bypass toggles
 * for the track's processor chain.
 *
 * Shows: Source → [Processor 1] → [Processor 2] → ... → Out
 * Each processor has a bypass toggle that dims the box when bypassed.
 * The bypass toggle dispatches through the session state (with undo support)
 * via the onToggleProcessorEnabled callback.
 *
 * Palette mapping per the mockup spec:
 *  - Source node: base role
 *  - Processor nodes: classified by type (tonal/spatial/generative/neutral)
 */
export function ChainStripModule({ module, track, visualContext, palette, onToggleProcessorEnabled }: ModuleRendererProps) {
  const legacyAccent = getAccentColor(visualContext);
  // Source node always uses base role
  const sourceColor: PaletteColor | undefined = palette?.base;
  const accent = sourceColor?.full ?? legacyAccent;
  const labelColor = sourceColor?.muted ?? accent;
  const processors = track.processors ?? [];

  return (
    <div className="h-full flex flex-col p-2">
      {/* Header */}
      <div className="flex items-center gap-1 mb-1">
        <span className="text-xs font-medium truncate" style={{ color: labelColor }}>
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
          const procRole = getProcessorChainRole(proc.type);
          const procPalette = palette?.[procRole];
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
                    ? 'bg-zinc-800'
                    : 'bg-zinc-900 opacity-40'
                }`}
                style={{
                  borderColor: enabled && procPalette ? procPalette.tint : enabled ? 'rgb(63,63,70)' : 'rgb(39,39,42)',
                }}
              >
                <span
                  className={`text-[11px] font-medium transition-colors ${
                    !enabled ? 'line-through' : ''
                  }`}
                  style={{
                    color: enabled && procPalette ? procPalette.muted : enabled ? 'rgb(212,212,216)' : 'rgb(113,113,122)',
                  }}
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
