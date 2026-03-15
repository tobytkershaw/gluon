// src/ui/PatchView.tsx
// Ground-truth node graph for signal chain and modulation routing (#158)

import type { Session, Track, ModulationRouting } from '../engine/types';
import { getActiveTrack } from '../engine/types';
import { getModelName, getProcessorInstrument, getModulatorInstrument } from '../audio/instrument-registry';
import { getTrackLabel } from '../engine/track-labels';
import { DraggableNumber } from './DraggableNumber';

// --- Layout constants ---

const NODE_W = 148;
const NODE_H = 56;
const NODE_GAP = 72;
const PAD_X = 40;
const PAD_Y = 32;
const AUDIO_ROW_Y = PAD_Y;
const MOD_ROW_Y = AUDIO_ROW_Y + NODE_H + 100;
const OUTPUT_R = 10;

// --- Helpers ---

interface NodePos {
  id: string;
  x: number;
  y: number;
  label: string;
  sublabel: string;
  kind: 'source' | 'processor' | 'modulator' | 'output';
}

function layoutNodes(track: Track): NodePos[] {
  const nodes: NodePos[] = [];
  let x = PAD_X;

  // Source node
  const engineLabel = getModelName(track.model);
  nodes.push({
    id: 'source',
    x,
    y: AUDIO_ROW_Y,
    label: engineLabel,
    sublabel: 'Source',
    kind: 'source',
  });
  x += NODE_W + NODE_GAP;

  // Processor nodes
  for (const proc of track.processors ?? []) {
    const inst = getProcessorInstrument(proc.type);
    const label = inst?.label ?? proc.type;
    const mode = inst?.engines[proc.model]?.label;
    nodes.push({
      id: proc.id,
      x,
      y: AUDIO_ROW_Y,
      label,
      sublabel: mode ?? '',
      kind: 'processor',
    });
    x += NODE_W + NODE_GAP;
  }

  // Output terminal
  nodes.push({
    id: 'output',
    x,
    y: AUDIO_ROW_Y,
    label: 'Out',
    sublabel: '',
    kind: 'output',
  });

  // Modulator nodes — spread horizontally, centered under audio chain
  const mods = track.modulators ?? [];
  if (mods.length > 0) {
    const audioChainWidth = x - PAD_X + OUTPUT_R * 2;
    const modTotalWidth = mods.length * NODE_W + (mods.length - 1) * NODE_GAP;
    const modStartX = PAD_X + Math.max(0, (audioChainWidth - modTotalWidth) / 2);

    for (let i = 0; i < mods.length; i++) {
      const mod = mods[i];
      const inst = getModulatorInstrument(mod.type);
      const label = inst?.label ?? mod.type;
      const mode = inst?.engines[mod.model]?.label;
      nodes.push({
        id: mod.id,
        x: modStartX + i * (NODE_W + NODE_GAP),
        y: MOD_ROW_Y,
        label,
        sublabel: mode ?? '',
        kind: 'modulator',
      });
    }
  }

  return nodes;
}

// Border color per node kind
function accentColor(kind: NodePos['kind']): string {
  switch (kind) {
    case 'source': return 'border-l-amber-500';
    case 'processor': return 'border-l-violet-500';
    case 'modulator': return 'border-l-cyan-500';
    default: return '';
  }
}

// --- Edge helpers ---

interface AudioEdge {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

interface ModEdge {
  routeId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  depth: number;
  targetParam: string;
}

function buildAudioEdges(nodes: NodePos[]): AudioEdge[] {
  const audioNodes = nodes.filter(n => n.kind === 'source' || n.kind === 'processor' || n.kind === 'output');
  audioNodes.sort((a, b) => a.x - b.x);

  const edges: AudioEdge[] = [];
  for (let i = 0; i < audioNodes.length - 1; i++) {
    const from = audioNodes[i];
    const to = audioNodes[i + 1];
    const fromX = from.kind === 'output' ? from.x + OUTPUT_R : from.x + NODE_W;
    const fromY = from.y + NODE_H / 2;
    const toX = to.kind === 'output' ? to.x + OUTPUT_R : to.x;
    const toY = to.y + NODE_H / 2;
    edges.push({ fromX, fromY, toX, toY });
  }
  return edges;
}

function buildModEdges(nodes: NodePos[], modulations: ModulationRouting[]): ModEdge[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const edges: ModEdge[] = [];

  for (const route of modulations) {
    const modNode = nodeMap.get(route.modulatorId);
    if (!modNode) continue;

    let targetNode: NodePos | undefined;
    let targetParam: string;

    if (route.target.kind === 'source') {
      targetNode = nodeMap.get('source');
      targetParam = route.target.param;
    } else {
      targetNode = nodeMap.get(route.target.processorId);
      targetParam = route.target.param;
    }
    if (!targetNode) continue;

    edges.push({
      routeId: route.id,
      fromX: modNode.x + NODE_W / 2,
      fromY: modNode.y,
      toX: targetNode.x + NODE_W / 2,
      toY: targetNode.y + NODE_H,
      depth: route.depth,
      targetParam,
    });
  }
  return edges;
}

// --- Components ---

function NodeCard({ node }: { node: NodePos }) {
  if (node.kind === 'output') {
    return (
      <div
        className="absolute flex items-center justify-center"
        style={{
          left: node.x,
          top: node.y + NODE_H / 2 - OUTPUT_R,
          width: OUTPUT_R * 2,
          height: OUTPUT_R * 2,
        }}
      >
        <div className="w-5 h-5 rounded-full bg-zinc-700 border border-zinc-500" />
      </div>
    );
  }

  return (
    <div
      className={`absolute rounded-md border border-zinc-700 border-l-2 bg-zinc-800 px-3 py-2 select-none ${accentColor(node.kind)}`}
      style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
    >
      <div className="text-[11px] font-medium text-zinc-200 truncate leading-tight">
        {node.label}
      </div>
      {node.sublabel && (
        <div className="text-[10px] text-zinc-500 truncate leading-tight mt-0.5">
          {node.sublabel}
        </div>
      )}
    </div>
  );
}

function AudioEdgeSvg({ edge }: { edge: AudioEdge }) {
  return (
    <line
      x1={edge.fromX}
      y1={edge.fromY}
      x2={edge.toX}
      y2={edge.toY}
      stroke="#52525b"
      strokeWidth={1.5}
    />
  );
}

function ModEdgeSvg({ edge }: { edge: ModEdge }) {
  const midX = (edge.fromX + edge.toX) / 2;
  const midY = (edge.fromY + edge.toY) / 2;

  return (
    <g>
      <line
        x1={edge.fromX}
        y1={edge.fromY}
        x2={edge.toX}
        y2={edge.toY}
        stroke="#22d3ee"
        strokeWidth={1}
        strokeDasharray="4 3"
        opacity={0.7}
      />
      <text
        x={midX + 6}
        y={midY + 11}
        fill="#a1a1aa"
        fontSize={8}
        opacity={0.6}
        dominantBaseline="middle"
      >
        {edge.targetParam}
      </text>
    </g>
  );
}

/** HTML overlay for an interactive depth label on a modulation edge */
function ModDepthOverlay({ edge, onDepthChange, onDepthCommit }: {
  edge: ModEdge;
  onDepthChange: (modulationId: string, depth: number) => void;
  onDepthCommit?: (modulationId: string, depth: number) => void;
}) {
  const midX = (edge.fromX + edge.toX) / 2;
  const midY = (edge.fromY + edge.toY) / 2;

  return (
    <div
      className="absolute"
      style={{ left: midX + 6, top: midY - 7 }}
    >
      <DraggableNumber
        value={edge.depth}
        min={-1}
        max={1}
        step={0.01}
        decimals={2}
        className="text-[9px] text-cyan-300/80 hover:text-cyan-200"
        onChange={(v) => onDepthChange(edge.routeId, v)}
        onCommit={onDepthCommit ? (v) => onDepthCommit(edge.routeId, v) : undefined}
      />
    </div>
  );
}

// --- Empty state ---

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center text-zinc-500">
      <div className="text-center">
        <div className="text-[11px] font-mono uppercase tracking-wider mb-1">Patch</div>
        <div className="text-[10px]">No tracks in session</div>
      </div>
    </div>
  );
}

// --- Main component ---

interface Props {
  session: Session;
  onModulationDepthChange?: (modulationId: string, depth: number) => void;
  onModulationDepthCommit?: (modulationId: string, depth: number) => void;
}

export function PatchView({ session, onModulationDepthChange, onModulationDepthCommit }: Props) {
  if (session.tracks.length === 0) return <EmptyState />;

  const track = getActiveTrack(session);
  const nodes = layoutNodes(track);
  const audioEdges = buildAudioEdges(nodes);
  const modEdges = buildModEdges(nodes, track.modulations ?? []);

  // Compute SVG canvas size from node positions
  const maxX = Math.max(...nodes.map(n => n.x + (n.kind === 'output' ? OUTPUT_R * 2 : NODE_W))) + PAD_X;
  const maxY = Math.max(...nodes.map(n => n.y + (n.kind === 'output' ? OUTPUT_R * 2 : NODE_H))) + PAD_Y;

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Track header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-2">
        <span className="text-[11px] font-medium tracking-wider uppercase text-zinc-300">
          {getTrackLabel(track)}
        </span>
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Patch</span>
      </div>

      {/* Graph area */}
      <div className="flex-1 min-h-0 overflow-auto p-4">
        <div className="relative" style={{ width: maxX, height: maxY }}>
          {/* SVG edge layer */}
          <svg
            className="absolute inset-0 pointer-events-none"
            width={maxX}
            height={maxY}
          >
            {audioEdges.map((e, i) => (
              <AudioEdgeSvg key={`audio-${i}`} edge={e} />
            ))}
            {modEdges.map((e, i) => (
              <ModEdgeSvg key={`mod-${i}`} edge={e} />
            ))}
          </svg>

          {/* Node layer */}
          {nodes.map(n => (
            <NodeCard key={n.id} node={n} />
          ))}

          {/* Modulation depth overlays (interactive HTML on top of SVG edges) */}
          {onModulationDepthChange && modEdges.map(e => (
            <ModDepthOverlay
              key={`depth-${e.routeId}`}
              edge={e}
              onDepthChange={onModulationDepthChange}
              onDepthCommit={onModulationDepthCommit}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
