import { describe, expect, it } from 'vitest';
import type { ProcessorContract, ModulatorContract, ModuleCommand } from '../../src/audio/module-contract';
import { moduleDescriptors } from '../../src/audio/module-descriptors';

// Type-level conformance: verify each module class satisfies the contract via its type alias.
// These are compile-time checks — if the aliases are wrong, tsc will fail.
import type { RingsEngine } from '../../src/audio/rings-synth';
import type { CloudsEngine } from '../../src/audio/clouds-synth';
import type { RipplesEngine } from '../../src/audio/ripples-synth';
import type { EqEngine } from '../../src/audio/eq-synth';
import type { CompressorEngine } from '../../src/audio/compressor-synth';
import type { StereoEngine } from '../../src/audio/stereo-synth';
import type { ChorusEngine } from '../../src/audio/chorus-synth';
import type { DistortionEngine } from '../../src/audio/distortion-synth';
import type { WarpsEngine } from '../../src/audio/warps-synth';
import type { ElementsEngine } from '../../src/audio/elements-synth';
import type { BeadsEngine } from '../../src/audio/beads-synth';
import type { FramesEngine } from '../../src/audio/frames-synth';
import type { TidesEngine } from '../../src/audio/tides-synth';
import type { MarblesEngine } from '../../src/audio/marbles-synth';

// Compile-time: all processor type aliases resolve to ProcessorContract
type _AssertRings = RingsEngine extends ProcessorContract ? true : never;
type _AssertClouds = CloudsEngine extends ProcessorContract ? true : never;
type _AssertRipples = RipplesEngine extends ProcessorContract ? true : never;
type _AssertEq = EqEngine extends ProcessorContract ? true : never;
type _AssertCompressor = CompressorEngine extends ProcessorContract ? true : never;
type _AssertStereo = StereoEngine extends ProcessorContract ? true : never;
type _AssertChorus = ChorusEngine extends ProcessorContract ? true : never;
type _AssertDistortion = DistortionEngine extends ProcessorContract ? true : never;
type _AssertWarps = WarpsEngine extends ProcessorContract ? true : never;
type _AssertElements = ElementsEngine extends ProcessorContract ? true : never;
type _AssertBeads = BeadsEngine extends ProcessorContract ? true : never;
type _AssertFrames = FramesEngine extends ProcessorContract ? true : never;

// Compile-time: all modulator type aliases resolve to ModulatorContract
type _AssertTides = TidesEngine extends ModulatorContract ? true : never;
type _AssertMarbles = MarblesEngine extends ModulatorContract ? true : never;

// Suppress unused type warnings
const _typeChecks: [
  _AssertRings, _AssertClouds, _AssertRipples, _AssertEq,
  _AssertCompressor, _AssertStereo, _AssertChorus, _AssertDistortion,
  _AssertWarps, _AssertElements, _AssertBeads, _AssertFrames,
  _AssertTides, _AssertMarbles,
] = [
  true, true, true, true,
  true, true, true, true,
  true, true, true, true,
  true, true,
];
void _typeChecks;

describe('module-contract', () => {
  describe('descriptor registry', () => {
    it('has entries for all 14 modules', () => {
      const expected = [
        'rings', 'clouds', 'ripples', 'eq', 'compressor',
        'stereo', 'chorus', 'distortion', 'warps', 'elements',
        'beads', 'frames', 'tides', 'marbles',
      ];
      for (const type of expected) {
        expect(moduleDescriptors.has(type)).toBe(true);
      }
    });

    it('processors have role=processor', () => {
      const processorTypes = [
        'rings', 'clouds', 'ripples', 'eq', 'compressor',
        'stereo', 'chorus', 'distortion', 'warps', 'elements',
        'beads', 'frames',
      ];
      for (const type of processorTypes) {
        expect(moduleDescriptors.get(type)!.role).toBe('processor');
      }
    });

    it('modulators have role=modulator', () => {
      expect(moduleDescriptors.get('tides')!.role).toBe('modulator');
      expect(moduleDescriptors.get('marbles')!.role).toBe('modulator');
    });

    it('compressor declares sidechain capability', () => {
      const desc = moduleDescriptors.get('compressor')!;
      expect(desc.sidechain).toEqual({ inputIndex: 1 });
    });

    it('rings declares its supported commands', () => {
      const desc = moduleDescriptors.get('rings')!;
      expect(desc.commands).toContain('strum');
      expect(desc.commands).toContain('damp');
      expect(desc.commands).toContain('set-polyphony');
      expect(desc.commands).toContain('set-internal-exciter');
      expect(desc.commands).toContain('set-fine-tune');
      expect(desc.commands).toContain('set-note');
    });

    it('elements declares gate, damp, set-note commands', () => {
      const desc = moduleDescriptors.get('elements')!;
      expect(desc.commands).toContain('gate');
      expect(desc.commands).toContain('damp');
      expect(desc.commands).toContain('set-note');
    });

    it('clouds declares freeze command', () => {
      const desc = moduleDescriptors.get('clouds')!;
      expect(desc.commands).toContain('freeze');
    });

    it('simple processors declare no commands', () => {
      for (const type of ['ripples', 'eq', 'stereo', 'chorus', 'distortion', 'warps', 'beads', 'frames']) {
        expect(moduleDescriptors.get(type)!.commands).toEqual([]);
      }
    });

    it('command lists are typed against ModuleCommand discriminants', () => {
      const validCommands: ModuleCommand['type'][] = [
        'strum', 'damp', 'set-note', 'set-polyphony',
        'set-internal-exciter', 'set-fine-tune', 'freeze',
        'gate', 'sidechain-enabled',
      ];
      for (const [, desc] of moduleDescriptors) {
        for (const cmd of desc.commands) {
          expect(validCommands).toContain(cmd);
        }
      }
    });
  });
});
