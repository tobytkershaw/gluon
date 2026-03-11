// src/ai/api.ts

import { GoogleGenAI } from '@google/genai';
import type { Content } from '@google/genai';
import type { Session, AIAction } from '../engine/types';
import { compressState } from './state-compression';
import { parseAIResponse } from './response-parser';
import { GLUON_SYSTEM_PROMPT } from './system-prompt';

const MODEL = 'gemini-2.5-flash';

/** Backoff state for rate-limit handling */
interface BackoffState {
  until: number;    // timestamp when we can retry
  delay: number;    // current delay in ms
}

export class GluonAI {
  private ai: GoogleGenAI | null = null;
  private history: Content[] = [];
  private backoff: BackoffState = { until: 0, delay: 0 };

  private static MAX_EXCHANGES = 12;

  constructor() {
    const envKey = import.meta.env.VITE_GOOGLE_API_KEY;
    if (envKey) {
      this.setApiKey(envKey);
    }
  }

  setApiKey(key: string): void {
    this.ai = new GoogleGenAI({ apiKey: key });
    this.history = [];
    this.backoff = { until: 0, delay: 0 };
  }

  isConfigured(): boolean {
    return this.ai !== null;
  }

  async ask(session: Session, humanMessage: string): Promise<AIAction[]> {
    if (!this.ai) return [];

    // Trim history to bounded window
    const maxTurns = GluonAI.MAX_EXCHANGES * 2;
    if (this.history.length > maxTurns) {
      this.history = this.history.slice(-maxTurns);
    }

    // Current turn includes compressed state + human message
    const state = compressState(session);
    const userText = `Project state:\n${JSON.stringify(state)}\n\nHuman says: ${humanMessage}`;
    const userContent: Content = { role: 'user', parts: [{ text: userText }] };
    const contents = [...this.history, userContent];

    const response = await this.callStateless(contents);

    // Store clean human text + raw AI response in history (no state blob)
    this.history.push(
      { role: 'user', parts: [{ text: humanMessage }] },
      { role: 'model', parts: [{ text: response.raw }] },
    );

    return response.actions;
  }

  private async callStateless(contents: Content[]): Promise<{ actions: AIAction[]; raw: string }> {
    if (!this.ai) return { actions: [], raw: '' };

    const now = Date.now();
    if (now < this.backoff.until) return { actions: [], raw: '' };

    try {
      const response = await this.ai.models.generateContent({
        model: MODEL,
        config: { systemInstruction: GLUON_SYSTEM_PROMPT, maxOutputTokens: 800 },
        contents,
      });
      const text = response.text ?? '';
      this.backoff = { until: 0, delay: 0 };
      return { actions: parseAIResponse(text), raw: text };
    } catch (error) {
      return { actions: this.handleError(error), raw: '' };
    }
  }

  private handleError(error: unknown): AIAction[] {
    const msg = error instanceof Error ? error.message : String(error);
    const status = (error as { status?: number }).status
      ?? (error as { httpStatusCode?: number }).httpStatusCode;

    // Rate limit (429) or quota exceeded
    if (status === 429 || /rate.limit|quota|resource.exhausted/i.test(msg)) {
      const delay = Math.min(this.backoff.delay ? this.backoff.delay * 2 : 5_000, 120_000);
      this.backoff = { until: Date.now() + delay, delay };
      const secs = Math.round(delay / 1000);
      return [{ type: 'say', text: `Rate limited — backing off for ${secs}s.` }];
    }

    // Auth error
    if (status === 401 || status === 403 || /api.key|unauthorized|forbidden/i.test(msg)) {
      return [{ type: 'say', text: 'API key invalid or missing permissions. Check your Google API key.' }];
    }

    // Server error — transient, back off briefly
    if (status && status >= 500) {
      this.backoff = { until: Date.now() + 10_000, delay: 10_000 };
      return [{ type: 'say', text: 'Gemini API error — retrying shortly.' }];
    }

    console.error('Gluon AI call failed:', error);
    return [];
  }

  clearHistory(): void {
    this.history = [];
    this.backoff = { until: 0, delay: 0 };
  }
}
