// src/ai/api.ts

import { GoogleGenAI } from '@google/genai';
import type { Content } from '@google/genai';
import type { Session, AIAction } from '../engine/types';
import { compressState } from './state-compression';
import { parseAIResponse } from './response-parser';
import { GLUON_SYSTEM_PROMPT } from './system-prompt';

const MODEL = 'gemini-3-flash-preview';

/** Result from a stateless Gemini call */
interface CallResult {
  actions: AIAction[];
  raw: string;
  /** Full model Content object preserving thoughtSignature fields */
  modelContent: Content | null;
}

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

    const result = await this.callStateless(contents);

    // Store clean human text + full model Content in history.
    // The model Content preserves thoughtSignature fields required by Gemini 3
    // thinking models for multi-turn coherence.
    this.history.push(
      { role: 'user', parts: [{ text: humanMessage }] },
    );
    if (result.modelContent) {
      this.history.push(result.modelContent);
    } else {
      // Fallback: store raw text if no model Content available (e.g., error path)
      this.history.push({ role: 'model', parts: [{ text: result.raw }] });
    }

    return result.actions;
  }

  private async callStateless(contents: Content[]): Promise<CallResult> {
    if (!this.ai) return { actions: [], raw: '', modelContent: null };

    const now = Date.now();
    if (now < this.backoff.until) return { actions: [], raw: '', modelContent: null };

    try {
      const response = await this.ai.models.generateContent({
        model: MODEL,
        config: {
          systemInstruction: GLUON_SYSTEM_PROMPT,
          maxOutputTokens: 800,
          thinkingConfig: { thinkingLevel: 'MEDIUM' },
        },
        contents,
      });

      const text = response.text ?? '';
      // Preserve the full model Content object including thoughtSignature parts
      const modelContent = response.candidates?.[0]?.content ?? null;

      this.backoff = { until: 0, delay: 0 };
      return { actions: parseAIResponse(text), raw: text, modelContent };
    } catch (error) {
      return { actions: this.handleError(error), raw: '', modelContent: null };
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
