#!/usr/bin/env npx tsx
// scripts/ask-gluon.ts — Interview Gluon's AI persona from the command line.
//
// Usage:
//   npx tsx scripts/ask-gluon.ts "question here"
//   npx tsx scripts/ask-gluon.ts --continue "follow up"
//   npx tsx scripts/ask-gluon.ts --reset
//   npx tsx scripts/ask-gluon.ts --state path.json "question"

import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { buildSystemPrompt } from '../src/ai/system-prompt.js';
import { GLUON_TOOLS } from '../src/ai/tool-schemas.js';
import type { Session } from '../src/engine/types.js';

// Same model as the production planner (src/ai/providers/gemini-planner.ts)
const MODEL = 'gemini-3.1-pro-preview-customtools';

const HISTORY_PATH = path.resolve('.claude/gluon-interview.json');

interface HistoryEntry {
  role: 'user' | 'model';
  content: string;
}

// ---------------------------------------------------------------------------
// Minimal default session — matches the deprecated GLUON_SYSTEM_PROMPT stub
// ---------------------------------------------------------------------------

const DEFAULT_SESSION: Session = {
  tracks: [
    { id: 'v0', model: 13, agency: 'ON' },
    { id: 'v1', model: 0, agency: 'ON' },
    { id: 'v2', model: 2, agency: 'ON' },
    { id: 'v3', model: 4, agency: 'ON' },
  ],
  activeTrackId: 'v0',
  transport: { bpm: 120, swing: 0, playing: false, timeSignature: { beatsPerBar: 4, beatUnit: 4 } },
  master: { gain: 0.8 },
  undoStack: [],
  redoStack: [],
  context: { key: null, scale: null, tempo: 120, energy: 0.5, density: 0.5 },
  messages: [],
  recentHumanActions: [],
} as unknown as Session;

// ---------------------------------------------------------------------------
// Build a textual summary of all tool schemas for inclusion in context
// ---------------------------------------------------------------------------

function summarizeTools(): string {
  const lines = GLUON_TOOLS.map(tool => {
    const params = tool.parameters.properties
      ? Object.keys(tool.parameters.properties as Record<string, unknown>).join(', ')
      : '';
    return `- **${tool.name}**(${params}): ${tool.description}`;
  });
  return `## Available Tools (reference only — not executable in this conversation)\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// History I/O
// ---------------------------------------------------------------------------

function loadHistory(): HistoryEntry[] {
  if (!fs.existsSync(HISTORY_PATH)) return [];
  try {
    const raw = fs.readFileSync(HISTORY_PATH, 'utf-8');
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

function saveHistory(history: HistoryEntry[]): void {
  const dir = path.dirname(HISTORY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

function resetHistory(): void {
  if (fs.existsSync(HISTORY_PATH)) fs.unlinkSync(HISTORY_PATH);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // --reset: clear history and exit
  if (args.includes('--reset')) {
    resetHistory();
    process.stderr.write('Conversation history cleared.\n');
    return;
  }

  // Parse flags
  let continueConversation = false;
  let statePath: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--continue') {
      continueConversation = true;
    } else if (args[i] === '--state' && i + 1 < args.length) {
      statePath = args[++i];
    } else if (!args[i].startsWith('--')) {
      positional.push(args[i]);
    }
  }

  const question = positional.join(' ').trim();
  if (!question) {
    process.stderr.write('Usage: npx tsx scripts/ask-gluon.ts [--continue] [--state path.json] "question"\n');
    process.exit(1);
  }

  // API key
  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? '';
  if (!apiKey) {
    process.stderr.write('Error: Set GOOGLE_API_KEY or GEMINI_API_KEY environment variable.\n');
    process.exit(1);
  }

  // Load or build session
  let session = DEFAULT_SESSION;
  if (statePath) {
    try {
      const raw = fs.readFileSync(path.resolve(statePath), 'utf-8');
      session = JSON.parse(raw) as Session;
    } catch (err) {
      process.stderr.write(`Error loading state from ${statePath}: ${err}\n`);
      process.exit(1);
    }
  }

  // Build system prompt with tool context appended
  const systemPrompt = buildSystemPrompt(session) + '\n\n' + summarizeTools();

  // Build conversation history
  const history: HistoryEntry[] = continueConversation ? loadHistory() : [];
  history.push({ role: 'user', content: question });

  // Build Gemini contents from history
  const contents = history.map(entry => ({
    role: entry.role,
    parts: [{ text: entry.content }],
  }));

  // Call Gemini
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: MODEL,
    contents,
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: 16384,
    },
  });

  const candidate = response.candidates?.[0];
  const textParts = (candidate?.content?.parts ?? [])
    .filter((p): p is { text: string } => 'text' in p && typeof p.text === 'string' && !('thought' in p && (p as Record<string, unknown>).thought))
    .map(p => p.text);

  const responseText = textParts.join('\n').trim();

  if (!responseText) {
    process.stderr.write('No response received from Gemini.\n');
    process.exit(1);
  }

  // Save history
  history.push({ role: 'model', content: responseText });
  saveHistory(history);

  // Output response
  process.stdout.write(responseText + '\n');
}

main().catch(err => {
  process.stderr.write(`Error: ${err}\n`);
  process.exit(1);
});
