// src/ui/TrackMixStrip.tsx
// Compact volume/pan strip shown above every view so mix controls are always accessible.
import type { Track } from '../engine/types';
import { getTrackLabel } from '../engine/track-labels';
import { Knob } from './Knob';

interface Props {
  activeTrack: Track;
  onChangeVolume: (value: number) => void;
  onChangePan: (value: number) => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
}

export function TrackMixStrip({ activeTrack, onChangeVolume, onChangePan, onInteractionStart, onInteractionEnd }: Props) {
  const panDisplay = activeTrack.pan === 0
    ? 'C'
    : activeTrack.pan < 0
      ? `L${Math.round(Math.abs(activeTrack.pan) * 100)}`
      : `R${Math.round(activeTrack.pan * 100)}`;

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 border-b border-zinc-800/50 shrink-0">
      <span className="text-[12px] font-medium tracking-wider uppercase text-zinc-400">
        {getTrackLabel(activeTrack)}
      </span>
      <div className="flex items-center gap-1 ml-auto" title={`Volume: ${Math.round(activeTrack.volume * 100)}%`}>
        <span className="text-[11px] text-zinc-600 font-mono">Vol</span>
        <Knob value={activeTrack.volume} label="" accentColor="amber" onChange={onChangeVolume} onPointerDown={onInteractionStart} onPointerUp={onInteractionEnd} size={20} />
      </div>
      <div className="flex items-center gap-1" title={`Pan: ${panDisplay}`}>
        <span className="text-[11px] text-zinc-600 font-mono">Pan</span>
        <Knob value={(activeTrack.pan + 1) / 2} label="" accentColor="sky" onChange={(v) => onChangePan(v * 2 - 1)} onPointerDown={onInteractionStart} onPointerUp={onInteractionEnd} size={20} />
      </div>
    </div>
  );
}
