// src/ai/listen-rubric.ts
// Structured evaluation rubric for the listen tool.

export interface EvaluationRubric {
  groove: number;      // 1-5
  clarity: number;     // 1-5
  energy: number;      // 1-5
  coherence: number;   // 1-5
  space: number;       // 1-5
  summary: string;
  actionItems: string[];
}

/** Rubric criteria appended to the listen prompt when rubric mode is active. */
export const RUBRIC_CRITERIA = `
## Structured Evaluation Rubric
Rate each dimension 1-5:

| Dimension | 1 | 3 | 5 |
|-----------|---|---|---|
| Groove | No rhythmic interest, mechanical | Decent timing, basic swing | Deep pocket, makes you move |
| Clarity | Muddy, parts masked | Most parts audible | Every element clear and distinct |
| Energy | Doesn't match section target | Reasonable energy level | Perfectly calibrated |
| Coherence | Parts feel unrelated | Parts mostly compatible | Everything serves one musical idea |
| Space | Cluttered or empty | Reasonable stereo/depth | Immersive, balanced spatial image |

Respond with JSON:
{
  "groove": N, "clarity": N, "energy": N, "coherence": N, "space": N,
  "summary": "one line",
  "actionItems": ["specific fix 1", "specific fix 2"]
}
`;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Try to extract and parse a rubric JSON from the evaluator response text. */
export function parseRubricResponse(text: string): EvaluationRubric | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    // Validate that at least one score field is present
    if (
      typeof parsed.groove !== 'number' &&
      typeof parsed.clarity !== 'number' &&
      typeof parsed.energy !== 'number' &&
      typeof parsed.coherence !== 'number' &&
      typeof parsed.space !== 'number'
    ) {
      return null;
    }
    return {
      groove: clamp(parsed.groove ?? 3, 1, 5),
      clarity: clamp(parsed.clarity ?? 3, 1, 5),
      energy: clamp(parsed.energy ?? 3, 1, 5),
      coherence: clamp(parsed.coherence ?? 3, 1, 5),
      space: clamp(parsed.space ?? 3, 1, 5),
      summary: String(parsed.summary ?? ''),
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.map(String) : [],
    };
  } catch {
    return null;
  }
}
