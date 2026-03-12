// tests/engine/region-undo.test.ts
import { describe, it, expect } from 'vitest';
import { executeOperations } from '../../src/engine/operation-executor';
import { applySketch, applyUndo, applyMove } from '../../src/engine/primitives';
import { createSession, setAgency } from '../../src/engine/session';
import { getVoice } from '../../src/engine/types';
import type { AIAction, RegionSnapshot, PatternSnapshot } from '../../src/engine/types';
import { Arbitrator } from '../../src/engine/arbitration';
import type { SourceAdapter } from '../../src/engine/canonical-types';

function createTestAdapter(): SourceAdapter {
  return {
    id: 'test',
    name: 'Test Adapter',
    mapControl(controlId: string) {
      const map: Record<string, string> = { brightness: 'timbre', richness: 'harmonics', texture: 'morph', pitch: 'note' };
      return { adapterId: 'test', path: `params.${map[controlId] ?? controlId}` };
    },
    mapRuntimeParamKey(paramKey: string) {
      const map: Record<string, string> = { timbre: 'brightness', harmonics: 'richness', morph: 'texture', note: 'pitch' };
      return map[paramKey] ?? null;
    },
    applyControlChanges() {},
    mapEvents() { return []; },
    readControlState() { return {}; },
    readRegions() { return []; },
    getControlSchemas() { return []; },
    validateOperation() { return { valid: true }; },
    midiToNormalisedPitch(midi: number) { return midi / 127; },
    normalisedPitchToMidi(n: number) { return Math.round(n * 127); },
  };
}

describe('Region Undo', () => {
  const adapter = createTestAdapter();

  it('RegionSnapshot revert restores events and re-projects pattern', () => {
    let session = createSession();
    session = setAgency(session, 'v0', 'ON');

    // AI sketch via events → creates RegionSnapshot
    const actions: AIAction[] = [{
      type: 'sketch',
      voiceId: 'v0',
      description: 'kick pattern',
      events: [
        { kind: 'trigger', at: 0, velocity: 1.0, accent: true },
        { kind: 'trigger', at: 4, velocity: 0.8 },
      ],
    }];
    const report = executeOperations(session, actions, adapter, new Arbitrator());
    const afterSketch = report.session;

    expect(getVoice(afterSketch, 'v0').pattern.steps[0].gate).toBe(true);
    expect(getVoice(afterSketch, 'v0').regions[0].events.length).toBe(2);

    // Undo
    const undone = applyUndo(afterSketch);
    expect(getVoice(undone, 'v0').pattern.steps[0].gate).toBe(false);
    expect(getVoice(undone, 'v0').regions[0].events.length).toBe(0);
  });

  it('old PatternSnapshot entries still revert correctly', () => {
    let session = createSession();
    // Legacy AI sketch via pattern (creates PatternSnapshot)
    session = applySketch(session, 'v0', 'legacy', {
      steps: [{ index: 0, gate: true }],
    });
    expect(getVoice(session, 'v0').pattern.steps[0].gate).toBe(true);

    const undone = applyUndo(session);
    expect(getVoice(undone, 'v0').pattern.steps[0].gate).toBe(false);
  });

  it('mixed undo stack: PatternSnapshot followed by RegionSnapshot', () => {
    let session = createSession();
    session = setAgency(session, 'v0', 'ON');

    // Legacy sketch (PatternSnapshot)
    session = applySketch(session, 'v0', 'legacy kick', {
      steps: [{ index: 0, gate: true }],
    });
    expect(session.undoStack.length).toBe(1);
    expect(session.undoStack[0].kind).toBe('pattern');

    // Canonical sketch (RegionSnapshot)
    const actions: AIAction[] = [{
      type: 'sketch',
      voiceId: 'v0',
      description: 'canonical hats',
      events: [
        { kind: 'trigger', at: 1, velocity: 0.8 },
        { kind: 'trigger', at: 3, velocity: 0.8 },
      ],
    }];
    const report = executeOperations(session, actions, adapter, new Arbitrator());
    session = report.session;

    // Should have both snapshot types
    expect(session.undoStack.length).toBe(2);
    expect(session.undoStack[0].kind).toBe('pattern');
    expect(session.undoStack[1].kind).toBe('region');

    // Undo RegionSnapshot (most recent)
    session = applyUndo(session);
    expect(getVoice(session, 'v0').regions[0].events.length).toBe(0);
    expect(session.undoStack.length).toBe(1);

    // Undo PatternSnapshot (legacy)
    session = applyUndo(session);
    expect(getVoice(session, 'v0').pattern.steps[0].gate).toBe(false);
    expect(session.undoStack.length).toBe(0);
  });

  it('AI sketch after human edit: human edit persists through undo', () => {
    let session = createSession();
    session = setAgency(session, 'v0', 'ON');

    // AI canonical sketch
    const actions: AIAction[] = [{
      type: 'sketch',
      voiceId: 'v0',
      description: 'kick',
      events: [{ kind: 'trigger', at: 0, velocity: 1.0, accent: true }],
    }];
    const report = executeOperations(session, actions, adapter, new Arbitrator());
    session = report.session;

    // Undo AI sketch
    const undone = applyUndo(session);
    expect(getVoice(undone, 'v0').pattern.steps[0].gate).toBe(false);
    expect(getVoice(undone, 'v0').regions[0].events).toHaveLength(0);
  });

  it('grouped actions with RegionSnapshot undo correctly', () => {
    let session = createSession();
    session = setAgency(session, 'v0', 'ON');

    // Multi-action: move + sketch → grouped
    const actions: AIAction[] = [
      { type: 'move', voiceId: 'v0', param: 'timbre', target: { absolute: 0.8 } },
      {
        type: 'sketch',
        voiceId: 'v0',
        description: 'kick',
        events: [{ kind: 'trigger', at: 0, velocity: 1.0, accent: true }],
      },
    ];
    const report = executeOperations(session, actions, adapter, new Arbitrator());
    session = report.session;

    expect(getVoice(session, 'v0').params.timbre).toBeCloseTo(0.8);
    expect(getVoice(session, 'v0').pattern.steps[0].gate).toBe(true);
    expect(session.undoStack.length).toBe(1);
    expect(session.undoStack[0].kind).toBe('group');

    // Single undo reverts both
    const undone = applyUndo(session);
    expect(getVoice(undone, 'v0').params.timbre).toBeCloseTo(0.5);
    expect(getVoice(undone, 'v0').pattern.steps[0].gate).toBe(false);
    expect(getVoice(undone, 'v0').regions[0].events).toHaveLength(0);
  });
});
