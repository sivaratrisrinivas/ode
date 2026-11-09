import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Each API test file boots its own in-process Postgres (PGlite, ~5 s alone). With four booting at once
    // the first test of every file passed the 30 s limit on an 8-core WSL machine; three at once was fine.
    maxWorkers: 3,
  },
});
