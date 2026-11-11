# Coding standards

Read during review. `tsc` (strict, `erasableSyntaxOnly`) and the tests are the first line; these are the judgement calls they cannot make.

- **Document every export** with TSDoc: what it returns or guarantees, and what happens at the edge (stale run, missing row).
- **Errors are values.** A known failure is a class with a `_tag`, returned in a `Result`, never thrown. Throw only for a defect, and say so in a `// Defect:` comment above the throw that names what must have gone wrong. A throw a caller catches and turns into a value (inside an adapter) says that instead. A store may return `undefined` for a miss (unknown friend, unknown link token); the first function above the store turns it into a tagged error, and nothing past that carries `undefined` for a known failure.
- **Brands are minted only by their parser.** Every cast carries a `// SAFETY:` line naming why the check before it makes it true; `npm run check` fails without one.
- **One list per fact.** A set of cases (failure tags, run steps) is one `as const` array; types, database checks and UI lists derive from it.
- **One home per fact.** A pattern, literal, title or message is defined once and imported; a second copy drifts. The same parse-or-throw block in several stores is the same smell: one helper.
- **One policy per decision.** A condition branched on at more than one site (visitor or seeded owner, say) becomes one policy built once and passed down.
- **Claim, then release on every unfinished path.** Whatever is claimed before a step that can fail (a daily-cap place, a run row) is released on each failure path, and a test covers each.
- **Answer what already exists before judging new input.** A start request reports an existing Ode or a run in progress (409 or the status) before it validates anything new.
- **The server owns the rule, the page shows it.** Whether a line passes is decided by `makeLine`; the page reads `problems`, it never re-checks text. Turning what the payer typed into cents is the page's job; limits and what is allowed are the server's. When two readers see the same fact (the payer and each friend see the same lines), both call one function and differ only in what they omit.
- **Test through the HTTP API** with the fakes in `src/testing/fakes.ts` and the harness in `test/harness.ts`. Assert what the payer or the cost can observe (status, saved rows, songs composed), not calls between modules. Pure modules (`unlock.ts`) and production adapters behind a port (`paypal.ts`, `eleven-music.ts`) are tested directly, the adapters with a fake `fetch`, because the API tests never reach them.
- **A change to the page is checked in the fake-app driver.** The page has no test seam below the browser, so `scripts/drive-fake.mjs` gets a phase that fails before the change and passes after it. The driver asserts what the payer or friend sees, with each timing bounded (`assert.ok(ms < limit)`); a printed number is evidence, not a check.
