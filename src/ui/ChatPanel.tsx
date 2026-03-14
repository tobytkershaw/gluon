import type { ChatMessage } from '../engine/types';
import { ChatMessages } from './ChatMessages';

interface Props {
  messages: ChatMessage[];
  isThinking?: boolean;
  isListening?: boolean;
}

export function ChatPanel({ messages, isThinking = false, isListening = false }: Props) {
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <ChatMessages messages={messages} isThinking={isThinking} isListening={isListening} />
    </div>
  );
}
