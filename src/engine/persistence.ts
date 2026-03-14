// src/engine/persistence.ts
import type { Session, Track, ModulatorConfig, ModulationRouting } from './types';
import { DEFAULT_MASTER } from './types';
import type { Region } from './canonical-types';
import { createSession } from './session';
import { stepsToEvents } from './event-conversion';
import { reprojectTrackPattern } from './region-projection';
import { createDefaultRegion } from './region-helpers';
import { controlIdToRuntimeParam, getRegisteredModulatorTypes } from '../audio/instrument-registry';
import type { InverseConversionOptions } from './event-conversion';

const STORAGE_KEY = 'gluon-session';
export const CURRENT_VERSION = 4;
export const MAX_PERSISTED_UNDO = 50;

interface PersistedSession {
  version: number;
  session: Session;
  savedAt: number;
}

/** Default inverse options for re-projecting pattern from regions on load. */
const defaultInverseOpts: InverseConversionOptions = {
  canonicalToRuntime: (id: string) => controlIdToRuntimeParam[id] ?? id,
};

/** Trim undo stack to most recent entries and strip recentHumanActions before saving. */
export function stripForPersistence(session: Session): Session {
  return {
    ...session,
    undoStack: session.undoStack.slice(-MAX_PERSISTED_UNDO),
    recentHumanActions: [],
    // Always persist transport as stopped to avoid auto-playing on reload
    transport: { ...session.transport, playing: false },
    tracks: session.tracks.map(v => ({ ...v })),
  };
}

/**
 * Check whether a session differs from the default enough to be worth saving.
 *
 * NOTE(#215): The param checks below are hardcoded to {timbre, morph, harmonics, note}.
 * If future engines add params beyond these, this function won't detect their changes
 * as non-default. This is acceptable since the function is a save-avoidance heuristic
 * (legacy path) — worst case is an unnecessary no-op save, not data loss.
 */
function isNonDefault(session: Session): boolean {
  const defaults = createSession();
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
    if (v.params.timbre !== d.params.timbre || v.params.morph !== d.params.morph) return true;
    if (v.params.harmonics !== d.params.harmonics || v.params.note !== d.params.note) return true;
    // Check regions for content
    if (v.regions.length > 0 && v.regions[0].events.length > 0) return true;
    // Fallback: check pattern for content (covers legacy or direct pattern edits)
    if (v.pattern.length !== d.pattern.length) return true;
    for (const step of v.pattern.steps) {
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
 * Hydrate regions for a track that was saved without them (v1 legacy).
 * Converts step-grid pattern to canonical events in a default region.
 */
function hydrateRegionsFromPattern(track: Track): Region[] {
  const events = stepsToEvents(track.pattern.steps);
  const region = createDefaultRegion(track.id, track.pattern.length);
  return [{ ...region, events }];
}

/**
 * Ensure track has valid regions and re-project pattern from regions.
 * Recovery hierarchy:
 * 1. Regions present and valid → use as-is, re-project pattern
 * 2. Regions missing but pattern exists → hydrate regions from pattern
 * 3. Regions invalid but pattern exists → warn, hydrate from pattern
 * 4. Neither recoverable → fall back to empty default region
 */
export function migrateTrack(track: Track): Track {
  let regions = track.regions;

  if (!regions || !Array.isArray(regions) || regions.length === 0) {
    // No regions — hydrate from pattern if available
    if (track.pattern?.steps?.length > 0) {
      regions = hydrateRegionsFromPattern(track);
    } else {
      regions = [createDefaultRegion(track.id, 16)];
    }
  } else if (regions[0] && (!regions[0].events || !Array.isArray(regions[0].events))) {
    // Regions present but invalid
    console.warn(`[persistence] Track ${track.id}: invalid regions, hydrating from pattern`);
    if (track.pattern?.steps?.length > 0) {
      regions = hydrateRegionsFromPattern(track);
    } else {
      regions = [createDefaultRegion(track.id, 16)];
    }
  }

  // Hydrate surface for tracks without one (v2 → v3 migration)
  let surfaced = { ...track, regions };
  if (!surfaced.surface) {
    surfaced = {
      ...surfaced,
      surface: {
        semanticControls: [],
        pinnedControls: [],
        xyAxes: { x: 'brightness', y: 'texture' },
        thumbprint: { type: 'static-color' },
      },
    };
  }

  // Validate modulators: strip unknown types and dangling modulation references
  const registeredModTypes = getRegisteredModulatorTypes();
  const validModulators = (surfaced.modulators ?? []).filter(
    (m: ModulatorConfig) => registeredModTypes.includes(m.type),
  );
  const validModulatorIds = new Set(validModulators.map((m: ModulatorConfig) => m.id));
  const validModulations = (surfaced.modulations ?? []).filter(
    (r: ModulationRouting) => validModulatorIds.has(r.modulatorId),
  );
  surfaced = { ...surfaced, modulators: validModulators, modulations: validModulations };

  // Always re-project pattern from regions (pattern is derived, never trusted from save)
  return reprojectTrackPattern(surfaced, defaultInverseOpts);
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

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data: PersistedSession = JSON.parse(raw);

    // Reject unknown future versions
    if (data.version > CURRENT_VERSION) return null;
    if (!isValidSession(data.session)) return null;

    // Migrate all tracks (handles both v1 and v2)
    const session = data.session;
    const migratedTracks = session.tracks.map(migrateTrack);

    return {
      ...session,
      tracks: migratedTracks,
      master: session.master ?? { ...DEFAULT_MASTER },
      undoStack: session.undoStack ?? [],
      recentHumanActions: session.recentHumanActions ?? [],
    };
  } catch {
    return null;
  }
}

export function clearSavedSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}
