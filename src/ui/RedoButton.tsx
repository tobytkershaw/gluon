interface Props {
  onClick: () => void;
  disabled: boolean;
  description?: string;
}

export function RedoButton({ onClick, disabled, description }: Props) {
  const title = description ? `Redo: ${description} (⌘⇧Z)` : 'Redo (⌘⇧Z)';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="p-2 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
      title={title}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d="M13 8H5a3 3 0 0 0 0 6h3"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M10 5l3 3-3 3"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
