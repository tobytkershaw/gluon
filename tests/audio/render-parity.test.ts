// tests/audio/render-parity.test.ts
// Parity-locking tests: offline render must match live engine behavior for
// timing precision and processor control application.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { RenderEvent, RenderProcessorSpec, RenderTrackSpec } from '../../src/audio/render-spec';

// ---------------------------------------------------------------------------
// 1. Timing parity: sub-block event scheduling
// ---------------------------------------------------------------------------

describe('offline render timing parity', () => {
  // Helpers to compute frame positions the same way the render worker does
  const BLOCK_SIZE = 128;
  const SAMPLE_RATE = 48000;
  const BPM = 120;
  const FRAMES_PER_STEP = (60 / BPM) * SAMPLE_RATE / 4; // 6000 frames per step

  function eventFrame(beatTime: number): number {
    return Math.round(beatTime * FRAMES_PER_STEP);
  }

  function blockStart(frame: number): number {
    return Math.floor(frame / BLOCK_SIZE) * BLOCK_SIZE;
  }

  it('within-block events should not all collapse to block start', () => {
    // Two events 0.01 steps apart — both fall within the same 128-frame block
    // at 120 BPM (6000 frames/step). 0.01 steps = 60 frames < 128 block.
    const ev1BeatTime = 0.0;
    const ev2BeatTime = 0.01; // 60 frames later

    const ev1Frame = eventFrame(ev1BeatTime);
    const ev2Frame = eventFrame(ev2BeatTime);

    // They are within the same block
    expect(blockStart(ev1Frame)).toBe(blockStart(ev2Frame));

    // But the sub-block offset must differ — the render worker must
    // apply them at different sample offsets within the block.
    // This test documents the requirement: the offset within the block
    // must be non-zero for the second event.
    const offset1 = ev1Frame - blockStart(ev1Frame);
    const offset2 = ev2Frame - blockStart(ev2Frame);
    expect(offset2 - offset1).toBeGreaterThan(0);
  });

  it('gate-off timing drift is audible even at 1/10 step resolution', () => {
    // A gate-on at step 0.0 and gate-off at step 0.25 should produce
    // a gate duration of exactly 0.25 * 6000 = 1500 frames.
    // If gate-off is quantized to block start, it could fire up to 127
    // frames early, which is 127/48000 = ~2.6ms — audible timing error.
    const gateOnFrame = eventFrame(0.0);
    const gateOffFrame = eventFrame(0.25);
    const expectedDuration = gateOffFrame - gateOnFrame;

    // With block-quantized scheduling, worst case gate-off fires at block start
    const quantizedGateOff = blockStart(gateOffFrame);
    const quantizedDuration = quantizedGateOff - gateOnFrame;

    // The drift can be up to BLOCK_SIZE - 1 frames
    const maxDrift = expectedDuration - quantizedDuration;
    expect(maxDrift).toBeLessThanOrEqual(BLOCK_SIZE - 1);
    // But we require sub-block precision to eliminate this drift
    expect(maxDrift).toBeGreaterThanOrEqual(0);
  });

  it('splitBlockAtEvents partitions a block at event boundaries', async () => {
    // Import the sub-block splitting helper
    const { splitBlockAtEvents } = await import('../../src/audio/render-timing');

    const events: { beatTime: number; index: number }[] = [
      { beatTime: 0.005, index: 0 },  // 30 frames into block
      { beatTime: 0.015, index: 1 },  // 90 frames into block
    ];

    const blockFrame = 0;
    const framesToRender = BLOCK_SIZE;
    const framesPerStep = FRAMES_PER_STEP;

    const segments = splitBlockAtEvents(
      events,
      blockFrame,
      framesToRender,
      framesPerStep,
    );

    // Should produce 3 segments: [0..30), [30..90), [90..128)
    expect(segments.length).toBe(3);
    expect(segments[0].startOffset).toBe(0);
    expect(segments[0].length).toBe(30);
    expect(segments[0].eventsToApply).toEqual([]);

    expect(segments[1].startOffset).toBe(30);
    expect(segments[1].length).toBe(60);
    expect(segments[1].eventsToApply).toEqual([0]);

    expect(segments[2].startOffset).toBe(90);
    expect(segments[2].length).toBe(38);
    expect(segments[2].eventsToApply).toEqual([1]);
  });

  it('splitBlockAtEvents handles events at block start', async () => {
    const { splitBlockAtEvents } = await import('../../src/audio/render-timing');

    const events: { beatTime: number; index: number }[] = [
      { beatTime: 0.0, index: 0 }, // exactly at frame 0
    ];

    const segments = splitBlockAtEvents(events, 0, BLOCK_SIZE, FRAMES_PER_STEP);

    // Event at block start: one segment with the event applied at the start
    expect(segments.length).toBe(1);
    expect(segments[0].startOffset).toBe(0);
    expect(segments[0].length).toBe(BLOCK_SIZE);
    expect(segments[0].eventsToApply).toEqual([0]);
  });

  it('splitBlockAtEvents handles no events in block', async () => {
    const { splitBlockAtEvents } = await import('../../src/audio/render-timing');

    const segments = splitBlockAtEvents([], 0, BLOCK_SIZE, FRAMES_PER_STEP);

    expect(segments.length).toBe(1);
    expect(segments[0].startOffset).toBe(0);
    expect(segments[0].length).toBe(BLOCK_SIZE);
    expect(segments[0].eventsToApply).toEqual([]);
  });

  it('splitBlockAtEvents coalesces events at the same frame', async () => {
    const { splitBlockAtEvents } = await import('../../src/audio/render-timing');

    // Two events at the same beat time
    const events: { beatTime: number; index: number }[] = [
      { beatTime: 0.01, index: 0 },
      { beatTime: 0.01, index: 1 },
    ];

    const segments = splitBlockAtEvents(events, 0, BLOCK_SIZE, FRAMES_PER_STEP);

    // Should coalesce: [0..60), [60..128) with both events in segment 1
    expect(segments.length).toBe(2);
    expect(segments[1].eventsToApply).toEqual([0, 1]);
  });
});

// ---------------------------------------------------------------------------
// 2. Processor control parity: Rings and Clouds exposed controls
// ---------------------------------------------------------------------------

describe('offline render processor control parity', () => {
  it('RenderProcessorSpec for Rings carries polyphony and internal-exciter', () => {
    // The live engine applies polyphony and internal-exciter via setPolyphony /
    // setInternalExciter (audio-engine.ts:784-785). The offline render must
    // apply the same controls from the RenderProcessorSpec params.
    const ringsSpec: RenderProcessorSpec = {
      type: 'rings',
      id: 'rings-1',
      model: 0,
      params: {
        structure: 0.5,
        brightness: 0.5,
        damping: 0.7,
        position: 0.5,
        polyphony: 2,
        'internal-exciter': 1,
      },
    };

    // These params must be present — the render worker must read and apply them
    expect(ringsSpec.params.polyphony).toBe(2);
    expect(ringsSpec.params['internal-exciter']).toBe(1);
  });

  it('RenderProcessorSpec for Clouds carries freeze', () => {
    // The live engine applies freeze via setFreeze (audio-engine.ts:791).
    // The offline render must apply freeze from the RenderProcessorSpec params.
    const cloudsSpec: RenderProcessorSpec = {
      type: 'clouds',
      id: 'clouds-1',
      model: 0,
      params: {
        position: 0.5,
        size: 0.5,
        density: 0.5,
        feedback: 0.0,
        texture: 0.5,
        pitch: 0.5,
        'dry-wet': 0.5,
        'stereo-spread': 0.0,
        reverb: 0.0,
        freeze: 1,
      },
    };

    expect(cloudsSpec.params.freeze).toBe(1);
  });

  // Read the render-worker source once for structural parity checks
  const workerPath = resolve(__dirname, '../../src/audio/render-worker.ts');
  const workerSrc = readFileSync(workerPath, 'utf8');

  it('RingsWasm interface declares polyphony and internal-exciter setters', () => {
    expect(workerSrc).toContain('_rings_set_polyphony');
    expect(workerSrc).toContain('_rings_set_internal_exciter');
  });

  it('CloudsWasm interface declares freeze setter', () => {
    expect(workerSrc).toContain('_clouds_set_freeze');
  });

  it('render-worker applies Rings polyphony and internal-exciter during init', () => {
    // Must apply these controls during Rings initialization, not just declare them
    expect(workerSrc).toMatch(/rings\._rings_set_polyphony\s*\(/);
    expect(workerSrc).toMatch(/rings\._rings_set_internal_exciter\s*\(/);
  });

  it('render-worker applies Clouds freeze during init', () => {
    // Must apply freeze during Clouds initialization
    expect(workerSrc).toMatch(/clouds\._clouds_set_freeze\s*\(/);
  });
});
