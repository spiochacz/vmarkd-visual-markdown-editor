# Task: Editor from source — tree-shake + VDITOR_VERSION fix

> **Status:** ✅ Done. `main.ts` imports `vditor/src/index`; esbuild upgraded
> 0.11→0.21.5; new `media-src/build.mjs` driver + shared `esbuild-shared.mjs`
> (reused by `e2e/serve.mjs`) carry `define VDITOR_VERSION`,
> `useDefineForClassFields:false`, `loader '.less':'empty'`, and a plugin stubbing
> the 4 unused toolbar buttons (Br/Fullscreen/Record/Export → `src/stubs/`). One
> extra interop fix beyond the plan: Vditor's `undo` does
> `import * as DiffMatchPatch … new DiffMatchPatch()` — a CJS function-export, so
> the source build needs that rewritten to a default import (plugin in
> esbuild-shared) or undo throws; guarded by `e2e/undo-interop.spec.ts`.
> **Result:** `media/dist/main.js` **310.5 → 261.1 KB (−16%)**; 44 e2e pass (incl.
> the new undo guard); 116 unit unchanged.
> **Source:** `masterofarbs-audiodub/better-markdown-editor` — §4 (SELECTED)
> **Derived from (removed plan):** `better-markdown-editor-port-plan.md`
> **Value / Risk:** 🟢 bundle −49% (805→375 KB) / medium-high (touches build pipeline)

Do this on a **separate branch**. Gain is bundle size only — not functionality.

> **Measured baseline (2026-05-30, esbuild metafile of the current build):** the
> minified `media/dist/main.js` is **~308 KB**, of which **`vditor/dist/index.js` is
> 287.5 KB (94 %)** and all of vMark's own code is ~18 KB. (The "805 KB" above was the
> older 0.2.32 artifact / unminified output.) So the *only* meaningful bundle lever is
> trimming the Vditor portion via the source import below — and Vditor's core (lute
> WASM loader, IR engine, base toolbar) is largely required, so set realistic
> expectations: this is a moderate cut, not a halving of the current minified size.

## Feasibility on 3.11.2 — VERIFIED (2026-05-29)
- ✅ `vditor/src/index.ts` source entry exists.
- ✅ `VDITOR_VERSION` is `declare const` in `src/ts/constants.ts:1` (identical to 3.8.4).
- ✅ Stub targets exist: `src/ts/toolbar/{Br,Fullscreen,Record,Export}.ts`.

## Steps
**4.1. `media-src/build.mjs`** — new esbuild driver (replaces the CLI):
```js
define: { VDITOR_VERSION: JSON.stringify(vditorPkg.version) },
tsconfigRaw: { compilerOptions: { useDefineForClassFields: false } },
loader: { '.less': 'empty' },          // ← OUR 3.11 addition, see 4.5
plugins: [stubUnusedVditorButtons],
```
- `define VDITOR_VERSION` → fixes `ReferenceError: VDITOR_VERSION is not defined`.
- `useDefineForClassFields:false` → fixes `Cannot read properties of undefined
  (reading 'appendChild')` in `MenuItem.ts`.
- `onResolve` plugin redirects the 4 unused buttons to a stub.

**4.2. `media-src/src/stubs/vditor-toolbar-stubs.ts`** (new) — 4 empty classes
`extends StubElement { element = document.createElement('div') }`: `Br`,
`Fullscreen`, `Record`, `Export`. (esbuild can't drop them: `toolbar/index.ts`
imports them unconditionally with live `new ClassName()` in a switch.)

**4.3. `media-src/src/main.ts`** — change import:
```ts
- import Vditor from 'vditor'
+ import Vditor from 'vditor/src/index'   // source visible to esbuild = tree-shake
  import 'vditor/dist/index.css'          // KEEP — pre-built CSS
```

**4.4. `package.json` (media-src) scripts** — `node build.mjs --watch` / `node
build.mjs`. Verify the Foyfile calls the new `build.mjs`, not the old CLI.

**4.5. ⚠️ LESS — 3.11-specific (better-markdown-editor 3.8.4 did NOT hit this)**
`vditor/src/index.ts:1` in 3.11.2 does `import "./assets/less/index.less"`; esbuild
has no `.less` loader. Solution: `loader: { '.less': 'empty' }` (we already load the
compiled `vditor/dist/index.css`).

**4.6. e2e harness** — `media-src/e2e/harness.ts` imports from source and previously
crashed on `VDITOR_VERSION undefined`. Playwright/serve must use the same `define` +
LESS loader. Verify `serve.mjs` / the harness build config.

> Copy full `build.mjs`, `stubs/`, `config.ts` from better-markdown-editor's
> `media-src/` (source structure is identical).

## See also
- `21-backend-tests-vitest.md` — `test/perf/bundle-size.test.ts` ties in here.

## Verify
(a) build passes without the LESS error, (b) editor renders in IR/WYSIWYG/SV,
(c) toolbar works, (d) the 19 e2e tests pass, (e) `media/dist/main.js` actually shrank.
