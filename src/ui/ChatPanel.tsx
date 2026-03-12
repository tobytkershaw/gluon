import type { ChatMessage } from '../engine/types';
import { ChatMessages } from './ChatMessages';
import { ChatComposer } from './ChatComposer';

interface Props {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  isThinking?: boolean;
  isListening?: boolean;
}

export function ChatPanel({ messages, onSend, isThinking = false, isListening = false }: Props) {
  return (
    <div className="flex flex-col flex-1 min-h-0 bg-zinc-900/50 border border-zinc-800/50 rounded-lg overflow-hidden">
      <ChatMessages messages={messages} isThinking={isThinking} isListening={isListening} />
      <ChatComposer onSend={onSend} disabled={isThinking || isListening} />
    </div>
  );
}
