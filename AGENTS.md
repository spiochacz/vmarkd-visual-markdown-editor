**Read [`DEVELOPMENT.md`](DEVELOPMENT.md) first** — it documents the build layout, test layers, harnesses, coverage, and how to run everything. All build/test/lint commands live there.

## Task tracking

When finishing implementation, always update task status inside the relevant `tasks/` file: tick checklist items that were implemented and flag what isn't ready yet. The task file is the single source of truth for status.

`tasks/README.md` is an informative index, not a status tracker — do not record partial or in-progress status there. Only update `tasks/README.md` when a task is fully complete, to mark it done.

## Testing

Every new piece of functionality must ship with **unit tests and e2e tests**, and you must **verify the coverage** for it (run the coverage report and confirm the new code is exercised). A task is not done until its tests pass and cover the new behaviour.

**Any webview / renderer feature (anything that renders or behaves in the editor surface — diagrams, themes, caret, links, etc.) MUST ship a real-VS-Code e2e in `test/vscode-e2e/`, and you MUST WRITE IT AND RUN IT yourself before calling the work done — do not defer real-webview verification to the user.** `xvfb` IS installed here, so the real-VS-Code suite runs headless — there is no "it can't run headless / no display" excuse. If you ever doubt it, run `which xvfb-run` (don't assume from memory; memories about the environment go stale). Run a single spec with:

```bash
node build.mjs   # FIRST — the suite loads out/ + media/ via extensionDevelopmentPath, not the installed .vsix
xvfb-run -a npm --prefix test/vscode-e2e test -- <spec>.spec.ts   # one real-VS-Code spec (downloads VS Code once, then cached)
```

The Playwright/chromium harness (`media-src/e2e`) is a faster first net but CANNOT reproduce real-webview-only behaviour (VS Code's injected CSS, the custom-editor resource/CSP pipeline, SVG-anchor link routing, etc.) — it does not replace the real-VS-Code e2e for those.

**Always run tests headless with `xvfb-run -a`** — no GUI windows. Quick reference:

```bash
npm test                                        # unit tests (vitest)
node build.mjs                                  # build (run from project root!)
xvfb-run -a npm --prefix media-src run test:e2e # Playwright e2e (harness)
xvfb-run -a npm run test:vscode                 # real VS Code webview tests (whole suite)
xvfb-run -a npm --prefix test/vscode-e2e test -- foo.spec.ts  # one real-VS-Code spec
npm run lint:ci                                 # Biome lint gate (whole tree)
```

See [`DEVELOPMENT.md` → Running tests headless](DEVELOPMENT.md#running-tests-headless-xvfb) for details, troubleshooting, and coverage commands. For the full testing playbook — which layer to use, real-VS-Code spec patterns, booting the WASM in a vitest vm-context, coverage, and the gotchas — use the **`vmarkd-testing`** skill.

## Visual / layout bugs

For **layout / CSS / caret** bugs — the perceptual "a few px / jumps / squished / repro only in the real editor" class — use the **`vmarkd-visual-debugging`** skill: `playwright-cli` for an interactive measure-and-screenshot loop on the harnesses (`npm run harness:serve` + `npm run pw:cli`), `@visual` golden screenshots (`npm run test:visual`, a local-only net excluded from CI), and the real-VS-Code webview suite (`npm run test:vscode`) for bugs that only reproduce with VS Code's injected CSS / the custom-editor pipeline.
