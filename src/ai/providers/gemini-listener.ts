// src/ai/providers/gemini-listener.ts — ListenerProvider for Google Gemini.

import { GoogleGenAI } from '@google/genai';
import type { ListenerProvider } from '../types';
import { ProviderError } from '../types';

const MODEL = 'gemini-2.5-flash';

interface BackoffState {
  until: number;
  delay: number;
}

export class GeminiListenerProvider implements ListenerProvider {
  readonly name = 'gemini';
  private ai: GoogleGenAI | null;
  private backoff: BackoffState = { until: 0, delay: 0 };

  constructor(apiKey: string) {
    this.ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
  }

  isConfigured(): boolean {
    return this.ai !== null;
  }

  async evaluate(opts: {
    systemPrompt: string;
    stateJson: string;
    question: string;
    audioData: Blob;
    mimeType: string;
  }): Promise<string> {
    if (!this.ai) throw new ProviderError('API not configured.', 'auth');

    const now = Date.now();
    if (now < this.backoff.until) {
      throw new ProviderError('Rate limited — try again shortly.', 'rate_limited', this.backoff.until - now);
    }

    const audioBytes = new Uint8Array(await opts.audioData.arrayBuffer());
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < audioBytes.length; i += chunkSize) {
      binary += String.fromCharCode(...audioBytes.subarray(i, i + chunkSize));
    }
    const audioBase64 = btoa(binary);

    let response;
    try {
      response = await this.ai.models.generateContent({
        model: MODEL,
        config: {
          systemInstruction: opts.systemPrompt,
        },
        contents: [{
          role: 'user',
          parts: [
            { text: `Project state:\n${opts.stateJson}\n\nQuestion: ${opts.question}` },
            { inlineData: { mimeType: opts.mimeType, data: audioBase64 } },
          ],
        }],
      });
    } catch (error) {
      throw this.translateError(error);
    }

    this.backoff = { until: 0, delay: 0 };
    return response.text ?? 'No response from model.';
  }

  private translateError(error: unknown): ProviderError {
    const msg = error instanceof Error ? error.message : String(error);
    const status = (error as { status?: number }).status
      ?? (error as { httpStatusCode?: number }).httpStatusCode;

    if (status === 429 || /rate.limit|quota|resource.exhausted/i.test(msg)) {
      const delay = Math.min(this.backoff.delay ? this.backoff.delay * 2 : 5_000, 120_000);
      this.backoff = { until: Date.now() + delay, delay };
      return new ProviderError(`Rate limited — backing off for ${Math.round(delay / 1000)}s.`, 'rate_limited', delay);
    }

    if (status === 401 || status === 403 || /api.key|unauthorized|forbidden/i.test(msg)) {
      return new ProviderError('API key invalid or missing permissions.', 'auth');
    }

    if (status && status >= 500) {
      const delay = 10_000;
      this.backoff = { until: Date.now() + delay, delay };
      return new ProviderError('API error — retrying shortly.', 'server', delay);
    }

    return new ProviderError(msg, 'unknown');
  }
}
