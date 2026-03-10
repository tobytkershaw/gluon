// src/engine/arbitration.ts
import type { SynthParamValues } from './types';

interface TouchRecord {
  value: number;
  timestamp: number;
}

export class Arbitrator {
  // Key: "voiceId:param" → TouchRecord
  private touches: Map<string, TouchRecord> = new Map();
  private cooldownMs: number;
  private activeInteraction = false;

  constructor(cooldownMs = 500) {
    this.cooldownMs = cooldownMs;
  }

  private key(voiceId: string, param: string): string {
    return `${voiceId}:${param}`;
  }

  humanTouched(voiceId: string, param: string, value: number): void {
    this.touches.set(this.key(voiceId, param), { value, timestamp: Date.now() });
  }

  humanInteractionStart(): void {
    this.activeInteraction = true;
  }

  humanInteractionEnd(): void {
    this.activeInteraction = false;
  }

  canAIAct(param: string): boolean {
    if (this.activeInteraction) return false;
    // Check across all voices for this param
    const now = Date.now();
    for (const [k, record] of this.touches) {
      if (k.endsWith(`:${param}`) && now - record.timestamp <= this.cooldownMs) {
        return false;
      }
    }
    return true;
  }

  getHeldParams(voiceId: string): Partial<SynthParamValues> {
    const now = Date.now();
    const prefix = `${voiceId}:`;
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
}
