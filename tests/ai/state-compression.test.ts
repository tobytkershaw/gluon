import { describe, it, expect } from 'vitest';
import { compressState } from '../../src/ai/state-compression';
import { createSession, setLeash, setAgency, updateVoiceParams } from '../../src/engine/session';

describe('compressState', () => {
  it('compresses a default session', () => {
    const session = createSession();
    const compressed = compressState(session);
    expect(compressed.voice.engine).toBe('plaits:virtual_analog');
    expect(compressed.voice.params.timbre).toBe(0.5);
    expect(compressed.voice.agency).toBe('SUGGEST');
    expect(compressed.leash).toBe(0.5);
  });

  it('includes human message when provided', () => {
    const session = createSession();
    const compressed = compressState(session, 'make it darker');
    expect(compressed.human_message).toBe('make it darker');
  });

  it('omits human_message when not provided', () => {
    const session = createSession();
    const compressed = compressState(session);
    expect(compressed.human_message).toBeUndefined();
  });

  it('includes pending actions count', () => {
    const session = createSession();
    const compressed = compressState(session);
    expect(compressed.pending_count).toBe(0);
  });

  it('rounds param values to 2 decimal places', () => {
    const session = updateVoiceParams(createSession(), { timbre: 0.33333 });
    const compressed = compressState(session);
    expect(compressed.voice.params.timbre).toBe(0.33);
  });

  it('includes recent human actions as formatted strings', () => {
    let session = createSession();
    session = updateVoiceParams(session, { timbre: 0.8 }, true);
    const compressed = compressState(session);
    expect(compressed.recent_human_actions.length).toBe(1);
    expect(compressed.recent_human_actions[0]).toContain('timbre');
  });
});
