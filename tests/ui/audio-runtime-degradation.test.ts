import { describe, expect, it } from 'vitest';
import { appendAudioRuntimeDegradationMessage } from '../../src/ui/App';

describe('audio runtime degradation messaging', () => {
  it('formats the first degradation and appends distinct follow-up failures', () => {
    const first = appendAudioRuntimeDegradationMessage(null, 'Plaits init failed, falling back to WebAudioSynth.');
    const second = appendAudioRuntimeDegradationMessage(first, 'processor load failed for clouds (clouds-1): missing WASM export');

    expect(first).toBe('Audio runtime degraded: Plaits init failed, falling back to WebAudioSynth.');
    expect(second).toBe(
      'Audio runtime degraded: Plaits init failed, falling back to WebAudioSynth.; processor load failed for clouds (clouds-1): missing WASM export',
    );
  });

  it('does not suppress a distinct message that merely contains the first as a substring', () => {
    const first = appendAudioRuntimeDegradationMessage(null, 'processor load failed');
    const second = appendAudioRuntimeDegradationMessage(first, 'processor load failed for clouds (clouds-1)');

    expect(second).toBe(
      'Audio runtime degraded: processor load failed; processor load failed for clouds (clouds-1)',
    );
  });
});
