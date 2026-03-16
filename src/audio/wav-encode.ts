// src/audio/wav-encode.ts
// Converts a WebM audio blob to WAV via OfflineAudioContext.
// Gemini API accepts WAV but not WebM.

export async function blobToWav(blob: Blob, sampleRate = 48000): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new OfflineAudioContext(1, 1, sampleRate);
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  // Render to mono at target sample rate
  const offline = new OfflineAudioContext(1, audioBuffer.length, sampleRate);
  const source = offline.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();

  const pcm = rendered.getChannelData(0);
  return encodeWav(pcm, sampleRate);
}

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);                              // chunk size
  view.setUint16(20, 1, true);                               // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Convert float32 to int16
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Encode stereo WAV from left/right Float32Arrays.
 * Samples are interleaved L R L R in the output.
 */
export function encodeWavStereo(left: Float32Array, right: Float32Array, sampleRate: number): Blob {
  const numChannels = 2;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const framesCount = left.length;
  const dataSize = framesCount * numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);                               // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Interleave L R L R and convert float32 to int16
  let offset = 44;
  for (let i = 0; i < framesCount; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7FFF, true);
    offset += 2;
    const r = Math.max(-1, Math.min(1, right[i]));
    view.setInt16(offset, r < 0 ? r * 0x8000 : r * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
