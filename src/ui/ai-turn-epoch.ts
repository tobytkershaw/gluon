export class AITurnEpoch {
  private current = 0;

  begin(): number {
    this.current += 1;
    return this.current;
  }

  invalidate(): number {
    this.current += 1;
    return this.current;
  }

  isCurrent(token: number): boolean {
    return token === this.current;
  }

  get value(): number {
    return this.current;
  }
}
