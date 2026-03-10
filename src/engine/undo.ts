import type { Snapshot } from './types';

export class UndoStack {
  private stack: Snapshot[] = [];
  private maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  push(snapshot: Snapshot): void {
    this.stack.push(snapshot);
    if (this.stack.length > this.maxSize) {
      this.stack.shift();
    }
  }

  pop(): Snapshot | undefined {
    return this.stack.pop();
  }

  peek(): Snapshot | undefined {
    return this.stack[this.stack.length - 1];
  }

  isEmpty(): boolean {
    return this.stack.length === 0;
  }

  size(): number {
    return this.stack.length;
  }

  clear(): void {
    this.stack = [];
  }

  toArray(): Snapshot[] {
    return [...this.stack];
  }
}
