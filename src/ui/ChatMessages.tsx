import { useRef, useEffect } from 'react';
import type { ChatMessage } from '../engine/types';

interface Props {
  messages: ChatMessage[];
  isThinking?: boolean;
}

export function ChatMessages({ messages, isThinking = false }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, isThinking]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto chat-scroll p-3 space-y-3">
      {messages.length === 0 && !isThinking ? (
        <div className="text-zinc-700 text-[10px] font-mono text-center mt-12 tracking-wide">
          Talk to the AI...
        </div>
      ) : (
        messages.map((msg, i) => (
          <div
            key={i}
            className="flex gap-2"
            style={{ animation: 'fade-up 0.15s ease-out' }}
          >
            <div
              className={`w-0.5 shrink-0 rounded-full ${
                msg.role === 'ai' ? 'bg-teal-500' : 'bg-amber-500/40'
              }`}
            />
            <div className="min-w-0">
              <div className={`text-[8px] font-mono uppercase tracking-[0.15em] mb-0.5 ${
                msg.role === 'ai' ? 'text-teal-600' : 'text-zinc-600'
              }`}>
                {msg.role === 'ai' ? 'AI' : 'YOU'}
              </div>
              {msg.text && (
                <div className={`text-[11px] leading-relaxed break-words ${
                  msg.role === 'ai' ? 'text-zinc-300' : 'text-zinc-400'
                }`}>
                  {msg.text}
                </div>
              )}
              {msg.actions && msg.actions.length > 0 && (
                <div className="mt-1.5 space-y-0.5">
                  {msg.actions.map((a, j) => (
                    <div key={j} className="text-[10px] font-mono text-teal-400/70">
                      &#9656; {a.voiceLabel}: {a.description}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))
      )}
      {isThinking && (
        <div className="flex gap-2" style={{ animation: 'fade-up 0.15s ease-out' }}>
          <div className="w-0.5 shrink-0 rounded-full bg-teal-500 animate-pulse" />
          <div className="min-w-0">
            <div className="text-[8px] font-mono uppercase tracking-[0.15em] mb-0.5 text-teal-600">AI</div>
            <div className="text-[11px] text-zinc-500 animate-pulse">Thinking...</div>
          </div>
        </div>
      )}
    </div>
  );
}
