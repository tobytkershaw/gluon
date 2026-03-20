import { useCallback, useEffect, useRef } from 'react';
import type { ChatMessage } from '../engine/types';
import { AITurnEpoch } from './ai-turn-epoch';

interface AiHistoryLike {
  clearHistory: () => void;
  restoreHistory: (messages: ChatMessage[]) => void;
}

interface UseAiTurnBoundaryOptions {
  projectId: string | null;
  sessionMessages: ChatMessage[];
  ai: AiHistoryLike;
  onInvalidateActiveTurn: () => void;
  onProjectBoundaryReset: () => void;
}

export function useAiTurnBoundary({
  projectId,
  sessionMessages,
  ai,
  onInvalidateActiveTurn,
  onProjectBoundaryReset,
}: UseAiTurnBoundaryOptions) {
  const prevProjectIdRef = useRef<string | null>(null);
  const turnEpochRef = useRef(new AITurnEpoch());

  const invalidateActiveTurn = useCallback(() => {
    turnEpochRef.current.invalidate();
    onInvalidateActiveTurn();
  }, [onInvalidateActiveTurn]);

  useEffect(() => {
    if (!projectId) return;
    if (prevProjectIdRef.current === projectId) return;
    prevProjectIdRef.current = projectId;

    invalidateActiveTurn();
    onProjectBoundaryReset();
    ai.clearHistory();
    if (sessionMessages.length > 0) {
      ai.restoreHistory(sessionMessages);
    }
  }, [ai, invalidateActiveTurn, onProjectBoundaryReset, projectId, sessionMessages]);

  const beginTurn = useCallback(() => turnEpochRef.current.begin(), []);
  const isCurrentTurn = useCallback((token: number) => turnEpochRef.current.isCurrent(token), []);
  const wrapProjectBoundaryAction = useCallback(
    async <T,>(action: () => Promise<T> | T): Promise<T> => {
      invalidateActiveTurn();
      return await action();
    },
    [invalidateActiveTurn],
  );

  return {
    beginTurn,
    invalidateActiveTurn,
    isCurrentTurn,
    runWithTurnInvalidation: wrapProjectBoundaryAction,
    wrapProjectBoundaryAction,
  };
}
