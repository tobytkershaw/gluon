// src/audio/audio-exporter.ts
import { blobToWav } from './wav-encode';

export class AudioExporter {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  /** True while captureNBars is in flight */
  private capturing = false;

  start(destination: MediaStreamAudioDestinationNode): void {
    if (this.capturing) {
      throw new Error('Cannot start manual recording while captureNBars is in flight');
    }
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

  isCapturing(): boolean {
    return this.capturing;
  }

  /**
   * Capture N bars of audio and return as WAV blob.
   * Uses AudioContext.currentTime for precise duration control instead of
   * setTimeout alone, which can drift 50-200ms under heavy load.
   * Guards against concurrent capture to prevent orphaned recorders.
   *
   * @param destination - MediaStreamAudioDestinationNode from AudioEngine
   * @param bars - Number of bars to capture
   * @param patternLength - Steps per pattern (bar length)
   * @param bpm - Current tempo
   * @param audioContext - AudioContext for precise timing
   * @returns WAV blob suitable for Gemini API
   */
  captureNBars(
    destination: MediaStreamAudioDestinationNode,
    bars: number,
    patternLength: number,
    bpm: number,
    audioContext?: AudioContext,
  ): Promise<Blob> {
    // Guard: reject if a capture is already in flight
    if (this.capturing) {
      return Promise.reject(new Error('captureNBars already in flight'));
    }

    // Guard: reject if manual recording is active — both would record from
    // the same MediaStreamAudioDestinationNode, and stopping one could
    // orphan the other's recorder.
    if (this.isRecording()) {
      return Promise.reject(
        new Error('Cannot capture while manual recording is active'),
      );
    }

    this.capturing = true;

    const durationSec = bars * patternLength * 60 / (bpm * 4);
    const maxDurationSec = 30; // 30s safety net
    const targetDurationSec = Math.min(durationSec, maxDurationSec);

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
      let settled = false;
      const stopRecorder = () => {
        if (recorder.state === 'recording') {
          recorder.stop();
        } else if (!settled) {
          // Recorder isn't recording (already errored or inactive) —
          // onstop won't fire, so clear capturing and reject to avoid wedging.
          settled = true;
          this.capturing = false;
          reject(new Error('MediaRecorder was not recording when stop was requested'));
        }
      };

      // Handle recorder errors — clear capturing so the exporter isn't wedged
      recorder.onerror = (event) => {
        if (settled) return;
        settled = true;
        this.capturing = false;
        const errorEvent = event as MediaRecorderErrorEvent;
        reject(errorEvent.error ?? new Error('MediaRecorder error'));
      };

      // --- Timing strategy ---
      // Primary: poll AudioContext.currentTime for drift-free duration.
      // Fallback: setTimeout with a small margin if no AudioContext provided.
      if (audioContext) {
        const startTime = audioContext.currentTime;
        const endTime = startTime + targetDurationSec;

        // Poll at ~50ms intervals — precise enough without being wasteful.
        const poll = setInterval(() => {
          if (audioContext.currentTime >= endTime) {
            clearInterval(poll);
            stopRecorder();
          }
        }, 50);

        // Safety fallback: if polling somehow misses, setTimeout catches it.
        // Add 500ms margin so it only fires if the poll genuinely stalls.
        const fallback = setTimeout(() => {
          clearInterval(poll);
          stopRecorder();
        }, (targetDurationSec + 0.5) * 1000);

        recorder.onstop = async () => {
          clearInterval(poll);
          clearTimeout(fallback);
          if (settled) return;
          settled = true;
          this.capturing = false;
          try {
            const webmBlob = new Blob(chunks, { type: recorder.mimeType });
            const wavBlob = await blobToWav(webmBlob);
            resolve(wavBlob);
          } catch (err) {
            reject(err);
          }
        };
      } else {
        // Fallback: plain setTimeout (original behavior, kept for
        // environments where AudioContext is unavailable).
        const timeoutMs = targetDurationSec * 1000;
        const timer = setTimeout(() => {
          stopRecorder();
        }, timeoutMs);

        recorder.onstop = async () => {
          clearTimeout(timer);
          if (settled) return;
          settled = true;
          this.capturing = false;
          try {
            const webmBlob = new Blob(chunks, { type: recorder.mimeType });
            const wavBlob = await blobToWav(webmBlob);
            resolve(wavBlob);
          } catch (err) {
            reject(err);
          }
        };
      }
    });
  }
}
