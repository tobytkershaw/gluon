import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { configDefaults } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    watch: {
      ignored: ['**/.claude/worktrees/**', '**/.codex-worktrees/**', '**/.worktrees/**'],
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    css: true,
    setupFiles: [],
    exclude: [
      ...configDefaults.exclude,
      '.worktrees/**',
      '.codex-worktrees/**',
      '.claude/worktrees/**',
    ],
  },
});
