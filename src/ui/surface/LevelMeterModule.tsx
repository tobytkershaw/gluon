import type { ModuleRendererProps } from './ModuleRendererProps';
import { getAccentColor } from './visual-utils';

// TODO: wire to real-time audio analysis data
const STATIC_LEVEL_DB = -12;
const STATIC_PEAK_DB = -6;

/** dB markings to display on the scale */
const DB_MARKS = [0, -3, -6, -12, -24, -48] as const;

/** Convert dB to a 0–1 linear fraction for meter height. -Infinity maps to 0, 0 dB maps to 1. */
function dbToFraction(db: number): number {
  if (db <= -48) return 0;
  if (db >= 0) return 1;
  // Linear mapping from -48..0 → 0..1
  return (db + 48) / 48;
}

export function LevelMeterModule({ module, track, visualContext }: ModuleRendererProps) {
  const accent = getAccentColor(visualContext);
  const levelFraction = dbToFraction(STATIC_LEVEL_DB);
  const peakFraction = dbToFraction(STATIC_PEAK_DB);

  // Resolve label from binding or track name
  const trackBinding = module.bindings.find(b => b.role === 'track');
  const label = module.label ?? trackBinding?.target ?? track.name;

  return (
    <div className="h-full flex flex-col items-center p-2 select-none">
      {/* Meter + scale container */}
      <div className="flex-1 flex w-full min-h-0 gap-1">
        {/* dB scale markings */}
        <div className="flex flex-col justify-between text-[9px] text-zinc-500 font-mono leading-none py-0.5 shrink-0">
          {DB_MARKS.map(db => (
            <span key={db} className="text-right w-6">
              {db === 0 ? '0' : db.toString()}
            </span>
          ))}
          <span className="text-right w-6">-inf</span>
        </div>

        {/* Meter bar */}
        <div className="flex-1 bg-zinc-950 rounded-sm relative overflow-hidden border border-zinc-800">
          {/* Gradient fill representing current level */}
          <div
            className="absolute bottom-0 left-0 right-0 rounded-sm"
            style={{
              height: `${levelFraction * 100}%`,
              background: 'linear-gradient(to top, #22c55e 0%, #22c55e 33%, #eab308 66%, #ef4444 100%)',
            }}
          />

          {/* Peak hold indicator */}
          <div
            className="absolute left-0 right-0 h-[2px]"
            style={{
              bottom: `${peakFraction * 100}%`,
              backgroundColor: accent,
              opacity: 0.8,
            }}
          />
        </div>
      </div>

      {/* Track label */}
      <div className="mt-1 text-[10px] text-zinc-400 font-mono truncate w-full text-center">
        {label}
      </div>
    </div>
  );
}
