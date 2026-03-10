export class Arbitrator {
  private lastTouched: Map<string, number> = new Map();
  private cooldownMs: number;
  private activeInteraction = false;

  constructor(cooldownMs = 500) {
    this.cooldownMs = cooldownMs;
  }

  humanTouched(param: string): void {
    this.lastTouched.set(param, Date.now());
  }

  humanInteractionStart(): void {
    this.activeInteraction = true;
  }

  humanInteractionEnd(): void {
    this.activeInteraction = false;
  }

  canAIAct(param: string): boolean {
    if (this.activeInteraction) return false;
    const lastTouch = this.lastTouched.get(param);
    if (lastTouch === undefined) return true;
    return Date.now() - lastTouch > this.cooldownMs;
  }
}
