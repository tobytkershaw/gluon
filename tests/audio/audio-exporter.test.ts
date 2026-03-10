// tests/audio/audio-exporter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { AudioExporter } from '../../src/audio/audio-exporter';

// Mock MediaRecorder for test environment
class MockMediaRecorder {
  state = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(public stream: MediaStream) {}

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    // Simulate data available then stop
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob(['audio data'], { type: 'audio/webm' }) });
      this.onstop?.();
    }, 0);
  }

  get mimeType() { return 'audio/webm'; }

  static isTypeSupported() { return true; }
}

vi.stubGlobal('MediaRecorder', MockMediaRecorder);

describe('AudioExporter', () => {
  it('starts recording', () => {
    const exporter = new AudioExporter();
    const stream = new MediaStream();
    const dest = { stream } as unknown as MediaStreamAudioDestinationNode;
    exporter.start(dest);
    expect(exporter.isRecording()).toBe(true);
  });

  it('stops recording and returns a blob', async () => {
    const exporter = new AudioExporter();
    const stream = new MediaStream();
    const dest = { stream } as unknown as MediaStreamAudioDestinationNode;
    exporter.start(dest);
    const blob = await exporter.stop();
    expect(blob).toBeInstanceOf(Blob);
    expect(exporter.isRecording()).toBe(false);
  });

  it('throws if stop called without start', async () => {
    const exporter = new AudioExporter();
    await expect(exporter.stop()).rejects.toThrow();
  });
});
