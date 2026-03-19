import { describe, it, expect, vi } from 'vitest';
import { buildRenderSpec } from './render-spec';
import { createSession, addTrack } from '../engine/session';

describe('buildRenderSpec sidechain handling', () => {
  function sessionWithSidechain() {
    let session = createSession(); // T1
    session = addTrack(session)!;  // T2
    session = addTrack(session)!;  // T3
    const t1 = session.tracks[0];
    const t2 = session.tracks[1];
    // Add a compressor to T2 that sidechains from T1
    const compressor = {
      id: 'comp-1',
      type: 'compressor',
      model: 0,
      params: { threshold: 0.5, ratio: 0.5, attack: 0.2, release: 0.3 },
      sidechainSourceId: t1.id,
    };
    session = {
      ...session,
      tracks: session.tracks.map(t =>
        t.id === t2.id ? { ...t, processors: [compressor] } : t,
      ),
    };
    return { session, t1Id: t1.id, t2Id: t2.id, t3Id: session.tracks[2].id };
  }

  it('includes sidechain reference when source track is in the render set', () => {
    const { session, t1Id, t2Id } = sessionWithSidechain();
    const spec = buildRenderSpec(session, [t1Id, t2Id]);
    const t2Spec = spec.tracks.find(t => t.id === t2Id)!;
    const comp = t2Spec.processors.find(p => p.id === 'comp-1')!;
    expect(comp.sidechainSourceTrackId).toBe(t1Id);
  });

  it('drops sidechain reference when source track is excluded from subset', () => {
    const { session, t2Id, t3Id } = sessionWithSidechain();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Render only T2 and T3 — T1 (sidechain source) is excluded
    const spec = buildRenderSpec(session, [t2Id, t3Id]);
    const t2Spec = spec.tracks.find(t => t.id === t2Id)!;
    const comp = t2Spec.processors.find(p => p.id === 'comp-1')!;
    expect(comp.sidechainSourceTrackId).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('sidechain source'),
    );
    warnSpy.mockRestore();
  });

  it('preserves sidechain when rendering all tracks (no subset)', () => {
    const { session, t1Id, t2Id } = sessionWithSidechain();
    const spec = buildRenderSpec(session);
    const t2Spec = spec.tracks.find(t => t.id === t2Id)!;
    const comp = t2Spec.processors.find(p => p.id === 'comp-1')!;
    expect(comp.sidechainSourceTrackId).toBe(t1Id);
  });
});
