# Task: Build toolchain — drop foy/ts-node, land on plain Node + npm

> **Status:** ✅ Done (2026-06-01).
> **Source:** user request — out of the dependency-update discussion
> (`out/DEPENDENCY-UPDATES.md`): drop the niche `foy` task runner (and the
> `ts-node` it needs). Goal refined mid-way to **minimise tooling**.
> **Value / Risk:** 🟢 simpler, dependency-light dev toolchain / low (dev-time
> only — the shipped extension is byte-identical).

## Outcome
The build orchestrator is now **`build.mjs` — plain Node ESM**, run with
`node build.mjs [watch]`. No task runner, no TypeScript-runner, no Bun:

- **No `foy`, no `ts-node`** — both removed for good.
- **No Bun** — see the arc below.
- **npm** is the package manager (`package-lock.json`, root + `media-src`).
- The extension still ships as plain Node-targeted `tsc` output; VS Code runs it
  in its own Node runtime. The toolchain is dev-time only.

`build.mjs` does exactly what the old `Foyfile.ts` did: sync Vditor assets into
`media/vditor/`, run `tsc -p ./` + the media-src esbuild build in parallel, then
`git add -A`. Subprocesses use `node:child_process` (with `node_modules/.bin` on
PATH so `tsc` resolves whether invoked via npm or directly).

## Arc (why not Bun)
1. **foy/ts-node → Bun** (light: Bun as package manager + script runner). Worked
   — Bun ran a TypeScript `build.ts` natively, installs were fast.
2. **Bun → plain Node + npm** (this task's final state). Decision: **minimise the
   number of tools**. Node 22.18+ runs `.ts` natively, but the build script needs
   no types, so it became `build.mjs` — zero reliance on any TS-running feature.
   Net: contributors need only Node + npm (which they need anyway); nothing niche
   to install; best Windows/CI portability. Trade-off accepted: npm installs are
   slower than Bun's.

The durable win across the whole arc: **`foy` and `ts-node` are gone**, and the
build is a single readable plain-Node file.

## Carry-overs (not done here — belong to task 24)
- `build.mjs` still ends with **`git add -A`** (1:1 with the old Foyfile). The
  release flow relies on it. Removing it is **task 24 Part C #2**.
- Source maps still ship in the `.vsix` (`**/*.map`) — kept on purpose. Stripping
  them is **task 24 §5**.

## Verify
- `node build.mjs` → host (`out/extension.js`) + webview (`media/dist/main.js`)
  build green.
- `npm test` → 189 unit pass; `npm --prefix media-src run test:e2e` → 56 e2e pass.
- `npx @vscode/vsce package` produces a working `.vsix`.
- No `foy` / `ts-node` / Bun anywhere (`grep`, lockfiles, CI).

## See also
- `24-ci-cd-pipeline.md` — the `git add -A` removal and VSIX source-map trim live
  there.
