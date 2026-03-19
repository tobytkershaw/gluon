import { describe, expect, it } from 'vitest';
import { deriveMixWarnings } from './mix-warnings';
import { createSession, addTrack } from '../engine/session';
import { SpectralSlotManager } from '../engine/spectral-slots';

describe('deriveMixWarnings', () => {
  it('scales low_headroom severity upward as peak approaches clipping', () => {
    const session = createSession();
    const warnings = deriveMixWarnings(session, {
      capturedAt: Date.now(),
      master: { rms: -12, peak: -0.31, centroid: 2000, crest: 8, onsetDensity: 1 },
      tracks: {},
    }, new SpectralSlotManager());

    const warning = warnings.find(candidate => candidate.type === 'low_headroom');
    expect(warning).toBeDefined();
    expect(warning?.severity).toBeGreaterThan(0.9);
  });

  it('emits unslotted advisory even when collisions also exist', () => {
    let session = createSession();
    session = addTrack(session, 'audio') ?? session;
    session = addTrack(session, 'audio') ?? session;

    const slots = new SpectralSlotManager();
    slots.assign('v0', ['mid'], 8);
    slots.assign('v1', ['mid'], 6);

    const warnings = deriveMixWarnings(session, undefined, slots);
    const maskingWarnings = warnings.filter(candidate => candidate.type === 'masking');

    expect(maskingWarnings.some(candidate => candidate.band === 'mid')).toBe(true);
    expect(maskingWarnings.some(candidate => candidate.message.includes('no spectral slot coverage'))).toBe(true);
  });
});
