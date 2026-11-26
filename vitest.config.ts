import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    include: ['test/**/*.test.ts'],
    // Measured on 5.1.2 (7 files, 117 tests): two shared worker threads use about a
    // quarter less memory than the default of one forked process per file and are no
    // slower. The suites keep no state between files (each test builds its own
    // in-memory database). If a test ever needs a clean module graph, set
    // `isolate: true` again instead of working around it in the test.
    pool: 'threads',
    isolate: false,
    maxWorkers: 2,
  },
});
