// src/ai/listener.ts
// Spike: Gemini Live API audio listener
// Streams synth output to Gemini and asks it to reason about the audio

import { GoogleGenAI, Modality } from '@google/genai';
import type { Session as LiveSession, LiveServerMessage } from '@google/genai';

export interface ListenerResult {
  question: string;
  answer: string;
  timestamp: number;
}

export type ListenerStatus = 'idle' | 'connecting' | 'listening' | 'error';

const SYSTEM_INSTRUCTION = `You are a synthesizer audio analyst for Gluon, a browser-based music tool using Mutable Instruments Plaits DSP.

You will receive a live audio stream from a synthesizer. Your job is to describe what you hear with musical and timbral vocabulary.

When asked questions, respond concisely (1-3 sentences). Focus on:
- Tonal quality: bright/dark, harsh/smooth, metallic/woody, buzzy/hollow
- Spectral content: resonant peaks, harmonic richness, noise content
- Temporal character: sustained/percussive, rhythmic patterns, evolving textures
- Musical qualities: pitch register, groove feel, density

Do NOT guess or make up qualities you cannot hear. If the audio is unclear, say so.`;

export class AudioListener {
  private ai: GoogleGenAI | null = null;
  private session: LiveSession | null = null;
  private worklet: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private workletCtx: AudioContext | null = null;
  private results: ListenerResult[] = [];
  private status: ListenerStatus = 'idle';
  private onStatus?: (status: ListenerStatus) => void;
  private onResult?: (result: ListenerResult) => void;
  private pendingQuestion: string | null = null;

  constructor(opts?: {
    onStatus?: (status: ListenerStatus) => void;
    onResult?: (result: ListenerResult) => void;
  }) {
    this.onStatus = opts?.onStatus;
    this.onResult = opts?.onResult;
  }

  async connect(apiKey: string, mediaStream: MediaStream): Promise<void> {
    this.setStatus('connecting');

    try {
      this.ai = new GoogleGenAI({ apiKey });

      // Set up audio capture: MediaStream -> AudioWorklet -> PCM chunks
      this.workletCtx = new AudioContext({ sampleRate: 16000 });
      this.source = this.workletCtx.createMediaStreamSource(mediaStream);

      await this.workletCtx.audioWorklet.addModule(
        URL.createObjectURL(new Blob([AUDIO_CAPTURE_WORKLET], { type: 'application/javascript' }))
      );

      this.worklet = new AudioWorkletNode(this.workletCtx, 'audio-capture-processor');
      this.source.connect(this.worklet);
      // Worklet doesn't need to connect to destination — just captures

      // Connect to Gemini Live API
      this.session = await this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            this.setStatus('listening');
            // Start forwarding audio chunks
            this.worklet!.port.onmessage = (e: MessageEvent) => {
              if (e.data.event === 'chunk' && this.session && this.status === 'listening') {
                try {
                  const int16Buffer: ArrayBuffer = e.data.data.int16arrayBuffer;
                  const base64 = arrayBufferToBase64(int16Buffer);
                  this.session.sendRealtimeInput({
                    audio: { data: base64, mimeType: 'audio/pcm;rate=16000' } as unknown as Blob,
                  });
                } catch {
                  // Socket may have closed between check and send
                }
              }
            };
          },
          onmessage: (message: LiveServerMessage) => {
            // Native audio model: text comes via outputTranscription
            const transcription = message.serverContent?.outputTranscription?.text;
            if (transcription) {
              this._partialResponse = (this._partialResponse ?? '') + transcription;
            }
            if (message.serverContent?.turnComplete && this._partialResponse) {
              this.handleResponse(this._partialResponse);
              this._partialResponse = '';
            }
          },
          onerror: (e: ErrorEvent) => {
            console.error('Listener error:', e);
            this.setStatus('error');
          },
          onclose: (e: CloseEvent) => {
            console.warn('Listener closed:', e.code, e.reason);
            this.setStatus('idle');
          },
        },
      });
    } catch (error) {
      console.error('Listener connect failed:', error);
      this.setStatus('error');
      throw error;
    }
  }

  private _partialResponse = '';

  private handleResponse(text: string): void {
    const result: ListenerResult = {
      question: this.pendingQuestion ?? '(unprompted)',
      answer: text.trim(),
      timestamp: Date.now(),
    };
    this.results.push(result);
    this.onResult?.(result);
    this.pendingQuestion = null;
  }

  ask(question: string): void {
    if (!this.session || this.status !== 'listening') return;
    this.pendingQuestion = question;
    this.session.sendClientContent({
      turns: question,
      turnComplete: true,
    });
  }

  getResults(): ListenerResult[] {
    return [...this.results];
  }

  getStatus(): ListenerStatus {
    return this.status;
  }

  disconnect(): void {
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.disconnect();
    }
    this.source?.disconnect();
    this.workletCtx?.close();
    this.session?.close();
    this.session = null;
    this.worklet = null;
    this.source = null;
    this.workletCtx = null;
    this.setStatus('idle');
  }

  private setStatus(status: ListenerStatus): void {
    this.status = status;
    this.onStatus?.(status);
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// AudioWorklet processor that captures PCM Int16 chunks
const AUDIO_CAPTURE_WORKLET = `
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(2048);
    this.bufferWriteIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channel = input[0];
    for (let i = 0; i < channel.length; i++) {
      // Float32 [-1, 1] -> Int16 [-32768, 32767]
      this.buffer[this.bufferWriteIndex++] = Math.max(-32768, Math.min(32767, channel[i] * 32768));
      if (this.bufferWriteIndex >= this.buffer.length) {
        this.port.postMessage({
          event: 'chunk',
          data: { int16arrayBuffer: this.buffer.buffer.slice(0) },
        });
        this.bufferWriteIndex = 0;
      }
    }
    return true;
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
`;

// Pre-defined spike questions for structured evaluation
export const SPIKE_QUESTIONS = [
  'Describe the tonal quality of what you hear right now.',
  'Is this sound bright or dark? Harsh or smooth?',
  'Are there resonant peaks? Where approximately in the frequency spectrum?',
  'How would you change the timbre to make this sound warmer?',
  'Is this sound percussive or sustained? Describe the temporal envelope.',
  'How many distinct voices or layers can you hear?',
  'Describe the rhythmic pattern if any.',
  'Is there harmonic clashing between the voices?',
];
