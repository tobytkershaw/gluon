import { describe, it, expect } from 'vitest';
import { getDefaultVisualIdentity, deriveModuleVisualContext } from '../../src/engine/visual-identity';
import type { Track, TrackVisualIdentity } from '../../src/engine/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMinimalTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'test-track',
    engine: 'plaits',
    model: 0,
    params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
    stepGrid: { length: 16, steps: [] },
    patterns: [],
    sequence: [],
    muted: false,
    solo: false,
    volume: 0.8,
    pan: 0.0,
    surface: { modules: [], thumbprint: { type: 'static-color' } },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getDefaultVisualIdentity
// ---------------------------------------------------------------------------

describe('getDefaultVisualIdentity', () => {
  it('produces valid values for indices 0-15', () => {
    for (let i = 0; i < 16; i++) {
      const identity = getDefaultVisualIdentity(i);

      // Hue: 0-360
      expect(identity.colour.hue).toBeGreaterThanOrEqual(0);
      expect(identity.colour.hue).toBeLessThanOrEqual(360);

      // Saturation: 0-1
      expect(identity.colour.saturation).toBeGreaterThanOrEqual(0);
      expect(identity.colour.saturation).toBeLessThanOrEqual(1);

      // Brightness: 0-1
      expect(identity.colour.brightness).toBeGreaterThanOrEqual(0);
      expect(identity.colour.brightness).toBeLessThanOrEqual(1);

      // Weight: 0-1
      expect(identity.weight).toBeGreaterThanOrEqual(0);
      expect(identity.weight).toBeLessThanOrEqual(1);

      // Edge style: valid enum
      expect(['crisp', 'soft', 'glow']).toContain(identity.edgeStyle);

      // Prominence: 0-1
      expect(identity.prominence).toBeGreaterThanOrEqual(0);
      expect(identity.prominence).toBeLessThanOrEqual(1);
    }
  });

  it('distributes hues across tracks (no two adjacent tracks share a hue)', () => {
    const hues = Array.from({ length: 8 }, (_, i) => getDefaultVisualIdentity(i).colour.hue);
    for (let i = 1; i < hues.length; i++) {
      // Adjacent hues should differ by at least 30 degrees
      const diff = Math.abs(hues[i] - hues[i - 1]);
      const circularDiff = Math.min(diff, 360 - diff);
      expect(circularDiff).toBeGreaterThan(30);
    }
  });

  it('uses sensible defaults for weight, edge, and prominence', () => {
    const identity = getDefaultVisualIdentity(0);
    expect(identity.weight).toBe(0.5);
    expect(identity.edgeStyle).toBe('crisp');
    expect(identity.prominence).toBe(0.5);
  });

  it('index 0 starts with hue 0', () => {
    expect(getDefaultVisualIdentity(0).colour.hue).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// deriveModuleVisualContext
// ---------------------------------------------------------------------------

describe('deriveModuleVisualContext', () => {
  it('returns defaults when no visual identity is set', () => {
    const track = makeMinimalTrack();
    const ctx = deriveModuleVisualContext(track, 3);

    // Should match getDefaultVisualIdentity(3)
    const defaultId = getDefaultVisualIdentity(3);
    expect(ctx.trackColour.hue).toBeCloseTo(defaultId.colour.hue, 1);
    expect(ctx.trackColour.saturation).toBe(defaultId.colour.saturation);
    expect(ctx.trackColour.brightness).toBe(defaultId.colour.brightness);
    expect(ctx.weight).toBe(defaultId.weight);
    expect(ctx.edgeStyle).toBe(defaultId.edgeStyle);
    expect(ctx.prominence).toBe(defaultId.prominence);
  });

  it('returns track identity when set', () => {
    const identity: TrackVisualIdentity = {
      colour: { hue: 210, saturation: 0.7, brightness: 0.5 },
      weight: 0.8,
      edgeStyle: 'glow',
      prominence: 0.9,
    };
    const track = makeMinimalTrack({ visualIdentity: identity });
    const ctx = deriveModuleVisualContext(track, 0);

    expect(ctx.trackColour.hue).toBe(210);
    expect(ctx.trackColour.saturation).toBe(0.7);
    expect(ctx.trackColour.brightness).toBe(0.5);
    expect(ctx.weight).toBe(0.8);
    expect(ctx.edgeStyle).toBe('glow');
    expect(ctx.prominence).toBe(0.9);
  });

  it('clamps out-of-range values', () => {
    const identity: TrackVisualIdentity = {
      colour: { hue: 400, saturation: 1.5, brightness: -0.2 },
      weight: 2.0,
      edgeStyle: 'soft',
      prominence: -1,
    };
    const track = makeMinimalTrack({ visualIdentity: identity });
    const ctx = deriveModuleVisualContext(track, 0);

    expect(ctx.trackColour.hue).toBe(360);
    expect(ctx.trackColour.saturation).toBe(1);
    expect(ctx.trackColour.brightness).toBe(0);
    expect(ctx.weight).toBe(1);
    expect(ctx.prominence).toBe(0);
  });

  it('defaults to trackIndex 0 when not specified', () => {
    const track = makeMinimalTrack();
    const ctx = deriveModuleVisualContext(track);
    const defaultId = getDefaultVisualIdentity(0);
    expect(ctx.trackColour.hue).toBeCloseTo(defaultId.colour.hue, 1);
  });
});
