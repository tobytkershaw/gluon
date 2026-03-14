// tests/engine/sequencer-helpers.test.ts
import { describe, it, expect } from 'vitest';
import {
  createDefaultStep, createDefaultPattern, getAudibleTracks, resolveNoteParams,
} from '../../src/engine/sequencer-helpers';
import { createSession, toggleMute, toggleSolo } from '../../src/engine/session';
import type { Track } from '../../src/engine/types';
import type { Step } from '../../src/engine/sequencer-types';

describe('createDefaultStep', () => {
  it('creates a step with gate off, no accent, no micro-timing', () => {
    const step = createDefaultStep();
    expect(step.gate).toBe(false);
    expect(step.accent).toBe(false);
    expect(step.micro).toBe(0);
    expect(step.params).toBeUndefined();
  });
});

describe('createDefaultPattern', () => {
  it('creates a 16-step pattern by default', () => {
    const pattern = createDefaultPattern();
    expect(pattern.length).toBe(16);
    expect(pattern.steps).toHaveLength(16);
  });

  it('creates a pattern with custom length', () => {
    const pattern = createDefaultPattern(32);
    expect(pattern.length).toBe(32);
    expect(pattern.steps).toHaveLength(32);
  });

  it('clamps length to 1-64', () => {
    expect(createDefaultPattern(0).length).toBe(1);
    expect(createDefaultPattern(100).length).toBe(64);
  });
});

describe('getAudibleTracks', () => {
  it('returns all unmuted tracks when none soloed', () => {
    const session = createSession();
    const audible = getAudibleTracks(session);
    expect(audible).toHaveLength(4);
  });

  it('excludes muted tracks when none soloed', () => {
    let s = createSession();
    s = toggleMute(s, s.tracks[0].id);
    const audible = getAudibleTracks(s);
    expect(audible).toHaveLength(3);
    expect(audible.find(v => v.id === s.tracks[0].id)).toBeUndefined();
  });

  it('returns only soloed tracks when any is soloed', () => {
    let s = createSession();
    s = toggleSolo(s, s.tracks[1].id);
    const audible = getAudibleTracks(s);
    expect(audible).toHaveLength(1);
    expect(audible[0].id).toBe(s.tracks[1].id);
  });

  it('solo overrides mute', () => {
    let s = createSession();
    s = toggleMute(s, s.tracks[2].id);
    s = toggleSolo(s, s.tracks[2].id);
    const audible = getAudibleTracks(s);
    expect(audible).toHaveLength(1);
    expect(audible[0].id).toBe(s.tracks[2].id);
  });
});

describe('resolveNoteParams', () => {
  it('returns track params when step has no locks', () => {
    const track: Track = {
      id: 'v0', engine: 'test', model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
      agency: 'ON', pattern: createDefaultPattern(), muted: false, solo: false,
    };
    const step: Step = { gate: true, accent: false, micro: 0 };
    const result = resolveNoteParams(track, step, {});
    expect(result).toEqual(track.params);
  });

  it('applies step param locks over track params', () => {
    const track: Track = {
      id: 'v0', engine: 'test', model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
      agency: 'ON', pattern: createDefaultPattern(), muted: false, solo: false,
    };
    const step: Step = { gate: true, accent: false, micro: 0, params: { timbre: 0.9 } };
    const result = resolveNoteParams(track, step, {});
    expect(result.timbre).toBe(0.9);
    expect(result.morph).toBe(0.5);
  });

  it('human held params override both track and step', () => {
    const track: Track = {
      id: 'v0', engine: 'test', model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
      agency: 'ON', pattern: createDefaultPattern(), muted: false, solo: false,
    };
    const step: Step = { gate: true, accent: false, micro: 0, params: { timbre: 0.9 } };
    const result = resolveNoteParams(track, step, { timbre: 0.2 });
    expect(result.timbre).toBe(0.2);
  });
});
