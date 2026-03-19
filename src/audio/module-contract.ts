// src/audio/module-contract.ts
// Shared runtime contract for all audio modules (processors + modulators).

/** Discriminated command union for all processor modules. */
export type ModuleCommand =
  | { type: 'strum'; time: number }
  | { type: 'damp' }
  | { type: 'set-note'; tonic: number; note: number }
  | { type: 'set-polyphony'; polyphony: number }
  | { type: 'set-internal-exciter'; enabled: boolean }
  | { type: 'set-fine-tune'; offset: number }
  | { type: 'freeze'; enabled: boolean }
  | { type: 'gate'; open: boolean; time?: number }
  | { type: 'sidechain-enabled'; enabled: boolean };

/** Runtime contract for processor modules (effects, resonators). */
export interface ProcessorContract {
  readonly role: 'processor';
  readonly inputNode: AudioNode;
  setPatch(params: Record<string, number>): void;
  setModel(model: number): void;
  sendCommand(command: ModuleCommand): void;
  silence(fence?: number): void;
  destroy(): void;
}

/** Runtime contract for modulator modules (LFOs, random generators). */
export interface ModulatorContract {
  readonly role: 'modulator';
  readonly outputNode: AudioNode;
  setPatch(params: Record<string, number>): void;
  setModel(model: number): void;
  silence(fence?: number): void;
  pause(): void;
  resume(): void;
  destroy(): void;
}

/** Result of creating a module — includes degraded status for WASM failures. */
export interface CreationResult<T> {
  engine: T;
  degraded: boolean;
  degradedReason?: string;
}

/** Descriptor for a module type — used by the descriptor registry. */
export interface ModuleDescriptor {
  type: string;
  role: 'processor' | 'modulator';
  commands: ModuleCommand['type'][];
  sidechain?: { inputIndex: number };
  create(ctx: AudioContext): Promise<CreationResult<ProcessorContract | ModulatorContract>>;
}

/** Log unsupported commands in dev mode. */
export function warnUnsupportedCommand(moduleType: string, command: ModuleCommand): void {
  if (import.meta.env.DEV) {
    console.warn(`[${moduleType}] Unsupported command: ${command.type}`);
  }
}
