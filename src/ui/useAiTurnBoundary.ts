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
  isTurnActive: boolean;
  ai: AiHistoryLike;
  onInvalidateActiveTurn: () => void;
  onProjectBoundaryReset: () => void;
}

export function useAiTurnBoundary({
  projectId,
  sessionMessages,
  isTurnActive,
  ai,
  onInvalidateActiveTurn,
  onProjectBoundaryReset,
}: UseAiTurnBoundaryOptions) {
  const prevProjectIdRef = useRef<string | null>(null);
  const turnEpochRef = useRef(new AITurnEpoch());
  const isTurnActiveRef = useRef(isTurnActive);
  const sessionMessagesRef = useRef(sessionMessages);
  const onInvalidateActiveTurnRef = useRef(onInvalidateActiveTurn);
  const onProjectBoundaryResetRef = useRef(onProjectBoundaryReset);

  isTurnActiveRef.current = isTurnActive;
  sessionMessagesRef.current = sessionMessages;
  onInvalidateActiveTurnRef.current = onInvalidateActiveTurn;
  onProjectBoundaryResetRef.current = onProjectBoundaryReset;

  const invalidateActiveTurn = useCallback(() => {
    turnEpochRef.current.invalidate();
    onInvalidateActiveTurnRef.current();
  }, []);

  useEffect(() => {
    if (!projectId) return;
    if (prevProjectIdRef.current === projectId) return;
    prevProjectIdRef.current = projectId;

    invalidateActiveTurn();
    onProjectBoundaryResetRef.current();
    ai.clearHistory();
    if (sessionMessagesRef.current.length > 0) {
      ai.restoreHistory(sessionMessagesRef.current);
    }
  }, [ai, invalidateActiveTurn, projectId]);

  const beginTurn = useCallback(() => turnEpochRef.current.begin(), []);
  const isCurrentTurn = useCallback((token: number) => turnEpochRef.current.isCurrent(token), []);
  const wrapProjectBoundaryAction = useCallback(
    async <T,>(action: () => Promise<T> | T): Promise<T> => {
      invalidateActiveTurn();
      return await action();
    },
    [invalidateActiveTurn],
  );
  const runWithActiveTurnInvalidation = useCallback(
    async <T,>(action: () => Promise<T> | T): Promise<T> => {
      if (isTurnActiveRef.current) {
        invalidateActiveTurn();
      }
      return await action();
    },
    [invalidateActiveTurn],
  );

  return {
    beginTurn,
    invalidateActiveTurn,
    isCurrentTurn,
    runWithActiveTurnInvalidation,
    wrapProjectBoundaryAction,
  };
}
