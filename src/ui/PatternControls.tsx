// src/ui/PatternControls.tsx
interface Props {
  patternLength: number;
  totalPages: number;
  currentPage: number;
  onLengthChange: (length: number) => void;
  onPageChange: (page: number) => void;
  onClear: () => void;
}

const LENGTH_PRESETS = [4, 8, 16, 32, 64];

export function PatternControls({
  patternLength, totalPages, currentPage,
  onLengthChange, onPageChange, onClear,
}: Props) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1">
        <span className="text-zinc-500 text-xs uppercase tracking-wider">Len</span>
        <div className="flex gap-0.5">
          {LENGTH_PRESETS.map(len => (
            <button
              key={len}
              onClick={() => onLengthChange(len)}
              className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
                patternLength === len
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {len}
            </button>
          ))}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          {Array.from({ length: totalPages }, (_, i) => (
            <button
              key={i}
              onClick={() => onPageChange(i)}
              className={`text-xs px-1.5 py-0.5 rounded ${
                currentPage === i
                  ? 'bg-zinc-700 text-zinc-200'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}

      <button
        onClick={onClear}
        className="text-xs text-zinc-500 hover:text-red-400 transition-colors px-2 py-0.5 rounded hover:bg-red-500/10"
      >
        CLR
      </button>
    </div>
  );
}
