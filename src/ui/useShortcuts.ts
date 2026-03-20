// src/ui/useShortcuts.ts
// Global keyboard shortcut handler — extracted from App.tsx.
import { useEffect, useState, useCallback } from 'react';
import type { ViewMode } from './view-types';

interface ShortcutActions {
  onUndo: () => void;
  onRedo: () => void;
  onTogglePlay: () => void;
  onPlayFromCursor: () => void;
  onHardStop: () => void;
  onToggleRecord: () => void;
  onToggleMute: () => void;
  onToggleSolo: (additive?: boolean) => void;
  onTrackUp: () => void;
  onTrackDown: () => void;
  onBpmNudge: (delta: number) => void;
  onToggleTransportMode?: () => void;
  onCoinFlip?: () => void;
  setView: (updater: ViewMode | ((prev: ViewMode) => ViewMode)) => void;
}

export function isEditable(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

/** Returns true when focus is inside the tracker grid (which handles its own arrow keys). */
function isTrackerFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  return !!(el as HTMLElement).closest?.('[data-shortcut-scope="tracker"]');
}

/** Shortcut definition for the reference panel. */
export interface ShortcutDef {
  key: string;
  label: string;
  section: 'transport' | 'view' | 'mixing' | 'editing' | 'tracker' | 'chat' | 'piano';
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
const mod = isMac ? '\u2318' : 'Ctrl+';

export const SHORTCUT_DEFS: ShortcutDef[] = [
  // Transport
  { key: 'Space', label: 'Play / Pause', section: 'transport' },
  { key: 'Shift+Space', label: 'Hard stop (silence all)', section: 'transport' },
  { key: `${mod}Shift+Space`, label: 'Play from cursor', section: 'transport' },
  { key: 'R', label: 'Toggle record arm', section: 'transport' },
  { key: ']', label: 'BPM +1', section: 'transport' },
  { key: '[', label: 'BPM -1', section: 'transport' },
  { key: 'Shift+]', label: 'BPM +10', section: 'transport' },
  { key: 'Shift+[', label: 'BPM -10', section: 'transport' },
  { key: 'L', label: 'Pattern / Song mode', section: 'transport' },
  // View
  { key: `${mod}1`, label: 'Chat view', section: 'view' },
  { key: `${mod}2`, label: 'Surface view', section: 'view' },
  { key: `${mod}3`, label: 'Rack view', section: 'view' },
  { key: `${mod}4`, label: 'Patch view', section: 'view' },
  { key: `${mod}5`, label: 'Tracker view', section: 'view' },
  { key: 'Tab', label: 'Cycle views', section: 'view' },
  { key: 'F6', label: 'Cycle focus between regions', section: 'view' },
  { key: 'Shift+F6', label: 'Cycle focus (reverse)', section: 'view' },
  { key: `${mod}K`, label: 'Flip between Chat and instrument', section: 'view' },
  { key: `${mod}?`, label: 'Shortcuts reference', section: 'view' },
  // Mixing
  { key: 'M', label: 'Mute active track', section: 'mixing' },
  { key: 'S', label: 'Solo active track (exclusive)', section: 'mixing' },
  { key: 'Shift+S', label: 'Solo active track (additive)', section: 'mixing' },
  { key: '\u2191 / \u2193', label: 'Switch track', section: 'mixing' },
  // Editing
  { key: `${mod}Z`, label: 'Undo', section: 'editing' },
  { key: `${mod}Shift+Z`, label: 'Redo', section: 'editing' },
  // Tracker
  { key: 'Arrows', label: 'Navigate grid', section: 'tracker' },
  { key: 'Tab / Shift+Tab', label: 'Next / prev column', section: 'tracker' },
  { key: 'PgUp / PgDn', label: 'Jump 8 rows', section: 'tracker' },
  { key: 'Home / End', label: 'First / last row', section: 'tracker' },
  { key: 'Enter', label: 'Edit cell', section: 'tracker' },
  { key: 'Escape', label: 'Cancel / Deselect', section: 'tracker' },
  { key: `${mod}A`, label: 'Select all', section: 'tracker' },
  { key: 'Shift+Arrows', label: 'Extend selection', section: 'tracker' },
  { key: `${mod}C / ${mod}X / ${mod}V`, label: 'Copy / Cut / Paste', section: 'tracker' },
  { key: `${mod}Shift+\u2191/\u2193`, label: 'Transpose selection', section: 'tracker' },
  { key: 'Delete', label: 'Remove event(s)', section: 'tracker' },
  // Chat
  { key: `${mod}/`, label: 'Jump to chat view', section: 'chat' },
  { key: 'Enter', label: 'Send message', section: 'chat' },
  // Keyboard Piano
  { key: 'Z–M', label: 'Lower octave (white keys)', section: 'piano' },
  { key: 'S D G H J', label: 'Lower octave (black keys)', section: 'piano' },
  { key: 'Q–U', label: 'Upper octave (white keys)', section: 'piano' },
  { key: '2 3 5 6 7', label: 'Upper octave (black keys)', section: 'piano' },
  { key: '- / =', label: 'Octave down / up', section: 'piano' },
];

export function useShortcuts({
  onUndo, onRedo, onTogglePlay, onPlayFromCursor, onHardStop, onToggleRecord,
  onToggleMute, onToggleSolo, onTrackUp, onTrackDown, onBpmNudge,
  onToggleTransportMode, onCoinFlip, setView,
}: ShortcutActions) {
  const [showShortcuts, setShowShortcuts] = useState(false);
  const toggleShortcuts = useCallback(() => setShowShortcuts(o => !o), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;

      // Cmd+Shift+Z = redo (must check before Cmd+Z)
      if (isMod && e.shiftKey && e.key === 'z') {
        e.preventDefault();
        onRedo();
        return;
      }
      if (isMod && e.key === 'z') {
        e.preventDefault();
        onUndo();
        return;
      }
      // Cmd+K = coin flip: toggle between chat and last instrument view
      if (isMod && e.key === 'k' && !isEditable()) {
        e.preventDefault();
        onCoinFlip?.();
        return;
      }
      // Cmd+? (Cmd+Shift+/) toggles shortcuts reference
      if (isMod && e.shiftKey && e.key === '?' && !isEditable()) {
        e.preventDefault();
        setShowShortcuts(o => !o);
        return;
      }
      // Cmd+1–5 for view switching
      if (isMod && e.key === '1' && !isEditable()) {
        e.preventDefault();
        setView('chat');
        return;
      }
      if (isMod && e.key === '2' && !isEditable()) {
        e.preventDefault();
        setView('surface');
        return;
      }
      if (isMod && e.key === '3' && !isEditable()) {
        e.preventDefault();
        setView('rack');
        return;
      }
      if (isMod && e.key === '4' && !isEditable()) {
        e.preventDefault();
        setView('patch');
        return;
      }
      if (isMod && e.key === '5' && !isEditable()) {
        e.preventDefault();
        setView('tracker');
        return;
      }
      // Cmd+/ jumps to the chat tab
      if (isMod && e.key === '/' && !isEditable()) {
        e.preventDefault();
        setView('chat');
        return;
      }
      // Tab cycles views: chat → surface → rack → patch → tracker → chat
      // Skip when tracker is focused (tracker uses Tab for column cycling)
      if (e.key === 'Tab' && !isEditable() && !isTrackerFocused()) {
        e.preventDefault();
        const order: ViewMode[] = ['chat', 'surface', 'rack', 'patch', 'tracker'];
        setView((v: ViewMode) => order[(order.indexOf(v) + 1) % order.length]);
        return;
      }
      // Cmd/Ctrl+Shift+Space for play from cursor position
      if (e.key === ' ' && isMod && e.shiftKey && !e.repeat && !isEditable()) {
        e.preventDefault();
        onPlayFromCursor();
        return;
      }
      // Shift+Space for hard stop (silence all voices immediately)
      if (e.key === ' ' && e.shiftKey && !e.repeat && !isEditable()) {
        e.preventDefault();
        onHardStop();
        return;
      }
      // Space for play/pause (tails ring out on stop)
      if (e.key === ' ' && !e.repeat && !isEditable()) {
        e.preventDefault();
        onTogglePlay();
        return;
      }

      // --- Unmodified key shortcuts (skip when editing or with modifiers) ---
      if (isEditable() || isMod || e.altKey) return;

      // R = toggle record arm
      // M = mute active track
      // S = solo active track
      // These take priority over the keyboard piano for these keys.
      // stopImmediatePropagation prevents the piano handler from also firing.
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onToggleRecord();
        return;
      }
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onToggleMute();
        return;
      }
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onToggleSolo(e.shiftKey);
        return;
      }

      // L = toggle transport mode (pattern ↔ song)
      if ((e.key === 'l' || e.key === 'L') && !e.repeat) {
        e.preventDefault();
        onToggleTransportMode?.();
        return;
      }

      // Up/Down arrows = switch track (only when tracker grid is not focused)
      if (e.key === 'ArrowUp' && !isTrackerFocused()) {
        e.preventDefault();
        onTrackUp();
        return;
      }
      if (e.key === 'ArrowDown' && !isTrackerFocused()) {
        e.preventDefault();
        onTrackDown();
        return;
      }

      // ] / [ = BPM nudge (+/- 1, with Shift +/- 10)
      if (e.key === ']' || e.key === '}') {
        e.preventDefault();
        onBpmNudge(e.shiftKey ? 10 : 1);
        return;
      }
      if (e.key === '[' || e.key === '{') {
        e.preventDefault();
        onBpmNudge(e.shiftKey ? -10 : -1);
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onUndo, onRedo, onTogglePlay, onPlayFromCursor, onHardStop, onToggleRecord,
      onToggleMute, onToggleSolo, onTrackUp, onTrackDown, onBpmNudge,
      onToggleTransportMode, onCoinFlip, setView]);

  return { showShortcuts, toggleShortcuts };
}
