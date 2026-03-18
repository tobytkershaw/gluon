// tests/engine/param-init.test.ts
// Tests for #884: processor/modulator params populated from registry on creation

import { describe, it, expect, vi } from 'vitest';
import { executeOperations } from '../../src/engine/operation-executor';
import { createSession } from '../../src/engine/session';
import { createPlaitsAdapter } from '../../src/audio/plaits-adapter';
import { Arbitrator } from '../../src/engine/arbitration';
import { getProcessorDefaultParams, getModulatorDefaultParams } from '../../src/audio/instrument-registry';
import type { AIAction, Session } from '../../src/engine/types';
import { getTrack } from '../../src/engine/types';

const adapter = createPlaitsAdapter();

function makeArbitrator() {
  const arb = new Arbitrator();
  vi.spyOn(arb, 'canAIAct').mockReturnValue(true);
  return arb;
}

function sessionWithAgency(): Session {
  const session = createSession();
  return {
    ...session,
    tracks: session.tracks.map(v =>
      v.id === 'v0' ? { ...v, agency: 'ON' as const } : v,
    ),
  };
}

describe('processor/modulator param initialisation (#884)', () => {
  it('add_processor populates params from registry (ripples)', () => {
    const session = sessionWithAgency();
    const actions: AIAction[] = [{
      type: 'add_processor',
      trackId: 'v0',
      processorId: 'ripples-1',
      moduleType: 'ripples',
      description: 'add ripples',
    }];
    const report = executeOperations(session, actions, adapter, makeArbitrator());
    expect(report.accepted).toHaveLength(1);
    const track = getTrack(report.session, 'v0');
    const proc = track.processors![0];
    expect(proc.params).toEqual(getProcessorDefaultParams('ripples', 0));
    // Verify specific known defaults
    expect(proc.params.cutoff).toBe(0.5);
    expect(proc.params.resonance).toBe(0.0);
    expect(proc.params.drive).toBe(0.0);
  });

  it('add_processor populates params from registry (rings)', () => {
    const session = sessionWithAgency();
    const actions: AIAction[] = [{
      type: 'add_processor',
      trackId: 'v0',
      processorId: 'rings-1',
      moduleType: 'rings',
      description: 'add rings',
    }];
    const report = executeOperations(session, actions, adapter, makeArbitrator());
    expect(report.accepted).toHaveLength(1);
    const track = getTrack(report.session, 'v0');
    const proc = track.processors![0];
    const expected = getProcessorDefaultParams('rings', 0);
    expect(proc.params).toEqual(expected);
    expect(Object.keys(proc.params).length).toBeGreaterThan(0);
  });

  it('add_processor params are not empty', () => {
    const session = sessionWithAgency();
    const actions: AIAction[] = [{
      type: 'add_processor',
      trackId: 'v0',
      processorId: 'eq-1',
      moduleType: 'eq',
      description: 'add eq',
    }];
    const report = executeOperations(session, actions, adapter, makeArbitrator());
    const track = getTrack(report.session, 'v0');
    const proc = track.processors![0];
    expect(Object.keys(proc.params).length).toBeGreaterThan(0);
  });

  it('add_modulator populates params from registry (tides)', () => {
    const session = sessionWithAgency();
    const actions: AIAction[] = [{
      type: 'add_modulator',
      trackId: 'v0',
      modulatorId: 'tides-1',
      moduleType: 'tides',
      description: 'add tides',
    }];
    const report = executeOperations(session, actions, adapter, makeArbitrator());
    expect(report.accepted).toHaveLength(1);
    const track = getTrack(report.session, 'v0');
    const mod = track.modulators![0];
    // Tides defaults to model 1 (Looping mode)
    expect(mod.params).toEqual(getModulatorDefaultParams('tides', 1));
    // Verify specific known defaults
    expect(mod.params.frequency).toBe(0.3);
    expect(mod.params.shape).toBe(0.5);
  });

  it('replace_processor populates params from registry for the new type', () => {
    // Start with a ripples processor already on the track
    let session = sessionWithAgency();
    session = {
      ...session,
      tracks: session.tracks.map(v =>
        v.id === 'v0'
          ? {
              ...v,
              processors: [{
                id: 'proc-1',
                type: 'ripples' as const,
                model: 0,
                params: { cutoff: 0.5, resonance: 0.0, drive: 0.0 },
              }],
            }
          : v,
      ),
    };
    const actions: AIAction[] = [{
      type: 'replace_processor',
      trackId: 'v0',
      processorId: 'proc-1',
      newProcessorId: 'proc-2',
      newModuleType: 'rings',
      description: 'replace with rings',
    }];
    const report = executeOperations(session, actions, adapter, makeArbitrator());
    expect(report.accepted).toHaveLength(1);
    const track = getTrack(report.session, 'v0');
    const proc = track.processors![0];
    expect(proc.type).toBe('rings');
    const expected = getProcessorDefaultParams('rings', 0);
    expect(proc.params).toEqual(expected);
    expect(Object.keys(proc.params).length).toBeGreaterThan(0);
  });

  it('existing processor params are not affected by adding another', () => {
    let session = sessionWithAgency();
    session = {
      ...session,
      tracks: session.tracks.map(v =>
        v.id === 'v0'
          ? {
              ...v,
              processors: [{
                id: 'existing-1',
                type: 'ripples' as const,
                model: 0,
                params: { cutoff: 0.9, resonance: 0.3, drive: 0.5 },
              }],
            }
          : v,
      ),
    };
    const actions: AIAction[] = [{
      type: 'add_processor',
      trackId: 'v0',
      processorId: 'rings-1',
      moduleType: 'rings',
      description: 'add rings',
    }];
    const report = executeOperations(session, actions, adapter, makeArbitrator());
    const track = getTrack(report.session, 'v0');
    // Existing processor params unchanged
    const existing = track.processors!.find(p => p.id === 'existing-1')!;
    expect(existing.params.cutoff).toBe(0.9);
    expect(existing.params.resonance).toBe(0.3);
    expect(existing.params.drive).toBe(0.5);
    // New processor has its own defaults
    const newProc = track.processors!.find(p => p.id === 'rings-1')!;
    expect(Object.keys(newProc.params).length).toBeGreaterThan(0);
  });

  it('move on freshly-added processor uses correct initial value', () => {
    const session = sessionWithAgency();
    const actions: AIAction[] = [
      {
        type: 'add_processor',
        trackId: 'v0',
        processorId: 'ripples-1',
        moduleType: 'ripples',
        description: 'add ripples',
      },
      {
        type: 'move',
        trackId: 'v0',
        processorId: 'ripples-1',
        param: 'cutoff',
        target: { relative: 0.1 },
        description: 'nudge cutoff up',
      },
    ];
    const report = executeOperations(session, actions, adapter, makeArbitrator());
    expect(report.accepted).toHaveLength(2);
    const track = getTrack(report.session, 'v0');
    const proc = track.processors!.find(p => p.id === 'ripples-1')!;
    // cutoff default is 0.5, relative +0.1 should give 0.6
    expect(proc.params.cutoff).toBeCloseTo(0.6);
  });
});
