// tests/engine/drum-rack-e2e.test.ts
//
// End-to-end integration test for the drum rack feature (#1097, Phase 6a).
// Exercises the full workflow: create session -> add drum rack track ->
// add pads -> sketch beat with grid notation -> compress state -> verify
// grid lanes -> edit single pad -> move per-pad param -> undo all ->
// verify clean state -> round-trip compression.

import { describe, it, expect } from 'vitest';
import { executeOperations } from '../../src/engine/operation-executor';
import { createSession } from '../../src/engine/session';
import { Arbitrator } from '../../src/engine/arbitration';
import { applyUndo } from '../../src/engine/primitives';
import { compressState } from '../../src/ai/state-compression';
import {
  getTrack,
  getActivePattern,
  updateTrack,
} from '../../src/engine/types';
import type { AIAction, Session } from '../../src/engine/types';
import type { SourceAdapter } from '../../src/engine/canonical-types';
import {
  kitToEvents,
  eventsToKit,
  formatLegend,
  DEFAULT_LEGEND,
} from '../../src/engine/drum-grid';

// ---------------------------------------------------------------------------
// Test adapter (minimal SourceAdapter for operation-executor)
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
    readPatterns() { return []; },
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

/** Execute actions and assert all are accepted. */
function exec(session: Session, actions: AIAction[]): Session {
  const report = executeOperations(session, actions, adapter, new Arbitrator());
  expect(report.rejected).toHaveLength(0);
  expect(report.accepted.length).toBeGreaterThan(0);
  return report.session;
}

/** Execute actions and expect rejection. */
function execRejected(session: Session, actions: AIAction[]): string {
  const report = executeOperations(session, actions, adapter, new Arbitrator());
  expect(report.rejected.length).toBeGreaterThan(0);
  return report.rejected[0].reason;
}

// ---------------------------------------------------------------------------
// E2E Test
// ---------------------------------------------------------------------------

describe('Drum Rack End-to-End Integration (#1097)', () => {
  describe('full workflow: create -> add pads -> sketch -> compress -> edit -> move -> undo', () => {
    // Shared state across the sequential test steps
    let session: Session;
    let trackId: string;

    it('Step 1: creates a session and configures a drum rack track', () => {
      session = createSession();
      trackId = session.tracks[0].id;

      // Configure track as a drum rack with an empty pad list
      session = updateTrack(session, trackId, {
        engine: 'drum-rack',
        name: 'Drums',
        drumRack: { pads: [] },
      });

      // Set pattern to 32 steps (2 bars)
      const track = getTrack(session, trackId);
      const pattern = getActivePattern(track);
      session = updateTrack(session, trackId, {
        patterns: track.patterns.map(p =>
          p.id === pattern.id ? { ...p, duration: 32 } : p
        ),
      });

      expect(getTrack(session, trackId).engine).toBe('drum-rack');
      expect(getTrack(session, trackId).drumRack?.pads).toHaveLength(0);
      expect(getActivePattern(getTrack(session, trackId)).duration).toBe(32);
    });

    it('Step 2: adds kick, snare, and hat pads via manage_drum_pad', () => {
      session = exec(session, [
        {
          type: 'manage_drum_pad',
          trackId,
          action: 'add',
          padId: 'kick',
          name: 'Kick',
          model: 'analog-bass-drum',
          description: 'add kick pad',
        },
      ]);

      session = exec(session, [
        {
          type: 'manage_drum_pad',
          trackId,
          action: 'add',
          padId: 'snare',
          name: 'Snare',
          model: 'analog-snare',
          description: 'add snare pad',
        },
      ]);

      session = exec(session, [
        {
          type: 'manage_drum_pad',
          trackId,
          action: 'add',
          padId: 'hat',
          name: 'Hat',
          model: 'analog-hi-hat',
          chokeGroup: 1,
          description: 'add closed hat pad with choke group 1',
        },
      ]);

      const track = getTrack(session, trackId);
      expect(track.drumRack?.pads).toHaveLength(3);
      expect(track.drumRack?.pads.map(p => p.id)).toEqual(['kick', 'snare', 'hat']);
      expect(track.drumRack?.pads.find(p => p.id === 'hat')?.chokeGroup).toBe(1);
    });

    it('Step 3: sketches a beat using kit grid notation', () => {
      session = exec(session, [
        {
          type: 'sketch',
          trackId,
          description: 'breakbeat skeleton with driving hats',
          kit: {
            'kick':  'x...o...|x..o....|x...o...|x..o....',
            'snare': '....x...|....x...|....x...|....x...',
            'hat':   'hHh.hHh.|hHh.hHh.|hHh.hHh.|hHh.hHh.',
          },
        },
      ]);

      const track = getTrack(session, trackId);
      const events = getActivePattern(track).events;

      // Verify event counts per pad
      const kicks = events.filter(e => e.kind === 'trigger' && 'padId' in e && e.padId === 'kick');
      const snares = events.filter(e => e.kind === 'trigger' && 'padId' in e && e.padId === 'snare');
      const hats = events.filter(e => e.kind === 'trigger' && 'padId' in e && e.padId === 'hat');

      expect(kicks).toHaveLength(8);   // 2 per bar x 4 bars
      expect(snares).toHaveLength(4);  // 1 per bar x 4 bars
      expect(hats).toHaveLength(24);   // 6 per bar x 4 bars

      // All events must have padId
      for (const e of events) {
        if (e.kind === 'trigger') {
          expect('padId' in e && e.padId).toBeTruthy();
        }
      }
    });

    it('Step 4: compresses state and verifies grid lanes appear', () => {
      const compressed = compressState(session);
      const drumTrack = compressed.tracks.find(t => t.id === trackId);
      expect(drumTrack).toBeDefined();
      expect(drumTrack!.model).toBe('drum-rack');

      // Pad metadata
      expect(drumTrack!.pads).toBeDefined();
      expect(drumTrack!.pads).toHaveLength(3);
      expect(drumTrack!.pads![0].id).toBe('kick');
      expect(drumTrack!.pads![1].id).toBe('snare');
      expect(drumTrack!.pads![2].id).toBe('hat');
      expect(drumTrack!.pads![2].chokeGroup).toBe(1);

      // Grid lanes in pattern
      const pattern = drumTrack!.pattern as {
        lanes: Record<string, string>;
        legend: string;
        density: number;
        event_count: number;
      };

      expect(pattern.lanes).toBeDefined();
      expect(pattern.lanes.kick).toBeDefined();
      expect(pattern.lanes.snare).toBeDefined();
      expect(pattern.lanes.hat).toBeDefined();

      // Legend is present
      expect(pattern.legend).toBe(formatLegend());
      expect(pattern.legend).toContain('x=accent');

      // Density and event count
      expect(pattern.event_count).toBe(36); // 8 + 4 + 24
      expect(pattern.density).toBeGreaterThan(0);
    });

    it('Step 5: edits a single pad\'s events via edit_pattern', () => {
      const eventsBefore = getActivePattern(getTrack(session, trackId)).events.length;

      // Add a ghost note snare at step 2 (bar 1, beat 1, 16th 3)
      session = exec(session, [
        {
          type: 'edit_pattern',
          trackId,
          pad: 'snare',
          operations: [
            { action: 'add', step: 2, event: { type: 'trigger', velocity: 0.3 } },
          ],
          description: 'add ghost snare before beat 2',
        },
      ]);

      const eventsAfter = getActivePattern(getTrack(session, trackId)).events;
      expect(eventsAfter.length).toBe(eventsBefore + 1);

      // The ghost note should be a snare trigger at step 2
      const ghostSnare = eventsAfter.find(
        e => e.kind === 'trigger' && 'padId' in e && e.padId === 'snare' && e.at === 2
      );
      expect(ghostSnare).toBeDefined();

      // Kick events should be untouched
      const kicks = eventsAfter.filter(e => e.kind === 'trigger' && 'padId' in e && e.padId === 'kick');
      expect(kicks).toHaveLength(8);
    });

    it('Step 6: changes a per-pad param via move', () => {
      const kickBefore = getTrack(session, trackId).drumRack?.pads.find(p => p.id === 'kick');
      const timbreBefore = kickBefore?.source.params.timbre ?? 0.5;

      session = exec(session, [
        {
          type: 'move',
          trackId,
          param: 'kick.timbre',
          target: { absolute: 0.2 },
        },
      ]);

      const kickAfter = getTrack(session, trackId).drumRack?.pads.find(p => p.id === 'kick');
      expect(kickAfter?.source.params.timbre).toBeCloseTo(0.2);
      expect(timbreBefore).not.toBeCloseTo(0.2); // sanity: it actually changed
    });

    it('Step 7: undoes all operations and verifies clean state', () => {
      // Count undo stack entries
      const undoCount = session.undoStack.length;
      expect(undoCount).toBeGreaterThan(0);

      // Undo everything
      let s = session;
      for (let i = 0; i < undoCount; i++) {
        s = applyUndo(s);
      }

      const track = getTrack(s, trackId);

      // Pattern should be empty (back to initial state before any sketch)
      const events = getActivePattern(track).events;
      expect(events).toHaveLength(0);

      // Drum rack should be empty (back to before pad adds)
      expect(track.drumRack?.pads).toHaveLength(0);

      // Undo stack should be empty
      expect(s.undoStack).toHaveLength(0);
    });

    it('Step 8: verifies pattern round-trips through compression', () => {
      // Re-create a fresh session with a beat for the round-trip test
      let s = createSession();
      const tid = s.tracks[0].id;

      s = updateTrack(s, tid, {
        engine: 'drum-rack',
        name: 'RT Test',
        drumRack: {
          pads: [
            {
              id: 'kick', name: 'Kick',
              source: { engine: 'plaits', model: 13, params: { timbre: 0.5, morph: 0.3, harmonics: 0.4 } },
              level: 0.8, pan: 0.5,
            },
            {
              id: 'snare', name: 'Snare',
              source: { engine: 'plaits', model: 14, params: { timbre: 0.6, morph: 0.5, harmonics: 0.3 } },
              level: 0.75, pan: 0.5,
            },
            {
              id: 'hat', name: 'Hat',
              source: { engine: 'plaits', model: 15, params: { timbre: 0.7, morph: 0.4, harmonics: 0.5 } },
              chokeGroup: 1, level: 0.6, pan: 0.3,
            },
          ],
        },
      });

      // Set pattern to 16 steps
      const track = getTrack(s, tid);
      const pattern = getActivePattern(track);
      s = updateTrack(s, tid, {
        patterns: track.patterns.map(p =>
          p.id === pattern.id ? { ...p, duration: 16 } : p
        ),
      });

      // Sketch a beat
      s = exec(s, [
        {
          type: 'sketch',
          trackId: tid,
          description: 'test beat for round-trip',
          kit: {
            'kick':  'x...o...|x..o....',
            'snare': '....x...|....x...',
            'hat':   'hHh.hHh.|hHh.hHh.',
          },
        },
      ]);

      // Compress
      const compressed = compressState(s);
      const cTrack = compressed.tracks.find(t => t.id === tid);
      const lanes = (cTrack!.pattern as { lanes: Record<string, string> }).lanes;

      // Parse grid strings back to events
      const roundTripped = kitToEvents(lanes);

      // Original events
      const originalEvents = getActivePattern(getTrack(s, tid)).events
        .filter(e => e.kind === 'trigger');

      // Same count
      expect(roundTripped).toHaveLength(originalEvents.length);

      // Every original event has a match at the same step and pad
      for (const orig of originalEvents) {
        if (orig.kind !== 'trigger') continue;
        const match = roundTripped.find(
          e => e.at === Math.floor(orig.at) && e.padId === ('padId' in orig ? orig.padId : undefined)
        );
        expect(match).toBeDefined();
      }

      // Re-serialize should produce the same grid strings
      const reKit = eventsToKit(
        roundTripped,
        ['kick', 'snare', 'hat'],
        16,
      );
      expect(reKit.kick).toBe(lanes.kick);
      expect(reKit.snare).toBe(lanes.snare);
      expect(reKit.hat).toBe(lanes.hat);
    });
  });

  describe('validation: rejects invalid drum rack operations', () => {
    it('rejects kit sketch with grid length mismatch', () => {
      let session = createSession();
      const trackId = session.tracks[0].id;
      session = updateTrack(session, trackId, {
        engine: 'drum-rack',
        drumRack: {
          pads: [
            {
              id: 'kick', name: 'Kick',
              source: { engine: 'plaits', model: 13, params: {} },
              level: 0.8, pan: 0.5,
            },
          ],
        },
      });

      // Pattern is 16 steps but grid is 8 steps
      const reason = execRejected(session, [
        {
          type: 'sketch',
          trackId,
          description: 'wrong grid length',
          kit: { 'kick': 'x...o...' }, // 8 steps, pattern expects 16
        },
      ]);
      expect(reason).toContain('Grid length');
    });

    it('rejects events without padId on drum rack track', () => {
      let session = createSession();
      const trackId = session.tracks[0].id;
      session = updateTrack(session, trackId, {
        engine: 'drum-rack',
        drumRack: {
          pads: [
            {
              id: 'kick', name: 'Kick',
              source: { engine: 'plaits', model: 13, params: {} },
              level: 0.8, pan: 0.5,
            },
          ],
        },
      });

      const reason = execRejected(session, [
        {
          type: 'sketch',
          trackId,
          description: 'missing padId',
          events: [{ kind: 'trigger', at: 0, velocity: 0.8 }],
        },
      ]);
      expect(reason).toContain('padId');
    });

    it('empty audio track auto-promotes to drum rack, with full undo chain', () => {
      let session = createSession();
      const trackId = session.tracks[0].id;

      // Verify starting state: empty audio track
      expect(getTrack(session, trackId).engine).toBe('');
      expect(getTrack(session, trackId).drumRack).toBeUndefined();

      // Add first pad — auto-promotes
      session = exec(session, [{
        type: 'manage_drum_pad', trackId, action: 'add',
        padId: 'kick', name: 'Kick', model: 'analog-bass-drum',
        description: 'add kick',
      }]);
      expect(getTrack(session, trackId).engine).toBe('drum-rack');
      expect(getTrack(session, trackId).drumRack?.pads).toHaveLength(1);

      // Add second pad — normal drum rack add, no promotion
      session = exec(session, [{
        type: 'manage_drum_pad', trackId, action: 'add',
        padId: 'snare', name: 'Snare', model: 'analog-snare',
        description: 'add snare',
      }]);
      expect(getTrack(session, trackId).drumRack?.pads).toHaveLength(2);

      // Remove first pad
      session = exec(session, [{
        type: 'manage_drum_pad', trackId, action: 'remove',
        padId: 'kick', description: 'remove kick',
      }]);
      expect(getTrack(session, trackId).drumRack?.pads).toHaveLength(1);
      expect(getTrack(session, trackId).engine).toBe('drum-rack');

      // Undo remove -> 2 pads
      session = applyUndo(session)!;
      expect(getTrack(session, trackId).drumRack?.pads).toHaveLength(2);

      // Undo second add -> 1 pad
      session = applyUndo(session)!;
      expect(getTrack(session, trackId).drumRack?.pads).toHaveLength(1);

      // Undo first add (the auto-promote) -> back to empty audio track
      session = applyUndo(session)!;
      expect(getTrack(session, trackId).engine).toBe('');
      expect(getTrack(session, trackId).model).toBe(-1);
      expect(getTrack(session, trackId).drumRack).toBeUndefined();
    });

    it('rejects move on non-existent pad', () => {
      let session = createSession();
      const trackId = session.tracks[0].id;
      session = updateTrack(session, trackId, {
        engine: 'drum-rack',
        drumRack: {
          pads: [
            {
              id: 'kick', name: 'Kick',
              source: { engine: 'plaits', model: 13, params: {} },
              level: 0.8, pan: 0.5,
            },
          ],
        },
      });

      const reason = execRejected(session, [
        {
          type: 'move',
          trackId,
          param: 'cowbell.timbre',
          target: { absolute: 0.5 },
        },
      ]);
      expect(reason).toContain('Drum pad not found');
    });
  });

  describe('per-pad operations preserve other pads', () => {
    it('kit sketch only replaces mentioned pads, preserves others', () => {
      let session = createSession();
      const trackId = session.tracks[0].id;
      session = updateTrack(session, trackId, {
        engine: 'drum-rack',
        drumRack: {
          pads: [
            { id: 'kick', name: 'Kick', source: { engine: 'plaits', model: 13, params: {} }, level: 0.8, pan: 0.5 },
            { id: 'snare', name: 'Snare', source: { engine: 'plaits', model: 14, params: {} }, level: 0.75, pan: 0.5 },
            { id: 'hat', name: 'Hat', source: { engine: 'plaits', model: 15, params: {} }, level: 0.6, pan: 0.5 },
          ],
        },
      });

      const track = getTrack(session, trackId);
      const pattern = getActivePattern(track);
      session = updateTrack(session, trackId, {
        patterns: track.patterns.map(p =>
          p.id === pattern.id ? { ...p, duration: 8 } : p
        ),
      });

      // Sketch hat pattern first
      session = exec(session, [{
        type: 'sketch', trackId, description: 'initial hats',
        kit: { 'hat': 'hhhhhhhh' },
      }]);

      let events = getActivePattern(getTrack(session, trackId)).events;
      expect(events.filter(e => e.kind === 'trigger' && 'padId' in e && e.padId === 'hat')).toHaveLength(8);

      // Sketch kick only -- hats should survive
      session = exec(session, [{
        type: 'sketch', trackId, description: 'add kick',
        kit: { 'kick': 'x...x...' },
      }]);

      events = getActivePattern(getTrack(session, trackId)).events;
      const hats = events.filter(e => e.kind === 'trigger' && 'padId' in e && e.padId === 'hat');
      const kicks = events.filter(e => e.kind === 'trigger' && 'padId' in e && e.padId === 'kick');
      expect(hats).toHaveLength(8); // preserved
      expect(kicks).toHaveLength(2); // newly added
    });

    it('transform scoped to one pad preserves others', () => {
      let session = createSession();
      const trackId = session.tracks[0].id;
      session = updateTrack(session, trackId, {
        engine: 'drum-rack',
        drumRack: {
          pads: [
            { id: 'kick', name: 'Kick', source: { engine: 'plaits', model: 13, params: {} }, level: 0.8, pan: 0.5 },
            { id: 'snare', name: 'Snare', source: { engine: 'plaits', model: 14, params: {} }, level: 0.75, pan: 0.5 },
            { id: 'hat', name: 'Hat', source: { engine: 'plaits', model: 15, params: {} }, level: 0.6, pan: 0.5 },
          ],
        },
      });

      const track = getTrack(session, trackId);
      const pattern = getActivePattern(track);
      session = updateTrack(session, trackId, {
        patterns: track.patterns.map(p =>
          p.id === pattern.id ? { ...p, duration: 16 } : p
        ),
      });

      // Sketch kick and snare
      session = exec(session, [{
        type: 'sketch', trackId, description: 'initial kit',
        kit: { 'kick': 'x...x...|x...x...', 'snare': '....x...|....x...' },
      }]);

      // Apply euclidean to hat only
      session = exec(session, [{
        type: 'transform', trackId, pad: 'hat',
        operation: 'euclidean', hits: 5, velocity: 0.5,
        description: 'euclidean hats',
      }]);

      const events = getActivePattern(getTrack(session, trackId)).events;
      const kicks = events.filter(e => e.kind === 'trigger' && 'padId' in e && e.padId === 'kick');
      const snares = events.filter(e => e.kind === 'trigger' && 'padId' in e && e.padId === 'snare');
      const hats = events.filter(e => e.kind === 'trigger' && 'padId' in e && e.padId === 'hat');

      expect(kicks).toHaveLength(4);   // preserved
      expect(snares).toHaveLength(2);  // preserved
      expect(hats).toHaveLength(5);    // euclidean generated
    });
  });

  describe('undo granularity: each operation creates its own snapshot', () => {
    it('undoes operations in reverse order with correct intermediate states', () => {
      let session = createSession();
      const trackId = session.tracks[0].id;
      session = updateTrack(session, trackId, {
        engine: 'drum-rack',
        drumRack: { pads: [] },
      });

      const track = getTrack(session, trackId);
      const pattern = getActivePattern(track);
      session = updateTrack(session, trackId, {
        patterns: track.patterns.map(p =>
          p.id === pattern.id ? { ...p, duration: 8 } : p
        ),
      });

      // Op 1: add kick
      session = exec(session, [{
        type: 'manage_drum_pad', trackId, action: 'add',
        padId: 'kick', model: 'analog-bass-drum', description: 'add kick',
      }]);
      expect(session.undoStack).toHaveLength(1);

      // Op 2: add snare
      session = exec(session, [{
        type: 'manage_drum_pad', trackId, action: 'add',
        padId: 'snare', model: 'analog-snare', description: 'add snare',
      }]);
      expect(session.undoStack).toHaveLength(2);

      // Op 3: sketch
      session = exec(session, [{
        type: 'sketch', trackId, description: 'beat',
        kit: { 'kick': 'x...x...', 'snare': '....x...' },
      }]);
      expect(session.undoStack).toHaveLength(3);

      // Op 4: move kick.timbre
      session = exec(session, [{
        type: 'move', trackId, param: 'kick.timbre', target: { absolute: 0.1 },
      }]);
      expect(session.undoStack).toHaveLength(4);

      // Undo op 4: kick.timbre should revert
      session = applyUndo(session);
      expect(session.undoStack).toHaveLength(3);
      // timbre should not be 0.1 anymore
      const kickAfterUndo4 = getTrack(session, trackId).drumRack?.pads.find(p => p.id === 'kick');
      expect(kickAfterUndo4?.source.params.timbre).not.toBeCloseTo(0.1);

      // Undo op 3: pattern should be empty
      session = applyUndo(session);
      expect(session.undoStack).toHaveLength(2);
      expect(getActivePattern(getTrack(session, trackId)).events).toHaveLength(0);

      // Undo op 2: snare should be gone
      session = applyUndo(session);
      expect(session.undoStack).toHaveLength(1);
      expect(getTrack(session, trackId).drumRack?.pads).toHaveLength(1);
      expect(getTrack(session, trackId).drumRack?.pads[0].id).toBe('kick');

      // Undo op 1: kick should be gone
      session = applyUndo(session);
      expect(session.undoStack).toHaveLength(0);
      expect(getTrack(session, trackId).drumRack?.pads).toHaveLength(0);
    });
  });

  describe('compression round-trip fidelity', () => {
    it('all grid characters survive compress -> parse -> re-serialize', () => {
      let session = createSession();
      const trackId = session.tracks[0].id;
      session = updateTrack(session, trackId, {
        engine: 'drum-rack',
        drumRack: {
          pads: [
            { id: 'test', name: 'Test', source: { engine: 'plaits', model: 13, params: {} }, level: 0.8, pan: 0.5 },
          ],
        },
      });

      const track = getTrack(session, trackId);
      const pattern = getActivePattern(track);
      session = updateTrack(session, trackId, {
        patterns: track.patterns.map(p =>
          p.id === pattern.id ? { ...p, duration: 8 } : p
        ),
      });

      // Use grid that exercises all character categories
      session = exec(session, [{
        type: 'sketch', trackId, description: 'all velocities',
        kit: { 'test': 'xHOogh..' },
      }]);

      // Compress
      const compressed = compressState(session);
      const lanes = (compressed.tracks[0].pattern as { lanes: Record<string, string> }).lanes;

      // Grid should preserve all characters
      expect(lanes.test).toBe('xHOogh..');

      // Parse back
      const events = kitToEvents(lanes);
      expect(events).toHaveLength(6);

      // Verify velocities match the DEFAULT_LEGEND
      const velocities = events.map(e => e.velocity);
      expect(velocities[0]).toBe(DEFAULT_LEGEND['x'].velocity); // 0.95
      expect(velocities[1]).toBe(DEFAULT_LEGEND['H'].velocity); // 0.88
      expect(velocities[2]).toBe(DEFAULT_LEGEND['O'].velocity); // 0.80
      expect(velocities[3]).toBe(DEFAULT_LEGEND['o'].velocity); // 0.75
      expect(velocities[4]).toBe(DEFAULT_LEGEND['g'].velocity); // 0.30
      expect(velocities[5]).toBe(DEFAULT_LEGEND['h'].velocity); // 0.50
    });

    it('empty pads produce all-rest grid strings', () => {
      let session = createSession();
      const trackId = session.tracks[0].id;
      session = updateTrack(session, trackId, {
        engine: 'drum-rack',
        drumRack: {
          pads: [
            { id: 'kick', name: 'Kick', source: { engine: 'plaits', model: 13, params: {} }, level: 0.8, pan: 0.5 },
            { id: 'snare', name: 'Snare', source: { engine: 'plaits', model: 14, params: {} }, level: 0.75, pan: 0.5 },
          ],
        },
      });

      const track = getTrack(session, trackId);
      const pattern = getActivePattern(track);
      session = updateTrack(session, trackId, {
        patterns: track.patterns.map(p =>
          p.id === pattern.id ? { ...p, duration: 16 } : p
        ),
      });

      // Sketch only kick -- snare should be empty
      session = exec(session, [{
        type: 'sketch', trackId, description: 'kick only',
        kit: { 'kick': 'x...............' },
      }]);

      const compressed = compressState(session);
      const lanes = (compressed.tracks[0].pattern as { lanes: Record<string, string> }).lanes;

      expect(lanes.snare).toBe('................');
    });
  });

  describe('set_model per-pad', () => {
    it('changes a pad model and undoes it', () => {
      let session = createSession();
      const trackId = session.tracks[0].id;
      session = updateTrack(session, trackId, {
        engine: 'drum-rack',
        drumRack: {
          pads: [
            {
              id: 'kick', name: 'Kick',
              source: { engine: 'plaits', model: 13, params: { timbre: 0.5, morph: 0.3, harmonics: 0.4 } },
              level: 0.8, pan: 0.5,
            },
          ],
        },
      });

      const origModel = getTrack(session, trackId).drumRack?.pads[0].source.model;

      // Change model
      session = exec(session, [{
        type: 'set_model', trackId, pad: 'kick', model: 'analog-snare',
      }]);

      const newModel = getTrack(session, trackId).drumRack?.pads[0].source.model;
      expect(newModel).not.toBe(origModel);

      // Undo
      session = applyUndo(session);
      expect(getTrack(session, trackId).drumRack?.pads[0].source.model).toBe(origModel);
    });
  });
});
