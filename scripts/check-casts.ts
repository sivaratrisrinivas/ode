import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Fails when a type assertion (`value as Type`) has no `// SAFETY:` comment on its line or the two lines above it.
 * `as const`, `import { a as b }` and the word "as" inside comments and strings are not assertions.
 * The rule and its reason live in CODING_STANDARDS.md.
 */

/** Every .ts and .tsx file under `dir`. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** The source with comments and the insides of strings and templates blanked, line for line, so only code is left to match. */
function codeLines(source: string): string[] {
  let out = "";
  let state: "code" | "line" | "block" | `"` | "'" | "`" = "code";
  for (let i = 0; i < source.length; i++) {
    const char = source.charAt(i);
    const next = source.charAt(i + 1);
    if (char === "\n") {
      out += "\n";
      if (state === "line") state = "code";
      continue;
    }
    switch (state) {
      case "code":
        if (char === "/" && next === "/") state = "line";
        else if (char === "/" && next === "*") state = "block";
        else if (char === '"' || char === "'" || char === "`") state = char;
        else out += char;
        break;
      case "block":
        if (char === "*" && next === "/") {
          state = "code";
          i++;
        }
        break;
      case "line":
        break;
      default:
        if (char === "\\") i++;
        else if (char === state) state = "code";
    }
  }
  return out.split("\n");
}

const assertion = /\bas\s+(?!const\b)[A-Za-z_{[(]/;
const problems: string[] = [];

for (const file of sourceFiles("src")) {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  codeLines(source).forEach((code, index) => {
    if (/^\s*(import|export)\b.*\bfrom\b/.test(code) || !assertion.test(code)) return;
    const nearby = lines.slice(Math.max(0, index - 2), index + 1).join("\n");
    if (!nearby.includes("SAFETY:")) problems.push(`${file}:${index + 1}: type assertion without a // SAFETY: comment: ${lines[index]?.trim()}`);
  });
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
