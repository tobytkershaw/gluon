import type { Agency } from '../engine/types';

interface Props {
  value: Agency;
  onChange: (agency: Agency) => void;
}

export function AgencyToggle({ value, onChange }: Props) {
  const isProtected = value === 'OFF';
  return (
    <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-lg p-3">
      <div className="text-[9px] font-mono uppercase tracking-[0.25em] text-zinc-500 mb-2.5">
        AI Access
      </div>
      <button
        onClick={() => onChange(isProtected ? 'ON' : 'OFF')}
        className={`w-full py-1.5 text-[10px] font-mono font-medium uppercase tracking-wider rounded transition-all duration-150 ${
          isProtected
            ? 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25'
            : 'text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/50'
        }`}
      >
        {isProtected ? '\u{1F512} Protected' : 'Editable'}
      </button>
    </div>
  );
}
