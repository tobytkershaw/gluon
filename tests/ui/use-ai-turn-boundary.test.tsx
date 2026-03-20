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
      (props: { projectId: string | null; sessionMessages: ChatMessage[]; isTurnActive: boolean }) => useAiTurnBoundary({
        projectId: props.projectId,
        sessionMessages: props.sessionMessages,
        isTurnActive: props.isTurnActive,
        ai,
        onInvalidateActiveTurn,
        onProjectBoundaryReset,
      }),
      {
      initialProps: { projectId: 'p1', sessionMessages: messages, isTurnActive: false },
      },
    );

    const token = result.current.beginTurn();
    expect(result.current.isCurrentTurn(token)).toBe(true);

    rerender({ projectId: 'p2', sessionMessages: messages, isTurnActive: false });

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
      (props: { projectId: string | null; sessionMessages: ChatMessage[]; isTurnActive: boolean }) => useAiTurnBoundary({
        projectId: props.projectId,
        sessionMessages: props.sessionMessages,
        isTurnActive: props.isTurnActive,
        ai,
        onInvalidateActiveTurn,
        onProjectBoundaryReset,
      }),
      {
      initialProps: { projectId: 'p1', sessionMessages: [], isTurnActive: false },
      },
    );

    rerender({ projectId: 'p1', sessionMessages: [makeMessage('later')], isTurnActive: false });

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
        isTurnActive: false,
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
        isTurnActive: false,
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

  it('invalidates active turns before running active-turn mutation actions', async () => {
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
        isTurnActive: true,
        ai,
        onInvalidateActiveTurn,
        onProjectBoundaryReset,
      }),
    );

    const token = result.current.beginTurn();
    const states: boolean[] = [];

    await act(async () => {
      await result.current.runWithActiveTurnInvalidation(() => {
        states.push(result.current.isCurrentTurn(token));
      });
    });

    expect(states).toEqual([false]);
    expect(result.current.isCurrentTurn(token)).toBe(false);
    expect(onInvalidateActiveTurn).toHaveBeenCalledTimes(2); // initial load + active-turn action
  });

  it('does not invalidate when active-turn mutation actions run without an active turn', async () => {
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
        isTurnActive: false,
        ai,
        onInvalidateActiveTurn,
        onProjectBoundaryReset,
      }),
    );

    const token = result.current.beginTurn();
    const states: boolean[] = [];

    await act(async () => {
      await result.current.runWithActiveTurnInvalidation(() => {
        states.push(result.current.isCurrentTurn(token));
      });
    });

    expect(states).toEqual([true]);
    expect(result.current.isCurrentTurn(token)).toBe(true);
    expect(onInvalidateActiveTurn).toHaveBeenCalledTimes(1); // initial load only
  });
});
