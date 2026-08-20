import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Pinned so a run launched from a parent directory cannot collect a
  // sibling project's suite.
  root: import.meta.dirname,
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    restoreMocks: true,
  },
});
