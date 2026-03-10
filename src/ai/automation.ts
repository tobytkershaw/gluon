type AutomationCallback = (param: string, value: number) => void;

interface ActiveAutomation {
  param: string;
  startValue: number;
  endValue: number;
  durationMs: number;
  startTime: number;
  callback: AutomationCallback;
}

export class AutomationEngine {
  private automations: Map<string, ActiveAutomation> = new Map();
  private rafId: number | null = null;

  start(
    param: string,
    startValue: number,
    endValue: number,
    durationMs: number,
    callback: AutomationCallback,
  ): void {
    this.automations.set(param, {
      param,
      startValue,
      endValue,
      durationMs,
      startTime: Date.now(),
      callback,
    });
  }

  cancel(param: string): void {
    this.automations.delete(param);
  }

  cancelAll(): void {
    this.automations.clear();
  }

  getActiveCount(): number {
    return this.automations.size;
  }

  tick(now: number): void {
    const toRemove: string[] = [];
    for (const [key, auto] of this.automations) {
      const elapsed = now - auto.startTime;
      const progress = Math.min(1, elapsed / auto.durationMs);
      const value = auto.startValue + (auto.endValue - auto.startValue) * progress;
      auto.callback(auto.param, value);
      if (progress >= 1) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      this.automations.delete(key);
    }
  }

  startLoop(): void {
    const loop = () => {
      this.tick(Date.now());
      if (this.automations.size > 0) {
        this.rafId = requestAnimationFrame(loop);
      } else {
        this.rafId = null;
      }
    };
    if (this.rafId === null && this.automations.size > 0) {
      this.rafId = requestAnimationFrame(loop);
    }
  }

  stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
