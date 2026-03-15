export interface StereoBuffer {
  left: Float32Array;
  right: Float32Array;
}

export function monoToStereo(input: Float32Array): StereoBuffer {
  return {
    left: input.slice(),
    right: input.slice(),
  };
}

export function applyStereoPan(buffer: StereoBuffer, pan: number): StereoBuffer {
  const clampedPan = Math.max(-1, Math.min(1, pan));
  const theta = (clampedPan + 1) * Math.PI / 4;
  const leftGain = Math.cos(theta);
  const rightGain = Math.sin(theta);

  const left = new Float32Array(buffer.left.length);
  const right = new Float32Array(buffer.right.length);
  for (let i = 0; i < buffer.left.length; i++) {
    left[i] = buffer.left[i] * leftGain;
    right[i] = buffer.right[i] * rightGain;
  }
  return { left, right };
}

export function applyStereoGain(buffer: StereoBuffer, gain: number): StereoBuffer {
  const clampedGain = Math.max(0, Math.min(1, gain));
  const left = new Float32Array(buffer.left.length);
  const right = new Float32Array(buffer.right.length);
  for (let i = 0; i < buffer.left.length; i++) {
    left[i] = buffer.left[i] * clampedGain;
    right[i] = buffer.right[i] * clampedGain;
  }
  return { left, right };
}

export function mixStereoBuffers(buffers: StereoBuffer[]): StereoBuffer {
  if (buffers.length === 0) {
    return { left: new Float32Array(0), right: new Float32Array(0) };
  }
  const maxLen = Math.max(...buffers.map(buffer => buffer.left.length));
  const left = new Float32Array(maxLen);
  const right = new Float32Array(maxLen);
  for (const buffer of buffers) {
    for (let i = 0; i < buffer.left.length; i++) {
      left[i] += buffer.left[i];
      right[i] += buffer.right[i];
    }
  }
  return { left, right };
}

export function downmixStereoToMono(buffer: StereoBuffer): Float32Array {
  const mono = new Float32Array(buffer.left.length);
  for (let i = 0; i < mono.length; i++) {
    mono[i] = (buffer.left[i] + buffer.right[i]) * 0.5;
  }
  return mono;
}
