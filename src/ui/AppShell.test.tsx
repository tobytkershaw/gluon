import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSession } from '../engine/session';
import type { ProjectMeta } from '../engine/project-store';
import type { ViewMode } from './view-types';
import { AppShell } from './AppShell';
type AppShellProps = Parameters<typeof AppShell>[0];

const session = createSession();
const noop = () => {};

function buildProps(view: ViewMode, overrides: Partial<AppShellProps> = {}): AppShellProps {
  return {
    tracks: session.tracks,
    activeTrackId: session.activeTrackId,
    expandedTrackIds: [],
    activityMap: {},
    onSelectTrack: noop,
    onToggleTrackExpanded: noop,
    onToggleMute: noop,
    onToggleSolo: noop,
    onRenameTrack: noop,
    onToggleClaim: noop,
    onAddTrack: noop,
    onRemoveTrack: noop,
    onSetMusicalRole: noop,
    onSetImportance: noop,
    onAddSend: noop,
    onRemoveSend: noop,
    onSetSendLevel: noop,
    runtimeDegradation: null,
    messages: [],
    onSend: noop,
    isThinking: false,
    isListening: false,
    reactions: [],
    openDecisions: [],
    onDecisionRespond: noop,
    apiConfigured: false,
    onApiKey: noop,
    currentOpenaiKey: '',
    currentGeminiKey: '',
    listenerMode: 'gemini' as const,
    onCoinFlip: noop,
    coinNotification: { isThinking: false, openDecisions: [], lastCompletionSummary: null },
    projectName: 'Test Project',
    projects: [] as ProjectMeta[],
    saveError: false,
    saveStatus: 'idle' as const,
    onProjectRename: noop,
    onProjectNew: noop,
    onProjectOpen: noop,
    onProjectDuplicate: noop,
    onProjectDelete: noop,
    onProjectExport: noop,
    onProjectImport: noop,
    onExportWav: noop,
    exportingWav: false,
    playing: false,
    bpm: 120,
    swing: 0,
    recordArmed: false,
    globalStep: 0,
    patternLength: 16,
    onTogglePlay: noop,
    onHardStop: noop,
    onBpmChange: noop,
    onSwingChange: noop,
    onToggleRecord: noop,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    onToggleMetronome: noop,
    onMetronomeVolumeChange: noop,
    transportMode: 'pattern' as const,
    loop: false,
    onTransportModeChange: noop,
    onLoopChange: noop,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    onTimeSignatureChange: noop,
    view,
    onViewChange: noop,
    undoStack: [],
    redoStack: [],
    onUndo: noop,
    onRedo: noop,
    onUndoMessage: noop,
    abActive: null as const,
    onAbCapture: noop,
    onAbToggle: noop,
    onAbClear: noop,
    masterVolume: 0.8,
    masterPan: 0,
    analyser: null,
    stereoAnalysers: null,
    audioContext: null,
    audioEngine: null,
    onMasterVolumeChange: noop,
    onMasterPanChange: noop,
    liveControlModules: [],
    onLiveModuleTouch: noop,
    onLiveModuleAddToSurface: noop,
    children: <div>instrument body</div>,
    ...overrides,
  };
}

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserver {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    globalThis.ResizeObserver = ResizeObserver as typeof globalThis.ResizeObserver;
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AppShell smoke render', () => {
  it.each<ViewMode>(['chat', 'surface'])('renders %s view without console errors', (view) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<AppShell {...buildProps(view, { apiConfigured: true })} />);

    expect(consoleError).not.toHaveBeenCalled();
  });

  it('switches to chat view from Cmd+L', async () => {
    const viewChange = vi.fn();
    function Harness() {
      const [view, setView] = useState<ViewMode>('surface');
      return (
        <AppShell
          {...buildProps(view, {
            apiConfigured: true,
            onViewChange: (v: ViewMode) => { setView(v); viewChange(v); },
          })}
        />
      );
    }

    render(<Harness />);

    const instrument = screen.getByText('instrument body').closest('[data-shortcut-scope="instrument"]') as HTMLElement;
    instrument.focus();
    fireEvent.keyDown(instrument, { key: 'l', metaKey: true });

    await waitFor(() => expect(viewChange).toHaveBeenCalledWith('chat'));
  });

  it('switches to instrument view on Escape from chat', async () => {
    const viewChange = vi.fn();
    function Harness() {
      const [view, setView] = useState<ViewMode>('chat');
      return (
        <AppShell
          {...buildProps(view, {
            apiConfigured: true,
            onViewChange: (v: ViewMode) => { setView(v); viewChange(v); },
          })}
        />
      );
    }

    render(<Harness />);

    const textarea = screen.getByRole('textbox');
    textarea.focus();
    fireEvent.keyDown(textarea, { key: 'Escape' });

    await waitFor(() => expect(viewChange).toHaveBeenCalledWith('surface'));
  });

  it('shows the audio degradation banner when provided', () => {
    render(<AppShell {...buildProps('surface')} runtimeDegradation="Audio runtime degraded: Plaits init failed, falling back to WebAudioSynth." />);

    expect(screen.getByText('Audio degraded')).toBeTruthy();
    expect(screen.getByText('Audio runtime degraded: Plaits init failed, falling back to WebAudioSynth.')).toBeTruthy();
  });

  it('shows degraded-mode banner when planner is not configured (chat view)', () => {
    render(<AppShell {...buildProps('chat', { apiConfigured: false })} />);
    expect(screen.getByTestId('degraded-banner')).toBeTruthy();
    expect(screen.getByTestId('degraded-banner').textContent).toContain('manual mode');
  });

  it('does not show degraded-mode banner on instrument tabs (no sidebar)', () => {
    render(<AppShell {...buildProps('surface', { apiConfigured: false })} />);
    expect(screen.queryByTestId('degraded-banner')).toBeNull();
  });

  it('does not show degraded-mode banner when planner is configured', () => {
    render(<AppShell {...buildProps('chat', { apiConfigured: true })} />);
    expect(screen.queryByTestId('degraded-banner')).toBeNull();
  });

  it('shows model status indicator', () => {
    render(<AppShell {...buildProps('chat', { apiConfigured: true, listenerConfigured: true })} />);
    expect(screen.getByTestId('model-status-label').textContent).toBe('AI Connected');
  });

  it('shows "no audio eval" when listener is unconfigured', () => {
    render(<AppShell {...buildProps('chat', { apiConfigured: true, listenerConfigured: false })} />);
    expect(screen.getByTestId('model-status-label').textContent).toContain('no audio eval');
  });

  it('keeps undo and redo controls available while an AI turn is active', () => {
    render(<AppShell {...buildProps('surface', {
      apiConfigured: true,
      isThinking: true,
      undoStack: [{ kind: 'transport', transport: session.transport, timestamp: 1, description: 'Undoable' }],
      redoStack: [{ kind: 'transport', transport: session.transport, timestamp: 2, description: 'Redoable' }],
    })} />);

    expect(screen.getByTitle('Undo: Undoable (⌘Z)')).toHaveProperty('disabled', false);
    expect(screen.getByTitle('Redo: Redoable (⌘⇧Z)')).toHaveProperty('disabled', false);
  });

  it('disables API settings changes while an AI turn is active (chat view)', () => {
    render(<AppShell {...buildProps('chat', {
      apiConfigured: true,
      isThinking: true,
    })} />);

    expect(screen.getByRole('button', { name: 'API Connected' })).toHaveProperty('disabled', true);
  });
});
