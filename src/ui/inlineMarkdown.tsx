import React from 'react';

/**
 * Lightweight inline markdown renderer.
 * Supports: **bold**, *italic*, `code`, and [links](url).
 * No block-level elements (headers, lists, etc.) — chat messages are inline.
 */

type Segment = string | React.ReactElement;

/** Parse inline markdown tokens and return React elements. */
export function renderInlineMarkdown(text: string): React.ReactNode {
  // Split on markdown tokens, preserving delimiters via capture groups.
  // Order matters: bold (**) must come before italic (*).
  const pattern = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+?)`|\[([^\]]+?)\]\(([^)]+?)\))/g;

  const segments: Segment[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    // Push preceding plain text
    if (match.index > lastIndex) {
      segments.push(text.slice(lastIndex, match.index));
    }

    if (match[2] != null) {
      // **bold**
      segments.push(
        <strong key={key++} className="font-semibold text-zinc-200">
          {match[2]}
        </strong>,
      );
    } else if (match[3] != null) {
      // *italic*
      segments.push(
        <em key={key++} className="italic">
          {match[3]}
        </em>,
      );
    } else if (match[4] != null) {
      // `code`
      segments.push(
        <code
          key={key++}
          className="px-1 py-px rounded bg-zinc-800 text-teal-400 text-[11px] font-mono"
        >
          {match[4]}
        </code>,
      );
    } else if (match[5] != null && match[6] != null) {
      // [text](url)
      segments.push(
        <a
          key={key++}
          href={match[6]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-teal-500 underline underline-offset-2 hover:text-teal-400"
        >
          {match[5]}
        </a>,
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Trailing plain text
  if (lastIndex < text.length) {
    segments.push(text.slice(lastIndex));
  }

  return segments.length === 0 ? text : <>{segments}</>;
}
