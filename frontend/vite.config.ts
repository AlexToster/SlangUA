import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/components/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
