import { describe, expect, it } from 'vitest';
import { getChainSignature, getTemplateForChain, applySurfaceTemplate, validateSurface, migrateLegacySurface, maybeApplySurfaceTemplate } from '../../src/engine/surface-templates';
import type { Track, TrackSurface, SemanticControlDef, SurfaceModule, Session } from '../../src/engine/types';
import { createSession } from '../../src/engine/session';

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'v0',
    engine: 'virtual-analog',
    model: 0,
    params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    agency: 'ON',
    stepGrid: { steps: [], length: 16, swing: 0 },
    patterns: [{ duration: 4, events: [] }],
    muted: false,
    solo: false,
    surface: {
      modules: [],
      thumbprint: { type: 'static-color' },
    },
    ...overrides,
  };
}

/** Helper to extract the semantic control config from a macro-knob module. */
function getSemanticControl(mod: SurfaceModule): SemanticControlDef {
  return mod.config.semanticControl as SemanticControlDef;
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
    // Should have macro-knob modules for brightness and resonance
    const macroKnobs = template!.modules.filter(m => m.type === 'macro-knob');
    expect(macroKnobs).toHaveLength(2);
    expect(macroKnobs[0].id).toBe('brightness');
    expect(macroKnobs[1].id).toBe('resonance');
  });

  it('returns null for unknown signature', () => {
    expect(getTemplateForChain('plaits:unknown')).toBeNull();
  });

  it('returns template with 3 macro knobs for plaits:rings:clouds', () => {
    const template = getTemplateForChain('plaits:rings:clouds');
    expect(template).not.toBeNull();
    const macroKnobs = template!.modules.filter(m => m.type === 'macro-knob');
    expect(macroKnobs).toHaveLength(3);
  });

  it('returns knob-group + step-grid for single plaits (no macro knobs)', () => {
    const template = getTemplateForChain('plaits');
    expect(template).not.toBeNull();
    const macroKnobs = template!.modules.filter(m => m.type === 'macro-knob');
    expect(macroKnobs).toHaveLength(0);
    expect(template!.modules.some(m => m.type === 'knob-group')).toBe(true);
    expect(template!.modules.some(m => m.type === 'step-grid')).toBe(true);
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
    const brightnessMod = surface!.modules.find(m => m.id === 'brightness')!;
    const brightnessWeights = getSemanticControl(brightnessMod).weights;
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
    const brightnessMod = surface!.modules.find(m => m.id === 'brightness')!;
    const brightnessWeights = getSemanticControl(brightnessMod).weights;
    expect(brightnessWeights.find(w => w.moduleId === 'rings-abc')).toBeDefined();
    expect(brightnessWeights.find(w => w.moduleId === 'clouds-xyz')).toBeDefined();
  });

  it('preserves existing thumbprint', () => {
    const track = makeTrack({
      processors: [{ id: 'rings-0', type: 'rings', model: 0, params: {} }],
      surface: {
        modules: [],
        thumbprint: { type: 'static-color' },
      },
    });
    const surface = applySurfaceTemplate(track);
    expect(surface!.thumbprint.type).toBe('static-color');
  });

  it('includes xy-pad module from template', () => {
    const track = makeTrack({
      processors: [{ id: 'rings-0', type: 'rings', model: 0, params: {} }],
    });
    const surface = applySurfaceTemplate(track);
    const xyPad = surface!.modules.find(m => m.type === 'xy-pad');
    expect(xyPad).toBeDefined();
    expect(xyPad!.bindings.find(b => b.role === 'x-axis')!.target).toBe('brightness');
    expect(xyPad!.bindings.find(b => b.role === 'y-axis')!.target).toBe('resonance');
  });

  it('returns null when surface modules already match', () => {
    const track = makeTrack({
      processors: [{ id: 'rings-0', type: 'rings', model: 0, params: {} }],
    });
    // Apply once
    const surface1 = applySurfaceTemplate(track)!;
    // Apply again with same modules
    const track2 = { ...track, surface: surface1 };
    expect(applySurfaceTemplate(track2)).toBeNull();
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

  it('returns null for empty modules', () => {
    const track = makeTrack();
    const surface: TrackSurface = {
      modules: [],
      thumbprint: { type: 'static-color' },
    };
    expect(validateSurface(surface, track)).toBeNull();
  });

  it('rejects macro-knob weights that do not sum to 1.0', () => {
    const track = makeTrack();
    const surface: TrackSurface = {
      modules: [{
        type: 'macro-knob',
        id: 'test',
        label: 'Test',
        bindings: [{ role: 'control', trackId: '', target: 'test' }],
        position: { x: 0, y: 0, w: 2, h: 2 },
        config: {
          semanticControl: {
            id: 'test',
            name: 'Test',
            semanticRole: null,
            description: 'test',
            weights: [
              { moduleId: 'source', controlId: 'timbre', weight: 0.3, transform: 'linear' },
              { moduleId: 'source', controlId: 'morph', weight: 0.3, transform: 'linear' },
            ],
            range: { min: 0, max: 1, default: 0.5 },
          },
        },
      }],
      thumbprint: { type: 'static-color' },
    };
    const err = validateSurface(surface, track);
    expect(err).toContain('weights sum to');
  });

  it('rejects references to unknown modules', () => {
    const track = makeTrack();
    const surface: TrackSurface = {
      modules: [{
        type: 'macro-knob',
        id: 'test',
        label: 'Test',
        bindings: [{ role: 'control', trackId: '', target: 'test' }],
        position: { x: 0, y: 0, w: 2, h: 2 },
        config: {
          semanticControl: {
            id: 'test',
            name: 'Test',
            semanticRole: null,
            description: 'test',
            weights: [
              { moduleId: 'nonexistent', controlId: 'timbre', weight: 1.0, transform: 'linear' },
            ],
            range: { min: 0, max: 1, default: 0.5 },
          },
        },
      }],
      thumbprint: { type: 'static-color' },
    };
    const err = validateSurface(surface, track);
    expect(err).toContain('unknown module');
  });

  it('rejects empty weights array on macro-knob', () => {
    const track = makeTrack();
    const surface: TrackSurface = {
      modules: [{
        type: 'macro-knob',
        id: 'test',
        label: 'Test',
        bindings: [{ role: 'control', trackId: '', target: 'test' }],
        position: { x: 0, y: 0, w: 2, h: 2 },
        config: {
          semanticControl: {
            id: 'test',
            name: 'Test',
            semanticRole: null,
            description: 'test',
            weights: [],
            range: { min: 0, max: 1, default: 0.5 },
          },
        },
      }],
      thumbprint: { type: 'static-color' },
    };
    const err = validateSurface(surface, track);
    expect(err).toContain('no weights');
  });

  it('rejects unknown module types', () => {
    const track = makeTrack();
    const surface: TrackSurface = {
      modules: [{
        type: 'nonexistent-widget',
        id: 'test',
        label: 'Test',
        bindings: [],
        position: { x: 0, y: 0, w: 2, h: 2 },
        config: {},
      }],
      thumbprint: { type: 'static-color' },
    };
    const err = validateSurface(surface, track);
    expect(err).toContain('Unknown module type');
  });
});

describe('migrateLegacySurface', () => {
  it('converts semantic controls to macro-knob modules', () => {
    const legacy = {
      semanticControls: [{
        id: 'brightness',
        name: 'Brightness',
        semanticRole: 'brightness',
        description: 'test brightness',
        weights: [
          { moduleId: 'source', controlId: 'timbre', weight: 0.5, transform: 'linear' },
          { moduleId: 'processor-0', controlId: 'brightness', weight: 0.5, transform: 'linear' },
        ],
        range: { min: 0, max: 1, default: 0.5 },
      }],
      pinnedControls: [],
      xyAxes: { x: 'brightness', y: 'resonance' },
      thumbprint: { type: 'static-color' },
    };
    const result = migrateLegacySurface(legacy, 'track-1');
    const macroKnobs = result.modules.filter(m => m.type === 'macro-knob');
    expect(macroKnobs).toHaveLength(1);
    expect(macroKnobs[0].id).toBe('brightness');
    expect(macroKnobs[0].label).toBe('Brightness');
    expect(getSemanticControl(macroKnobs[0]).weights).toHaveLength(2);
  });

  it('converts xyAxes to xy-pad module', () => {
    const legacy = {
      semanticControls: [],
      pinnedControls: [],
      xyAxes: { x: 'timbre', y: 'morph' },
      thumbprint: { type: 'static-color' },
    };
    const result = migrateLegacySurface(legacy, 'track-1');
    const xyPad = result.modules.find(m => m.type === 'xy-pad');
    expect(xyPad).toBeDefined();
    expect(xyPad!.bindings.find(b => b.role === 'x-axis')!.target).toBe('timbre');
    expect(xyPad!.bindings.find(b => b.role === 'y-axis')!.target).toBe('morph');
  });

  it('converts pinned controls to knob-group modules', () => {
    const legacy = {
      semanticControls: [],
      pinnedControls: [{ moduleId: 'source', controlId: 'timbre' }],
      xyAxes: { x: '', y: '' },
      thumbprint: { type: 'static-color' },
    };
    const result = migrateLegacySurface(legacy, 'track-1');
    const knobGroups = result.modules.filter(m => m.type === 'knob-group');
    expect(knobGroups).toHaveLength(1);
    expect(knobGroups[0].config.pinned).toBe(true);
    expect(knobGroups[0].bindings[0].target).toBe('source:timbre');
  });

  it('preserves thumbprint', () => {
    const legacy = {
      semanticControls: [],
      pinnedControls: [],
      xyAxes: { x: '', y: '' },
      thumbprint: { type: 'static-color' },
    };
    const result = migrateLegacySurface(legacy, 'track-1');
    expect(result.thumbprint.type).toBe('static-color');
  });

  it('handles missing thumbprint with default', () => {
    const legacy = {
      semanticControls: [],
      pinnedControls: [],
      xyAxes: { x: '', y: '' },
    };
    const result = migrateLegacySurface(legacy, 'track-1');
    expect(result.thumbprint.type).toBe('static-color');
  });

  it('skips xy-pad when both axes are empty', () => {
    const legacy = {
      semanticControls: [],
      pinnedControls: [],
      xyAxes: { x: '', y: '' },
      thumbprint: { type: 'static-color' },
    };
    const result = migrateLegacySurface(legacy, 'track-1');
    expect(result.modules.find(m => m.type === 'xy-pad')).toBeUndefined();
  });
});

describe('maybeApplySurfaceTemplate', () => {
  function makeSessionWithTrack(trackOverrides: Partial<Track> = {}): Session {
    const session = createSession();
    const track = session.tracks[0];
    return {
      ...session,
      tracks: session.tracks.map(t =>
        t.id === track.id ? { ...t, ...trackOverrides } : t,
      ),
    };
  }

  it('applies surface template after adding a processor (rings)', () => {
    const session = makeSessionWithTrack({
      processors: [{ id: 'rings-1', type: 'rings', model: 0, params: {} }],
      surface: { modules: [], thumbprint: { type: 'static-color' } },
    });
    // Add an undo entry to group with
    const withUndo: Session = {
      ...session,
      undoStack: [{
        kind: 'processor',
        trackId: session.activeTrackId,
        prevProcessors: [],
        timestamp: Date.now(),
        description: 'Add rings processor',
      }],
    };
    const result = maybeApplySurfaceTemplate(withUndo, session.activeTrackId, 'Add rings processor');
    const track = result.tracks.find(t => t.id === session.activeTrackId)!;
    // Surface should now have modules from the plaits:rings template
    expect(track.surface.modules.length).toBeGreaterThan(0);
    expect(track.surface.modules.some(m => m.type === 'macro-knob')).toBe(true);
  });

  it('groups surface snapshot with the previous undo entry', () => {
    const session = makeSessionWithTrack({
      processors: [{ id: 'rings-1', type: 'rings', model: 0, params: {} }],
      surface: { modules: [], thumbprint: { type: 'static-color' } },
    });
    const withUndo: Session = {
      ...session,
      undoStack: [{
        kind: 'processor',
        trackId: session.activeTrackId,
        prevProcessors: [],
        timestamp: Date.now(),
        description: 'Add rings processor',
      }],
    };
    const result = maybeApplySurfaceTemplate(withUndo, session.activeTrackId, 'Add rings processor');
    // Should still be exactly 1 undo entry (grouped)
    expect(result.undoStack).toHaveLength(1);
    expect(result.undoStack[0].kind).toBe('group');
    if (result.undoStack[0].kind === 'group') {
      expect(result.undoStack[0].snapshots).toHaveLength(2);
      expect(result.undoStack[0].snapshots[1].kind).toBe('surface');
    }
  });

  it('returns session unchanged when no template matches', () => {
    const session = makeSessionWithTrack({
      processors: [{ id: 'unknown-1', type: 'unknown' as 'rings', model: 0, params: {} }],
      surface: { modules: [], thumbprint: { type: 'static-color' } },
    });
    const withUndo: Session = {
      ...session,
      undoStack: [{
        kind: 'processor',
        trackId: session.activeTrackId,
        prevProcessors: [],
        timestamp: Date.now(),
        description: 'Add unknown processor',
      }],
    };
    const result = maybeApplySurfaceTemplate(withUndo, session.activeTrackId, 'Add unknown processor');
    expect(result).toBe(withUndo);
  });

  it('returns session unchanged when surface already matches template', () => {
    // First apply the template
    const session = makeSessionWithTrack({
      processors: [{ id: 'rings-1', type: 'rings', model: 0, params: {} }],
      surface: { modules: [], thumbprint: { type: 'static-color' } },
    });
    const withUndo: Session = {
      ...session,
      undoStack: [{
        kind: 'processor',
        trackId: session.activeTrackId,
        prevProcessors: [],
        timestamp: Date.now(),
        description: 'Add rings processor',
      }],
    };
    const first = maybeApplySurfaceTemplate(withUndo, session.activeTrackId, 'Add rings processor');
    // Now try again — surface should already match
    const second = maybeApplySurfaceTemplate(first, session.activeTrackId, 'Add rings processor');
    expect(second).toBe(first);
  });

  it('updates surface after removing a processor (back to plaits-only)', () => {
    // Start with plaits:rings surface applied
    const session = makeSessionWithTrack({
      processors: [{ id: 'rings-1', type: 'rings', model: 0, params: {} }],
      surface: { modules: [], thumbprint: { type: 'static-color' } },
    });
    const withTemplate = maybeApplySurfaceTemplate(
      { ...session, undoStack: [{ kind: 'processor', trackId: session.activeTrackId, prevProcessors: [], timestamp: Date.now(), description: 'setup' }] },
      session.activeTrackId,
      'setup',
    );
    // Now simulate removing the processor
    const afterRemove: Session = {
      ...withTemplate,
      tracks: withTemplate.tracks.map(t =>
        t.id === session.activeTrackId ? { ...t, processors: [] } : t,
      ),
      undoStack: [...withTemplate.undoStack, {
        kind: 'processor' as const,
        trackId: session.activeTrackId,
        prevProcessors: [{ id: 'rings-1', type: 'rings' as const, model: 0, params: {} }],
        timestamp: Date.now(),
        description: 'Remove processor',
      }],
    };
    const result = maybeApplySurfaceTemplate(afterRemove, session.activeTrackId, 'Remove processor');
    const track = result.tracks.find(t => t.id === session.activeTrackId)!;
    // Should now have the plaits-only template (knob-group + step-grid, no macro-knob)
    expect(track.surface.modules.some(m => m.type === 'knob-group')).toBe(true);
    expect(track.surface.modules.some(m => m.type === 'macro-knob')).toBe(false);
  });

  it('updates surface after replacing a processor', () => {
    // Start with plaits:rings
    const session = makeSessionWithTrack({
      processors: [{ id: 'rings-1', type: 'rings', model: 0, params: {} }],
      surface: { modules: [], thumbprint: { type: 'static-color' } },
    });
    const withTemplate = maybeApplySurfaceTemplate(
      { ...session, undoStack: [{ kind: 'processor', trackId: session.activeTrackId, prevProcessors: [], timestamp: Date.now(), description: 'setup' }] },
      session.activeTrackId,
      'setup',
    );
    // Replace rings with clouds
    const afterReplace: Session = {
      ...withTemplate,
      tracks: withTemplate.tracks.map(t =>
        t.id === session.activeTrackId ? { ...t, processors: [{ id: 'clouds-1', type: 'clouds' as const, model: 0, params: {} }] } : t,
      ),
      undoStack: [...withTemplate.undoStack, {
        kind: 'processor' as const,
        trackId: session.activeTrackId,
        prevProcessors: [{ id: 'rings-1', type: 'rings' as const, model: 0, params: {} }],
        timestamp: Date.now(),
        description: 'Swap processor: rings → clouds',
      }],
    };
    const result = maybeApplySurfaceTemplate(afterReplace, session.activeTrackId, 'Swap processor: rings → clouds');
    const track = result.tracks.find(t => t.id === session.activeTrackId)!;
    // Should have plaits:clouds template
    expect(track.surface.modules.some(m => m.type === 'macro-knob')).toBe(true);
    // The space macro-knob should exist (specific to clouds template)
    expect(track.surface.modules.find(m => m.id === 'space')).toBeDefined();
  });
});
