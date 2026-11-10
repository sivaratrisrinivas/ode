import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The first test of each API file waits for its in-process Postgres to boot (PGlite: ~5 s alone, 20 to 40 s
    // with several booting at once on a loaded WSL machine), so the limit leaves room for the slow case.
    testTimeout: 90_000,
    hookTimeout: 90_000,
    maxWorkers: 3,
    // Every run leaves its failures (names and messages) in a file, so a truncated terminal never hides them.
    reporters: ["default", ["json", { outputFile: ".vitest/last.json" }]],
  },
});
