import { describe, it, expect } from 'vitest';
import { finalizeAITurn } from '../../src/engine/operation-executor';
import { createSession } from '../../src/engine/session';
import type { ListenEvent } from '../../src/engine/types';

describe('listen events in chat messages', () => {
  it('attaches listenEvents to finalized ChatMessage', () => {
    const session = createSession();
    const listenEvents: ListenEvent[] = [{
      audioUrl: 'blob:http://localhost/test-audio',
      duration: 4,
      evaluation: 'Sounds good, the kick is punchy.',
      isDiff: false,
      scope: 'full mix',
    }];

    const result = finalizeAITurn(
      session,
      session.undoStack.length,
      ['I listened to the mix.'],
      [],
      [],
      true,
      undefined,
      listenEvents,
    );

    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg).toBeDefined();
    expect(lastMsg.listenEvents).toHaveLength(1);
    expect(lastMsg.listenEvents![0].audioUrl).toBe('blob:http://localhost/test-audio');
    expect(lastMsg.listenEvents![0].evaluation).toBe('Sounds good, the kick is punchy.');
    expect(lastMsg.listenEvents![0].duration).toBe(4);
  });

  it('creates a message when only listen events are present (no say text, no log)', () => {
    const session = createSession();
    const listenEvents: ListenEvent[] = [{
      audioUrl: 'blob:http://localhost/test',
      duration: 2,
    }];

    const result = finalizeAITurn(
      session,
      session.undoStack.length,
      [],    // no say texts
      [],    // no log entries
      [],    // no tool calls
      true,
      undefined,
      listenEvents,
    );

    // A message should still be created because listen events are present
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg).toBeDefined();
    expect(lastMsg.role).toBe('ai');
    expect(lastMsg.listenEvents).toHaveLength(1);
  });

  it('omits listenEvents when array is empty', () => {
    const session = createSession();

    const result = finalizeAITurn(
      session,
      session.undoStack.length,
      ['Some text.'],
      [],
      [],
      true,
      undefined,
      [],
    );

    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg).toBeDefined();
    expect(lastMsg.listenEvents).toBeUndefined();
  });

  it('attaches multiple listen events for multi-listen turns', () => {
    const session = createSession();
    const listenEvents: ListenEvent[] = [
      { audioUrl: 'blob:a', duration: 2, scope: 'kick', evaluation: 'Kick is solid.' },
      { audioUrl: 'blob:b', duration: 2, scope: 'full mix', evaluation: 'Mix is balanced.', isDiff: true },
    ];

    const result = finalizeAITurn(
      session,
      session.undoStack.length,
      ['Evaluated the audio.'],
      [],
      [],
      true,
      undefined,
      listenEvents,
    );

    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.listenEvents).toHaveLength(2);
    expect(lastMsg.listenEvents![0].scope).toBe('kick');
    expect(lastMsg.listenEvents![1].isDiff).toBe(true);
  });
});
