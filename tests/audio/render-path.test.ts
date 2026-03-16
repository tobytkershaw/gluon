import { describe, expect, it } from 'vitest';
import { applyProcessorModulations, applySourceModulations } from '../../src/audio/render-modulation';
import { applyStereoGain, applyStereoPan, downmixStereoToMono, mixStereoBuffers, monoToStereo } from '../../src/audio/render-mix';
import { encodeWav, encodeWavStereo } from '../../src/audio/wav-encode';

describe('offline render helpers', () => {
  it('applies modulation to source and processor patches', () => {
    const basePatch = { harmonics: 0.4, timbre: 0.5, morph: 0.6, note: 0.2 };
    const modulatorValues = { lfo: 0.25 };
    const routes = [
      { id: 'r1', modulatorId: 'lfo', target: { kind: 'source' as const, param: 'timbre' as const }, depth: 0.5 },
      { id: 'r2', modulatorId: 'lfo', target: { kind: 'processor' as const, processorId: 'proc-1', param: 'brightness' }, depth: -0.4 },
    ];

    const modulatedSource = applySourceModulations(basePatch, routes, modulatorValues);
    const modulatedProcessor = applyProcessorModulations({
      id: 'proc-1',
      type: 'rings',
      model: 0,
      params: { brightness: 0.5, damping: 0.7 },
    }, routes, modulatorValues);

    expect(modulatedSource.timbre).not.toBe(basePatch.timbre);
    expect(modulatedProcessor.brightness).not.toBe(0.5);
  });

  it('applies master gain/pan before deterministic mono downmix', () => {
    const mixed = mixStereoBuffers([
      monoToStereo(Float32Array.from([1, 0.5, 0])),
      monoToStereo(Float32Array.from([0.5, 0.25, 0])),
    ]);
    const centered = downmixStereoToMono(applyStereoGain(applyStereoPan(mixed, 0), 0.8));
    const hardLeft = downmixStereoToMono(applyStereoGain(applyStereoPan(mixed, -1), 0.8));

    expect(Array.from(centered)).toEqual([
      expect.closeTo(0.84853, 4),
      expect.closeTo(0.42426, 4),
      0,
    ]);
    expect(Array.from(hardLeft)).toEqual([
      expect.closeTo(0.6, 4),
      expect.closeTo(0.3, 4),
      0,
    ]);
  });

  it('encodeWav produces valid mono WAV header', () => {
    const samples = Float32Array.from([0.5, -0.5, 0.25]);
    const blob = encodeWav(samples, 48000);
    expect(blob.type).toBe('audio/wav');
    // 44 byte header + 3 samples * 2 bytes = 50 bytes
    expect(blob.size).toBe(50);
  });

  it('encodeWavStereo produces valid stereo WAV header', async () => {
    const left = Float32Array.from([0.5, -0.5, 0.25]);
    const right = Float32Array.from([-0.25, 0.75, 0.0]);
    const blob = encodeWavStereo(left, right, 48000);
    expect(blob.type).toBe('audio/wav');
    // 44 byte header + 3 frames * 2 channels * 2 bytes = 56 bytes
    expect(blob.size).toBe(56);

    // Verify WAV header fields
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);
    // numChannels at offset 22
    expect(view.getUint16(22, true)).toBe(2);
    // sampleRate at offset 24
    expect(view.getUint32(24, true)).toBe(48000);
    // byteRate at offset 28: 48000 * 2 channels * 2 bytes
    expect(view.getUint32(28, true)).toBe(48000 * 2 * 2);
    // blockAlign at offset 32: 2 channels * 2 bytes
    expect(view.getUint16(32, true)).toBe(4);
  });
});
