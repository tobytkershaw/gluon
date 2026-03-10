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
    case 'move':
      if (typeof action.param !== 'string') return false;
      if (!isRecord(action.target)) return false;
      if (!('absolute' in action.target) && !('relative' in action.target)) return false;
      return typeof action.target.absolute === 'number' || typeof action.target.relative === 'number';

    case 'suggest':
    case 'audition':
      return isRecord(action.changes) && Object.values(action.changes).every(v => typeof v === 'number');

    case 'say':
      return typeof action.text === 'string';

    case 'sketch':
      if (typeof action.voiceId !== 'string') return false;
      if (typeof action.description !== 'string') return false;
      if (!isRecord(action.pattern)) return false;
      if (!Array.isArray(action.pattern.steps)) return false;
      return action.pattern.steps.every((s: unknown) =>
        isRecord(s) && typeof s.index === 'number'
      );

    default:
      return false;
  }
}

export function parseAIResponse(response: string): AIAction[] {
  try {
    const jsonStr = extractJSON(response);
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidAction);
  } catch {
    return [];
  }
}
