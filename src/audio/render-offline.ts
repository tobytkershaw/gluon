// src/audio/render-offline.ts
// Main-thread orchestrator for offline audio rendering.
// Builds a RenderSpec, sends it to a Worker, and returns WAV audio.

import type { Session } from '../engine/types';
import { buildRenderSpec } from './render-spec';
import { encodeWav } from './wav-encode';
import type { RenderWorkerResponse, RenderWorkerError } from './render-worker';

const RENDER_TIMEOUT_MS = 30_000; // 30s safety net

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

  // Spawn a Worker using the Vite worker import pattern.
  // The `?worker` suffix tells Vite to bundle the worker as a separate entry.
  const worker = new Worker(
    new URL('./render-worker.ts', import.meta.url),
    { type: 'module' },
  );

  try {
    const pcm = await new Promise<Float32Array>((resolve, reject) => {
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

    return encodeWav(pcm, spec.sampleRate);
  } finally {
    worker.terminate();
  }
}
