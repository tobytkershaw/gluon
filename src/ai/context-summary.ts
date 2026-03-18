// src/ai/context-summary.ts — LLM-summarized context trimming (#785 Phase 2).
//
// When the token budget is exceeded, exchanges are dropped from history.
// This module summarizes them via Gemini Flash before they're lost, preserving
// creative decisions, rejections, commitments, and arrangement plans.

import type { GoogleGenAI } from '@google/genai';
import type { ChatMessage } from '../engine/types';

const SUMMARY_MODEL = 'gemini-2.0-flash-lite';
// 400 words ≈ 520 tokens; small headroom for formatting variance.
const MAX_OUTPUT_TOKENS = 550;

const SUMMARY_PROMPT_TEMPLATE = `You are rewriting a compact session memory for a music production AI assistant.

{EXISTING_SUMMARY}New exchanges being archived:
{EXCHANGES}

Write ONE compact session memory (strictly under 400 words) that REPLACES the current memory. This is not an append — rewrite the full memory from scratch, merging old and new information. Prioritize by importance:
1. Creative decisions — genre, aesthetic, sound choices
2. Explicit rejections — what the human rejected and why
3. AI commitments — what the AI promised to do or avoid
4. Track roles — which track serves which musical function
5. Arrangement plans — sections, energy arc, what comes next

Drop routine acknowledgements, greetings, and status updates.
Only include facts that help maintain creative continuity.`;

/**
 * Format chat messages into a readable text block for the summarization prompt.
 */
function formatExchanges(messages: ChatMessage[]): string {
  return messages
    .map(m => {
      const role = m.role === 'human' ? 'Human' : m.role === 'ai' ? 'AI' : 'System';
      return `[${role}]: ${m.text}`;
    })
    .join('\n\n');
}

/**
 * Build the full summarization prompt.
 */
export function buildSummaryPrompt(
  existingSummary: string | null,
  droppedMessages: ChatMessage[],
): string {
  const existingBlock = existingSummary
    ? `Current session memory:\n${existingSummary}\n\n`
    : '';
  const exchanges = formatExchanges(droppedMessages);
  return SUMMARY_PROMPT_TEMPLATE
    .replace('{EXISTING_SUMMARY}', existingBlock)
    .replace('{EXCHANGES}', exchanges);
}

/**
 * Call Gemini Flash to summarize dropped exchanges into a running context summary.
 * Best-effort: returns the existing summary unchanged on any error.
 */
export async function summarizeDroppedExchanges(
  ai: GoogleGenAI,
  existingSummary: string | null,
  droppedMessages: ChatMessage[],
): Promise<string> {
  if (droppedMessages.length === 0) {
    return existingSummary ?? '';
  }

  const prompt = buildSummaryPrompt(existingSummary, droppedMessages);

  const response = await ai.models.generateContent({
    model: SUMMARY_MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  });

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    return existingSummary ?? '';
  }
  return text.trim();
}

/**
 * Extract the oldest N exchanges from a ChatMessage array.
 *
 * An "exchange" = one human message + all AI/system messages before the next
 * human message. This is a best-effort approximation of what the provider is
 * about to drop — session.messages and provider exchange count track closely
 * but aren't guaranteed to be perfectly aligned.
 */
export function extractOldestExchanges(
  messages: ChatMessage[],
  exchangeCount: number,
): ChatMessage[] {
  if (exchangeCount <= 0 || messages.length === 0) return [];

  // Identify exchange boundaries (each human message starts a new exchange)
  const boundaries: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'human') {
      boundaries.push(i);
    }
  }

  if (boundaries.length === 0) return [];

  const take = Math.min(exchangeCount, boundaries.length);

  // End index: start of the (take+1)th exchange, or end of array
  const endIndex = take < boundaries.length
    ? boundaries[take]
    : messages.length;

  return messages.slice(0, endIndex);
}
