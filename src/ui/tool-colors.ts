/**
 * Color coding for AI tool calls by category.
 *
 * Categories match the mockup design (11-chat-tab.html):
 *   source    amber   — sound source creation/configuration
 *   processor sky     — signal processing chain
 *   pattern   emerald — note/rhythm/pattern writing
 *   param     violet  — parameter tweaks (move, ramp, set_param)
 *   surface   teal    — surface/view/identity curation
 *   other     zinc    — uncategorized / meta tools
 */

export type ToolCategory = 'source' | 'processor' | 'pattern' | 'param' | 'surface' | 'other';

const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  // Source tools (amber)
  set_model: 'source',
  manage_drum_pad: 'source',

  // Processor tools (sky)
  manage_processor: 'processor',
  manage_modulator: 'processor',
  modulation_route: 'processor',

  // Pattern tools (emerald)
  sketch: 'pattern',
  transform: 'pattern',
  set_groove: 'pattern',
  humanize: 'pattern',
  manage_motif: 'pattern',
  set_arrangement: 'pattern',
  set_section: 'pattern',
  set_scale: 'pattern',
  set_chord_progression: 'pattern',
  set_tension: 'pattern',

  // Parameter tools (violet)
  move: 'param',
  set_transport: 'param',
  set_track_swing: 'param',

  // Surface / view / identity tools (teal)
  set_surface: 'surface',
  manage_view: 'surface',
  pin_control: 'surface',
  label_axes: 'surface',
  set_track_meta: 'surface',
  set_track_identity: 'surface',

  // Other / meta — explicitly listed so additions are conscious
  listen: 'other',
  render: 'other',
  analyze: 'other',
  raise_decision: 'other',
  report_bug: 'other',
  suggest_reactions: 'other',
  save_memory: 'other',
  forget_memory: 'other',
};

export interface ToolColors {
  /** Tailwind border-l class, e.g. "border-l-amber-400" */
  border: string;
  /** Tailwind background tint class, e.g. "bg-amber-400/5" */
  bg: string;
  /** Tailwind text accent class for checkmarks / icons */
  accent: string;
}

const CATEGORY_COLORS: Record<ToolCategory, ToolColors> = {
  source:    { border: 'border-l-amber-400',   bg: 'bg-amber-400/5',   accent: 'text-amber-400' },
  processor: { border: 'border-l-sky-400',     bg: 'bg-sky-400/5',     accent: 'text-sky-400' },
  pattern:   { border: 'border-l-emerald-400', bg: 'bg-emerald-400/5', accent: 'text-emerald-400' },
  param:     { border: 'border-l-violet-400',  bg: 'bg-violet-400/5',  accent: 'text-violet-400' },
  surface:   { border: 'border-l-teal-400',    bg: 'bg-teal-400/5',    accent: 'text-teal-400' },
  other:     { border: 'border-l-zinc-500',    bg: 'bg-zinc-500/5',    accent: 'text-zinc-500' },
};

/** Return the category for a tool name, defaulting to 'other'. */
export function getToolCategory(toolName: string): ToolCategory {
  return TOOL_CATEGORIES[toolName] ?? 'other';
}

/** Return Tailwind color classes for a tool name. */
export function getToolColor(toolName: string): ToolColors {
  return CATEGORY_COLORS[getToolCategory(toolName)];
}
