import { describe, expect, it } from 'vitest';
import type { ProcessorContract, ModulatorContract, ModuleCommand } from '../../src/audio/module-contract';
import { moduleDescriptors } from '../../src/audio/module-descriptors';

// Type-level conformance: verify each concrete *Synth class satisfies the contract.
// These are compile-time checks — if a class drops a required method, tsc will fail.
import type { RingsSynth } from '../../src/audio/rings-synth';
import type { CloudsSynth } from '../../src/audio/clouds-synth';
import type { RipplesSynth } from '../../src/audio/ripples-synth';
import type { EqSynth } from '../../src/audio/eq-synth';
import type { CompressorSynth } from '../../src/audio/compressor-synth';
import type { StereoSynth } from '../../src/audio/stereo-synth';
import type { ChorusSynth } from '../../src/audio/chorus-synth';
import type { DistortionSynth } from '../../src/audio/distortion-synth';
import type { WarpsSynth } from '../../src/audio/warps-synth';
import type { ElementsSynth } from '../../src/audio/elements-synth';
import type { BeadsSynth } from '../../src/audio/beads-synth';
import type { FramesSynth } from '../../src/audio/frames-synth';
import type { TidesSynth } from '../../src/audio/tides-synth';
import type { MarblesSynth } from '../../src/audio/marbles-synth';

// Compile-time: all concrete processor classes extend ProcessorContract
type _AssertRings = RingsSynth extends ProcessorContract ? true : never;
type _AssertClouds = CloudsSynth extends ProcessorContract ? true : never;
type _AssertRipples = RipplesSynth extends ProcessorContract ? true : never;
type _AssertEq = EqSynth extends ProcessorContract ? true : never;
type _AssertCompressor = CompressorSynth extends ProcessorContract ? true : never;
type _AssertStereo = StereoSynth extends ProcessorContract ? true : never;
type _AssertChorus = ChorusSynth extends ProcessorContract ? true : never;
type _AssertDistortion = DistortionSynth extends ProcessorContract ? true : never;
type _AssertWarps = WarpsSynth extends ProcessorContract ? true : never;
type _AssertElements = ElementsSynth extends ProcessorContract ? true : never;
type _AssertBeads = BeadsSynth extends ProcessorContract ? true : never;
type _AssertFrames = FramesSynth extends ProcessorContract ? true : never;

// Compile-time: all concrete modulator classes extend ModulatorContract
type _AssertTides = TidesSynth extends ModulatorContract ? true : never;
type _AssertMarbles = MarblesSynth extends ModulatorContract ? true : never;

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
