import { render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSession } from '../engine/session';
import type { ProjectMeta } from '../engine/project-store';
import type { ViewMode } from './view-types';
import { AppShell } from './AppShell';

const session = createSession();
const noop = () => {};

function buildProps(view: ViewMode) {
  return {
    tracks: session.tracks,
    activeTrackId: session.activeTrackId,
    expandedTrackIds: [],
    activityMap: {},
    onSelectTrack: noop,
    onToggleTrackExpanded: noop,
    onToggleMute: noop,
    onToggleSolo: noop,
    onToggleAgency: noop,
    onRenameTrack: noop,
    onCycleApproval: noop,
    onAddTrack: noop,
    onRemoveTrack: noop,
    onSetMusicalRole: noop,
    onAddSend: noop,
    onRemoveSend: noop,
    onSetSendLevel: noop,
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
    chatOpen: true,
    onChatToggle: noop,
    chatWidth: 320,
    onChatResize: noop,
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
    children: <div>instrument body</div>,
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

    render(<AppShell {...buildProps(view)} />);

    expect(consoleError).not.toHaveBeenCalled();
  });
});
