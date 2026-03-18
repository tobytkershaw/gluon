// src/ai/providers/openai-listener.ts — ListenerProvider for OpenAI (Responses API).

import OpenAI from 'openai';
import type { ListenerProvider } from '../types';
import { ProviderError } from '../types';

const MODEL = 'gpt-5.4';

interface BackoffState {
  until: number;
  delay: number;
}

export class OpenAIListenerProvider implements ListenerProvider {
  readonly name = 'openai';
  private client: OpenAI | null;
  private backoff: BackoffState = { until: 0, delay: 0 };

  constructor(apiKey: string) {
    this.client = apiKey
      ? new OpenAI({ apiKey, dangerouslyAllowBrowser: true })
      : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async evaluate(opts: {
    systemPrompt: string;
    stateJson: string;
    question: string;
    audioData: Blob;
    mimeType: string;
  }): Promise<string> {
    if (!this.client) throw new ProviderError('API not configured.', 'auth');

    const now = Date.now();
    if (now < this.backoff.until) {
      throw new ProviderError('Rate limited — try again shortly.', 'rate_limited', this.backoff.until - now);
    }

    // Encode audio to base64
    const audioBytes = new Uint8Array(await opts.audioData.arrayBuffer());
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < audioBytes.length; i += chunkSize) {
      binary += String.fromCharCode(...audioBytes.subarray(i, i + chunkSize));
    }
    const audioBase64 = btoa(binary);

    // OpenAI Responses API takes audio as a top-level input_audio item,
    // not as a content part inside a message.
    try {
      const response = await this.client.responses.create({
        model: MODEL,
        instructions: opts.systemPrompt,
        input: [
          {
            role: 'user',
            content: `Project state:\n${opts.stateJson}\n\nQuestion: ${opts.question}`,
          },
          {
            type: 'input_audio' as const,
            input_audio: {
              data: audioBase64,
              format: 'wav',
            },
          },
        ],
        max_output_tokens: 2048,
      });

      this.backoff = { until: 0, delay: 0 };

      // Extract text from the response output
      for (const item of response.output) {
        if (item.type === 'message') {
          for (const content of item.content) {
            if (content.type === 'output_text' && content.text) {
              return content.text;
            }
          }
        }
      }
      return 'No response from model.';
    } catch (error) {
      throw this.translateError(error);
    }
  }

  private translateError(error: unknown): ProviderError {
    if (error instanceof OpenAI.RateLimitError) {
      const delay = Math.min(this.backoff.delay ? this.backoff.delay * 2 : 5_000, 120_000);
      this.backoff = { until: Date.now() + delay, delay };
      return new ProviderError(
        `Rate limited — backing off for ${Math.round(delay / 1000)}s.`,
        'rate_limited',
        delay,
      );
    }

    if (error instanceof OpenAI.AuthenticationError) {
      return new ProviderError('API key invalid or missing permissions.', 'auth');
    }

    if (error instanceof OpenAI.InternalServerError) {
      const delay = 10_000;
      this.backoff = { until: Date.now() + delay, delay };
      return new ProviderError('API error — retrying shortly.', 'server', delay);
    }

    const msg = error instanceof Error ? error.message : String(error);
    return new ProviderError(msg, 'unknown');
  }
}
