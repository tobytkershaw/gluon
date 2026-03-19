import { describe, it, expect } from 'vitest';
import { executeOperations } from '../../src/engine/operation-executor';
import { createSession } from '../../src/engine/session';
import { Arbitrator } from '../../src/engine/arbitration';
import { applyUndo } from '../../src/engine/primitives';
import { getTrack, getActivePattern, updateTrack } from '../../src/engine/types';
import type { SourceAdapter } from '../../src/engine/canonical-types';
import type { AIAction, DrumRackConfig, DrumPad } from '../../src/engine/types';

function createTestAdapter(): SourceAdapter {
  return {
    id: 'test',
    name: 'Test Adapter',
    mapControl(controlId: string) {
      const map: Record<string, string> = { frequency: 'note' };
      return { adapterId: 'test', path: `params.${map[controlId] ?? controlId}` };
    },
    mapRuntimeParamKey(paramKey: string) {
      const map: Record<string, string> = { note: 'frequency' };
      const known = new Set(['timbre', 'harmonics', 'morph']);
      if (map[paramKey]) return map[paramKey];
      if (known.has(paramKey)) return paramKey;
      return null;
    },
    applyControlChanges() {},
    mapEvents() { return []; },
    readControlState() { return {}; },
    readRegions() { return []; },
    getControlSchemas() { return []; },
    validateOperation() { return { valid: true }; },
    midiToNormalisedPitch(midi: number) { return midi / 127; },
    normalisedPitchToMidi(n: number) { return Math.round(n * 127); },
  };
}

/** Create a session with one drum rack track and initial pads. */
function setupDrumRackSession() {
  let session = createSession();
  const trackId = session.tracks[0].id;

  // Set the track to drum-rack engine
  session = updateTrack(session, trackId, {
    engine: 'drum-rack',
    drumRack: {
      pads: [
        {
          id: 'kick',
          name: 'Kick',
          source: { engine: 'plaits', model: 13, params: { timbre: 0.5, morph: 0.3, harmonics: 0.4 } },
          level: 0.8,
          pan: 0.5,
        },
        {
          id: 'snare',
          name: 'Snare',
          source: { engine: 'plaits', model: 14, params: { timbre: 0.6, morph: 0.5, harmonics: 0.3 } },
          level: 0.75,
          pan: 0.5,
        },
        {
          id: 'hat',
          name: 'Hat',
          source: { engine: 'plaits', model: 15, params: { timbre: 0.7, morph: 0.4, harmonics: 0.5 } },
          chokeGroup: 1,
          level: 0.6,
          pan: 0.3,
        },
      ],
    },
  });

  return { session, trackId };
}

describe('drum-rack-actions', () => {
  const adapter = createTestAdapter();

  describe('manage_drum_pad', () => {
    it('adds a pad to the drum rack', () => {
      const { session, trackId } = setupDrumRackSession();
      const actions: AIAction[] = [{
        type: 'manage_drum_pad',
        trackId,
        action: 'add',
        padId: 'clap',
        name: 'Clap',
        model: 'analog-snare',
        description: 'add clap pad',
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.accepted).toHaveLength(1);
      expect(report.rejected).toHaveLength(0);

      const track = getTrack(report.session, trackId);
      expect(track.drumRack?.pads).toHaveLength(4);
      expect(track.drumRack?.pads[3].id).toBe('clap');
      expect(track.drumRack?.pads[3].name).toBe('Clap');
    });

    it('removes a pad from the drum rack', () => {
      const { session, trackId } = setupDrumRackSession();
      const actions: AIAction[] = [{
        type: 'manage_drum_pad',
        trackId,
        action: 'remove',
        padId: 'hat',
        description: 'remove hat pad',
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.accepted).toHaveLength(1);

      const track = getTrack(report.session, trackId);
      expect(track.drumRack?.pads).toHaveLength(2);
      expect(track.drumRack?.pads.some(p => p.id === 'hat')).toBe(false);
    });

    it('renames a pad', () => {
      const { session, trackId } = setupDrumRackSession();
      const actions: AIAction[] = [{
        type: 'manage_drum_pad',
        trackId,
        action: 'rename',
        padId: 'kick',
        name: 'Bass Drum',
        description: 'rename kick',
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.accepted).toHaveLength(1);

      const track = getTrack(report.session, trackId);
      expect(track.drumRack?.pads.find(p => p.id === 'kick')?.name).toBe('Bass Drum');
    });

    it('sets choke group on a pad', () => {
      const { session, trackId } = setupDrumRackSession();
      const actions: AIAction[] = [{
        type: 'manage_drum_pad',
        trackId,
        action: 'set_choke_group',
        padId: 'kick',
        chokeGroup: 2,
        description: 'set kick choke group',
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.accepted).toHaveLength(1);

      const track = getTrack(report.session, trackId);
      expect(track.drumRack?.pads.find(p => p.id === 'kick')?.chokeGroup).toBe(2);
    });

    it('clears choke group with null', () => {
      const { session, trackId } = setupDrumRackSession();
      const actions: AIAction[] = [{
        type: 'manage_drum_pad',
        trackId,
        action: 'set_choke_group',
        padId: 'hat',
        chokeGroup: null,
        description: 'clear hat choke group',
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.accepted).toHaveLength(1);

      const track = getTrack(report.session, trackId);
      expect(track.drumRack?.pads.find(p => p.id === 'hat')?.chokeGroup).toBeUndefined();
    });

    it('rejects add when pad ID already exists', () => {
      const { session, trackId } = setupDrumRackSession();
      const actions: AIAction[] = [{
        type: 'manage_drum_pad',
        trackId,
        action: 'add',
        padId: 'kick',
        model: 'analog-bass-drum',
        description: 'duplicate kick',
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('already exists');
    });

    it('rejects remove for non-existent pad', () => {
      const { session, trackId } = setupDrumRackSession();
      const actions: AIAction[] = [{
        type: 'manage_drum_pad',
        trackId,
        action: 'remove',
        padId: 'cowbell',
        description: 'remove non-existent',
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('not found');
    });

    it('rejects when track is not a drum rack', () => {
      const session = createSession();
      const trackId = session.tracks[0].id;
      const actions: AIAction[] = [{
        type: 'manage_drum_pad',
        trackId,
        action: 'add',
        padId: 'kick',
        model: 'analog-bass-drum',
        description: 'add to non-drum-rack',
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('not a drum rack');
    });

    it('rejects add beyond max pads', () => {
      const { session, trackId } = setupDrumRackSession();
      // Fill up to 16 pads
      let current = session;
      for (let i = 3; i < 16; i++) {
        const pads = getTrack(current, trackId).drumRack?.pads ?? [];
        current = updateTrack(current, trackId, {
          drumRack: {
            pads: [...pads, {
              id: `pad${i}`, name: `Pad ${i}`,
              source: { engine: 'plaits', model: 13, params: {} },
              level: 0.8, pan: 0.5,
            }],
          },
        });
      }

      const actions: AIAction[] = [{
        type: 'manage_drum_pad',
        trackId,
        action: 'add',
        padId: 'pad16',
        model: 'analog-bass-drum',
        description: 'exceed max pads',
      }];

      const report = executeOperations(current, actions, adapter, new Arbitrator());
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Maximum');
    });
  });

  describe('sketch with kit', () => {
    it('sketches a kit pattern using grid notation', () => {
      const { session, trackId } = setupDrumRackSession();
      const actions: AIAction[] = [{
        type: 'sketch',
        trackId,
        description: 'basic beat',
        kit: {
          'kick':  'x...x...',
          'snare': '....x...',
          'hat':   'hhhhhhhh',
        },
      }];

      // Ensure pattern has 8 steps to match grids
      let s = session;
      const track = getTrack(s, trackId);
      if (track.patterns.length > 0) {
        const pattern = getActivePattern(track);
        s = updateTrack(s, trackId, {
          patterns: track.patterns.map(p => p.id === pattern.id ? { ...p, duration: 8 } : p),
        });
      }

      const report = executeOperations(s, actions, adapter, new Arbitrator());
      expect(report.accepted).toHaveLength(1);
      expect(report.rejected).toHaveLength(0);

      const updatedTrack = getTrack(report.session, trackId);
      const events = getActivePattern(updatedTrack).events;

      // Should have: 2 kick + 1 snare + 8 hat = 11 events
      const kicks = events.filter(e => e.kind === 'trigger' && 'padId' in e && e.padId === 'kick');
      const snares = events.filter(e => e.kind === 'trigger' && 'padId' in e && e.padId === 'snare');
      const hats = events.filter(e => e.kind === 'trigger' && 'padId' in e && e.padId === 'hat');

      expect(kicks).toHaveLength(2);
      expect(snares).toHaveLength(1);
      expect(hats).toHaveLength(8);
    });

    it('preserves unmentioned pad events during kit sketch', () => {
      const { session, trackId } = setupDrumRackSession();

      // First, sketch all pads
      let s = session;
      const track = getTrack(s, trackId);
      if (track.patterns.length > 0) {
        const pattern = getActivePattern(track);
        s = updateTrack(s, trackId, {
          patterns: track.patterns.map(p => p.id === pattern.id ? { ...p, duration: 8 } : p),
        });
      }

      // Sketch initial hat pattern
      const setup: AIAction[] = [{
        type: 'sketch',
        trackId,
        description: 'initial hat',
        kit: { 'hat': 'hhhhhhhh' },
      }];
      const setupReport = executeOperations(s, setup, adapter, new Arbitrator());
      expect(setupReport.accepted).toHaveLength(1);

      // Now sketch kick only — hat should be preserved
      const actions: AIAction[] = [{
        type: 'sketch',
        trackId,
        description: 'add kick',
        kit: { 'kick': 'x...x...' },
      }];
      const report = executeOperations(setupReport.session, actions, adapter, new Arbitrator());
      expect(report.accepted).toHaveLength(1);

      const updatedTrack = getTrack(report.session, trackId);
      const events = getActivePattern(updatedTrack).events;
      const hats = events.filter(e => e.kind === 'trigger' && 'padId' in e && e.padId === 'hat');
      const kicks = events.filter(e => e.kind === 'trigger' && 'padId' in e && e.padId === 'kick');

      expect(hats).toHaveLength(8); // preserved
      expect(kicks).toHaveLength(2); // newly added
    });

    it('rejects kit sketch with wrong grid length', () => {
      const { session, trackId } = setupDrumRackSession();
      const actions: AIAction[] = [{
        type: 'sketch',
        trackId,
        description: 'wrong length',
        kit: { 'kick': 'x...x...x...' }, // 12 steps but pattern is 16
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Grid length');
    });

    it('rejects kit sketch referencing non-existent pad', () => {
      const { session, trackId } = setupDrumRackSession();
      const actions: AIAction[] = [{
        type: 'sketch',
        trackId,
        description: 'unknown pad',
        kit: { 'cowbell': 'x...............' },
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Pad not found');
    });
  });

  describe('move with per-pad params', () => {
    it('moves a per-pad source param (kick.timbre)', () => {
      const { session, trackId } = setupDrumRackSession();
      const actions: AIAction[] = [{
        type: 'move',
        trackId,
        param: 'kick.timbre',
        target: { absolute: 0.9 },
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.accepted).toHaveLength(1);

      const track = getTrack(report.session, trackId);
      expect(track.drumRack?.pads.find(p => p.id === 'kick')?.source.params.timbre).toBeCloseTo(0.9);
    });

    it('moves per-pad level', () => {
      const { session, trackId } = setupDrumRackSession();
      const actions: AIAction[] = [{
        type: 'move',
        trackId,
        param: 'snare.level',
        target: { absolute: 0.6 },
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.accepted).toHaveLength(1);

      const track = getTrack(report.session, trackId);
      expect(track.drumRack?.pads.find(p => p.id === 'snare')?.level).toBeCloseTo(0.6);
    });

    it('moves per-pad pan', () => {
      const { session, trackId } = setupDrumRackSession();
      const actions: AIAction[] = [{
        type: 'move',
        trackId,
        param: 'hat.pan',
        target: { absolute: 0.8 },
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.accepted).toHaveLength(1);

      const track = getTrack(report.session, trackId);
      expect(track.drumRack?.pads.find(p => p.id === 'hat')?.pan).toBeCloseTo(0.8);
    });

    it('rejects move on non-existent pad', () => {
      const { session, trackId } = setupDrumRackSession();
      const actions: AIAction[] = [{
        type: 'move',
        trackId,
        param: 'cowbell.timbre',
        target: { absolute: 0.5 },
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Drum pad not found');
    });
  });

  describe('set_model with pad', () => {
    it('changes a pad model', () => {
      const { session, trackId } = setupDrumRackSession();
      const actions: AIAction[] = [{
        type: 'set_model',
        trackId,
        pad: 'kick',
        model: 'analog-snare',
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.accepted).toHaveLength(1);

      const track = getTrack(report.session, trackId);
      const kick = track.drumRack?.pads.find(p => p.id === 'kick');
      expect(kick?.source.model).toBe(14); // analog-snare index
    });

    it('rejects set_model on non-existent pad', () => {
      const { session, trackId } = setupDrumRackSession();
      const actions: AIAction[] = [{
        type: 'set_model',
        trackId,
        pad: 'cowbell',
        model: 'analog-bass-drum',
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Pad not found');
    });
  });

  describe('transform with pad', () => {
    it('scopes euclidean transform to one pad', () => {
      const { session, trackId } = setupDrumRackSession();

      // First sketch a kit pattern on 8 steps
      let s = session;
      const track = getTrack(s, trackId);
      if (track.patterns.length > 0) {
        const pattern = getActivePattern(track);
        s = updateTrack(s, trackId, {
          patterns: track.patterns.map(p => p.id === pattern.id ? { ...p, duration: 8 } : p),
        });
      }

      const setupActions: AIAction[] = [{
        type: 'sketch',
        trackId,
        description: 'initial kick',
        kit: { 'kick': 'x.......', 'snare': '....x...' },
      }];
      const setupReport = executeOperations(s, setupActions, adapter, new Arbitrator());
      expect(setupReport.accepted).toHaveLength(1);

      // Apply euclidean to hat pad only
      const actions: AIAction[] = [{
        type: 'transform',
        trackId,
        pad: 'hat',
        operation: 'euclidean',
        hits: 5,
        velocity: 0.5,
        description: 'euclidean hats',
      }];

      const report = executeOperations(setupReport.session, actions, adapter, new Arbitrator());
      expect(report.accepted).toHaveLength(1);

      const updatedTrack = getTrack(report.session, trackId);
      const events = getActivePattern(updatedTrack).events;

      // Kick and snare should be preserved
      const kicks = events.filter(e => e.kind === 'trigger' && 'padId' in e && e.padId === 'kick');
      const snares = events.filter(e => e.kind === 'trigger' && 'padId' in e && e.padId === 'snare');
      const hats = events.filter(e => e.kind === 'trigger' && 'padId' in e && e.padId === 'hat');

      expect(kicks).toHaveLength(1); // preserved
      expect(snares).toHaveLength(1); // preserved
      expect(hats).toHaveLength(5); // euclidean generated
    });
  });

  describe('undo', () => {
    it('undoes manage_drum_pad add', () => {
      const { session, trackId } = setupDrumRackSession();
      const actions: AIAction[] = [{
        type: 'manage_drum_pad',
        trackId,
        action: 'add',
        padId: 'clap',
        name: 'Clap',
        model: 'analog-snare',
        description: 'add clap',
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(getTrack(report.session, trackId).drumRack?.pads).toHaveLength(4);

      const afterUndo = applyUndo(report.session);
      expect(getTrack(afterUndo, trackId).drumRack?.pads).toHaveLength(3);
      expect(getTrack(afterUndo, trackId).drumRack?.pads.some(p => p.id === 'clap')).toBe(false);
    });

    it('undoes per-pad param move', () => {
      const { session, trackId } = setupDrumRackSession();
      const originalTimbre = getTrack(session, trackId).drumRack?.pads.find(p => p.id === 'kick')?.source.params.timbre ?? 0;

      const actions: AIAction[] = [{
        type: 'move',
        trackId,
        param: 'kick.timbre',
        target: { absolute: 0.9 },
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(getTrack(report.session, trackId).drumRack?.pads.find(p => p.id === 'kick')?.source.params.timbre).toBeCloseTo(0.9);

      const afterUndo = applyUndo(report.session);
      expect(getTrack(afterUndo, trackId).drumRack?.pads.find(p => p.id === 'kick')?.source.params.timbre).toBeCloseTo(originalTimbre);
    });

    it('undoes per-pad model change', () => {
      const { session, trackId } = setupDrumRackSession();
      const originalModel = getTrack(session, trackId).drumRack?.pads.find(p => p.id === 'kick')?.source.model ?? 0;

      const actions: AIAction[] = [{
        type: 'set_model',
        trackId,
        pad: 'kick',
        model: 'analog-snare',
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(getTrack(report.session, trackId).drumRack?.pads.find(p => p.id === 'kick')?.source.model).toBe(14);

      const afterUndo = applyUndo(report.session);
      expect(getTrack(afterUndo, trackId).drumRack?.pads.find(p => p.id === 'kick')?.source.model).toBe(originalModel);
    });

    it('undoes kit sketch', () => {
      const { session, trackId } = setupDrumRackSession();

      let s = session;
      const track = getTrack(s, trackId);
      if (track.patterns.length > 0) {
        const pattern = getActivePattern(track);
        s = updateTrack(s, trackId, {
          patterns: track.patterns.map(p => p.id === pattern.id ? { ...p, duration: 8 } : p),
        });
      }

      const eventsBefore = getActivePattern(getTrack(s, trackId)).events.length;

      const actions: AIAction[] = [{
        type: 'sketch',
        trackId,
        description: 'kit sketch',
        kit: { 'kick': 'x...x...', 'snare': '....x...' },
      }];

      const report = executeOperations(s, actions, adapter, new Arbitrator());
      expect(report.accepted).toHaveLength(1);

      const eventsAfterSketch = getActivePattern(getTrack(report.session, trackId)).events.length;
      expect(eventsAfterSketch).toBeGreaterThan(0);

      const afterUndo = applyUndo(report.session);
      const eventsAfterUndo = getActivePattern(getTrack(afterUndo, trackId)).events.length;
      expect(eventsAfterUndo).toBe(eventsBefore);
    });
  });

  describe('full integration: create rack → add pads → sketch kit → edit lane → undo', () => {
    it('executes a full drum rack workflow', () => {
      const { session, trackId } = setupDrumRackSession();

      let s = session;
      const track = getTrack(s, trackId);
      if (track.patterns.length > 0) {
        const pattern = getActivePattern(track);
        s = updateTrack(s, trackId, {
          patterns: track.patterns.map(p => p.id === pattern.id ? { ...p, duration: 16 } : p),
        });
      }

      // Step 1: Add a new pad
      const addPadActions: AIAction[] = [{
        type: 'manage_drum_pad',
        trackId,
        action: 'add',
        padId: 'open-hat',
        name: 'Open Hat',
        model: 'analog-hi-hat',
        chokeGroup: 1,
        description: 'add open hat in choke group 1',
      }];
      const addReport = executeOperations(s, addPadActions, adapter, new Arbitrator());
      expect(addReport.accepted).toHaveLength(1);
      expect(getTrack(addReport.session, trackId).drumRack?.pads).toHaveLength(4);

      // Step 2: Sketch a full kit
      const sketchActions: AIAction[] = [{
        type: 'sketch',
        trackId,
        description: 'breakbeat skeleton',
        kit: {
          'kick':     'x...o...|x..o....',
          'snare':    '....x...|....x...',
          'hat':      'hHh.hHh.|hHh.hHh.',
          'open-hat': '.......O|.......O',
        },
      }];
      const sketchReport = executeOperations(addReport.session, sketchActions, adapter, new Arbitrator());
      expect(sketchReport.accepted).toHaveLength(1);

      const afterSketchTrack = getTrack(sketchReport.session, trackId);
      const events = getActivePattern(afterSketchTrack).events;
      expect(events.length).toBeGreaterThan(0);

      // Verify per-pad event counts
      const padCounts = new Map<string, number>();
      for (const e of events) {
        if (e.kind === 'trigger' && 'padId' in e && e.padId) {
          padCounts.set(e.padId, (padCounts.get(e.padId) ?? 0) + 1);
        }
      }
      expect(padCounts.get('kick')).toBe(4);
      expect(padCounts.get('snare')).toBe(2);
      expect(padCounts.get('hat')).toBe(12);
      expect(padCounts.get('open-hat')).toBe(2);

      // Step 3: Move a per-pad param
      const moveActions: AIAction[] = [{
        type: 'move',
        trackId,
        param: 'kick.timbre',
        target: { absolute: 0.3 },
      }];
      const moveReport = executeOperations(sketchReport.session, moveActions, adapter, new Arbitrator());
      expect(moveReport.accepted).toHaveLength(1);
      expect(getTrack(moveReport.session, trackId).drumRack?.pads.find(p => p.id === 'kick')?.source.params.timbre).toBeCloseTo(0.3);

      // Step 4: Set a pad model
      const modelActions: AIAction[] = [{
        type: 'set_model',
        trackId,
        pad: 'snare',
        model: 'modal-resonator',
      }];
      const modelReport = executeOperations(moveReport.session, modelActions, adapter, new Arbitrator());
      expect(modelReport.accepted).toHaveLength(1);

      // Step 5: Undo the model change
      const afterUndoModel = applyUndo(modelReport.session);
      const snareAfterUndo = getTrack(afterUndoModel, trackId).drumRack?.pads.find(p => p.id === 'snare');
      expect(snareAfterUndo?.source.model).toBe(14); // restored from analog-snare

      // Step 6: Undo the param move
      const afterUndoMove = applyUndo(afterUndoModel);
      const kickAfterUndo = getTrack(afterUndoMove, trackId).drumRack?.pads.find(p => p.id === 'kick');
      expect(kickAfterUndo?.source.params.timbre).toBeCloseTo(0.5); // restored

      // Step 7: Undo the sketch
      const afterUndoSketch = applyUndo(afterUndoMove);
      const eventsAfterUndoSketch = getActivePattern(getTrack(afterUndoSketch, trackId)).events;
      expect(eventsAfterUndoSketch.length).toBe(0); // back to empty pattern

      // Step 8: Undo the pad add
      const afterUndoAdd = applyUndo(afterUndoSketch);
      expect(getTrack(afterUndoAdd, trackId).drumRack?.pads).toHaveLength(3);
      expect(getTrack(afterUndoAdd, trackId).drumRack?.pads.some(p => p.id === 'open-hat')).toBe(false);
    });
  });

  describe('edit_pattern with pad', () => {
    it('adds a trigger scoped to a specific pad', () => {
      const { session, trackId } = setupDrumRackSession();

      // Set up 8-step pattern with a kick
      let s = session;
      const track = getTrack(s, trackId);
      if (track.patterns.length > 0) {
        const pattern = getActivePattern(track);
        s = updateTrack(s, trackId, {
          patterns: track.patterns.map(p => p.id === pattern.id ? { ...p, duration: 8 } : p),
        });
      }

      // Sketch initial kick
      const setupActions: AIAction[] = [{
        type: 'sketch',
        trackId,
        description: 'initial kick',
        kit: { 'kick': 'x.......' },
      }];
      const setupReport = executeOperations(s, setupActions, adapter, new Arbitrator());
      expect(setupReport.accepted).toHaveLength(1);

      // Add a snare trigger at step 4 using edit_pattern with pad scope
      const actions: AIAction[] = [{
        type: 'edit_pattern',
        trackId,
        pad: 'snare',
        operations: [{ action: 'add', step: 4, event: { type: 'trigger', velocity: 0.9 } }],
        description: 'add snare hit',
      }];

      const report = executeOperations(setupReport.session, actions, adapter, new Arbitrator());
      expect(report.accepted).toHaveLength(1);

      const events = getActivePattern(getTrack(report.session, trackId)).events;
      const snares = events.filter(e => e.kind === 'trigger' && 'padId' in e && e.padId === 'snare');
      const kicks = events.filter(e => e.kind === 'trigger' && 'padId' in e && e.padId === 'kick');

      expect(snares).toHaveLength(1);
      expect(snares[0].at).toBe(4);
      expect(kicks).toHaveLength(1); // kick preserved
    });

    it('removes a trigger scoped to a specific pad', () => {
      const { session, trackId } = setupDrumRackSession();

      let s = session;
      const track = getTrack(s, trackId);
      if (track.patterns.length > 0) {
        const pattern = getActivePattern(track);
        s = updateTrack(s, trackId, {
          patterns: track.patterns.map(p => p.id === pattern.id ? { ...p, duration: 8 } : p),
        });
      }

      // Sketch kick and snare at same step (0)
      const setupActions: AIAction[] = [{
        type: 'sketch',
        trackId,
        description: 'kick and snare on beat 1',
        kit: { 'kick': 'x.......', 'snare': 'x.......' },
      }];
      const setupReport = executeOperations(s, setupActions, adapter, new Arbitrator());
      expect(setupReport.accepted).toHaveLength(1);

      // Remove only the snare at step 0
      const actions: AIAction[] = [{
        type: 'edit_pattern',
        trackId,
        pad: 'snare',
        operations: [{ action: 'remove', step: 0, event: { type: 'trigger' } }],
        description: 'remove snare at step 0',
      }];

      const report = executeOperations(setupReport.session, actions, adapter, new Arbitrator());
      expect(report.accepted).toHaveLength(1);

      const events = getActivePattern(getTrack(report.session, trackId)).events;
      const snares = events.filter(e => e.kind === 'trigger' && 'padId' in e && e.padId === 'snare');
      const kicks = events.filter(e => e.kind === 'trigger' && 'padId' in e && e.padId === 'kick');

      expect(snares).toHaveLength(0); // snare removed
      expect(kicks).toHaveLength(1); // kick preserved
    });

    it('modifies a trigger scoped to a specific pad', () => {
      const { session, trackId } = setupDrumRackSession();

      let s = session;
      const track = getTrack(s, trackId);
      if (track.patterns.length > 0) {
        const pattern = getActivePattern(track);
        s = updateTrack(s, trackId, {
          patterns: track.patterns.map(p => p.id === pattern.id ? { ...p, duration: 8 } : p),
        });
      }

      // Sketch kick and snare at same step
      const setupActions: AIAction[] = [{
        type: 'sketch',
        trackId,
        description: 'kick and snare',
        kit: { 'kick': 'x.......', 'snare': 'x.......' },
      }];
      const setupReport = executeOperations(s, setupActions, adapter, new Arbitrator());

      // Modify only the kick's velocity at step 0
      const actions: AIAction[] = [{
        type: 'edit_pattern',
        trackId,
        pad: 'kick',
        operations: [{ action: 'modify', step: 0, event: { type: 'trigger', velocity: 0.3 } }],
        description: 'soften kick',
      }];

      const report = executeOperations(setupReport.session, actions, adapter, new Arbitrator());
      expect(report.accepted).toHaveLength(1);

      const events = getActivePattern(getTrack(report.session, trackId)).events;
      const kick = events.find(e => e.kind === 'trigger' && 'padId' in e && e.padId === 'kick');
      const snare = events.find(e => e.kind === 'trigger' && 'padId' in e && e.padId === 'snare');

      expect(kick).toBeDefined();
      expect((kick as any).velocity).toBeCloseTo(0.3);
      // Snare unchanged
      expect(snare).toBeDefined();
      expect((snare as any).velocity).toBeCloseTo(0.95); // accent velocity from 'x'
    });
  });

  describe('duplicate transform with pad rejection', () => {
    it('rejects duplicate transform when pad is scoped', () => {
      const { session, trackId } = setupDrumRackSession();
      const actions: AIAction[] = [{
        type: 'transform',
        trackId,
        pad: 'kick',
        operation: 'duplicate',
        description: 'duplicate kick only',
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Cannot duplicate');
    });
  });

  describe('manage_drum_pad validation', () => {
    it('rejects manage_drum_pad on track with engine but no drumRack config', () => {
      let session = createSession();
      const trackId = session.tracks[0].id;
      // Set engine to drum-rack but don't set drumRack config
      session = updateTrack(session, trackId, { engine: 'drum-rack' });

      const actions: AIAction[] = [{
        type: 'manage_drum_pad',
        trackId,
        action: 'add',
        padId: 'kick',
        model: 'analog-bass-drum',
        description: 'add to track without drumRack',
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('not a drum rack');
    });
  });

  describe('validation: padId on drum rack triggers', () => {
    it('rejects sketch events without padId on drum rack track', () => {
      const { session, trackId } = setupDrumRackSession();
      const actions: AIAction[] = [{
        type: 'sketch',
        trackId,
        description: 'missing padId',
        events: [
          { kind: 'trigger', at: 0, velocity: 0.8 },
        ],
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('padId');
    });

    it('rejects sketch events referencing non-existent pad', () => {
      const { session, trackId } = setupDrumRackSession();
      const actions: AIAction[] = [{
        type: 'sketch',
        trackId,
        description: 'wrong padId',
        events: [
          { kind: 'trigger', at: 0, velocity: 0.8, padId: 'cowbell' },
        ],
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Pad not found');
    });

    it('allows sketch events with valid padId', () => {
      const { session, trackId } = setupDrumRackSession();
      const actions: AIAction[] = [{
        type: 'sketch',
        trackId,
        description: 'valid padId',
        events: [
          { kind: 'trigger', at: 0, velocity: 0.8, padId: 'kick' },
          { kind: 'trigger', at: 4, velocity: 0.8, padId: 'snare' },
        ],
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.accepted).toHaveLength(1);
    });
  });
});
