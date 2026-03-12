// src/ai/api.ts

import { GoogleGenAI, createPartFromFunctionResponse, FunctionCallingConfigMode } from '@google/genai';
import type { Content, FunctionCall, Part } from '@google/genai';
import type { Session, AIAction, AIMoveAction, AISketchAction, AITransportAction, AISetModelAction } from '../engine/types';
import { compressState } from './state-compression';
import { GLUON_SYSTEM_PROMPT } from './system-prompt';
import { GLUON_LISTEN_PROMPT } from './listen-prompt';
import { GLUON_TOOLS } from './tool-declarations';

const MODEL = 'gemini-2.5-flash';

/** Build an error function response that returns no actions */
function errorResponse(
  id: string,
  name: string,
  message: string,
): { actions: AIAction[]; responsePart: Part } {
  return {
    actions: [],
    responsePart: createPartFromFunctionResponse(id, name, { error: message }),
  };
}

/** Context for the listen tool — audio capture and eval plumbing */
export interface ListenContext {
  getAudioDestination: () => MediaStreamAudioDestinationNode | null;
  captureNBars: (dest: MediaStreamAudioDestinationNode, bars: number, patternLength: number, bpm: number) => Promise<Blob>;
  onListening?: (active: boolean) => void;
}

/**
 * Pre-validate an action against current session state.
 * Returns null if the action will be accepted, or a rejection reason string.
 * This runs the same checks as executeOperations() (voice existence, agency,
 * control validity, arbitration) so the tool response is honest.
 */
export type ActionValidator = (action: AIAction) => string | null;

/** Context passed to ask() for listen support and cancellation */
export interface AskContext {
  listen?: ListenContext;
  isStale?: () => boolean;
  /** Pre-validate actions against session state before returning tool responses */
  validateAction?: ActionValidator;
}

/** A single human-AI exchange, stored as an atomic unit for history trimming */
interface Exchange {
  userText: string;
  turns: Content[];
}

/** Backoff state for rate-limit handling */
interface BackoffState {
  until: number;
  delay: number;
}

export class GluonAI {
  private ai: GoogleGenAI | null = null;
  private exchanges: Exchange[] = [];
  private backoff: BackoffState = { until: 0, delay: 0 };

  private static MAX_EXCHANGES = 12;
  private static MAX_TOOL_ROUNDS = 5;

  constructor() {
    const envKey = import.meta.env.VITE_GOOGLE_API_KEY;
    if (envKey) {
      this.setApiKey(envKey);
    }
  }

  setApiKey(key: string): void {
    this.ai = new GoogleGenAI({ apiKey: key });
    this.exchanges = [];
    this.backoff = { until: 0, delay: 0 };
  }

  isConfigured(): boolean {
    return this.ai !== null;
  }

  async ask(session: Session, humanMessage: string, ctx?: AskContext): Promise<AIAction[]> {
    if (!this.ai) return [];

    // Trim history
    if (this.exchanges.length > GluonAI.MAX_EXCHANGES) {
      this.exchanges = this.exchanges.slice(-GluonAI.MAX_EXCHANGES);
    }

    // Build contents: history + current turn
    const contents: Content[] = [];
    for (const ex of this.exchanges) {
      contents.push({ role: 'user', parts: [{ text: ex.userText }] });
      for (const turn of ex.turns) {
        // Ensure every history entry is a valid Content object for the SDK.
        // API responses sometimes omit `parts` or `role`; normalize here.
        contents.push({
          role: turn.role ?? 'model',
          parts: Array.isArray(turn.parts) ? turn.parts : [],
        });
      }
    }

    const state = compressState(session);
    const userText = `Project state:\n${JSON.stringify(state)}\n\nHuman says: ${humanMessage}`;
    contents.push({ role: 'user', parts: [{ text: userText }] });

    const collectedActions: AIAction[] = [];
    const loopContents: Content[] = [];
    let hadError = false;

    try {
      for (let round = 0; round < GluonAI.MAX_TOOL_ROUNDS; round++) {
        // Cancellation check before API call
        if (ctx?.isStale?.()) break;

        const response = await this.callWithTools(contents);
        const candidate = response.candidates?.[0];
        const rawContent = candidate?.content;

        // Empty or missing content — the API returned nothing useful.
        // This can happen when safety filters suppress the response or
        // the model produces only thinking tokens with no visible output.
        if (!rawContent || !Array.isArray(rawContent.parts) || rawContent.parts.length === 0) {
          break;
        }

        // Normalize model content to guarantee valid Content shape.
        const modelContent: Content = {
          role: rawContent.role ?? 'model',
          parts: rawContent.parts,
        };

        loopContents.push(modelContent);
        contents.push(modelContent);

        // Collect text parts as say actions (skip thought parts)
        for (const part of modelContent.parts) {
          if (part.text && !('thought' in part && part.thought)) {
            collectedActions.push({ type: 'say', text: part.text });
          }
        }

        // Check for function calls
        const functionCalls = response.functionCalls;
        if (!functionCalls || functionCalls.length === 0) break;

        // Execute function calls sequentially
        const responseParts: Part[] = [];
        for (const fc of functionCalls) {
          const result = await this.executeFunctionCall(fc, session, ctx);
          collectedActions.push(...result.actions);
          responseParts.push(result.responsePart);
        }

        const functionResponseContent: Content = { role: 'user', parts: responseParts };
        loopContents.push(functionResponseContent);
        contents.push(functionResponseContent);
      }
    } catch (error) {
      hadError = true;
      const errorActions = this.handleError(error);
      collectedActions.push(...errorActions);
    }

    // Only store exchange in history if the request succeeded and wasn't
    // cancelled. Broken or stale exchanges pollute history and cause
    // cascading SDK failures on subsequent calls.
    if (!ctx?.isStale?.() && !hadError && loopContents.length > 0) {
      this.exchanges.push({ userText: humanMessage, turns: loopContents });
      if (this.exchanges.length > GluonAI.MAX_EXCHANGES) {
        this.exchanges = this.exchanges.slice(-GluonAI.MAX_EXCHANGES);
      }
    }

    return collectedActions;
  }

  private async callWithTools(contents: Content[]) {
    if (!this.ai) throw new Error('API not configured');

    const now = Date.now();
    if (now < this.backoff.until) {
      throw new Error('Rate limited — backing off.');
    }

    const response = await this.ai.models.generateContent({
      model: MODEL,
      contents: [...contents],
      config: {
        systemInstruction: GLUON_SYSTEM_PROMPT,
        maxOutputTokens: 2048,
        tools: [{ functionDeclarations: GLUON_TOOLS }],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.AUTO,
          },
        },
      },
    });

    this.backoff = { until: 0, delay: 0 };
    return response;
  }

  private async executeFunctionCall(
    fc: FunctionCall,
    session: Session,
    ctx?: AskContext,
  ): Promise<{ actions: AIAction[]; responsePart: Part }> {
    const name = fc.name ?? '';
    const args = fc.args ?? {};
    const id = fc.id ?? '';

    switch (name) {
      case 'move': {
        // Validate required args
        if (typeof args.param !== 'string' || !args.param) {
          return errorResponse(id, name, 'Missing required parameter: param');
        }
        const target = args.target as Record<string, unknown> | undefined;
        if (!target || (typeof target.absolute !== 'number' && typeof target.relative !== 'number')) {
          return errorResponse(id, name, 'Missing required parameter: target (needs absolute or relative number)');
        }

        const action: AIMoveAction = {
          type: 'move',
          param: args.param as string,
          target: target as { absolute?: number; relative?: number },
          ...(args.voiceId ? { voiceId: args.voiceId as string } : {}),
          ...(args.over ? { over: args.over as number } : {}),
        };

        const rejection = ctx?.validateAction?.(action);
        if (rejection) return errorResponse(id, name, rejection);

        return {
          actions: [action],
          responsePart: createPartFromFunctionResponse(id, name, {
            queued: true,
            param: action.param,
            ...(action.voiceId ? { voiceId: action.voiceId } : {}),
            target: action.target,
          }),
        };
      }

      case 'sketch': {
        if (typeof args.voiceId !== 'string' || !args.voiceId) {
          return errorResponse(id, name, 'Missing required parameter: voiceId');
        }
        if (typeof args.description !== 'string') {
          return errorResponse(id, name, 'Missing required parameter: description');
        }
        if (!Array.isArray(args.events)) {
          return errorResponse(id, name, 'Missing required parameter: events (must be an array)');
        }

        const action: AISketchAction = {
          type: 'sketch',
          voiceId: args.voiceId as string,
          description: args.description as string,
          events: args.events as AISketchAction['events'],
        };

        const rejection = ctx?.validateAction?.(action);
        if (rejection) return errorResponse(id, name, rejection);

        return {
          actions: [action],
          responsePart: createPartFromFunctionResponse(id, name, {
            queued: true,
            voiceId: action.voiceId,
            description: action.description,
            eventCount: action.events?.length ?? 0,
          }),
        };
      }

      case 'set_transport': {
        const hasBpm = typeof args.bpm === 'number';
        const hasSwing = typeof args.swing === 'number';
        const hasPlaying = typeof args.playing === 'boolean';
        if (!hasBpm && !hasSwing && !hasPlaying) {
          return errorResponse(id, name, 'At least one of bpm, swing, or playing must be provided');
        }

        const action: AITransportAction = {
          type: 'set_transport',
          ...(hasBpm ? { bpm: args.bpm as number } : {}),
          ...(hasSwing ? { swing: args.swing as number } : {}),
          ...(hasPlaying ? { playing: args.playing as boolean } : {}),
        };

        const rejection = ctx?.validateAction?.(action);
        if (rejection) return errorResponse(id, name, rejection);

        return {
          actions: [action],
          responsePart: createPartFromFunctionResponse(id, name, {
            queued: true,
            ...(action.bpm !== undefined ? { bpm: action.bpm } : {}),
            ...(action.swing !== undefined ? { swing: action.swing } : {}),
            ...(action.playing !== undefined ? { playing: action.playing } : {}),
          }),
        };
      }

      case 'set_model': {
        if (typeof args.voiceId !== 'string' || !args.voiceId) {
          return errorResponse(id, name, 'Missing required parameter: voiceId');
        }
        if (typeof args.model !== 'string' || !args.model) {
          return errorResponse(id, name, 'Missing required parameter: model');
        }

        const action: AISetModelAction = {
          type: 'set_model',
          voiceId: args.voiceId as string,
          model: args.model as string,
        };

        const rejection = ctx?.validateAction?.(action);
        if (rejection) return errorResponse(id, name, rejection);

        return {
          actions: [action],
          responsePart: createPartFromFunctionResponse(id, name, {
            queued: true,
            voiceId: action.voiceId,
            model: action.model,
          }),
        };
      }

      case 'listen': {
        // Cancellation check before side effect
        if (ctx?.isStale?.()) {
          return {
            actions: [],
            responsePart: createPartFromFunctionResponse(id, name, {
              error: 'Request cancelled.',
            }),
          };
        }

        const question = (args.question as string) ?? 'How does it sound?';
        const result = await this.listenHandler(question, session, ctx?.listen);
        return {
          actions: [],
          responsePart: createPartFromFunctionResponse(id, name, result),
        };
      }

      default:
        return {
          actions: [],
          responsePart: createPartFromFunctionResponse(id, name, {
            error: `Unknown tool: ${name}`,
          }),
        };
    }
  }

  private async listenHandler(
    question: string,
    session: Session,
    listen?: ListenContext,
  ): Promise<Record<string, unknown>> {
    if (!listen) {
      return { error: 'Listen not available.' };
    }

    if (!session.transport.playing) {
      return { error: "Transport is stopped — press play first." };
    }

    const dest = listen.getAudioDestination();
    if (!dest) {
      return { error: 'Audio destination not available.' };
    }

    try {
      listen.onListening?.(true);

      const activeVoice = session.voices.find(v => v.id === session.activeVoiceId);
      const patternLength = activeVoice?.pattern.length ?? 16;
      const wavBlob = await listen.captureNBars(dest, 2, patternLength, session.transport.bpm);

      const critique = await this.evaluateAudio(session, wavBlob, 'audio/wav', question);
      return { critique };
    } catch {
      return { error: 'Audio evaluation failed — try again.' };
    } finally {
      listen.onListening?.(false);
    }
  }

  private async evaluateAudio(
    session: Session,
    audioBlob: Blob,
    mimeType: string,
    question: string,
  ): Promise<string> {
    if (!this.ai) return 'API not configured.';

    const now = Date.now();
    if (now < this.backoff.until) return 'Rate limited — try again shortly.';

    const state = compressState(session);
    const audioBytes = new Uint8Array(await audioBlob.arrayBuffer());
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < audioBytes.length; i += chunkSize) {
      binary += String.fromCharCode(...audioBytes.subarray(i, i + chunkSize));
    }
    const audioBase64 = btoa(binary);

    try {
      const response = await this.ai.models.generateContent({
        model: MODEL,
        config: {
          systemInstruction: GLUON_LISTEN_PROMPT,
        },
        contents: [{
          role: 'user',
          parts: [
            { text: `Project state:\n${JSON.stringify(state)}\n\nQuestion: ${question}` },
            { inlineData: { mimeType, data: audioBase64 } },
          ],
        }],
      });

      this.backoff = { until: 0, delay: 0 };
      return response.text ?? 'No response from model.';
    } catch (error) {
      const actions = this.handleError(error);
      const sayAction = actions.find(a => a.type === 'say');
      return sayAction && 'text' in sayAction ? sayAction.text : 'Audio evaluation failed.';
    }
  }

  private handleError(error: unknown): AIAction[] {
    const msg = error instanceof Error ? error.message : String(error);
    const status = (error as { status?: number }).status
      ?? (error as { httpStatusCode?: number }).httpStatusCode;

    if (status === 429 || /rate.limit|quota|resource.exhausted/i.test(msg)) {
      const delay = Math.min(this.backoff.delay ? this.backoff.delay * 2 : 5_000, 120_000);
      this.backoff = { until: Date.now() + delay, delay };
      const secs = Math.round(delay / 1000);
      return [{ type: 'say', text: `Rate limited — backing off for ${secs}s.` }];
    }

    if (status === 401 || status === 403 || /api.key|unauthorized|forbidden/i.test(msg)) {
      return [{ type: 'say', text: 'API key invalid or missing permissions. Check your Google API key.' }];
    }

    if (status && status >= 500) {
      this.backoff = { until: Date.now() + 10_000, delay: 10_000 };
      return [{ type: 'say', text: 'Gemini API error — retrying shortly.' }];
    }

    console.error('Gluon AI call failed:', error);
    return [];
  }

  clearHistory(): void {
    this.exchanges = [];
    this.backoff = { until: 0, delay: 0 };
  }
}
