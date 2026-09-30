import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    // Benchmarks assert timing budgets; keep them from competing with other files for CPU.
    fileParallelism: true,
    testTimeout: 20_000,
  },
});
