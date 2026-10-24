import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test files that use TEST_DATABASE_URL each wipe the same database, so files run one at a time.
    fileParallelism: false,
  },
});
