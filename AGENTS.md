**Read [`DEVELOPMENT.md`](DEVELOPMENT.md) first** — build layout, test layers, harnesses, coverage, and all build/test/lint commands live there.

## Task tracking

The task file in `tasks/` is the single source of truth for status: when finishing implementation, tick what was implemented and flag what isn't ready. `tasks/README.md` is an informative index, not a status tracker — touch it only to mark a task fully done, never for partial/in-progress status.

## Testing

Every new piece of functionality ships with **unit tests and e2e tests**, with coverage verified (run the coverage report, confirm the new code is exercised). A task is not done until its tests pass and cover the new behaviour.

**Any webview / renderer feature (anything that renders or behaves in the editor surface — diagrams, themes, caret, links, etc.) MUST ship a real-VS-Code e2e in `test/vscode-e2e/`, and you MUST WRITE AND RUN it yourself before calling the work done** — never defer real-webview verification to the user. `xvfb` IS installed, so everything runs headless (`xvfb-run -a`, no GUI windows) — there is no "no display" excuse; if in doubt run `which xvfb-run` rather than trusting stale memory. The chromium harness (`media-src/e2e`) is a faster first net but CANNOT reproduce real-webview-only behaviour (VS Code's injected CSS, the custom-editor resource/CSP pipeline, SVG-anchor link routing, etc.) — it does not replace the real-VS-Code layer for those.

**Do NOT run the whole real-VS-Code suite routinely — it is ~1–2 h, not ~40 min.** Boot cost is per `test()`, not per spec file (task 448 — `vscode-test-playwright`'s `electronApp` fixture has no `scope: 'worker'`), so a spec with N tests pays N boots, and splitting/merging tests moves the wall clock directly. While working, run your own spec(s) plus the fast tier; keep the full suite for handing work over. Tier lists live in `test/vscode-e2e/playwright.config.ts`. Cost ratio: cheapest real-VS-Code test measured at ~5 s (boot + open + one assert); the chromium harness runs comparable tests at ~1 s — an order of magnitude, more for heavier assertions.

```bash
npm test                                        # unit tests (vitest)
node build.mjs                                  # build (from project root!) — REQUIRED before any real-VS-Code spec: the suite loads out/ + media/ via extensionDevelopmentPath, not the installed .vsix
xvfb-run -a npm --prefix media-src run test:e2e # Playwright e2e (chromium harness)
xvfb-run -a npm --prefix test/vscode-e2e test -- foo.spec.ts  # ONE real-VS-Code spec (~15-60 s; downloads VS Code once, then cached)
xvfb-run -a npm run test:vscode:fast            # real VS Code, routine tier (~39 tests, 8.5-16 min depending on load)
xvfb-run -a npm run test:vscode:smoke           # real VS Code, PR gate (10 tests, ~2 min)
xvfb-run -a npm run test:vscode                 # real VS Code, EVERYTHING except @probe (~1-2 h; count moves with every merge — for today's: npx playwright test --list in test/vscode-e2e)
npm run lint:ci                                 # Biome lint gate (whole tree)
```

Details, troubleshooting, coverage commands: [`DEVELOPMENT.md` → Running tests headless](DEVELOPMENT.md#running-tests-headless-xvfb). Full testing playbook (which layer, real-VS-Code spec patterns, booting the WASM in a vitest vm-context, gotchas): the **`vmarkd-testing`** skill — which also covers **debugging** a flaky/order-dependent spec, and MUST be read before diagnosing one. A spec that passes alone and fails in the full run is almost never a race here: replay its real predecessor chain and bisect before touching a timeout.

## Quality-metrics toolchain

Run `npm run quality` **at the end of every task's implementation** (alongside the standing end-of-task simplify pass — task 469), not once per batch and not only in CI. It runs `scripts/quality.mjs`: Biome lint (`lint:ci`, incl. cognitive complexity `complexity/noExcessiveCognitiveComplexity`, gated at `error`/max 15) → `knip` (cross-file unused exports/files/deps) → `jscpd` (duplication) → `dependency-cruiser` (circular/unresolvable imports) → `test:coverage` (unit coverage) → `check:coverage-modules` (the 0%-module ratchet, `scripts/check-coverage-modules.mjs` — a separate stage reading the coverage summary the previous one wrote). **It is NOT a `&&` chain** — every stage runs regardless of earlier failures, then a PASS/FAIL summary, exiting non-zero iff any stage failed. (A `&&` chain was tried and rejected: with `lint:ci` red for reasons unrelated to a task — deferred complexity sites, task 469 5a — it would report nothing past the first red stage, exactly the blind spot this command exists to avoid.) Type-strictness (`type-coverage`, task 469 item 5e) is not wired in yet — `media-src/tsconfig.json` has `strict: false` and flipping it needs its own plan; see the task file.

Individual steps: `npm run knip` / `npm run jscpd` / `npm run depcruise`. What's excluded and why: `knip.jsonc` / `.jscpd.json` / `.dependency-cruiser.cjs` (mostly vendored code, the two esbuild-entry-point classes, and cross-tree test file reads that aren't real imports). None of the three are wired into CI yet — see ADR-0005's "Philosophy" for why they're an accepted exception to "keep the toolchain plain", and task 469 for current baselines and the wiring plan.

## Visual / layout bugs

For **layout / CSS / caret** bugs — the perceptual "a few px / jumps / squished / repro only in the real editor" class — use the **`vmarkd-visual-debugging`** skill: `playwright-cli` for an interactive measure-and-screenshot loop on the harnesses (`npm run harness:serve` + `npm run pw:cli`), `@visual` golden screenshots (`npm run test:visual`, local-only, excluded from CI), and the real-VS-Code suite (`npm run test:vscode`) for bugs that only reproduce with VS Code's injected CSS / the custom-editor pipeline.

## Omitted fixes or implementation

Never omit or postpone an implementation task you find on your own — ask the user a question to decide.

## Delegating to real Codex (not just an agent named "codex")

`Agent({subagent_type: "codex:codex-rescue", prompt: <big engineering brief>})` does **NOT** guarantee Codex does the work: that agent type is a Claude-model agent with Bash-only tools, and handed a full implementation brief it will silently do everything itself without ever starting the Codex CLI. (This happened on task 492 phase 4 — ~1000 lines across 18 files under a "codex" label, no Codex session, caught only by checking afterwards.) To make Codex actually run:

1. Read the `codex:rescue` skill (`Skill({skill: "codex:rescue"})`) — it is the source of truth if this summary ever drifts. The agent must be a **thin forwarder**: one Bash call to `node "<codex-companion.mjs path>" task "<raw request>"`, stdout returned verbatim. Pass the request as plain text the way a user would type it, not a pre-decomposed multi-file spec — Codex does its own planning.
2. Before starting, check `node "<codex-companion.mjs path>" task-resume-candidate --json`; if `available: true`, ask the user whether to continue that thread (`--resume`) or start fresh (`--fresh`) — exact wording in the skill. If `false`, route normally without asking.
3. Verify Codex actually ran — never take the agent's self-report at face value: a new `rollout-*.jsonl` must appear under `~/.codex/sessions/YYYY/MM/DD/` with a timestamp matching the invocation. No new file = Codex never ran, whatever the agent claimed.

`node ".../plugins/cache/openai-codex/codex/<version>/scripts/codex-companion.mjs" setup --json` checks CLI availability/auth; the version path segment drifts — the `codex:setup` skill always has the current path.
