import { useState } from 'react';
import type { ToolCallEntry } from '../engine/types';

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
      if (args.playing !== undefined) parts.push(args.playing ? 'play' : 'stop');
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

interface Props {
  toolCalls: ToolCallEntry[];
}

export function ToolCallsView({ toolCalls }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (toolCalls.length === 0) return null;

  // Group consecutive calls of the same tool
  const grouped: { name: string; count: number; args: Record<string, unknown> }[] = [];
  for (const tc of toolCalls) {
    const last = grouped[grouped.length - 1];
    if (last && last.name === tc.name) {
      last.count++;
    } else {
      grouped.push({ name: tc.name, count: 1, args: tc.args });
    }
  }

  return (
    <div className="mt-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[9px] font-mono text-zinc-600 hover:text-zinc-500 transition-colors"
      >
        <span
          className="inline-block transition-transform duration-150"
          style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          &#9656;
        </span>
        <span>
          {toolCalls.length} tool call{toolCalls.length !== 1 ? 's' : ''}
        </span>
      </button>

      {expanded && (
        <div className="mt-1 ml-2.5 space-y-px">
          {grouped.map((g, i) => {
            const summary = argsSummary(g.name, g.args);
            return (
              <div key={i} className="flex items-baseline gap-1.5 text-[9px] font-mono">
                <span className="text-zinc-500">{friendlyName(g.name)}</span>
                {g.count > 1 && (
                  <span className="text-zinc-600">&times;{g.count}</span>
                )}
                {summary && (
                  <span className="text-zinc-600 truncate max-w-[180px]">{summary}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
