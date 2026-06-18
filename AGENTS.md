**Read [`DEVELOPMENT.md`](DEVELOPMENT.md) first** — it documents the build layout, test layers, harnesses, coverage, and how to run everything. All build/test/lint commands live there.

## Task tracking

When finishing implementation, always update task status inside the relevant `tasks/` file: tick checklist items that were implemented and flag what isn't ready yet. The task file is the single source of truth for status.

`tasks/README.md` is an informative index, not a status tracker — do not record partial or in-progress status there. Only update `tasks/README.md` when a task is fully complete, to mark it done.

## Testing

Every new piece of functionality must ship with **unit tests and e2e tests**, and you must **verify the coverage** for it (run the coverage report and confirm the new code is exercised). A task is not done until its tests pass and cover the new behaviour.

**Always run tests headless with `xvfb-run -a`** — no GUI windows. Quick reference:

```bash
npm test                                        # unit tests (vitest)
node build.mjs                                  # build (run from project root!)
xvfb-run -a npm --prefix media-src run test:e2e # Playwright e2e (harness)
xvfb-run -a npm run test:vscode                 # real VS Code webview tests
npm run lint:ci                                 # Biome lint gate (whole tree)
```

See [`DEVELOPMENT.md` → Running tests headless](DEVELOPMENT.md#running-tests-headless-xvfb) for details, troubleshooting, and coverage commands.

## Visual / layout bugs

For **layout / CSS / caret** bugs — the perceptual "a few px / jumps / squished / repro only in the real editor" class — use the **`vmarkd-visual-debugging`** skill: `playwright-cli` for an interactive measure-and-screenshot loop on the harnesses (`npm run harness:serve` + `npm run pw:cli`), `@visual` golden screenshots (`npm run test:visual`, a local-only net excluded from CI), and the real-VS-Code webview suite (`npm run test:vscode`) for bugs that only reproduce with VS Code's injected CSS / the custom-editor pipeline.
