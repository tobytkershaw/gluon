import { useRef, useEffect } from 'react';
import type { ChatMessage } from '../engine/types';
import { ActionDiffView } from './ActionDiffView';
import { ToolCallsView } from './ToolCallsView';

interface Props {
  messages: ChatMessage[];
  isThinking?: boolean;
  isListening?: boolean;
  /** Partial text being streamed from the AI before the full response completes. */
  streamingText?: string;
}

export function ChatMessages({ messages, isThinking = false, isListening = false, streamingText = '' }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, isThinking, isListening, streamingText]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto chat-scroll p-3 space-y-2">
      {messages.length === 0 && !isThinking && (
        <div className="flex items-center justify-center h-full opacity-[0.04]">
          <svg viewBox="0 0 24 24" className="w-16 h-16 text-zinc-100">
            <path fill="currentColor" d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
          </svg>
        </div>
      )}

      {messages.map((msg, i) => (
        <div
          key={i}
          className={`flex gap-2 rounded px-2.5 py-2 ${
            msg.role === 'ai' ? 'bg-zinc-800/20' : ''
          }`}
          style={{ animation: 'fade-up 0.15s ease-out' }}
        >
          {/* Role indicator bar */}
          <div
            className={`w-px shrink-0 rounded-full mt-0.5 ${
              msg.role === 'ai' ? 'bg-teal-500/70' : msg.role === 'system' ? 'bg-zinc-600' : 'bg-zinc-700'
            }`}
            style={{ minHeight: '1rem' }}
          />
          <div className="min-w-0 flex-1">
            <div className={`text-[8px] font-mono uppercase tracking-[0.2em] mb-1 ${
              msg.role === 'ai' ? 'text-teal-600/80' : 'text-zinc-600'
            }`}>
              {msg.role === 'ai' ? 'AI' : msg.role === 'system' ? 'SYS' : 'YOU'}
            </div>
            {msg.text && (
              <div className={`text-[11px] leading-[1.6] break-words ${
                msg.role === 'ai' ? 'text-zinc-300' : msg.role === 'system' ? 'text-zinc-500' : 'text-zinc-400'
              }`}>
                {msg.text}
              </div>
            )}
            {msg.actions && msg.actions.length > 0 && (
              <div className="mt-2 space-y-px">
                {msg.actions.map((a, j) => (
                  <ActionDiffView key={j} entry={a} />
                ))}
              </div>
            )}
            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <ToolCallsView toolCalls={msg.toolCalls} />
            )}
          </div>
        </div>
      ))}

      {(isThinking || isListening) && (
        <div className="flex gap-2 rounded px-2.5 py-2 bg-zinc-800/20" style={{ animation: 'fade-up 0.15s ease-out' }}>
          <div
            className="w-px shrink-0 rounded-full bg-teal-500/70 mt-0.5"
            style={{ ...(!streamingText ? { animation: 'pulse-soft 1.5s ease-in-out infinite' } : {}), minHeight: '1rem' }}
          />
          <div className="min-w-0 flex-1">
            <div className="text-[8px] font-mono uppercase tracking-[0.2em] mb-1 text-teal-600/80">AI</div>
            {streamingText ? (
              <div className="text-[11px] leading-[1.6] break-words text-zinc-300">
                {streamingText}
                <span
                  className="inline-block w-1.5 h-3 ml-0.5 bg-teal-500/60 rounded-sm align-text-bottom"
                  style={{ animation: 'pulse-soft 0.8s ease-in-out infinite' }}
                />
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <ThinkingDots />
                <span className="text-[10px] font-mono text-zinc-600">
                  {isListening ? 'listening' : 'thinking'}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ThinkingDots() {
  return (
    <div className="flex gap-0.5 items-center">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1 h-1 rounded-full bg-teal-500/60"
          style={{
            animation: 'pulse-soft 1.2s ease-in-out infinite',
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
    </div>
  );
}
