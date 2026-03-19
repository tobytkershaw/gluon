import { useMemo, useState, useCallback, useRef } from 'react';
import type { ModuleRendererProps } from './ModuleRendererProps';
import type { TriggerEvent } from '../../engine/canonical-types';
import { getActivePattern } from '../../engine/types';
import { getAccentColor } from './visual-utils';

/**
 * PadGridModule — 4x4 drum pad grid for the Surface view.
 *
 * Renders pads from the track's drumRack config. Each cell shows:
 * - Pad name
 * - Activity indicator (lit when a trigger exists in the active pattern)
 * - Tap to audition (fires the pad's source via onParamChange)
 */
export function PadGridModule({ module, track, visualContext, onParamChange, onInteractionStart, onInteractionEnd }: ModuleRendererProps) {
  const accent = getAccentColor(visualContext);
  const [activePadId, setActivePadId] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pads = track.drumRack?.pads ?? [];

  // Determine which pads have triggers in the active pattern
  const activePadIds = useMemo(() => {
    const active = new Set<string>();
    if (track.patterns.length === 0) return active;
    const pattern = getActivePattern(track);
    for (const event of pattern.events) {
      if (event.kind === 'trigger') {
        const te = event as TriggerEvent;
        if (te.padId && (te.velocity ?? 0.75) > 0) active.add(te.padId);
      }
    }
    return active;
  }, [track]);

  // Compute grid dimensions: 4 columns, rows as needed (up to 4 rows for 16 pads)
  const cols = 4;
  const rows = Math.max(1, Math.ceil(pads.length / cols));

  const handlePadTap = useCallback((padId: string) => {
    // Visual feedback only for now
    setActivePadId(padId);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setActivePadId(null), 150);
    // TODO: Wire tap-to-audition via a dedicated onAuditionPad prop
    // threaded from SurfaceCanvas through to the audio engine.
    // The onParamChange path only handles source params, not pad triggers.
  }, []);

  if (pads.length === 0) {
    return (
      <div className="h-full flex flex-col p-2">
        <span className="text-xs font-medium truncate" style={{ color: accent }}>
          {module.label}
        </span>
        <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs">
          No pads configured
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-2">
      <span className="text-xs font-medium truncate mb-1" style={{ color: accent }}>
        {module.label}
      </span>
      <div
        className="flex-1 grid gap-1"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
        }}
      >
        {pads.map((pad) => {
          const hasActivity = activePadIds.has(pad.id);
          const isTapped = activePadId === pad.id;

          return (
            <button
              key={pad.id}
              data-no-select
              className="relative flex flex-col items-center justify-center rounded border transition-all cursor-pointer select-none min-w-0 overflow-hidden"
              style={{
                backgroundColor: isTapped
                  ? accent
                  : hasActivity
                    ? `${accent}33`
                    : 'rgba(39,39,42,0.8)',
                borderColor: hasActivity ? `${accent}66` : 'rgba(63,63,70,0.5)',
                opacity: isTapped ? 0.9 : 1,
              }}
              onPointerDown={() => handlePadTap(pad.id)}
              title={`${pad.name}${pad.chokeGroup !== undefined ? ` (choke ${pad.chokeGroup})` : ''}`}
            >
              {/* Activity indicator dot */}
              {hasActivity && (
                <div
                  className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: accent }}
                />
              )}
              {/* Pad name */}
              <span
                className="text-[10px] font-medium leading-tight truncate max-w-full px-0.5"
                style={{ color: isTapped ? 'rgb(24,24,27)' : 'rgb(161,161,170)' }}
              >
                {pad.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
