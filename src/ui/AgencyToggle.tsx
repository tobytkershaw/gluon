import type { Agency } from '../engine/types';

interface Props {
  value: Agency;
  onChange: (agency: Agency) => void;
}

const options: { value: Agency; label: string; activeClass: string }[] = [
  { value: 'OFF', label: 'OFF', activeClass: 'bg-zinc-700 text-zinc-200' },
  { value: 'ON', label: 'ON', activeClass: 'bg-teal-500/15 text-teal-300 ring-1 ring-teal-500/25' },
];

export function AgencyToggle({ value, onChange }: Props) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-lg p-3">
      <div className="text-[9px] font-mono uppercase tracking-[0.25em] text-zinc-500 mb-2.5">
        Agency
      </div>
      <div className="flex gap-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`flex-1 py-1.5 text-[10px] font-mono font-medium uppercase tracking-wider rounded transition-all duration-150 ${
              value === opt.value
                ? opt.activeClass
                : 'text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/50'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
