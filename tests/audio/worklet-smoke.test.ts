import { beforeEach, describe, expect, it, vi } from 'vitest';

type WorkletCtor = new (options?: { processorOptions?: { wasmBinary?: ArrayBuffer } }) => {
  port: MockPort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
};

type WorkletRegistration = {
  name: string;
  ctor: WorkletCtor & {
    parameterDescriptors?: Array<{ name: string }>;
  };
};

type WorkletCase = {
  modulePath: string;
  processorName: string;
  wasmFactoryKey?: string;
  expectsMinFence?: boolean;
};

class MockPort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly postMessage = vi.fn();

  dispatch(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

class MockAudioWorkletProcessor {
  readonly port = new MockPort();
}

class FakeWasmHeap {
  readonly heap = new Float32Array(16_384);
  private nextPtr = 0;

  malloc(size: number): number {
    const ptr = this.nextPtr;
    this.nextPtr += size;
    return ptr;
  }

  write(ptr: number, frames: number, seed: number) {
    const start = ptr / Float32Array.BYTES_PER_ELEMENT;
    for (let i = 0; i < frames; i++) {
      this.heap[start + i] = (seed + i + 1) / 256;
    }
  }
}

function createFakeWasmModule() {
  const backing = new FakeWasmHeap();
  const proxyTarget = {
    HEAPF32: backing.heap,
    _malloc: vi.fn((size: number) => backing.malloc(size)),
    _free: vi.fn(),
  };

  return new Proxy(proxyTarget, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string' || !prop.startsWith('_')) return undefined;

      if (prop.endsWith('_create')) {
        return vi.fn(() => 1);
      }

      if (prop.includes('_render') || prop.includes('_process')) {
        return vi.fn((...args: number[]) => {
          const frames = args[args.length - 1];
          for (let i = 1; i < args.length - 1; i++) {
            const ptr = args[i];
            if (typeof ptr === 'number' && ptr > 0) {
              backing.write(ptr, frames, i);
            }
          }
          return frames;
        });
      }

      return vi.fn(() => undefined);
    },
  });
}

function createInputBlock(): Float32Array[][] {
  return [[
    Float32Array.from({ length: 128 }, (_, i) => Math.sin(i / 8)),
    Float32Array.from({ length: 128 }, (_, i) => Math.cos(i / 9)),
  ]];
}

function createOutputBlock(): Float32Array[][] {
  return [[new Float32Array(128), new Float32Array(128)]];
}

function createParameters(
  descriptors: Array<{ name: string }> | undefined,
): Record<string, Float32Array> {
  const params: Record<string, Float32Array> = {};
  for (const descriptor of descriptors ?? []) {
    params[descriptor.name] = Float32Array.of(0);
  }
  return params;
}

async function loadWorklet(modulePath: string): Promise<WorkletRegistration> {
  let registration: WorkletRegistration | null = null;
  (globalThis as Record<string, unknown>).registerProcessor = (name: string, ctor: WorkletCtor) => {
    registration = { name, ctor: ctor as WorkletRegistration['ctor'] };
  };

  await import(`${modulePath}?case=${Math.random().toString(36).slice(2)}`);

  if (!registration) {
    throw new Error(`No processor registered for ${modulePath}`);
  }
  return registration;
}

async function expectReady(port: MockPort) {
  await vi.waitFor(() => {
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'ready' });
  });
}

function expectFinite(buffer: Float32Array) {
  expect(Array.from(buffer).every(Number.isFinite)).toBe(true);
}

const pureJsCases: WorkletCase[] = [
  { modulePath: '../../src/audio/chorus-worklet.ts', processorName: 'chorus-processor', expectsMinFence: true },
  { modulePath: '../../src/audio/compressor-worklet.ts', processorName: 'compressor-processor', expectsMinFence: true },
  { modulePath: '../../src/audio/distortion-worklet.ts', processorName: 'distortion-processor', expectsMinFence: true },
  { modulePath: '../../src/audio/eq-worklet.ts', processorName: 'eq-processor', expectsMinFence: true },
  { modulePath: '../../src/audio/frames-worklet.ts', processorName: 'frames-processor', expectsMinFence: true },
  { modulePath: '../../src/audio/marbles-worklet.ts', processorName: 'marbles-processor' },
  { modulePath: '../../src/audio/ripples-worklet.ts', processorName: 'ripples-processor', expectsMinFence: true },
  { modulePath: '../../src/audio/stereo-worklet.ts', processorName: 'stereo-processor', expectsMinFence: true },
  { modulePath: '../../src/audio/warps-worklet.ts', processorName: 'warps-processor', expectsMinFence: true },
];

const wasmCases: WorkletCase[] = [
  { modulePath: '../../src/audio/beads-worklet.ts', processorName: 'beads-processor', wasmFactoryKey: 'createBeadsModule', expectsMinFence: true },
  { modulePath: '../../src/audio/clouds-worklet.ts', processorName: 'clouds-processor', wasmFactoryKey: 'createCloudsModule', expectsMinFence: true },
  { modulePath: '../../src/audio/elements-worklet.ts', processorName: 'elements-processor', wasmFactoryKey: 'createElementsModule', expectsMinFence: true },
  { modulePath: '../../src/audio/plaits-worklet.ts', processorName: 'plaits-processor', wasmFactoryKey: 'createPlaitsModule', expectsMinFence: true },
  { modulePath: '../../src/audio/rings-worklet.ts', processorName: 'rings-processor', wasmFactoryKey: 'createRingsModule', expectsMinFence: true },
  { modulePath: '../../src/audio/tides-worklet.ts', processorName: 'tides-processor', wasmFactoryKey: 'createTidesModule' },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('AudioWorkletProcessor', MockAudioWorkletProcessor);
  vi.stubGlobal('sampleRate', 48_000);
  vi.stubGlobal('currentTime', 0);

  const globals = globalThis as Record<string, unknown>;
  delete globals.createBeadsModule;
  delete globals.createCloudsModule;
  delete globals.createElementsModule;
  delete globals.createPlaitsModule;
  delete globals.createRingsModule;
  delete globals.createTidesModule;
});

describe.each(pureJsCases)('$processorName', ({ modulePath, processorName, expectsMinFence }) => {
  it('registers, processes one block, and stops after destroy', async () => {
    const { name, ctor } = await loadWorklet(modulePath);
    expect(name).toBe(processorName);
    if (expectsMinFence) {
      expect(ctor.parameterDescriptors?.some(descriptor => descriptor.name === 'min-fence')).toBe(true);
    }

    const processor = new ctor();
    await expectReady(processor.port);

    const outputs = createOutputBlock();
    const parameters = createParameters(ctor.parameterDescriptors);

    expect(processor.process(createInputBlock(), outputs, parameters)).toBe(true);
    expectFinite(outputs[0][0]);
    expectFinite(outputs[0][1]);

    processor.port.dispatch({ type: 'destroy' });
    const afterDestroy = processor.process(createInputBlock(), createOutputBlock(), parameters);
    const nextBlock = processor.process(createInputBlock(), createOutputBlock(), parameters);
    expect([afterDestroy, nextBlock]).toContain(false);
  });
});

describe.each(wasmCases)('$processorName', ({ modulePath, processorName, wasmFactoryKey, expectsMinFence }) => {
  it('registers, initializes, processes one block, and stops after destroy', async () => {
    (globalThis as Record<string, unknown>)[wasmFactoryKey!] = vi.fn(async () => createFakeWasmModule());

    const { name, ctor } = await loadWorklet(modulePath);
    expect(name).toBe(processorName);
    if (expectsMinFence) {
      expect(ctor.parameterDescriptors?.some(descriptor => descriptor.name === 'min-fence')).toBe(true);
    }

    const processor = new ctor({
      processorOptions: { wasmBinary: new ArrayBuffer(16) },
    });
    await expectReady(processor.port);

    const outputs = createOutputBlock();
    const parameters = createParameters(ctor.parameterDescriptors);

    expect(processor.process(createInputBlock(), outputs, parameters)).toBe(true);
    expectFinite(outputs[0][0]);
    expectFinite(outputs[0][1]);

    processor.port.dispatch({ type: 'destroy' });
    const afterDestroy = processor.process(createInputBlock(), createOutputBlock(), parameters);
    const nextBlock = processor.process(createInputBlock(), createOutputBlock(), parameters);
    expect([afterDestroy, nextBlock]).toContain(false);
  });
});
