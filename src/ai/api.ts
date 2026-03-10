// src/ai/api.ts

import Anthropic from '@anthropic-ai/sdk';
import type { Session, AIAction } from '../engine/types';
import { compressState } from './state-compression';
import { parseAIResponse } from './response-parser';
import { GLUON_SYSTEM_PROMPT } from './system-prompt';

export class GluonAI {
  private client: Anthropic | null = null;
  private conversationHistory: { role: 'user' | 'assistant'; content: string }[] = [];

  setApiKey(key: string): void {
    this.client = new Anthropic({
      apiKey: key,
      dangerouslyAllowBrowser: true,
    });
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async ask(session: Session, humanMessage: string): Promise<AIAction[]> {
    if (!this.client) return [];
    const state = compressState(session, humanMessage);
    return this.call(JSON.stringify(state));
  }

  async react(session: Session): Promise<AIAction[]> {
    if (!this.client) return [];
    // Check if any voice has agency beyond OFF
    const anyActive = session.voices.some(v => v.agency !== 'OFF');
    if (!anyActive) return [];
    if (session.leash < 0.3) return [];
    const state = compressState(session);
    return this.call(JSON.stringify(state));
  }

  private async call(userContent: string): Promise<AIAction[]> {
    if (!this.client) return [];
    this.conversationHistory.push({ role: 'user', content: userContent });
    if (this.conversationHistory.length > 20) {
      this.conversationHistory = this.conversationHistory.slice(-20);
    }
    try {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        system: GLUON_SYSTEM_PROMPT,
        messages: this.conversationHistory,
      });
      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      this.conversationHistory.push({ role: 'assistant', content: text });
      return parseAIResponse(text);
    } catch (error) {
      console.error('Gluon AI call failed:', error);
      return [];
    }
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }
}
