#!/usr/bin/env npx tsx
// scripts/gluon-mcp-server.ts — Gluon MCP server over stdio transport.
//
// Exposes Gluon's tool layer as an MCP server so Claude Code (or any MCP
// client) can operate Gluon directly via structured tool calls.
//
// Usage: Add to Claude Code MCP config:
// { "mcpServers": { "gluon": { "command": "npx", "args": ["tsx", "scripts/gluon-mcp-server.ts"] } } }

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { GLUON_TOOLS } from '../src/ai/tool-schemas.js';
import type { ToolSchema as GluonToolSchema } from '../src/ai/types.js';
import type {
  Session,
  Track,
  ScaleConstraint,
  ScaleMode,
  TrackKind,
  ProcessorConfig,
} from '../src/engine/types.js';
import {
  getTrack,
  getActivePattern,
  updateTrack,
  MAX_TRACKS,
  MASTER_BUS_ID,
} from '../src/engine/types.js';
import { createSession, createBusTrack } from '../src/engine/session.js';
import type { MusicalEvent } from '../src/engine/canonical-types.js';
import { createDefaultPattern } from '../src/engine/region-helpers.js';
import { createDefaultStepGrid } from '../src/engine/sequencer-helpers.js';
import { getEngineById, getProcessorEngineByName } from '../src/audio/instrument-registry.js';

// ---------------------------------------------------------------------------
// In-memory session state
// ---------------------------------------------------------------------------

let session: Session = createSession();

function nextTrackId(): string {
  const existingIds = new Set(session.tracks.map(t => t.id));
  for (let i = 0; i < MAX_TRACKS + 1; i++) {
    const id = `v${i}`;
    if (!existingIds.has(id)) return id;
  }
  return `v${Date.now()}`;
}

function nextTrackName(): string {
  const existingNames = new Set(session.tracks.map(t => t.name).filter(Boolean));
  for (let i = 1; i <= MAX_TRACKS + 1; i++) {
    const name = `T${i}`;
    if (!existingNames.has(name)) return name;
  }
  return `T${Date.now()}`;
}

/**
 * Resolve a track reference — accepts ordinal labels like "Track 1" or
 * internal IDs like "v0". Falls back to activeTrackId.
 */
function resolveTrackId(ref?: string): string {
  if (!ref) return session.activeTrackId;
  // Try direct ID match first
  if (session.tracks.find(t => t.id === ref)) return ref;
  // Try ordinal label (case-insensitive)
  const match = ref.match(/^track\s+(\d+)$/i);
  if (match) {
    const idx = parseInt(match[1], 10) - 1;
    const audioTracks = session.tracks.filter(
      t => (t.kind ?? 'audio') === 'audio',
    );
    if (idx >= 0 && idx < audioTracks.length) return audioTracks[idx].id;
  }
  // Try name match
  const byName = session.tracks.find(
    t => t.name?.toLowerCase() === ref.toLowerCase(),
  );
  if (byName) return byName.id;
  return ref; // Let it fail at getTrack level
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

function err(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

function handleTool(name: string, args: Record<string, unknown>): ToolResult {
  try {
    switch (name) {
      case 'get_session_state':
        return handleGetSessionState();
      case 'manage_track':
        return handleManageTrack(args);
      case 'move':
        return handleMove(args);
      case 'sketch':
        return handleSketch(args);
      case 'set_model':
        return handleSetModel(args);
      case 'manage_processor':
        return handleManageProcessor(args);
      case 'set_transport':
        return handleSetTransport(args);
      case 'set_scale':
        return handleSetScale(args);
      case 'set_master':
        return handleSetMaster(args);
      case 'set_track_meta':
        return handleSetTrackMeta(args);
      case 'manage_pattern':
        return handleManagePattern(args);
      case 'set_intent':
        return handleSetIntent(args);
      case 'set_section':
        return handleSetSection(args);
      case 'manage_motif':
        return handleManageMotif(args);
      case 'set_tension':
        return handleSetTension(args);
      case 'assign_spectral_slot':
        return handleAssignSpectralSlot(args);
      case 'transform':
        return handleTransform(args);
      case 'edit_pattern':
        return handleEditPattern(args);
      case 'manage_view':
        return handleManageView(args);
      case 'manage_send':
        return handleManageSend(args);
      case 'manage_modulator':
        return handleManageModulator(args);
      case 'modulation_route':
        return handleModulationRoute(args);
      case 'manage_sequence':
        return handleManageSequence(args);
      case 'set_surface':
        return handleSetSurface(args);
      case 'pin_control':
        return handlePinControl(args);
      case 'label_axes':
        return handleLabelAxes(args);
      case 'explain_chain':
        return handleExplainChain(args);
      case 'simplify_chain':
        return handleSimplifyChain(args);
      case 'raise_decision':
        return handleRaiseDecision(args);
      case 'report_bug':
        return handleReportBug(args);
      case 'set_mix_role':
        return handleSetMixRole(args);
      case 'apply_chain_recipe':
        return handleApplyChainRecipe(args);
      case 'apply_modulation':
        return handleApplyModulation(args);
      case 'shape_timbre':
        return handleShapeTimbre(args);
      case 'listen':
      case 'render':
      case 'analyze':
        return err(
          `Tool "${name}" requires the browser audio engine and is not available in the MCP server. ` +
          'Open Gluon in a browser to use audio rendering and analysis tools.',
        );
      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(`Error in ${name}: ${msg}`);
  }
}

// --- get_session_state ---

function handleGetSessionState(): ToolResult {
  const summary = {
    tracks: session.tracks.map(t => ({
      id: t.id,
      name: t.name,
      kind: t.kind ?? 'audio',
      engine: t.engine,
      model: t.model,
      agency: t.agency,
      muted: t.muted,
      solo: t.solo,
      volume: t.volume,
      pan: t.pan,
      params: t.params,
      processors: t.processors ?? [],
      modulators: t.modulators ?? [],
      modulations: t.modulations ?? [],
      patterns: t.patterns.map(p => ({
        id: p.id,
        name: p.name,
        duration: p.duration,
        eventCount: p.events.length,
      })),
      activePatternId: t.activePatternId,
      approval: t.approval ?? 'exploratory',
      importance: t.importance,
      musicalRole: t.musicalRole,
    })),
    activeTrackId: session.activeTrackId,
    transport: session.transport,
    master: session.master,
    context: session.context,
    scale: session.scale ?? null,
    intent: session.intent ?? null,
    section: session.section ?? null,
    undoDepth: session.undoStack.length,
  };
  return ok(summary);
}

// --- manage_track ---

function handleManageTrack(args: Record<string, unknown>): ToolResult {
  const action = args.action as string;
  if (action === 'add') {
    if (session.tracks.length >= MAX_TRACKS) {
      return err(`Cannot add track: maximum of ${MAX_TRACKS} tracks reached.`);
    }
    const kind = (args.kind as TrackKind) ?? 'audio';
    const trackId = nextTrackId();
    let newTrack: Track;
    if (kind === 'bus') {
      newTrack = createBusTrack(trackId, (args.label as string) ?? undefined);
    } else {
      const defaultPattern = createDefaultPattern(trackId, 16);
      newTrack = {
        id: trackId,
        name: (args.label as string) ?? nextTrackName(),
        engine: '',
        model: -1,
        params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
        agency: 'ON' as const,
        stepGrid: createDefaultStepGrid(16),
        patterns: [defaultPattern],
        sequence: [{ patternId: defaultPattern.id }],
        views: [{ kind: 'step-grid' as const, id: `step-grid-${trackId}` }],
        muted: false,
        solo: false,
        volume: 0.8,
        pan: 0.0,
        controlProvenance: {},
        surface: {
          semanticControls: [],
          pinnedControls: [],
          xyAxes: { x: 'timbre', y: 'morph' },
          thumbprint: { type: 'static-color' as const },
        },
        approval: 'exploratory' as const,
      };
    }
    // Insert at correct position
    const newTracks = [...session.tracks];
    let insertIndex: number;
    if (kind === 'audio') {
      insertIndex = newTracks.findIndex(t => (t.kind ?? 'audio') === 'bus');
      if (insertIndex === -1) insertIndex = newTracks.length;
    } else {
      insertIndex = newTracks.findIndex(t => t.id === MASTER_BUS_ID);
      if (insertIndex === -1) insertIndex = newTracks.length;
    }
    newTracks.splice(insertIndex, 0, newTrack);
    session = { ...session, tracks: newTracks };
    return ok({ added: trackId, kind, name: newTrack.name });
  }

  if (action === 'remove') {
    const trackId = resolveTrackId(args.trackId as string);
    if (trackId === MASTER_BUS_ID) {
      return err('Cannot remove the master bus.');
    }
    const idx = session.tracks.findIndex(t => t.id === trackId);
    if (idx === -1) return err(`Track not found: ${trackId}`);
    const newTracks = session.tracks.filter(t => t.id !== trackId);
    const newActiveTrackId =
      session.activeTrackId === trackId
        ? newTracks[0]?.id ?? ''
        : session.activeTrackId;
    session = { ...session, tracks: newTracks, activeTrackId: newActiveTrackId };
    return ok({ removed: trackId });
  }

  return err(`Unknown manage_track action: ${action}`);
}

// --- move ---

function handleMove(args: Record<string, unknown>): ToolResult {
  const trackId = resolveTrackId(args.trackId as string);
  const param = args.param as string;
  const target = args.target as { absolute?: number; relative?: number };
  const processorId = args.processorId as string | undefined;
  const modulatorId = args.modulatorId as string | undefined;

  const track = getTrack(session, trackId);

  if (processorId) {
    const proc = (track.processors ?? []).find(p => p.id === processorId);
    if (!proc) return err(`Processor not found: ${processorId}`);
    const currentVal = proc.params[param] ?? 0.5;
    const newVal =
      target.absolute !== undefined
        ? target.absolute
        : Math.max(0, Math.min(1, currentVal + (target.relative ?? 0)));
    proc.params[param] = newVal;
    session = updateTrack(session, trackId, {
      processors: track.processors!.map(p =>
        p.id === processorId ? { ...p, params: { ...p.params, [param]: newVal } } : p,
      ),
    });
    return ok({ trackId, processorId, param, value: newVal });
  }

  if (modulatorId) {
    const mod = (track.modulators ?? []).find(m => m.id === modulatorId);
    if (!mod) return err(`Modulator not found: ${modulatorId}`);
    const currentVal = mod.params[param] ?? 0.5;
    const newVal =
      target.absolute !== undefined
        ? target.absolute
        : Math.max(0, Math.min(1, currentVal + (target.relative ?? 0)));
    session = updateTrack(session, trackId, {
      modulators: track.modulators!.map(m =>
        m.id === modulatorId ? { ...m, params: { ...m.params, [param]: newVal } } : m,
      ),
    });
    return ok({ trackId, modulatorId, param, value: newVal });
  }

  // Source param
  const currentVal = (track.params as Record<string, number>)[param] ?? 0.5;
  const newVal =
    target.absolute !== undefined
      ? target.absolute
      : Math.max(0, Math.min(1, currentVal + (target.relative ?? 0)));
  session = updateTrack(session, trackId, {
    params: { ...track.params, [param]: newVal },
  });
  return ok({ trackId, param, value: newVal });
}

// --- sketch ---

function handleSketch(args: Record<string, unknown>): ToolResult {
  const trackId = resolveTrackId(args.trackId as string);
  const description = (args.description as string) ?? '';
  const rawEvents = args.events as Array<Record<string, unknown>> | undefined;

  const track = getTrack(session, trackId);
  const pattern = getActivePattern(track);

  if (!rawEvents || rawEvents.length === 0) {
    return err('sketch requires an events array with at least one event.');
  }

  // Convert raw events to MusicalEvent format
  const events: MusicalEvent[] = rawEvents.map(e => {
    const at = typeof e.at === 'number' ? e.at : parseBarBeatStep(e.at as string);
    const kind = e.kind as string;
    if (kind === 'note') {
      return {
        kind: 'note' as const,
        at,
        pitch: (e.pitch as number) ?? 60,
        velocity: (e.velocity as number) ?? 0.8,
        duration: (e.duration as number) ?? 1,
      };
    }
    if (kind === 'parameter') {
      return {
        kind: 'parameter' as const,
        at,
        controlId: e.controlId as string,
        value: e.value as number,
      };
    }
    // default: trigger
    return {
      kind: 'trigger' as const,
      at,
      velocity: (e.velocity as number) ?? 0.8,
      accent: (e.accent as boolean) ?? false,
    };
  });

  // Write events to pattern
  const updatedPattern = { ...pattern, events };
  session = {
    ...session,
    tracks: session.tracks.map(t => {
      if (t.id !== trackId) return t;
      return {
        ...t,
        patterns: t.patterns.map(p => (p.id === pattern.id ? updatedPattern : p)),
        _patternDirty: true,
      };
    }),
  };

  return ok({
    trackId,
    patternId: pattern.id,
    description,
    eventCount: events.length,
  });
}

function parseBarBeatStep(bbs: string): number {
  const parts = bbs.split('.').map(Number);
  if (parts.length !== 3) return 0;
  const [bar, beat, sixteenth] = parts;
  return ((bar - 1) * 4 + (beat - 1)) * 4 + (sixteenth - 1);
}

// --- set_model ---

function handleSetModel(args: Record<string, unknown>): ToolResult {
  const trackId = resolveTrackId(args.trackId as string);
  const modelName = args.model as string;
  const processorId = args.processorId as string | undefined;
  const modulatorId = args.modulatorId as string | undefined;
  const track = getTrack(session, trackId);

  if (processorId) {
    const proc = (track.processors ?? []).find(p => p.id === processorId);
    if (!proc) return err(`Processor not found: ${processorId}`);
    const engine = getProcessorEngineByName(proc.type);
    if (!engine) return err(`Unknown processor type: ${proc.type}`);
    const modeIdx = engine.engines.findIndex(
      (e: { id: string }) => e.id === modelName,
    );
    if (modeIdx === -1) return err(`Unknown mode "${modelName}" for ${proc.type}`);
    session = updateTrack(session, trackId, {
      processors: track.processors!.map(p =>
        p.id === processorId ? { ...p, model: modeIdx } : p,
      ),
    });
    return ok({ trackId, processorId, model: modelName, modelIndex: modeIdx });
  }

  if (modulatorId) {
    const mod = (track.modulators ?? []).find(m => m.id === modulatorId);
    if (!mod) return err(`Modulator not found: ${modulatorId}`);
    // For Tides: ad=0, looping=1, ar=2
    const modeMap: Record<string, number> = { ad: 0, looping: 1, ar: 2 };
    const modeIdx = modeMap[modelName];
    if (modeIdx === undefined) return err(`Unknown modulator mode: ${modelName}`);
    session = updateTrack(session, trackId, {
      modulators: track.modulators!.map(m =>
        m.id === modulatorId ? { ...m, model: modeIdx } : m,
      ),
    });
    return ok({ trackId, modulatorId, model: modelName, modelIndex: modeIdx });
  }

  // Source engine
  const engine = getEngineById(modelName);
  if (!engine) return err(`Unknown engine model: ${modelName}`);
  session = updateTrack(session, trackId, {
    engine: engine.engine,
    model: engine.modelIndex,
  });
  return ok({ trackId, engine: engine.engine, model: engine.modelIndex, modelName });
}

// --- manage_processor ---

function handleManageProcessor(args: Record<string, unknown>): ToolResult {
  const action = args.action as string;
  const trackId = resolveTrackId(args.trackId as string);
  const track = getTrack(session, trackId);
  const processors = track.processors ?? [];

  if (action === 'add') {
    const moduleType = args.moduleType as string;
    if (!moduleType) return err('moduleType is required for add.');
    const engine = getProcessorEngineByName(moduleType);
    if (!engine) return err(`Unknown processor type: ${moduleType}`);

    const processorId = `${moduleType}-${Date.now()}`;
    const defaultParams: Record<string, number> = {};
    const controls = engine.engines[0]?.controls ?? [];
    for (const c of controls) {
      defaultParams[c.id] = c.defaultNormalized ?? 0.5;
    }

    const newProc: ProcessorConfig = {
      id: processorId,
      type: moduleType,
      model: 0,
      params: defaultParams,
      enabled: (args.enabled as boolean) ?? true,
    };

    session = updateTrack(session, trackId, {
      processors: [...processors, newProc],
    });
    return ok({ trackId, added: processorId, type: moduleType });
  }

  if (action === 'remove') {
    const processorId = args.processorId as string;
    if (!processorId) return err('processorId is required for remove.');
    if (!processors.find(p => p.id === processorId)) {
      return err(`Processor not found: ${processorId}`);
    }
    session = updateTrack(session, trackId, {
      processors: processors.filter(p => p.id !== processorId),
      // Also clean up modulation routings targeting this processor
      modulations: (track.modulations ?? []).filter(
        m =>
          !(m.target.kind === 'processor' && m.target.processorId === processorId),
      ),
    });
    return ok({ trackId, removed: processorId });
  }

  if (action === 'replace') {
    const processorId = args.processorId as string;
    const moduleType = args.moduleType as string;
    if (!processorId || !moduleType) {
      return err('processorId and moduleType are required for replace.');
    }
    const engine = getProcessorEngineByName(moduleType);
    if (!engine) return err(`Unknown processor type: ${moduleType}`);
    const newId = `${moduleType}-${Date.now()}`;
    const defaultParams: Record<string, number> = {};
    const controls = engine.engines[0]?.controls ?? [];
    for (const c of controls) {
      defaultParams[c.id] = c.defaultNormalized ?? 0.5;
    }
    session = updateTrack(session, trackId, {
      processors: processors.map(p =>
        p.id === processorId
          ? { id: newId, type: moduleType, model: 0, params: defaultParams, enabled: true }
          : p,
      ),
    });
    return ok({ trackId, replaced: processorId, newId, type: moduleType });
  }

  if (action === 'bypass') {
    const processorId = args.processorId as string;
    const enabled = args.enabled as boolean;
    if (!processorId) return err('processorId is required for bypass.');
    const proc = processors.find(p => p.id === processorId);
    if (!proc) return err(`Processor not found: ${processorId}`);
    session = updateTrack(session, trackId, {
      processors: processors.map(p =>
        p.id === processorId ? { ...p, enabled } : p,
      ),
    });
    return ok({ trackId, processorId, enabled });
  }

  return err(`Unknown manage_processor action: ${action}`);
}

// --- set_transport ---

function handleSetTransport(args: Record<string, unknown>): ToolResult {
  const transport = { ...session.transport };
  if (args.bpm !== undefined) transport.bpm = args.bpm as number;
  if (args.swing !== undefined) transport.swing = args.swing as number;
  if (args.mode !== undefined) {
    (transport as Record<string, unknown>).mode = args.mode;
  }
  if (args.timeSignatureNumerator !== undefined) {
    transport.timeSignature = {
      ...transport.timeSignature,
      numerator: args.timeSignatureNumerator as number,
    };
  }
  if (args.timeSignatureDenominator !== undefined) {
    transport.timeSignature = {
      ...transport.timeSignature,
      denominator: args.timeSignatureDenominator as number,
    };
  }
  session = { ...session, transport };
  return ok({ transport: session.transport });
}

// --- set_scale ---

function handleSetScale(args: Record<string, unknown>): ToolResult {
  if (args.clear) {
    session = { ...session, scale: null };
    return ok({ scale: null });
  }
  if (args.root !== undefined && args.mode !== undefined) {
    const scale: ScaleConstraint = {
      root: args.root as number,
      mode: args.mode as ScaleMode,
    };
    session = { ...session, scale };
    return ok({ scale });
  }
  return err('set_scale requires root + mode, or clear: true.');
}

// --- set_master ---

function handleSetMaster(args: Record<string, unknown>): ToolResult {
  const master = { ...session.master };
  if (args.volume !== undefined) master.volume = args.volume as number;
  if (args.pan !== undefined) master.pan = args.pan as number;
  session = { ...session, master };
  return ok({ master });
}

// --- set_track_meta ---

function handleSetTrackMeta(args: Record<string, unknown>): ToolResult {
  const trackId = resolveTrackId(args.trackId as string);
  getTrack(session, trackId); // validate track exists
  const updates: Partial<Track> = {};
  if (args.name !== undefined) updates.name = args.name as string;
  if (args.volume !== undefined) updates.volume = args.volume as number;
  if (args.pan !== undefined) updates.pan = args.pan as number;
  if (args.muted !== undefined) updates.muted = args.muted as boolean;
  if (args.solo !== undefined) updates.solo = args.solo as boolean;
  if (args.approval !== undefined) updates.approval = args.approval as Track['approval'];
  if (args.importance !== undefined) updates.importance = args.importance as number;
  if (args.musicalRole !== undefined) updates.musicalRole = args.musicalRole as string;
  session = updateTrack(session, trackId, updates);
  return ok({ trackId, ...updates });
}

// --- manage_pattern ---

function handleManagePattern(args: Record<string, unknown>): ToolResult {
  const action = args.action as string;
  const trackId = resolveTrackId(args.trackId as string);
  const track = getTrack(session, trackId);

  if (action === 'add') {
    const newPattern = createDefaultPattern(trackId, 16);
    if (args.name) (newPattern as Record<string, unknown>).name = args.name;
    session = updateTrack(session, trackId, {
      patterns: [...track.patterns, newPattern],
    });
    return ok({ trackId, added: newPattern.id });
  }

  if (action === 'remove') {
    const patternId = args.patternId as string;
    if (!patternId) return err('patternId required for remove.');
    if (track.patterns.length <= 1) return err('Cannot remove the last pattern.');
    session = updateTrack(session, trackId, {
      patterns: track.patterns.filter(p => p.id !== patternId),
      activePatternId:
        track.activePatternId === patternId ? track.patterns[0].id : track.activePatternId,
    });
    return ok({ trackId, removed: patternId });
  }

  if (action === 'duplicate') {
    const patternId = args.patternId as string;
    if (!patternId) return err('patternId required for duplicate.');
    const src = track.patterns.find(p => p.id === patternId);
    if (!src) return err(`Pattern not found: ${patternId}`);
    const dup = {
      ...src,
      id: `${trackId}-pat-${Date.now()}`,
      name: `${src.name ?? 'Pattern'} (copy)`,
      events: [...src.events],
    };
    session = updateTrack(session, trackId, {
      patterns: [...track.patterns, dup],
    });
    return ok({ trackId, duplicated: patternId, newId: dup.id });
  }

  if (action === 'rename') {
    const patternId = args.patternId as string;
    const name = args.name as string;
    if (!patternId || !name) return err('patternId and name required for rename.');
    session = updateTrack(session, trackId, {
      patterns: track.patterns.map(p =>
        p.id === patternId ? { ...p, name } : p,
      ),
    });
    return ok({ trackId, patternId, name });
  }

  if (action === 'set_active') {
    const patternId = args.patternId as string;
    if (!patternId) return err('patternId required for set_active.');
    if (!track.patterns.find(p => p.id === patternId)) {
      return err(`Pattern not found: ${patternId}`);
    }
    session = updateTrack(session, trackId, { activePatternId: patternId });
    return ok({ trackId, activePatternId: patternId });
  }

  if (action === 'set_length') {
    const length = args.length as number;
    if (!length || length < 1 || length > 64) return err('length must be 1-64.');
    const pattern = getActivePattern(track);
    // Truncate events beyond new length
    const events = pattern.events.filter(e => e.at < length);
    session = updateTrack(session, trackId, {
      patterns: track.patterns.map(p =>
        p.id === pattern.id ? { ...p, duration: length, events } : p,
      ),
    });
    return ok({ trackId, patternId: pattern.id, length, eventCount: events.length });
  }

  if (action === 'clear') {
    const pattern = getActivePattern(track);
    session = updateTrack(session, trackId, {
      patterns: track.patterns.map(p =>
        p.id === pattern.id ? { ...p, events: [] } : p,
      ),
    });
    return ok({ trackId, patternId: pattern.id, cleared: true });
  }

  return err(`Unknown manage_pattern action: ${action}`);
}

// --- set_intent ---

function handleSetIntent(args: Record<string, unknown>): ToolResult {
  const prev = session.intent ?? {};
  const intent = {
    ...prev,
    ...(args.genre !== undefined ? { genre: args.genre } : {}),
    ...(args.references !== undefined ? { references: args.references } : {}),
    ...(args.mood !== undefined ? { mood: args.mood } : {}),
    ...(args.avoid !== undefined ? { avoid: args.avoid } : {}),
    ...(args.currentGoal !== undefined ? { currentGoal: args.currentGoal } : {}),
  } as Session['intent'];
  session = { ...session, intent };
  return ok({ intent });
}

// --- set_section ---

function handleSetSection(args: Record<string, unknown>): ToolResult {
  const prev = session.section ?? {};
  const section = {
    ...prev,
    ...(args.name !== undefined ? { name: args.name } : {}),
    ...(args.intent !== undefined ? { intent: args.intent } : {}),
    ...(args.targetEnergy !== undefined ? { targetEnergy: args.targetEnergy } : {}),
    ...(args.targetDensity !== undefined ? { targetDensity: args.targetDensity } : {}),
  } as Session['section'];
  session = { ...session, section };
  return ok({ section });
}

// --- manage_motif (simplified — metadata-only in MCP) ---

const motifStore: Map<string, { id: string; name: string; events: MusicalEvent[]; tags?: string[] }> = new Map();
let motifCounter = 0;

function handleManageMotif(args: Record<string, unknown>): ToolResult {
  const action = args.action as string;

  if (action === 'list') {
    const motifs = Array.from(motifStore.values()).map(m => ({
      id: m.id,
      name: m.name,
      eventCount: m.events.length,
      tags: m.tags,
    }));
    return ok({ motifs });
  }

  if (action === 'register') {
    const trackId = resolveTrackId(args.trackId as string);
    const track = getTrack(session, trackId);
    const pattern = getActivePattern(track);
    const name = (args.name as string) ?? `motif-${motifCounter}`;
    const stepRange = args.stepRange as [number, number] | undefined;
    let events = pattern.events;
    if (stepRange) {
      events = events.filter(e => e.at >= stepRange[0] && e.at <= stepRange[1]);
    }
    const id = `motif-${motifCounter++}`;
    motifStore.set(id, { id, name, events: [...events], tags: args.tags as string[] | undefined });
    return ok({ registered: id, name, eventCount: events.length });
  }

  if (action === 'recall') {
    const motifId = args.motifId as string;
    // Try by ID, then by name
    let motif = motifStore.get(motifId);
    if (!motif) {
      motif = Array.from(motifStore.values()).find(
        m => m.name.toLowerCase() === motifId?.toLowerCase(),
      );
    }
    if (!motif) return err(`Motif not found: ${motifId}`);
    return ok(motif);
  }

  if (action === 'develop') {
    return ok({ note: 'Motif development operations are not yet implemented in MCP mode.' });
  }

  return err(`Unknown manage_motif action: ${action}`);
}

// --- set_tension ---

function handleSetTension(args: Record<string, unknown>): ToolResult {
  const points = args.points as Array<{ bar: number; energy: number; density: number }>;
  if (!points || points.length === 0) return err('set_tension requires at least one point.');
  session = {
    ...session,
    tensionCurve: {
      points: points.map(p => ({ bar: p.bar, energy: p.energy, density: p.density })),
      trackMappings: (args.trackMappings as Session['tensionCurve'] extends { trackMappings?: infer T } ? T : never) ?? session.tensionCurve?.trackMappings ?? [],
    },
  };
  return ok({ tensionCurve: session.tensionCurve });
}

// --- assign_spectral_slot (metadata-only) ---

function handleAssignSpectralSlot(args: Record<string, unknown>): ToolResult {
  // This is metadata — stored on session context, not directly actionable without audio
  return ok({
    trackId: resolveTrackId(args.trackId as string),
    bands: args.bands,
    priority: args.priority,
    note: 'Spectral slot assigned as metadata. Collision analysis requires the browser audio engine.',
  });
}

// --- transform (simplified — basic operations on in-memory events) ---

function handleTransform(args: Record<string, unknown>): ToolResult {
  const trackId = resolveTrackId(args.trackId as string);
  const operation = args.operation as string;
  const track = getTrack(session, trackId);
  const pattern = getActivePattern(track);
  let events = [...pattern.events];

  switch (operation) {
    case 'reverse': {
      const duration = pattern.duration ?? 16;
      events = events.map(e => ({ ...e, at: duration - 1 - e.at }));
      break;
    }
    case 'transpose': {
      const semitones = (args.semitones as number) ?? 0;
      events = events.map(e =>
        e.kind === 'note'
          ? { ...e, pitch: Math.max(0, Math.min(127, (e.pitch ?? 60) + semitones)) }
          : e,
      );
      break;
    }
    case 'rotate': {
      const steps = (args.steps as number) ?? 0;
      const duration = pattern.duration ?? 16;
      events = events.map(e => ({
        ...e,
        at: ((e.at + steps) % duration + duration) % duration,
      }));
      break;
    }
    default:
      return ok({
        note: `Transform "${operation}" is partially supported in MCP mode. ` +
          'Complex transforms (humanize, euclidean, ghost_notes, etc.) require the full engine.',
      });
  }

  session = updateTrack(session, trackId, {
    patterns: track.patterns.map(p =>
      p.id === pattern.id ? { ...p, events } : p,
    ),
    _patternDirty: true,
  });
  return ok({ trackId, operation, eventCount: events.length });
}

// --- edit_pattern ---

function handleEditPattern(args: Record<string, unknown>): ToolResult {
  const trackId = resolveTrackId(args.trackId as string);
  const track = getTrack(session, trackId);
  const patternId = (args.patternId as string) ?? getActivePattern(track).id;
  const pattern = track.patterns.find(p => p.id === patternId);
  if (!pattern) return err(`Pattern not found: ${patternId}`);
  const operations = args.operations as Array<Record<string, unknown>>;
  if (!operations) return err('operations array is required.');

  let events = [...pattern.events];

  for (const op of operations) {
    const action = op.action as string;
    const step =
      typeof op.step === 'number'
        ? op.step
        : typeof op.step === 'string'
          ? parseBarBeatStep(op.step)
          : 0;
    const TOLERANCE = 0.001;

    if (action === 'add') {
      const event = op.event as Record<string, unknown> | undefined;
      if (event) {
        const kind = (event.type as string) === 'note' ? 'note' : 'trigger';
        if (kind === 'note') {
          events.push({
            kind: 'note',
            at: step,
            pitch: (event.pitch as number) ?? 60,
            velocity: (event.velocity as number) ?? 0.8,
            duration: (event.duration as number) ?? 1,
          });
        } else {
          events.push({
            kind: 'trigger',
            at: step,
            velocity: (event.velocity as number) ?? 0.8,
            accent: (event.accent as boolean) ?? false,
          });
        }
      }
    } else if (action === 'remove') {
      events = events.filter(e => Math.abs(e.at - step) > TOLERANCE);
    } else if (action === 'modify') {
      const event = op.event as Record<string, unknown> | undefined;
      if (event) {
        events = events.map(e => {
          if (Math.abs(e.at - step) > TOLERANCE) return e;
          const updated = { ...e } as Record<string, unknown>;
          if (event.velocity !== undefined) updated.velocity = event.velocity;
          if (event.pitch !== undefined) updated.pitch = event.pitch;
          if (event.duration !== undefined) updated.duration = event.duration;
          if (event.accent !== undefined) updated.accent = event.accent;
          return updated as MusicalEvent;
        });
      }
    }
  }

  session = updateTrack(session, trackId, {
    patterns: track.patterns.map(p =>
      p.id === patternId ? { ...p, events } : p,
    ),
    _patternDirty: true,
  });
  return ok({ trackId, patternId, eventCount: events.length });
}

// --- manage_view ---

function handleManageView(args: Record<string, unknown>): ToolResult {
  const action = args.action as string;
  const trackId = resolveTrackId(args.trackId as string);
  const track = getTrack(session, trackId);
  const views = track.views ?? [];

  if (action === 'add') {
    const viewKind = (args.viewKind as string) ?? 'step-grid';
    const viewId = `${viewKind}-${Date.now()}`;
    session = updateTrack(session, trackId, {
      views: [...views, { kind: viewKind as 'step-grid' | 'piano-roll', id: viewId }],
    });
    return ok({ trackId, added: viewId });
  }

  if (action === 'remove') {
    const viewId = args.viewId as string;
    if (!viewId) return err('viewId required for remove.');
    session = updateTrack(session, trackId, {
      views: views.filter(v => v.id !== viewId),
    });
    return ok({ trackId, removed: viewId });
  }

  return err(`Unknown manage_view action: ${action}`);
}

// --- manage_send ---

function handleManageSend(args: Record<string, unknown>): ToolResult {
  const action = args.action as string;
  const trackId = resolveTrackId(args.trackId as string);
  const busId = args.busId as string;
  const track = getTrack(session, trackId);
  const sends = track.sends ?? [];

  if (action === 'add') {
    const level = (args.level as number) ?? 1.0;
    if (sends.find(s => s.busId === busId)) {
      return err(`Send to ${busId} already exists on track ${trackId}.`);
    }
    session = updateTrack(session, trackId, {
      sends: [...sends, { busId, level }],
    });
    return ok({ trackId, busId, level });
  }

  if (action === 'remove') {
    session = updateTrack(session, trackId, {
      sends: sends.filter(s => s.busId !== busId),
    });
    return ok({ trackId, removed: busId });
  }

  if (action === 'set_level') {
    const level = args.level as number;
    if (level === undefined) return err('level required for set_level.');
    session = updateTrack(session, trackId, {
      sends: sends.map(s => (s.busId === busId ? { ...s, level } : s)),
    });
    return ok({ trackId, busId, level });
  }

  return err(`Unknown manage_send action: ${action}`);
}

// --- manage_modulator ---

function handleManageModulator(args: Record<string, unknown>): ToolResult {
  const action = args.action as string;
  const trackId = resolveTrackId(args.trackId as string);
  const track = getTrack(session, trackId);
  const modulators = track.modulators ?? [];

  if (action === 'add') {
    const moduleType = args.moduleType as string;
    if (!moduleType) return err('moduleType is required for add.');
    const modulatorId = `${moduleType}-${Date.now()}`;
    const defaultParams: Record<string, number> = {};
    // Tides defaults
    if (moduleType === 'tides') {
      defaultParams.frequency = 0.3;
      defaultParams.shape = 0.5;
      defaultParams.slope = 0.5;
      defaultParams.smoothness = 0.5;
    }
    session = updateTrack(session, trackId, {
      modulators: [
        ...modulators,
        { id: modulatorId, type: moduleType, model: 0, params: defaultParams },
      ],
    });
    return ok({ trackId, added: modulatorId, type: moduleType });
  }

  if (action === 'remove') {
    const modulatorId = args.modulatorId as string;
    if (!modulatorId) return err('modulatorId required for remove.');
    session = updateTrack(session, trackId, {
      modulators: modulators.filter(m => m.id !== modulatorId),
      // Clean up routings from this modulator
      modulations: (track.modulations ?? []).filter(r => r.modulatorId !== modulatorId),
    });
    return ok({ trackId, removed: modulatorId });
  }

  return err(`Unknown manage_modulator action: ${action}`);
}

// --- modulation_route ---

function handleModulationRoute(args: Record<string, unknown>): ToolResult {
  const action = args.action as string;
  const trackId = resolveTrackId(args.trackId as string);
  const track = getTrack(session, trackId);
  const modulations = track.modulations ?? [];

  if (action === 'connect') {
    const modulatorId = args.modulatorId as string;
    const targetKind = args.targetKind as string;
    const targetParam = args.targetParam as string;
    const depth = (args.depth as number) ?? 0.3;
    const processorId = args.processorId as string | undefined;

    if (!modulatorId || !targetKind || !targetParam) {
      return err('connect requires modulatorId, targetKind, and targetParam.');
    }

    const target =
      targetKind === 'processor'
        ? { kind: 'processor' as const, processorId: processorId!, param: targetParam }
        : { kind: 'source' as const, param: targetParam };

    // Idempotent: update existing route with same modulator + target
    const existing = modulations.find(
      r =>
        r.modulatorId === modulatorId &&
        r.target.kind === target.kind &&
        r.target.param === target.param &&
        (target.kind === 'source' || (r.target as { processorId: string }).processorId === processorId),
    );

    if (existing) {
      session = updateTrack(session, trackId, {
        modulations: modulations.map(r =>
          r.id === existing.id ? { ...r, depth } : r,
        ),
      });
      return ok({ trackId, updated: existing.id, depth });
    }

    const routeId = `mod-${Date.now()}`;
    session = updateTrack(session, trackId, {
      modulations: [
        ...modulations,
        { id: routeId, modulatorId, target, depth },
      ],
    });
    return ok({ trackId, added: routeId, modulatorId, target, depth });
  }

  if (action === 'disconnect') {
    const modulationId = args.modulationId as string;
    if (!modulationId) return err('modulationId required for disconnect.');
    session = updateTrack(session, trackId, {
      modulations: modulations.filter(r => r.id !== modulationId),
    });
    return ok({ trackId, removed: modulationId });
  }

  return err(`Unknown modulation_route action: ${action}`);
}

// --- manage_sequence ---

function handleManageSequence(args: Record<string, unknown>): ToolResult {
  const action = args.action as string;
  const trackId = resolveTrackId(args.trackId as string);
  const track = getTrack(session, trackId);
  const sequence = [...track.sequence];

  if (action === 'append') {
    const patternId = args.patternId as string;
    if (!patternId) return err('patternId required for append.');
    if (!track.patterns.find(p => p.id === patternId)) {
      return err(`Pattern not found: ${patternId}`);
    }
    sequence.push({ patternId });
    session = updateTrack(session, trackId, { sequence });
    return ok({ trackId, sequence });
  }

  if (action === 'remove') {
    const idx = args.sequenceIndex as number;
    if (idx === undefined || idx < 0 || idx >= sequence.length) {
      return err('sequenceIndex out of range.');
    }
    sequence.splice(idx, 1);
    session = updateTrack(session, trackId, { sequence });
    return ok({ trackId, sequence });
  }

  if (action === 'reorder') {
    const fromIdx = args.sequenceIndex as number;
    const toIdx = args.toIndex as number;
    if (fromIdx === undefined || toIdx === undefined) {
      return err('sequenceIndex and toIndex required for reorder.');
    }
    const [item] = sequence.splice(fromIdx, 1);
    sequence.splice(toIdx, 0, item);
    session = updateTrack(session, trackId, { sequence });
    return ok({ trackId, sequence });
  }

  return err(`Unknown manage_sequence action: ${action}`);
}

// --- set_surface ---

function handleSetSurface(args: Record<string, unknown>): ToolResult {
  const trackId = resolveTrackId(args.trackId as string);
  const track = getTrack(session, trackId);
  const semanticControls = args.semanticControls as Track['surface']['semanticControls'];
  const xyAxes = args.xyAxes as { x: string; y: string } | undefined;

  session = updateTrack(session, trackId, {
    surface: {
      ...track.surface,
      semanticControls: semanticControls ?? track.surface.semanticControls,
      xyAxes: xyAxes ?? track.surface.xyAxes,
    },
  });
  return ok({ trackId, surface: { semanticControls: semanticControls?.length ?? 0, xyAxes } });
}

// --- pin_control ---

function handlePinControl(args: Record<string, unknown>): ToolResult {
  const action = args.action as string;
  const trackId = resolveTrackId(args.trackId as string);
  const moduleId = args.moduleId as string;
  const controlId = args.controlId as string;
  const track = getTrack(session, trackId);
  const pinned = [...track.surface.pinnedControls];

  if (action === 'pin') {
    if (pinned.length >= 4) return err('Maximum 4 pinned controls per track.');
    if (pinned.find(p => p.moduleId === moduleId && p.controlId === controlId)) {
      return ok({ trackId, note: 'Already pinned.' });
    }
    pinned.push({ moduleId, controlId });
  } else if (action === 'unpin') {
    const idx = pinned.findIndex(
      p => p.moduleId === moduleId && p.controlId === controlId,
    );
    if (idx === -1) return err('Control not pinned.');
    pinned.splice(idx, 1);
  } else {
    return err(`Unknown pin_control action: ${action}`);
  }

  session = updateTrack(session, trackId, {
    surface: { ...track.surface, pinnedControls: pinned },
  });
  return ok({ trackId, pinnedControls: pinned });
}

// --- label_axes ---

function handleLabelAxes(args: Record<string, unknown>): ToolResult {
  const trackId = resolveTrackId(args.trackId as string);
  const track = getTrack(session, trackId);
  const x = args.x as string;
  const y = args.y as string;
  session = updateTrack(session, trackId, {
    surface: { ...track.surface, xyAxes: { x, y } },
  });
  return ok({ trackId, xyAxes: { x, y } });
}

// --- explain_chain (read-only) ---

function handleExplainChain(args: Record<string, unknown>): ToolResult {
  const trackId = resolveTrackId(args.trackId as string);
  const track = getTrack(session, trackId);
  const chain = {
    source: { engine: track.engine, model: track.model },
    processors: (track.processors ?? []).map(p => ({
      id: p.id,
      type: p.type,
      model: p.model,
      enabled: p.enabled ?? true,
      params: p.params,
    })),
    modulators: (track.modulators ?? []).map(m => ({
      id: m.id,
      type: m.type,
      model: m.model,
      params: m.params,
    })),
    modulations: (track.modulations ?? []).map(r => ({
      id: r.id,
      modulatorId: r.modulatorId,
      target: r.target,
      depth: r.depth,
    })),
  };
  return ok({ trackId, chain });
}

// --- simplify_chain (read-only) ---

function handleSimplifyChain(args: Record<string, unknown>): ToolResult {
  const trackId = resolveTrackId(args.trackId as string);
  const track = getTrack(session, trackId);
  const processors = track.processors ?? [];
  const suggestions: string[] = [];

  // Flag bypassed processors
  for (const p of processors) {
    if (p.enabled === false) {
      suggestions.push(`${p.id} (${p.type}) is bypassed — consider removing.`);
    }
  }

  // Flag duplicate types
  const typeCounts = new Map<string, number>();
  for (const p of processors) {
    typeCounts.set(p.type, (typeCounts.get(p.type) ?? 0) + 1);
  }
  for (const [type, count] of typeCounts) {
    if (count > 1) {
      suggestions.push(`${count} ${type} processors — consider consolidating.`);
    }
  }

  if (suggestions.length === 0) {
    suggestions.push('Chain looks clean — no redundancies detected.');
  }

  return ok({ trackId, suggestions });
}

// --- raise_decision ---

function handleRaiseDecision(args: Record<string, unknown>): ToolResult {
  const decision = {
    id: `decision-${Date.now()}`,
    question: args.question as string,
    context: args.context as string | undefined,
    options: args.options as string[] | undefined,
    trackIds: args.trackIds as string[] | undefined,
    raisedAt: Date.now(),
    resolved: false,
  };
  const openDecisions = [...(session.openDecisions ?? []), decision];
  session = { ...session, openDecisions };
  return ok({ raised: decision.id, question: decision.question });
}

// --- report_bug ---

function handleReportBug(args: Record<string, unknown>): ToolResult {
  const bug = {
    id: `bug-${Date.now()}`,
    summary: args.summary as string,
    category: args.category as string,
    details: args.details as string,
    severity: args.severity as string,
    context: args.context as string | undefined,
    timestamp: Date.now(),
  };
  const bugReports = [...(session.bugReports ?? []), bug];
  session = { ...session, bugReports };
  return ok({ reported: bug.id, summary: bug.summary });
}

// --- Stub handlers for recipe/role tools ---

function handleSetMixRole(args: Record<string, unknown>): ToolResult {
  return ok({
    note: 'Mix role presets require the full engine. Noted for: ' +
      resolveTrackId(args.trackId as string) + ' role=' + args.role,
  });
}

function handleApplyChainRecipe(args: Record<string, unknown>): ToolResult {
  return ok({
    note: 'Chain recipes require the full engine. Noted for: ' +
      resolveTrackId(args.trackId as string) + ' recipe=' + args.recipe,
  });
}

function handleApplyModulation(args: Record<string, unknown>): ToolResult {
  return ok({
    note: 'Modulation recipes require the full engine. Noted for: ' +
      resolveTrackId(args.trackId as string) + ' recipe=' + args.recipe,
  });
}

function handleShapeTimbre(args: Record<string, unknown>): ToolResult {
  return ok({
    note: 'Timbral shaping requires the full engine vocabulary. Noted for: ' +
      resolveTrackId(args.trackId as string) + ' direction=' + args.direction,
  });
}

// ---------------------------------------------------------------------------
// Convert Gluon tool schemas to MCP tool listing format
// ---------------------------------------------------------------------------

function gluonSchemaToMcpTool(tool: GluonToolSchema) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: {
      type: 'object' as const,
      properties: (tool.parameters.properties ?? {}) as Record<string, unknown>,
      required: (tool.parameters.required ?? []) as string[],
    },
  };
}

// Add our custom get_session_state tool
const getSessionStateTool = {
  name: 'get_session_state',
  description:
    'Return the current Gluon session state as JSON. Includes all tracks, transport, master, scale, intent, and section metadata.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
    required: [] as string[],
  },
};

// ---------------------------------------------------------------------------
// MCP Server setup
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'gluon', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

// tools/list handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const mcpTools = [
    getSessionStateTool,
    ...GLUON_TOOLS.map(gluonSchemaToMcpTool),
  ];
  return { tools: mcpTools };
});

// tools/call handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleTool(name, (args ?? {}) as Record<string, unknown>);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('Gluon MCP server running on stdio\n');
}

main().catch(e => {
  process.stderr.write(`Gluon MCP server fatal: ${e}\n`);
  process.exit(1);
});
