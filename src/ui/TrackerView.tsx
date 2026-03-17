// src/ui/TrackerView.tsx
// Thin shell: full-height Tracker (top bar moved to AppShell)
import { useState, useCallback, useRef, type MutableRefObject } from 'react';
import type { Session, Track } from '../engine/types';
import { getActivePattern } from '../engine/types';
import type { MusicalEvent, NoteEvent } from '../engine/canonical-types';
import type { EventSelector } from '../engine/event-primitives';
import { resolveSequencePosition } from '../engine/sequence-helpers';
import { getModelName } from '../audio/instrument-registry';
import { getTrackLabel } from '../engine/track-labels';
import { Tracker } from './Tracker';
import { TrackerCheatSheet } from './TrackerCheatSheet';
import { AutomationPanel } from './AutomationPanel';
import { SequenceEditor } from './SequenceEditor';

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
  // Region CRUD
  onAddRegion?: () => void;
  onRemoveRegion?: (patternId: string) => void;
  onDuplicateRegion?: (patternId: string) => void;
  onRenameRegion?: (patternId: string, name: string) => void;
  onSetActiveRegion?: (patternId: string) => void;
  /** Report cursor step position changes (for play-from-cursor). */
  onCursorStepChange?: (step: number) => void;
  // Sequence editor callbacks
  onAddPatternRef?: (patternId: string) => void;
  onRemovePatternRef?: (sequenceIndex: number) => void;
  onReorderPatternRef?: (fromIndex: number, toIndex: number) => void;
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
      className="w-10 text-center text-[10px] bg-zinc-800 border border-zinc-600 rounded text-zinc-200 outline-none focus:border-amber-500/50"
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
  onDeleteByIndices, onPasteEvents,
  onAddRegion, onRemoveRegion, onDuplicateRegion, onRenameRegion, onSetActiveRegion,
  onCursorStepChange,
  onAddPatternRef, onRemovePatternRef, onReorderPatternRef,
}: Props) {
  const activePatternId = getActivePattern(activeTrack).id;
  // In song mode, only highlight the playhead when the currently-playing pattern
  // matches the pattern being edited; otherwise pass null (no highlight).
  const currentStep = (() => {
    if (session.transport.mode === 'song') {
      const pos = resolveSequencePosition(globalStep, activeTrack.sequence, activeTrack.patterns);
      if (pos && pos.patternId === activePatternId) {
        return Math.floor(pos.localStep);
      }
      return null; // playing a different pattern
    }
    return Math.floor(globalStep % getActivePattern(activeTrack).duration);
  })();
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

  const buttonClass = "px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors";

  return (
    <div className="flex flex-col h-full">
      {/* Main content */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 flex flex-col gap-3 p-4">
          {/* Track header */}
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-medium tracking-wider uppercase text-zinc-300">
              {getTrackLabel(activeTrack)}
            </span>
            <span className="text-[10px] text-zinc-500">
              {getModelName(activeTrack.model)}
            </span>
            {onPatternLengthChange && (
              <div className="flex items-center gap-1 ml-4">
                <span className="text-zinc-500 text-[10px] uppercase tracking-wider">Len</span>
                <div className="flex gap-0.5">
                  {[4, 8, 16, 32, 64].map(len => (
                    <button
                      key={len}
                      onClick={() => onPatternLengthChange(len)}
                      className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                        getActivePattern(activeTrack).duration === len
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {len}
                    </button>
                  ))}
                </div>
                {onClearPattern && (
                  <button
                    onClick={onClearPattern}
                    className="text-[10px] text-zinc-500 hover:text-red-400 transition-colors px-1.5 py-0.5 rounded hover:bg-red-500/10"
                    title="Clear all events in pattern"
                  >
                    CLR
                  </button>
                )}
              </div>
            )}
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
            <div className="flex items-center gap-1 text-[10px]">
              {activeTrack.patterns.map((pat, idx) => {
                const isActive = activeRegion?.id === pat.id;
                const label = pat.name || `P${idx + 1}`;
                return (
                  <div key={pat.id} className="flex items-center group">
                    {renamingRegionId === pat.id ? (
                      <input
                        className="w-16 text-[10px] bg-zinc-800 border border-amber-500/50 rounded px-1 py-0.5 text-zinc-200 outline-none"
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
                        className={`px-2 py-0.5 rounded transition-colors ${
                          isActive
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            : 'text-zinc-500 hover:text-zinc-300 border border-transparent hover:border-zinc-700'
                        }`}
                        onClick={() => onSetActiveRegion?.(pat.id)}
                        onDoubleClick={() => {
                          setRenamingRegionId(pat.id);
                          setRenameValue(pat.name || '');
                        }}
                        title={`Pattern ${idx + 1}${pat.name ? `: ${pat.name}` : ''} — double-click to rename`}
                      >
                        {label}
                      </button>
                    )}
                    {isActive && activeTrack.patterns.length > 1 && (
                      <button
                        className="ml-0.5 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => onRemoveRegion?.(pat.id)}
                        title="Remove pattern"
                      >
                        x
                      </button>
                    )}
                    {isActive && (
                      <button
                        className="ml-0.5 text-zinc-600 hover:text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => onDuplicateRegion?.(pat.id)}
                        title="Duplicate pattern"
                      >
                        d
                      </button>
                    )}
                  </div>
                );
              })}
              {onAddRegion && (
                <button
                  className="px-1.5 py-0.5 text-zinc-600 hover:text-zinc-300 transition-colors"
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
            />
          )}

          {/* Full-height tracker scroll container */}
          <div className="flex-1 min-h-0 overflow-y-auto rounded border border-zinc-800/50 bg-zinc-900/40">
            {activeRegion ? (
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
                onCursorStepChange={onCursorStepChange}
                stepsPerBeat={16 / (session.transport.timeSignature?.denominator ?? 4)}
              />
            ) : (
              <div className="px-4 py-8 text-center text-[10px] text-zinc-600 italic">
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
