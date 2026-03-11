import type { ChatMessage } from '../engine/types';
import { ChatMessages } from './ChatMessages';
import { ChatComposer } from './ChatComposer';

interface Props {
  messages: ChatMessage[];
  onSend: (message: string) => void;
}

export function ChatPanel({ messages, onSend }: Props) {
  return (
    <div className="flex flex-col flex-1 min-h-0 bg-zinc-900/50 border border-zinc-800/50 rounded-lg overflow-hidden">
      <ChatMessages messages={messages} />
      <ChatComposer onSend={onSend} />
    </div>
  );
}
