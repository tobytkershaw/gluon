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
  private activeInteraction = false;

  constructor(cooldownMs = 500) {
    this.cooldownMs = cooldownMs;
  }

  private key(voiceId: string, param: string, target = 'source'): string {
    return `${voiceId}:${target}:${param}`;
  }

  humanTouched(voiceId: string, param: string, value: number, target = 'source'): void {
    this.touches.set(this.key(voiceId, param, target), { value, timestamp: Date.now() });
  }

  humanInteractionStart(): void {
    this.activeInteraction = true;
  }

  humanInteractionEnd(): void {
    this.activeInteraction = false;
  }

  canAIAct(voiceId: string, param: string): boolean {
    if (this.activeInteraction) return false;
    const record = this.touches.get(this.key(voiceId, param, 'source'));
    if (record && Date.now() - record.timestamp <= this.cooldownMs) {
      return false;
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
      if (now - record.timestamp <= this.cooldownMs || this.activeInteraction) {
        const param = k.slice(prefix.length);
        held[param] = record.value;
      }
    }
    return held;
  }

  /** Returns true if any source param is held or active interaction is on. */
  isHoldingSource(voiceId: string): boolean {
    if (this.activeInteraction) return true;
    const now = Date.now();
    const prefix = `${voiceId}:source:`;
    for (const [k, record] of this.touches) {
      if (!k.startsWith(prefix)) continue;
      if (now - record.timestamp <= this.cooldownMs) return true;
    }
    return false;
  }
}
