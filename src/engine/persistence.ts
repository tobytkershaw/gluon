// src/engine/persistence.ts
import type { Session, Track, ModulatorConfig, ModulationRouting } from './types';
import { DEFAULT_MASTER, MASTER_BUS_ID } from './types';
import type { Pattern } from './canonical-types';
import { createSession, createBusTrack } from './session';
import { stepsToEvents } from './event-conversion';
import { reprojectTrackStepGrid } from './region-projection';
import { createDefaultPattern } from './region-helpers';
import { controlIdToRuntimeParam, getRegisteredModulatorTypes } from '../audio/instrument-registry';
import type { InverseConversionOptions } from './event-conversion';

const STORAGE_KEY = 'gluon-session';
export const CURRENT_VERSION = 6;
export const MAX_PERSISTED_UNDO = 50;

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
  const defaults = createSession();
  if (session.tracks.length !== defaults.tracks.length) return true;
  if (session.messages.length > 0) return true;
  if (session.transport.bpm !== defaults.transport.bpm) return true;
  if (session.transport.swing !== defaults.transport.swing) return true;
  for (let i = 0; i < session.tracks.length; i++) {
    const v = session.tracks[i];
    const d = defaults.tracks[i];
    if (!v || !d) continue;
    if (v.agency !== d.agency) return true;
    if (v.model !== d.model) return true;
    if (v.muted !== d.muted || v.solo !== d.solo) return true;
    if (v.volume !== d.volume || v.pan !== d.pan) return true;
    if (v.params.timbre !== d.params.timbre || v.params.morph !== d.params.morph) return true;
    if (v.params.harmonics !== d.params.harmonics || v.params.note !== d.params.note) return true;
    // Check patterns for content
    if (v.patterns.some(p => p.events.length > 0)) return true;
    // Fallback: check step-grid for content
    if (v.stepGrid.length !== d.stepGrid.length) return true;
    for (const step of v.stepGrid.steps) {
      if (step.gate || step.accent || step.micro !== 0 || step.params) return true;
    }
  }
  return false;
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

  // Validate patterns have events arrays
  if (patterns[0] && (!patterns[0].events || !Array.isArray(patterns[0].events))) {
    console.warn(`[persistence] Track ${track.id}: invalid patterns, hydrating from step-grid`);
    patterns = hydratePatternsFromStepGrid(raw);
    sequence = patterns.map(p => ({ patternId: p.id }));
  }

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

  // Hydrate surface for tracks without one
  if (!surfaced.surface) {
    surfaced = {
      ...surfaced,
      surface: {
        semanticControls: [],
        pinnedControls: [],
        xyAxes: { x: 'timbre', y: 'morph' },
        thumbprint: { type: 'static-color' },
      },
    };
  }

  // Hydrate approval for tracks without one
  if (!surfaced.approval) {
    surfaced = { ...surfaced, approval: 'exploratory' };
  }

  // Hydrate kind and sends
  if (!surfaced.kind) {
    surfaced = { ...surfaced, kind: surfaced.id === MASTER_BUS_ID ? 'bus' : 'audio' };
  }
  if (!surfaced.sends) {
    surfaced = { ...surfaced, sends: [] };
  }

  // Validate modulators
  const registeredModTypes = getRegisteredModulatorTypes();
  const validModulators = (surfaced.modulators ?? []).filter(
    (m: ModulatorConfig) => registeredModTypes.includes(m.type),
  );
  const validModulatorIds = new Set(validModulators.map((m: ModulatorConfig) => m.id));
  const validModulations = (surfaced.modulations ?? []).filter(
    (r: ModulationRouting) => validModulatorIds.has(r.modulatorId),
  );
  surfaced = { ...surfaced, modulators: validModulators, modulations: validModulations };

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
  let migratedTracks = session.tracks.map(migrateTrack);

  // Ensure a master bus exists across all persisted load paths.
  if (!migratedTracks.some(t => t.id === MASTER_BUS_ID)) {
    migratedTracks = [...migratedTracks, createBusTrack(MASTER_BUS_ID, 'Master')];
  }

  // Clear undo/redo on v5→v6 migration (old snapshots reference removed fields).
  const clearUndo = persistedVersion < 6;
  if (clearUndo) {
    console.warn('[persistence] v5→v6 migration: clearing undo/redo stacks (old snapshots incompatible)');
  }

  return {
    ...session,
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
    openDecisions: session.openDecisions ?? [],
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
