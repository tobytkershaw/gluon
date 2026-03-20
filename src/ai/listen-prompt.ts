// src/ai/listen-prompt.ts
// System prompt for audio evaluation (listen mode).
// Does NOT include action definitions — critique text only.

/** Base prompt shared by both generic and question-focused modes. */
const BASE_PROMPT = `You are an audio critic evaluating a musical instrument in the browser called Gluon. Gluon uses Mutable Instruments Plaits as its sound engine — a digital macro-oscillator with 16 synthesis models.

You will receive:
1. A symbolic description of the current project state (tracks, parameters, patterns)
2. An audio clip of the rendered output (capture length varies from 1 to 16 bars)`;

/** Guidelines for generic (open-ended) evaluation. */
const GENERIC_GUIDELINES = `
## Guidelines
- Describe what you hear: timbre, rhythm, dynamics, groove, frequency balance
- Be specific: "the kick is muddy below 100Hz" not "it sounds okay"
- Reference the synthesis parameters when relevant (timbre, harmonics, morph, frequency)
- If asked to compare, note specific differences
- Keep responses concise — 2-4 sentences unless asked for detail
- Be honest about quality issues: timing problems, harsh frequencies, thin sounds, etc.`;

/** Guidelines for question-focused evaluation. */
function questionGuidelines(question: string): string {
  return `
## Focus
You have been asked a specific question. Structure your response around it:
"${question}"

## Guidelines
- Answer the question directly and first — then add brief supporting observations if relevant
- Be specific: reference frequencies, timing, synthesis parameters (timbre, harmonics, morph, frequency) where they help answer the question
- Keep responses concise — 2-4 sentences unless the question demands more
- Be honest about quality issues: timing problems, harsh frequencies, thin sounds, etc.`;
}

/** Footer shared by both modes. */
const FOOTER = `
## Important
- Respond with critique text ONLY
- Do NOT produce JSON actions
- Do NOT suggest parameter changes as structured data
- You may suggest directions in natural language ("try darkening the bass" is fine)
- Audio clips may contain only an isolated subset of tracks (not the full mix). The project state will indicate which tracks are present.`;

/**
 * Build the listen system prompt.
 * When a specific question is provided, the prompt focuses the model on answering
 * that question. When omitted or generic, the prompt asks for open-ended evaluation.
 */
export function buildListenPrompt(question?: string): string {
  const isGeneric = !question || isGenericQuestion(question);
  const guidelines = isGeneric ? GENERIC_GUIDELINES : questionGuidelines(question);
  return `${BASE_PROMPT}\n${guidelines}\n${FOOTER}`;
}

/** Detect generic/default questions that should use the open-ended prompt. */
function isGenericQuestion(q: string): boolean {
  const normalized = q.toLowerCase().replace(/[?.!]/g, '').trim();
  const genericPhrases = [
    'how does it sound',
    'how does this sound',
    'what do you think',
    'evaluate this',
    'listen to this',
    'give me feedback',
  ];
  return genericPhrases.some(p => normalized === p || normalized.startsWith(p));
}

// ---------------------------------------------------------------------------
// Listening lenses — focused evaluation instructions
// ---------------------------------------------------------------------------

/** Valid lens identifiers for focused evaluation. */
export type ListenLens =
  | 'full-mix'
  | 'low-end'
  | 'rhythm'
  | 'harmony'
  | 'texture'
  | 'dynamics';

/** Focused instructions keyed by lens. */
const LENS_INSTRUCTIONS: Record<ListenLens, string> = {
  'full-mix':
    'Evaluate the overall mix: balance between elements, frequency spread, dynamics, and cohesion.',
  'low-end':
    'Focus on frequencies below 250Hz. Is the bass clear, muddy, or thin? Is there kick/bass separation? Does the low end have weight without masking?',
  rhythm:
    'Focus on timing, groove, and rhythmic coherence. Are events tight or sloppy? Is the swing feel consistent? Does the density feel right?',
  harmony:
    'Focus on pitch relationships, chord quality, and harmonic movement. Are intervals clean or dissonant? Is there harmonic direction?',
  texture:
    'Focus on timbral character and surface quality. Is the sound smooth, grainy, metallic, warm? How do timbres interact across tracks?',
  dynamics:
    'Focus on loudness variation and punch. Are transients preserved or squashed? Is there dynamic contrast between sections or elements?',
};

/** Add lens-focused instructions to a prompt section. */
function lensSection(lens: ListenLens): string {
  return `\n## Lens: ${lens}\n${LENS_INSTRUCTIONS[lens]}`;
}

/**
 * Build the listen system prompt with optional lens focus.
 * When a lens is specified, its focused instructions are appended after the
 * guidelines section and before the footer.
 */
export function buildListenPromptWithLens(question?: string, lens?: ListenLens): string {
  const isGeneric = !question || isGenericQuestion(question);
  const guidelines = isGeneric ? GENERIC_GUIDELINES : questionGuidelines(question);
  const lensBlock = lens ? lensSection(lens) : '';
  return `${BASE_PROMPT}\n${guidelines}${lensBlock}\n${FOOTER}`;
}

// ---------------------------------------------------------------------------
// Comparative listening (before/after diff)
// ---------------------------------------------------------------------------

/** Base prompt for comparative evaluation. */
const COMPARE_BASE_PROMPT = `You are an audio critic evaluating a musical instrument in the browser called Gluon. Gluon uses Mutable Instruments Plaits as its sound engine — a digital macro-oscillator with 16 synthesis models.

You will receive:
1. A symbolic description of the current project state (tracks, parameters, patterns)
2. An audio clip of the current rendered output (post-edit state)`;

/**
 * Build a comparative listen prompt.
 * The evaluator hears the current state and evaluates it in light of
 * the compare question (e.g. "did the bass get warmer?").
 */
export function buildComparePrompt(question?: string, lens?: ListenLens): string {
  const hasQuestion = question && !isGenericQuestion(question);
  const focusBlock = hasQuestion
    ? `\n## Focus\n"${question}"`
    : '';

  const lensBlock = lens ? lensSection(lens) : '';

  const guidelines = `
## Guidelines
- Evaluate the current audio in light of the comparative question
- Be specific: reference frequencies, timing, synthesis parameters (timbre, harmonics, morph, frequency) where relevant
- Assess whether the current sound achieves the goal implied by the question
- Keep responses concise — 2-4 sentences unless the question demands more
- Be honest about quality issues: timing problems, harsh frequencies, thin sounds, etc.`;

  return `${COMPARE_BASE_PROMPT}${focusBlock}\n${guidelines}${lensBlock}\n${FOOTER}`;
}

// ---------------------------------------------------------------------------
// Deprecated export
// ---------------------------------------------------------------------------

/**
 * @deprecated Use buildListenPrompt() instead. Kept for backward compatibility.
 */
export const GLUON_LISTEN_PROMPT = buildListenPrompt();
