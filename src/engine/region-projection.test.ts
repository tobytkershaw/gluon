import { describe, it, expect } from 'vitest';
import { reprojectTrackStepGrid, projectPatternToStepGrid } from './region-projection';
import type { Track } from './types';
import type { Pattern, NoteEvent, TriggerEvent } from './canonical-types';

function makeTrack(pattern: Pattern): Track {
  return {
    id: 'v0',
    engine: 'plaits',
    model: 0,
    params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
    agency: 'ON',
    muted: false,
    solo: false,
    stepGrid: { steps: [], length: 16 },
    patterns: [pattern],
    sequence: [{ patternId: pattern.id }],
    surface: {
      semanticControls: [],
      pinnedControls: [],
      xyAxes: { x: 'timbre', y: 'morph' },
      thumbprint: { type: 'static-color' },
    },
    volume: 0.8,
    pan: 0,
  };
}

describe('region-projection', () => {
  it('reprojects stepGrid from pattern events after recording', () => {
    // Simulates the recording path: events are added to the pattern,
    // then reprojectTrackStepGrid derives the stepGrid cache.
    const pattern: Pattern = {
      id: 'p0',
      kind: 'pattern',
      duration: 8,
      events: [
        { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
        { kind: 'trigger', at: 4, velocity: 0.6 } as TriggerEvent,
      ],
    };

    const track = makeTrack(pattern);
    const result = reprojectTrackStepGrid(track);

    expect(result.stepGrid.length).toBe(8);
    expect(result.stepGrid.steps[0].gate).toBe(true);
    expect(result.stepGrid.steps[4].gate).toBe(true);
    // Steps without events should have gate off
    expect(result.stepGrid.steps[1].gate).toBe(false);
    expect(result.stepGrid.steps[7].gate).toBe(false);
  });

  it('handles note events in reprojection', () => {
    const pattern: Pattern = {
      id: 'p0',
      kind: 'pattern',
      duration: 4,
      events: [
        { kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 2 } as NoteEvent,
        { kind: 'note', at: 2, pitch: 64, velocity: 0.6, duration: 1 } as NoteEvent,
      ],
    };

    const track = makeTrack(pattern);
    const result = reprojectTrackStepGrid(track);

    expect(result.stepGrid.length).toBe(4);
    expect(result.stepGrid.steps[0].gate).toBe(true);
    expect(result.stepGrid.steps[2].gate).toBe(true);
  });

  it('returns track unchanged when no patterns exist', () => {
    const track: Track = {
      id: 'v0',
      engine: 'plaits',
      model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
      agency: 'ON',
      muted: false,
      solo: false,
      stepGrid: { steps: [], length: 16 },
      patterns: [],
      sequence: [],
      surface: {
        semanticControls: [],
        pinnedControls: [],
        xyAxes: { x: 'timbre', y: 'morph' },
        thumbprint: { type: 'static-color' },
      },
      volume: 0.8,
      pan: 0,
    };

    const result = reprojectTrackStepGrid(track);
    expect(result).toBe(track); // same reference, no-op
  });

  it('projectPatternToStepGrid uses the given step count', () => {
    const pattern: Pattern = {
      id: 'p0',
      kind: 'pattern',
      duration: 16,
      events: [
        { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
      ],
    };

    const grid = projectPatternToStepGrid(pattern, 16);
    expect(grid.length).toBe(16);
    expect(grid.steps).toHaveLength(16);
    expect(grid.steps[0].gate).toBe(true);
  });
});
