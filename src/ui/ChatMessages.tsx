import { useRef, useEffect } from 'react';
import type { ChatMessage } from '../engine/types';

interface Props {
  messages: ChatMessage[];
  isThinking?: boolean;
  isListening?: boolean;
}

export function ChatMessages({ messages, isThinking = false, isListening = false }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, isThinking, isListening]);

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
              msg.role === 'ai' ? 'bg-teal-500/70' : 'bg-zinc-700'
            }`}
            style={{ minHeight: '1rem' }}
          />
          <div className="min-w-0 flex-1">
            <div className={`text-[8px] font-mono uppercase tracking-[0.2em] mb-1 ${
              msg.role === 'ai' ? 'text-teal-600/80' : 'text-zinc-600'
            }`}>
              {msg.role === 'ai' ? 'AI' : 'YOU'}
            </div>
            {msg.text && (
              <div className={`text-[11px] leading-[1.6] break-words ${
                msg.role === 'ai' ? 'text-zinc-300' : 'text-zinc-400'
              }`}>
                {msg.text}
              </div>
            )}
            {msg.actions && msg.actions.length > 0 && (
              <div className="mt-2 space-y-px">
                {msg.actions.map((a, j) => (
                  <div key={j} className="flex items-baseline gap-1.5 text-[10px] font-mono">
                    <span className="text-teal-500/50">{a.voiceLabel}</span>
                    <span className="text-zinc-600">{a.description}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}

      {(isThinking || isListening) && (
        <div className="flex gap-2 px-2.5 py-2" style={{ animation: 'fade-up 0.15s ease-out' }}>
          <div
            className="w-px shrink-0 rounded-full bg-teal-500/70 mt-0.5"
            style={{ animation: 'pulse-soft 1.5s ease-in-out infinite', minHeight: '1rem' }}
          />
          <div className="min-w-0">
            <div className="text-[8px] font-mono uppercase tracking-[0.2em] mb-1 text-teal-600/80">AI</div>
            <div className="flex items-center gap-1.5">
              <ThinkingDots />
              <span className="text-[10px] font-mono text-zinc-600">
                {isListening ? 'listening' : 'thinking'}
              </span>
            </div>
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
