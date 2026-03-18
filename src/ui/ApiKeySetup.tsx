// src/ui/ApiKeySetup.tsx
// Welcoming onboarding screen shown in the chat area when no AI provider is configured.
// Replaces the empty-state music note with a friendly setup experience.
import { useState, useCallback } from 'react';
import type { ListenerMode } from '../ai/api';

interface Props {
  onSubmit: (openaiKey: string, geminiKey: string, listenerMode?: ListenerMode) => void;
}

type ProviderTab = 'gemini' | 'openai';

const PROVIDER_INFO: Record<ProviderTab, { name: string; label: string; placeholder: string; hint: string }> = {
  gemini: {
    name: 'Google Gemini',
    label: 'Google AI API Key',
    placeholder: 'AIza...',
    hint: 'Get a key at aistudio.google.com',
  },
  openai: {
    name: 'OpenAI',
    label: 'OpenAI API Key',
    placeholder: 'sk-...',
    hint: 'Get a key at platform.openai.com',
  },
};

export function ApiKeySetup({ onSubmit }: Props) {
  const [activeTab, setActiveTab] = useState<ProviderTab>('gemini');
  const [geminiKey, setGeminiKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const activeKey = activeTab === 'gemini' ? geminiKey : openaiKey;
  const setActiveKey = activeTab === 'gemini' ? setGeminiKey : setOpenaiKey;

  const canSubmit = geminiKey.trim() || openaiKey.trim();

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);

    // Determine listener mode based on which keys are provided
    let listenerMode: ListenerMode = 'gemini';
    if (openaiKey.trim() && !geminiKey.trim()) {
      listenerMode = 'openai';
    } else if (openaiKey.trim() && geminiKey.trim()) {
      listenerMode = 'gemini'; // default to gemini when both present
    }

    onSubmit(openaiKey.trim(), geminiKey.trim(), listenerMode);
  }, [canSubmit, submitting, openaiKey, geminiKey, onSubmit]);

  const info = PROVIDER_INFO[activeTab];

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

        {/* Provider tabs */}
        <div className="w-full">
          <div className="flex gap-1 p-0.5 bg-zinc-900/80 rounded-lg mb-3">
            {(Object.keys(PROVIDER_INFO) as ProviderTab[]).map((tab) => {
              const isActive = activeTab === tab;
              const hasKey = tab === 'gemini' ? geminiKey.trim() : openaiKey.trim();
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[11px] font-medium transition-all ${
                    isActive
                      ? 'bg-zinc-800 text-zinc-200 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-400'
                  }`}
                >
                  {PROVIDER_INFO[tab].name}
                  {hasKey && (
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Key input form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-600 mb-1.5">
                {info.label}
              </label>
              <input
                type="password"
                value={activeKey}
                onChange={(e) => setActiveKey(e.target.value)}
                placeholder={info.placeholder}
                autoFocus
                className="w-full bg-zinc-900/80 text-xs font-mono text-zinc-300 placeholder:text-zinc-700 rounded-lg px-3 py-2.5 outline-none border border-zinc-800/80 focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20 transition-all"
              />
              <p className="mt-1.5 text-[10px] text-zinc-600">
                {info.hint}
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
        </div>

        {/* Supported providers note */}
        <p className="text-[10px] text-zinc-700 text-center leading-relaxed">
          Gemini, OpenAI, and Anthropic are supported.
          <br />
          Gemini is recommended for the best experience.
        </p>
      </div>
    </div>
  );
}
