// tests/ai/providers/gemini-listener.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderError } from '../../../src/ai/types';

// Mock the @google/genai module
const mockGenerateContent = vi.fn();
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = { generateContent: mockGenerateContent };
    },
  };
});

import { GeminiListenerProvider } from '../../../src/ai/providers/gemini-listener';

describe('GeminiListenerProvider', () => {
  let listener: GeminiListenerProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    listener = new GeminiListenerProvider('test-key');
  });

  it('isConfigured returns true with valid key', () => {
    expect(listener.isConfigured()).toBe(true);
  });

  it('isConfigured returns false with empty key', () => {
    const empty = new GeminiListenerProvider('');
    expect(empty.isConfigured()).toBe(false);
  });

  it('encodes audio blob as base64 inlineData', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: 'sounds good' });

    const audioBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // RIFF header
    const blob = new Blob([audioBytes], { type: 'audio/wav' });

    await listener.evaluate({
      systemPrompt: 'listen prompt',
      stateJson: '{}',
      question: 'how does it sound?',
      audioData: blob,
      mimeType: 'audio/wav',
    });

    const call = mockGenerateContent.mock.calls[0][0];
    const parts = call.contents[0].parts;

    // First part: text with state and question
    expect(parts[0].text).toContain('how does it sound?');
    expect(parts[0].text).toContain('Project state:');

    // Second part: inlineData with base64
    expect(parts[1].inlineData).toBeDefined();
    expect(parts[1].inlineData.mimeType).toBe('audio/wav');
    expect(typeof parts[1].inlineData.data).toBe('string');
    // Verify base64 is valid
    expect(parts[1].inlineData.data.length).toBeGreaterThan(0);
  });

  it('returns model text response', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: 'The kick is punchy.' });

    const blob = new Blob([new Uint8Array(4)], { type: 'audio/wav' });
    const result = await listener.evaluate({
      systemPrompt: 'listen',
      stateJson: '{}',
      question: 'how does it sound?',
      audioData: blob,
      mimeType: 'audio/wav',
    });

    expect(result).toBe('The kick is punchy.');
  });

  it('returns fallback when response has no text', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: undefined });

    const blob = new Blob([new Uint8Array(4)], { type: 'audio/wav' });
    const result = await listener.evaluate({
      systemPrompt: 'listen',
      stateJson: '{}',
      question: 'test',
      audioData: blob,
      mimeType: 'audio/wav',
    });

    expect(result).toBe('No response from model.');
  });

  it('translates 429 to ProviderError rate_limited', async () => {
    const error = new Error('Resource exhausted');
    (error as Record<string, unknown>).status = 429;
    mockGenerateContent.mockRejectedValueOnce(error);

    const blob = new Blob([new Uint8Array(4)], { type: 'audio/wav' });
    try {
      await listener.evaluate({
        systemPrompt: 'listen',
        stateJson: '{}',
        question: 'test',
        audioData: blob,
        mimeType: 'audio/wav',
      });
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).kind).toBe('rate_limited');
    }
  });

  it('translates 401 to ProviderError auth', async () => {
    const error = new Error('Unauthorized');
    (error as Record<string, unknown>).status = 401;
    mockGenerateContent.mockRejectedValueOnce(error);

    const blob = new Blob([new Uint8Array(4)], { type: 'audio/wav' });
    try {
      await listener.evaluate({
        systemPrompt: 'listen',
        stateJson: '{}',
        question: 'test',
        audioData: blob,
        mimeType: 'audio/wav',
      });
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).kind).toBe('auth');
    }
  });

  it('translates 500 to ProviderError server', async () => {
    const error = new Error('Server error');
    (error as Record<string, unknown>).status = 500;
    mockGenerateContent.mockRejectedValueOnce(error);

    const blob = new Blob([new Uint8Array(4)], { type: 'audio/wav' });
    try {
      await listener.evaluate({
        systemPrompt: 'listen',
        stateJson: '{}',
        question: 'test',
        audioData: blob,
        mimeType: 'audio/wav',
      });
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).kind).toBe('server');
    }
  });

  it('passes system prompt as systemInstruction', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: 'ok' });

    const blob = new Blob([new Uint8Array(4)], { type: 'audio/wav' });
    await listener.evaluate({
      systemPrompt: 'You are a music listener.',
      stateJson: '{}',
      question: 'test',
      audioData: blob,
      mimeType: 'audio/wav',
    });

    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.config.systemInstruction).toBe('You are a music listener.');
  });
});
