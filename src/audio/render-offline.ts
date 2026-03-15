// src/audio/render-offline.ts
// Main-thread orchestrator for offline audio rendering.
// Builds a RenderSpec, sends it to a Worker, and returns WAV audio.

import type { Session } from '../engine/types';
import { buildRenderSpec } from './render-spec';
import { encodeWav } from './wav-encode';
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
 * operate on raw PCM rather than encoded WAV.
 */
export async function renderOfflinePcm(
  session: Session,
  trackIds?: string[],
  bars = 2,
): Promise<PcmRenderResult> {
  const spec = buildRenderSpec(session, trackIds, bars);
  const pcm = await renderPcmFromSpec(spec);
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
 * @returns WAV Blob suitable for Gemini API
 */
export async function renderOffline(
  session: Session,
  trackIds?: string[],
  bars = 2,
): Promise<Blob> {
  const spec = buildRenderSpec(session, trackIds, bars);
  const pcm = await renderPcmFromSpec(spec);
  return encodeWav(pcm, spec.sampleRate);
}

/** Internal: spawn a Worker, send a RenderSpec, return the raw PCM. */
async function renderPcmFromSpec(spec: ReturnType<typeof buildRenderSpec>): Promise<Float32Array> {
  // Spawn a Worker using the Vite worker import pattern.
  // The `?worker` suffix tells Vite to bundle the worker as a separate entry.
  const worker = new Worker(
    new URL('./render-worker.ts', import.meta.url),
    { type: 'module' },
  );

  try {
    return await new Promise<Float32Array>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Offline render timed out'));
      }, RENDER_TIMEOUT_MS);

      worker.onmessage = (event: MessageEvent<RenderWorkerResponse | RenderWorkerError>) => {
        clearTimeout(timeout);
        const data = event.data;
        if (data.type === 'done') {
          resolve(data.pcm);
        } else {
          reject(new Error(data.message));
        }
      };

      worker.onerror = (err) => {
        clearTimeout(timeout);
        reject(new Error(err.message || 'Worker error'));
      };

      worker.postMessage({ type: 'render', spec });
    });
  } finally {
    worker.terminate();
  }
}
