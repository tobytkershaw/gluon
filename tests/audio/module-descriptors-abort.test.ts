import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUDIO_DEGRADED_EVENT } from '../../src/audio/runtime-events';

// We test the abort-signal suppression in module-descriptors by importing
// the descriptors directly and passing a pre-aborted signal.

function makeFakeCtx(): AudioContext {
  const fakeGainNode = {
    gain: { value: 0 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  return {
    createGain: () => ({ ...fakeGainNode, gain: { value: 0 } }),
  } as unknown as AudioContext;
}

describe('module-descriptors abort signal', () => {
  let events: Event[];
  const handler = (e: Event) => events.push(e);

  beforeEach(() => {
    events = [];
    window.addEventListener(AUDIO_DEGRADED_EVENT, handler);
  });

  afterEach(() => {
    window.removeEventListener(AUDIO_DEGRADED_EVENT, handler);
  });

  it('suppresses degradation event when signal is already aborted (#1205)', async () => {
    const { moduleDescriptors } = await import('../../src/audio/module-descriptors');
    const descriptor = moduleDescriptors.get('rings')!;

    // Create an already-aborted signal
    const ac = new AbortController();
    ac.abort();

    // The create call will fail (no real WASM), but with the aborted signal
    // it should NOT emit a degradation event
    const result = await descriptor.create(makeFakeCtx(), ac.signal);

    expect(result.degraded).toBe(true);
    expect(events).toHaveLength(0);
  });

  it('emits degradation event when signal is not aborted', async () => {
    const { moduleDescriptors } = await import('../../src/audio/module-descriptors');
    const descriptor = moduleDescriptors.get('rings')!;

    // No signal — should emit
    const result = await descriptor.create(makeFakeCtx());

    expect(result.degraded).toBe(true);
    expect(events).toHaveLength(1);
  });
});
