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
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: [],
    exclude: [
      ...configDefaults.exclude,
      '.worktrees/**',
      '.codex-worktrees/**',
      '.claude/worktrees/**',
    ],
  },
});
