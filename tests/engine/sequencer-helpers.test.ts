// tests/engine/sequencer-helpers.test.ts
import { describe, it, expect } from 'vitest';
import {
  createDefaultStep, createDefaultStepGrid, getAudibleTracks,
} from '../../src/engine/sequencer-helpers';
import { createSession, addTrack, toggleMute, toggleSolo } from '../../src/engine/session';

describe('createDefaultStep', () => {
  it('creates a step with gate off, no accent, no micro-timing', () => {
    const step = createDefaultStep();
    expect(step.gate).toBe(false);
    expect(step.accent).toBe(false);
    expect(step.micro).toBe(0);
    expect(step.params).toBeUndefined();
  });
});

describe('createDefaultStepGrid', () => {
  it('creates a 16-step pattern by default', () => {
    const pattern = createDefaultStepGrid();
    expect(pattern.length).toBe(16);
    expect(pattern.steps).toHaveLength(16);
  });

  it('creates a pattern with custom length', () => {
    const pattern = createDefaultStepGrid(32);
    expect(pattern.length).toBe(32);
    expect(pattern.steps).toHaveLength(32);
  });

  it('clamps length to 1-64', () => {
    expect(createDefaultStepGrid(0).length).toBe(1);
    expect(createDefaultStepGrid(100).length).toBe(64);
  });
});

describe('getAudibleTracks', () => {
  /** Create a session with 4 audio tracks + master bus for audibility tests. */
  function createMultiTrackSession() {
    let s = createSession();
    s = addTrack(s)!;
    s = addTrack(s)!;
    s = addTrack(s)!;
    return s;
  }

  it('returns all unmuted tracks when none soloed', () => {
    const session = createMultiTrackSession();
    const audible = getAudibleTracks(session);
    expect(audible).toHaveLength(4);
  });

  it('excludes muted tracks when none soloed', () => {
    let s = createMultiTrackSession();
    s = toggleMute(s, s.tracks[0].id);
    const audible = getAudibleTracks(s);
    expect(audible).toHaveLength(3);
    expect(audible.find(v => v.id === s.tracks[0].id)).toBeUndefined();
  });

  it('returns only soloed tracks when any is soloed', () => {
    let s = createMultiTrackSession();
    s = toggleSolo(s, s.tracks[1].id);
    const audible = getAudibleTracks(s);
    expect(audible).toHaveLength(1);
    expect(audible[0].id).toBe(s.tracks[1].id);
  });

  it('solo overrides mute', () => {
    let s = createMultiTrackSession();
    s = toggleMute(s, s.tracks[2].id);
    s = toggleSolo(s, s.tracks[2].id);
    const audible = getAudibleTracks(s);
    expect(audible).toHaveLength(1);
    expect(audible[0].id).toBe(s.tracks[2].id);
  });
});

