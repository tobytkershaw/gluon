import { useState } from 'react';
import type { ToolCallEntry } from '../engine/types';
import { getToolColor } from './tool-colors';

/** Map raw tool names to short, human-friendly labels. */
const FRIENDLY_NAMES: Record<string, string> = {
  move: 'Adjusted parameter',
  sketch: 'Wrote pattern',
  transform: 'Transformed pattern',
  listen: 'Listened to audio',
  render: 'Rendered audio',
  analyze: 'Analyzed audio',
  set_transport: 'Changed transport',
  set_model: 'Switched model',
  manage_processor: 'Managed processor',
  manage_modulator: 'Managed modulator',
  modulation_route: 'Routed modulation',
  manage_view: 'Managed view',
  set_surface: 'Configured surface',
  pin_control: 'Pinned control',
  label_axes: 'Labeled axes',
  set_track_meta: 'Set track metadata',
  raise_decision: 'Raised decision',
  report_bug: 'Reported bug',
};

function friendlyName(toolName: string): string {
  return FRIENDLY_NAMES[toolName] ?? toolName;
}

/** Compact summary of tool call args — pick the most informative fields. */
function argsSummary(name: string, args: Record<string, unknown>): string | null {
  switch (name) {
    case 'move': {
      const parts: string[] = [];
      if (args.param) parts.push(String(args.param));
      if (args.trackId) parts.push(String(args.trackId));
      return parts.length > 0 ? parts.join(' on ') : null;
    }
    case 'sketch':
      return args.description ? String(args.description) : null;
    case 'transform':
      return args.operation ? String(args.operation) : null;
    case 'listen':
      return args.question ? String(args.question) : null;
    case 'render':
      return args.scope ? `scope: ${JSON.stringify(args.scope)}` : null;
    case 'analyze':
      return Array.isArray(args.types) ? (args.types as string[]).join(', ') : null;
    case 'set_transport': {
      const parts: string[] = [];
      if (args.bpm !== undefined) parts.push(`${args.bpm} bpm`);
      if (args.swing !== undefined) parts.push(`swing ${args.swing}`);
      return parts.length > 0 ? parts.join(', ') : null;
    }
    case 'set_model':
      return args.model ? String(args.model) : null;
    case 'manage_processor':
    case 'manage_modulator':
      return args.description ? String(args.description) : null;
    default:
      return args.description ? String(args.description) : null;
  }
}

/** Tool names that are promoted to first-class listen events in the chat.
 *  Only 'listen' produces ListenEvent cards — render/analyze don't, so keep them visible. */
const LISTEN_TOOL_NAMES = new Set(['listen']);

/** Tool names that are UI scaffolding and should not appear in the tool call log. */
const HIDDEN_TOOLS = new Set(['suggest_reactions']);

/** Flatten tool args into presentable key/value pairs, skipping very large values. */
function flattenArgs(args: Record<string, unknown>): Array<{ key: string; value: string }> {
  const pairs: Array<{ key: string; value: string }> = [];
  for (const [key, val] of Object.entries(args)) {
    if (val === undefined || val === null) continue;
    const str = typeof val === 'string' ? val : JSON.stringify(val);
    // Skip very long values (e.g. full event arrays) to keep detail section scannable
    if (str.length > 120) {
      pairs.push({ key, value: str.slice(0, 117) + '...' });
    } else {
      pairs.push({ key, value: str });
    }
  }
  return pairs;
}

interface Props {
  toolCalls: ToolCallEntry[];
  /** When true, listen calls are filtered out (promoted to ListenEventView). */
  hasListenEvents?: boolean;
}

export function ToolCallsView({ toolCalls, hasListenEvents = false }: Props) {
  // Filter out UI scaffolding tools and promoted listen tools
  const visible = toolCalls.filter(tc =>
    !HIDDEN_TOOLS.has(tc.name) &&
    !(hasListenEvents && LISTEN_TOOL_NAMES.has(tc.name))
  );
  if (visible.length === 0) return null;

  // Group consecutive calls of the same tool
  const grouped: { name: string; count: number; args: Record<string, unknown> }[] = [];
  for (const tc of visible) {
    const last = grouped[grouped.length - 1];
    if (last && last.name === tc.name) {
      last.count++;
    } else {
      grouped.push({ name: tc.name, count: 1, args: tc.args });
    }
  }

  return (
    <div className="mt-1.5 space-y-0.5">
      {grouped.map((g, i) => (
        <ToolBlock key={i} name={g.name} count={g.count} args={g.args} />
      ))}
    </div>
  );
}

function ToolBlock({ name, count, args }: { name: string; count: number; args: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const colors = getToolColor(name);
  const summary = argsSummary(name, args);
  const details = flattenArgs(args);

  return (
    <div
      className={`border-l-4 rounded ${colors.border} ${colors.bg} font-mono text-[11px] overflow-hidden`}
    >
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="group flex items-center gap-1.5 w-full px-2 py-1 text-left cursor-pointer hover:bg-white/[0.02] transition-colors"
      >
        {/* Chevron */}
        <span
          className="inline-block text-zinc-600 transition-transform duration-150 text-[9px] w-3 text-center flex-shrink-0"
          style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          &#9656;
        </span>

        {/* Summary text */}
        <span className="text-zinc-400 truncate flex-1 min-w-0">
          {friendlyName(name)}
          {count > 1 && (
            <span className="text-zinc-600 ml-1">&times;{count}</span>
          )}
          {summary && (
            <span className="text-zinc-600 ml-1.5">&mdash; {summary}</span>
          )}
        </span>

        {/* Checkmark */}
        <span className={`${colors.accent} text-[10px] flex-shrink-0`}>&#10003;</span>

        {/* Undo button — visible on hover */}
        <span className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-zinc-400 text-[9px] border border-transparent group-hover:border-zinc-700 rounded px-1 transition-all flex-shrink-0">
          undo
        </span>
      </button>

      {/* Detail — expanded */}
      {expanded && details.length > 0 && (
        <div className="border-t border-white/[0.04] px-2 py-1.5 space-y-0.5">
          {details.map((d, i) => (
            <div key={i} className="flex gap-2">
              <span className="text-zinc-600 min-w-[60px] flex-shrink-0">{d.key}</span>
              <span className="text-zinc-400 truncate">{d.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
