// src/ui/TrackerView.tsx
// Thin shell: full-height Tracker (top bar moved to AppShell)
import { useState, useCallback, useRef, useMemo, type MutableRefObject } from 'react';
import type { Session, Track } from '../engine/types';
import { getActivePattern } from '../engine/types';
import type { MusicalEvent, NoteEvent } from '../engine/canonical-types';
import type { EventSelector } from '../engine/event-primitives';
import type { SequenceAutomationPoint } from '../engine/sequencer-types';
import { resolveSequencePosition } from '../engine/sequence-helpers';
import { Tracker } from './Tracker';
import { DrumLaneTracker } from './DrumLaneTracker';
import { TrackerCheatSheet } from './TrackerCheatSheet';
import { AutomationPanel } from './AutomationPanel';
import { SequenceEditor } from './SequenceEditor';
import { usePlayheadPosition } from './usePlayheadPosition';

interface Props {
  session: Session;
  activeTrack: Track;
  // Transport (position only)
  playing: boolean;
  globalStep: number;
  // Tracker editing
  onEventUpdate: (selector: EventSelector, updates: Partial<MusicalEvent>) => void;
  onEventDelete: (selector: EventSelector) => void;
  onEventAdd?: (step: number, event: MusicalEvent) => void;
  /** Quantize all events in the active region to the nearest grid position. */
  onQuantize?: () => void;
  // Pattern length
  onPatternLengthChange?: (length: number) => void;
  onClearPattern?: () => void;
  // Transform callbacks
  onRotate?: (steps: number) => void;
  onTranspose?: (semitones: number) => void;
  onReverse?: () => void;
  onDuplicate?: () => void;
  /** When true, in-progress inline edits should be discarded on blur. */
  cancelEditRef?: MutableRefObject<boolean>;
  /** Bulk delete events by their indices (for selection cut/delete). */
  onDeleteByIndices?: (indices: number[]) => void;
  /** Paste events into the region (for clipboard paste). */
  onPasteEvents?: (events: MusicalEvent[]) => void;
  /** Transpose events at the given indices by semitones (for selection transpose). */
  onTransposeByIndices?: (indices: number[], semitones: number) => void;
  // Region CRUD
  onAddRegion?: () => void;
  onRemoveRegion?: (patternId: string) => void;
  onDuplicateRegion?: (patternId: string) => void;
  onRenameRegion?: (patternId: string, name: string) => void;
  onSetActiveRegion?: (patternId: string) => void;
  /** Report cursor step position changes (for play-from-cursor). */
  onCursorStepChange?: (step: number) => void;
  /** Called when a note cell is hovered or cursor-selected (pitch) or unhovered (null). */
  onNotePreview?: (pitch: number | null) => void;
  /** Called when a row is double-clicked to play from that position. */
  onPlayFromRow?: (step: number) => void;
  /** Called when the tracker selection range changes. Null when no selection. */
  onSelectionChange?: (selection: { stepRange: [number, number]; eventIndices: number[] } | null) => void;
  // Sequence editor callbacks
  onAddPatternRef?: (patternId: string) => void;
  onRemovePatternRef?: (sequenceIndex: number) => void;
  onReorderPatternRef?: (fromIndex: number, toIndex: number) => void;
  onSetSequenceAutomation?: (controlId: string, points: SequenceAutomationPoint[]) => void;
  onClearSequenceAutomation?: (controlId: string) => void;
}

// --- Inline number input for Rotate/Transpose ---

function InlineNumberInput({
  defaultValue,
  onApply,
  onCancel,
}: {
  defaultValue: number;
  onApply: (value: number) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onApply(value);
    } else if (e.key === 'Escape') {
      onCancel();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setValue(v => v - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setValue(v => v + 1);
    }
  }, [value, onApply, onCancel]);

  return (
    <input
      ref={inputRef}
      type="number"
      className="w-10 text-center text-[11px] bg-zinc-800 border border-zinc-600 rounded text-zinc-200 outline-none focus:border-amber-500/50"
      value={value}
      onChange={(e) => setValue(parseInt(e.target.value, 10) || 0)}
      onKeyDown={handleKeyDown}
      onBlur={onCancel}
      autoFocus
    />
  );
}

export function TrackerView({
  session, activeTrack,
  playing, globalStep,
  onEventUpdate, onEventDelete, onEventAdd,
  onQuantize,
  onPatternLengthChange, onClearPattern,
  onRotate, onTranspose, onReverse, onDuplicate,
  cancelEditRef,
  onDeleteByIndices, onPasteEvents, onTransposeByIndices,
  onAddRegion, onRemoveRegion, onDuplicateRegion, onRenameRegion, onSetActiveRegion,
  onCursorStepChange,
  onNotePreview,
  onPlayFromRow,
  onSelectionChange,
  onAddPatternRef, onRemovePatternRef, onReorderPatternRef,
  onSetSequenceAutomation, onClearSequenceAutomation,
}: Props) {
  const activePatternId = getActivePattern(activeTrack).id;
  const patternDuration = getActivePattern(activeTrack).duration;
  const bpm = session.transport.bpm;

  // Compute the raw (fractional) local step for the active pattern.
  // In song mode, only highlight when the currently-playing pattern matches.
  const rawLocalStep: number | null = useMemo(() => {
    if (session.transport.mode === 'song') {
      const pos = resolveSequencePosition(globalStep, activeTrack.sequence, activeTrack.patterns);
      if (pos && pos.patternId === activePatternId) {
        return pos.localStep;
      }
      return null; // playing a different pattern
    }
    return patternDuration > 0 ? globalStep % patternDuration : 0;
  }, [globalStep, session.transport.mode, activeTrack.sequence, activeTrack.patterns, activePatternId, patternDuration]);

  // Smooth playhead via rAF interpolation (60fps), decoupled from scheduler tick
  const { playheadStep: smoothStep } = usePlayheadPosition(
    rawLocalStep ?? 0,
    playing && rawLocalStep !== null,
    bpm,
    patternDuration,
  );

  const currentStep = rawLocalStep !== null ? smoothStep : null;
  const activeRegion = activeTrack.patterns.length > 0 ? getActivePattern(activeTrack) : undefined;
  const hasEvents = activeRegion ? activeRegion.events.length > 0 : false;

  // Region rename state
  const [renamingRegionId, setRenamingRegionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleAddNote = useCallback((step: number, pitch?: number) => {
    if (!onEventAdd) return;
    const event: NoteEvent = { kind: 'note', at: step, pitch: pitch ?? 60, velocity: 0.8, duration: 1 };
    onEventAdd(step, event);
  }, [onEventAdd]);

  // Inline input state for Rotate and Transpose
  const [showRotateInput, setShowRotateInput] = useState(false);
  const [showTransposeInput, setShowTransposeInput] = useState(false);

  const buttonClass = "px-2 py-0.5 text-[9px] font-mono tracking-wide uppercase rounded border border-zinc-700/60 text-zinc-500 hover:text-zinc-400 hover:border-zinc-600 hover:bg-zinc-800 transition-colors cursor-pointer";

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Main content */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Toolbar */}
          <div className="flex items-center gap-3 px-4 py-1.5 bg-zinc-900 border-b border-zinc-700/60 shrink-0">
            {onPatternLengthChange && (
              <div className="flex items-center gap-1">
                <span className="text-zinc-600 text-[8px] font-mono uppercase tracking-widest">Length</span>
                <div className="flex gap-0.5">
                  {[4, 8, 16, 32, 64].map(len => (
                    <button
                      key={len}
                      onClick={() => onPatternLengthChange(len)}
                      className={`text-[9px] font-mono px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                        getActivePattern(activeTrack).duration === len
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          : 'text-zinc-500 hover:text-zinc-400 border-zinc-700/60 hover:bg-zinc-800 hover:border-zinc-600'
                      }`}
                    >
                      {len}
                    </button>
                  ))}
                </div>
                {onClearPattern && (
                  <button
                    onClick={onClearPattern}
                    className={buttonClass + " hover:!text-rose-400 hover:!border-rose-500/30 hover:!bg-rose-500/10"}
                    title="Clear all events in pattern"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
            {onPatternLengthChange && hasEvents && <div className="w-px h-4 bg-zinc-700/40" />}
            <div className="ml-auto flex items-center gap-2">
              {hasEvents && (
                <>
                  {/* Rotate */}
                  {onRotate && (
                    <div className="flex items-center gap-1">
                      <button
                        className={buttonClass}
                        onClick={() => {
                          setShowRotateInput(v => !v);
                          setShowTransposeInput(false);
                        }}
                        title="Rotate events forward/backward by N steps (undoable)"
                      >
                        Rotate
                      </button>
                      {showRotateInput && (
                        <InlineNumberInput
                          defaultValue={1}
                          onApply={(v) => {
                            onRotate(v);
                            setShowRotateInput(false);
                          }}
                          onCancel={() => setShowRotateInput(false)}
                        />
                      )}
                    </div>
                  )}
                  {/* Transpose */}
                  {onTranspose && (
                    <div className="flex items-center gap-1">
                      <button
                        className={buttonClass}
                        onClick={() => {
                          setShowTransposeInput(v => !v);
                          setShowRotateInput(false);
                        }}
                        title="Transpose note pitches by N semitones (undoable)"
                      >
                        Transpose
                      </button>
                      {showTransposeInput && (
                        <InlineNumberInput
                          defaultValue={1}
                          onApply={(v) => {
                            onTranspose(v);
                            setShowTransposeInput(false);
                          }}
                          onCancel={() => setShowTransposeInput(false)}
                        />
                      )}
                    </div>
                  )}
                  {/* Reverse */}
                  {onReverse && (
                    <button
                      className={buttonClass}
                      onClick={onReverse}
                      title="Reverse event positions (undoable)"
                    >
                      Reverse
                    </button>
                  )}
                  {/* Duplicate */}
                  {onDuplicate && (
                    <button
                      className={buttonClass}
                      onClick={onDuplicate}
                      title="Duplicate all events, doubling region length (undoable)"
                    >
                      Duplicate
                    </button>
                  )}
                  {/* Quantize */}
                  {onQuantize && (
                    <button
                      className={buttonClass}
                      onClick={onQuantize}
                      title="Snap all events to the nearest grid position (undoable)"
                    >
                      Quantize
                    </button>
                  )}
                </>
              )}
              <TrackerCheatSheet />
            </div>
          </div>

          {/* Pattern tabs */}
          {activeTrack.patterns.length > 0 && (
            <div className="flex items-center gap-0.5 px-4 py-1 bg-zinc-900 border-b border-zinc-700/30 shrink-0">
              {activeTrack.patterns.map((pat, idx) => {
                const isActive = activeRegion?.id === pat.id;
                const label = pat.name || `P${String(idx).padStart(2, '0')}`;
                return (
                  <div key={pat.id} className="flex items-center group">
                    {renamingRegionId === pat.id ? (
                      <input
                        className="w-16 text-[10px] font-mono bg-zinc-800 border border-amber-500/50 rounded px-1 py-0.5 text-zinc-200 outline-none"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            onRenameRegion?.(pat.id, renameValue);
                            setRenamingRegionId(null);
                          } else if (e.key === 'Escape') {
                            setRenamingRegionId(null);
                          }
                        }}
                        onBlur={() => setRenamingRegionId(null)}
                        autoFocus
                      />
                    ) : (
                      <button
                        className={`px-2.5 py-0.5 rounded font-mono text-[10px] transition-colors outline-none cursor-pointer ${
                          isActive
                            ? 'bg-amber-400/10 text-amber-400 border border-amber-400/20'
                            : 'text-zinc-500 hover:text-zinc-400 border border-transparent hover:bg-zinc-800'
                        }`}
                        onClick={() => onSetActiveRegion?.(pat.id)}
                        onDoubleClick={() => {
                          setRenamingRegionId(pat.id);
                          setRenameValue(pat.name || '');
                        }}
                        onKeyDown={(e) => {
                          if ((e.key === 'Delete' || e.key === 'Backspace') && isActive && activeTrack.patterns.length > 1) {
                            e.preventDefault();
                            e.stopPropagation();
                            onRemoveRegion?.(pat.id);
                          }
                        }}
                        title={`Pattern ${idx + 1}${pat.name ? `: ${pat.name}` : ''} -- double-click to rename, Delete to remove`}
                      >
                        {label}
                      </button>
                    )}
                    {isActive && (
                      <button
                        className="ml-0.5 text-zinc-600 hover:text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => onDuplicateRegion?.(pat.id)}
                        title="Duplicate pattern"
                      >
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="5.5" y="5.5" width="9" height="9" rx="1" />
                          <path d="M10.5 5.5V2.5a1 1 0 0 0-1-1h-7a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h3" />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}
              {onAddRegion && (
                <button
                  className="px-1.5 py-0.5 text-zinc-600 hover:text-zinc-300 transition-colors font-mono text-[10px]"
                  onClick={onAddRegion}
                  title="Add new pattern"
                >
                  +
                </button>
              )}
            </div>
          )}

          {/* Sequence editor (shown in song mode, or always when multiple patterns exist) */}
          {onAddPatternRef && onRemovePatternRef && onReorderPatternRef && (
            session.transport.mode === 'song' || activeTrack.sequence.length > 1 || activeTrack.patterns.length > 1
          ) && (
            <SequenceEditor
              track={activeTrack}
              globalStep={globalStep}
              playing={playing}
              isSongMode={session.transport.mode === 'song'}
              onAddPatternRef={onAddPatternRef}
              onRemovePatternRef={onRemovePatternRef}
              onReorderPatternRef={onReorderPatternRef}
              onSetSequenceAutomation={onSetSequenceAutomation}
              onClearSequenceAutomation={onClearSequenceAutomation}
            />
          )}

          {/* Full-height tracker scroll container */}
          <div className="flex-1 min-h-0 overflow-y-auto bg-zinc-950">
            {activeRegion ? (
              activeTrack.drumRack && activeTrack.drumRack.pads.length > 0 ? (
                <DrumLaneTracker
                  region={activeRegion}
                  pads={activeTrack.drumRack.pads}
                  playheadStep={currentStep}
                  playing={playing}
                  stepsPerBeat={4}
                />
              ) : (
                <Tracker
                  region={activeRegion}
                  playheadStep={currentStep}
                  playing={playing}
                  onUpdate={onEventUpdate}
                  onDelete={onEventDelete}
                  onAddNote={onEventAdd ? handleAddNote : undefined}
                  onAddParamEvent={onEventAdd ? (at, controlId, value) => {
                    onEventAdd(at, { kind: 'parameter', at, controlId, value });
                  } : undefined}
                  cancelEditRef={cancelEditRef}
                  onDeleteByIndices={onDeleteByIndices}
                  onPasteEvents={onPasteEvents}
                  onTransposeByIndices={onTransposeByIndices}
                  onCursorStepChange={onCursorStepChange}
                  onNotePreview={onNotePreview}
                  onPlayFromRow={onPlayFromRow}
                  onSelectionChange={onSelectionChange}
                  stepsPerBeat={16 / (session.transport.timeSignature?.denominator ?? 4)}
                />
              )
            ) : (
              <div className="px-4 py-8 text-center text-[11px] text-zinc-600 italic">
                No patterns
              </div>
            )}
          </div>

          {/* Automation lane (collapsible, below tracker) */}
          {activeRegion && onEventAdd && (
            <AutomationPanel
              track={activeTrack}
              region={activeRegion}
              currentStep={currentStep ?? 0}
              playing={playing}
              onEventAdd={onEventAdd}
              onEventUpdate={onEventUpdate}
              onEventDelete={onEventDelete}
            />
          )}
        </div>
      </div>
    </div>
  );
}
