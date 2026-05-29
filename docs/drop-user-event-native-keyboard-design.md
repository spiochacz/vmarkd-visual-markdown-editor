# Design: replace @testing-library/user-event with native keyboard dispatch

Date: 2026-05-29

## Context

The webview bundle (`media-src`) pulls three libraries into the **shipped runtime** that are, by nature, testing utilities or transitive helpers:

- `@testing-library/user-event` — used at runtime in `fix-table-ir.ts` for its `keyboard()` helper, which simulates keypresses to trigger Vditor's table-editing hotkeys.
- `@testing-library/dom` — peer of `user-event`, dragged into the bundle.
- `@babel/runtime-corejs3` — pulled transitively (via `aria-query` ← `@testing-library/dom`); not imported directly.

This is an anti-pattern: a testing library shipped in production just to reuse one event-simulation helper. The goal is to replace `keyboard()` with a small native `KeyboardEvent` dispatch and drop all three runtime dependencies.

This is the fourth dependency cleanup after jQuery, jquery-confirm, lodash, and date-fns.

## Key findings

- Vditor matches these hotkeys in `matchHotKey` (vditor `dist/index.js:5594`) by reading **`event.key`** (case-insensitive), `shiftKey`, `altKey`, and `isCtrl(event)` (ctrl OR meta). It does **not** use `event.code` for the modifier hotkeys we need. So no key-code map is required.
- `user-event` dispatches via `@testing-library/dom`'s `fireEvent.keyDown` with props `{key, code, altKey, ctrlKey, metaKey, shiftKey, keyCode}`. We only need `key` + modifiers.
- The 9 table shortcuts are fixed and known, so the general-purpose parser/keymap in `user-event` is unnecessary. Vendoring `user-event`'s `keyboard` source from git was considered and rejected: it is ~512K of dist across multiple modules and still depends on `@testing-library/dom`. A ~15-line dispatcher replaces it entirely.
- Vditor's own repo tests in a **real browser** (Jest + Puppeteer), confirming that `contenteditable`/`Selection`-based editing cannot be faithfully tested in jsdom/happy-dom. We use Playwright for the same reason.

## Implementation

New module `media-src/src/table-hotkey.ts`, two units:

**`resolveShortcut(type, isMac)` — pure.** Maps the table-action `type` to `{ key, shift }`, faithfully reproducing the current `handleMap` strings, including platform-specific keys:

```ts
const SHORTCUTS = {
  left:  { key: 'l', shift: true },  center: { key: 'c', shift: true },
  right: { key: 'r', shift: true },  insertRowA: { key: 'f', shift: true },
  insertRowB: { key: '=', shift: false }, deleteRow: { key: '-', shift: false },
  insertColumnL: { key: 'g', shift: true },
  insertColumnR: { key: '+', macKey: '=', shift: true }, // non-mac '+', mac '='
  deleteColumn:  { key: '_', macKey: '-', shift: true }, // non-mac '_', mac '-'
}
// resolveShortcut -> { key: isMac && s.macKey ? s.macKey : s.key, shift: s.shift }
```

**`dispatchTableHotkey(el, type, isMac)` — thin DOM shell.**

```ts
const { key, shift } = resolveShortcut(type, isMac)
el.dispatchEvent(new KeyboardEvent('keydown', {
  key, shiftKey: shift, ctrlKey: !isMac, metaKey: isMac,
  bubbles: true, cancelable: true,
}))
```

Only `keydown` is dispatched (Vditor matches hotkeys on keydown).

**`fix-table-ir.ts`:** remove `handleMap` and the `keyboard(k, …)` call; in the icon-click handler call `dispatchTableHotkey(eventRoot, type, isMac)`. Preserve the `disableVscodeHotkeys` flag (set true → dispatch synchronously → reset in `finally`; no Promise wrapper). Remove the dead `import { keyboard }` from `utils.ts`.

## Testing — Playwright e2e (only)

End-to-end against real Chromium, mirroring how Vditor tests itself.

- **Harness** (`e2e/`): esbuild bundles `e2e/harness.ts` which imports `vditor` + our `fixTableIr`, creates a Vditor IR editor with a known table (`| a | b |\n|---|---|\n| 1 | 2 |`), points `cdn` at the local vditor dist, and exposes `window.vditorTest`. An `index.html` hosts it.
- **`playwright.config.ts`**: a `webServer` entry builds the harness and serves it on a port; `baseURL` points there.
- **Tests**: for each of the 9 actions — place the selection in a table cell, click the cell (reveals the table panel), click the icon, then `page.evaluate(() => window.vditorTest.getValue())` and assert the markdown changed (alignment markers `:---`, row/column inserted or removed).
- devDependency: `@playwright/test` (downloads Chromium); add a `test:e2e` script.

### TDD order (refactor-safe)

This is a refactor of working behavior. Write the e2e suite first against the **current** `keyboard()` code and confirm it is **green** (proving the tests capture the behavior). Then replace with the native dispatcher and confirm the suite is **still green**. A red after the swap means the synthetic event does not reach Vditor — fix the dispatcher.

## Dependency changes

- Remove from `media-src` runtime `dependencies`: `@testing-library/user-event`, `@testing-library/dom`, `@babel/runtime-corejs3`.
- Add `devDependency`: `@playwright/test`.

## Verification

`npm test` (existing node:test helpers) + `npm run test:e2e` (Playwright) green → esbuild build → confirm none of the three libs remain in `media/dist/main.js` → quick manual sanity in VS Code (IR mode, click table icons).

## Risks

- Faithful integration is proven only by the Playwright run; the manual VS Code sanity check stays mandatory before merge.
- Playwright adds a Chromium download (~150 MB) to the dev environment.
