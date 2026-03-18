// src/engine/motif.ts — Motif type and MotifLibrary for managing musical DNA.

import type { MusicalEvent } from './canonical-types';

/** A named, reusable musical idea — short melodic or rhythmic fragment. */
export interface Motif {
  id: string;
  name: string;
  events: MusicalEvent[];
  /** Reference pitch for transposition operations (MIDI 0-127). */
  rootPitch?: number;
  /** Length of the motif in steps. */
  duration: number;
  /** Freeform tags for categorization. */
  tags?: string[];
}

/**
 * Session-level registry of named motifs.
 * Pure data structure — no side effects, no audio.
 */
export class MotifLibrary {
  private motifs: Map<string, Motif> = new Map();

  /** Register a new motif. Overwrites if ID already exists. */
  register(motif: Motif): void {
    this.motifs.set(motif.id, motif);
  }

  /** Recall a motif by ID. Returns undefined if not found. */
  recall(id: string): Motif | undefined {
    return this.motifs.get(id);
  }

  /** Find a motif by name (case-insensitive). Returns the first match. */
  findByName(name: string): Motif | undefined {
    const lower = name.toLowerCase();
    for (const motif of this.motifs.values()) {
      if (motif.name.toLowerCase() === lower) return motif;
    }
    return undefined;
  }

  /** List all registered motifs. */
  list(): Motif[] {
    return Array.from(this.motifs.values());
  }

  /** Remove a motif by ID. Returns true if it existed. */
  remove(id: string): boolean {
    return this.motifs.delete(id);
  }

  /** Number of registered motifs. */
  get size(): number {
    return this.motifs.size;
  }

  /** Clear all motifs. */
  clear(): void {
    this.motifs.clear();
  }
}
