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
  readonly outputNode: AudioNode;
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

/** Descriptor for a processor module type. */
export interface ProcessorDescriptor {
  type: string;
  role: 'processor';
  commands: ModuleCommand['type'][];
  sidechain?: { inputIndex: number };
  create(ctx: AudioContext, signal?: AbortSignal): Promise<CreationResult<ProcessorContract>>;
}

/** Descriptor for a modulator module type. */
export interface ModulatorDescriptor {
  type: string;
  role: 'modulator';
  commands: ModuleCommand['type'][];
  create(ctx: AudioContext, signal?: AbortSignal): Promise<CreationResult<ModulatorContract>>;
}

/** Descriptor for a module type — used by the descriptor registry. */
export type ModuleDescriptor = ProcessorDescriptor | ModulatorDescriptor;

/** Log unsupported commands in dev mode. */
export function warnUnsupportedCommand(moduleType: string, command: ModuleCommand): void {
  if (import.meta.env.DEV) {
    console.warn(`[${moduleType}] Unsupported command: ${command.type}`);
  }
}
