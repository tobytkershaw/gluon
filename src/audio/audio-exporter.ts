// src/audio/audio-exporter.ts
import { blobToWav } from './wav-encode';

export class AudioExporter {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  start(destination: MediaStreamAudioDestinationNode): void {
    const stream = destination.stream;
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    this.recorder = new MediaRecorder(stream, { mimeType });
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();
  }

  async stop(): Promise<Blob> {
    if (!this.recorder || this.recorder.state !== 'recording') {
      throw new Error('Not recording');
    }
    return new Promise((resolve) => {
      this.recorder!.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.recorder!.mimeType });
        this.recorder = null;
        this.chunks = [];
        resolve(blob);
      };
      this.recorder!.stop();
    });
  }

  isRecording(): boolean {
    return this.recorder !== null && this.recorder.state === 'recording';
  }

  /**
   * Capture N bars of audio and return as WAV blob.
   * Timer-based — no scheduler changes needed.
   * @param destination - MediaStreamAudioDestinationNode from AudioEngine
   * @param bars - Number of bars to capture
   * @param patternLength - Steps per pattern (bar length)
   * @param bpm - Current tempo
   * @returns WAV blob suitable for Gemini API
   */
  captureNBars(
    destination: MediaStreamAudioDestinationNode,
    bars: number,
    patternLength: number,
    bpm: number,
  ): Promise<Blob> {
    const durationSec = bars * patternLength * 60 / (bpm * 4);
    const maxDuration = 30_000; // 30s safety net
    const timeoutMs = Math.min(durationSec * 1000, maxDuration);

    // Use an independent recorder so we never clobber the manual export recorder
    const stream = destination.stream;
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.start();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (recorder.state === 'recording') {
          recorder.stop();
        }
      }, timeoutMs);

      recorder.onstop = async () => {
        clearTimeout(timer);
        try {
          const webmBlob = new Blob(chunks, { type: recorder.mimeType });
          const wavBlob = await blobToWav(webmBlob);
          resolve(wavBlob);
        } catch (err) {
          reject(err);
        }
      };
    });
  }
}
