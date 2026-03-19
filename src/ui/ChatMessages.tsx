/* eslint-disable react-refresh/only-export-components -- pure helper fns co-located with component */
import { useRef, useEffect, useState } from 'react';
import type { ChatMessage, Track, Reaction, UndoEntry, ActionLogEntry } from '../engine/types';
import { ActionDiffView } from './ActionDiffView';
import { ToolCallsView } from './ToolCallsView';
import { ListenEventView } from './ListenEventView';
import { PromptStarters } from './PromptStarters';
import { TurnSummaryCard } from './TurnSummaryCard';
import { renderInlineMarkdown } from './inlineMarkdown';

/**
 * Derive a collaboration phase label from authoritative streaming state.
 * Pure function — easy to test without rendering.
 */
export function getPhaseLabel(
  isThinking: boolean,
  isListening: boolean,
  logEntryCount: number,
): string | null {
  if (isListening) return 'Listening \u2014 evaluating audio';
  if (logEntryCount > 0) return `Applying ${logEntryCount} ${logEntryCount === 1 ? 'change' : 'changes'}`;
  if (isThinking) return 'Thinking\u2026';
  return null;
}

/**
 * Derive scope tracks from streaming log entries + current tracks.
 * Pure function — exported for testing.
 */
export function deriveScopeTracks(
  logEntries: ActionLogEntry[],
  tracks: Track[],
): Array<{ trackId: string; name: string }> {
  const seen = new Map<string, { trackId: string; name: string }>();
  for (const entry of logEntries) {
    if (!seen.has(entry.trackId)) {
      const track = tracks.find(t => t.id === entry.trackId);
      seen.set(entry.trackId, {
        trackId: entry.trackId,
        name: track?.name || entry.trackLabel || entry.trackId,
      });
    }
  }
  return [...seen.values()];
}

/** Compact badge showing which tracks the AI is targeting. */
function ScopeBadge({ scopeTracks }: { scopeTracks: Array<{ trackId: string; name: string }> }) {
  if (scopeTracks.length === 0) return null;
  return (
    <div
      className="flex flex-wrap items-baseline gap-x-1 text-[11px] font-mono mb-1"
      style={{ animation: 'fade-up 0.15s ease-out' }}
    >
      <span className="text-zinc-600">Scope:</span>
      {scopeTracks.map((st, i) => (
        <span key={st.trackId} className="inline-flex items-baseline gap-0.5">
          <span className="text-teal-500">
            {st.name}
          </span>
          {i < scopeTracks.length - 1 && <span className="text-zinc-700">{' \u00b7 '}</span>}
        </span>
      ))}
    </div>
  );
}

interface Props {
  messages: ChatMessage[];
  isThinking?: boolean;
  isListening?: boolean;
  /** Partial text being streamed from the AI before the full response completes. */
  streamingText?: string;
  /** Authoritative log entries from executed actions, streamed per-step. */
  streamingLogEntries?: ActionLogEntry[];
  /** Rejected actions, streamed per-step. */
  streamingRejections?: { reason: string }[];
  /** Recorded reactions, keyed by message index. */
  reactions?: Reaction[];
  /** Callback when user clicks approve/reject on an AI message. */
  onReaction?: (messageIndex: number, verdict: 'approved' | 'rejected', rationale?: string) => void;
  /** Current undo stack, used to determine which AI messages can be undone. */
  undoStack?: UndoEntry[];
  /** Callback when user clicks the undo button on an AI message. */
  onUndoMessage?: (messageIndex: number) => void;
  /** Current session tracks, used for context-aware prompt starters. */
  tracks?: Track[];
  /** All session messages (including previous), used for resume detection. */
  sessionMessages?: ChatMessage[];
  /** Callback when user clicks a prompt starter chip. */
  onStarterSelect?: (prompt: string) => void;
}

export function ChatMessages({ messages, isThinking = false, isListening = false, streamingText = '', streamingLogEntries = [], streamingRejections = [], reactions = [], onReaction, undoStack = [], onUndoMessage, tracks = [], sessionMessages, onStarterSelect }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, isThinking, isListening, streamingText, streamingLogEntries.length, streamingRejections.length]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto chat-scroll p-3 space-y-2">
      {messages.length === 0 && !isThinking && !isListening && onStarterSelect && (
        <PromptStarters
          tracks={tracks}
          messages={sessionMessages ?? messages}
          onSelect={onStarterSelect}
        />
      )}

      {messages.map((msg, i) => {
        const hasActions = msg.role === 'ai' && msg.actions && msg.actions.length > 0;
        const reaction = hasActions ? reactions.find(r => r.actionGroupIndex === i) : undefined;
        // A message can be undone if its entire undo range is contiguous
        // at the top of the stack. After partial Cmd+Z of individual steps,
        // the button disables — per-step Cmd+Z is the appropriate interface.
        const canUndo = hasActions
          && msg.undoStackRange != null
          && undoStack.length > 0
          && msg.undoStackRange.end === undoStack.length - 1;

        return (
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
              <div className={`text-[10px] font-mono uppercase tracking-[0.2em] mb-1 ${
                msg.role === 'ai' ? 'text-teal-600/80' : 'text-zinc-600'
              }`}>
                {msg.role === 'ai' ? 'GLUON' : msg.role === 'system' ? 'SYS' : 'YOU'}
              </div>
              {msg.scopeTracks && msg.scopeTracks.length > 0 && (
                <ScopeBadge scopeTracks={msg.scopeTracks} />
              )}
              {/* Non-AI text renders inline (before actions); AI text renders after tool calls so the summary/yield is visible last */}
              {msg.text && msg.role !== 'ai' && (
                <div className={`text-sm leading-[1.6] break-words ${
                  msg.role === 'system' ? 'text-zinc-500' : 'text-zinc-400'
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
                <ToolCallsView toolCalls={msg.toolCalls} hasListenEvents={!!msg.listenEvents?.length} />
              )}
              {msg.listenEvents && msg.listenEvents.length > 0 && (
                <ListenEventView events={msg.listenEvents} />
              )}
              {msg.text && msg.role === 'ai' && (
                <div className="text-sm leading-[1.6] break-words text-zinc-300 mt-2">
                  {renderInlineMarkdown(msg.text)}
                </div>
              )}
              {hasActions && onStarterSelect && (
                <TurnSummaryCard
                  actions={msg.actions!}
                  aiText={msg.text}
                  onChipSelect={onStarterSelect}
                  suggestedReactions={msg.suggestedReactions}
                />
              )}
              {(hasActions && (onReaction || canUndo)) || (msg.suggestedReactions && msg.suggestedReactions.length > 0) ? (
                <ReactionControls
                  messageIndex={i}
                  currentVerdict={reaction?.verdict}
                  onReaction={hasActions ? onReaction : undefined}
                  onUndoMessage={hasActions ? onUndoMessage : undefined}
                  canUndo={hasActions && canUndo}
                  suggestedReactions={msg.suggestedReactions}
                  onStarterSelect={onStarterSelect}
                />
              ) : null}
            </div>
          </div>
        );
      })}

      {(isThinking || isListening) && (
        <div className="flex gap-2 rounded px-2.5 py-2 bg-zinc-800/20" style={{ animation: 'fade-up 0.15s ease-out' }}>
          <div
            className="w-px shrink-0 rounded-full bg-teal-500/70 mt-0.5"
            style={{ ...(!streamingText && streamingLogEntries.length === 0 ? { animation: 'pulse-soft 1.5s ease-in-out infinite' } : {}), minHeight: '1rem' }}
          />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] mb-1 text-teal-600/80">GLUON</div>
            {streamingLogEntries.length > 0 && (
              <ScopeBadge scopeTracks={deriveScopeTracks(streamingLogEntries, tracks)} />
            )}
            {/* When no actions yet, show text inline (initial thinking text) */}
            {streamingText && streamingLogEntries.length === 0 && (
              <div className="text-sm leading-[1.6] break-words text-zinc-300">
                {renderInlineMarkdown(streamingText)}
                <span
                  className="inline-block w-1.5 h-3 ml-0.5 bg-teal-500/60 rounded-sm align-text-bottom"
                  style={{ animation: 'pulse-soft 0.8s ease-in-out infinite' }}
                />
              </div>
            )}
            {(streamingLogEntries.length > 0 || streamingRejections.length > 0) && (
              <div className="mt-1 space-y-px">
                {streamingLogEntries.map((entry, i) => (
                  <div key={i} style={{ animation: 'fade-up 0.1s ease-out' }}>
                    <ActionDiffView entry={entry} />
                  </div>
                ))}
                {streamingRejections.map((r, i) => (
                  <div key={`rej-${i}`} className="flex items-baseline gap-1.5 text-[11px] font-mono" style={{ animation: 'fade-up 0.1s ease-out' }}>
                    <span className="text-red-500/70">!</span>
                    <span className="text-red-400/60">{r.reason}</span>
                  </div>
                ))}
                <div className="flex items-center gap-1.5 mt-1">
                  <ThinkingDots />
                  <span className="text-[11px] font-mono text-zinc-600">
                    {getPhaseLabel(isThinking, isListening, streamingLogEntries.length) ?? 'working'}
                  </span>
                </div>
              </div>
            )}
            {/* When actions are present, show text after them so the summary/yield is last */}
            {streamingText && streamingLogEntries.length > 0 && (
              <div className="text-sm leading-[1.6] break-words text-zinc-300 mt-2">
                {renderInlineMarkdown(streamingText)}
                <span
                  className="inline-block w-1.5 h-3 ml-0.5 bg-teal-500/60 rounded-sm align-text-bottom"
                  style={{ animation: 'pulse-soft 0.8s ease-in-out infinite' }}
                />
              </div>
            )}
            {!streamingText && streamingLogEntries.length === 0 && streamingRejections.length === 0 && (
              <div className="flex items-center gap-1.5">
                <ThinkingDots />
                <span className="text-sm font-mono text-zinc-600">
                  {getPhaseLabel(isThinking, isListening, 0) ?? 'thinking'}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Combined reaction controls: undo, approve/reject, and AI-suggested musical chips.
 * Chips collapse to a minimal row and expand on hover.
 * Clicking a chip records an 'approved' verdict with the chip text as rationale,
 * and also sends the chip as a follow-up message.
 */
function ReactionControls({
  messageIndex,
  currentVerdict,
  onReaction,
  onUndoMessage,
  canUndo,
  suggestedReactions,
  onStarterSelect,
}: {
  messageIndex: number;
  currentVerdict?: 'approved' | 'rejected' | 'neutral';
  onReaction?: (messageIndex: number, verdict: 'approved' | 'rejected', rationale?: string) => void;
  onUndoMessage?: (messageIndex: number) => void;
  canUndo: boolean;
  suggestedReactions?: string[];
  onStarterSelect?: (prompt: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasChips = suggestedReactions && suggestedReactions.length > 0;

  const handleChipClick = (chip: string) => {
    // Record approved verdict with chip text as rationale
    onReaction?.(messageIndex, 'approved', chip);
    // Also send as follow-up message
    onStarterSelect?.(chip);
  };

  return (
    <div
      className="mt-1.5"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <div className="flex items-center gap-1">
        {onUndoMessage && canUndo && (
          <button
            onClick={() => onUndoMessage(messageIndex)}
            className="flex items-center justify-center w-5 h-5 rounded transition-colors text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/50"
            title="Undo this change"
          >
            <svg viewBox="0 0 16 16" className="w-3 h-3" fill="currentColor">
              <path d="M2.5 1a.5.5 0 0 1 .5.5V4h2.5a5.5 5.5 0 1 1 0 11H4a.5.5 0 0 1 0-1h1.5a4.5 4.5 0 1 0 0-9H3v2.5a.5.5 0 0 1-.854.354l-2-2a.5.5 0 0 1 0-.708l2-2A.5.5 0 0 1 2.5 1z" />
            </svg>
          </button>
        )}
        {onReaction && (
          <ReactionButtons
            messageIndex={messageIndex}
            currentVerdict={currentVerdict}
            onReaction={onReaction}
          />
        )}
        {hasChips && !expanded && (
          <span className="text-[10px] font-mono text-zinc-700 ml-1 select-none">
            {suggestedReactions.length} suggestions
          </span>
        )}
      </div>
      {hasChips && expanded && (
        <div
          className="flex flex-wrap gap-1.5 mt-1.5"
          style={{ animation: 'fade-up 0.15s ease-out' }}
        >
          {suggestedReactions.map((chip) => (
            <button
              key={chip}
              onClick={() => handleChipClick(chip)}
              className="px-2.5 py-1 rounded-full text-[11px] text-zinc-500 border border-teal-800/40 hover:border-teal-600/60 hover:text-teal-300 hover:bg-teal-900/20 transition-colors cursor-pointer"
            >
              {chip}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReactionButtons({
  messageIndex,
  currentVerdict,
  onReaction,
}: {
  messageIndex: number;
  currentVerdict?: 'approved' | 'rejected' | 'neutral';
  onReaction: (messageIndex: number, verdict: 'approved' | 'rejected', rationale?: string) => void;
}) {
  const isApproved = currentVerdict === 'approved';
  const isRejected = currentVerdict === 'rejected';

  return (
    <>
      <button
        onClick={() => onReaction(messageIndex, 'approved')}
        className={`flex items-center justify-center w-5 h-5 rounded transition-colors ${
          isApproved
            ? 'bg-emerald-900/50 text-emerald-400'
            : 'text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/50'
        }`}
        title="Approve"
      >
        <svg viewBox="0 0 16 16" className="w-3 h-3" fill="currentColor">
          <path d="M8.834.066c.763.087 1.5.295 2.01.884.505.581.656 1.378.656 2.3 0 .467-.087 1.119-.157 1.637L11.328 5h1.422c.603 0 1.174.085 1.668.485.486.392.804.97.804 1.765a1.38 1.38 0 0 1-.089.46l-1.532 4.14c-.293.815-.852 1.39-1.601 1.65-.718.248-1.498.2-2.187.2H6.5A1.5 1.5 0 0 1 5 12.2V7.5c0-.47.176-.919.495-1.265l3.384-3.677c.291-.316.478-.736.495-1.191L9.39.695a.932.932 0 0 0-.556-.629ZM4 7.5a.5.5 0 0 0-.5-.5h-2a.5.5 0 0 0-.5.5v5a.5.5 0 0 0 .5.5h2a.5.5 0 0 0 .5-.5v-5Z" />
        </svg>
      </button>
      <button
        onClick={() => onReaction(messageIndex, 'rejected')}
        className={`flex items-center justify-center w-5 h-5 rounded transition-colors ${
          isRejected
            ? 'bg-red-900/50 text-red-400'
            : 'text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/50'
        }`}
        title="Reject"
      >
        <svg viewBox="0 0 16 16" className="w-3 h-3 rotate-180" fill="currentColor">
          <path d="M8.834.066c.763.087 1.5.295 2.01.884.505.581.656 1.378.656 2.3 0 .467-.087 1.119-.157 1.637L11.328 5h1.422c.603 0 1.174.085 1.668.485.486.392.804.97.804 1.765a1.38 1.38 0 0 1-.089.46l-1.532 4.14c-.293.815-.852 1.39-1.601 1.65-.718.248-1.498.2-2.187.2H6.5A1.5 1.5 0 0 1 5 12.2V7.5c0-.47.176-.919.495-1.265l3.384-3.677c.291-.316.478-.736.495-1.191L9.39.695a.932.932 0 0 0-.556-.629ZM4 7.5a.5.5 0 0 0-.5-.5h-2a.5.5 0 0 0-.5.5v5a.5.5 0 0 0 .5.5h2a.5.5 0 0 0 .5-.5v-5Z" />
        </svg>
      </button>
    </>
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
