// src/engine/persistence.ts
import type { Session, Track, ProcessorConfig, ModulatorConfig, ModulationRouting } from './types';
import { DEFAULT_MASTER, MASTER_BUS_ID } from './types';
import type { Pattern } from './canonical-types';
import { createSession, createBusTrack } from './session';
import { stepsToEvents } from './event-conversion';
import { reprojectTrackStepGrid } from './region-projection';
import { createDefaultPattern } from './region-helpers';
import { controlIdToRuntimeParam, getRegisteredModulatorTypes, getRegisteredProcessorTypes } from '../audio/instrument-registry';
import type { InverseConversionOptions } from './event-conversion';
import { migrateLegacySurface } from './surface-templates';
import { isValidModuleType, validateModuleBindings } from './surface-module-registry';

const STORAGE_KEY = 'gluon-session';
export const CURRENT_VERSION = 6;
export const MAX_PERSISTED_UNDO = 50;

/**
 * Remove duplicate entries from an array by a key extractor.
 * Keeps the first occurrence of each key and warns about dropped duplicates.
 */
export function deduplicateById<T>(
  items: T[],
  keyFn: (item: T) => string,
  context: string,
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) {
      console.warn(`[persistence] ${context}: dropping duplicate id "${key}"`);
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

interface PersistedSession {
  version: number;
  session: Session;
  savedAt: number;
}

/** Default inverse options for re-projecting step-grid from patterns on load. */
const defaultInverseOpts: InverseConversionOptions = {
  canonicalToRuntime: (id: string) => controlIdToRuntimeParam[id] ?? id,
};

/** Trim undo stack to most recent entries and strip recentHumanActions before saving. */
export function stripForPersistence(session: Session): Session {
  return {
    ...session,
    transportCommand: undefined,
    undoStack: session.undoStack.slice(-MAX_PERSISTED_UNDO),
    redoStack: [],
    recentHumanActions: [],
    // Always persist transport as stopped to avoid auto-playing on reload
    transport: { ...session.transport, status: 'stopped' },
    tracks: session.tracks.map(v => ({ ...v })),
    // Strip listenEvents from messages — blob URLs can't survive page reload
    messages: session.messages.map(m =>
      m.listenEvents ? { ...m, listenEvents: undefined } : m
    ),
  };
}

/**
 * Check whether a session differs from the default enough to be worth saving.
 */
function isNonDefault(session: Session): boolean {
  // Compare the exact persisted shape rather than a hand-maintained subset.
  // This avoids silently dropping newer metadata fields when saveSession decides
  // whether a write is necessary.
  return JSON.stringify(stripForPersistence(session))
    !== JSON.stringify(stripForPersistence(createSession()));
}

/** Validate that a loaded object looks like a Session. */
export function isValidSession(obj: unknown): obj is Session {
  if (typeof obj !== 'object' || obj === null) return false;
  const s = obj as Record<string, unknown>;
  return (
    Array.isArray(s.tracks) &&
    s.tracks.length > 0 &&
    typeof s.activeTrackId === 'string' &&
    typeof s.transport === 'object' &&
    s.transport !== null &&
    Array.isArray(s.messages)
  );
}

/**
 * Hydrate patterns for a track that was saved without them (v1 legacy).
 * Converts step-grid to canonical events in a default pattern.
 */
function hydratePatternsFromStepGrid(track: Record<string, unknown>): Pattern[] {
  const stepGrid = track.stepGrid as { steps: unknown[]; length: number } | undefined
    ?? track.pattern as { steps: unknown[]; length: number } | undefined;
  if (!stepGrid?.steps?.length) return [createDefaultPattern(track.id as string, 16)];
  const events = stepsToEvents(stepGrid.steps as import('./sequencer-types').Step[]);
  const pattern = createDefaultPattern(track.id as string, stepGrid.length);
  return [{ ...pattern, events }];
}

/**
 * Migrate a v5 track (with regions) to v6 (with patterns + sequence).
 * Strips `start` and `loop` from regions, builds sequence from sorted order.
 * Lossy for gaps/overlaps — logs warnings.
 */
function migrateV5Regions(track: Record<string, unknown>): { patterns: Pattern[]; sequence: import('./sequencer-types').PatternRef[] } {
  const regions = track.regions as Array<Record<string, unknown>> | undefined;
  if (!regions || !Array.isArray(regions) || regions.length === 0) {
    const defaultPat = createDefaultPattern(track.id as string, 16);
    return { patterns: [defaultPat], sequence: [{ patternId: defaultPat.id }] };
  }

  // Sort by start ascending
  const sorted = [...regions].sort((a, b) => ((a.start as number) ?? 0) - ((b.start as number) ?? 0));

  // Check for gaps/overlaps and warn
  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];
    const currEnd = ((curr.start as number) ?? 0) + ((curr.duration as number) ?? 16);
    const nextStart = (next.start as number) ?? 0;
    if (Math.abs(nextStart - currEnd) > 0.001) {
      console.warn(`[persistence] Track ${track.id}: v5→v6 migration lossy — region gap/overlap between ${curr.id} (end=${currEnd}) and ${next.id} (start=${nextStart}). Serializing as contiguous.`);
    }
  }

  // Convert regions to patterns (strip start and loop)
  const patterns: Pattern[] = sorted.map(r => ({
    id: r.id as string,
    kind: (r.kind as Pattern['kind']) ?? 'pattern',
    duration: (r.duration as number) ?? 16,
    name: r.name as string | undefined,
    events: (r.events as Pattern['events']) ?? [],
  }));

  // Build sequence from sorted order
  const sequence = sorted.map(r => ({ patternId: r.id as string }));

  return { patterns, sequence };
}

/**
 * Ensure track has valid patterns and re-project step-grid from patterns.
 * Handles v1 (no regions), v5 (regions with start/loop), and v6 (patterns + sequence).
 */
export function migrateTrack(track: Track): Track {
  // Use 'as any' to read legacy fields that may exist on persisted data
  const raw = track as unknown as Record<string, unknown>;
  let patterns: Pattern[];
  let sequence: import('./sequencer-types').PatternRef[];

  // Check if this is a v5 track with regions (has .regions but no .sequence)
  if (raw.regions && Array.isArray(raw.regions) && (raw.regions as unknown[]).length > 0 && !raw.sequence) {
    const migrated = migrateV5Regions(raw);
    patterns = migrated.patterns;
    sequence = migrated.sequence;
  } else if (track.patterns && Array.isArray(track.patterns) && track.patterns.length > 0) {
    // v6 or already migrated
    patterns = track.patterns;
    sequence = track.sequence ?? track.patterns.map(p => ({ patternId: p.id }));
  } else {
    // No patterns — hydrate from step-grid if available
    patterns = hydratePatternsFromStepGrid(raw);
    sequence = patterns.map(p => ({ patternId: p.id }));
  }

  // #1143: Filter dangling pattern sequence refs — only keep entries whose patternId exists.
  {
    const patternIds = new Set(patterns.map(p => p.id));
    const filtered = sequence.filter(ref => patternIds.has(ref.patternId));
    if (filtered.length !== sequence.length) {
      console.warn(`[persistence] Track ${track.id}: stripped ${sequence.length - filtered.length} dangling sequence ref(s)`);
    }
    // If sequence is now empty, rebuild from all pattern IDs
    sequence = filtered.length > 0 ? filtered : patterns.map(p => ({ patternId: p.id }));
  }

  // Validate patterns have events arrays
  if (patterns[0] && (!patterns[0].events || !Array.isArray(patterns[0].events))) {
    console.warn(`[persistence] Track ${track.id}: invalid patterns, hydrating from step-grid`);
    patterns = hydratePatternsFromStepGrid(raw);
    sequence = patterns.map(p => ({ patternId: p.id }));
  }

  // #1146: Validate pattern invariants — ensure duration > 0, events are valid
  patterns = patterns.map(p => {
    const duration = (typeof p.duration === 'number' && p.duration > 0) ? p.duration : 16;
    const events = Array.isArray(p.events)
      ? p.events.filter(e => {
          if (typeof e.at !== 'number' || e.at < 0 || e.at >= duration) return false;
          if (e.kind === 'note') {
            const n = e as import('./canonical-types').NoteEvent;
            if (typeof n.pitch !== 'number' || n.pitch < 0 || n.pitch > 127) return false;
            if (typeof n.velocity !== 'number' || n.velocity < 0 || n.velocity > 1) return false;
            if (typeof n.duration !== 'number' || n.duration <= 0) return false;
          }
          if (e.kind === 'trigger') {
            const t = e as import('./canonical-types').TriggerEvent;
            if (t.velocity != null && (typeof t.velocity !== 'number' || t.velocity < 0 || t.velocity > 1)) return false;
          }
          if (e.kind === 'parameter') {
            const pe = e as import('./canonical-types').ParameterEvent;
            if (typeof pe.controlId !== 'string' || pe.controlId === '') return false;
          }
          return true;
        })
      : [];
    if (events.length !== (p.events?.length ?? 0)) {
      console.warn(`[persistence] Track ${track.id}: stripped ${(p.events?.length ?? 0) - events.length} invalid events from pattern ${p.id}`);
    }
    if (duration !== p.duration) {
      console.warn(`[persistence] Track ${track.id}: fixed invalid duration on pattern ${p.id} (was ${p.duration}, set to ${duration})`);
    }
    return { ...p, duration, events };
  });

  // Hydrate per-track volume/pan for tracks without them
  const migrated: Record<string, unknown> = { ...track, patterns, sequence };
  if ((migrated.volume as number | undefined) == null) migrated.volume = 0.8;
  if ((migrated.pan as number | undefined) == null) migrated.pan = 0.0;

  // Rename legacy field names
  if (migrated.activeRegionId && !migrated.activePatternId) {
    migrated.activePatternId = migrated.activeRegionId;
  }
  delete migrated.activeRegionId;
  delete migrated.regions;
  // Rename legacy stepGrid field
  if (migrated.pattern && !migrated.stepGrid) {
    migrated.stepGrid = migrated.pattern;
  }
  delete migrated.pattern;

  let surfaced = migrated as unknown as Track;

  // Hydrate surface for tracks without one, or migrate legacy format
  if (!surfaced.surface) {
    surfaced = {
      ...surfaced,
      surface: {
        modules: [],
        thumbprint: { type: 'static-color' },
      },
    };
  } else if ('semanticControls' in surfaced.surface) {
    // Legacy surface with semanticControls/pinnedControls/xyAxes — migrate to modules
    surfaced = {
      ...surfaced,
      surface: migrateLegacySurface(
        surfaced.surface as unknown as Record<string, unknown>,
        surfaced.id,
      ),
    };
  }

  // #1147: Validate Surface modules — strip unknown types, ensure valid positions
  if (surfaced.surface?.modules?.length) {
    const validatedModules = surfaced.surface.modules.filter(mod => {
      if (!isValidModuleType(mod.type)) {
        console.warn(`[persistence] Track ${surfaced.id}: stripping surface module '${mod.id}' with unknown type '${mod.type}'`);
        return false;
      }
      return true;
    }).map(mod => {
      // Ensure position has valid x/y/w/h (non-negative integers, w/h > 0)
      const pos = mod.position;
      const needsFix = (
        typeof pos?.x !== 'number' || typeof pos?.y !== 'number' ||
        typeof pos?.w !== 'number' || typeof pos?.h !== 'number' ||
        pos.x < 0 || pos.y < 0 || pos.w <= 0 || pos.h <= 0
      );
      if (needsFix) {
        console.warn(`[persistence] Track ${surfaced.id}: fixing invalid position on surface module '${mod.id}'`);
        return {
          ...mod,
          position: {
            x: (typeof pos?.x === 'number' && pos.x >= 0) ? pos.x : 0,
            y: (typeof pos?.y === 'number' && pos.y >= 0) ? pos.y : 0,
            w: (typeof pos?.w === 'number' && pos.w > 0) ? pos.w : 2,
            h: (typeof pos?.h === 'number' && pos.h > 0) ? pos.h : 2,
          },
        };
      }
      return mod;
    });
    surfaced = {
      ...surfaced,
      surface: { ...surfaced.surface, modules: validatedModules },
    };
  }

  // Migrate old approval field to claimed boolean
  if (surfaced.approval && surfaced.approval !== 'exploratory' && surfaced.claimed === undefined) {
    surfaced = { ...surfaced, claimed: true };
  }
  // Hydrate claimed for tracks without one
  if (surfaced.claimed === undefined) {
    surfaced = { ...surfaced, claimed: false };
  }

  // Hydrate kind — only infer master bus here; non-master legacy tracks
  // get classified in restoreSession with cross-track context (#1142).
  if (!surfaced.kind) {
    if (surfaced.id === MASTER_BUS_ID) {
      surfaced = { ...surfaced, kind: 'bus' as const };
    }
    // else: leave kind undefined — restoreSession will classify with send context
  }
  if (!surfaced.sends) {
    surfaced = { ...surfaced, sends: [] };
  }

  // Validate processors — strip unknown types that would leave a dead runtime node
  const registeredProcTypes = getRegisteredProcessorTypes();
  const rawProcessors = surfaced.processors ?? [];
  const validProcessors = rawProcessors.filter((p: ProcessorConfig) => {
    if (registeredProcTypes.includes(p.type)) return true;
    console.warn(`[persistence] Track ${surfaced.id}: stripping unknown processor type "${p.type}"`);
    return false;
  });
  surfaced = { ...surfaced, processors: validProcessors };

  // Validate modulators
  const registeredModTypes = getRegisteredModulatorTypes();
  const validModulators = (surfaced.modulators ?? []).filter(
    (m: ModulatorConfig) => registeredModTypes.includes(m.type),
  );
  const validModulatorIds = new Set(validModulators.map((m: ModulatorConfig) => m.id));
  const validProcessorIds = new Set(validProcessors.map((p: ProcessorConfig) => p.id));
  const validModulations = (surfaced.modulations ?? []).filter(
    (r: ModulationRouting) => {
      if (!validModulatorIds.has(r.modulatorId)) return false;
      // #1145: Filter modulation routes targeting missing processors
      if (r.target.kind === 'processor' && !validProcessorIds.has(r.target.processorId)) {
        console.warn(`[persistence] Track ${surfaced.id}: stripping modulation route "${r.id}" targeting missing processor "${r.target.processorId}"`);
        return false;
      }
      return true;
    },
  );
  surfaced = { ...surfaced, modulators: validModulators, modulations: validModulations };

  // --- Deduplicate per-track collections (#1155-#1162) ---
  const ctx = `Track ${surfaced.id}`;

  // #1156: processors and modulators
  if (surfaced.processors) {
    surfaced = { ...surfaced, processors: deduplicateById(surfaced.processors, p => p.id, `${ctx} processors`) };
  }
  surfaced = { ...surfaced, modulators: deduplicateById(surfaced.modulators ?? [], m => m.id, `${ctx} modulators`) };

  // #1160: modulation routes
  surfaced = { ...surfaced, modulations: deduplicateById(surfaced.modulations ?? [], r => r.id, `${ctx} modulations`) };

  // #1158: patterns
  surfaced = { ...surfaced, patterns: deduplicateById(surfaced.patterns, p => p.id, `${ctx} patterns`) };

  // #1162: sequencer views
  if (surfaced.views) {
    surfaced = { ...surfaced, views: deduplicateById(surfaced.views, v => v.id, `${ctx} views`) };
  }

  // #1159: surface modules
  if (surfaced.surface?.modules) {
    surfaced = {
      ...surfaced,
      surface: {
        ...surfaced.surface,
        modules: deduplicateById(surfaced.surface.modules, m => m.id, `${ctx} surface modules`),
      },
    };
  }

  // #1154: fix cross-track binding trackIds — the Surface renderer only supports
  // the owning track, so coerce any mismatched trackIds to the owning track's ID.
  if (surfaced.surface?.modules) {
    const fixedModules = surfaced.surface.modules.map(mod => {
      const needsFix = mod.bindings.some(b => b.trackId !== '' && b.trackId !== surfaced.id);
      if (!needsFix) return mod;
      console.warn(`[persistence] ${ctx}: fixing cross-track binding trackIds in module '${mod.id}'`);
      return {
        ...mod,
        bindings: mod.bindings.map(b =>
          b.trackId !== '' && b.trackId !== surfaced.id
            ? { ...b, trackId: surfaced.id }
            : b,
        ),
      };
    });
    surfaced = {
      ...surfaced,
      surface: { ...surfaced.surface, modules: fixedModules },
    };
  }

  // #1157: drum pad IDs
  if (surfaced.drumRack?.pads) {
    surfaced = {
      ...surfaced,
      drumRack: {
        ...surfaced.drumRack,
        pads: deduplicateById(surfaced.drumRack.pads, p => p.id, `${ctx} drum pads`),
      },
    };
  }

  // #1161: duplicate sends to the same bus
  if (surfaced.sends) {
    surfaced = { ...surfaced, sends: deduplicateById(surfaced.sends, s => s.busId, `${ctx} sends`) };
  }

  // Always re-project step-grid from patterns (step-grid is derived, never trusted from save)
  return reprojectTrackStepGrid(surfaced, defaultInverseOpts);
}

export function saveSession(session: Session): void {
  if (!isNonDefault(session)) return;
  try {
    const data: PersistedSession = {
      version: CURRENT_VERSION,
      session: stripForPersistence(session),
      savedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage full or unavailable — silent fail
  }
}

/**
 * Restore a persisted session into the normalized runtime shape expected by the app.
 * This is the shared contract for legacy localStorage load, IndexedDB project load,
 * and imported project files.
 */
export function restoreSession(session: Session, persistedVersion: number = CURRENT_VERSION): Session {
  // #1155: deduplicate track IDs (keep first occurrence)
  let migratedTracks = deduplicateById(session.tracks.map(migrateTrack), t => t.id, 'Session tracks');

  // Ensure a master bus exists across all persisted load paths.
  if (!migratedTracks.some(t => t.id === MASTER_BUS_ID)) {
    migratedTracks = [...migratedTracks, createBusTrack(MASTER_BUS_ID, 'Master')];
  }

  // #1142: Classify legacy tracks that were saved without `kind`.
  // migrateTrack leaves kind undefined for non-master tracks when the persisted data
  // had no kind field. Use cross-track context to detect buses: a track with no source
  // engine (engine === '', model === -1) that receives sends from other tracks is a bus.
  // All remaining undefined-kind tracks default to 'audio'.
  {
    const sendTargetIds = new Set<string>();
    for (const t of migratedTracks) {
      for (const s of t.sends ?? []) {
        sendTargetIds.add(s.busId);
      }
    }
    migratedTracks = migratedTracks.map(t => {
      if (t.kind) return t; // already classified
      if (t.engine === '' && t.model === -1 && sendTargetIds.has(t.id)) {
        console.warn(`[persistence] Reclassifying track "${t.id}" as bus (no source, receives sends)`);
        return { ...t, kind: 'bus' as const };
      }
      return { ...t, kind: 'audio' as const }; // default
    });
  }

  // #1141: Reset stale activeTrackId — if it doesn't match any track, fall back to first track.
  let activeTrackId = session.activeTrackId;
  if (!migratedTracks.some(t => t.id === activeTrackId)) {
    console.warn(`[persistence] Stale activeTrackId "${activeTrackId}" — resetting to "${migratedTracks[0].id}"`);
    activeTrackId = migratedTracks[0].id;
  }

  // #1144: Validate send targets and sidechain refs now that all tracks are migrated.
  const allTrackIds = new Set(migratedTracks.map(t => t.id));
  const busTrackIds = new Set(migratedTracks.filter(t => t.kind === 'bus').map(t => t.id));
  migratedTracks = migratedTracks.map(t => {
    let changed = false;
    // Filter sends to only those targeting existing bus tracks
    let sends = t.sends;
    if (sends && sends.length > 0) {
      const filtered = sends.filter(s => busTrackIds.has(s.busId));
      if (filtered.length !== sends.length) {
        console.warn(`[persistence] Track ${t.id}: stripped ${sends.length - filtered.length} send(s) targeting non-existent bus`);
        sends = filtered;
        changed = true;
      }
    }
    // Clear sidechainSourceId on compressor processors when source track doesn't exist
    let processors = t.processors;
    if (processors) {
      const fixedProcessors = processors.map(p => {
        if (p.sidechainSourceId && !allTrackIds.has(p.sidechainSourceId)) {
          console.warn(`[persistence] Track ${t.id}: clearing stale sidechainSourceId "${p.sidechainSourceId}" on processor "${p.id}"`);
          changed = true;
          const { sidechainSourceId: _, ...rest } = p;
          return rest as ProcessorConfig;
        }
        return p;
      });
      if (changed) processors = fixedProcessors;
    }
    return changed ? { ...t, sends, processors } : t;
  });

  // Clear undo/redo on v5→v6 migration (old snapshots reference removed fields).
  const clearUndo = persistedVersion < 6;
  if (clearUndo) {
    console.warn('[persistence] v5→v6 migration: clearing undo/redo stacks (old snapshots incompatible)');
  }

  // #1196: Scrub expandedTrackIds against surviving tracks
  const survivingIds = new Set(migratedTracks.map(t => t.id));
  const expandedTrackIds = (session.expandedTrackIds ?? []).filter(id => survivingIds.has(id));

  // #1198: Scrub openDecisions trackIds against surviving tracks
  const openDecisions = (session.openDecisions ?? []).map(d => {
    if (!d.trackIds) return d;
    const filtered = d.trackIds.filter(id => survivingIds.has(id));
    if (filtered.length === d.trackIds.length) return d;
    if (filtered.length === 0) {
      const { trackIds: _, ...rest } = d;
      return rest;
    }
    return { ...d, trackIds: filtered };
  });

  return {
    ...session,
    activeTrackId,
    transport: {
      ...session.transport,
      status: session.transport.status ?? (session.transport.playing ? 'playing' : 'stopped'),
      metronome: session.transport.metronome ?? { enabled: false, volume: 0.5 },
      timeSignature: session.transport.timeSignature ?? { numerator: 4, denominator: 4 },
      mode: session.transport.mode ?? 'pattern',
    },
    tracks: migratedTracks as Track[],
    master: session.master ?? { ...DEFAULT_MASTER },
    undoStack: clearUndo ? [] : (session.undoStack ?? []),
    redoStack: clearUndo ? [] : (session.redoStack ?? []),
    recentHumanActions: session.recentHumanActions ?? [],
    reactionHistory: session.reactionHistory ?? [],
    expandedTrackIds,
    openDecisions,
    memories: session.memories ?? [],
  };
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data: PersistedSession = JSON.parse(raw);

    // Reject unknown future versions
    if (data.version > CURRENT_VERSION) return null;
    if (!isValidSession(data.session)) return null;

    return restoreSession(data.session, data.version);
  } catch {
    return null;
  }
}

export function clearSavedSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}
