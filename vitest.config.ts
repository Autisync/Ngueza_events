import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // `server-only` throws by design when resolved without the
      // react-server condition, which is exactly what makes it a useful
      // guard in the real build. Vitest is not that build, so point it at
      // the package's own no-op entry.
      'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)),
    },
  },
  test: {
    // Integration tests share one database; running files in parallel
    // would have them delete each other's fixtures.
    fileParallelism: false,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'auth',
          environment: 'node',
          include: ['tests/auth/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'media',
          environment: 'node',
          include: ['tests/media/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
        },
      },
    ],
  },
})
