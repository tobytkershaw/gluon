// src/engine/tension-curve.ts — Tension/energy curve: compositional energy as a continuous function.
//
// The tension curve is metadata/intent — it does NOT directly control audio parameters.
// It's data the AI uses when composing (e.g., "energy at bar 17 is 0.6, so use moderate density").

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single point on the tension curve. */
export interface TensionPoint {
  /** Bar number (1-based). */
  bar: number;
  /** Energy level at this bar (0.0–1.0). */
  energy: number;
  /** Rhythmic density at this bar (0.0–1.0). */
  density: number;
}

/** How a single track parameter responds to the tension curve. */
export interface TrackTensionParamMapping {
  /** The control ID or parameter name. */
  param: string;
  /** Minimum value when energy is 0. */
  low: number;
  /** Maximum value when energy is 1. */
  high: number;
}

/** How a track responds to the tension curve overall. */
export interface TrackTensionMapping {
  /** Track ID this mapping applies to. */
  trackId: string;
  /** Energy threshold below which this track should be inactive (0.0–1.0). */
  activationThreshold?: number;
  /** Per-parameter response curves. */
  params: TrackTensionParamMapping[];
}

/** The full tension curve: points + track mappings. */
export interface TensionCurve {
  /** Sorted array of tension points (by bar). */
  points: TensionPoint[];
  /** Per-track mappings defining how tracks respond to the curve. */
  trackMappings: TrackTensionMapping[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp a value to 0–1. */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Sort points by bar, deduplicate (last wins for same bar). */
function normalizePoints(points: TensionPoint[]): TensionPoint[] {
  const byBar = new Map<number, TensionPoint>();
  for (const p of points) {
    byBar.set(p.bar, {
      bar: p.bar,
      energy: clamp01(p.energy),
      density: clamp01(p.density),
    });
  }
  return Array.from(byBar.values()).sort((a, b) => a.bar - b.bar);
}

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

/**
 * Linearly interpolate between two values.
 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Interpolate tension values at a given bar position.
 *
 * - If the curve is empty, returns { energy: 0.5, density: 0.5 } (neutral).
 * - If the bar is before the first point, returns the first point's values.
 * - If the bar is after the last point, returns the last point's values.
 * - Otherwise, linearly interpolates between surrounding points.
 */
export function interpolateTension(
  points: TensionPoint[],
  bar: number,
): { energy: number; density: number } {
  if (points.length === 0) {
    return { energy: 0.5, density: 0.5 };
  }

  if (points.length === 1 || bar <= points[0].bar) {
    return { energy: points[0].energy, density: points[0].density };
  }

  const last = points[points.length - 1];
  if (bar >= last.bar) {
    return { energy: last.energy, density: last.density };
  }

  // Find surrounding points
  let lo = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].bar >= bar) {
      lo = i - 1;
      break;
    }
  }
  const hi = lo + 1;
  const a = points[lo];
  const b = points[hi];

  const t = (bar - a.bar) / (b.bar - a.bar);
  return {
    energy: lerp(a.energy, b.energy, t),
    density: lerp(a.density, b.density, t),
  };
}

// ---------------------------------------------------------------------------
// Track mapping resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a track's parameter values given the tension at a specific bar.
 * Returns an array of { param, value } entries, or empty array if no mapping exists.
 */
export function resolveTrackTension(
  mapping: TrackTensionMapping,
  energy: number,
  _density: number,
): { param: string; value: number; active: boolean }[] {
  const active = mapping.activationThreshold === undefined
    || energy >= mapping.activationThreshold;

  return mapping.params.map(pm => ({
    param: pm.param,
    value: active ? lerp(pm.low, pm.high, clamp01(energy)) : pm.low,
    active,
  }));
}

// ---------------------------------------------------------------------------
// TensionCurve management
// ---------------------------------------------------------------------------

/** Create an empty tension curve. */
export function createTensionCurve(): TensionCurve {
  return { points: [], trackMappings: [] };
}

/** Set points on a tension curve (replaces existing points). Returns a new curve. */
export function setTensionPoints(curve: TensionCurve, points: TensionPoint[]): TensionCurve {
  return { ...curve, points: normalizePoints(points) };
}

/** Merge new points into an existing curve. Points at the same bar overwrite. Returns a new curve. */
export function mergeTensionPoints(curve: TensionCurve, newPoints: TensionPoint[]): TensionCurve {
  const combined = [...curve.points, ...newPoints];
  return { ...curve, points: normalizePoints(combined) };
}

/** Set or update a track mapping. Returns a new curve. */
export function setTrackTensionMapping(
  curve: TensionCurve,
  mapping: TrackTensionMapping,
): TensionCurve {
  const existing = curve.trackMappings.filter(m => m.trackId !== mapping.trackId);
  return { ...curve, trackMappings: [...existing, mapping] };
}

/** Remove a track mapping. Returns a new curve. */
export function removeTrackTensionMapping(
  curve: TensionCurve,
  trackId: string,
): TensionCurve {
  return { ...curve, trackMappings: curve.trackMappings.filter(m => m.trackId !== trackId) };
}

/** Get the tension values at a specific bar from a full TensionCurve. */
export function getTensionAt(
  curve: TensionCurve,
  bar: number,
): { energy: number; density: number } {
  return interpolateTension(curve.points, bar);
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** Serialize a TensionCurve to a plain JSON-safe object. */
export function serializeTensionCurve(curve: TensionCurve): TensionCurve {
  return {
    points: curve.points.map(p => ({ bar: p.bar, energy: p.energy, density: p.density })),
    trackMappings: curve.trackMappings.map(m => ({
      trackId: m.trackId,
      ...(m.activationThreshold !== undefined ? { activationThreshold: m.activationThreshold } : {}),
      params: m.params.map(pm => ({ param: pm.param, low: pm.low, high: pm.high })),
    })),
  };
}

/** Deserialize a plain object into a TensionCurve. Validates and normalizes. */
export function deserializeTensionCurve(data: unknown): TensionCurve {
  if (!data || typeof data !== 'object') return createTensionCurve();

  const obj = data as Record<string, unknown>;

  const rawPoints = Array.isArray(obj.points) ? obj.points : [];
  const points: TensionPoint[] = [];
  for (const p of rawPoints) {
    if (p && typeof p === 'object') {
      const pt = p as Record<string, unknown>;
      if (typeof pt.bar === 'number' && typeof pt.energy === 'number' && typeof pt.density === 'number') {
        points.push({ bar: pt.bar, energy: clamp01(pt.energy), density: clamp01(pt.density) });
      }
    }
  }

  const rawMappings = Array.isArray(obj.trackMappings) ? obj.trackMappings : [];
  const trackMappings: TrackTensionMapping[] = [];
  for (const m of rawMappings) {
    if (m && typeof m === 'object') {
      const mm = m as Record<string, unknown>;
      if (typeof mm.trackId === 'string' && Array.isArray(mm.params)) {
        const params: TrackTensionParamMapping[] = [];
        for (const pm of mm.params) {
          if (pm && typeof pm === 'object') {
            const pp = pm as Record<string, unknown>;
            if (typeof pp.param === 'string' && typeof pp.low === 'number' && typeof pp.high === 'number') {
              params.push({ param: pp.param, low: pp.low, high: pp.high });
            }
          }
        }
        trackMappings.push({
          trackId: mm.trackId,
          ...(typeof mm.activationThreshold === 'number' ? { activationThreshold: clamp01(mm.activationThreshold) } : {}),
          params,
        });
      }
    }
  }

  return { points: normalizePoints(points), trackMappings };
}
