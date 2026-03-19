// tests/ai/graceful-degradation.test.ts — #8 graceful degradation tests
import { describe, it, expect } from 'vitest';
import { GluonAI } from '../../src/ai/api';
import type { PlannerProvider, ListenerProvider, GenerateResult, FunctionResponse, ToolSchema, StreamTextCallback, StepExecutor } from '../../src/ai/types';
import { createSession } from '../../src/engine/session';

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

function stubPlanner(configured = true): PlannerProvider {
  return {
    name: 'stub-planner',
    isConfigured: () => configured,
    startTurn: async () => ({ textParts: ['hi'], functionCalls: [] }),
    continueTurn: async () => ({ textParts: [], functionCalls: [] }),
    commitTurn() {},
    discardTurn() {},
    trimHistory() {},
    clearHistory() {},
  };
}

function stubListener(configured = true): ListenerProvider {
  return {
    name: 'stub-listener',
    isConfigured: () => configured,
    evaluate: async () => 'sounds good',
  };
}

const noopExecutor: StepExecutor = (session, actions) => ({
  session,
  accepted: actions,
  rejected: [],
  log: [],
  sayTexts: [],
  resolvedParams: new Map(),
  preservationReports: [],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GluonAI graceful degradation', () => {
  describe('isPlannerConfigured / isListenerConfigured', () => {
    it('returns true for planner when planner is configured', () => {
      const ai = new GluonAI(stubPlanner(true), stubListener(false), [stubListener(false)]);
      expect(ai.isPlannerConfigured()).toBe(true);
      expect(ai.isListenerConfigured()).toBe(false);
    });

    it('returns true for listener when at least one listener is configured', () => {
      const ai = new GluonAI(stubPlanner(false), stubListener(true), [stubListener(false), stubListener(true)]);
      expect(ai.isPlannerConfigured()).toBe(false);
      expect(ai.isListenerConfigured()).toBe(true);
    });

    it('returns false for both when nothing is configured', () => {
      const ai = new GluonAI(stubPlanner(false), stubListener(false), [stubListener(false)]);
      expect(ai.isPlannerConfigured()).toBe(false);
      expect(ai.isListenerConfigured()).toBe(false);
    });
  });

  describe('isConfigured (legacy)', () => {
    it('returns true when planner is configured (listener irrelevant)', () => {
      const ai = new GluonAI(stubPlanner(true), stubListener(false), [stubListener(false)]);
      expect(ai.isConfigured()).toBe(true);
    });

    it('returns false when planner is not configured', () => {
      const ai = new GluonAI(stubPlanner(false), stubListener(true), [stubListener(true)]);
      expect(ai.isConfigured()).toBe(false);
    });
  });

  describe('getModelStatus', () => {
    it('reflects available when both configured', () => {
      const ai = new GluonAI(stubPlanner(true), stubListener(true), [stubListener(true)]);
      const status = ai.getModelStatus();
      expect(status.planner).toBe('available');
      expect(status.listener).toBe('available');
    });

    it('reflects disabled when planner unconfigured', () => {
      const ai = new GluonAI(stubPlanner(false), stubListener(true), [stubListener(true)]);
      const status = ai.getModelStatus();
      expect(status.planner).toBe('disabled');
      expect(status.listener).toBe('available');
    });

    it('reflects disabled when listener unconfigured', () => {
      const ai = new GluonAI(stubPlanner(true), stubListener(false), [stubListener(false)]);
      const status = ai.getModelStatus();
      expect(status.planner).toBe('available');
      expect(status.listener).toBe('disabled');
    });

    it('reflects disabled for both when nothing configured', () => {
      const ai = new GluonAI(stubPlanner(false), stubListener(false), [stubListener(false)]);
      const status = ai.getModelStatus();
      expect(status.planner).toBe('disabled');
      expect(status.listener).toBe('disabled');
    });
  });

  describe('askStreaming with planner but no listener', () => {
    it('completes successfully (listen tool would fail gracefully at call time)', async () => {
      const ai = new GluonAI(stubPlanner(true), stubListener(false), [stubListener(false)]);
      const actions = await ai.askStreaming(
        createSession(),
        'hello',
        {},
        noopExecutor,
      );
      // Should not throw — planner works, listener degradation only affects listen tool
      expect(actions).toBeDefined();
    });
  });

  describe('evaluateWithListeners error message', () => {
    it('returns specific unavailable message when no listener configured', async () => {
      const ai = new GluonAI(stubPlanner(true), stubListener(false), [stubListener(false)]);
      // Access the private method via any cast for testing
      try {
        await (ai as any).evaluateWithListeners({
          systemPrompt: '',
          stateJson: '{}',
          question: 'test',
          audioData: new Blob(),
          mimeType: 'audio/wav',
        });
        // Should have thrown
        expect.unreachable('should have thrown');
      } catch (err: any) {
        expect(err.message).toBe('Audio evaluation unavailable — no listener model configured.');
      }
    });
  });
});
