// src/ui/useShortcuts.ts
// Global keyboard shortcut handler — extracted from App.tsx.
import { useEffect } from 'react';
import type { ViewMode } from './view-types';

interface ShortcutActions {
  onUndo: () => void;
  onTogglePlay: () => void;
  setView: (updater: ViewMode | ((prev: ViewMode) => ViewMode)) => void;
  setChatOpen: (updater: boolean | ((prev: boolean) => boolean)) => void;
}

function isEditable(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

export function useShortcuts({ onUndo, onTogglePlay, setView, setChatOpen }: ShortcutActions) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        onUndo();
      }
      // Cmd+1 / Cmd+2 for view switching
      if ((e.metaKey || e.ctrlKey) && e.key === '1' && !isEditable()) {
        e.preventDefault();
        setView('instrument');
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '2' && !isEditable()) {
        e.preventDefault();
        setView('tracker');
      }
      // Cmd+/ toggles chat sidebar
      if ((e.metaKey || e.ctrlKey) && e.key === '/' && !isEditable()) {
        e.preventDefault();
        setChatOpen((o: boolean) => !o);
      }
      // Tab cycles views: instrument ↔ tracker
      if (e.key === 'Tab' && !isEditable()) {
        e.preventDefault();
        setView((v: ViewMode) => v === 'instrument' ? 'tracker' : 'instrument');
      }
      // Space for play/stop
      if (e.key === ' ' && !e.repeat && !isEditable()) {
        e.preventDefault();
        onTogglePlay();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onUndo, onTogglePlay, setView, setChatOpen]);
}
