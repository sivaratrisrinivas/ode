import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/**
 * Fails when a file outside `test/` imports from `test/`: tests may use the app, the app may not use tests. Shared
 * fixtures live in `src/testing/`. Reads `import ... from "<path>"` and `import("<path>")` with a relative path.
 */

const ROOT = resolve(".");
const TEST_DIR = join(ROOT, "test");

/** Every .ts, .tsx and .mjs file under `dir` that is not a test. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || path === TEST_DIR ? [] : sourceFiles(path);
    return /\.(tsx?|mjs)$/.test(entry.name) ? [path] : [];
  });
}

const IMPORT = /(?:from\s*|import\s*\(\s*)["'](\.[^"']*)["']/g;

const problems: string[] = [];
for (const dir of ["src", "scripts"]) {
  for (const file of sourceFiles(join(ROOT, dir))) {
    for (const [, specifier] of readFileSync(file, "utf8").matchAll(IMPORT)) {
      if (specifier === undefined) continue;
      const target = resolve(dirname(file), specifier);
      if (target === TEST_DIR || target.startsWith(TEST_DIR + sep)) problems.push(`${relative(ROOT, file)} imports ${specifier}`);
    }
  }
}

if (problems.length > 0) {
  console.error(`Code outside test/ imports from test/ (move the shared fixture to src/testing/):\n${problems.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}
