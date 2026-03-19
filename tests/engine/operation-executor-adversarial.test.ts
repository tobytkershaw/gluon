// tests/engine/operation-executor-adversarial.test.ts
//
// Adversarial tests for the operation executor — the bridge between AI tool
// calls and session state mutations. Tests malformed inputs, stale references,
// boundary values, concurrent operations, and type-specific constraints.
// Issue #864

import { describe, it, expect } from 'vitest';
import { executeOperations, prevalidateAction } from '../../src/engine/operation-executor';
import { createSession, addTrack, setAgency } from '../../src/engine/session';
import { Arbitrator } from '../../src/engine/arbitration';
import type { SourceAdapter } from '../../src/engine/canonical-types';
import type { AIAction, Session, Track, ProcessorConfig, ModulatorConfig, ModulationRouting } from '../../src/engine/types';
import { getTrack, updateTrack } from '../../src/engine/types';
import { applyUndo } from '../../src/engine/primitives';

// ---------------------------------------------------------------------------
// Test adapter (mirrors the pattern from operation-executor.test.ts)
// ---------------------------------------------------------------------------

function createTestAdapter(): SourceAdapter {
  return {
    id: 'test',
    name: 'Test Adapter',
    mapControl(controlId: string) {
      const map: Record<string, string> = { frequency: 'note' };
      return { adapterId: 'test', path: `params.${map[controlId] ?? controlId}` };
    },
    mapRuntimeParamKey(paramKey: string) {
      const map: Record<string, string> = { note: 'frequency' };
      const known = new Set(['timbre', 'harmonics', 'morph']);
      if (map[paramKey]) return map[paramKey];
      if (known.has(paramKey)) return paramKey;
      return null;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const adapter = createTestAdapter();

function setupSession(): Session {
  let session = createSession();
  session = setAgency(session, 'v0', 'ON');
  return session;
}

/** Add a processor to a track, returning updated session. */
function addProcessorToTrack(session: Session, trackId: string, proc: ProcessorConfig): Session {
  const track = getTrack(session, trackId);
  return updateTrack(session, trackId, {
    processors: [...(track.processors ?? []), proc],
  });
}

/** Add a modulator to a track, returning updated session. */
function addModulatorToTrack(session: Session, trackId: string, mod: ModulatorConfig): Session {
  const track = getTrack(session, trackId);
  return updateTrack(session, trackId, {
    modulators: [...(track.modulators ?? []), mod],
  });
}

/** Add a modulation routing to a track, returning updated session. */
function addModulationToTrack(session: Session, trackId: string, routing: ModulationRouting): Session {
  const track = getTrack(session, trackId);
  return updateTrack(session, trackId, {
    modulations: [...(track.modulations ?? []), routing],
  });
}

/** Run actions through executeOperations. Convenience wrapper. */
function run(session: Session, actions: AIAction[], arb?: Arbitrator) {
  return executeOperations(session, actions, adapter, arb ?? new Arbitrator());
}

/** Snapshot the session state as JSON for deep equality checks. */
function sessionFingerprint(session: Session): string {
  return JSON.stringify({
    tracks: session.tracks,
    transport: session.transport,
    master: session.master,
    context: session.context,
  });
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Operation executor adversarial tests', () => {

  // -------------------------------------------------------------------------
  // 1. Operations targeting deleted / non-existent tracks
  // -------------------------------------------------------------------------

  describe('stale and non-existent track references', () => {
    it('rejects move targeting a non-existent trackId', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'move', trackId: 'does-not-exist', param: 'timbre', target: { absolute: 0.5 } },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Track not found');
      expect(report.accepted).toHaveLength(0);
    });

    it('rejects sketch targeting a non-existent trackId', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'sketch', trackId: 'ghost-track', description: 'test', events: [] },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Track not found');
    });

    it('rejects transform targeting a non-existent trackId', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'transform', trackId: 'no-such-track', operation: 'reverse', description: 'test' },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Track not found');
    });

    it('rejects set_model targeting a non-existent trackId', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'set_model', trackId: 'missing', model: 'analog-bass-drum' },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Track not found');
    });

    it('rejects edit_pattern targeting a non-existent trackId', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'edit_pattern', trackId: 'phantom', operations: [], description: 'test' },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Track not found');
    });

    it('rejects add_processor targeting a non-existent trackId', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'add_processor', trackId: 'gone', moduleType: 'rings', processorId: 'p1', description: 'test' },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Track not found');
    });

    it('rejects remove_track targeting a non-existent trackId', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'remove_track', trackId: 'deleted-long-ago', description: 'test' },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Track not found');
    });

    it('rejects set_mute_solo targeting a non-existent trackId', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'set_mute_solo', trackId: 'nope', muted: true },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Track not found');
    });

    it('rejects set_track_mix targeting a non-existent trackId', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'set_track_mix', trackId: 'absent', volume: 0.5 },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Track not found');
    });

    it('second action in a batch sees the effect of a prior remove_track', () => {
      let session = setupSession();
      // Add a second track so we can remove v0
      const added = addTrack(session, 'audio');
      expect(added).not.toBeNull();
      session = added!;
      const newTrackId = session.tracks.find(t => t.id !== 'v0' && t.kind !== 'bus')!.id;
      session = setAgency(session, newTrackId, 'ON');

      const report = run(session, [
        { type: 'remove_track', trackId: 'v0', description: 'remove' },
        { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.5 } },
      ]);
      // First should succeed, second should be rejected (track now gone)
      expect(report.accepted.length).toBe(1);
      expect(report.rejected.length).toBe(1);
      expect(report.rejected[0].reason).toContain('Track not found');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Out-of-range parameter values
  // -------------------------------------------------------------------------

  describe('out-of-range parameter values', () => {
    it('clamps absolute move values > 1.0 to 1.0', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 5.0 } },
      ]);
      expect(report.accepted).toHaveLength(1);
      const track = report.session.tracks.find(t => t.id === 'v0')!;
      expect(track.params.timbre).toBeLessThanOrEqual(1.0);
    });

    it('clamps absolute move values < 0 to 0', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: -3.0 } },
      ]);
      expect(report.accepted).toHaveLength(1);
      const track = report.session.tracks.find(t => t.id === 'v0')!;
      expect(track.params.timbre).toBeGreaterThanOrEqual(0);
    });

    it('clamps relative move that would exceed 1.0', () => {
      const session = setupSession();
      // timbre starts at 0.5
      const report = run(session, [
        { type: 'move', trackId: 'v0', param: 'timbre', target: { relative: 2.0 } },
      ]);
      expect(report.accepted).toHaveLength(1);
      const track = report.session.tracks.find(t => t.id === 'v0')!;
      expect(track.params.timbre).toBeLessThanOrEqual(1.0);
    });

    it('clamps relative move that would go below 0', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'move', trackId: 'v0', param: 'timbre', target: { relative: -5.0 } },
      ]);
      expect(report.accepted).toHaveLength(1);
      const track = report.session.tracks.find(t => t.id === 'v0')!;
      expect(track.params.timbre).toBeGreaterThanOrEqual(0);
    });

    it('clamps transport BPM to valid range', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'set_transport', bpm: -100 },
      ]);
      expect(report.accepted).toHaveLength(1);
      expect(report.session.transport.bpm).toBeGreaterThanOrEqual(20);
    });

    it('clamps transport BPM above max', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'set_transport', bpm: 9999 },
      ]);
      expect(report.accepted).toHaveLength(1);
      expect(report.session.transport.bpm).toBeLessThanOrEqual(300);
    });

    it('clamps transport swing to [0, 1]', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'set_transport', swing: -0.5 },
      ]);
      expect(report.accepted).toHaveLength(1);
      expect(report.session.transport.swing).toBeGreaterThanOrEqual(0);

      const report2 = run(session, [
        { type: 'set_transport', swing: 2.0 },
      ]);
      expect(report2.session.transport.swing).toBeLessThanOrEqual(1);
    });

    it('clamps master volume to [0, 1]', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'set_master', volume: -1 },
      ]);
      expect(report.accepted).toHaveLength(1);
      expect(report.session.master.volume).toBeGreaterThanOrEqual(0);

      const report2 = run(session, [
        { type: 'set_master', volume: 10 },
      ]);
      expect(report2.session.master.volume).toBeLessThanOrEqual(1);
    });

    it('clamps master pan to [-1, 1]', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'set_master', pan: -5 },
      ]);
      expect(report.session.master.pan).toBeGreaterThanOrEqual(-1);

      const report2 = run(session, [
        { type: 'set_master', pan: 5 },
      ]);
      expect(report2.session.master.pan).toBeLessThanOrEqual(1);
    });

    it('clamps track mix volume and pan', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'set_track_mix', trackId: 'v0', volume: -2, pan: 99 },
      ]);
      expect(report.accepted).toHaveLength(1);
      const track = report.session.tracks.find(t => t.id === 'v0')!;
      expect(track.volume).toBeGreaterThanOrEqual(0);
      expect(track.volume).toBeLessThanOrEqual(1);
      expect(track.pan).toBeGreaterThanOrEqual(-1);
      expect(track.pan).toBeLessThanOrEqual(1);
    });

    it('clamps importance to [0, 1]', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'set_importance', trackId: 'v0', importance: 5.0 },
      ]);
      expect(report.accepted).toHaveLength(1);
      const track = report.session.tracks.find(t => t.id === 'v0')!;
      expect(track.importance).toBeLessThanOrEqual(1);
      expect(track.importance).toBeGreaterThanOrEqual(0);
    });

    it('Infinity values are clamped to valid range', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'move', trackId: 'v0', param: 'harmonics', target: { absolute: Infinity } },
        { type: 'move', trackId: 'v0', param: 'morph', target: { absolute: -Infinity } },
      ]);
      const track = report.session.tracks.find(t => t.id === 'v0')!;
      // Infinity clamps to 1, -Infinity clamps to 0
      expect(track.params.harmonics).toBeLessThanOrEqual(1);
      expect(track.params.morph).toBeGreaterThanOrEqual(0);
    });

    it('NaN absolute move is rejected (NaN guard added in #892)', () => {
      // Previously NaN passed through clamping. PR #901 (#892) added NaN/Infinity rejection.
      const session = setupSession();
      const report = run(session, [
        { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: NaN } },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Non-finite');
      expect(report.accepted).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Invalid model indices
  // -------------------------------------------------------------------------

  describe('invalid model references', () => {
    it('rejects set_model with a non-existent engine ID', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'set_model', trackId: 'v0', model: 'quantum-synth-9000' },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Unknown model');
    });

    it('rejects set_model with empty string model', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'set_model', trackId: 'v0', model: '' },
      ]);
      expect(report.rejected).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Unknown / unresolvable param keys
  // -------------------------------------------------------------------------

  describe('unknown param keys', () => {
    it('rejects move with a completely unknown param name', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'move', trackId: 'v0', param: 'nonexistent_param_xyz', target: { absolute: 0.5 } },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Unknown control');
    });

    it('rejects move with an empty param string', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'move', trackId: 'v0', param: '', target: { absolute: 0.5 } },
      ]);
      expect(report.rejected).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Concurrent operations on the same track parameter
  // -------------------------------------------------------------------------

  describe('concurrent operations on the same parameter', () => {
    it('applies sequential moves to the same param — last write wins', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.2 } },
        { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.9 } },
      ]);
      // Both should be accepted
      expect(report.accepted).toHaveLength(2);
      const track = report.session.tracks.find(t => t.id === 'v0')!;
      expect(track.params.timbre).toBeCloseTo(0.9);
    });

    it('relative move stacks on top of previous absolute move', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.5 } },
        { type: 'move', trackId: 'v0', param: 'timbre', target: { relative: 0.1 } },
      ]);
      expect(report.accepted).toHaveLength(2);
      const track = report.session.tracks.find(t => t.id === 'v0')!;
      expect(track.params.timbre).toBeCloseTo(0.6);
    });

    it('valid operations succeed regardless of ordering within batch', () => {
      const session = setupSession();
      // Multiple different params in arbitrary order
      const actions: AIAction[] = [
        { type: 'move', trackId: 'v0', param: 'morph', target: { absolute: 0.3 } },
        { type: 'set_transport', bpm: 140 },
        { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.7 } },
        { type: 'set_master', volume: 0.6 },
        { type: 'move', trackId: 'v0', param: 'harmonics', target: { absolute: 0.1 } },
      ];
      const report = run(session, actions);
      expect(report.accepted).toHaveLength(5);
      expect(report.rejected).toHaveLength(0);

      const track = report.session.tracks.find(t => t.id === 'v0')!;
      expect(track.params.morph).toBeCloseTo(0.3);
      expect(track.params.timbre).toBeCloseTo(0.7);
      expect(track.params.harmonics).toBeCloseTo(0.1);
      expect(report.session.transport.bpm).toBe(140);
      expect(report.session.master.volume).toBeCloseTo(0.6);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Sketch with no events and no pattern (malformed)
  // -------------------------------------------------------------------------

  describe('malformed sketch operations', () => {
    it('rejects sketch with neither events nor pattern', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'sketch', trackId: 'v0', description: 'empty sketch' },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('neither events nor pattern');
    });
  });

  // -------------------------------------------------------------------------
  // 7. Processor operations: stale refs, non-existent IDs
  // -------------------------------------------------------------------------

  describe('processor adversarial operations', () => {
    it('rejects remove_processor with non-existent processorId', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'remove_processor', trackId: 'v0', processorId: 'proc-ghost', description: 'test' },
      ]);
      expect(report.rejected).toHaveLength(1);
    });

    it('rejects bypass_processor with non-existent processorId', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'bypass_processor', trackId: 'v0', processorId: 'nope', enabled: false, description: 'test' },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Processor not found');
    });

    it('rejects replace_processor with non-existent source processorId', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'replace_processor', trackId: 'v0', processorId: 'missing', newModuleType: 'rings', newProcessorId: 'new1', description: 'test' },
      ]);
      expect(report.rejected).toHaveLength(1);
    });

    it('rejects move targeting a non-existent processorId', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'move', trackId: 'v0', processorId: 'no-such-proc', param: 'mix', target: { absolute: 0.5 } },
      ]);
      expect(report.rejected).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // 8. Modulator operations: stale refs, non-existent IDs
  // -------------------------------------------------------------------------

  describe('modulator adversarial operations', () => {
    it('rejects remove_modulator with non-existent modulatorId', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'remove_modulator', trackId: 'v0', modulatorId: 'mod-ghost', description: 'test' },
      ]);
      expect(report.rejected).toHaveLength(1);
    });

    it('rejects connect_modulator with non-existent modulatorId', () => {
      const session = setupSession();
      const report = run(session, [
        {
          type: 'connect_modulator', trackId: 'v0',
          modulatorId: 'mod-missing',
          target: { kind: 'source', param: 'timbre' },
          depth: 0.5,
          description: 'test',
        },
      ]);
      expect(report.rejected).toHaveLength(1);
    });

    it('rejects disconnect_modulator with non-existent modulationId', () => {
      const session = setupSession();
      const report = run(session, [
        {
          type: 'disconnect_modulator', trackId: 'v0',
          modulationId: 'route-nonexistent',
          description: 'test',
        },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Modulation routing not found');
    });

    it('rejects move targeting a non-existent modulatorId', () => {
      const session = setupSession();
      const report = run(session, [
        {
          type: 'move', trackId: 'v0',
          modulatorId: 'mod-nonexistent',
          param: 'rate',
          target: { absolute: 0.5 },
        },
      ]);
      expect(report.rejected).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // 9. Agency enforcement
  // -------------------------------------------------------------------------

  describe('agency enforcement', () => {
    it('rejects all mutation types on agency-OFF tracks', () => {
      let session = createSession();
      session = setAgency(session, 'v0', 'OFF');

      const mutatingActions: AIAction[] = [
        { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.5 } },
        { type: 'sketch', trackId: 'v0', description: 'test', events: [{ kind: 'trigger', at: 0, velocity: 0.8 }] },
        { type: 'transform', trackId: 'v0', operation: 'reverse', description: 'test' },
        { type: 'set_model', trackId: 'v0', model: 'analog-bass-drum' },
        { type: 'manage_pattern', trackId: 'v0', action: 'add', description: 'test' },
        { type: 'mark_approved', trackId: 'v0', level: 'liked', reason: 'test' },
      ];

      for (const action of mutatingActions) {
        const report = run(session, [action]);
        expect(report.rejected).toHaveLength(1);
        expect(report.rejected[0].reason).toContain('agency OFF');
      }
    });

    it('allows non-musical ops on agency-OFF tracks (views, surface, importance)', () => {
      let session = createSession();
      session = setAgency(session, 'v0', 'OFF');

      const nonMusicalActions: AIAction[] = [
        { type: 'add_view', trackId: 'v0', viewKind: 'step-grid', description: 'test' },
        { type: 'set_importance', trackId: 'v0', importance: 0.8 },
        { type: 'label_axes', trackId: 'v0', x: 'bright', y: 'dark', description: 'test' },
      ];

      for (const action of nonMusicalActions) {
        const report = run(session, [action]);
        expect(report.accepted).toHaveLength(1);
        expect(report.rejected).toHaveLength(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 10. State consistency after rejection — no partial mutation
  // -------------------------------------------------------------------------

  describe('no partial state mutation on rejection', () => {
    it('session state unchanged when all actions in batch are rejected', () => {
      let session = createSession();
      session = setAgency(session, 'v0', 'OFF');
      const before = sessionFingerprint(session);

      const report = run(session, [
        { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.99 } },
        { type: 'sketch', trackId: 'v0', description: 'test', events: [{ kind: 'trigger', at: 0, velocity: 0.8 }] },
      ]);

      expect(report.rejected).toHaveLength(2);
      const after = sessionFingerprint(report.session);
      expect(after).toBe(before);
    });

    it('only valid actions mutate state in a mixed batch', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.8 } },
        { type: 'move', trackId: 'v0', param: 'nonexistent_xyz', target: { absolute: 0.5 } },
        { type: 'set_transport', bpm: 140 },
      ]);

      expect(report.accepted).toHaveLength(2);
      expect(report.rejected).toHaveLength(1);

      // The valid ops took effect
      const track = report.session.tracks.find(t => t.id === 'v0')!;
      expect(track.params.timbre).toBeCloseTo(0.8);
      expect(report.session.transport.bpm).toBe(140);
    });
  });

  // -------------------------------------------------------------------------
  // 11. Undo consistency after adversarial sequences
  // -------------------------------------------------------------------------

  describe('undo consistency', () => {
    it('undo stack has exactly one entry after a multi-action batch', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.1 } },
        { type: 'move', trackId: 'v0', param: 'harmonics', target: { absolute: 0.2 } },
        { type: 'set_transport', bpm: 90 },
      ]);
      // All three should be grouped into one undo entry
      expect(report.session.undoStack).toHaveLength(1);
      expect(report.session.undoStack[0].kind).toBe('group');
    });

    it('undo after mixed accept/reject restores correct state', () => {
      const session = setupSession();
      const beforeTimbre = session.tracks.find(t => t.id === 'v0')!.params.timbre;

      const report = run(session, [
        { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.99 } },
        { type: 'move', trackId: 'v0', param: 'bogus_param', target: { absolute: 0.5 } },
      ]);

      expect(report.accepted).toHaveLength(1);
      expect(report.rejected).toHaveLength(1);

      // Undo the accepted move
      const undone = applyUndo(report.session);
      const track = undone.tracks.find(t => t.id === 'v0')!;
      expect(track.params.timbre).toBeCloseTo(beforeTimbre);
    });
  });

  // -------------------------------------------------------------------------
  // 12. Preservation / approval blocking
  // -------------------------------------------------------------------------

  describe('preservation and approval constraints', () => {
    it('rejects sketch on anchor-approved track', () => {
      let session = setupSession();
      session = updateTrack(session, 'v0', { approval: 'anchor' });
      const report = run(session, [
        { type: 'sketch', trackId: 'v0', description: 'test', events: [{ kind: 'trigger', at: 0, velocity: 0.8 }] },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('anchored');
    });

    it('rejects transform on anchor-approved track', () => {
      let session = setupSession();
      session = updateTrack(session, 'v0', { approval: 'anchor' });
      const report = run(session, [
        { type: 'transform', trackId: 'v0', operation: 'reverse', description: 'test' },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('anchored');
    });

    it('rejects remove_track on anchor-approved track', () => {
      let session = setupSession();
      session = updateTrack(session, 'v0', { approval: 'anchor' });
      const report = run(session, [
        { type: 'remove_track', trackId: 'v0', description: 'test' },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('anchor');
    });

    it('allows transpose on approved track (preserves rhythm)', () => {
      let session = setupSession();
      session = updateTrack(session, 'v0', { approval: 'approved' });
      const report = run(session, [
        { type: 'transform', trackId: 'v0', operation: 'transpose', semitones: 3, description: 'test' },
      ]);
      expect(report.accepted).toHaveLength(1);
      expect(report.rejected).toHaveLength(0);
    });

    it('rejects non-transpose transform on approved track', () => {
      let session = setupSession();
      session = updateTrack(session, 'v0', { approval: 'approved' });
      const report = run(session, [
        { type: 'transform', trackId: 'v0', operation: 'rotate', steps: 2, description: 'test' },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('approved');
    });
  });

  // -------------------------------------------------------------------------
  // 13. Arbitration blocking
  // -------------------------------------------------------------------------

  describe('arbitration blocking', () => {
    it('rejects move when human is holding the same param', () => {
      const session = setupSession();
      const arb = new Arbitrator(10000);
      arb.humanTouched('v0', 'timbre', 0.5);

      const report = run(session, [
        { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.8 } },
      ], arb);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Arbitration');
    });

    it('allows move on a different param while human holds another', () => {
      const session = setupSession();
      const arb = new Arbitrator(10000);
      arb.humanTouched('v0', 'timbre', 0.5);

      const report = run(session, [
        { type: 'move', trackId: 'v0', param: 'harmonics', target: { absolute: 0.8 } },
      ], arb);
      expect(report.accepted).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // 14. View operations: stale refs
  // -------------------------------------------------------------------------

  describe('view operation edge cases', () => {
    it('rejects remove_view with non-existent viewId', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'remove_view', trackId: 'v0', viewId: 'view-does-not-exist', description: 'test' },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('View not found');
    });
  });

  // -------------------------------------------------------------------------
  // 15. Surface operations: pin limits, unknown modules
  // -------------------------------------------------------------------------

  describe('surface operation edge cases', () => {
    it('rejects pin on an unknown moduleId', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'pin', trackId: 'v0', moduleId: 'nonexistent-module', controlId: 'x', description: 'test' },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Unknown module');
    });

    it('rejects unpin when pin does not exist', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'unpin', trackId: 'v0', moduleId: 'source', controlId: 'no-such-control', description: 'test' },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Pin not found');
    });

    it('rejects pin beyond max pinned controls limit', () => {
      let session = setupSession();
      // Pre-populate 4 pins (the max)
      const track = getTrack(session, 'v0');
      const pinnedControls = Array.from({ length: 4 }, (_, i) => ({
        moduleId: 'source',
        controlId: `ctrl-${i}`,
      }));
      session = updateTrack(session, 'v0', {
        surface: { ...track.surface, pinnedControls },
      });

      const report = run(session, [
        { type: 'pin', trackId: 'v0', moduleId: 'source', controlId: 'one-too-many', description: 'test' },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Maximum');
    });
  });

  // -------------------------------------------------------------------------
  // 16. Edit pattern: non-existent patternId
  // -------------------------------------------------------------------------

  describe('edit_pattern edge cases', () => {
    it('rejects edit_pattern with a non-existent patternId', () => {
      const session = setupSession();
      const report = run(session, [
        {
          type: 'edit_pattern',
          trackId: 'v0',
          patternId: 'pattern-does-not-exist',
          operations: [],
          description: 'test',
        },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Pattern not found');
    });
  });

  // -------------------------------------------------------------------------
  // 17. Transport time signature: invalid denominators
  // -------------------------------------------------------------------------

  describe('transport time signature edge cases', () => {
    it('ignores invalid time signature denominator', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'set_transport', timeSignatureDenominator: 7 },
      ]);
      expect(report.accepted).toHaveLength(1);
      // Should fall back to default (4) since 7 is not a valid denominator
      const ts = report.session.transport.timeSignature;
      expect([2, 4, 8, 16]).toContain(ts.denominator);
    });

    it('clamps time signature numerator to [1, 16]', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'set_transport', timeSignatureNumerator: -3 },
      ]);
      expect(report.session.transport.timeSignature.numerator).toBeGreaterThanOrEqual(1);

      const report2 = run(session, [
        { type: 'set_transport', timeSignatureNumerator: 999 },
      ]);
      expect(report2.session.transport.timeSignature.numerator).toBeLessThanOrEqual(16);
    });
  });

  // -------------------------------------------------------------------------
  // 18. Manage pattern: missing required fields
  // -------------------------------------------------------------------------

  describe('manage_pattern edge cases', () => {
    it('rejects remove without patternId', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'manage_pattern', trackId: 'v0', action: 'remove', description: 'test' },
      ]);
      expect(report.rejected).toHaveLength(1);
    });

    it('rejects duplicate without patternId', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'manage_pattern', trackId: 'v0', action: 'duplicate', description: 'test' },
      ]);
      expect(report.rejected).toHaveLength(1);
    });

    it('rejects rename without patternId', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'manage_pattern', trackId: 'v0', action: 'rename', name: 'New Name', description: 'test' },
      ]);
      expect(report.rejected).toHaveLength(1);
    });

    it('rejects set_active without patternId', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'manage_pattern', trackId: 'v0', action: 'set_active', description: 'test' },
      ]);
      expect(report.rejected).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // 19. Manage send: invalid bus references
  // -------------------------------------------------------------------------

  describe('manage_send edge cases', () => {
    it('rejects set_level without level', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'manage_send', trackId: 'v0', action: 'set_level', busId: 'master-bus' },
      ]);
      expect(report.rejected).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // 20. Session consistency invariant: always consistent after any sequence
  // -------------------------------------------------------------------------

  describe('session consistency invariant', () => {
    it('session remains structurally valid after a large mixed batch', () => {
      let session = setupSession();
      // Add a second track
      const added = addTrack(session, 'audio');
      if (added) session = added;

      const actions: AIAction[] = [
        { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.3 } },
        { type: 'set_transport', bpm: 80 },
        { type: 'set_master', volume: 0.5, pan: -0.5 },
        { type: 'set_mute_solo', trackId: 'v0', muted: true },
        { type: 'say', text: 'hello' },
        { type: 'set_intent', intent: { genre: ['techno'] } },
        { type: 'set_section', section: { name: 'intro' } },
        // These should be rejected (non-existent refs)
        { type: 'move', trackId: 'FAKE', param: 'timbre', target: { absolute: 0.5 } },
        { type: 'remove_processor', trackId: 'v0', processorId: 'no-proc', description: 'test' },
      ];

      const report = run(session, actions);

      // Core structural invariants
      expect(report.session.tracks.length).toBeGreaterThan(0);
      expect(report.session.activeTrackId).toBeTruthy();
      expect(report.session.transport.bpm).toBeGreaterThanOrEqual(20);
      expect(report.session.transport.bpm).toBeLessThanOrEqual(300);
      expect(report.session.master.volume).toBeGreaterThanOrEqual(0);
      expect(report.session.master.volume).toBeLessThanOrEqual(1);
      expect(report.session.master.pan).toBeGreaterThanOrEqual(-1);
      expect(report.session.master.pan).toBeLessThanOrEqual(1);

      // All track params should be in valid range
      for (const track of report.session.tracks) {
        for (const [, value] of Object.entries(track.params)) {
          expect(Number.isFinite(value)).toBe(true);
        }
        expect(track.volume).toBeGreaterThanOrEqual(0);
        expect(track.volume).toBeLessThanOrEqual(1);
        expect(track.pan).toBeGreaterThanOrEqual(-1);
        expect(track.pan).toBeLessThanOrEqual(1);
      }

      // Rejected actions should have descriptive reasons
      for (const r of report.rejected) {
        expect(r.reason).toBeTruthy();
        expect(r.reason.length).toBeGreaterThan(5);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 21. prevalidateAction specifically
  // -------------------------------------------------------------------------

  describe('prevalidateAction', () => {
    it('returns null for valid actions', () => {
      const session = setupSession();
      const result = prevalidateAction(
        session,
        { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.5 } },
        adapter,
        new Arbitrator(),
      );
      expect(result).toBeNull();
    });

    it('returns descriptive string for invalid actions', () => {
      const session = setupSession();
      const result = prevalidateAction(
        session,
        { type: 'move', trackId: 'nonexistent', param: 'timbre', target: { absolute: 0.5 } },
        adapter,
        new Arbitrator(),
      );
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
      expect(result!.length).toBeGreaterThan(0);
    });

    it('returns non-empty reason for every rejection scenario', () => {
      let session = createSession();
      session = setAgency(session, 'v0', 'OFF');

      const invalidActions: AIAction[] = [
        { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.5 } },
        { type: 'sketch', trackId: 'v0', description: 'test', events: [] },
        { type: 'set_model', trackId: 'no-track', model: 'x' },
      ];

      for (const action of invalidActions) {
        const reason = prevalidateAction(session, action, adapter, new Arbitrator());
        expect(reason).not.toBeNull();
        expect(reason!.length).toBeGreaterThan(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 22. Drift (timed) move on processor/modulator should be rejected
  // -------------------------------------------------------------------------

  describe('drift (over) move restrictions', () => {
    it('rejects timed move on processor param', () => {
      let session = setupSession();
      session = addProcessorToTrack(session, 'v0', {
        id: 'proc-1',
        type: 'rings',
        model: 0,
        params: { brightness: 0.5 },
      });

      const report = run(session, [
        {
          type: 'move', trackId: 'v0',
          processorId: 'proc-1',
          param: 'brightness',
          target: { absolute: 0.8 },
          over: 1000,
        },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('not supported');
    });

    it('rejects timed move on modulator param', () => {
      let session = setupSession();
      session = addModulatorToTrack(session, 'v0', {
        id: 'mod-1',
        type: 'envelope',
        model: 0,
        params: { rate: 0.5 },
      });

      const report = run(session, [
        {
          type: 'move', trackId: 'v0',
          modulatorId: 'mod-1',
          param: 'rate',
          target: { absolute: 0.8 },
          over: 500,
        },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('not supported');
    });
  });

  // -------------------------------------------------------------------------
  // 23. Bus vs audio track type-specific validation
  // -------------------------------------------------------------------------

  describe('bus track constraints', () => {
    it('master bus track has kind bus', () => {
      const session = setupSession();
      const masterBus = session.tracks.find(t => t.id === 'master-bus');
      expect(masterBus).toBeDefined();
      expect(masterBus!.kind).toBe('bus');
    });

    it('can set mute/solo on bus tracks', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'set_mute_solo', trackId: 'master-bus', muted: true },
      ]);
      expect(report.accepted).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // 24. Mark approved with invalid level
  // -------------------------------------------------------------------------

  describe('mark_approved edge cases', () => {
    it('rejects mark_approved with invalid approval level', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'mark_approved', trackId: 'v0', level: 'super-approved' as any, reason: 'test' },
      ]);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('Invalid approval level');
    });
  });

  // -------------------------------------------------------------------------
  // 25. Say action always succeeds
  // -------------------------------------------------------------------------

  describe('say action', () => {
    it('say action is always accepted', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'say', text: 'Hello world' },
      ]);
      expect(report.accepted).toHaveLength(1);
      expect(report.rejected).toHaveLength(0);
    });

    it('say with empty text is accepted', () => {
      const session = setupSession();
      const report = run(session, [
        { type: 'say', text: '' },
      ]);
      expect(report.accepted).toHaveLength(1);
    });
  });
});

// ===========================================================================
// NaN and Infinity rejection (#892)
// ===========================================================================

describe('operation-executor adversarial — NaN and Infinity rejection (#892)', () => {
  // #892: NaN must be rejected, not silently passed through clamping
  it('rejects NaN in absolute move target', () => {
    const session = setupSession();
    const actions: AIAction[] = [
      { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: NaN } },
    ];
    const report = run(session, actions);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0].reason).toContain('Non-finite');
    expect(report.accepted).toHaveLength(0);
    // State must not be mutated — timbre should retain its original value
    const origTrack = session.tracks.find(v => v.id === 'v0')!;
    const track = report.session.tracks.find(v => v.id === 'v0')!;
    expect(track.params.timbre).toBe(origTrack.params.timbre);
  });

  // #892: Infinity must be rejected, not clamped to 1
  it('rejects Infinity in absolute move target', () => {
    const session = setupSession();
    const actions: AIAction[] = [
      { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: Infinity } },
    ];
    const report = run(session, actions);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0].reason).toContain('Non-finite');
    expect(report.accepted).toHaveLength(0);
  });

  // #892: -Infinity must be rejected, not clamped to 0
  it('rejects -Infinity in absolute move target', () => {
    const session = setupSession();
    const actions: AIAction[] = [
      { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: -Infinity } },
    ];
    const report = run(session, actions);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0].reason).toContain('Non-finite');
    expect(report.accepted).toHaveLength(0);
  });

  it('rejects NaN in relative move target', () => {
    const session = setupSession();
    const actions: AIAction[] = [
      { type: 'move', trackId: 'v0', param: 'timbre', target: { relative: NaN } },
    ];
    const report = run(session, actions);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0].reason).toContain('Non-finite');
  });

  it('rejects NaN in drift move target', () => {
    const session = setupSession();
    const actions: AIAction[] = [
      { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: NaN }, over: 500 },
    ];
    const report = run(session, actions);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0].reason).toContain('Non-finite');
  });

  it('rejects Infinity in drift move target', () => {
    const session = setupSession();
    const actions: AIAction[] = [
      { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: Infinity }, over: 500 },
    ];
    const report = run(session, actions);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0].reason).toContain('Non-finite');
  });

  it('rejects NaN in set_transport swing', () => {
    const session = setupSession();
    const actions: AIAction[] = [
      { type: 'set_transport', swing: NaN },
    ];
    const report = run(session, actions);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0].reason).toContain('Non-finite');
    // Transport must not be mutated
    expect(Number.isFinite(report.session.transport.swing)).toBe(true);
  });

  it('rejects NaN in set_transport bpm', () => {
    const session = setupSession();
    const actions: AIAction[] = [
      { type: 'set_transport', bpm: NaN },
    ];
    const report = run(session, actions);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0].reason).toContain('Non-finite');
  });

  it('rejects NaN in set_master volume', () => {
    const session = setupSession();
    const actions: AIAction[] = [
      { type: 'set_master', volume: NaN },
    ];
    const report = run(session, actions);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0].reason).toContain('Non-finite');
  });

  it('rejects Infinity in set_master volume', () => {
    const session = setupSession();
    const actions: AIAction[] = [
      { type: 'set_master', volume: Infinity },
    ];
    const report = run(session, actions);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0].reason).toContain('Non-finite');
  });

  it('accepts valid finite values normally', () => {
    const session = setupSession();
    const actions: AIAction[] = [
      { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.5 } },
    ];
    const report = run(session, actions);
    expect(report.accepted).toHaveLength(1);
    expect(report.rejected).toHaveLength(0);
    const track = report.session.tracks.find(v => v.id === 'v0')!;
    expect(track.params.timbre).toBeCloseTo(0.5);
  });

  it('still clamps out-of-range finite values', () => {
    const session = setupSession();
    const actions: AIAction[] = [
      { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 1.5 } },
    ];
    const report = run(session, actions);
    expect(report.accepted).toHaveLength(1);
    const track = report.session.tracks.find(v => v.id === 'v0')!;
    expect(track.params.timbre).toBeCloseTo(1.0);
  });

  it('still clamps negative finite values to 0', () => {
    const session = setupSession();
    const actions: AIAction[] = [
      { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: -0.5 } },
    ];
    const report = run(session, actions);
    expect(report.accepted).toHaveLength(1);
    const track = report.session.tracks.find(v => v.id === 'v0')!;
    expect(track.params.timbre).toBeCloseTo(0);
  });

  // --- Per-track swing ---

  it('set_track_mix applies per-track swing', () => {
    const session = setupSession();
    const report = run(session, [
      { type: 'set_track_mix', trackId: 'v0', swing: 0.6 },
    ]);
    expect(report.accepted).toHaveLength(1);
    const track = report.session.tracks.find(t => t.id === 'v0')!;
    expect(track.swing).toBeCloseTo(0.6);
  });

  it('set_track_mix clamps per-track swing to [0, 1]', () => {
    const session = setupSession();
    const report = run(session, [
      { type: 'set_track_mix', trackId: 'v0', swing: 1.5 },
    ]);
    expect(report.accepted).toHaveLength(1);
    const track = report.session.tracks.find(t => t.id === 'v0')!;
    expect(track.swing).toBeLessThanOrEqual(1);
    expect(track.swing).toBeGreaterThanOrEqual(0);
  });

  it('set_track_mix allows null swing to inherit global', () => {
    let session = setupSession();
    // First set swing to 0.5
    const report1 = run(session, [
      { type: 'set_track_mix', trackId: 'v0', swing: 0.5 },
    ]);
    session = report1.session;
    expect(getTrack(session, 'v0').swing).toBeCloseTo(0.5);
    // Then set swing to null (inherit global)
    const report2 = run(session, [
      { type: 'set_track_mix', trackId: 'v0', swing: null },
    ]);
    expect(getTrack(report2.session, 'v0').swing).toBeNull();
  });

  it('set_track_mix swing is undoable via TrackPropertySnapshot', () => {
    const session = setupSession();
    const originalSwing = getTrack(session, 'v0').swing;
    const report = run(session, [
      { type: 'set_track_mix', trackId: 'v0', swing: 0.7 },
    ]);
    expect(getTrack(report.session, 'v0').swing).toBeCloseTo(0.7);
    // Undo
    const undone = applyUndo(report.session);
    expect(getTrack(undone, 'v0').swing).toBe(originalSwing);
  });

  it('rejects non-finite per-track swing', () => {
    const session = setupSession();
    const report = run(session, [
      { type: 'set_track_mix', trackId: 'v0', swing: NaN },
    ]);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0].reason).toContain('Non-finite');
  });
});
