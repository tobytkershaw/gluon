/** @deprecated Superseded by native function calling in api.ts. Kept as potential fallback. */

import type { AIAction } from '../engine/types';

function extractJSON(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  return text.trim();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isValidAction(action: unknown): action is AIAction {
  if (!isRecord(action) || typeof action.type !== 'string') return false;

  switch (action.type) {
    case 'move': {
      // Accept 'param' or 'controlId' — normalise to 'param'
      const param = action.param ?? action.controlId;
      if (typeof param !== 'string') return false;
      if (action.voiceId !== undefined && typeof action.voiceId !== 'string') return false;
      if (!isRecord(action.target)) return false;
      if (!('absolute' in action.target) && !('relative' in action.target)) return false;
      return typeof action.target.absolute === 'number' || typeof action.target.relative === 'number';
    }

    case 'say':
      return typeof action.text === 'string';

    case 'sketch': {
      if (typeof action.voiceId !== 'string') return false;
      if (typeof action.description !== 'string') return false;
      // Accept canonical 'events' array or legacy 'pattern.steps'
      if (Array.isArray(action.events)) {
        return action.events.every((e: unknown) => {
          if (!isRecord(e) || typeof e.kind !== 'string' || typeof e.at !== 'number') return false;
          switch (e.kind) {
            case 'trigger': return true;
            case 'note':
              return typeof e.pitch === 'number' && typeof e.velocity === 'number' && typeof e.duration === 'number';
            case 'parameter':
              return typeof e.controlId === 'string' && (typeof e.value === 'number' || typeof e.value === 'string' || typeof e.value === 'boolean');
            default: return false;
          }
        });
      }
      if (isRecord(action.pattern) && Array.isArray(action.pattern.steps)) {
        return action.pattern.steps.every((s: unknown) =>
          isRecord(s) && typeof s.index === 'number'
        );
      }
      return false;
    }

    default:
      return false;
  }
}

/** Normalise parsed action to internal shape */
function normaliseAction(raw: Record<string, unknown>): AIAction {
  if (raw.type === 'move' && raw.controlId && !raw.param) {
    return { ...raw, param: raw.controlId } as unknown as AIAction;
  }
  return raw as unknown as AIAction;
}

export function parseAIResponse(response: string): AIAction[] {
  try {
    const jsonStr = extractJSON(response);
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return fallbackSay(response);
    const actions = parsed.filter(isValidAction).map(a => normaliseAction(a as Record<string, unknown>));
    return actions.length > 0 ? actions : fallbackSay(response);
  } catch {
    return fallbackSay(response);
  }
}

/** If no structured actions were parsed, surface the raw model text as a say action. */
function fallbackSay(raw: string): AIAction[] {
  // Strip code fences the model may have wrapped around non-JSON text
  const text = raw.replace(/```(?:json)?\s*\n?/g, '').replace(/\n?```/g, '').trim();
  if (!text) return [];
  // If the text looks like malformed JSON, don't leak it into chat
  if (/^\s*[\[{]/.test(text)) return [];
  return [{ type: 'say', text }];
}
