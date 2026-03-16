import { describe, expect, it } from 'vitest';
import { getChainSignature, getTemplateForChain, applySurfaceTemplate, validateSurface } from '../../src/engine/surface-templates';
import type { Track, TrackSurface } from '../../src/engine/types';

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'v0',
    engine: 'virtual-analog',
    model: 0,
    params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    agency: 'ON',
    pattern: { steps: [], length: 16, swing: 0 },
    regions: [{ start: 0, duration: 4, events: [] }],
    muted: false,
    solo: false,
    surface: {
      semanticControls: [],
      pinnedControls: [],
      xyAxes: { x: 'timbre', y: 'morph' },
      thumbprint: { type: 'static-color' },
    },
    ...overrides,
  };
}

describe('getChainSignature', () => {
  it('returns engine name for single-module track', () => {
    const track = makeTrack();
    expect(getChainSignature(track)).toBe('plaits');
  });

  it('includes processor types in order', () => {
    const track = makeTrack({
      processors: [
        { id: 'rings-0', type: 'rings', model: 0, params: {} },
      ],
    });
    expect(getChainSignature(track)).toBe('plaits:rings');
  });

  it('handles multiple processors', () => {
    const track = makeTrack({
      processors: [
        { id: 'rings-0', type: 'rings', model: 0, params: {} },
        { id: 'clouds-0', type: 'clouds', model: 0, params: {} },
      ],
    });
    expect(getChainSignature(track)).toBe('plaits:rings:clouds');
  });

  it('handles empty processors array', () => {
    const track = makeTrack({ processors: [] });
    expect(getChainSignature(track)).toBe('plaits');
  });
});

describe('getTemplateForChain', () => {
  it('returns template for known signature', () => {
    const template = getTemplateForChain('plaits:rings');
    expect(template).not.toBeNull();
    expect(template!.semanticControls).toHaveLength(2);
    expect(template!.semanticControls[0].id).toBe('brightness');
    expect(template!.semanticControls[1].id).toBe('resonance');
  });

  it('returns null for unknown signature', () => {
    expect(getTemplateForChain('plaits:unknown')).toBeNull();
  });

  it('returns template with 3 controls for plaits:rings:clouds', () => {
    const template = getTemplateForChain('plaits:rings:clouds');
    expect(template).not.toBeNull();
    expect(template!.semanticControls).toHaveLength(3);
  });

  it('returns empty semantic controls for single plaits', () => {
    const template = getTemplateForChain('plaits');
    expect(template).not.toBeNull();
    expect(template!.semanticControls).toHaveLength(0);
  });

  it('matches exact signature only', () => {
    // plaits:clouds:rings should not match plaits:rings:clouds
    expect(getTemplateForChain('plaits:clouds:rings')).toBeNull();
  });
});

describe('applySurfaceTemplate', () => {
  it('returns null for unknown chain', () => {
    const track = makeTrack({
      processors: [{ id: 'unknown-0', type: 'unknown' as 'rings', model: 0, params: {} }],
    });
    expect(applySurfaceTemplate(track)).toBeNull();
  });

  it('resolves generic moduleIds to actual track IDs', () => {
    const track = makeTrack({
      processors: [
        { id: 'my-rings-id', type: 'rings', model: 0, params: {} },
      ],
    });
    const surface = applySurfaceTemplate(track);
    expect(surface).not.toBeNull();
    // Check that processor-0 was resolved to the actual processor ID
    const brightnessWeights = surface!.semanticControls[0].weights;
    expect(brightnessWeights[0].moduleId).toBe('source');
    expect(brightnessWeights[1].moduleId).toBe('my-rings-id');
  });

  it('resolves both processor-0 and processor-1 for two-processor chain', () => {
    const track = makeTrack({
      processors: [
        { id: 'rings-abc', type: 'rings', model: 0, params: {} },
        { id: 'clouds-xyz', type: 'clouds', model: 0, params: {} },
      ],
    });
    const surface = applySurfaceTemplate(track);
    expect(surface).not.toBeNull();
    // Brightness references both processors
    const brightnessWeights = surface!.semanticControls[0].weights;
    expect(brightnessWeights.find(w => w.moduleId === 'rings-abc')).toBeDefined();
    expect(brightnessWeights.find(w => w.moduleId === 'clouds-xyz')).toBeDefined();
  });

  it('preserves existing thumbprint and pinnedControls', () => {
    const track = makeTrack({
      processors: [{ id: 'rings-0', type: 'rings', model: 0, params: {} }],
      surface: {
        semanticControls: [],
        pinnedControls: [{ moduleId: 'source', controlId: 'timbre' }],
        xyAxes: { x: 'timbre', y: 'morph' },
        thumbprint: { type: 'static-color' },
      },
    });
    const surface = applySurfaceTemplate(track);
    expect(surface!.pinnedControls).toHaveLength(1);
    expect(surface!.thumbprint.type).toBe('static-color');
  });

  it('sets xyAxes from template', () => {
    const track = makeTrack({
      processors: [{ id: 'rings-0', type: 'rings', model: 0, params: {} }],
    });
    const surface = applySurfaceTemplate(track);
    expect(surface!.xyAxes).toEqual({ x: 'brightness', y: 'resonance' });
  });
});

describe('validateSurface', () => {
  it('returns null for valid surface', () => {
    const track = makeTrack({
      processors: [{ id: 'rings-0', type: 'rings', model: 0, params: {} }],
    });
    const surface = applySurfaceTemplate(track)!;
    expect(validateSurface(surface, track)).toBeNull();
  });

  it('returns null for empty semantic controls', () => {
    const track = makeTrack();
    const surface: TrackSurface = {
      semanticControls: [],
      pinnedControls: [],
      xyAxes: { x: 'timbre', y: 'morph' },
      thumbprint: { type: 'static-color' },
    };
    expect(validateSurface(surface, track)).toBeNull();
  });

  it('rejects weights that do not sum to 1.0', () => {
    const track = makeTrack();
    const surface: TrackSurface = {
      semanticControls: [{
        id: 'test',
        name: 'Test',
        semanticRole: null,
        description: 'test',
        weights: [
          { moduleId: 'source', controlId: 'timbre', weight: 0.3, transform: 'linear' },
          { moduleId: 'source', controlId: 'morph', weight: 0.3, transform: 'linear' },
        ],
        range: { min: 0, max: 1, default: 0.5 },
      }],
      pinnedControls: [],
      xyAxes: { x: 'timbre', y: 'morph' },
      thumbprint: { type: 'static-color' },
    };
    const err = validateSurface(surface, track);
    expect(err).toContain('weights sum to');
  });

  it('rejects references to unknown modules', () => {
    const track = makeTrack();
    const surface: TrackSurface = {
      semanticControls: [{
        id: 'test',
        name: 'Test',
        semanticRole: null,
        description: 'test',
        weights: [
          { moduleId: 'nonexistent', controlId: 'timbre', weight: 1.0, transform: 'linear' },
        ],
        range: { min: 0, max: 1, default: 0.5 },
      }],
      pinnedControls: [],
      xyAxes: { x: 'timbre', y: 'morph' },
      thumbprint: { type: 'static-color' },
    };
    const err = validateSurface(surface, track);
    expect(err).toContain('unknown module');
  });

  it('rejects empty weights array', () => {
    const track = makeTrack();
    const surface: TrackSurface = {
      semanticControls: [{
        id: 'test',
        name: 'Test',
        semanticRole: null,
        description: 'test',
        weights: [],
        range: { min: 0, max: 1, default: 0.5 },
      }],
      pinnedControls: [],
      xyAxes: { x: 'timbre', y: 'morph' },
      thumbprint: { type: 'static-color' },
    };
    const err = validateSurface(surface, track);
    expect(err).toContain('no weights');
  });

  it('rejects pinned controls referencing unknown modules', () => {
    const track = makeTrack();
    const surface: TrackSurface = {
      semanticControls: [],
      pinnedControls: [{ moduleId: 'nonexistent', controlId: 'timbre' }],
      xyAxes: { x: 'timbre', y: 'morph' },
      thumbprint: { type: 'static-color' },
    };
    const err = validateSurface(surface, track);
    expect(err).toContain('unknown module');
  });
});
