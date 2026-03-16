// src/audio/render-offline.ts
// Main-thread orchestrator for offline audio rendering.
// Builds a RenderSpec, sends it to a Worker, and returns WAV audio.

import type { Session } from '../engine/types';
import { buildRenderSpec } from './render-spec';
import { encodeWav, encodeWavStereo } from './wav-encode';
import type { RenderWorkerResponse, RenderWorkerError } from './render-worker';

const RENDER_TIMEOUT_MS = 30_000; // 30s safety net

/** Result of a raw PCM render (for analysis tools). */
export interface PcmRenderResult {
  pcm: Float32Array;
  sampleRate: number;
}

/**
 * Render audio offline and return raw PCM Float32Array + sample rate.
 *
 * Used by the audio analysis tools (spectral, dynamics, rhythm) which
 * operate on raw PCM rather than encoded WAV. Always renders mono.
 */
export async function renderOfflinePcm(
  session: Session,
  trackIds?: string[],
  bars = 2,
): Promise<PcmRenderResult> {
  const spec = buildRenderSpec(session, trackIds, bars);
  const { pcm } = await renderFromSpec(spec, false);
  return { pcm, sampleRate: spec.sampleRate };
}

/**
 * Render audio offline for the given session and return a WAV Blob.
 *
 * Spawns a Web Worker that loads WASM binaries and renders audio in virtual
 * time — no AudioContext needed, no transport dependency.
 *
 * @param session   Current session state
 * @param trackIds  Optional subset of tracks to render (default: all unmuted)
 * @param bars      Number of bars to render (default: 2)
 * @param stereo    If true, render stereo WAV (default: false — mono for AI listening)
 * @returns WAV Blob
 */
export async function renderOffline(
  session: Session,
  trackIds?: string[],
  bars = 2,
  stereo = false,
): Promise<Blob> {
  const spec = buildRenderSpec(session, trackIds, bars);
  const { pcm, channels } = await renderFromSpec(spec, stereo);
  if (channels === 2) {
    // pcm is interleaved L R L R — deinterleave for the encoder
    const frames = pcm.length / 2;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      left[i] = pcm[i * 2];
      right[i] = pcm[i * 2 + 1];
    }
    return encodeWavStereo(left, right, spec.sampleRate);
  }
  return encodeWav(pcm, spec.sampleRate);
}

interface WorkerResult {
  pcm: Float32Array;
  channels: 1 | 2;
}

/** Internal: spawn a Worker, send a RenderSpec, return raw PCM + channel info. */
async function renderFromSpec(
  spec: ReturnType<typeof buildRenderSpec>,
  stereo: boolean,
): Promise<WorkerResult> {
  const worker = new Worker(
    new URL('./render-worker.ts', import.meta.url),
    { type: 'module' },
  );

  try {
    return await new Promise<WorkerResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Offline render timed out'));
      }, RENDER_TIMEOUT_MS);

      worker.onmessage = (event: MessageEvent<RenderWorkerResponse | RenderWorkerError>) => {
        clearTimeout(timeout);
        const data = event.data;
        if (data.type === 'done') {
          resolve({ pcm: data.pcm, channels: data.channels });
        } else {
          reject(new Error(data.message));
        }
      };

      worker.onerror = (err) => {
        clearTimeout(timeout);
        reject(new Error(err.message || 'Worker error'));
      };

      worker.postMessage({ type: 'render', spec, stereo });
    });
  } finally {
    worker.terminate();
  }
}
