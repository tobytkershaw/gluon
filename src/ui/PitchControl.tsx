interface Props {
  note: number;
  harmonics: number;
  onNoteChange: (note: number) => void;
  onHarmonicsChange: (harmonics: number) => void;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToLabel(note: number): string {
  const midi = Math.round(note * 127);
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export function PitchControl({ note, harmonics, onNoteChange, onHarmonicsChange }: Props) {
  return (
    <div className="flex gap-5 w-48 shrink-0">
      <div className="flex-1">
        <label className="block text-[8px] font-mono uppercase tracking-[0.2em] text-zinc-600 mb-1.5">
          Note
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step={1 / 127}
          value={note}
          onChange={(e) => onNoteChange(parseFloat(e.target.value))}
          className="w-full"
        />
        <div className="text-[11px] font-mono text-amber-400/60 mt-1">
          {midiToLabel(note)}
        </div>
      </div>
      <div className="flex-1">
        <label className="block text-[8px] font-mono uppercase tracking-[0.2em] text-zinc-600 mb-1.5">
          Harmonics
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={harmonics}
          onChange={(e) => onHarmonicsChange(parseFloat(e.target.value))}
          className="w-full"
        />
        <div className="text-[11px] font-mono text-amber-400/60 mt-1">
          {harmonics.toFixed(2)}
        </div>
      </div>
    </div>
  );
}
