// src/engine/arbitration.ts
import type { SynthParamValues } from './types';

interface TouchRecord {
  value: number;
  timestamp: number;
}

export class Arbitrator {
  // Key: "voiceId:target:param" → TouchRecord
  private touches: Map<string, TouchRecord> = new Map();
  private cooldownMs: number;
  private activeVoice: string | null = null;
  private onHoldExpired: (() => void) | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(cooldownMs = 500) {
    this.cooldownMs = cooldownMs;
  }

  /** Register a callback invoked when the hold expires (interaction end + cooldown). */
  setOnHoldExpired(cb: () => void): void {
    this.onHoldExpired = cb;
  }

  private key(voiceId: string, param: string, target = 'source'): string {
    return `${voiceId}:${target}:${param}`;
  }

  humanTouched(voiceId: string, param: string, value: number, target = 'source'): void {
    this.touches.set(this.key(voiceId, param, target), { value, timestamp: Date.now() });
  }

  humanInteractionStart(voiceId: string): void {
    this.activeVoice = voiceId;
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  humanInteractionEnd(): void {
    this.activeVoice = null;
    // Schedule a re-sync after cooldown so suppressed params get flushed
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      this.onHoldExpired?.();
    }, this.cooldownMs + 16); // +16ms to ensure cooldown has fully elapsed
  }

  canAIAct(voiceId: string, param: string): boolean {
    if (this.activeVoice === voiceId) return false;
    const record = this.touches.get(this.key(voiceId, param, 'source'));
    if (record && Date.now() - record.timestamp <= this.cooldownMs) {
      return false;
    }
    return true;
  }

  /** Returns false if the human has any active touch on any parameter of this voice (within cooldown). */
  canAIActOnVoice(voiceId: string): boolean {
    if (this.activeVoice === voiceId) return false;
    const now = Date.now();
    const prefix = `${voiceId}:`;
    for (const [k, record] of this.touches) {
      if (k.startsWith(prefix) && now - record.timestamp <= this.cooldownMs) {
        return false;
      }
    }
    return true;
  }

  /** Legacy — returns all held source params. Used by scheduler. Do not expand usage. */
  getHeldParams(voiceId: string): Partial<SynthParamValues> {
    return this.getHeldSourceParams(voiceId);
  }

  /** Returns only source-level held params for a voice. */
  getHeldSourceParams(voiceId: string): Partial<SynthParamValues> {
    const now = Date.now();
    const prefix = `${voiceId}:source:`;
    const held: Partial<SynthParamValues> = {};
    for (const [k, record] of this.touches) {
      if (!k.startsWith(prefix)) continue;
      if (now - record.timestamp <= this.cooldownMs || this.activeVoice === voiceId) {
        const param = k.slice(prefix.length);
        held[param] = record.value;
      }
    }
    return held;
  }

  /** Returns true if this voice's source params are held (active interaction or cooldown). */
  isHoldingSource(voiceId: string): boolean {
    if (this.activeVoice === voiceId) return true;
    const now = Date.now();
    const prefix = `${voiceId}:source:`;
    for (const [k, record] of this.touches) {
      if (!k.startsWith(prefix)) continue;
      if (now - record.timestamp <= this.cooldownMs) return true;
    }
    return false;
  }
}
