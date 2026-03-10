interface Props {
  value: number;
  onChange: (value: number) => void;
}

function leashLabel(v: number): string {
  if (v < 0.05) return 'silent';
  if (v < 0.25) return 'watching';
  if (v < 0.5) return 'responsive';
  if (v < 0.75) return 'active';
  if (v < 0.9) return 'assertive';
  return 'co-creator';
}

export function LeashSlider({ value, onChange }: Props) {
  const pct = value * 100;

  return (
    <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-lg p-4">
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-[9px] font-mono uppercase tracking-[0.25em] text-zinc-500">
          Leash
        </span>
        <span className="font-mono text-sm text-amber-400 tabular-nums">
          {value.toFixed(2)}
        </span>
      </div>

      {/* Custom slider track */}
      <div className="relative h-6 flex items-center">
        {/* Background track */}
        <div className="absolute left-0 right-0 h-2 bg-zinc-800 rounded-full" />

        {/* Amber fill */}
        <div
          className="absolute left-0 h-2 rounded-full transition-[width] duration-75"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, rgba(251,191,36,0.25) 0%, rgba(251,191,36,0.7) 100%)`,
          }}
        />

        {/* Tick marks */}
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 flex justify-between px-[1px]">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <div
              key={t}
              className="w-px h-3 transition-colors"
              style={{ background: t <= value ? 'rgba(251,191,36,0.3)' : 'rgba(63,63,70,0.5)' }}
            />
          ))}
        </div>

        {/* Invisible native input on top for interaction */}
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer z-10"
        />

        {/* Custom thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 pointer-events-none z-20 transition-[left] duration-75"
          style={{ left: `calc(${pct}% - 9px)` }}
        >
          <div className="w-[18px] h-[18px] rounded-full bg-amber-400 border-[2.5px] border-zinc-950 shadow-lg shadow-amber-400/20" />
        </div>
      </div>

      <div className="text-[9px] font-mono text-zinc-600 mt-2 text-center tracking-wide">
        {leashLabel(value)}
      </div>
    </div>
  );
}
