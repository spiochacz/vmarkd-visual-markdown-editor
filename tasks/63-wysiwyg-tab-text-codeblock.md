# Task: WYSIWYG — tab+text wrongly turns into a code block

> **Status:** 🅿️ PARKED (2026-06-05). Paste case done; remaining tab-indent case parked by
> decision (CommonMark-correct indented-code; suppressing it is a risky heuristic with little upside).
> **Paste (#1917/#1914):**
> ported PR #1921 — `processPasteCode` (`util/processCode.ts`) now decides code-block
> from **content** (`looksLikeCodeContent`: multi-line + ≥2 of braces/semicolons,
> code keywords, html tags, indentation; or a real `<pre><code>`) instead of IDE
> markers (VS Code monospace / single `<pre>` / Xcode `p1` / web-source table). Applied
> via esbuild `onLoad` (`patchProcessCode`/`fixProcessCode`, anchored slice + version
> guard); transform unit-tested + **e2e** (`media-src/e2e/wysiwyg-input.spec.ts`, the 4
> PR-#1921 cases). **Tab-indent case PARKED:** verified deterministically that a leading
> `\t`/4-spaces spins a paragraph into a code block inside Lute's `SpinVditorDOM` —
> i.e. **CommonMark-correct indented-code**. Suppressing it (the GongXunSS
> `isUnexceptCodeBlock` guard) is a heuristic with over-suppression risk and is hard to
> verify (Tab-key + input timing), so it's not pursued. Reopen if the tab UX is wanted.
> **Source (preferred):** upstream **PR #1921** (`Vanessa219/vditor`, open, unmerged) — "auto code-block detection: switch from IDE-source heuristic to actual-content heuristic", touches `src/ts/util/processCode.ts` **with a test** (`__test__/util/processCode.test.ts`). Fixes reported issues #1917 (paste HTML → forced code block) and #1914 (paste math → forced ```` ``` ````); also relates to #1924 (tab indent). Fallback source: `GongXunSS/vditor` `isUnexceptCodeBlock` guard in `wysiwyg/input.ts`.
> **Value / Risk:** 🟡 fixes a surprising content-corruption (paste/tab → forced code block) / medium (source patch). Verified still present in our `vditor@3.11.2` (evidence in Problem below).

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
1. **Reproduce first**: (a) in WYSIWYG, start a line, press Tab, type text; (b) paste HTML-containing markdown / a math formula (issues #1917/#1914) — confirm content is forced into a `vditor-wysiwyg__pre` code block in the serialized markdown.
2. **Preferred:** port **PR #1921**'s `processCode.ts` change — the auto-code-block detector keys off *actual content features* instead of IDE-source markers, so legitimate paste/tab content stays prose. Bring its test (`__test__/util/processCode.test.ts`) as a reference for our regression test.
   - Fallback (if #1921's diff doesn't cover the tab case): also port GongXunSS's guard before `blockElement.outerHTML = html` at `wysiwyg/input.ts:148` (skip conversion when the spun `html` matches `vditor-wysiwyg__pre` but the previous html had no ```` ``` ```` fence).
3. Apply via the esbuild `onLoad` patch mechanism in `media-src/esbuild-shared.mjs` (same pattern as `fixDmpInterop` / task 56), with an anchored string replace + a version-mismatch guard that throws. (Repo is dormant since 2026-02, so #1921 won't land upstream — we vendor it.)
4. Confirm intentional code blocks (```` ``` ````-fenced, or the code toolbar button) are unaffected, and that pasting actual code still becomes a code block.

## See also
- `media-src/esbuild-shared.mjs` (patch precedent), `tasks/56-vditor-listtoggle-bugfixes.md` (same mechanism).
- Reference: GongXunSS `feat-vscode` added an `isUnexceptCodeBlock` guard before `blockElement.outerHTML = html` in `src/ts/wysiwyg/input.ts`.

## Reported upstream (repro + verify these — fixed by PR #1921)
- Vditor **#1917** — paste of HTML-containing markdown forced into a code block. **Manifests:** copy markdown that includes raw HTML (the reporter's case: a pandas-export block with `<div><style scoped>…`) and Ctrl+V into the editor → the **whole pasted block is force-converted to a code block** (all three modes). https://github.com/Vanessa219/vditor/issues/1917
- Vditor **#1914** — pasting math auto-adds a ```` ``` ```` fence. **Manifests:** paste text like `设 $2(z+\bar{z})…=4+6i$ , 则 $z=(\quad)$ .` → the editor wraps it in a ``` code fence, so the math renders as **raw `$…$` string** instead of a formula; the user has to manually delete the fence. https://github.com/Vanessa219/vditor/issues/1914
- Vditor **#1924** — tab indent inside a code block uses the wrong width. **Manifests:** editing e.g. Python in a code block, pressing Tab inserts a **single too-wide character** rather than a 4-space indent, so indentation looks wrong/misaligned. https://github.com/Vanessa219/vditor/issues/1924
- (Source PR for the fix: **#1921**, with `__test__/util/processCode.test.ts`.)

## Verify
Tab+text in WYSIWYG stays a paragraph; ```` ``` ````-fenced and toolbar-inserted code blocks still work; build's patch-guard throws on a Vditor version mismatch. Add a regression test if feasible.
