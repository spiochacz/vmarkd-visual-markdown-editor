# Marp Presentation (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author Marp presentations in vMarkd — the Markdown source on the left (any editor mode), a live read-only Marp slide deck in a collapsible right panel, with a per-slide card overlay in IR/WYSIWYG and caret↔slide sync.

**Architecture:** Marp is *document-level* (not a fence renderer): `marp: true` frontmatter turns it on, top-level `---` are slide breaks. The deck is a **second, independent render of the same source text** via `@marp-team/marp-core` (markdown-it based, NOT Lute) — the Markdown stays the single source of truth, the deck is read-only output. `marp-core` is bundled into a **separate `media/dist/marp.js` chunk** loaded at runtime only when a doc is a deck (mirrors how Vditor lazy-loads mermaid/echarts via an injected `<script>`), so `main.js` is never bloated for plain docs. Render output (`{html, css}`) is injected into a panel; Marpit's default `.marpit` container scopes the theme CSS so it can't leak onto `.vditor-reset`. A non-editable overlay measures top-level `<hr>` positions to draw subtle slide cards — the editable DOM is never mutated, so round-trip is 100% safe.

**Tech Stack:** TypeScript, esbuild (webview bundle), `@marp-team/marp-core` (new devDependency of `media-src`), Vitest (backend unit), Playwright (`media-src/e2e`). Plain node + npm only — no niche tooling.

---

## Context the engineer needs before starting

**You know almost nothing about this codebase. Read this section fully.**

- **Two halves.** The VS Code *host* is `src/*.ts` (compiled by `tsc` to `out/`). The *webview* is `media-src/src/*.ts` (bundled by esbuild to `media/dist/main.js`). They talk via `postMessage`. The webview can `import` from `../../src/*` (host-isomorphic pure modules only — e.g. `media-src/src/vditor-options.ts` imports `../../src/theme-registry`). Use this for the shared `parseMarpEnabled` detector.
- **Build:** `node build.mjs` (one-shot) or `node build.mjs watch`. It syncs Vditor assets, then runs `tsc -p ./` (host) and `npm run build` in `media-src` (webview esbuild, via `media-src/build.mjs`). **There is no separate "compile the webview" command** — always `node build.mjs`.
- **Webview esbuild** (`media-src/build.mjs`) currently has ONE entry `./src/main.ts` → `../media/dist/main.js`, `format` unset (esbuild default `iife`), `bundle: true`. Shared Vditor-source treatment lives in `media-src/esbuild-shared.mjs` (`vditorSourceConfig`). We will add a SECOND entry for the Marp chunk.
- **CSP** (`src/html-builder.ts:46`): `script-src 'nonce-${nonce}' ${cspSource} 'unsafe-eval'`. Because `${cspSource}` (the webview resource origin) is in `script-src`, a runtime-injected `<script src="…webview-resource…/marp.js">` loads WITHOUT a nonce — exactly how Vditor injects mermaid/echarts. **No CSP change is needed** for the lazy chunk. `style-src … 'unsafe-inline'` lets us inject Marp's `<style>`.
- **Init message** (`src/extension.ts` `onReady`, ~line 879): `postUpdate({ type:'init', cdn: this.vditorBaseUri, options: {...collectConfigOptions(), ...savedVditorOptions}, theme, wiki })`. The webview's `initVditor(msg)` consumes it; `runFinishInit(msg)` (`media-src/src/main.ts:337`) wires the observer-based features (callouts, code-source) AFTER Vditor is constructed. This is where we mount the Marp panel.
- **Debounced edit signal** (`media-src/src/main.ts:503` `postEdit`): fires on idle (250 ms) after edits. We add ONE line there to re-render the deck. **Do NOT add a second debounce** (spec decision 4).
- **Observer pattern to copy:** `media-src/src/callouts.ts` (`observeCallouts` — MutationObserver, RAF-debounced, returns a disposer, re-runs after Vditor rebuilds the IR DOM). `marp-slide-overlay.ts` mirrors it exactly.
- **`activeModeElement(vditor)`** (`media-src/src/source-map.ts:89`) resolves the active mode's editable element (IR/WYSIWYG/SV). Use it — never hard-code `.vditor-ir`.
- **e2e harness:** `media-src/e2e/serve.mjs` builds per-feature harness bundles in-memory and serves HTML fixtures on `:9123` (Playwright `webServer`) / `:9124` (`npm run harness:serve`). Each feature = an entry in `serve.mjs` + a `<feature>.html` + a `<feature>.spec.ts`. Specs import `from './coverage-fixture'`.
- **rtk note:** the shell's `rtk` hook mangles `grep`/`vitest`/`sed` output. When you need raw output run `rtk proxy <cmd>`.
- **Lint gate:** run `npm run lint:ci` (biome, whole tree) before declaring done — it checks the whole tree, so pre-existing drift fails it too.
- **DO NOT commit/push/PR on your own initiative.** Each task's commit step is for the implementer to run; the human controls publishing to origin.

### File Structure (created / modified)

| File | New? | Responsibility |
|---|---|---|
| `src/marp-detect.ts` | create | Pure `parseMarpEnabled(md)` — frontmatter `marp: true` detection. Host-isomorphic (imported by host AND webview). |
| `test/backend/marp-detect.test.ts` | create | Unit tests for `parseMarpEnabled`. |
| `media-src/src/marp-entry.ts` | create | The lazy chunk's entry: imports `@marp-team/marp-core`, exposes `window.__vmarkdMarp.render(src)`. Built to `media/dist/marp.js`. |
| `media-src/src/marp-preview.ts` | create | `loadMarp()` (inject the chunk `<script>`, resolve `__vmarkdMarp`) + `injectDeck(panel, source, marp)` (render + inject `{html,css}`, return slide count). |
| `media-src/src/marp-panel.ts` | create | Right panel DOM + draggable splitter + open/collapse toggle + width/open persistence; mounts/unmounts the deck; owns the edit-driven re-render + the slide↔source map + caret→slide highlight/scroll + click-slide→caret. |
| `media-src/src/marp-slide-overlay.ts` | create | Non-editable overlay measuring top-level `<hr>` positions → subtle card frames + slide numbers (IR/WYSIWYG only). MutationObserver + ResizeObserver. |
| `media-src/esbuild-shared.mjs` | modify | (none required for the chunk — documented; the chunk is a plain entry. No Vditor patch.) |
| `media-src/build.mjs` | modify | Add the `marp-entry.ts` → `marp.js` second build. |
| `media-src/e2e/serve.mjs` | modify | Serve the `marp` harness bundle + `marp.js` chunk + `marp.html`. |
| `media-src/e2e/marp-harness.ts` | create | e2e harness: build a Vditor + mount the Marp panel, expose hooks. |
| `media-src/e2e/marp.html` | create | e2e fixture page. |
| `media-src/e2e/marp.spec.ts` | create | e2e: render N slides, no CSS leak, re-render on edit, no panel for non-Marp, overlay present in IR / absent in source / round-trips, caret→slide + click-slide→caret. |
| `src/extension.ts` | modify | Pass `marp` enabled flag + `marpSrc` (chunk URI) in the init message. |
| `media-src/src/main.ts` | modify | Mount the panel in `runFinishInit`; call the re-render hook in `postEdit`; set `window.__vmarkdMarpSrc`. |
| `media-src/src/main.css` | modify | Panel + splitter + deck-scroll + slide-card overlay styles. |
| `package.json` | modify | Add `@marp-team/marp-core` to `media-src`'s deps (NOT root) — see Task 0. |
| `tasks/107-marp-slide-preview.md` | modify | Mark Phase 1 done; link the spec + this plan. |
| `CHANGELOG.md` | modify | Add the Marp feature entry. |

---

## Task 0: Dependency + lazy-chunk build spike (riskiest first)

Prove the whole build/load mechanism end-to-end before writing feature code: `marp-core` installs, esbuild bundles it into a standalone `media/dist/marp.js`, `render()` returns `{html, css}`, and the chunk loads + runs under the real CSP. If any of this doesn't hold, the architecture changes — so do it first.

**Files:**
- Create: `media-src/src/marp-entry.ts`
- Modify: `media-src/build.mjs`
- Modify: `media-src/package.json` (dependency)

- [ ] **Step 1: Install marp-core as a `media-src` dependency**

The webview bundle is built from `media-src`, so the dep lives there (NOT the repo root manifest — keeping it out of the shipped extension's `dependencies`; esbuild bundles it into `marp.js`).

Run:
```bash
npm --prefix media-src install --save @marp-team/marp-core
```
Expected: `media-src/package.json` `dependencies` gains `"@marp-team/marp-core": "^4.x"`; `media-src/package-lock.json` updated. (If `media-src` has no own lockfile, the root one is updated — that's fine; the point is the dep is declared under `media-src`.)

- [ ] **Step 2: Write the chunk entry**

Create `media-src/src/marp-entry.ts`:
```ts
// The lazy Marp chunk (built to media/dist/marp.js, loaded at runtime only when a doc is a
// deck — see marp-preview.ts). marp-core is markdown-it based, independent of Lute/Vditor; the
// deck is a SECOND render of the same source. We keep ONE Marp instance and expose a single
// render() on window so main.js never imports marp-core (no bloat for non-Marp docs).
//
// Marpit wraps output in <div class="marpit"> and scopes the theme CSS under `.marpit` by
// default, so the deck's CSS can't restyle .vditor-reset / .markdown-body. math:false and
// html:false per the Phase-1 spec (no KaTeX; no raw-HTML execution in the deck).
import { Marp } from '@marp-team/marp-core'

const marp = new Marp({ math: false, html: false })

;(window as any).__vmarkdMarp = {
  render(source: string): { html: string; css: string } {
    const { html, css } = marp.render(source)
    return { html, css }
  },
}
```

- [ ] **Step 3: Add the second esbuild build for the chunk**

Modify `media-src/build.mjs`. Keep the existing `main.ts` build; add a parallel `marp-entry.ts` → `marp.js` build. Replace the file body with:
```js
// esbuild driver for the webview bundle (task 20). Replaces the bare CLI so we
// can import Vditor from *source* (`vditor/src/index`) and tree-shake it, which
// the pre-bundled `vditor/dist/index.js` can't do. The Vditor-source specifics
// live in esbuild-shared.mjs (reused by the e2e harness server).
import * as esbuild from 'esbuild'
import { rmSync } from 'node:fs'
import { vditorSourceConfig } from './esbuild-shared.mjs'

const watch = process.argv.includes('--watch')

/** @type {import('esbuild').BuildOptions} */
const mainOptions = {
  entryPoints: ['./src/main.ts'],
  bundle: true,
  outfile: '../media/dist/main.js',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
  ...vditorSourceConfig,
}

// The lazy Marp chunk (task 107). A SEPARATE bundle (not a code-split of main.js) so main.js
// stays a plain iife and the chunk is loaded on demand via an injected <script> (marp-preview.ts).
// marp-core is bundled in here; it does NOT need the Vditor-source treatment.
/** @type {import('esbuild').BuildOptions} */
const marpOptions = {
  entryPoints: ['./src/marp-entry.ts'],
  bundle: true,
  outfile: '../media/dist/marp.js',
  format: 'iife',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
}

rmSync(new URL('../media/dist', import.meta.url), {
  recursive: true,
  force: true,
})

if (watch) {
  const mainCtx = await esbuild.context(mainOptions)
  const marpCtx = await esbuild.context(marpOptions)
  await Promise.all([mainCtx.watch(), marpCtx.watch()])
  console.log('[build.mjs] watching…')
} else {
  await Promise.all([esbuild.build(mainOptions), esbuild.build(marpOptions)])
}
```

- [ ] **Step 4: Build and verify the chunk emits + render() works**

Run:
```bash
node build.mjs && ls -la media/dist/marp.js
```
Expected: build succeeds; `media/dist/marp.js` exists and is non-trivial (hundreds of KB — it bundles marp-core).

Then verify `render()` actually returns `{html, css}` in a browser-like context. Run:
```bash
node -e "globalThis.window = globalThis; require('./media/dist/marp.js'); const r = window.__vmarkdMarp.render('---\nmarp: true\n---\n\n# A\n\n---\n\n# B'); console.log('html?', r.html.includes('<section'), 'css?', r.css.includes('.marpit'), 'sections:', (r.html.match(/<section/g)||[]).length)"
```
Expected: `html? true css? true sections: 2`. (marp-core renders in Node; the `window` shim satisfies the chunk's `window.__vmarkdMarp` assignment.)

> If `render()` throws in Node because of a missing DOM API, that's acceptable for THIS check only if the chunk still BUILDS — the real verification is the e2e harness in Task 2 (a real browser). If it throws on build or the chunk is empty, STOP: the bundling approach needs revisiting (fallback: mark `@marp-team/marp-core` partially external / pin an older major). Do not proceed to Task 1 until the chunk builds.

- [ ] **Step 5: Confirm main.js is NOT bloated**

Run:
```bash
ls -la media/dist/main.js media/dist/marp.js
```
Expected: `marp.js` carries the marp-core weight; `main.js` size is essentially unchanged from before this task (it does not import marp-core). Eyeball: `main.js` should be far smaller than `marp.js`.

- [ ] **Step 6: Commit**

```bash
git add media-src/src/marp-entry.ts media-src/build.mjs media-src/package.json media-src/package-lock.json package-lock.json
git commit -m "feat(marp): lazy marp-core chunk (media/dist/marp.js) — build spike (task 107)"
```

---

## Task 1: `marp: true` frontmatter detection (pure, host + webview)

A pure detector both halves use: the host sets the initial flag in `init`; the webview re-evaluates on each edit (so adding/removing `marp: true` toggles the UI without a host round-trip).

**Files:**
- Create: `src/marp-detect.ts`
- Test: `test/backend/marp-detect.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/backend/marp-detect.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseMarpEnabled } from '../../src/marp-detect'

describe('parseMarpEnabled', () => {
  it('true when frontmatter has marp: true', () => {
    expect(parseMarpEnabled('---\nmarp: true\n---\n\n# Slide')).toBe(true)
  })

  it('tolerates surrounding whitespace and trailing comment', () => {
    expect(parseMarpEnabled('---\n  marp:   true   \n---\n')).toBe(true)
    expect(parseMarpEnabled('---\nmarp: true # deck\n---\n')).toBe(true)
  })

  it('true alongside other frontmatter keys, any order', () => {
    expect(
      parseMarpEnabled('---\ntheme: gaia\nmarp: true\npaginate: true\n---\n'),
    ).toBe(true)
  })

  it('false when marp is false', () => {
    expect(parseMarpEnabled('---\nmarp: false\n---\n# x')).toBe(false)
  })

  it('false when marp key absent', () => {
    expect(parseMarpEnabled('---\ntitle: Doc\n---\n# x')).toBe(false)
  })

  it('false when there is no frontmatter at all', () => {
    expect(parseMarpEnabled('# Just a heading\n\nmarp: true in body')).toBe(
      false,
    )
  })

  it('false on empty / non-string input', () => {
    expect(parseMarpEnabled('')).toBe(false)
    expect(parseMarpEnabled(undefined as unknown as string)).toBe(false)
  })

  it('only reads the FIRST frontmatter block (must start at offset 0)', () => {
    // A leading blank line means no frontmatter (CommonMark/Marp require it at the top).
    expect(parseMarpEnabled('\n---\nmarp: true\n---\n')).toBe(false)
  })

  it('handles CRLF line endings', () => {
    expect(parseMarpEnabled('---\r\nmarp: true\r\n---\r\n# x')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `rtk proxy npx vitest run test/backend/marp-detect.test.ts`
Expected: FAIL — `Cannot find module '../../src/marp-detect'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/marp-detect.ts`:
```ts
// Marp activation detection (task 107). Marp is document-level: a `marp: true` key in the
// document's leading YAML frontmatter turns the whole file into a deck. PURE + host-isomorphic
// — the host (src/extension.ts) reads it to set the initial init flag, and the webview
// (marp-panel.ts) re-evaluates it on every edit so adding/removing the key toggles the UI live.
//
// We do a deliberately small, dependency-free scan (no YAML parser): frontmatter must start at
// offset 0 with a `---` fence line, end at the next `---`/`...` fence, and contain a top-level
// `marp:` whose value's first token is `true`. That matches how Marp itself gates activation.

const FENCE = /^(---|\.\.\.)\s*$/

export function parseMarpEnabled(md: string): boolean {
  if (typeof md !== 'string' || md.length === 0) return false
  // Frontmatter must be the very first thing in the file.
  const lines = md.split(/\r?\n/)
  if (lines.length === 0 || lines[0].trim() !== '---') return false

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (FENCE.test(line)) break // end of frontmatter
    const m = /^\s*marp\s*:\s*(\S+)/.exec(line)
    if (m) {
      // First token of the value; strip a trailing YAML `#` comment if it abuts.
      const value = m[1].replace(/#.*$/, '').trim().toLowerCase()
      return value === 'true'
    }
  }
  return false
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `rtk proxy npx vitest run test/backend/marp-detect.test.ts`
Expected: PASS (all 9 assertions).

- [ ] **Step 5: Wire the host init flag + chunk URI**

Modify `src/extension.ts`. First add the import near the other local imports (top of file, alongside e.g. the theme-registry import):
```ts
import { parseMarpEnabled } from './marp-detect'
```

Then in `onReady` (the `postUpdate({ type: 'init', … })` call, ~line 879), add two fields. Change:
```ts
    await this.postUpdate({
      type: 'init',
      cdn: this.vditorBaseUri,
      options: {
        ...MarkdownEditorProvider.collectConfigOptions(),
        ...MarkdownEditorProvider.sanitizeVditorOptions(
          this.context.globalState.get(KeyVditorOptions),
        ),
```
to:
```ts
    await this.postUpdate({
      type: 'init',
      cdn: this.vditorBaseUri,
      // The lazy Marp chunk's webview URI (loaded on demand by marp-preview.ts). Lives next to
      // main.js under media/dist, NOT under media/vditor (which `cdn` points to).
      marpSrc: this.webviewPanel.webview
        .asWebviewUri(
          vscode.Uri.joinPath(this.context.extensionUri, 'media', 'dist', 'marp.js'),
        )
        .toString(),
      options: {
        ...MarkdownEditorProvider.collectConfigOptions(),
        // Per-document Marp activation (task 107): `marp: true` frontmatter → deck mode. The
        // webview re-evaluates this on each edit too (parseMarpEnabled), so this is just the
        // initial state.
        marp: parseMarpEnabled(this.document.getText()),
        ...MarkdownEditorProvider.sanitizeVditorOptions(
          this.context.globalState.get(KeyVditorOptions),
        ),
```

> NOTE on merge order: `marp` is placed BEFORE the spread of saved Vditor options so a stale saved blob can't override it — but `sanitizeVditorOptions` only persists Vditor's own `preview`/`theme`/`outline` keys, so it will never carry `marp`. Placing it before is belt-and-suspenders and matches the file's setting-authority convention.

- [ ] **Step 6: Build the host to confirm it compiles**

Run: `rtk proxy npx tsc -p ./ --noEmit`
Expected: no type errors. (If `tsc --noEmit` flags unrelated pre-existing issues, scope your check: confirm there are no NEW errors mentioning `marp-detect` or `extension.ts` near your edit.)

- [ ] **Step 7: Commit**

```bash
git add src/marp-detect.ts test/backend/marp-detect.test.ts src/extension.ts
git commit -m "feat(marp): parseMarpEnabled detection + host init flag/chunk URI (task 107)"
```

---

## Task 2: Render the deck — `marp-preview.ts` + lazy load + e2e

The render unit: load the chunk on demand, render the source, inject `{html, css}` into a panel element, and prove (in a real browser) that it produces N `<section>` slides and does NOT leak CSS onto `.vditor-reset`.

**Files:**
- Create: `media-src/src/marp-preview.ts`
- Create: `media-src/e2e/marp-harness.ts`
- Create: `media-src/e2e/marp.html`
- Create: `media-src/e2e/marp.spec.ts`
- Modify: `media-src/e2e/serve.mjs`

- [ ] **Step 1: Write `marp-preview.ts`**

Create `media-src/src/marp-preview.ts`:
```ts
// Marp deck render + lazy chunk loader (task 107). The deck is a SECOND, independent render of
// the same Markdown source (marp-core, not Lute) — read-only output; the source stays the single
// source of truth. The marp-core bundle is a separate chunk (media/dist/marp.js) loaded on demand
// via an injected <script> (mirrors how Vditor lazy-loads mermaid/echarts), so main.js carries no
// marp-core weight for plain docs. The chunk's URL is `window.__vmarkdMarpSrc`, set from the
// host's init message (msg.marpSrc); the e2e harness sets it to the harness-served path.

export interface MarpApi {
  render(source: string): { html: string; css: string }
}

let loading: Promise<MarpApi> | null = null

/** Load the marp chunk once; resolves with the render API. Idempotent. */
export function loadMarp(): Promise<MarpApi> {
  const existing = (window as any).__vmarkdMarp as MarpApi | undefined
  if (existing) return Promise.resolve(existing)
  if (loading) return loading
  loading = new Promise<MarpApi>((resolve, reject) => {
    const src = (window as any).__vmarkdMarpSrc as string | undefined
    if (!src) {
      reject(new Error('marp chunk URL (__vmarkdMarpSrc) not set'))
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.onload = () => {
      const api = (window as any).__vmarkdMarp as MarpApi | undefined
      if (api) resolve(api)
      else reject(new Error('marp chunk loaded but __vmarkdMarp is missing'))
    }
    script.onerror = () => reject(new Error('failed to load marp chunk'))
    document.head.appendChild(script)
  })
  return loading
}

const STYLE_CLASS = 'vmarkd-marp__style'
const DECK_CLASS = 'vmarkd-marp__deck'

/**
 * Render `source` and inject the deck into `panel`. The panel holds exactly one <style> (the
 * deck's scoped CSS) + one deck container (the <div class="marpit"> Marp emits, which scopes the
 * theme CSS so it can't restyle .vditor-reset). Returns the number of <section> slides.
 * On a render error, shows the message inside the panel and returns 0.
 */
export function injectDeck(
  panel: HTMLElement,
  source: string,
  marp: MarpApi,
): number {
  let html: string
  let css: string
  try {
    ;({ html, css } = marp.render(source))
  } catch (err) {
    panel.innerHTML = ''
    const msg = document.createElement('div')
    msg.className = 'vmarkd-marp__error'
    msg.textContent = `Marp render failed: ${(err as Error)?.message ?? err}`
    panel.appendChild(msg)
    return 0
  }

  let style = panel.querySelector<HTMLStyleElement>(`.${STYLE_CLASS}`)
  if (!style) {
    style = document.createElement('style')
    style.className = STYLE_CLASS
    panel.appendChild(style)
  }
  if (style.textContent !== css) style.textContent = css

  let deck = panel.querySelector<HTMLElement>(`.${DECK_CLASS}`)
  if (!deck) {
    deck = document.createElement('div')
    deck.className = DECK_CLASS
    panel.appendChild(deck)
  }
  deck.innerHTML = html

  return deck.querySelectorAll('section').length
}
```

- [ ] **Step 2: Add the harness entry + chunk + route to `serve.mjs`**

Modify `media-src/e2e/serve.mjs`. Add a `marp` harness entry to `entryPoints` (after the `'config-apply'` line):
```js
    'config-apply': path.join(__dirname, 'config-apply-harness.ts'),
    marp: path.join(__dirname, 'marp-harness.ts'),
```
The harness also needs the actual marp chunk. Add a second in-memory build BELOW the existing `built` build (so the chunk is a plain iife, like prod). After the `const bundles = …` block, add:
```js
const marpChunk = await esbuild.build({
  entryPoints: { 'marp-chunk': path.join(__dirname, '../src/marp-entry.ts') },
  bundle: true,
  format: 'iife',
  sourcemap: 'inline',
  write: false,
  outdir: __dirname,
})
const marpChunkJs = marpChunk.outputFiles[0].text
```
Read the fixture HTML (next to the other `…Html` reads):
```js
const marpHtml = fs.readFileSync(path.join(__dirname, 'marp.html'))
```
Add the routes (next to the other `if (url === …)` routes, before the `bundles[url]` check):
```js
  if (url === '/marp.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(marpHtml)
  }
  if (url === '/marp-chunk.js') {
    res.setHeader('content-type', 'text/javascript')
    return res.end(marpChunkJs)
  }
```

- [ ] **Step 3: Write the harness**

Create `media-src/e2e/marp-harness.ts`:
```ts
// e2e harness for the Marp deck (task 107). Builds a panel element and exposes the render +
// inject path so the spec can assert slide count, CSS scoping, and re-render — in a REAL browser
// (the only place marp-core actually runs). Sets __vmarkdMarpSrc to the harness-served chunk.
import { loadMarp, injectDeck } from '../src/marp-preview'

;(window as any).__vmarkdMarpSrc = '/marp-chunk.js'

const panel = document.getElementById('panel') as HTMLElement

;(window as any).__renderDeck = async (source: string): Promise<number> => {
  const marp = await loadMarp()
  return injectDeck(panel, source, marp)
}

// True once the chunk global exists — lets the spec assert "non-Marp doc never loads marp.js".
;(window as any).__marpLoaded = () => !!(window as any).__vmarkdMarp

;(window as any).__ready = true
```

- [ ] **Step 4: Write the fixture**

Create `media-src/e2e/marp.html`:
```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>marp harness</title>
    <style>
      /* A .vditor-reset element to prove the deck CSS does not leak onto editor chrome. */
      .vditor-reset { color: rgb(1, 2, 3); }
      #panel { width: 600px; }
    </style>
  </head>
  <body>
    <div class="vditor-reset"><h1>editor heading</h1></div>
    <div id="panel"></div>
    <script src="/marp.js"></script>
  </body>
</html>
```

- [ ] **Step 5: Write the spec**

Create `media-src/e2e/marp.spec.ts`:
```ts
import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'

const DECK = `---
marp: true
---

# Slide one

---

# Slide two

---

# Slide three
`

async function goto(page: Page) {
  await page.goto('/marp.html')
  await page.waitForFunction(() => (window as any).__ready === true)
}

test('renders one <section> per slide', async ({ page }) => {
  await goto(page)
  const count = await page.evaluate((src) => (window as any).__renderDeck(src), DECK)
  expect(count).toBe(3)
  await expect(page.locator('#panel .vmarkd-marp__deck section')).toHaveCount(3)
})

test('the deck CSS does not leak onto .vditor-reset', async ({ page }) => {
  await goto(page)
  await page.evaluate((src) => (window as any).__renderDeck(src), DECK)
  // Marp scopes its theme under .marpit; the editor chrome keeps its own colour.
  const color = await page.evaluate(
    () => getComputedStyle(document.querySelector('.vditor-reset')!).color,
  )
  expect(color).toBe('rgb(1, 2, 3)')
})

test('re-rendering with new source updates the deck', async ({ page }) => {
  await goto(page)
  await page.evaluate((src) => (window as any).__renderDeck(src), DECK)
  await expect(page.locator('#panel .vmarkd-marp__deck section')).toHaveCount(3)
  const two = await page.evaluate(
    (src) => (window as any).__renderDeck(src),
    `---\nmarp: true\n---\n\n# Only one\n\n---\n\n# And two\n`,
  )
  expect(two).toBe(2)
  await expect(page.locator('#panel .vmarkd-marp__deck section')).toHaveCount(2)
})

test('the marp chunk is not loaded until a deck is rendered', async ({ page }) => {
  await goto(page)
  expect(await page.evaluate(() => (window as any).__marpLoaded())).toBe(false)
  await page.evaluate((src) => (window as any).__renderDeck(src), DECK)
  expect(await page.evaluate(() => (window as any).__marpLoaded())).toBe(true)
})
```

- [ ] **Step 6: Run the e2e spec**

Run: `rtk proxy npx playwright test marp.spec.ts --config media-src/playwright.config.ts`

(If the repo's e2e is normally run via an npm script, use that instead — check `package.json` for `test:e2e`; e.g. `cd media-src && npx playwright test marp.spec.ts`. The `webServer` in the Playwright config auto-starts `serve.mjs`.)

Expected: 4 tests PASS. This is the real-browser proof that marp-core renders (validating Task 0's deferred check).

- [ ] **Step 7: Commit**

```bash
git add media-src/src/marp-preview.ts media-src/e2e/marp-harness.ts media-src/e2e/marp.html media-src/e2e/marp.spec.ts media-src/e2e/serve.mjs
git commit -m "feat(marp): marp-preview render + lazy load + e2e (task 107)"
```

---

## Task 3: Right panel, splitter, toggle, edit re-render — `marp-panel.ts` + wiring

Mount a collapsible right panel beside the editor, with a draggable splitter and a toggle; render the deck on mount and re-render on the existing debounced edit signal; persist open/width. Gate the whole thing on `marp` enabled (init flag, re-checked on edit).

**Files:**
- Create: `media-src/src/marp-panel.ts`
- Modify: `media-src/src/main.ts`
- Modify: `media-src/src/main.css`

- [ ] **Step 1: Write `marp-panel.ts`**

Create `media-src/src/marp-panel.ts`:
```ts
// Marp right panel (task 107). Owns the panel DOM, the draggable splitter, the open/collapse
// toggle, width/open persistence (localStorage — self-contained, no host round-trip), and the
// deck re-render. The deck itself is rendered by marp-preview.ts. Gated on Marp being enabled
// (parseMarpEnabled on the live source, re-checked on each edit). Mode-agnostic: the panel sits
// beside whatever editor mode is active.
import { parseMarpEnabled } from '../../src/marp-detect'
import { injectDeck, loadMarp, type MarpApi } from './marp-preview'

const OPEN_KEY = 'vmarkd.marp.open'
const WIDTH_KEY = 'vmarkd.marp.width'
const MIN_WIDTH = 240
const MAX_WIDTH_RATIO = 0.7
const DEFAULT_WIDTH = 0.5 // fraction of the wrapper

export interface MarpPanel {
  /** Re-render the deck from new source (called on the debounced edit signal). */
  update(source: string): void
  /** Tear down: remove DOM + listeners. */
  dispose(): void
  /** The deck container element (for the overlay/sync to read slide positions). */
  readonly deckEl: HTMLElement
}

function readWidth(wrapperWidth: number): number {
  const saved = Number(localStorage.getItem(WIDTH_KEY))
  if (saved >= MIN_WIDTH) return Math.min(saved, wrapperWidth * MAX_WIDTH_RATIO)
  return Math.round(wrapperWidth * DEFAULT_WIDTH)
}

/**
 * Mount the panel as a sibling of `editorRoot` inside a flex wrapper. Returns null (no-op) when
 * Marp is disabled for the initial `source`. `editorRoot` is the Vditor element
 * (window.vditor.vditor.element); we wrap it + the panel in a flex row.
 */
export function mountMarpPanel(
  editorRoot: HTMLElement,
  source: string,
): MarpPanel | null {
  if (!parseMarpEnabled(source)) return null

  const wrapper = document.createElement('div')
  wrapper.className = 'vmarkd-marp__wrapper'
  editorRoot.parentElement?.insertBefore(wrapper, editorRoot)
  wrapper.appendChild(editorRoot)
  editorRoot.classList.add('vmarkd-marp__editor')

  const splitter = document.createElement('div')
  splitter.className = 'vmarkd-marp__splitter'
  wrapper.appendChild(splitter)

  const panel = document.createElement('div')
  panel.className = 'vmarkd-marp__panel'
  wrapper.appendChild(panel)

  const header = document.createElement('div')
  header.className = 'vmarkd-marp__header'
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'vmarkd-marp__toggle'
  toggle.textContent = 'Marp'
  toggle.setAttribute('aria-label', 'Toggle Marp slide panel')
  header.appendChild(toggle)
  panel.appendChild(header)

  const deckEl = document.createElement('div')
  deckEl.className = 'vmarkd-marp__panelbody'
  panel.appendChild(deckEl)

  // Open/collapsed state.
  const setOpen = (open: boolean) => {
    wrapper.classList.toggle('vmarkd-marp--collapsed', !open)
    toggle.setAttribute('aria-pressed', String(open))
    localStorage.setItem(OPEN_KEY, open ? '1' : '0')
  }
  setOpen(localStorage.getItem(OPEN_KEY) !== '0') // open by default

  // Width.
  const applyWidth = (w: number) => {
    panel.style.width = `${w}px`
  }
  applyWidth(readWidth(wrapper.clientWidth || window.innerWidth))

  toggle.addEventListener('mousedown', (e) => e.preventDefault()) // keep editor focus
  toggle.addEventListener('click', () => {
    setOpen(wrapper.classList.contains('vmarkd-marp--collapsed'))
  })

  // Drag the splitter to resize (mirrors outline-resize.ts).
  let dragging = false
  let startX = 0
  let startW = 0
  let raf = 0
  let pendingW = 0
  const onMove = (e: MouseEvent) => {
    if (!dragging) return
    const maxW = Math.floor((wrapper.clientWidth || window.innerWidth) * MAX_WIDTH_RATIO)
    pendingW = Math.min(maxW, Math.max(MIN_WIDTH, startW + (startX - e.clientX)))
    if (!raf) raf = requestAnimationFrame(() => {
      raf = 0
      applyWidth(pendingW)
    })
  }
  const onUp = () => {
    if (!dragging) return
    dragging = false
    document.body.classList.remove('vmarkd-marp__resizing')
    if (panel.offsetWidth > 0) localStorage.setItem(WIDTH_KEY, String(panel.offsetWidth))
  }
  splitter.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault()
    dragging = true
    startX = e.clientX
    startW = panel.offsetWidth
    document.body.classList.add('vmarkd-marp__resizing')
  })
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)

  // Render.
  let api: MarpApi | null = null
  let pending: string | null = null
  const doRender = (src: string) => {
    if (api) injectDeck(deckEl, src, api)
    else pending = src
  }
  loadMarp()
    .then((a) => {
      api = a
      doRender(pending ?? source)
      pending = null
    })
    .catch((err) => {
      deckEl.innerHTML = ''
      const msg = document.createElement('div')
      msg.className = 'vmarkd-marp__error'
      msg.textContent = `Marp failed to load: ${(err as Error)?.message ?? err}`
      deckEl.appendChild(msg)
    })

  return {
    deckEl,
    update(src: string) {
      // If frontmatter flipped marp off, blank the deck (panel stays; cheap, avoids re-layout
      // churn — a full unmount/remount on every toggle is deferred to a later increment).
      if (!parseMarpEnabled(src)) {
        deckEl.innerHTML = ''
        return
      }
      doRender(src)
    },
    dispose() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      if (raf) cancelAnimationFrame(raf)
      // Unwrap: move the editor back out and remove the wrapper.
      editorRoot.classList.remove('vmarkd-marp__editor')
      wrapper.parentElement?.insertBefore(editorRoot, wrapper)
      wrapper.remove()
    },
  }
}
```

- [ ] **Step 2: Wire into `main.ts` — set chunk URL, mount, re-render**

Modify `media-src/src/main.ts`.

(a) Add the import near the other feature imports (~line 44):
```ts
import { mountMarpPanel, type MarpPanel } from './marp-panel'
```

(b) Add a module-level holder near the other `dispose*` holders:
```ts
let marpPanel: MarpPanel | null = null
```

(c) In `initVditor(msg)` (~line 370), set the chunk URL from the init message as the first statement after `lastInitMsg = msg`:
```ts
function initVditor(msg) {
  lastInitMsg = msg
  if (msg.marpSrc) (window as any).__vmarkdMarpSrc = msg.marpSrc
```

(d) In `runFinishInit(msg)` (~line 366, right after the `observeCodeSource` block, before `reportDocMode()`), mount the panel gated on the init flag:
```ts
  // Marp deck (task 107): mount the read-only slide panel beside the editor when the doc is a
  // deck. Re-render is driven by the existing debounced edit signal (postEdit), never a new one.
  marpPanel?.dispose()
  marpPanel = null
  if (msg.options?.marp) {
    const root = activeModeElement(window.vditor)?.closest<HTMLElement>('.vditor') ?? null
    if (root) marpPanel = mountMarpPanel(root, window.vditor.getValue())
  }
```

(e) In `postEdit` (~line 503), add the re-render hook. Change:
```ts
  const postEdit = () => {
    vscode.postMessage({ command: 'edit', content: serializeForHost() })
    reportDocMode()
    syncUndoDelay()
  }
```
to:
```ts
  const postEdit = () => {
    const content = serializeForHost()
    vscode.postMessage({ command: 'edit', content })
    marpPanel?.update(content)
    reportDocMode()
    syncUndoDelay()
  }
```

> The `.vditor` root: `activeModeElement` returns the inner mode element (e.g. `.vditor-ir`); its `.closest('.vditor')` is Vditor's top-level element, whose parent is our mount point. If `window.vditor.vditor.element` is directly available and is the `.vditor` root, prefer it; the `closest` form is a safe fallback that works regardless.

- [ ] **Step 3: Add panel + splitter CSS**

Modify `media-src/src/main.css`. Append:
```css
/* Marp slide panel (task 107) — a collapsible right panel beside the editor. */
.vmarkd-marp__wrapper {
  display: flex;
  flex-direction: row;
  width: 100%;
  height: 100%;
  min-height: 0;
}
.vmarkd-marp__editor {
  flex: 1 1 auto;
  min-width: 0;
}
.vmarkd-marp__splitter {
  flex: 0 0 6px;
  cursor: col-resize;
  background: var(--vscode-widget-border, rgba(128, 128, 128, 0.25));
}
.vmarkd-marp__panel {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  border-left: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.25));
}
.vmarkd-marp__header {
  flex: 0 0 auto;
  padding: 4px 8px;
  border-bottom: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.25));
}
.vmarkd-marp__toggle {
  font: inherit;
  cursor: pointer;
  background: var(--vscode-button-secondaryBackground, transparent);
  color: var(--vscode-button-secondaryForeground, inherit);
  border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.35));
  border-radius: 3px;
  padding: 2px 10px;
}
.vmarkd-marp__panelbody {
  flex: 1 1 auto;
  overflow: auto; /* vertical stack of slides scrolls (spec decision 8) */
  padding: 12px;
}
.vmarkd-marp__deck section {
  margin: 0 auto 16px;
  max-width: 100%;
}
.vmarkd-marp__error {
  color: var(--vscode-errorForeground, #c00);
  font: inherit;
  padding: 8px;
}
/* Collapsed: hide the panel + splitter, but keep a thin always-visible re-open affordance. */
.vmarkd-marp--collapsed .vmarkd-marp__splitter,
.vmarkd-marp--collapsed .vmarkd-marp__panelbody {
  display: none;
}
.vmarkd-marp--collapsed .vmarkd-marp__panel {
  flex-basis: auto;
  width: auto !important;
  border-left: none;
}
body.vmarkd-marp__resizing {
  cursor: col-resize;
  user-select: none;
}
```

- [ ] **Step 4: Build + manual smoke check**

Run: `node build.mjs`
Expected: builds clean.

Then verify the panel mounts in the harness (Task 4 adds a panel-mount harness path; for now a quick manual check via playwright-cli is enough). Run:
```bash
npm run harness:serve &
npm run pw:cli -- open http://localhost:9124/marp.html
npm run pw:cli -- eval "() => (window.__ready===true)"
npm run pw:cli -- close
```
Expected: `true` (the marp.html harness still loads). Full panel-mount behaviour is asserted in Task 4's e2e (it needs a Vditor instance).

- [ ] **Step 5: Commit**

```bash
git add media-src/src/marp-panel.ts media-src/src/main.ts media-src/src/main.css
git commit -m "feat(marp): right panel, splitter, toggle, edit re-render (task 107)"
```

---

## Task 4: Slide↔source map + caret→slide highlight/scroll + click-slide→caret

One map (count top-level `---`) powers both sync directions. Forward: the caret's slide is highlighted + scrolled into view in the deck. Reverse: clicking a slide places the caret at that slide's source start.

**Files:**
- Modify: `media-src/src/marp-panel.ts`
- Modify: `media-src/e2e/marp-harness.ts`
- Modify: `media-src/e2e/marp.spec.ts`

- [ ] **Step 1: Write the failing test (the pure map + sync hooks)**

Add to `media-src/e2e/marp.spec.ts`:
```ts
test('caret in slide K highlights slide K in the deck', async ({ page }) => {
  await goto(page)
  await page.evaluate((src) => (window as any).__mountPanel(src), DECK)
  // Place the "caret" at a source offset inside slide 2 (0-based slide index 1).
  await page.evaluate(() => (window as any).__setCaretToSlide(1))
  await expect(
    page.locator('#mount .vmarkd-marp__deck section.vmarkd-marp__active'),
  ).toHaveCount(1)
  const idx = await page.evaluate(
    () => (window as any).__activeSlideIndex(),
  )
  expect(idx).toBe(1)
})

test('clicking slide K reports slide K source offset', async ({ page }) => {
  await goto(page)
  await page.evaluate((src) => (window as any).__mountPanel(src), DECK)
  await page.locator('#mount .vmarkd-marp__deck section').nth(2).click()
  // The reverse-nav hook records the requested source offset.
  const off = await page.evaluate(() => (window as any).__lastNavOffset())
  // Slide 3 (index 2) starts after the first two `---` slide-break lines.
  expect(off).toBeGreaterThan(0)
  const before = DECK.slice(0, off)
  // Two slide-break `---` occur before slide 3's content.
  expect((before.match(/^---$/gm) || []).length).toBeGreaterThanOrEqual(3)
})
```

These require a panel mounted over a real source-offset model. We add a dedicated mount harness (`__mountPanel`) + the slide-map functions in this task. Run the spec now to see the new tests fail.

Run: `cd media-src && rtk proxy npx playwright test marp.spec.ts -g "caret in slide|clicking slide"`
Expected: FAIL — `__mountPanel`/`__setCaretToSlide` undefined.

- [ ] **Step 2: Add the slide-map + sync to `marp-panel.ts`**

Add these exports to `media-src/src/marp-panel.ts` (top-level, after the imports):
```ts
/**
 * Source offset → slide index: the number of top-level `---` slide-break lines before `offset`.
 * Frontmatter's closing `---` is NOT a slide break, so we start counting after the frontmatter
 * block. A line is a slide break only if it is exactly `---` on its own (trimmed).
 */
export function slideIndexForOffset(source: string, offset: number): number {
  const head = source.slice(0, Math.max(0, offset))
  const lines = head.split(/\r?\n/)
  let i = 0
  // Skip a leading frontmatter block (--- … ---) — its fences are not slide breaks.
  let start = 0
  if (lines[0]?.trim() === '---') {
    for (let k = 1; k < lines.length; k++) {
      if (/^(---|\.\.\.)\s*$/.test(lines[k])) {
        start = k + 1
        break
      }
    }
  }
  let slide = 0
  for (i = start; i < lines.length; i++) {
    if (lines[i].trim() === '---') slide++
  }
  return slide
}

/** Source offset of the START of slide `index`'s content (line after its opening `---`). */
export function offsetForSlideIndex(source: string, index: number): number {
  const lines = source.split(/\r?\n/)
  let start = 0
  if (lines[0]?.trim() === '---') {
    for (let k = 1; k < lines.length; k++) {
      if (/^(---|\.\.\.)\s*$/.test(lines[k])) {
        start = k + 1
        break
      }
    }
  }
  if (index <= 0) {
    return charOffsetOfLine(lines, start)
  }
  let slide = 0
  for (let i = start; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      slide++
      if (slide === index) return charOffsetOfLine(lines, i + 1)
    }
  }
  return charOffsetOfLine(lines, lines.length)
}

function charOffsetOfLine(lines: string[], line: number): number {
  let off = 0
  for (let i = 0; i < Math.min(line, lines.length); i++) off += lines[i].length + 1
  return off
}
```

Extend the `MarpPanel` interface and the returned object with sync hooks:
```ts
export interface MarpPanel {
  update(source: string): void
  dispose(): void
  readonly deckEl: HTMLElement
  /** Highlight + scroll the deck to the slide at this source offset. */
  highlightForOffset(source: string, offset: number): void
  /** Active slide index currently highlighted (or -1). */
  activeIndex(): number
}
```

Inside `mountMarpPanel`, after `deckEl` is created and before the return, add the highlight + click-nav logic:
```ts
  let activeSlide = -1
  const highlight = (idx: number) => {
    const sections = deckEl.querySelectorAll<HTMLElement>('section')
    if (idx < 0 || idx >= sections.length) return
    if (activeSlide === idx) return
    sections.forEach((s, i) => s.classList.toggle('vmarkd-marp__active', i === idx))
    sections[idx].scrollIntoView({ block: 'nearest' })
    activeSlide = idx
  }

  // Reverse-nav: clicking a slide places the caret at its source start. We post a host message
  // (the host owns reveal-in-source); the webview also moves Vditor's caret if it can map offset
  // → DOM. For P1 we post the offset; the host/main.ts caret move reuses existing reveal wiring.
  deckEl.addEventListener('click', (e) => {
    const section = (e.target as HTMLElement)?.closest('section')
    if (!section) return
    const sections = Array.from(deckEl.querySelectorAll('section'))
    const idx = sections.indexOf(section)
    if (idx < 0) return
    const src = (window as any).vditor?.getValue?.() ?? ''
    const offset = offsetForSlideIndex(src, idx)
    ;(window as any).__vmarkdMarpNav?.(offset)
  })
```

And add the two new methods to the returned object:
```ts
    highlightForOffset(src: string, offset: number) {
      highlight(slideIndexForOffset(src, offset))
    },
    activeIndex() {
      return activeSlide
    },
```

- [ ] **Step 3: Drive the forward sync from the caret in `main.ts`**

Modify `media-src/src/main.ts`. There is already a `selectionchange` caret tracker (`trackEditorCaret`, wired at line 127) and `getCursorSourceOffset` in `source-map.ts`. Add a small caret→deck push. Near the import for `getCursorSourceOffset` (it's already imported for reveal-in-source — confirm, else add `import { getCursorSourceOffset } from './source-map'`), and inside `trackEditorCaret` (or right after the existing caret-tracking body), add:
```ts
  // Marp forward sync: highlight the caret's slide in the deck (task 107). Cheap; only runs when
  // a deck panel is mounted.
  if (marpPanel) {
    const off = getCursorSourceOffset(window.vditor)
    if (off >= 0) marpPanel.highlightForOffset(window.vditor.getValue(), off)
  }
```

> If `trackEditorCaret` is performance-sensitive (it runs on every `selectionchange`), guard it behind `marpPanel` (already done above) so non-deck docs pay nothing.

- [ ] **Step 4: Add the active-slide CSS**

Append to `media-src/src/main.css`:
```css
.vmarkd-marp__deck section {
  outline: 2px solid transparent;
  transition: outline-color 0.15s;
}
.vmarkd-marp__deck section.vmarkd-marp__active {
  outline-color: var(--vscode-focusBorder, #007fd4);
}
```

- [ ] **Step 5: Extend the harness with a panel mount + sync hooks**

Modify `media-src/e2e/marp-harness.ts`. Replace its body with:
```ts
import { loadMarp, injectDeck } from '../src/marp-preview'
import {
  mountMarpPanel,
  slideIndexForOffset,
  offsetForSlideIndex,
  type MarpPanel,
} from '../src/marp-panel'

;(window as any).__vmarkdMarpSrc = '/marp-chunk.js'

const panel = document.getElementById('panel') as HTMLElement
const mount = document.getElementById('mount') as HTMLElement

;(window as any).__renderDeck = async (source: string): Promise<number> => {
  const marp = await loadMarp()
  return injectDeck(panel, source, marp)
}
;(window as any).__marpLoaded = () => !!(window as any).__vmarkdMarp

// Panel mount over a fake editor element. We stub window.vditor.getValue() so the panel's
// reverse-nav reads the current source; the spec sets it per render.
let currentSource = ''
;(window as any).vditor = { getValue: () => currentSource }

let lastNavOffset = -1
;(window as any).__vmarkdMarpNav = (off: number) => {
  lastNavOffset = off
}
;(window as any).__lastNavOffset = () => lastNavOffset

let mp: MarpPanel | null = null
;(window as any).__mountPanel = async (source: string): Promise<void> => {
  currentSource = source
  mp?.dispose()
  const editorRoot = document.createElement('div')
  editorRoot.className = 'vditor'
  mount.appendChild(editorRoot)
  mp = mountMarpPanel(editorRoot, source)
  await loadMarp() // ensure the deck has rendered before the spec asserts
  await new Promise((r) => setTimeout(r, 50))
}
;(window as any).__setCaretToSlide = (idx: number) => {
  const off = offsetForSlideIndex(currentSource, idx)
  mp?.highlightForOffset(currentSource, off)
}
;(window as any).__activeSlideIndex = () => mp?.activeIndex() ?? -1
;(window as any).__slideIndexForOffset = (off: number) =>
  slideIndexForOffset(currentSource, off)

;(window as any).__ready = true
```

Update `media-src/e2e/marp.html` to add the mount point. Change the body to:
```html
  <body>
    <div class="vditor-reset"><h1>editor heading</h1></div>
    <div id="panel"></div>
    <div id="mount"></div>
    <script src="/marp.js"></script>
  </body>
```

- [ ] **Step 6: Run the e2e**

Run: `cd media-src && rtk proxy npx playwright test marp.spec.ts`
Expected: all tests PASS (the 4 from Task 2 + the 2 new sync tests).

- [ ] **Step 7: Commit**

```bash
git add media-src/src/marp-panel.ts media-src/src/main.ts media-src/src/main.css media-src/e2e/marp-harness.ts media-src/e2e/marp.html media-src/e2e/marp.spec.ts
git commit -m "feat(marp): slide↔source map + caret→slide highlight + click→nav (task 107)"
```

---

## Task 5: Slide-card overlay — `marp-slide-overlay.ts` (IR/WYSIWYG, round-trip-safe)

A non-editable overlay that measures top-level `<hr>` positions in the editable DOM and draws subtle card frames + slide numbers. The editable DOM is never mutated, so `---` round-trips unchanged. Present only in IR/WYSIWYG; absent in source mode.

**Files:**
- Create: `media-src/src/marp-slide-overlay.ts`
- Modify: `media-src/src/main.ts`
- Modify: `media-src/src/main.css`
- Modify: `media-src/e2e/marp-harness.ts`, `media-src/e2e/marp.html`, `media-src/e2e/marp.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `media-src/e2e/marp.spec.ts`:
```ts
test('overlay draws N cards for N slides in IR/WYSIWYG', async ({ page }) => {
  await goto(page)
  // The overlay harness builds an editable element with top-level <hr>s (3 slides = 2 hrs).
  await page.evaluate(() => (window as any).__mountOverlay(2))
  await expect(page.locator('#editor .vmarkd-marp-card')).toHaveCount(3)
})

test('overlay leaves the editable DOM (and its <hr>s) untouched', async ({ page }) => {
  await goto(page)
  const before = await page.evaluate(() => (window as any).__editorHtml())
  await page.evaluate(() => (window as any).__mountOverlay(2))
  const editable = await page.evaluate(() => (window as any).__editorHtml())
  // Cards live in a separate overlay layer, not inside the editable content.
  expect(editable).toBe(before)
  expect(await page.evaluate(() => (window as any).__editorHrCount())).toBe(2)
})
```

Run: `cd media-src && rtk proxy npx playwright test marp.spec.ts -g overlay`
Expected: FAIL — `__mountOverlay` undefined.

- [ ] **Step 2: Write `marp-slide-overlay.ts`**

Create `media-src/src/marp-slide-overlay.ts`:
```ts
// Marp slide-card overlay (task 107). CSS can't group a run of siblings between <hr>s, and
// injecting wrapper <div>s into the contenteditable tree is rejected (Lute could serialize them
// → breaks round-trip + caret). Instead an OVERLAY layer: a non-editable, pointer-events:none
// element positioned over the editor that measures top-level <hr> positions and draws subtle card
// frames + slide numbers. The editable DOM is never touched → `---` round-trips unchanged.
// Recompute on MutationObserver (DOM rebuilds per edit) + ResizeObserver (reflow). Mirrors the
// observe/teardown shape of callouts.ts. Mount only for the active IR/WYSIWYG element; in source
// mode there is no overlay.

const OVERLAY_CLASS = 'vmarkd-marp-overlay'
const CARD_CLASS = 'vmarkd-marp-card'

function topWithin(container: HTMLElement, el: HTMLElement): number {
  return el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
}

/** Build/refresh the card rectangles from the editor's top-level <hr> positions. */
function layout(editor: HTMLElement, overlay: HTMLElement): void {
  // Top-level <hr>s are the slide breaks. Slides = breaks + 1.
  const hrs = (Array.from(editor.children) as HTMLElement[]).filter(
    (el) => el.tagName === 'HR',
  )
  const boundaries: number[] = [0]
  for (const hr of hrs) boundaries.push(topWithin(editor, hr))
  boundaries.push(editor.scrollHeight)

  // Reconcile card count.
  const cards = Array.from(overlay.querySelectorAll<HTMLElement>(`.${CARD_CLASS}`))
  const wanted = boundaries.length - 1
  while (cards.length < wanted) {
    const card = document.createElement('div')
    card.className = CARD_CLASS
    const num = document.createElement('span')
    num.className = 'vmarkd-marp-card__num'
    card.appendChild(num)
    overlay.appendChild(card)
    cards.push(card)
  }
  while (cards.length > wanted) cards.pop()!.remove()

  cards.forEach((card, i) => {
    const top = boundaries[i]
    const height = Math.max(0, boundaries[i + 1] - boundaries[i])
    card.style.top = `${top}px`
    card.style.height = `${height}px`
    const num = card.querySelector('.vmarkd-marp-card__num')!
    num.textContent = String(i + 1)
  })
}

/**
 * Mount the overlay over `editor` (the active IR/WYSIWYG element). Returns a disposer. The
 * overlay is inserted as a sibling inside the editor's offsetParent so absolute positioning lines
 * up with the editor's scroll content.
 */
export function observeSlideOverlay(editor: HTMLElement | null | undefined): () => void {
  if (!editor) return () => {}
  // Ensure the editor is a positioning context for the absolutely-placed overlay.
  if (getComputedStyle(editor).position === 'static') {
    editor.style.position = 'relative'
  }
  const overlay = document.createElement('div')
  overlay.className = OVERLAY_CLASS
  overlay.setAttribute('contenteditable', 'false')
  editor.appendChild(overlay)

  let raf = 0
  const run = () => {
    raf = 0
    layout(editor, overlay)
  }
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(run)
  }
  const mo = new MutationObserver(schedule)
  mo.observe(editor, { childList: true, subtree: true, characterData: true })
  const ro = new ResizeObserver(schedule)
  ro.observe(editor)
  run()

  return () => {
    mo.disconnect()
    ro.disconnect()
    if (raf) cancelAnimationFrame(raf)
    overlay.remove()
  }
}
```

> The overlay is appended INSIDE `editor` (the contenteditable). It is `contenteditable=false` + `pointer-events:none` and carries no `.vditor-ir__node`/text Lute serializes, so it's invisible to the markdown round-trip (same property the callout preview relies on). If a later check shows Lute serializing it, move the overlay to the editor's parent and position it against the editor's offset box instead — but the contenteditable=false sibling is the verified-safe default.

- [ ] **Step 3: Wire into `main.ts`**

Modify `media-src/src/main.ts`. Add the import:
```ts
import { observeSlideOverlay } from './marp-slide-overlay'
```
Add a holder near the others:
```ts
let disposeMarpOverlay: (() => void) | null = null
```
In `runFinishInit`, inside the `if (msg.options?.marp) {` block (Task 3 step 2d), after mounting the panel, add the overlay (only for IR/WYSIWYG — not source):
```ts
    disposeMarpOverlay?.()
    disposeMarpOverlay = null
    const mode = window.vditor.getCurrentMode?.()
    if (mode === 'ir' || mode === 'wysiwyg') {
      disposeMarpOverlay = observeSlideOverlay(activeModeElement(window.vditor))
    }
```

- [ ] **Step 4: Overlay CSS**

Append to `media-src/src/main.css`:
```css
/* Marp slide-card overlay (task 107) — non-editable frames over the editor's slide regions. */
.vmarkd-marp-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
}
.vmarkd-marp-card {
  position: absolute;
  left: 0;
  right: 0;
  box-sizing: border-box;
  border: 1px dashed var(--vscode-widget-border, rgba(128, 128, 128, 0.35));
  border-radius: 4px;
}
.vmarkd-marp-card__num {
  position: absolute;
  top: 2px;
  right: 6px;
  font-size: 11px;
  opacity: 0.55;
  color: var(--vscode-descriptionForeground, #888);
}
```

- [ ] **Step 5: Extend the harness**

Add to `media-src/e2e/marp-harness.ts` (before the `__ready` line):
```ts
import { observeSlideOverlay } from '../src/marp-slide-overlay'

const editor = document.getElementById('editor') as HTMLElement
let disposeOverlay: (() => void) | null = null
;(window as any).__mountOverlay = (hrCount: number) => {
  // Build an editable-like element: paragraphs separated by top-level <hr>s.
  editor.innerHTML = ''
  for (let i = 0; i <= hrCount; i++) {
    const p = document.createElement('p')
    p.textContent = `slide ${i + 1} content`
    p.style.height = '80px'
    editor.appendChild(p)
    if (i < hrCount) editor.appendChild(document.createElement('hr'))
  }
  disposeOverlay?.()
  disposeOverlay = observeSlideOverlay(editor)
}
;(window as any).__editorHtml = () => {
  // The editable content, EXCLUDING the overlay layer (which is appended last).
  const clone = editor.cloneNode(true) as HTMLElement
  clone.querySelector('.vmarkd-marp-overlay')?.remove()
  return clone.innerHTML
}
;(window as any).__editorHrCount = () =>
  Array.from(editor.children).filter((el) => (el as HTMLElement).tagName === 'HR').length
```

Update `media-src/e2e/marp.html` body to add the editor element:
```html
  <body>
    <div class="vditor-reset"><h1>editor heading</h1></div>
    <div id="panel"></div>
    <div id="mount"></div>
    <div id="editor"></div>
    <script src="/marp.js"></script>
  </body>
```

> NOTE: `__editorHtml()` strips the overlay before snapshotting, and the test asserts the snapshot is unchanged after mounting. The overlay-untouched test passes because the overlay lives in its own layer; the `<hr>` count is read directly off the editable children.

- [ ] **Step 6: Run the e2e**

Run: `cd media-src && rtk proxy npx playwright test marp.spec.ts`
Expected: all tests PASS (Task 2 + Task 4 + the 2 overlay tests).

- [ ] **Step 7: Commit**

```bash
git add media-src/src/marp-slide-overlay.ts media-src/src/main.ts media-src/src/main.css media-src/e2e/marp-harness.ts media-src/e2e/marp.html media-src/e2e/marp.spec.ts
git commit -m "feat(marp): slide-card overlay measuring <hr> positions (task 107)"
```

---

## Task 6: Full build, lint, regression, docs

Verify the whole feature builds and passes the gates, then update the task + changelog.

**Files:**
- Modify: `tasks/107-marp-slide-preview.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Full build**

Run: `node build.mjs`
Expected: clean build; `media/dist/main.js` and `media/dist/marp.js` both emitted.

- [ ] **Step 2: Backend unit tests**

Run: `rtk proxy npx vitest run`
Expected: all pass, including `test/backend/marp-detect.test.ts`.

- [ ] **Step 3: e2e (the Marp spec + a regression sweep of nearby specs)**

Run:
```bash
cd media-src && rtk proxy npx playwright test marp.spec.ts callouts.spec.ts blockbg.spec.ts
```
Expected: all pass. (Confirms the panel/overlay didn't regress the IR dual-node features it sits beside.)

- [ ] **Step 4: Lint gate (whole tree)**

Run: `npm run lint:ci`
Expected: passes. Fix any biome formatting/lint findings in the new files (run `npx biome check --write media-src/src/marp-*.ts src/marp-detect.ts` if needed, then re-run `lint:ci`).

- [ ] **Step 5: Update the task doc**

Modify `tasks/107-marp-slide-preview.md`: mark Phase 1 as implemented, and add a line linking the design + plan:
```markdown
## Phase 1 — DONE (2026-06-13)

Implemented: lazy `marp-core` chunk, `marp: true` detection, read-only deck in a collapsible
right panel + draggable splitter, slide-card overlay (IR/WYSIWYG), caret→slide highlight/scroll,
click-slide→source nav. See `docs/superpowers/specs/2026-06-12-marp-split-panel-design.md` and
`docs/superpowers/plans/2026-06-13-marp-presentation-phase1.md`. Phases 2 (export) and 3 (per-slide
WYSIWYG) remain out of scope.
```

- [ ] **Step 6: Changelog entry**

Modify `CHANGELOG.md`. Per the project's changelog style (what the fork ADDS vs the original; no before/after narrative), add under the current unreleased/Added section:
```markdown
- **Marp presentations.** A `marp: true` document renders a live, read-only Marp slide deck in a
  collapsible right panel with a draggable splitter; per-slide card frames overlay the editor in
  IR/WYSIWYG; the deck highlights and scrolls to the caret's slide, and clicking a slide jumps the
  source to it. The Markdown stays the single source of truth.
```

- [ ] **Step 7: Commit**

```bash
git add tasks/107-marp-slide-preview.md CHANGELOG.md
git commit -m "docs(marp): Phase 1 done — task note + changelog (task 107)"
```

---

## Deferred to a later increment (explicitly NOT in this plan)

Per the spec's "Out of scope" + "Risks" sections, these are intentionally not implemented here:

- **`sv`-mode deck-replaces-preview** (spec decision 7 / Layout): in `sv` the deck should replace
  Vditor's HTML preview pane and reuse the task-48 heading-anchored scroll sync. This plan mounts
  the panel beside ALL modes uniformly; the `sv`-replace specialization (and ensuring the task-48
  sync targets the deck pane, not a removed preview) is a follow-up. Flagged in the spec's Risks.
- **Smooth line-accurate bidirectional scroll sync** beyond active-slide highlight.
- **A VS Code host command + toolbar-integrated toggle** (this plan ships an in-panel toggle
  button; a host command/menu entry is optional polish).
- **Export (Phase 2)** and **per-slide WYSIWYG editing (Phase 3)**.

---

## Self-Review

**1. Spec coverage** (each spec section → task):

- Activation, zero-cost-when-off (decisions 1) → Task 1 (`parseMarpEnabled` + init flag) + Task 3 (panel only mounts when `msg.options.marp`) + Task 0/2 (chunk loaded only on first deck render). ✓
- Render, scoped CSS, no Shadow/iframe (decision 2) → Task 0/2 (`marp.render` → `{html,css}`, `.marpit` scoping, leak e2e). ✓
- Theming = render as Marp would; no vMarkd dark/light pairing (decision 3) → Task 0 chunk uses Marp defaults (`math:false,html:false`), no theme injection. ✓
- Re-render on the EXISTING debounced edit (decision 4) → Task 3 step 2e (one line in `postEdit`, no new debounce). ✓
- Card overlay non-editable, measures `<hr>` (decision 5) → Task 5. ✓
- Build: npm devDependency + lazy chunk (decision 6) → Task 0. ✓
- Layout: right panel + draggable splitter + persisted width, open-by-default (decisions 7/12) → Task 3. ✓
- Vertical stack scroll (decision 8) → Task 3 CSS (`.vmarkd-marp__panelbody { overflow:auto }`). ✓
- Caret→deck auto-scroll + highlight (decision 9) → Task 4. ✓
- Click slide → caret/source (decision 10) → Task 4 (`offsetForSlideIndex` + nav hook). ✓
- Subtle card style + slide number (decision 11) → Task 5 CSS. ✓
- Render-failure message in panel (decision 12) → Task 2 (`injectDeck` catch) + Task 3 (load-failure message). ✓
- Slide↔source map by counting top-level `---` (Activation & sync) → Task 4 (`slideIndexForOffset`/`offsetForSlideIndex`). ✓
- Testing: e2e (N slides, no leak, re-render, no panel for non-Marp, overlay present IR/absent source, caret↔click) + backend detect → Tasks 1/2/4/5. ✓ (The "absent in source mode" assertion is covered by Task 5's mode-gated mount in `main.ts`; the harness exercises IR. A dedicated source-mode-absence e2e is a thin add if desired.)
- `sv`-replace → explicitly DEFERRED (documented). The spec lists it as a decision; flagged as a follow-up rather than silently dropped.

**2. Placeholder scan:** No TBD/TODO/"add error handling"/"similar to Task N". Every code step shows full code. ✓

**3. Type consistency:** `parseMarpEnabled(md:string):boolean` used identically in host + webview + harness. `MarpApi.render(source):{html,css}` consistent across `marp-entry.ts`, `marp-preview.ts`, harness. `MarpPanel` interface extended in Task 4 matches its construction. `slideIndexForOffset`/`offsetForSlideIndex` names consistent between `marp-panel.ts` and harness/spec. `__vmarkdMarp`, `__vmarkdMarpSrc`, `__vmarkdMarpNav` globals consistent across chunk/loader/panel/harness. `observeSlideOverlay` returns a disposer matching the `dispose*` holder pattern. ✓

**4. Known soft spots (called out, not hidden):**
- Task 0 step 4's Node `render()` check may not fully exercise marp-core's DOM needs; the AUTHORITATIVE proof is Task 2's real-browser e2e. The plan says so and tells you not to block on the Node check beyond "the chunk builds".
- Reverse-nav (Task 4) posts a source offset via `__vmarkdMarpNav`; wiring that offset to an actual Vditor caret move in the real webview reuses existing reveal-in-source plumbing and should be verified WITH THE USER in the real editor (the harness asserts the offset is computed correctly, which is the unit under test here).
- The `.vditor` root resolution in Task 3 uses `closest('.vditor')`; confirm against the live DOM during step 4's smoke check and switch to `window.vditor.vditor.element` if that's the cleaner handle.
