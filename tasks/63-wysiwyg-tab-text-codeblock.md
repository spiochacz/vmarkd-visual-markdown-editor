# Task: WYSIWYG — tab+text wrongly turns into a code block

> **Status:** ⬜ Not started.
> **Source:** `GongXunSS/vditor` (`feat-vscode`) — `isUnexceptCodeBlock` guard. Verified still present in our `vditor@3.11.2`. See bug-hunt addendum.
> **Value / Risk:** 🟡 fixes a surprising content-corruption in WYSIWYG / medium (source patch + needs careful guard)

## Problem
In WYSIWYG, typing a leading tab (`\t`) before text can spin the block into a code block. `wysiwyg/input.ts:148` assigns the Lute-spun HTML unconditionally:
```ts
} else {
    blockElement.outerHTML = html;  // :148 — html from vditor.lute.SpinVditorDOM(html) at :142, no guard
```
There is **no** `isUnexceptCodeBlock`-style guard anywhere in our vendored tree (grep `isUnexceptCodeBlock` = 0 hits). Lute spins `\t`+text into a `vditor-wysiwyg__pre` code block and it's committed, so the user's paragraph silently becomes code.

## Goal
A leading tab in a normal paragraph stays a paragraph (or indents), and does not silently convert to a code block in WYSIWYG.

## Steps
1. **Reproduce first**: in WYSIWYG, start a line, press Tab, type text — confirm it becomes a `vditor-wysiwyg__pre` code block in the serialized markdown.
2. Port GongXunSS's guard: before `blockElement.outerHTML = html` at `wysiwyg/input.ts:148`, detect the unintended-code-block case (the spun `html` matches `vditor-wysiwyg__pre` while the *previous* html had no ```` ``` ```` fence) and skip the conversion (keep the paragraph / apply indentation instead).
3. Apply via the esbuild `onLoad` patch mechanism in `media-src/esbuild-shared.mjs` (same pattern as `fixDmpInterop` / task 56), with an anchored string replace + a version-mismatch guard that throws.
4. Confirm intentional code blocks (```` ``` ````-fenced, or the code toolbar button) are unaffected.

## See also
- `media-src/esbuild-shared.mjs` (patch precedent), `tasks/56-vditor-listtoggle-bugfixes.md` (same mechanism).
- `out/vditor-forki-analiza.md` §3c (GongXunSS `input.ts` guard).

## Verify
Tab+text in WYSIWYG stays a paragraph; ```` ``` ````-fenced and toolbar-inserted code blocks still work; build's patch-guard throws on a Vditor version mismatch. Add a regression test if feasible.
