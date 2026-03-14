// src/audio/audio-exporter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioExporter } from './audio-exporter';

// --- Mocks ---

/** Minimal MediaRecorder stub */
function makeMockRecorder() {
  let _state: 'inactive' | 'recording' | 'paused' = 'inactive';
  const rec: Record<string, unknown> = {
    get state() { return _state; },
    mimeType: 'audio/webm',
    ondataavailable: null as ((e: { data: Blob }) => void) | null,
    onstop: null as (() => void) | null,
    start() { _state = 'recording'; },
    stop() {
      _state = 'inactive';
      // Fire onstop asynchronously like the real API
      setTimeout(() => (rec.onstop as (() => void))?.(), 0);
    },
  };
  return rec;
}

// Replace global MediaRecorder
let lastRecorder: ReturnType<typeof makeMockRecorder>;
vi.stubGlobal('MediaRecorder', class {
  static isTypeSupported() { return true; }
  constructor() {
    lastRecorder = makeMockRecorder();
    return lastRecorder as unknown as MediaRecorder;
  }
});

// Mock blobToWav — just pass the blob through
vi.mock('./wav-encode', () => ({
  blobToWav: (blob: Blob) => Promise.resolve(blob),
}));

function makeMockDestination(): MediaStreamAudioDestinationNode {
  return { stream: {} } as unknown as MediaStreamAudioDestinationNode;
}

// --- Tests ---

describe('AudioExporter', () => {
  let exporter: AudioExporter;
  const dest = makeMockDestination();

  beforeEach(() => {
    exporter = new AudioExporter();
    vi.useFakeTimers();
  });

  // ----- Concurrency guards -----

  it('rejects captureNBars if a capture is already in flight', async () => {
    // Start first capture (won't resolve until timer fires)
    const p1 = exporter.captureNBars(dest, 1, 16, 120);
    // Second should reject immediately
    await expect(exporter.captureNBars(dest, 1, 16, 120))
      .rejects.toThrow('captureNBars already in flight');
    // Clean up first capture
    vi.advanceTimersByTime(3000);
    await vi.waitFor(() => expect(exporter.isCapturing()).toBe(false));
    // Let the promise settle
    await p1.catch(() => {});
  });

  it('rejects captureNBars if manual recording is active', async () => {
    exporter.start(dest);
    await expect(exporter.captureNBars(dest, 1, 16, 120))
      .rejects.toThrow('Cannot capture while manual recording is active');
  });

  it('rejects start() if captureNBars is in flight', () => {
    exporter.captureNBars(dest, 1, 16, 120);
    expect(() => exporter.start(dest))
      .toThrow('Cannot start manual recording while captureNBars is in flight');
  });

  it('isCapturing reflects capture state', () => {
    expect(exporter.isCapturing()).toBe(false);
    exporter.captureNBars(dest, 1, 16, 120);
    expect(exporter.isCapturing()).toBe(true);
  });

  // ----- AudioContext timing path -----

  it('uses AudioContext.currentTime polling when audioContext is provided', async () => {
    let currentTime = 0;
    const mockCtx = {
      get currentTime() { return currentTime; },
    } as unknown as AudioContext;

    const promise = exporter.captureNBars(dest, 1, 16, 120, mockCtx);
    expect(exporter.isCapturing()).toBe(true);

    // Duration for 1 bar at 120 BPM, 16 steps = 16 * 60 / (120 * 4) = 2s
    // Advance time to just before end
    currentTime = 1.9;
    vi.advanceTimersByTime(100);
    // Should still be capturing
    expect(exporter.isCapturing()).toBe(true);

    // Advance past the target
    currentTime = 2.1;
    vi.advanceTimersByTime(100);

    // Wait for onstop to fire (async via setTimeout(0))
    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;
    expect(result).toBeInstanceOf(Blob);
    expect(exporter.isCapturing()).toBe(false);
  });

  // ----- setTimeout fallback path -----

  it('falls back to setTimeout when no audioContext provided', async () => {
    const promise = exporter.captureNBars(dest, 1, 16, 120);
    // Duration = 2000ms
    vi.advanceTimersByTime(1999);
    expect(exporter.isCapturing()).toBe(true);

    vi.advanceTimersByTime(2);
    // Wait for onstop async callback
    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;
    expect(result).toBeInstanceOf(Blob);
    expect(exporter.isCapturing()).toBe(false);
  });
});
