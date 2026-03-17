// src/ui/PatchView.tsx
// Per-track node graph for signal chain and modulation routing (#158)
// Scope: source -> processors -> output, plus modulation connections and send topology.
// Port rendering from hardware I/O registry (#394)

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { Session, Track, ModulationRouting, ModulationTarget } from '../engine/types';
import { getActiveTrack, getBusTracks } from '../engine/types';
import { getModelName, getProcessorInstrument, getModulatorInstrument, getProcessorControlIds } from '../audio/instrument-registry';
import { getModulePortDef, getSourceModTargets } from '../audio/port-registry';
import type { PortDef, PortSignalType } from '../audio/port-registry';
import { getTrackLabel } from '../engine/track-labels';
import { DraggableNumber } from './DraggableNumber';
import { ModuleBrowser } from './ModuleBrowser';

// --- Layout constants ---

const NODE_W = 168;
const NODE_HEADER_H = 36;  // title + sublabel area
const PORT_ROW_H = 14;     // height per port row
const PORT_MIN_ROWS = 2;   // minimum port rows even when fewer ports
const NODE_GAP = 80;
const PAD_X = 40;
const PAD_Y = 32;
const AUDIO_ROW_Y = PAD_Y;
const OUTPUT_R = 18;
const PORT_CIRCLE_R = 4;   // radius of port circles

// --- Pan/Zoom constants ---
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const ZOOM_SENSITIVITY = 0.002;
const FIT_PADDING = 40;

/** Compute the node height based on its port count */
function nodeHeight(inputCount: number, outputCount: number): number {
  const rows = Math.max(inputCount, outputCount, PORT_MIN_ROWS);
  return NODE_HEADER_H + rows * PORT_ROW_H + 8; // 8px bottom padding
}

/** Fallback height when no port definitions are available */
const NODE_H_FALLBACK = NODE_HEADER_H + PORT_MIN_ROWS * PORT_ROW_H + 8;
/** Compact height for the output terminal node (no ports, just header) */
const OUTPUT_NODE_H = NODE_HEADER_H + 8;

// --- Port signal type colors ---

function portSignalColor(signal: PortSignalType): string {
  switch (signal) {
    case 'audio': return 'bg-amber-400/80 border-amber-300';
    case 'cv':    return 'bg-emerald-400/60 border-emerald-300';
    case 'gate':  return 'bg-rose-400/60 border-rose-300';
  }
}

function portSignalStroke(signal: PortSignalType): string {
  switch (signal) {
    case 'audio': return '#fbbf24';  // amber-400
    case 'cv':    return '#34d399';  // emerald-400
    case 'gate':  return '#fb7185';  // rose-400
  }
}

function portSignalLabelColor(signal: PortSignalType): string {
  switch (signal) {
    case 'audio': return 'text-amber-300';
    case 'cv':    return 'text-emerald-300';
    case 'gate':  return 'text-rose-300';
  }
}

// --- Helpers ---

interface NodePos {
  id: string;
  x: number;
  y: number;
  label: string;
  sublabel: string;
  kind: 'source' | 'processor' | 'modulator' | 'output' | 'send-dest';
  /** Adapter ID for port registry lookup */
  adapterId?: string;
  /** Computed node height (varies per module based on port count) */
  h: number;
  /** Resolved input ports with positions */
  inputPorts: ResolvedPort[];
  /** Resolved output ports with positions */
  outputPorts: ResolvedPort[];
  /** Whether this processor is bypassed (disabled). */
  bypassed?: boolean;
}

/** A port definition with computed position relative to the node */
interface ResolvedPort {
  def: PortDef;
  /** Y offset from node top */
  yOffset: number;
}

/** Per-node port metadata for modulation targets */
interface PortInfo {
  nodeId: string;
  paramId: string;
  paramLabel: string;
  x: number;
  y: number;
  /** The ModulationTarget to pass when creating a route */
  target: ModulationTarget;
}

/** Resolve input/output ports and compute their Y offsets within the node */
function resolveNodePorts(adapterId: string | undefined): {
  inputPorts: ResolvedPort[];
  outputPorts: ResolvedPort[];
} {
  if (!adapterId) return { inputPorts: [], outputPorts: [] };
  const portDef = getModulePortDef(adapterId);
  if (!portDef) return { inputPorts: [], outputPorts: [] };

  const inputPorts = portDef.inputs.map((def, i) => ({
    def,
    yOffset: NODE_HEADER_H + i * PORT_ROW_H + PORT_ROW_H / 2,
  }));
  const outputPorts = portDef.outputs.map((def, i) => ({
    def,
    yOffset: NODE_HEADER_H + i * PORT_ROW_H + PORT_ROW_H / 2,
  }));
  return { inputPorts, outputPorts };
}

function layoutNodes(track: Track): NodePos[] {
  const nodes: NodePos[] = [];
  let x = PAD_X;

  // Source node
  const engineLabel = getModelName(track.model);
  const sourceAdapterId = 'plaits';
  const sourcePorts = resolveNodePorts(sourceAdapterId);
  const sourceH = nodeHeight(sourcePorts.inputPorts.length, sourcePorts.outputPorts.length);
  nodes.push({
    id: 'source',
    x,
    y: AUDIO_ROW_Y,
    label: engineLabel,
    sublabel: 'Source',
    kind: 'source',
    adapterId: sourceAdapterId,
    h: sourceH,
    ...sourcePorts,
  });
  x += NODE_W + NODE_GAP;

  // Processor nodes
  for (const proc of track.processors ?? []) {
    const inst = getProcessorInstrument(proc.type);
    const label = inst?.label ?? proc.type;
    const mode = inst?.engines[proc.model]?.label;
    const procAdapterId = inst?.adapterId ?? proc.type;
    const procPorts = resolveNodePorts(procAdapterId);
    const procH = nodeHeight(procPorts.inputPorts.length, procPorts.outputPorts.length);
    nodes.push({
      id: proc.id,
      x,
      y: AUDIO_ROW_Y,
      label,
      sublabel: mode ?? '',
      kind: 'processor',
      adapterId: procAdapterId,
      h: procH,
      ...procPorts,
      bypassed: proc.enabled === false,
    });
    x += NODE_W + NODE_GAP;
  }

  // Output terminal — compact height, no ports
  nodes.push({
    id: 'output',
    x,
    y: AUDIO_ROW_Y,
    label: 'Output',
    sublabel: '',
    kind: 'output',
    h: OUTPUT_NODE_H,
    inputPorts: [],
    outputPorts: [],
  });

  // Modulator nodes — spread horizontally, centered under audio chain
  const mods = track.modulators ?? [];
  const maxAudioH = Math.max(...nodes.filter(n => n.kind !== 'output').map(n => n.h), NODE_H_FALLBACK);
  const modRowY = AUDIO_ROW_Y + maxAudioH + 100;

  if (mods.length > 0) {
    const audioChainWidth = x - PAD_X + OUTPUT_R * 2;
    const modTotalWidth = mods.length * NODE_W + (mods.length - 1) * NODE_GAP;
    const modStartX = PAD_X + Math.max(0, (audioChainWidth - modTotalWidth) / 2);

    for (let i = 0; i < mods.length; i++) {
      const mod = mods[i];
      const modInst = getModulatorInstrument(mod.type);
      const label = modInst?.label ?? mod.type;
      const mode = modInst?.engines[mod.model]?.label;
      const modAdapterId = modInst?.adapterId ?? mod.type;
      const modPorts = resolveNodePorts(modAdapterId);
      const modH = nodeHeight(modPorts.inputPorts.length, modPorts.outputPorts.length);
      nodes.push({
        id: mod.id,
        x: modStartX + i * (NODE_W + NODE_GAP),
        y: modRowY,
        label,
        sublabel: mode ?? '',
        kind: 'modulator',
        adapterId: modAdapterId,
        h: modH,
        ...modPorts,
      });
    }
  }

  return nodes;
}

/** Compute modulation target ports for all audio nodes */
function computeTargetPorts(nodes: NodePos[], track: Track): PortInfo[] {
  const ports: PortInfo[] = [];
  for (const node of nodes) {
    if (node.kind === 'source') {
      const params = getSourceModTargets();
      const spacing = NODE_W / (params.length + 1);
      params.forEach((p, i) => {
        ports.push({
          nodeId: node.id,
          paramId: p,
          paramLabel: p.slice(0, 4),
          x: node.x + spacing * (i + 1),
          y: node.y + node.h,
          target: { kind: 'source', param: p },
        });
      });
    } else if (node.kind === 'processor') {
      const proc = (track.processors ?? []).find(pr => pr.id === node.id);
      if (proc) {
        const controlIds = getProcessorControlIds(proc.type);
        const spacing = NODE_W / (controlIds.length + 1);
        controlIds.forEach((c, i) => {
          ports.push({
            nodeId: node.id,
            paramId: c,
            paramLabel: c.slice(0, 4),
            x: node.x + spacing * (i + 1),
            y: node.y + node.h,
            target: { kind: 'processor', processorId: proc.id, param: c },
          });
        });
      }
    }
  }
  return ports;
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

function selectedBorderColor(kind: NodePos['kind']): string {
  switch (kind) {
    case 'source': return 'border-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]';
    case 'processor': return 'border-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.4)]';
    case 'modulator': return 'border-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.4)]';
    default: return '';
  }
}

// --- Bezier helpers ---

/** Midpoint of a cubic bezier curve at t=0.5 */
function bezierMidpoint(
  x0: number, y0: number,
  cx0: number, cy0: number,
  cx1: number, cy1: number,
  x1: number, y1: number,
): { x: number; y: number } {
  const t = 0.5;
  const mt = 1 - t;
  const x = mt*mt*mt*x0 + 3*mt*mt*t*cx0 + 3*mt*t*t*cx1 + t*t*t*x1;
  const y = mt*mt*mt*y0 + 3*mt*mt*t*cy0 + 3*mt*t*t*cy1 + t*t*t*y1;
  return { x, y };
}

// --- Edge helpers ---

interface AudioEdge {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Stroke color derived from the output port's signal type */
  stroke: string;
}

interface ModEdge {
  routeId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
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

    // Use the first audio output port's Y position if available, else center
    const firstAudioOutput = from.outputPorts.find(p => p.def.signal === 'audio');
    const fromX = from.kind === 'output' ? from.x + OUTPUT_R : from.x + NODE_W;
    const fromY = firstAudioOutput
      ? from.y + firstAudioOutput.yOffset
      : from.y + from.h / 2;

    // Use the first audio input port's Y position if available, else center
    const firstAudioInput = to.inputPorts.find(p => p.def.signal === 'audio');
    const toX = to.kind === 'output' ? to.x + OUTPUT_R : to.x;
    const toY = firstAudioInput
      ? to.y + firstAudioInput.yOffset
      : to.y + to.h / 2;

    // Color from the source output port signal type
    const stroke = firstAudioOutput ? portSignalStroke(firstAudioOutput.def.signal) : '#52525b';
    edges.push({ fromX, fromY, toX, toY, stroke });
  }
  return edges;
}

function buildModEdges(nodes: NodePos[], modulations: ModulationRouting[], targetPorts: PortInfo[]): ModEdge[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const edges: ModEdge[] = [];

  // Track how many modulators target the same (node, param) pair for disambiguation
  const targetCounts = new Map<string, number>();
  const targetIndices = new Map<string, number>();

  for (const route of modulations) {
    const targetKey = route.target.kind === 'source'
      ? `source:${route.target.param}`
      : `${route.target.processorId}:${route.target.param}`;
    targetCounts.set(targetKey, (targetCounts.get(targetKey) ?? 0) + 1);
  }

  for (const route of modulations) {
    const modNode = nodeMap.get(route.modulatorId);
    if (!modNode) continue;

    let targetParam: string;
    let toX: number;
    let toY: number;

    // Try to find the matching target port for precise positioning
    const matchingPort = targetPorts.find(p => {
      if (route.target.kind === 'source') {
        return p.nodeId === 'source' && p.paramId === route.target.param;
      } else {
        return p.nodeId === route.target.processorId && p.paramId === route.target.param;
      }
    });

    if (matchingPort) {
      toX = matchingPort.x;
      toY = matchingPort.y;
      targetParam = route.target.param;
    } else {
      // Fallback to center of target node
      let targetNode: NodePos | undefined;
      if (route.target.kind === 'source') {
        targetNode = nodeMap.get('source');
        targetParam = route.target.param;
      } else {
        targetNode = nodeMap.get(route.target.processorId);
        targetParam = route.target.param;
      }
      if (!targetNode) continue;
      toX = targetNode.x + NODE_W / 2;
      toY = targetNode.y + targetNode.h;
    }

    const targetKey = route.target.kind === 'source'
      ? `source:${route.target.param}`
      : `${route.target.processorId}:${route.target.param}`;
    const count = targetCounts.get(targetKey) ?? 1;
    const index = targetIndices.get(targetKey) ?? 0;
    targetIndices.set(targetKey, index + 1);

    // Compute X offset for disambiguation when multiple modulators target the same param
    let xOffset = 0;
    if (count > 1) {
      xOffset = (index - (count - 1) / 2) * 10;
    }

    const fromX = modNode.x + NODE_W / 2;
    const fromY = modNode.y;

    // Vertical bezier: control points pull up from modulator and down from target
    const cx0 = fromX + xOffset;
    const cy0 = fromY - 30;
    const cx1 = toX + xOffset;
    const cy1 = toY + 30;

    edges.push({
      routeId: route.id,
      fromX,
      fromY,
      toX,
      toY,
      cx0,
      cy0,
      cx1,
      cy1,
      depth: route.depth,
      targetParam,
    });
  }
  return edges;
}

// --- Drag state ---

interface DragState {
  fromModulatorId: string;
  fromX: number;
  fromY: number;
  mouseX: number;
  mouseY: number;
}

/** Drag state for repositioning nodes */
interface NodeDragState {
  nodeId: string;
  startMouseX: number;
  startMouseY: number;
  startNodeX: number;
  startNodeY: number;
}

// --- Components ---

/** Renders input port labels and circles on the left edge of a node */
function InputPortColumn({ ports, nodeH }: { ports: ResolvedPort[]; nodeH: number }) {
  if (ports.length === 0) return null;
  return (
    <>
      {ports.map(port => (
        <div
          key={port.def.id}
          className="absolute flex items-center gap-1"
          style={{ left: -PORT_CIRCLE_R, top: port.yOffset - PORT_CIRCLE_R }}
        >
          <div
            className={`rounded-full border ${portSignalColor(port.def.signal)}`}
            style={{ width: PORT_CIRCLE_R * 2, height: PORT_CIRCLE_R * 2, flexShrink: 0 }}
          />
          <span className={`text-[9px] font-medium leading-none whitespace-nowrap ${portSignalLabelColor(port.def.signal)}`}>
            {port.def.name}
          </span>
        </div>
      ))}
    </>
  );
}

/** Renders output port labels and circles on the right edge of a node */
function OutputPortColumn({ ports, nodeW }: { ports: ResolvedPort[]; nodeW: number }) {
  if (ports.length === 0) return null;
  return (
    <>
      {ports.map(port => (
        <div
          key={port.def.id}
          className="absolute flex items-center justify-end gap-1"
          style={{ right: -PORT_CIRCLE_R, top: port.yOffset - PORT_CIRCLE_R }}
        >
          <span className={`text-[9px] font-medium leading-none whitespace-nowrap ${portSignalLabelColor(port.def.signal)}`}>
            {port.def.name}
          </span>
          <div
            className={`rounded-full border ${portSignalColor(port.def.signal)}`}
            style={{ width: PORT_CIRCLE_R * 2, height: PORT_CIRCLE_R * 2, flexShrink: 0 }}
          />
        </div>
      ))}
    </>
  );
}

function NodeCard({ node, selected, onDragStart, isDragging, onModulatorPortMouseDown, targetPorts, dragState, hoveredPortKey }: {
  node: NodePos;
  selected: boolean;
  onDragStart?: (e: React.MouseEvent, nodeId: string, nodeX: number, nodeY: number) => void;
  isDragging?: boolean;
  onModulatorPortMouseDown?: (e: React.MouseEvent, modulatorId: string, portX: number, portY: number) => void;
  targetPorts: PortInfo[];
  dragState: DragState | null;
  hoveredPortKey: string | null;
}) {
  if (node.kind === 'output') {
    return (
      <div
        className="absolute flex flex-col items-center justify-center"
        style={{
          left: node.x,
          top: node.y + node.h / 2 - OUTPUT_R,
          width: OUTPUT_R * 2,
          height: OUTPUT_R * 2,
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
          onDragStart?.(e, node.id, node.x, node.y);
        }}
      >
        {/* Input port on left side */}
        <div
          className="absolute w-3 h-3 rounded-full bg-zinc-600 border border-zinc-500"
          style={{ left: -6, top: OUTPUT_R - 6 }}
        />
        <div className={`w-8 h-8 rounded-full bg-zinc-700 border-2 ${selected ? 'border-zinc-300 shadow-[0_0_8px_rgba(161,161,170,0.4)]' : 'border-zinc-500'}`} />
        <span className="text-[9px] font-medium text-zinc-400 mt-1 whitespace-nowrap select-none">
          {node.label}
        </span>
      </div>
    );
  }

  const isAudioNode = node.kind === 'source' || node.kind === 'processor';
  const nodeTargetPorts = targetPorts.filter(p => p.nodeId === node.id);

  return (
    <div
      className={`absolute rounded-md border border-l-2 bg-zinc-800 select-none overflow-visible ${
        isDragging ? 'cursor-grabbing' : 'cursor-grab'
      } ${
        selected
          ? `${selectedBorderColor(node.kind)}`
          : `border-zinc-700 ${accentColor(node.kind)}`
      } ${node.bypassed ? 'opacity-40 border-dashed' : ''}`}
      style={{ left: node.x, top: node.y, width: NODE_W, height: node.h }}
      onMouseDown={(e) => {
        e.stopPropagation();
        onDragStart?.(e, node.id, node.x, node.y);
      }}
    >
      {/* Header area */}
      <div className="px-3 pt-2">
        <div className={`text-[11px] font-medium truncate leading-tight ${node.bypassed ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}>
          {node.label}
        </div>
        {node.sublabel && (
          <div className="text-[10px] text-zinc-500 truncate leading-tight mt-0.5">
            {node.sublabel}
          </div>
        )}
      </div>

      {/* Named I/O ports */}
      <InputPortColumn ports={node.inputPorts} nodeH={node.h} />
      <OutputPortColumn ports={node.outputPorts} nodeW={NODE_W} />

      {/* Modulator output port (top edge) */}
      {node.kind === 'modulator' && (
        <div
          className="absolute flex items-center justify-center"
          style={{ left: NODE_W / 2 - 10, top: -10 }}
        >
          {/* Visual port */}
          <div className="absolute w-3 h-3 rounded-full bg-cyan-500/50 border border-cyan-400" />
          {/* Hit area */}
          <div
            className="absolute w-5 h-5 rounded-full cursor-crosshair"
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onModulatorPortMouseDown?.(e, node.id, node.x + NODE_W / 2, node.y);
            }}
          />
        </div>
      )}

      {/* Modulation target ports (bottom edge) — only shown on audio nodes */}
      {isAudioNode && nodeTargetPorts.length > 0 && (
        <>
          {nodeTargetPorts.map(port => {
            const portKey = `${port.nodeId}:${port.paramId}`;
            const isHovered = hoveredPortKey === portKey;
            return (
              <div
                key={portKey}
                className="absolute flex flex-col items-center"
                style={{ left: port.x - node.x - 5, top: node.h - 4 }}
              >
                {/* Hit area for drop target */}
                <div
                  className="absolute w-5 h-5 rounded-full"
                  style={{ top: -4, left: 0 }}
                  data-port-key={portKey}
                />
                {/* Visual port */}
                <div
                  className={`rounded-full border transition-transform ${
                    isHovered && dragState
                      ? 'w-3 h-3 bg-cyan-400/60 border-cyan-300 scale-125'
                      : 'w-2 h-2 bg-cyan-400/30 border-cyan-400/50'
                  }`}
                  style={{ pointerEvents: 'none' }}
                />
                {/* Param label */}
                <span
                  className="text-[7px] text-cyan-400/50 mt-0.5 leading-none whitespace-nowrap"
                  style={{ pointerEvents: 'none' }}
                >
                  {port.paramLabel}
                </span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/** Detail panel shown below a selected node */
function NodeDetailPanel({ node, track }: { node: NodePos; track: Track }) {
  let params: [string, number][] = [];

  if (node.kind === 'source') {
    params = [
      ['timbre', track.params.timbre ?? 0],
      ['harmonics', track.params.harmonics ?? 0],
      ['morph', track.params.morph ?? 0],
      ['frequency', track.params.note ?? 0],
    ];
  } else if (node.kind === 'processor') {
    const proc = (track.processors ?? []).find(p => p.id === node.id);
    if (proc) {
      params = Object.entries(proc.params);
    }
  } else if (node.kind === 'modulator') {
    const mod = (track.modulators ?? []).find(m => m.id === node.id);
    if (mod) {
      params = Object.entries(mod.params);
    }
  }

  if (params.length === 0) return null;

  return (
    <div
      className="absolute bg-zinc-900/95 border border-zinc-700 rounded px-2 py-1.5 pointer-events-none"
      style={{
        left: node.x,
        top: node.y + node.h + (node.kind === 'source' || node.kind === 'processor' ? 16 : 4),
        minWidth: NODE_W,
      }}
    >
      {params.map(([name, value]) => (
        <div key={name} className="flex justify-between gap-2 text-[9px] font-mono leading-relaxed">
          <span className="text-zinc-500">{name}</span>
          <span className="text-zinc-300 tabular-nums">{value.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

function AudioEdgeSvg({ edge }: { edge: AudioEdge }) {
  const cx = (edge.fromX + edge.toX) / 2;
  return (
    <path
      d={`M ${edge.fromX} ${edge.fromY} C ${cx} ${edge.fromY}, ${cx} ${edge.toY}, ${edge.toX} ${edge.toY}`}
      stroke={edge.stroke}
      strokeWidth={1.5}
      fill="none"
      opacity={0.6}
    />
  );
}

function ModEdgeSvg({ edge, selected, onSelect }: {
  edge: ModEdge;
  selected: boolean;
  onSelect: (routeId: string) => void;
}) {
  const mid = bezierMidpoint(
    edge.fromX, edge.fromY,
    edge.cx0, edge.cy0,
    edge.cx1, edge.cy1,
    edge.toX, edge.toY,
  );
  const pathD = `M ${edge.fromX} ${edge.fromY} C ${edge.cx0} ${edge.cy0}, ${edge.cx1} ${edge.cy1}, ${edge.toX} ${edge.toY}`;

  return (
    <g>
      {/* Invisible wider stroke for hit detection — pointer-events: auto overrides parent's none */}
      <path
        d={pathD}
        stroke="transparent"
        strokeWidth={16}
        fill="none"
        style={{ cursor: 'pointer', pointerEvents: 'auto' }}
        onMouseDown={(e) => { e.stopPropagation(); onSelect(edge.routeId); }}
      />
      {/* Visible edge */}
      <path
        d={pathD}
        stroke={selected ? '#67e8f9' : '#22d3ee'}
        strokeWidth={selected ? 1.5 : 1}
        strokeDasharray="4 3"
        fill="none"
        opacity={selected ? 1 : 0.7}
        markerEnd={selected ? 'url(#mod-arrow-selected)' : 'url(#mod-arrow)'}
        style={{ pointerEvents: 'none' }}
      />
      <text
        x={mid.x + 6}
        y={mid.y + 11}
        fill="#a1a1aa"
        fontSize={8}
        opacity={0.6}
        dominantBaseline="middle"
        style={{ pointerEvents: 'none' }}
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
  const mid = bezierMidpoint(edge.fromX, edge.fromY, edge.cx0, edge.cy0, edge.cx1, edge.cy1, edge.toX, edge.toY);

  return (
    <div
      className="absolute"
      style={{ left: mid.x + 6, top: mid.y - 7 }}
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

/** SVG preview edge while dragging from modulator port */
function DragPreviewEdge({ drag }: { drag: DragState }) {
  return (
    <svg
      className="absolute inset-0"
      style={{ pointerEvents: 'none', zIndex: 50 }}
      width="100%"
      height="100%"
    >
      <line
        x1={drag.fromX}
        y1={drag.fromY}
        x2={drag.mouseX}
        y2={drag.mouseY}
        stroke="#22d3ee"
        strokeWidth={1}
        strokeDasharray="4 3"
        opacity={0.5}
      />
    </svg>
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
  onConnectModulator?: (modulatorId: string, target: ModulationTarget, depth: number) => void;
  onRemoveModulation?: (routeId: string) => void;
  onAddProcessor?: (type: string) => void;
  onAddModulator?: (type: string) => void;
  onRemoveProcessor?: (processorId: string) => void;
  onRemoveModulator?: (modulatorId: string) => void;
}

/** Convert screen (client) coordinates to canvas coordinates given pan/zoom state */
function screenToCanvas(
  clientX: number,
  clientY: number,
  containerRect: DOMRect,
  zoom: number,
  panX: number,
  panY: number,
): { x: number; y: number } {
  return {
    x: (clientX - containerRect.left - panX) / zoom,
    y: (clientY - containerRect.top - panY) / zoom,
  };
}

/** Pan/zoom state for the canvas */
interface PanZoomState {
  zoom: number;
  panX: number;
  panY: number;
}

export function PatchView({ session, onModulationDepthChange, onModulationDepthCommit, onConnectModulator, onRemoveModulation, onAddProcessor, onAddModulator, onRemoveProcessor, onRemoveModulator }: Props) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [hoveredPortKey, setHoveredPortKey] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Node position offsets (local UI state, not persisted)
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, { dx: number; dy: number }>>({});
  const [nodeDrag, setNodeDrag] = useState<NodeDragState | null>(null);

  // Pan/zoom state
  const [panZoom, setPanZoom] = useState<PanZoomState>({ zoom: 1, panX: 0, panY: 0 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const spaceHeldRef = useRef(false);

  // Clear node offsets when switching tracks — PatchView is never remounted so
  // stale offsets (especially for 'source' which always has the same id) would
  // leak between tracks.
  const prevTrackIdRef = useRef(session.activeTrackId);
  useEffect(() => {
    if (session.activeTrackId !== prevTrackIdRef.current) {
      prevTrackIdRef.current = session.activeTrackId;
      setNodeOffsets({});
      setNodeDrag(null);
    }
  });

  if (session.tracks.length === 0) return <EmptyState />;

  const track = getActiveTrack(session);
  const baseNodes = useMemo(() => layoutNodes(track), [track]);
  // Apply user-dragged position offsets
  const nodes = baseNodes.map(n => {
    const offset = nodeOffsets[n.id];
    if (!offset) return n;
    return { ...n, x: n.x + offset.dx, y: n.y + offset.dy };
  });
  const targetPorts = computeTargetPorts(nodes, track);
  const audioEdges = buildAudioEdges(nodes);
  const modEdges = buildModEdges(nodes, track.modulations ?? [], targetPorts);

  // Send destination nodes — show where this track's audio is routed
  const sends = track.sends ?? [];
  const busTracks = getBusTracks(session);
  const sendNodes = useMemo(() => {
    if (sends.length === 0) return [];
    const outputNode = nodes.find(n => n.kind === 'output');
    if (!outputNode) return [];
    const startX = outputNode.x + OUTPUT_R * 2 + NODE_GAP / 2;
    const SEND_NODE_W = 100;
    const SEND_NODE_H = NODE_HEADER_H + 8;
    return sends.map((send, i): NodePos => {
      const bus = busTracks.find(b => b.id === send.busId);
      return {
        id: `send-${send.busId}`,
        x: startX,
        y: AUDIO_ROW_Y + i * (SEND_NODE_H + 12),
        label: bus ? getTrackLabel(bus) : send.busId,
        sublabel: `${Math.round(send.level * 100)}%`,
        kind: 'send-dest',
        h: SEND_NODE_H,
        inputPorts: [],
        outputPorts: [],
      };
    });
  }, [sends, nodes, busTracks]);

  // Edges from output to send destinations
  const sendEdges = useMemo(() => {
    if (sendNodes.length === 0) return [];
    const outputNode = nodes.find(n => n.kind === 'output');
    if (!outputNode) return [];
    const outCx = outputNode.x + OUTPUT_R;
    const outCy = outputNode.y + OUTPUT_R;
    return sendNodes.map(sn => ({
      id: sn.id,
      x1: outCx,
      y1: outCy,
      x2: sn.x,
      y2: sn.y + sn.h / 2,
    }));
  }, [sendNodes, nodes]);

  // All nodes including send destinations
  const allNodes = useMemo(() => [...nodes, ...sendNodes], [nodes, sendNodes]);

  // Compute SVG canvas size from node positions — extend for detail panels and port labels
  const allNodesForSize = allNodes;
  const maxX = Math.max(...allNodesForSize.map(n => n.x + (n.kind === 'output' ? OUTPUT_R * 2 : n.kind === 'send-dest' ? 100 : NODE_W))) + PAD_X;
  const maxY = Math.max(...allNodesForSize.map(n => n.y + (n.kind === 'output' ? OUTPUT_R * 2 : n.h))) + PAD_Y + 60;

  // Bounding box for fit-to-view
  const contentBounds = useMemo(() => {
    if (allNodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    let minX = Infinity, minY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
    for (const n of allNodes) {
      const w = n.kind === 'output' ? OUTPUT_R * 2 : n.kind === 'send-dest' ? 100 : NODE_W;
      const h = n.kind === 'output' ? OUTPUT_R * 2 : n.h;
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      bMaxX = Math.max(bMaxX, n.x + w);
      bMaxY = Math.max(bMaxY, n.y + h);
    }
    return { minX, minY, maxX: bMaxX, maxY: bMaxY };
  }, [allNodes]);

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    // Middle-click, Space+click, or left-click on empty canvas starts panning
    if (e.button === 1 || e.button === 0) {
      e.preventDefault();
      isPanningRef.current = true;
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: panZoom.panX,
        panY: panZoom.panY,
      };
      // Left-click on empty canvas also deselects
      if (e.button === 0 && !spaceHeldRef.current) {
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
      }
      return;
    }
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, [panZoom.panX, panZoom.panY]);

  // Node drag start handler
  const handleNodeDragStart = useCallback((e: React.MouseEvent, nodeId: string, nodeX: number, nodeY: number) => {
    // Only left-click, and not when Space is held (that's for panning)
    if (e.button !== 0 || spaceHeldRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    if (!containerRef.current) return;
    // Clear any in-progress modulator drag to prevent both drag states being active
    setDragState(null);
    setHoveredPortKey(null);
    const rect = containerRef.current.getBoundingClientRect();
    const canvas = screenToCanvas(e.clientX, e.clientY, rect, panZoom.zoom, panZoom.panX, panZoom.panY);
    setNodeDrag({
      nodeId,
      startMouseX: canvas.x,
      startMouseY: canvas.y,
      startNodeX: nodeX,
      startNodeY: nodeY,
    });
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
  }, [panZoom]);

  const handleEdgeSelect = useCallback((routeId: string) => {
    setSelectedEdgeId(routeId);
    setSelectedNodeId(null);
  }, []);

  const handleModulatorPortMouseDown = useCallback((e: React.MouseEvent, modulatorId: string, portX: number, portY: number) => {
    setDragState({
      fromModulatorId: modulatorId,
      fromX: portX,
      fromY: portY,
      mouseX: portX,
      mouseY: portY,
    });
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Handle panning
    if (isPanningRef.current) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPanZoom(prev => ({
        ...prev,
        panX: panStartRef.current.panX + dx,
        panY: panStartRef.current.panY + dy,
      }));
      return;
    }

    // Handle node dragging
    if (nodeDrag && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const canvas = screenToCanvas(e.clientX, e.clientY, rect, panZoom.zoom, panZoom.panX, panZoom.panY);
      const dx = canvas.x - nodeDrag.startMouseX;
      const dy = canvas.y - nodeDrag.startMouseY;
      // Find the base layout position for this node
      const baseNode = baseNodes.find(n => n.id === nodeDrag.nodeId);
      if (baseNode) {
        setNodeOffsets(prev => ({
          ...prev,
          [nodeDrag.nodeId]: {
            dx: (nodeDrag.startNodeX - baseNode.x) + dx,
            dy: (nodeDrag.startNodeY - baseNode.y) + dy,
          },
        }));
      }
      return;
    }

    // Handle modulator drag — convert screen coords to canvas coords
    if (!dragState || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const canvas = screenToCanvas(e.clientX, e.clientY, rect, panZoom.zoom, panZoom.panX, panZoom.panY);
    setDragState(prev => prev ? { ...prev, mouseX: canvas.x, mouseY: canvas.y } : null);

    // Check if hovering over a target port
    let found: string | null = null;
    for (const port of targetPorts) {
      const dx = canvas.x - port.x;
      const dy = canvas.y - port.y;
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
        found = `${port.nodeId}:${port.paramId}`;
        break;
      }
    }
    setHoveredPortKey(found);
  }, [dragState, nodeDrag, baseNodes, targetPorts, panZoom]);

  const handleMouseUp = useCallback(() => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      return;
    }

    // End node drag
    if (nodeDrag) {
      setNodeDrag(null);
      return;
    }

    if (!dragState) return;

    if (hoveredPortKey && onConnectModulator) {
      // Find the matching target port
      const port = targetPorts.find(p => `${p.nodeId}:${p.paramId}` === hoveredPortKey);
      if (port) {
        onConnectModulator(dragState.fromModulatorId, port.target, 0.2);
      }
    }

    setDragState(null);
    setHoveredPortKey(null);
  }, [dragState, nodeDrag, hoveredPortKey, targetPorts, onConnectModulator]);

  // Wheel handler ref: pinch (ctrlKey) zooms centered on cursor, two-finger scroll pans.
  // Stored as a ref so the native event listener always sees the latest closure.
  const handleWheelRef = useRef<(e: WheelEvent) => void>(() => {});
  handleWheelRef.current = (e: WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;

    if (e.ctrlKey || e.metaKey) {
      // Pinch-to-zoom (trackpad pinch sets ctrlKey=true)
      const rect = containerRef.current.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      setPanZoom(prev => {
        const delta = -e.deltaY * ZOOM_SENSITIVITY;
        const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.zoom * (1 + delta)));
        const scale = newZoom / prev.zoom;

        const newPanX = cursorX - scale * (cursorX - prev.panX);
        const newPanY = cursorY - scale * (cursorY - prev.panY);

        return { zoom: newZoom, panX: newPanX, panY: newPanY };
      });
    } else {
      // Two-finger scroll → pan
      setPanZoom(prev => ({
        ...prev,
        panX: prev.panX - e.deltaX,
        panY: prev.panY - e.deltaY,
      }));
    }
  };

  // Attach native wheel listener (non-passive) so preventDefault works on trackpad
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => handleWheelRef.current(e);
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // Fit all nodes into view with padding
  const handleFitToView = useCallback(() => {
    if (!containerRef.current || nodes.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cw = rect.width - FIT_PADDING * 2;
    const ch = rect.height - FIT_PADDING * 2;
    const bw = contentBounds.maxX - contentBounds.minX;
    const bh = contentBounds.maxY - contentBounds.minY;

    if (bw <= 0 || bh <= 0) return;

    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(cw / bw, ch / bh)));
    const panX = FIT_PADDING + (cw - bw * zoom) / 2 - contentBounds.minX * zoom;
    const panY = FIT_PADDING + (ch - bh * zoom) / 2 - contentBounds.minY * zoom;

    setPanZoom({ zoom, panX, panY });
  }, [nodes.length, contentBounds]);

  // Space key tracking for Space+drag panning
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          spaceHeldRef.current = true;
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeldRef.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Keyboard handler for Delete key on selected edge or node
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      // Delete selected edge
      if (selectedEdgeId && onRemoveModulation) {
        e.preventDefault();
        onRemoveModulation(selectedEdgeId);
        setSelectedEdgeId(null);
        return;
      }
      // Delete selected node (processor or modulator only)
      if (selectedNodeId) {
        const node = nodes.find(n => n.id === selectedNodeId);
        if (!node) return;
        if (node.kind === 'processor' && onRemoveProcessor) {
          e.preventDefault();
          onRemoveProcessor(node.id);
          setSelectedNodeId(null);
        } else if (node.kind === 'modulator' && onRemoveModulator) {
          e.preventDefault();
          onRemoveModulator(node.id);
          setSelectedNodeId(null);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedEdgeId, selectedNodeId, nodes, onRemoveModulation, onRemoveProcessor, onRemoveModulator]);

  // Find selected node for detail panel
  const selectedNode = selectedNodeId ? nodes.find(n => n.id === selectedNodeId) : null;
  const selectedEdge = selectedEdgeId ? modEdges.find(e => e.routeId === selectedEdgeId) : null;

  const zoomPercent = Math.round(panZoom.zoom * 100);

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
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden relative"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div
          style={{
            transformOrigin: '0 0',
            transform: `translate(${panZoom.panX}px, ${panZoom.panY}px) scale(${panZoom.zoom})`,
          }}
        >
          <div
            className="relative"
            style={{ width: maxX, height: maxY }}
            onMouseDown={handleCanvasMouseDown}
          >
            {/* SVG audio edge layer (non-interactive, behind nodes) */}
            <svg
              className="absolute inset-0"
              width={maxX}
              height={maxY}
              style={{ pointerEvents: 'none' }}
            >
              {audioEdges.map((e, i) => (
                <AudioEdgeSvg key={`audio-${i}`} edge={e} />
              ))}
              {/* Send edges — dashed lines from output to bus destinations */}
              {sendEdges.map((e) => (
                <line
                  key={e.id}
                  x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
                  stroke="#71717a"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  opacity={0.5}
                />
              ))}
            </svg>

            {/* Node layer */}
            {nodes.map(n => (
              <NodeCard
                key={n.id}
                node={n}
                selected={selectedNodeId === n.id}
                onDragStart={handleNodeDragStart}
                isDragging={nodeDrag?.nodeId === n.id}
                onModulatorPortMouseDown={handleModulatorPortMouseDown}
                targetPorts={targetPorts}
                dragState={dragState}
                hoveredPortKey={hoveredPortKey}
              />
            ))}

            {/* Send destination nodes — read-only bus labels */}
            {sendNodes.map(sn => (
              <div
                key={sn.id}
                className="absolute rounded border border-zinc-700/60 bg-zinc-900/80 px-2 py-1 pointer-events-none"
                style={{
                  left: sn.x,
                  top: sn.y,
                  width: 100,
                  height: sn.h,
                }}
              >
                <div className="text-[9px] font-mono text-zinc-400 truncate">{sn.label}</div>
                <div className="text-[7px] font-mono text-zinc-600">{sn.sublabel}</div>
              </div>
            ))}

            {/* SVG modulation edge layer — container allows events; non-interactive children opt out */}
            <svg
              className="absolute inset-0"
              width={maxX}
              height={maxY}
            >
              <defs>
                <marker
                  id="mod-arrow"
                  viewBox="0 0 10 7"
                  refX="10"
                  refY="3.5"
                  markerWidth="8"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <polygon points="0 0, 10 3.5, 0 7" fill="#22d3ee" opacity="0.7" />
                </marker>
                <marker
                  id="mod-arrow-selected"
                  viewBox="0 0 10 7"
                  refX="10"
                  refY="3.5"
                  markerWidth="8"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <polygon points="0 0, 10 3.5, 0 7" fill="#67e8f9" />
                </marker>
              </defs>
              {modEdges.map((e) => (
                <ModEdgeSvg
                  key={`mod-${e.routeId}`}
                  edge={e}
                  selected={selectedEdgeId === e.routeId}
                  onSelect={handleEdgeSelect}
                />
              ))}
            </svg>

            {/* Drag preview edge */}
            {dragState && <DragPreviewEdge drag={dragState} />}

            {/* Selected node detail panel */}
            {selectedNode && selectedNode.kind !== 'output' && (
              <NodeDetailPanel node={selectedNode} track={track} />
            )}

            {/* Edge deletion via Delete/Backspace key when edge is selected */}

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

        {/* Toolbar buttons (outside transform) */}
        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          {(onAddProcessor || onAddModulator) && (
            <button
              className="h-6 px-2 flex items-center gap-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors text-[10px] font-mono uppercase tracking-wider"
              title="Add module"
              onClick={() => setBrowserOpen(true)}
            >
              <span className="text-sm leading-none">+</span>
              <span>Module</span>
            </button>
          )}
          <span className="text-[9px] text-zinc-500 font-mono tabular-nums select-none">
            {zoomPercent}%
          </span>
          <button
            className="w-6 h-6 flex items-center justify-center rounded bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
            title="Fit to view"
            onClick={handleFitToView}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="2" width="10" height="10" rx="1" />
              <path d="M2 5H5V2M9 2V5H12M12 9H9V12M5 12V9H2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Module browser slide-out */}
      {browserOpen && onAddProcessor && onAddModulator && (
        <ModuleBrowser
          activeTrack={track}
          onAddProcessor={onAddProcessor}
          onAddModulator={onAddModulator}
          onClose={() => setBrowserOpen(false)}
        />
      )}
    </div>
  );
}
