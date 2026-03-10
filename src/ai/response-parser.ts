import type { AIAction } from '../engine/types';

const VALID_TYPES = ['move', 'suggest', 'audition', 'say', 'sketch'];

function extractJSON(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  return text.trim();
}

export function parseAIResponse(response: string): AIAction[] {
  try {
    const jsonStr = extractJSON(response);
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (action: Record<string, unknown>) =>
        action && typeof action.type === 'string' && VALID_TYPES.includes(action.type),
    ) as AIAction[];
  } catch {
    return [];
  }
}
