// src/ui/useShortcuts.ts
// Global keyboard shortcut handler — extracted from App.tsx.
import { useEffect } from 'react';
import type { ViewMode } from './view-types';

interface ShortcutActions {
  onUndo: () => void;
  onRedo: () => void;
  onTogglePlay: () => void;
  onHardStop: () => void;
  onToggleLoop?: () => void;
  setView: (updater: ViewMode | ((prev: ViewMode) => ViewMode)) => void;
  setChatOpen: (updater: boolean | ((prev: boolean) => boolean)) => void;
}

export function isEditable(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

export function useShortcuts({ onUndo, onRedo, onTogglePlay, onHardStop, onToggleLoop, setView, setChatOpen }: ShortcutActions) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd+Shift+Z = redo (must check before Cmd+Z)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'z') {
        e.preventDefault();
        onRedo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        onUndo();
      }
      // Cmd+1–4 for view switching
      if ((e.metaKey || e.ctrlKey) && e.key === '1' && !isEditable()) {
        e.preventDefault();
        setView('surface');
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '2' && !isEditable()) {
        e.preventDefault();
        setView('rack');
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '3' && !isEditable()) {
        e.preventDefault();
        setView('patch');
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '4' && !isEditable()) {
        e.preventDefault();
        setView('tracker');
      }
      // Cmd+/ toggles chat sidebar
      if ((e.metaKey || e.ctrlKey) && e.key === '/' && !isEditable()) {
        e.preventDefault();
        setChatOpen((o: boolean) => !o);
      }
      // Tab cycles views: surface → rack → patch → tracker → surface
      if (e.key === 'Tab' && !isEditable()) {
        e.preventDefault();
        const order: ViewMode[] = ['surface', 'rack', 'patch', 'tracker'];
        setView((v: ViewMode) => order[(order.indexOf(v) + 1) % order.length]);
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
      }
      // L toggles loop on/off
      if ((e.key === 'l' || e.key === 'L') && !e.repeat && !isEditable() && !(e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onToggleLoop?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onUndo, onRedo, onTogglePlay, onHardStop, onToggleLoop, setView, setChatOpen]);
}
