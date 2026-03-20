import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../src/engine/types';
import { useAiTurnBoundary } from '../../src/ui/useAiTurnBoundary';

function makeMessage(text: string): ChatMessage {
  return { role: 'human', text, timestamp: Date.now() };
}

describe('useAiTurnBoundary', () => {
  it('invalidates the active turn and resets AI state on project switch', () => {
    const ai = {
      clearHistory: vi.fn(),
      restoreHistory: vi.fn(),
    };
    const onInvalidateActiveTurn = vi.fn();
    const onProjectBoundaryReset = vi.fn();
    const messages = [makeMessage('hello')];

    const { result, rerender } = renderHook(
      (props: { projectId: string | null; sessionMessages: ChatMessage[] }) => useAiTurnBoundary({
        projectId: props.projectId,
        sessionMessages: props.sessionMessages,
        ai,
        onInvalidateActiveTurn,
        onProjectBoundaryReset,
      }),
      {
      initialProps: { projectId: 'p1', sessionMessages: messages },
      },
    );

    const token = result.current.beginTurn();
    expect(result.current.isCurrentTurn(token)).toBe(true);

    rerender({ projectId: 'p2', sessionMessages: messages });

    expect(result.current.isCurrentTurn(token)).toBe(false);
    expect(onInvalidateActiveTurn).toHaveBeenCalledTimes(2); // initial project load + switch
    expect(onProjectBoundaryReset).toHaveBeenCalledTimes(2);
    expect(ai.clearHistory).toHaveBeenCalledTimes(2);
    expect(ai.restoreHistory).toHaveBeenCalledTimes(2);
    expect(ai.restoreHistory).toHaveBeenLastCalledWith(messages);
  });

  it('does not rerun the project boundary reset when projectId is unchanged', () => {
    const ai = {
      clearHistory: vi.fn(),
      restoreHistory: vi.fn(),
    };
    const onInvalidateActiveTurn = vi.fn();
    const onProjectBoundaryReset = vi.fn();

    const { rerender } = renderHook(
      (props: { projectId: string | null; sessionMessages: ChatMessage[] }) => useAiTurnBoundary({
        projectId: props.projectId,
        sessionMessages: props.sessionMessages,
        ai,
        onInvalidateActiveTurn,
        onProjectBoundaryReset,
      }),
      {
      initialProps: { projectId: 'p1', sessionMessages: [] },
      },
    );

    rerender({ projectId: 'p1', sessionMessages: [makeMessage('later')] });

    expect(onInvalidateActiveTurn).toHaveBeenCalledTimes(1);
    expect(onProjectBoundaryReset).toHaveBeenCalledTimes(1);
    expect(ai.clearHistory).toHaveBeenCalledTimes(1);
    expect(ai.restoreHistory).not.toHaveBeenCalled();
  });

  it('invalidates before a wrapped project-boundary action runs', async () => {
    const ai = {
      clearHistory: vi.fn(),
      restoreHistory: vi.fn(),
    };
    const onInvalidateActiveTurn = vi.fn();
    const onProjectBoundaryReset = vi.fn();

    const { result } = renderHook(() =>
      useAiTurnBoundary({
        projectId: 'p1',
        sessionMessages: [],
        ai,
        onInvalidateActiveTurn,
        onProjectBoundaryReset,
      }),
    );

    const events: string[] = [];
    await act(async () => {
      await result.current.wrapProjectBoundaryAction(async () => {
        events.push('action');
        return true;
      });
    });

    expect(onInvalidateActiveTurn).toHaveBeenCalledTimes(2); // initial load + wrapped action
    expect(events).toEqual(['action']);
  });

  it('invalidates an active turn when called directly (provider swap scenario)', () => {
    const ai = {
      clearHistory: vi.fn(),
      restoreHistory: vi.fn(),
    };
    const onInvalidateActiveTurn = vi.fn();
    const onProjectBoundaryReset = vi.fn();

    const { result } = renderHook(() =>
      useAiTurnBoundary({
        projectId: 'p1',
        sessionMessages: [],
        ai,
        onInvalidateActiveTurn,
        onProjectBoundaryReset,
      }),
    );

    // Start a turn
    const token = result.current.beginTurn();
    expect(result.current.isCurrentTurn(token)).toBe(true);

    // Simulate what handleApiKey does: call invalidateActiveTurn directly
    act(() => {
      result.current.invalidateActiveTurn();
    });

    // The old turn token should now be stale
    expect(result.current.isCurrentTurn(token)).toBe(false);
    // onInvalidateActiveTurn called: once for initial mount + once for explicit call
    expect(onInvalidateActiveTurn).toHaveBeenCalledTimes(2);
  });

  it('invalidates the current turn before running generic invalidate-and-proceed actions', async () => {
    const ai = {
      clearHistory: vi.fn(),
      restoreHistory: vi.fn(),
    };
    const onInvalidateActiveTurn = vi.fn();
    const onProjectBoundaryReset = vi.fn();

    const { result } = renderHook(() =>
      useAiTurnBoundary({
        projectId: 'p1',
        sessionMessages: [],
        ai,
        onInvalidateActiveTurn,
        onProjectBoundaryReset,
      }),
    );

    const token = result.current.beginTurn();
    const states: boolean[] = [];

    await act(async () => {
      await result.current.runWithTurnInvalidation(() => {
        states.push(result.current.isCurrentTurn(token));
      });
    });

    expect(states).toEqual([false]);
    expect(result.current.isCurrentTurn(token)).toBe(false);
    expect(onInvalidateActiveTurn).toHaveBeenCalledTimes(2); // initial load + invalidating action
  });
});
