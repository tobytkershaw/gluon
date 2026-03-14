// src/engine/arbitration.ts
import type { SynthParamValues } from './types';

interface TouchRecord {
  value: number;
  timestamp: number;
}

export class Arbitrator {
  // Key: "trackId:target:param" → TouchRecord
  private touches: Map<string, TouchRecord> = new Map();
  private cooldownMs: number;
  private activeTrack: string | null = null;
  private onHoldExpired: (() => void) | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(cooldownMs = 500) {
    this.cooldownMs = cooldownMs;
  }

  /** Register a callback invoked when the hold expires (interaction end + cooldown). */
  setOnHoldExpired(cb: () => void): void {
    this.onHoldExpired = cb;
  }

  private key(trackId: string, param: string, target = 'source'): string {
    return `${trackId}:${target}:${param}`;
  }

  humanTouched(trackId: string, param: string, value: number, target = 'source'): void {
    this.touches.set(this.key(trackId, param, target), { value, timestamp: Date.now() });
  }

  humanInteractionStart(trackId: string): void {
    this.activeTrack = trackId;
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  humanInteractionEnd(): void {
    this.activeTrack = null;
    // Schedule a re-sync after cooldown so suppressed params get flushed
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      this.onHoldExpired?.();
    }, this.cooldownMs + 16); // +16ms to ensure cooldown has fully elapsed
  }

  canAIAct(trackId: string, param: string): boolean {
    if (this.activeTrack === trackId) return false;
    const record = this.touches.get(this.key(trackId, param, 'source'));
    if (record && Date.now() - record.timestamp <= this.cooldownMs) {
      return false;
    }
    return true;
  }

  /** Returns false if the human has any active touch on any parameter of this track (within cooldown). */
  canAIActOnTrack(trackId: string): boolean {
    if (this.activeTrack === trackId) return false;
    const now = Date.now();
    const prefix = `${trackId}:`;
    for (const [k, record] of this.touches) {
      if (k.startsWith(prefix) && now - record.timestamp <= this.cooldownMs) {
        return false;
      }
    }
    return true;
  }

  /** Legacy — returns all held source params. Used by scheduler. Do not expand usage. */
  getHeldParams(trackId: string): Partial<SynthParamValues> {
    return this.getHeldSourceParams(trackId);
  }

  /** Returns only source-level held params for a track. */
  getHeldSourceParams(trackId: string): Partial<SynthParamValues> {
    const now = Date.now();
    const prefix = `${trackId}:source:`;
    const held: Partial<SynthParamValues> = {};
    for (const [k, record] of this.touches) {
      if (!k.startsWith(prefix)) continue;
      if (now - record.timestamp <= this.cooldownMs || this.activeTrack === trackId) {
        const param = k.slice(prefix.length);
        held[param] = record.value;
      }
    }
    return held;
  }

  /** Returns true if this track's source params are held (active interaction or cooldown). */
  isHoldingSource(trackId: string): boolean {
    if (this.activeTrack === trackId) return true;
    const now = Date.now();
    const prefix = `${trackId}:source:`;
    for (const [k, record] of this.touches) {
      if (!k.startsWith(prefix)) continue;
      if (now - record.timestamp <= this.cooldownMs) return true;
    }
    return false;
  }
}
