// src/ui/TurnSummaryCard.tsx
// Per-turn summary card shown after AI messages with actions.
// Compact "Changed / Why / Next" display with follow-up chips.
// Client-side only — no model calls.

import type { ActionLogEntry, ActionDiff } from '../engine/types';

// ---------------------------------------------------------------------------
// Derivation helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Summarise what changed from the action log entries.
 * Groups by category (timbre, pattern, transport, chain, etc.) and
 * returns a short human-readable string like "bass timbre + swing".
 */
export function deriveChanged(actions: ActionLogEntry[]): string {
  if (actions.length === 0) return '';

  const parts: string[] = [];

  for (const a of actions) {
    const diff = a.diff;
    if (!diff) {
      // Fallback: use description if no structured diff
      if (a.description && !parts.includes(a.description)) {
        parts.push(a.description);
      }
      continue;
    }
    const label = summariseDiff(diff, a.trackLabel);
    if (label && !parts.includes(label)) {
      parts.push(label);
    }
  }

  if (parts.length === 0) return '';
  if (parts.length <= 3) return parts.join(' + ');
  return parts.slice(0, 2).join(' + ') + ` + ${parts.length - 2} more`;
}

function summariseDiff(diff: ActionDiff, trackLabel: string): string {
  switch (diff.kind) {
    case 'param-change':
      return `${trackLabel} ${diff.controlId}`;
    case 'pattern-change':
      return `${trackLabel} pattern`;
    case 'transport-change':
      return diff.field;
    case 'model-change':
      return `${trackLabel} engine`;
    case 'processor-add':
      return `+${diff.processorType}`;
    case 'processor-remove':
      return `-${diff.processorType}`;
    case 'processor-replace':
      return `${diff.fromType} \u2192 ${diff.toType}`;
    case 'modulator-add':
      return `+${diff.modulatorType} mod`;
    case 'modulator-remove':
      return `-${diff.modulatorType} mod`;
    case 'modulation-connect':
      return `mod \u2192 ${diff.target}`;
    case 'modulation-disconnect':
      return `unroute ${diff.target}`;
    case 'transform':
      return `${diff.operation}`;
    case 'master-change':
      return `master ${diff.field}`;
    case 'surface-set':
      return `surface (${diff.controlCount} controls)`;
    case 'surface-pin':
      return `pin ${diff.controlId}`;
    case 'surface-unpin':
      return `unpin ${diff.controlId}`;
    case 'surface-label-axes':
      return `axes ${diff.x}/${diff.y}`;
    case 'approval-change':
      return `approval \u2192 ${diff.to}`;
    default:
      return '';
  }
}

/**
 * Extract a short "why" from the AI response text.
 * Uses the first sentence (up to ~120 chars) as the rationale.
 */
export function deriveWhy(aiText: string): string {
  if (!aiText) return '';

  // Strip markdown formatting for cleaner display
  const clean = aiText.replace(/[*_`#]/g, '').trim();

  // Find first sentence boundary
  const sentenceEnd = clean.search(/[.!?]\s/);
  if (sentenceEnd >= 0 && sentenceEnd < 120) {
    return clean.slice(0, sentenceEnd + 1);
  }
  // No sentence boundary found — truncate at word boundary
  if (clean.length <= 120) return clean;
  const truncated = clean.slice(0, 120);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 60 ? truncated.slice(0, lastSpace) : truncated) + '\u2026';
}

/** A follow-up chip: display label and the prompt text to send. */
export interface FollowUpChip {
  label: string;
  prompt: string;
}

/**
 * Category tags derived from action diffs, used to pick follow-up chips.
 */
type ChangeCategory = 'timbre' | 'pattern' | 'transport' | 'chain' | 'mix' | 'transform' | 'modulation' | 'model' | 'surface' | 'other';

function categoriseDiff(diff: ActionDiff): ChangeCategory {
  switch (diff.kind) {
    case 'param-change': return 'timbre';
    case 'pattern-change': return 'pattern';
    case 'transport-change': return 'transport';
    case 'model-change': return 'model';
    case 'processor-add':
    case 'processor-remove':
    case 'processor-replace': return 'chain';
    case 'modulator-add':
    case 'modulator-remove':
    case 'modulation-connect':
    case 'modulation-disconnect': return 'modulation';
    case 'transform': return 'transform';
    case 'master-change': return 'mix';
    case 'surface-set':
    case 'surface-pin':
    case 'surface-unpin':
    case 'surface-label-axes': return 'surface';
    case 'approval-change': return 'other';
    default: return 'other';
  }
}

const CHIP_POOLS: Record<ChangeCategory, FollowUpChip[]> = {
  timbre: [
    { label: 'more bright', prompt: 'Make it brighter' },
    { label: 'more dark', prompt: 'Make it darker' },
    { label: 'more weight', prompt: 'Give it more weight' },
    { label: 'A/B compare', prompt: 'Compare before and after' },
  ],
  pattern: [
    { label: 'more notes', prompt: 'Add more notes to the pattern' },
    { label: 'simpler', prompt: 'Simplify the pattern' },
    { label: 'more swing', prompt: 'Add more swing' },
    { label: 'add variation', prompt: 'Add some variation to the pattern' },
  ],
  transport: [
    { label: 'faster', prompt: 'Increase the tempo' },
    { label: 'slower', prompt: 'Decrease the tempo' },
    { label: 'more swing', prompt: 'Add more swing' },
    { label: 'undo', prompt: 'Undo the last change' },
  ],
  chain: [
    { label: 'more wet', prompt: 'Increase the effect amount' },
    { label: 'more dry', prompt: 'Reduce the effect amount' },
    { label: 'try another', prompt: 'Try a different effect' },
    { label: 'A/B compare', prompt: 'Compare before and after' },
  ],
  mix: [
    { label: 'louder', prompt: 'Turn it up' },
    { label: 'quieter', prompt: 'Turn it down' },
    { label: 'wider', prompt: 'Make the mix wider' },
    { label: 'undo', prompt: 'Undo the last change' },
  ],
  transform: [
    { label: 'more', prompt: 'Apply the same transformation again' },
    { label: 'undo', prompt: 'Undo the last change' },
    { label: 'try reverse', prompt: 'Try reversing the pattern' },
    { label: 'add variation', prompt: 'Add some variation' },
  ],
  modulation: [
    { label: 'more depth', prompt: 'Increase modulation depth' },
    { label: 'less depth', prompt: 'Decrease modulation depth' },
    { label: 'try another target', prompt: 'Route the modulation to a different target' },
    { label: 'A/B compare', prompt: 'Compare before and after' },
  ],
  model: [
    { label: 'tweak timbre', prompt: 'Adjust the timbre' },
    { label: 'try another', prompt: 'Try a different engine' },
    { label: 'undo', prompt: 'Undo the last change' },
  ],
  surface: [
    { label: 'undo', prompt: 'Undo the last change' },
  ],
  other: [
    { label: 'undo', prompt: 'Undo the last change' },
  ],
};

/**
 * Generate 2-4 contextual follow-up chips based on what changed.
 * Picks from category-specific pools, deduplicates, and caps at 4.
 */
export function deriveFollowUps(actions: ActionLogEntry[]): FollowUpChip[] {
  if (actions.length === 0) return [];

  // Collect categories
  const categories = new Set<ChangeCategory>();
  for (const a of actions) {
    if (a.diff) {
      categories.add(categoriseDiff(a.diff));
    }
  }

  if (categories.size === 0) {
    categories.add('other');
  }

  // Collect chips from each category — reserve one slot for undo
  const chips: FollowUpChip[] = [];
  const seenLabels = new Set<string>();
  const maxBeforeUndo = 3;

  for (const cat of categories) {
    const pool = CHIP_POOLS[cat];
    for (const chip of pool) {
      if (chip.label === 'undo') continue; // handled separately below
      if (!seenLabels.has(chip.label) && chips.length < maxBeforeUndo) {
        seenLabels.add(chip.label);
        chips.push(chip);
      }
      if (chips.length >= maxBeforeUndo) break;
    }
    if (chips.length >= maxBeforeUndo) break;
  }

  // Always append undo as the last chip
  chips.push({ label: 'undo', prompt: 'Undo the last change' });

  return chips;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  actions: ActionLogEntry[];
  aiText: string;
  onChipSelect: (text: string) => void;
  /** AI-generated contextual reaction chips (from suggest_reactions tool). */
  suggestedReactions?: string[];
}

export function TurnSummaryCard({ actions, aiText, onChipSelect, suggestedReactions }: Props) {
  const changed = deriveChanged(actions);
  const why = deriveWhy(aiText);
  // When AI provides contextual reactions, use those instead of static follow-ups
  const hasAISuggestions = suggestedReactions && suggestedReactions.length > 0;
  const followUps = hasAISuggestions ? [] : deriveFollowUps(actions);

  if (!changed && !why && followUps.length === 0 && !hasAISuggestions) return null;

  return (
    <div
      className="mt-2 rounded bg-zinc-800/30 border border-zinc-800/50 px-2.5 py-2 space-y-1"
      style={{ animation: 'fade-up 0.15s ease-out' }}
    >
      {changed && (
        <div className="text-[11px] font-mono leading-snug">
          <span className="text-zinc-600 mr-1.5">Changed:</span>
          <span className="text-zinc-400">{changed}</span>
        </div>
      )}
      {why && (
        <div className="text-[11px] font-mono leading-snug">
          <span className="text-zinc-600 mr-1.5">Why:</span>
          <span className="text-zinc-500">{why}</span>
        </div>
      )}
      {followUps.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {followUps.map((chip) => (
            <button
              key={chip.label}
              onClick={() => onChipSelect(chip.prompt)}
              className="px-2.5 py-1 rounded-full text-[11px] text-zinc-500 border border-zinc-800 hover:border-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/40 transition-colors cursor-pointer"
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
