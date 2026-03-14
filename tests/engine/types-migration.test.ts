// tests/engine/types-migration.test.ts
import { describe, it, expect } from 'vitest';
import type {
  Track, Session, ParamSnapshot, PatternSnapshot,
  AISketchAction,
} from '../../src/engine/types';

describe('Phase 2 type shapes', () => {
  it('Trackhas pattern, muted, solo fields', () => {
    const track: Track= {
      id: 'v0',
      engine: 'plaits:virtual_analog',
      model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
      agency: 'ON',
      pattern: { steps: [{ gate: false, accent: false, micro: 0 }], length: 1 },
      muted: false,
      solo: false,
    };
    expect(track.pattern.length).toBe(1);
    expect(track.muted).toBe(false);
  });

  it('ParamSnapshot has kind and trackId', () => {
    const snapshot: ParamSnapshot = {
      kind: 'param',
      trackId: 'v0',
      prevValues: { timbre: 0.5 },
      aiTargetValues: { timbre: 0.8 },
      timestamp: Date.now(),
      description: 'test',
    };
    expect(snapshot.kind).toBe('param');
    expect(snapshot.trackId).toBe('v0');
  });

  it('PatternSnapshot stores changed steps', () => {
    const snapshot: PatternSnapshot = {
      kind: 'pattern',
      trackId: 'v0',
      prevSteps: [{ index: 0, step: { gate: false, accent: false, micro: 0 } }],
      timestamp: Date.now(),
      description: 'test',
    };
    expect(snapshot.kind).toBe('pattern');
    expect(snapshot.prevSteps).toHaveLength(1);
  });

  it('AISketchAction has trackId and PatternSketch', () => {
    const action: AISketchAction = {
      type: 'sketch',
      trackId: 'v0',
      description: 'kick pattern',
      pattern: {
        length: 16,
        steps: [
          { index: 0, gate: true },
          { index: 4, gate: true },
          { index: 8, gate: true },
          { index: 12, gate: true },
        ],
      },
    };
    expect(action.type).toBe('sketch');
    expect(action.pattern.steps).toHaveLength(4);
  });

  it('Session has tracks array, activeTrackId, transport', () => {
    const session: Session = {
      tracks: [],
      activeTrackId: 'v0',
      transport: { playing: false, bpm: 120, swing: 0 },
      undoStack: [],
      context: { key: null, scale: null, tempo: null, energy: 0.3, density: 0.2 },
      messages: [],
      recentHumanActions: [],
    };
    expect(session.activeTrackId).toBe('v0');
    expect(session.transport.bpm).toBe(120);
  });
});
