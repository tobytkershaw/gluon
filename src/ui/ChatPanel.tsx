import { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '../engine/types';

interface Props {
  messages: ChatMessage[];
  onSend: (message: string) => void;
}

export function ChatPanel({ messages, onSend }: Props) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput('');
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-zinc-900/50 border border-zinc-800/50 rounded-lg overflow-hidden">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto chat-scroll p-3 space-y-3">
        {messages.length === 0 ? (
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
                <div className={`text-[11px] leading-relaxed break-words ${
                  msg.role === 'ai' ? 'text-zinc-300' : 'text-zinc-400'
                }`}>
                  {msg.text}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-zinc-800/40 p-2 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Make it darker..."
          className="flex-1 bg-transparent text-[11px] text-zinc-200 placeholder:text-zinc-700 outline-none font-mono px-2 py-1.5"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="text-[9px] font-mono uppercase tracking-wider px-3 py-1.5 text-amber-400 disabled:text-zinc-700 hover:bg-amber-400/10 rounded transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  );
}
