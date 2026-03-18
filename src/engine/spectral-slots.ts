// src/engine/spectral-slots.ts — Spectral slot assignment and frequency coexistence.
//
// Pure computation layer: assigns tracks to frequency bands, detects collisions,
// and computes EQ adjustment suggestions. Does NOT apply changes directly —
// the AI applies them via move or manage_processor tools.

export type FrequencyBand = 'sub' | 'low' | 'low_mid' | 'mid' | 'high_mid' | 'high' | 'air';

export const FREQUENCY_BANDS: FrequencyBand[] = [
  'sub', 'low', 'low_mid', 'mid', 'high_mid', 'high', 'air',
];

export const BAND_RANGES: Record<FrequencyBand, [number, number]> = {
  sub: [20, 60],
  low: [60, 250],
  low_mid: [250, 500],
  mid: [500, 2000],
  high_mid: [2000, 6000],
  high: [6000, 12000],
  air: [12000, 20000],
};

export interface SpectralSlot {
  trackId: string;
  primaryBands: FrequencyBand[];
  priority: number; // higher = wins when tracks share a band
}

export interface EQAdjustment {
  trackId: string;
  band: FrequencyBand;
  /** Suggested cut in dB (negative = attenuation). Typically -2 to -4 dB. */
  gainDb: number;
  /** Center frequency of the band (geometric mean of range). */
  centerFreq: number;
  /** Reason for the adjustment. */
  reason: string;
}

export interface BandCollision {
  band: FrequencyBand;
  trackIds: string[];
  /** Track that wins (highest priority). */
  winnerId: string;
  /** Tracks that should be attenuated. */
  losers: string[];
}

/**
 * SpectralSlotManager — manages frequency band assignments for tracks
 * and computes EQ adjustments to resolve collisions.
 */
export class SpectralSlotManager {
  private slots: Map<string, SpectralSlot> = new Map();

  /** Assign a track to one or more frequency bands with a priority. */
  assign(trackId: string, primaryBands: FrequencyBand[], priority: number): SpectralSlot {
    const validBands = primaryBands.filter(b => FREQUENCY_BANDS.includes(b));
    if (validBands.length === 0) {
      throw new Error(`No valid frequency bands provided. Valid bands: ${FREQUENCY_BANDS.join(', ')}`);
    }
    const clampedPriority = Math.max(0, Math.min(10, priority));
    const slot: SpectralSlot = { trackId, primaryBands: validBands, priority: clampedPriority };
    this.slots.set(trackId, slot);
    return slot;
  }

  /** Remove a track's spectral slot assignment. */
  remove(trackId: string): boolean {
    return this.slots.delete(trackId);
  }

  /** Get a track's current slot assignment. */
  get(trackId: string): SpectralSlot | undefined {
    return this.slots.get(trackId);
  }

  /** Get all current slot assignments. */
  getAll(): SpectralSlot[] {
    return Array.from(this.slots.values());
  }

  /** Detect all band collisions (bands shared by multiple tracks). */
  detectCollisions(): BandCollision[] {
    // Build a map of band -> tracks that claim it
    const bandOwners: Record<string, SpectralSlot[]> = {};
    for (const band of FREQUENCY_BANDS) {
      bandOwners[band] = [];
    }

    for (const slot of this.slots.values()) {
      for (const band of slot.primaryBands) {
        bandOwners[band].push(slot);
      }
    }

    const collisions: BandCollision[] = [];
    for (const band of FREQUENCY_BANDS) {
      const owners = bandOwners[band];
      if (owners.length < 2) continue;

      // Sort by priority descending; break ties by trackId for determinism
      const sorted = [...owners].sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.trackId.localeCompare(b.trackId);
      });

      collisions.push({
        band: band as FrequencyBand,
        trackIds: sorted.map(s => s.trackId),
        winnerId: sorted[0].trackId,
        losers: sorted.slice(1).map(s => s.trackId),
      });
    }

    return collisions;
  }

  /**
   * Compute EQ adjustments needed to resolve all current collisions.
   * Lower-priority tracks get gentle attenuation (-2 to -4 dB) in shared bands.
   * The attenuation scales with priority difference.
   */
  computeAdjustments(): EQAdjustment[] {
    const collisions = this.detectCollisions();
    const adjustments: EQAdjustment[] = [];

    for (const collision of collisions) {
      const winner = this.slots.get(collision.winnerId)!;
      const [lo, hi] = BAND_RANGES[collision.band];
      const centerFreq = Math.round(Math.sqrt(lo * hi));

      for (const loserId of collision.losers) {
        const loser = this.slots.get(loserId)!;
        // Scale attenuation by priority difference: 1 priority step = -2dB, max -4dB
        const priorityDiff = winner.priority - loser.priority;
        const gainDb = -Math.min(4, Math.max(2, 2 + priorityDiff));

        adjustments.push({
          trackId: loserId,
          band: collision.band,
          gainDb,
          centerFreq,
          reason: `Shared "${collision.band}" band with "${collision.winnerId}" (priority ${winner.priority} vs ${loser.priority})`,
        });
      }
    }

    return adjustments;
  }
}

/** Compute the geometric center frequency of a band. */
export function bandCenterFreq(band: FrequencyBand): number {
  const [lo, hi] = BAND_RANGES[band];
  return Math.round(Math.sqrt(lo * hi));
}
