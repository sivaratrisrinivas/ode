// Launches the headless Chromium the page drivers (drive-fake.mjs, drive-live.mjs) use. See docs/agents/run.md, "Driving the page".
import { existsSync } from "node:fs";

const home = process.env.HOME ?? "";
// PLAYWRIGHT_CORE overrides where playwright-core is imported from (it is not in node_modules).
const core = process.env.PLAYWRIGHT_CORE ?? `${home}/.cache/ode-browser/pw/node_modules/playwright-core/index.mjs`;
// Chromium's shared libraries, when they were unpacked into a directory instead of installed (LD_LIBRARY_PATH must name them).
const libs = process.env.CHROMIUM_LIBS ?? `${home}/.cache/ode-browser/libs/usr/lib/x86_64-linux-gnu`;

/**
 * Start Chromium headless; ends the process with the fix when playwright-core or Chromium cannot be found.
 *
 * @param args - Extra Chromium flags (the fake-app driver passes the autoplay one).
 * @returns The playwright-core `browser`.
 */
export async function launchBrowser(args = []) {
  if (!existsSync(core)) {
    console.error(`playwright-core is not at ${core}.\nSet PLAYWRIGHT_CORE to its index.mjs (docs/agents/run.md, "Driving the page" says how to install it).`);
    process.exit(1);
  }
  const { chromium } = await import(core);
  try {
    return await chromium.launch({
      executablePath: `${home}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`,
      args,
      env: { ...process.env, ...(existsSync(libs) ? { LD_LIBRARY_PATH: [libs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") } : {}) },
    });
  } catch (error) {
    console.error(`Chromium did not start: ${String(error.message).split("\n")[0]}\nIf a shared library is missing, unpack libnspr4, libnss3 and libasound2t64 and set CHROMIUM_LIBS (docs/agents/run.md, "Driving the page").`);
    process.exit(1);
  }
}
