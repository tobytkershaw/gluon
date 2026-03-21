import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession } from '../../src/engine/session';
import { renderOffline, renderOfflinePcm } from '../../src/audio/render-offline';

const mockModules = vi.hoisted(() => ({
  buildRenderSpec: vi.fn(),
  encodeWav: vi.fn(),
  encodeWavStereo: vi.fn(),
}));

vi.mock('../../src/audio/render-spec', () => ({
  buildRenderSpec: mockModules.buildRenderSpec,
}));

vi.mock('../../src/audio/wav-encode', () => ({
  encodeWav: mockModules.encodeWav,
  encodeWavStereo: mockModules.encodeWavStereo,
}));

class MockWorker {
  static instances: MockWorker[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly terminate = vi.fn();
  readonly postMessage = vi.fn();

  constructor(
    readonly url: URL,
    readonly options?: WorkerOptions,
  ) {
    MockWorker.instances.push(this);
  }

  emitMessage(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }

  emitError(message: string) {
    this.onerror?.({ message } as ErrorEvent);
  }
}

describe('renderOffline', () => {
  const spec = {
    sampleRate: 48_000,
    bpm: 120,
    bars: 2,
    master: { volume: 0.8, pan: -0.1 },
    tracks: [],
  };
  const session = createSession();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    MockWorker.instances = [];
    mockModules.buildRenderSpec.mockReturnValue(spec);
    mockModules.encodeWav.mockReturnValue(new Blob(['mono'], { type: 'audio/wav' }));
    mockModules.encodeWavStereo.mockReturnValue(new Blob(['stereo'], { type: 'audio/wav' }));
    vi.stubGlobal('Worker', MockWorker);
  });

  it('renders PCM through the worker and returns the spec sample rate', async () => {
    const pcm = new Float32Array([0.1, -0.2, 0.3]);
    const promise = renderOfflinePcm(session, ['track-1'], 4);

    const worker = MockWorker.instances[0];
    expect(worker.options).toEqual({ type: 'module' });
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'render', spec, stereo: false });
    expect(mockModules.buildRenderSpec).toHaveBeenCalledWith(session, ['track-1'], 4);

    worker.emitMessage({ type: 'done', pcm, sampleRate: 12_345, channels: 1 });

    await expect(promise).resolves.toEqual({ pcm, sampleRate: 48_000 });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('encodes mono worker output with encodeWav', async () => {
    const pcm = new Float32Array([0.25, -0.5]);
    const monoBlob = new Blob(['mono-blob'], { type: 'audio/wav' });
    mockModules.encodeWav.mockReturnValue(monoBlob);

    const promise = renderOffline(session, undefined, 2, false);
    const worker = MockWorker.instances[0];
    worker.emitMessage({ type: 'done', pcm, sampleRate: 48_000, channels: 1 });

    await expect(promise).resolves.toBe(monoBlob);
    expect(mockModules.encodeWav).toHaveBeenCalledWith(pcm, 48_000);
    expect(mockModules.encodeWavStereo).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('deinterleaves stereo worker output before encodeWavStereo', async () => {
    const stereoBlob = new Blob(['stereo-blob'], { type: 'audio/wav' });
    const interleaved = new Float32Array([1, 10, 2, 20, 3, 30]);
    mockModules.encodeWavStereo.mockReturnValue(stereoBlob);

    const promise = renderOffline(session, ['track-2'], 3, true);
    const worker = MockWorker.instances[0];
    worker.emitMessage({ type: 'done', pcm: interleaved, sampleRate: 48_000, channels: 2 });

    await expect(promise).resolves.toBe(stereoBlob);

    const [left, right, sampleRate] = mockModules.encodeWavStereo.mock.calls[0];
    expect(Array.from(left as Float32Array)).toEqual([1, 2, 3]);
    expect(Array.from(right as Float32Array)).toEqual([10, 20, 30]);
    expect(sampleRate).toBe(48_000);
    expect(mockModules.buildRenderSpec).toHaveBeenCalledWith(session, ['track-2'], 3);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('rejects worker error responses and still terminates the worker', async () => {
    const promise = renderOffline(session);
    const worker = MockWorker.instances[0];
    worker.emitMessage({ type: 'error', message: 'render failed' });

    await expect(promise).rejects.toThrow('render failed');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('rejects browser worker errors and still terminates the worker', async () => {
    const promise = renderOffline(session);
    const worker = MockWorker.instances[0];
    worker.emitError('module crashed');

    await expect(promise).rejects.toThrow('module crashed');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('times out stalled renders and terminates the worker', async () => {
    vi.useFakeTimers();

    const promise = renderOfflinePcm(session);
    const worker = MockWorker.instances[0];
    const rejection = expect(promise).rejects.toThrow('Offline render timed out');

    await vi.advanceTimersByTimeAsync(30_000);

    await rejection;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
