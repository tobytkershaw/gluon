import type { ActionLogEntry } from '../engine/types';

interface Props {
  entry: ActionLogEntry;
}

export function ActionDiffView({ entry }: Props) {
  const { diff } = entry;

  // Bug reports get a distinctive amber visual treatment
  if (entry.kind === 'bug-report') {
    return (
      <div className="flex items-baseline gap-1.5 text-[10px] font-mono rounded px-1.5 py-0.5 bg-amber-900/20 border border-amber-800/30">
        <span className="text-amber-500/80">BUG</span>
        <span className="text-amber-300/70">{entry.description}</span>
      </div>
    );
  }

  if (!diff) {
    // Fallback: plain description text (pre-diff entries or say actions)
    return (
      <div className="flex items-baseline gap-1.5 text-[10px] font-mono">
        <span className="text-teal-500/50">{entry.trackLabel}</span>
        <span className="text-zinc-600">{entry.description}</span>
      </div>
    );
  }

  switch (diff.kind) {
    case 'param-change':
      return (
        <div className="flex items-baseline gap-1.5 text-[10px] font-mono">
          <span className="text-teal-500/50">{entry.trackLabel}</span>
          <span className="text-zinc-500">{diff.controlId}</span>
          <span className="text-zinc-600">{diff.from.toFixed(2)}</span>
          <span className="text-zinc-600">&rarr;</span>
          <span className="text-teal-400/80">{diff.to.toFixed(2)}</span>
        </div>
      );

    case 'model-change':
      return (
        <div className="flex items-baseline gap-1.5 text-[10px] font-mono">
          <span className="text-teal-500/50">{entry.trackLabel}</span>
          <span className="inline-flex items-center px-1 rounded bg-zinc-700/50 text-zinc-400">{diff.from}</span>
          <span className="text-zinc-600">&rarr;</span>
          <span className="inline-flex items-center px-1 rounded bg-teal-900/40 text-teal-400/90">{diff.to}</span>
        </div>
      );

    case 'processor-add':
      return (
        <div className="flex items-baseline gap-1.5 text-[10px] font-mono">
          <span className="text-teal-500/50">{entry.trackLabel}</span>
          <span className="text-emerald-500/70">+</span>
          <span className="text-zinc-400">{diff.processorType}</span>
        </div>
      );

    case 'processor-remove':
      return (
        <div className="flex items-baseline gap-1.5 text-[10px] font-mono">
          <span className="text-teal-500/50">{entry.trackLabel}</span>
          <span className="text-red-500/70">&minus;</span>
          <span className="text-zinc-500">{diff.processorType}</span>
        </div>
      );

    case 'processor-replace':
      return (
        <div className="flex items-baseline gap-1.5 text-[10px] font-mono">
          <span className="text-teal-500/50">{entry.trackLabel}</span>
          <span className="inline-flex items-center px-1 rounded bg-zinc-700/50 text-zinc-500">{diff.fromType}</span>
          <span className="text-zinc-600">&rarr;</span>
          <span className="inline-flex items-center px-1 rounded bg-teal-900/40 text-teal-400/90">{diff.toType}</span>
        </div>
      );

    case 'pattern-change':
      return (
        <div className="flex items-baseline gap-1.5 text-[10px] font-mono">
          <span className="text-teal-500/50">{entry.trackLabel}</span>
          <span className="text-zinc-500">pattern</span>
          <span className="inline-flex items-center px-1 rounded bg-zinc-700/50 text-zinc-400">
            {diff.eventsBefore} events
          </span>
          <span className="text-zinc-600">&rarr;</span>
          <span className="inline-flex items-center px-1 rounded bg-teal-900/40 text-teal-400/90">
            {diff.eventsAfter} events
          </span>
        </div>
      );

    case 'transport-change':
      return (
        <div className="flex items-baseline gap-1.5 text-[10px] font-mono">
          <span className="text-teal-500/50">{entry.trackLabel}</span>
          <span className="text-zinc-500">{diff.field}</span>
          <span className="text-zinc-600">{diff.from}</span>
          <span className="text-zinc-600">&rarr;</span>
          <span className="text-teal-400/80">{diff.to}</span>
        </div>
      );

    case 'master-change':
      return (
        <div className="flex items-baseline gap-1.5 text-[10px] font-mono">
          <span className="text-teal-500/50">MASTER</span>
          <span className="text-zinc-500">{diff.field}</span>
          <span className="text-zinc-600">{diff.from.toFixed(2)}</span>
          <span className="text-zinc-600">&rarr;</span>
          <span className="text-teal-400/80">{diff.to.toFixed(2)}</span>
        </div>
      );

    case 'modulator-add':
      return (
        <div className="flex items-baseline gap-1.5 text-[10px] font-mono">
          <span className="text-teal-500/50">{entry.trackLabel}</span>
          <span className="text-emerald-500/70">+</span>
          <span className="text-zinc-400">{diff.modulatorType}</span>
          <span className="text-zinc-600">mod</span>
        </div>
      );

    case 'modulator-remove':
      return (
        <div className="flex items-baseline gap-1.5 text-[10px] font-mono">
          <span className="text-teal-500/50">{entry.trackLabel}</span>
          <span className="text-red-500/70">&minus;</span>
          <span className="text-zinc-500">{diff.modulatorType}</span>
          <span className="text-zinc-600">mod</span>
        </div>
      );

    case 'modulation-connect':
      return (
        <div className="flex items-baseline gap-1.5 text-[10px] font-mono">
          <span className="text-teal-500/50">{entry.trackLabel}</span>
          <span className="text-zinc-500">{diff.modulatorId}</span>
          <span className="text-teal-600/70">&rarr;</span>
          <span className="text-zinc-400">{diff.target}</span>
          <span className="text-teal-400/80">({diff.depth.toFixed(2)})</span>
        </div>
      );

    case 'modulation-disconnect':
      return (
        <div className="flex items-baseline gap-1.5 text-[10px] font-mono">
          <span className="text-teal-500/50">{entry.trackLabel}</span>
          <span className="text-red-500/70">&times;</span>
          <span className="text-zinc-500">{diff.target}</span>
        </div>
      );

    case 'transform':
      return (
        <div className="flex items-baseline gap-1.5 text-[10px] font-mono">
          <span className="text-teal-500/50">{entry.trackLabel}</span>
          <span className="inline-flex items-center px-1 rounded bg-zinc-700/50 text-zinc-400">{diff.operation}</span>
          <span className="text-zinc-500">{diff.description}</span>
        </div>
      );

    case 'surface-set':
      return (
        <div className="flex items-baseline gap-1.5 text-[10px] font-mono">
          <span className="text-teal-500/50">{entry.trackLabel}</span>
          <span className="text-zinc-500">surface</span>
          <span className="inline-flex items-center px-1 rounded bg-zinc-700/50 text-zinc-400">
            {diff.controlCount} controls
          </span>
          <span className="text-zinc-500">{diff.description}</span>
        </div>
      );

    case 'surface-pin':
      return (
        <div className="flex items-baseline gap-1.5 text-[10px] font-mono">
          <span className="text-teal-500/50">{entry.trackLabel}</span>
          <span className="text-emerald-500/70">pin</span>
          <span className="text-zinc-400">{diff.moduleId}:{diff.controlId}</span>
        </div>
      );

    case 'surface-unpin':
      return (
        <div className="flex items-baseline gap-1.5 text-[10px] font-mono">
          <span className="text-teal-500/50">{entry.trackLabel}</span>
          <span className="text-red-500/70">unpin</span>
          <span className="text-zinc-500">{diff.moduleId}:{diff.controlId}</span>
        </div>
      );

    case 'surface-label-axes':
      return (
        <div className="flex items-baseline gap-1.5 text-[10px] font-mono">
          <span className="text-teal-500/50">{entry.trackLabel}</span>
          <span className="text-zinc-500">axes</span>
          <span className="text-zinc-400">{diff.x}</span>
          <span className="text-zinc-600">&times;</span>
          <span className="text-zinc-400">{diff.y}</span>
        </div>
      );

    default:
      // Exhaustive fallback
      return (
        <div className="flex items-baseline gap-1.5 text-[10px] font-mono">
          <span className="text-teal-500/50">{entry.trackLabel}</span>
          <span className="text-zinc-600">{entry.description}</span>
        </div>
      );
  }
}
