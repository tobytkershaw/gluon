import { describe, expect, it } from 'vitest';
import { applyUndo } from '../../src/engine/primitives';
import { addTrack, createSession } from '../../src/engine/session';
import { getTrack } from '../../src/engine/types';
import type {
  ABRestoreSnapshot,
  ApprovalSnapshot,
  ChordProgressionSnapshot,
  DrumPadSnapshot,
  PatternCrudSnapshot,
  ScaleSnapshot,
  SendSnapshot,
  SequenceEditSnapshot,
  Session,
  SidechainSnapshot,
  Snapshot,
  SurfaceSnapshot,
  TrackPropertySnapshot,
  TrackRemoveSnapshot,
} from '../../src/engine/types';

function withSnapshot(session: Session, snapshot: Snapshot): Session {
  return { ...session, undoStack: [...session.undoStack, snapshot] };
}

describe('undo snapshot restore matrix', () => {
  it('reverts a surface snapshot and restores liveControls when present', () => {
    const session = createSession();
    const trackId = session.activeTrackId;
    const prevSurface = structuredClone(getTrack(session, trackId).surface);
    const prevLiveControls = [
      { id: 'lc-1', trackId, controlId: 'timbre', label: 'Timbre', min: 0, max: 1 },
    ];
    const modified = {
      ...session,
      liveControls: [],
      tracks: session.tracks.map(track => track.id === trackId
        ? {
            ...track,
            surface: {
              ...track.surface,
              modules: [{
                id: 'surf-1',
                type: 'macro',
                label: 'Macro',
                bindings: [{ target: { kind: 'source', param: 'timbre' }, depth: 1 }],
                position: { x: 1, y: 2, w: 3, h: 2 },
                config: {},
              }],
            },
          }
        : track),
    };
    const snapshot: SurfaceSnapshot = {
      kind: 'surface',
      trackId,
      prevSurface,
      prevLiveControls,
      timestamp: Date.now(),
      description: 'promote live control',
    };

    const undone = applyUndo(withSnapshot(modified, snapshot));
    expect(getTrack(undone, trackId).surface).toEqual(prevSurface);
    expect(undone.liveControls).toEqual(prevLiveControls);
  });

  it('reverts a legacy approval snapshot back to claimed=false for exploratory approval', () => {
    const session = createSession();
    const trackId = session.activeTrackId;
    const modified = {
      ...session,
      tracks: session.tracks.map(track => track.id === trackId ? { ...track, claimed: true } : track),
    };
    const snapshot: ApprovalSnapshot = {
      kind: 'approval',
      trackId,
      prevApproval: 'exploratory',
      timestamp: Date.now(),
      description: 'legacy approval restore',
    };

    const undone = applyUndo(withSnapshot(modified, snapshot));
    expect(getTrack(undone, trackId).claimed).toBe(false);
  });

  it('reverts a send snapshot', () => {
    let session = createSession();
    session = addTrack(session, 'bus')!;
    const trackId = session.activeTrackId;
    const prevSends = getTrack(session, trackId).sends;
    const modified = {
      ...session,
      tracks: session.tracks.map(track => track.id === trackId
        ? { ...track, sends: [{ busId: 'master-bus', level: 0.75 }] }
        : track),
    };
    const snapshot: SendSnapshot = {
      kind: 'send',
      trackId,
      prevSends,
      timestamp: Date.now(),
      description: 'send edit',
    };

    const undone = applyUndo(withSnapshot(modified, snapshot));
    expect(getTrack(undone, trackId).sends).toEqual(prevSends);
  });

  it('reverts a sidechain snapshot', () => {
    let session = createSession();
    session = addTrack(session)!;
    const sourceId = session.tracks[0].id;
    const targetId = session.tracks[1].id;
    const modified = {
      ...session,
      tracks: session.tracks.map(track => track.id === targetId
        ? {
            ...track,
            processors: [{ id: 'comp-1', type: 'compressor', model: 0, params: {}, sidechainSourceId: sourceId }],
          }
        : track),
    };
    const snapshot: SidechainSnapshot = {
      kind: 'sidechain',
      targetTrackId: targetId,
      processorId: 'comp-1',
      prevSourceId: undefined,
      timestamp: Date.now(),
      description: 'set sidechain',
    };

    const undone = applyUndo(withSnapshot(modified, snapshot));
    expect(getTrack(undone, targetId).processors?.[0].sidechainSourceId).toBeUndefined();
  });

  it('reverts a track-remove snapshot and restores affected sends and sidechains', () => {
    let session = createSession();
    session = addTrack(session)!;
    session = addTrack(session, 'bus')!;
    const removedTrack = session.tracks[1];
    const sourceTrackId = session.tracks[0].id;
    const busId = session.tracks[2].id;
    const modified = {
      ...session,
      tracks: [
        {
          ...session.tracks[0],
          sends: [],
          processors: [{ id: 'comp-1', type: 'compressor', model: 0, params: {}, sidechainSourceId: undefined }],
        },
        session.tracks[2],
      ],
      activeTrackId: sourceTrackId,
    };
    const snapshot: TrackRemoveSnapshot = {
      kind: 'track-remove',
      removedTrack,
      removedIndex: 1,
      prevActiveTrackId: removedTrack.id,
      affectedSends: [{ trackId: sourceTrackId, prevSends: [{ busId, level: 0.5 }] }],
      affectedSidechains: [{ trackId: sourceTrackId, processorId: 'comp-1', prevSourceId: removedTrack.id }],
      timestamp: Date.now(),
      description: 'remove track',
    };

    const undone = applyUndo(withSnapshot(modified, snapshot));
    expect(undone.tracks[1].id).toBe(removedTrack.id);
    expect(getTrack(undone, sourceTrackId).sends).toEqual([{ busId, level: 0.5 }]);
    expect(getTrack(undone, sourceTrackId).processors?.[0].sidechainSourceId).toBe(removedTrack.id);
    expect(undone.activeTrackId).toBe(removedTrack.id);
  });

  it('reverts a track-property snapshot', () => {
    const session = createSession();
    const trackId = session.activeTrackId;
    const modified = {
      ...session,
      tracks: session.tracks.map(track => track.id === trackId
        ? { ...track, name: 'Renamed', mute: true, volume: 0.2 }
        : track),
    };
    const snapshot: TrackPropertySnapshot = {
      kind: 'track-property',
      trackId,
      prevProps: { name: getTrack(session, trackId).name, mute: false, volume: 0.8 },
      timestamp: Date.now(),
      description: 'track property edit',
    };

    const undone = applyUndo(withSnapshot(modified, snapshot));
    expect(getTrack(undone, trackId).name).toBe(getTrack(session, trackId).name);
    expect(getTrack(undone, trackId).mute).toBe(false);
    expect(getTrack(undone, trackId).volume).toBe(0.8);
  });

  it('reverts a sequence-edit snapshot using a deep clone of automation lanes', () => {
    const session = createSession();
    const trackId = session.activeTrackId;
    const prevSequence = [{
      patternId: getTrack(session, trackId).sequence[0].patternId,
      automation: [{ controlId: 'timbre', points: [{ at: 0, value: 0.2 }] }],
    }];
    const modified = {
      ...session,
      tracks: session.tracks.map(track => track.id === trackId
        ? {
            ...track,
            sequence: [{
              patternId: prevSequence[0].patternId,
              automation: [{ controlId: 'timbre', points: [{ at: 8, value: 0.9 }] }],
            }],
          }
        : track),
    };
    const snapshot: SequenceEditSnapshot = {
      kind: 'sequence-edit',
      trackId,
      prevSequence,
      timestamp: Date.now(),
      description: 'sequence edit',
    };

    const undone = applyUndo(withSnapshot(modified, snapshot));
    expect(getTrack(undone, trackId).sequence).toEqual(prevSequence);
    expect(getTrack(undone, trackId).sequence).not.toBe(prevSequence);
    expect(getTrack(undone, trackId)._patternDirty).toBe(true);
  });

  it('reverts an A/B restore snapshot', () => {
    let session = createSession();
    session = addTrack(session)!;
    const prevTracks = session.tracks;
    const prevTransport = session.transport;
    const prevMaster = session.master;
    const prevContext = session.context;
    const prevActiveTrackId = session.activeTrackId;
    const modified = {
      ...session,
      tracks: [session.tracks[0]],
      transport: { ...session.transport, bpm: 160 },
      master: { ...session.master, volume: 0.3 },
      context: { ...session.context, energy: 0.9 },
      activeTrackId: session.tracks[0].id,
    };
    const snapshot: ABRestoreSnapshot = {
      kind: 'ab-restore',
      prevTracks,
      prevTransport,
      prevMaster,
      prevContext,
      prevActiveTrackId,
      timestamp: Date.now(),
      description: 'restore slot B',
    };

    const undone = applyUndo(withSnapshot(modified, snapshot));
    expect(undone.tracks).toEqual(prevTracks);
    expect(undone.transport).toEqual(prevTransport);
    expect(undone.master).toEqual(prevMaster);
    expect(undone.context).toEqual(prevContext);
    expect(undone.activeTrackId).toBe(prevActiveTrackId);
  });

  it('reverts pattern-crud snapshots for add, remove, and rename', () => {
    const session = createSession();
    const trackId = session.activeTrackId;
    const track = getTrack(session, trackId);
    const basePattern = track.patterns[0];
    const addedPattern = { ...basePattern, id: 'pat-added', name: 'Added', events: [] };

    const afterAdd = {
      ...session,
      tracks: session.tracks.map(t => t.id === trackId
        ? { ...t, patterns: [...t.patterns, addedPattern], activePatternId: addedPattern.id }
        : t),
    };
    const addSnapshot: PatternCrudSnapshot = {
      kind: 'pattern-crud',
      trackId,
      action: 'add',
      addedPatternId: addedPattern.id,
      prevActivePatternId: basePattern.id,
      prevSequence: track.sequence,
      timestamp: Date.now(),
      description: 'add pattern',
    };
    const undoneAdd = applyUndo(withSnapshot(afterAdd, addSnapshot));
    expect(getTrack(undoneAdd, trackId).patterns.some(pattern => pattern.id === addedPattern.id)).toBe(false);

    const afterRemove = {
      ...session,
      tracks: session.tracks.map(t => t.id === trackId
        ? { ...t, patterns: [] }
        : t),
    };
    const removeSnapshot: PatternCrudSnapshot = {
      kind: 'pattern-crud',
      trackId,
      action: 'remove',
      removedPattern: basePattern,
      removedIndex: 0,
      prevActivePatternId: basePattern.id,
      prevSequence: track.sequence,
      timestamp: Date.now(),
      description: 'remove pattern',
    };
    const undoneRemove = applyUndo(withSnapshot(afterRemove, removeSnapshot));
    expect(getTrack(undoneRemove, trackId).patterns[0].id).toBe(basePattern.id);

    const afterRename = {
      ...session,
      tracks: session.tracks.map(t => t.id === trackId
        ? {
            ...t,
            patterns: t.patterns.map(pattern => pattern.id === basePattern.id ? { ...pattern, name: 'Renamed' } : pattern),
          }
        : t),
    };
    const renameSnapshot: PatternCrudSnapshot = {
      kind: 'pattern-crud',
      trackId,
      action: 'rename',
      patternId: basePattern.id,
      previousName: basePattern.name,
      timestamp: Date.now(),
      description: 'rename pattern',
    };
    const undoneRename = applyUndo(withSnapshot(afterRename, renameSnapshot));
    expect(getTrack(undoneRename, trackId).patterns[0].name).toBe(basePattern.name);
  });

  it('reverts a drum-pad snapshot including prior patterns and engine demotion', () => {
    const session = createSession();
    const trackId = session.activeTrackId;
    const prevPatterns = getTrack(session, trackId).patterns;
    const prevPads = [{
      id: 'kick',
      name: 'Kick',
      source: { engine: 'plaits', model: 13, params: { ...getTrack(session, trackId).params } },
      level: 0.8,
      pan: 0,
    }];
    const modified = {
      ...session,
      tracks: session.tracks.map(track => track.id === trackId
        ? {
            ...track,
            engine: 'drum-rack',
            model: -1,
            drumRack: { pads: [] },
            patterns: [{ ...track.patterns[0], events: [] }],
          }
        : track),
    };
    const snapshot: DrumPadSnapshot = {
      kind: 'drum-pad',
      trackId,
      prevPads,
      prevPatterns,
      prevEngine: '',
      prevModel: 0,
      timestamp: Date.now(),
      description: 'auto-promote to drum rack',
    };

    const undone = applyUndo(withSnapshot(modified, snapshot));
    expect(getTrack(undone, trackId).engine).toBe('');
    expect(getTrack(undone, trackId).drumRack).toBeUndefined();
    expect(getTrack(undone, trackId).patterns).toEqual(prevPatterns);
  });

  it('reverts scale and chord progression snapshots', () => {
    const session = createSession();
    const withScale = {
      ...session,
      scale: { tonic: 2, mode: 'dorian' as const },
      chordProgression: [{ bar: 0, chord: 'Dm9' }],
    };
    const scaleSnapshot: ScaleSnapshot = {
      kind: 'scale',
      prevScale: null,
      timestamp: Date.now(),
      description: 'set scale',
    };
    const chordSnapshot: ChordProgressionSnapshot = {
      kind: 'chord-progression',
      prevChordProgression: null,
      timestamp: Date.now(),
      description: 'set chords',
    };

    const afterScaleUndo = applyUndo(withSnapshot(withScale, chordSnapshot));
    expect(afterScaleUndo.chordProgression).toBeNull();

    const afterChordUndo = applyUndo(withSnapshot(withScale, scaleSnapshot));
    expect(afterChordUndo.scale).toBeNull();
  });
});
