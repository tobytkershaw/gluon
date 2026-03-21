// src/ui/ApiKeySetup.tsx
// Welcoming onboarding screen shown in the chat area when no AI provider is configured.
// Replaces the empty-state music note with a friendly setup experience.
import { useState, useCallback } from 'react';

interface Props {
  onSubmit: (geminiKey: string) => void;
  onContinueWithoutAI?: () => void;
}

export function ApiKeySetup({ onSubmit, onContinueWithoutAI }: Props) {
  const [geminiKey, setGeminiKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const canSubmit = geminiKey.trim();

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    onSubmit(geminiKey.trim());
  }, [canSubmit, submitting, geminiKey, onSubmit]);

  return (
    <div className="flex flex-col items-center justify-center h-full px-4 py-8 select-none">
      <div className="w-full max-w-sm flex flex-col items-center gap-6">
        {/* Icon */}
        <div className="relative">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500/20 to-violet-600/10 border border-violet-500/20 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-violet-400">
              <path fill="currentColor" d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
            </svg>
          </div>
        </div>

        {/* Welcome text */}
        <div className="text-center space-y-1.5">
          <h2 className="text-sm font-medium text-zinc-200">
            Set up your AI to start making music
          </h2>
          <p className="text-[11px] text-zinc-500 leading-relaxed max-w-xs">
            Paste an API key below to connect Gluon to an AI provider. You can always change this later.
          </p>
        </div>

        <div className="w-full">
          {/* Key input form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-600 mb-1.5">
                Google AI API Key
              </label>
              <input
                type="password"
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                placeholder="AIza..."
                autoFocus
                className="w-full bg-zinc-900/80 text-xs font-mono text-zinc-300 placeholder:text-zinc-700 rounded-lg px-3 py-2.5 outline-none border border-zinc-800/80 focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20 transition-all"
              />
              <p className="mt-1.5 text-[10px] text-zinc-600">
                Get a key at aistudio.google.com
              </p>
            </div>

            <button
              type="submit"
              disabled={!canSubmit || submitting}
              className="w-full text-xs font-medium py-2.5 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-violet-600/90 hover:bg-violet-500/90 text-white shadow-sm shadow-violet-900/30"
            >
              {submitting ? 'Connecting...' : 'Start making music'}
            </button>
          </form>

          {onContinueWithoutAI && (
            <button
              type="button"
              onClick={onContinueWithoutAI}
              className="w-full text-[11px] text-zinc-600 hover:text-zinc-400 py-1.5 transition-colors"
              data-testid="continue-without-ai"
            >
              Continue without AI
            </button>
          )}
        </div>

        <p className="text-[10px] text-zinc-700 text-center leading-relaxed">
          Gemini is currently the supported AI provider in Gluon.
        </p>
      </div>
    </div>
  );
}
