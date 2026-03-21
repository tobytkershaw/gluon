import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isEditable, useShortcuts } from '../../src/ui/useShortcuts';
import type { ViewMode } from '../../src/ui/view-types';

function buildActions() {
  return {
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onTogglePlay: vi.fn(),
    onPlayFromCursor: vi.fn(),
    onHardStop: vi.fn(),
    onToggleRecord: vi.fn(),
    onToggleMute: vi.fn(),
    onToggleSolo: vi.fn(),
    onTrackUp: vi.fn(),
    onTrackDown: vi.fn(),
    onBpmNudge: vi.fn(),
    onToggleTransportMode: vi.fn(),
    onCoinFlip: vi.fn(),
    setView: vi.fn<(updater: ViewMode | ((prev: ViewMode) => ViewMode)) => void>(),
  };
}

describe('useShortcuts', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.focus();
  });

  it('prefers redo over undo for mod+shift+z', () => {
    const actions = buildActions();
    renderHook(() => useShortcuts(actions));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true, bubbles: true }));
    });

    expect(actions.onRedo).toHaveBeenCalledOnce();
    expect(actions.onUndo).not.toHaveBeenCalled();
  });

  it('cycles views on Tab when the tracker is not focused', () => {
    const actions = buildActions();
    renderHook(() => useShortcuts(actions));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });

    expect(actions.setView).toHaveBeenCalledOnce();
    const updater = actions.setView.mock.calls[0][0] as (view: ViewMode) => ViewMode;
    expect(updater('chat')).toBe('surface');
    expect(updater('tracker')).toBe('chat');
  });

  it('does not steal Tab or arrow navigation when tracker scope is focused', () => {
    const actions = buildActions();
    const tracker = document.createElement('div');
    tracker.setAttribute('data-shortcut-scope', 'tracker');
    tracker.tabIndex = 0;
    document.body.appendChild(tracker);
    tracker.focus();

    renderHook(() => useShortcuts(actions));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });

    expect(actions.setView).not.toHaveBeenCalled();
    expect(actions.onTrackUp).not.toHaveBeenCalled();
    expect(actions.onTrackDown).not.toHaveBeenCalled();
  });

  it('routes transport and track keys before the keyboard piano can use them', () => {
    const actions = buildActions();
    renderHook(() => useShortcuts(actions));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'S', shiftKey: true, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '[', shiftKey: true, bubbles: true }));
    });

    expect(actions.onToggleRecord).toHaveBeenCalledOnce();
    expect(actions.onToggleMute).toHaveBeenCalledOnce();
    expect(actions.onToggleSolo).toHaveBeenNthCalledWith(1, false);
    expect(actions.onToggleSolo).toHaveBeenNthCalledWith(2, true);
    expect(actions.onBpmNudge).toHaveBeenNthCalledWith(1, 1);
    expect(actions.onBpmNudge).toHaveBeenNthCalledWith(2, -10);
  });

  it('ignores unmodified shortcuts while editing text', () => {
    const actions = buildActions();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(isEditable()).toBe(true);

    renderHook(() => useShortcuts(actions));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });

    expect(actions.onToggleRecord).not.toHaveBeenCalled();
    expect(actions.onTogglePlay).not.toHaveBeenCalled();
  });
});
