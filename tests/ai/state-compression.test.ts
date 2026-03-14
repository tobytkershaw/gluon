// tests/ai/state-compression.test.ts
import { describe, it, expect } from 'vitest';
import { compressState } from '../../src/ai/state-compression';
import { createSession } from '../../src/engine/session';
import { toggleStepGate, toggleStepAccent, setStepParamLock } from '../../src/engine/pattern-primitives';

describe('State Compression (Phase 2)', () => {
  it('compresses multi-track session', () => {
    const session = createSession();
    const result = compressState(session);
    expect(result.tracks).toHaveLength(4);
    expect(result.tracks[0].model).toBe('analog_bass_drum');
    expect(result.transport).toEqual({ bpm: 120, swing: 0, playing: false });
    expect(result.activeTrackId).toBe(session.activeTrackId);
  });

  it('compresses pattern with trigger events', () => {
    let s = createSession();
    const vid = s.tracks[0].id;
    s = toggleStepGate(s, vid, 0);
    s = toggleStepGate(s, vid, 4);
    s = toggleStepGate(s, vid, 8);
    s = toggleStepGate(s, vid, 12);

    const result = compressState(s);
    expect(result.tracks[0].pattern.triggers).toEqual([0, 4, 8, 12]);
    expect(result.tracks[0].pattern.event_count).toBe(4);
    expect(result.tracks[0].pattern.notes).toEqual([]);
    expect(result.tracks[0].pattern.density).toBeGreaterThan(0);
  });

  it('compresses accented steps', () => {
    let s = createSession();
    const vid = s.tracks[0].id;
    s = toggleStepGate(s, vid, 0);
    s = toggleStepAccent(s, vid, 0);

    const result = compressState(s);
    expect(result.tracks[0].pattern.accents).toEqual([0]);
  });

  it('compresses parameter locks with semantic names', () => {
    let s = createSession();
    const vid = s.tracks[0].id;
    s = setStepParamLock(s, vid, 5, { timbre: 0.8 });

    const result = compressState(s);
    expect(result.tracks[0].pattern.param_locks).toEqual([
      { at: 5, params: { brightness: 0.8 } },
    ]);
  });

  it('uses semantic param names for track params', () => {
    const session = createSession();
    const result = compressState(session);
    const paramKeys = Object.keys(result.tracks[0].params);
    expect(paramKeys).toEqual(['brightness', 'richness', 'texture', 'pitch']);
  });

  it('preserves structured recent human actions', () => {
    const session = createSession();
    const now = Date.now();
    session.recentHumanActions = [
      { trackId: 'v0', param: 'timbre', from: 0.3, to: 0.7, timestamp: now - 2000 },
      { trackId: 'v1', param: 'harmonics', from: 0.5, to: 0.1, timestamp: now - 500 },
    ];
    const result = compressState(session);
    expect(result.recent_human_actions).toHaveLength(2);
    expect(result.recent_human_actions[0].trackId).toBe('v0');
    expect(result.recent_human_actions[0].param).toBe('brightness');
    expect(result.recent_human_actions[0].from).toBe(0.3);
    expect(result.recent_human_actions[0].to).toBe(0.7);
    expect(result.recent_human_actions[0].age_ms).toBeGreaterThan(1500);
    expect(result.recent_human_actions[1].param).toBe('richness');
  });

  it('does not include human_message field', () => {
    const session = createSession();
    const result = compressState(session);
    expect(result).not.toHaveProperty('human_message');
  });

  it('empty region produces correct empty format', () => {
    const session = createSession();
    // Clear events from the first track's region
    const track = session.tracks[0];
    if (track.regions[0]) {
      track.regions[0].events = [];
    }
    const result = compressState(session);
    const pattern = result.tracks[0].pattern;
    expect(pattern.event_count).toBe(0);
    expect(pattern.triggers).toEqual([]);
    expect(pattern.notes).toEqual([]);
    expect(pattern.accents).toEqual([]);
    expect(pattern.param_locks).toEqual([]);
    expect(pattern.density).toBe(0);
  });

  it('NoteEvent produces entry in notes array', () => {
    const session = createSession();
    const track = session.tracks[0];
    if (track.regions[0]) {
      track.regions[0].events = [
        { kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 1 },
        { kind: 'note', at: 2.5, pitch: 72, velocity: 0.99, duration: 0.5 },
      ];
    }
    const result = compressState(session);
    const pattern = result.tracks[0].pattern;
    expect(pattern.notes).toEqual([
      { at: 0, pitch: 60, vel: 0.8 },
      { at: 2.5, pitch: 72, vel: 0.99 },
    ]);
    expect(pattern.event_count).toBe(2);
    // High velocity note should appear in accents
    expect(pattern.accents).toEqual([2.5]);
  });

  it('events with fractional positions show in triggers and notes', () => {
    const session = createSession();
    const track = session.tracks[0];
    if (track.regions[0]) {
      track.regions[0].events = [
        { kind: 'trigger', at: 0.33, velocity: 0.7 },
        { kind: 'trigger', at: 1.67, velocity: 0.9 },
        { kind: 'note', at: 3.25, pitch: 48, velocity: 0.6, duration: 0.5 },
      ];
    }
    const result = compressState(session);
    const pattern = result.tracks[0].pattern;
    expect(pattern.triggers).toEqual([0.33, 1.67]);
    expect(pattern.notes).toEqual([{ at: 3.25, pitch: 48, vel: 0.6 }]);
  });
});
