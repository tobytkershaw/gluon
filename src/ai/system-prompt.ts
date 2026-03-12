// src/ai/system-prompt.ts

import type { Session } from '../engine/types';
import { VOICE_LABELS } from '../engine/voice-labels';
import { getModelList, getEngineByIndex, isPercussion } from '../audio/instrument-registry';

function generateModelReference(): string {
  return getModelList()
    .map(m => `${m.index}: ${m.name}`)
    .join(', ');
}

function generateParameterSection(): string {
  const engine = getEngineByIndex(0);
  if (!engine) return '';
  return engine.controls
    .map(c => `- **${c.id}** (${c.range?.min ?? 0}-${c.range?.max ?? 1}): ${c.description}`)
    .join('\n');
}

function generateVoiceSetup(session: Session): string {
  const voiceLines = session.voices.map(v => {
    const label = VOICE_LABELS[v.id] ?? v.id;
    const engine = getEngineByIndex(v.model);
    const engineLabel = engine?.label ?? `Model ${v.model}`;
    const engineId = engine?.id ?? '';
    const classification = isPercussion(engineId) ? 'percussion' : 'melodic';
    const agency = v.agency === 'ON' ? 'agency ON' : 'agency OFF';
    return `- ${v.id} (${label}): ${engineLabel} (${classification}) — ${agency}`;
  }).join('\n');

  return `${session.voices.length} voices:
${voiceLines}
For percussion voices, use trigger events in sketch.
For melodic voices, use note events with MIDI pitches. Duration is always 0.25.`;
}

export function buildSystemPrompt(session: Session): string {
  return `You are the AI assistant in Gluon, a shared musical instrument in the browser. You make changes when asked. You do not act autonomously.

Use the provided tools to make changes. You can call multiple tools in one turn. To speak to the human, just reply with text — no tool call needed.

## Voice Setup
${generateVoiceSetup(session)}

## Behaviour Rules
1. Make minimal, local edits by default. Only change what the human asks for.
2. All voices are AI-editable by default (agency ON). If a voice has agency OFF it is **protected** — observe it but do not modify it.
3. Your changes are queued and applied after your response. The human can undo any action.
4. Be musical. Be concise. Don't over-explain.
5. When sketching patterns, think musically — groove, syncopation, dynamics.
6. Respond to the human's musical direction. If they're exploring dark timbres, don't suggest bright ones unless asked.
7. Keep text responses short — one or two sentences max.
8. You can combine tool calls: sketch a pattern AND move params in one turn.
9. Use the transform tool to rotate, transpose, reverse, or duplicate existing patterns instead of rewriting them with sketch.

## Plaits Models Reference
${generateModelReference()}

## Parameter Space (semantic controls)
${generateParameterSection()}`;
}

/** @deprecated Use buildSystemPrompt(session) instead */
export const GLUON_SYSTEM_PROMPT = buildSystemPrompt({
  voices: [
    { id: 'v0', model: 13, agency: 'ON' },
    { id: 'v1', model: 0, agency: 'ON' },
    { id: 'v2', model: 2, agency: 'ON' },
    { id: 'v3', model: 4, agency: 'ON' },
  ],
} as Session);
