// tests/ai/drum-rack-projection.test.ts — Verify projectAction handles drum-rack pad-scoped actions (#1130)

import { describe, it, expect } from 'vitest';
import { projectAction } from '../../src/ai/api';
import { createSession, addTrack } from '../../src/engine/session';
import { getTrack, updateTrack } from '../../src/engine/types';
import type { Session, DrumPad, AIMoveAction, AISetModelAction } from '../../src/engine/types';

/** Build a session with a drum-rack track containing two pads. */
function makeDrumSession(): Session {
  let session = createSession();
  session = addTrack(session)!;
  const trackId = session.activeTrackId;
  const pads: DrumPad[] = [
    {
      id: 'kick',
      name: 'Kick',
      source: { engine: 'plaits', model: 13, params: { frequency: 0.3, harmonics: 0.5, timbre: 0.4, morph: 0.6 } },
      level: 0.8,
      pan: 0.0,
    },
    {
      id: 'snare',
      name: 'Snare',
      source: { engine: 'plaits', model: 14, params: { frequency: 0.5, harmonics: 0.3, timbre: 0.5, morph: 0.5 } },
      level: 0.7,
      pan: 0.0,
    },
  ];
  session = updateTrack(session, trackId, {
    engine: 'drum-rack',
    drumRack: { pads },
  });
  return session;
}

describe('projectAction — drum-rack pad projections (#1130)', () => {
  // -----------------------------------------------------------------------
  // move with padId.param path
  // -----------------------------------------------------------------------

  describe('move: padId.param path', () => {
    it('projects absolute move on pad level', () => {
      const session = makeDrumSession();
      const trackId = session.activeTrackId;
      const action: AIMoveAction = {
        type: 'move',
        trackId,
        param: 'kick.level',
        target: { absolute: 0.6 },
      };
      const result = projectAction(session, action);
      const pad = getTrack(result, trackId).drumRack!.pads.find(p => p.id === 'kick')!;
      expect(pad.level).toBe(0.6);
    });

    it('projects absolute move on pad pan', () => {
      const session = makeDrumSession();
      const trackId = session.activeTrackId;
      const action: AIMoveAction = {
        type: 'move',
        trackId,
        param: 'snare.pan',
        target: { absolute: 0.3 },
      };
      const result = projectAction(session, action);
      const pad = getTrack(result, trackId).drumRack!.pads.find(p => p.id === 'snare')!;
      expect(pad.pan).toBe(0.3);
    });

    it('projects absolute move on pad source param', () => {
      const session = makeDrumSession();
      const trackId = session.activeTrackId;
      const action: AIMoveAction = {
        type: 'move',
        trackId,
        param: 'kick.frequency',
        target: { absolute: 0.7 },
      };
      const result = projectAction(session, action);
      const pad = getTrack(result, trackId).drumRack!.pads.find(p => p.id === 'kick')!;
      expect(pad.source.params.frequency).toBe(0.7);
    });

    it('projects relative move on pad source param', () => {
      const session = makeDrumSession();
      const trackId = session.activeTrackId;
      // kick.frequency starts at 0.3
      const action: AIMoveAction = {
        type: 'move',
        trackId,
        param: 'kick.frequency',
        target: { relative: 0.2 },
      };
      const result = projectAction(session, action);
      const pad = getTrack(result, trackId).drumRack!.pads.find(p => p.id === 'kick')!;
      expect(pad.source.params.frequency).toBeCloseTo(0.5, 5);
    });

    it('clamps pad param to [0, 1]', () => {
      const session = makeDrumSession();
      const trackId = session.activeTrackId;
      const action: AIMoveAction = {
        type: 'move',
        trackId,
        param: 'kick.level',
        target: { absolute: 1.5 },
      };
      const result = projectAction(session, action);
      const pad = getTrack(result, trackId).drumRack!.pads.find(p => p.id === 'kick')!;
      expect(pad.level).toBe(1.0);
    });

    it('returns session unchanged for non-existent pad', () => {
      const session = makeDrumSession();
      const trackId = session.activeTrackId;
      const action: AIMoveAction = {
        type: 'move',
        trackId,
        param: 'rimshot.level',
        target: { absolute: 0.5 },
      };
      const result = projectAction(session, action);
      expect(result).toBe(session);
    });

    it('returns session unchanged for non-finite target', () => {
      const session = makeDrumSession();
      const trackId = session.activeTrackId;
      const action: AIMoveAction = {
        type: 'move',
        trackId,
        param: 'kick.level',
        target: { absolute: NaN },
      };
      const result = projectAction(session, action);
      expect(result).toBe(session);
    });

    it('does not mutate other pads', () => {
      const session = makeDrumSession();
      const trackId = session.activeTrackId;
      const snareBefore = getTrack(session, trackId).drumRack!.pads.find(p => p.id === 'snare')!;
      const action: AIMoveAction = {
        type: 'move',
        trackId,
        param: 'kick.level',
        target: { absolute: 0.2 },
      };
      const result = projectAction(session, action);
      const snareAfter = getTrack(result, trackId).drumRack!.pads.find(p => p.id === 'snare')!;
      expect(snareAfter.level).toBe(snareBefore.level);
      expect(snareAfter.pan).toBe(snareBefore.pan);
      expect(snareAfter.source.params).toEqual(snareBefore.source.params);
    });
  });

  // -----------------------------------------------------------------------
  // set_model with pad field
  // -----------------------------------------------------------------------

  describe('set_model: pad field', () => {
    it('projects pad model change', () => {
      const session = makeDrumSession();
      const trackId = session.activeTrackId;
      const action: AISetModelAction = {
        type: 'set_model',
        trackId,
        pad: 'kick',
        model: 'analog-hi-hat',  // engine index 15
      };
      const result = projectAction(session, action);
      const pad = getTrack(result, trackId).drumRack!.pads.find(p => p.id === 'kick')!;
      expect(pad.source.model).toBe(15); // analog-hi-hat is index 15
    });

    it('resets pad params to defaults on model change', () => {
      const session = makeDrumSession();
      const trackId = session.activeTrackId;
      const action: AISetModelAction = {
        type: 'set_model',
        trackId,
        pad: 'kick',
        model: 'modal-resonator', // engine index 12
      };
      const result = projectAction(session, action);
      const pad = getTrack(result, trackId).drumRack!.pads.find(p => p.id === 'kick')!;
      expect(pad.source.model).toBe(12);
      // Params should be reset to engine defaults, not carry over from old model
      expect(pad.source.params.frequency).toBe(0.5); // default for frequency control
    });

    it('returns session unchanged for non-existent pad', () => {
      const session = makeDrumSession();
      const trackId = session.activeTrackId;
      const action: AISetModelAction = {
        type: 'set_model',
        trackId,
        pad: 'rimshot',
        model: 'analog-hi-hat',
      };
      const result = projectAction(session, action);
      expect(result).toBe(session);
    });

    it('returns session unchanged for unknown model', () => {
      const session = makeDrumSession();
      const trackId = session.activeTrackId;
      const action: AISetModelAction = {
        type: 'set_model',
        trackId,
        pad: 'kick',
        model: 'nonexistent-model',
      };
      const result = projectAction(session, action);
      expect(result).toBe(session);
    });

    it('does not mutate other pads', () => {
      const session = makeDrumSession();
      const trackId = session.activeTrackId;
      const snareBefore = getTrack(session, trackId).drumRack!.pads.find(p => p.id === 'snare')!;
      const action: AISetModelAction = {
        type: 'set_model',
        trackId,
        pad: 'kick',
        model: 'analog-hi-hat',
      };
      const result = projectAction(session, action);
      const snareAfter = getTrack(result, trackId).drumRack!.pads.find(p => p.id === 'snare')!;
      expect(snareAfter.source.model).toBe(snareBefore.source.model);
      expect(snareAfter.source.params).toEqual(snareBefore.source.params);
    });

    it('returns session unchanged when track has no drumRack', () => {
      // Use the default session which has a non-drum-rack track
      const session = createSession();
      const trackId = session.activeTrackId;
      const action: AISetModelAction = {
        type: 'set_model',
        trackId,
        pad: 'kick',
        model: 'analog-hi-hat',
      };
      const result = projectAction(session, action);
      expect(result).toBe(session);
    });
  });
});
