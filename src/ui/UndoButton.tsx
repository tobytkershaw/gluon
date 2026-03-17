interface Props {
  onClick: () => void;
  disabled: boolean;
  description?: string;
}

export function UndoButton({ onClick, disabled, description }: Props) {
  const title = description ? `Undo: ${description} (⌘Z)` : 'Undo (⌘Z)';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="p-2 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
      title={title}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d="M3 8h8a3 3 0 0 1 0 6H8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M6 5L3 8l3 3"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
