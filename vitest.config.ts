import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/agents/**', // Agent configs are not testable code
        'src/index.ts', // Entry point
      ],
      thresholds: {
        statements: 30,
        branches: 30,
        functions: 30,
        lines: 30,
      },
    },
    // Mock external dependencies by default
    mockReset: true,
    restoreMocks: true,
  },
});
