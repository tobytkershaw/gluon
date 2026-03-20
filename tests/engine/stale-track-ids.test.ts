// tests/engine/stale-track-ids.test.ts
// Regression tests for #1196 and #1198: track removal leaves stale IDs
import { describe, it, expect } from 'vitest';
import {
  createSession, addTrack, removeTrack, addDecision,
  toggleTrackExpanded,
} from '../../src/engine/session';
import { restoreSession } from '../../src/engine/persistence';
import type { OpenDecision } from '../../src/engine/types';

describe('#1196 — removeTrack cleans up expandedTrackIds', () => {
  it('filters the removed track from expandedTrackIds', () => {
    let s = createSession();
    s = addTrack(s)!; // adds v1 (auto-expanded by addTrack)
    // Also expand v0
    s = toggleTrackExpanded(s, 'v0');
    expect(s.expandedTrackIds).toContain('v0');
    expect(s.expandedTrackIds).toContain('v1'); // auto-expanded

    s = removeTrack(s, 'v1')!;
    expect(s.expandedTrackIds).not.toContain('v1');
    expect(s.expandedTrackIds).toContain('v0');
  });

  it('handles removeTrack when expandedTrackIds is undefined', () => {
    let s = createSession();
    s = addTrack(s)!;
    // Force expandedTrackIds to undefined (legacy state)
    s = { ...s, expandedTrackIds: undefined as unknown as string[] };
    const result = removeTrack(s, 'v1');
    expect(result).not.toBeNull();
    expect(result!.expandedTrackIds).toEqual([]);
  });
});

describe('#1198 — removeTrack cleans up openDecisions trackIds', () => {
  it('filters the removed track from a decision with multiple trackIds', () => {
    let s = createSession();
    s = addTrack(s)!; // adds v1
    const decision: OpenDecision = {
      id: 'd1',
      question: 'Which reverb?',
      raisedAt: Date.now(),
      trackIds: ['v0', 'v1'],
    };
    s = addDecision(s, decision);

    s = removeTrack(s, 'v1')!;
    const d = s.openDecisions!.find(d => d.id === 'd1')!;
    expect(d.trackIds).toEqual(['v0']);
  });

  it('removes trackIds array entirely when all tracks are removed', () => {
    let s = createSession();
    s = addTrack(s)!; // adds v1
    const decision: OpenDecision = {
      id: 'd1',
      question: 'Which reverb?',
      raisedAt: Date.now(),
      trackIds: ['v1'],
    };
    s = addDecision(s, decision);

    s = removeTrack(s, 'v1')!;
    const d = s.openDecisions!.find(d => d.id === 'd1')!;
    expect(d).toBeDefined();
    expect(d.trackIds).toBeUndefined();
  });

  it('leaves decisions without trackIds untouched', () => {
    let s = createSession();
    s = addTrack(s)!;
    const decision: OpenDecision = {
      id: 'd1',
      question: 'Global question',
      raisedAt: Date.now(),
      // no trackIds
    };
    s = addDecision(s, decision);

    s = removeTrack(s, 'v1')!;
    const d = s.openDecisions!.find(d => d.id === 'd1')!;
    expect(d.question).toBe('Global question');
    expect(d.trackIds).toBeUndefined();
  });
});

describe('#1196 — restoreSession scrubs expandedTrackIds', () => {
  it('filters stale IDs from expandedTrackIds', () => {
    const s = createSession();
    // Simulate persisted state with a stale expanded track ID
    const persisted = {
      ...s,
      expandedTrackIds: ['v0', 'v_deleted'],
    };
    const restored = restoreSession(persisted);
    expect(restored.expandedTrackIds).toContain('v0');
    expect(restored.expandedTrackIds).not.toContain('v_deleted');
  });
});

describe('#1198 — restoreSession scrubs openDecisions trackIds', () => {
  it('filters stale track IDs from openDecisions', () => {
    const s = createSession();
    const persisted = {
      ...s,
      openDecisions: [
        { id: 'd1', question: 'Q?', raisedAt: 1, trackIds: ['v0', 'v_gone'] },
      ],
    };
    const restored = restoreSession(persisted);
    const d = restored.openDecisions!.find(d => d.id === 'd1')!;
    expect(d.trackIds).toEqual(['v0']);
  });

  it('removes trackIds entirely when all referenced tracks are gone', () => {
    const s = createSession();
    const persisted = {
      ...s,
      openDecisions: [
        { id: 'd1', question: 'Q?', raisedAt: 1, trackIds: ['v_gone1', 'v_gone2'] },
      ],
    };
    const restored = restoreSession(persisted);
    const d = restored.openDecisions!.find(d => d.id === 'd1')!;
    expect(d).toBeDefined();
    expect(d.trackIds).toBeUndefined();
  });

  it('leaves decisions without trackIds untouched', () => {
    const s = createSession();
    const persisted = {
      ...s,
      openDecisions: [
        { id: 'd1', question: 'Global', raisedAt: 1 },
      ],
    };
    const restored = restoreSession(persisted);
    const d = restored.openDecisions!.find(d => d.id === 'd1')!;
    expect(d.question).toBe('Global');
    expect(d.trackIds).toBeUndefined();
  });
});
