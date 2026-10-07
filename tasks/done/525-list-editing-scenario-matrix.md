# Task 525 — List editing corner cases: scenario matrix + fixes

**Status:** ✅ DONE (2026-10-07) — #1–#7 fixed + tested; #8 (adjacent sub-lists of different kinds turn the item loose) left as a known Lute limitation (engine patch rejected). · **Impact:** 🔴 high (#1 loses data; #2 is the user's reported case)
· **Origin:** user report 2026-10-06: "nie działa edytowanie w listach … ciągle są corner cases …
jak jest lista w liście i zaczynam od końca usuwać to jak dochodzi do nadrzędnej listy to się psuje
formatowanie" (a list inside a list, deleting from the end, breaks the formatting once the deletion
reaches the parent list). Same report: numbered list → bullet sublist → delete the sublist → return
to the right numbered item.

## How it was measured

- `test/vscode-e2e/list-scenario-matrix-probe.spec.ts` (`@probe`): real VS Code, IR and WYSIWYG,
  25 scenarios. Records `getValue()`, caret context and DOM red flags (`li>p`, empty list) after
  EVERY keystroke, then writes `tmp/list-matrix/{ir,wysiwyg}.json`. Run:
  `VMARKD_PROBES=1 xvfb-run -a npx playwright test list-scenario-matrix-probe.spec.ts` in
  `test/vscode-e2e` (~3 min, both modes).
- `media-src/e2e/list-harness.ts` now takes `?md=<markdown>&mode=ir|wysiwyg`. The chromium harness
  reproduces every finding below, so it serves as the fast iteration loop.
- **IR and WYSIWYG behave identically on every scenario.** All the faulty logic is shared (Vditor's
  `fixList` + our `list-backspace.ts`), not mode-specific.

## Findings

### 1. 🔴 DATA LOSS — Backspace at the start of an item whose previous sibling has a sublist

```
1. one          caret at |two, Backspace        1. one
   - aaa        ───────────────────────►           - aaa
2. |two                                              
3. three                                             two     ← glued into aaa's item
                                                 ("3. three" is GONE)
```

Our `liftTopLevelItemToParagraph` (list-backspace.ts) is called correctly and builds correct HTML
(`VditorIRDOM2Md` of it = `"1. one\n   - aaa\n\ntwo\n\n1. three\n"`). The corruption comes from
**Lute**: when the caret marker sits at the very START of a paragraph that directly follows a list
ending in a nested list, Lute mis-parses it. Measured directly:
`Md2VditorIRDOM("1. one\n   - aaa\n\n‸two\n\n1. three\n")` puts `two` inside `aaa`'s `<li>` and
drops `1. three`. Without the caret marker, or with it mid-word (`t‸wo`), the output is correct, and
a flat previous item (no sublist) is unaffected. `SpinVditorDOM` (WYSIWYG) shows the same bug.
Fix direction: spin WITHOUT `<wbr>`, then place the caret on the new `<p>` explicitly.

### 2. 🔴 The reported case — Backspace on an EMPTY item after an item with a sublist

```
1. one                       Backspace on empty 3.  → caret lands at end of "two" (not "bbb")
2. two                       next Backspace          → list goes LOOSE: blank line, <li><p>
   - aaa                     typing                  → text lands in a new loose paragraph
   - bbb
3. |
```

Vditor's `fixList` "空列表删除后与上一级段落对齐" branch (`fixBrowserBehavior.ts:491-503`) appends
the TEXT `"\n\n"` to the end of the previous `<li>`, AFTER its nested `<ul>`, and puts the caret at
the end of that `<li>`. The caret then maps back to the parent's own text, and the stray `\n\n`
makes the next edit re-parse the item as loose.

### 3. 🟠 Backspace on ANY empty item (flat or nested): an off-by-one caret, a dead key, a soft break

Same branch as #2. After `1. one / 2. two / 3. |` + Backspace, the caret is at `tw|o` (inside the
`"two\n\n"` text node); the next Backspace does nothing visible, and typing straight away produces
`2. two\n   X` (a soft-break continuation line in item 2), not `2. twoX`.

### 4. 🟠 Outdent leaves stale numbering

Backspace at the start of a nested `- bbb` (outdent, via Vditor's `listOutdent`) gives `1. bbb`
under `2. two` instead of `3. bbb`. The outdented `<li>` keeps `data-marker="-"` inside the `<ol>`.
Shift+Tab has the same stale state, which only self-corrects on the next re-render (typing). Deleting
a middle item with #3's branch also leaves `1. aa / 3. cc` until the next keystroke.

### 5. 🟡 Typing a marker in an empty nested item adds a THIRD level

`1. one / 2. two / Enter / Tab / "- aaa"` gives `1. - aaa` (a bullet list inside the nested
ordered item), not a bullet sub-item. The same holds for `"1. "` inside a nested bullet. Ctrl+L
(`format.list`) converts correctly. This is very likely the user's path to "a bullet list under a
numbered list".

### 6. 🟡 Tab / Shift+Tab do nothing unless the caret is at the start of the item text

Vditor's Tab branch only indents/outdents when the caret is at offset 0 (or there is a selection).
With the caret at the end of `bbb`, Tab and Shift+Tab are no-ops.

### 7. 🟡 Enter at the end of an item that HAS a sublist moves the sublist to the new item

`1. one / - aaa / 2. two`, Enter at the end of `one` gives `2. - aaa` (an empty item whose only
content is the sublist, rendered on the marker line). After typing, `2. X / - aaa`. Google Docs gives
the same final structure. An outliner (Notion/Workflowy) would keep `aaa` under `one` instead.

## Works correctly (measured, keep as a net)

- Deleting character by character from the end through any nesting (ol>ul, ul>ul, ol>ol, ul>ol,
  3 levels, checklist>ul) when NO top-level item follows the sublist: tight list, correct numbering.
- Enter, Enter on an empty nested item outdents to the parent level and continues numbering (`3.`).
- Shift+Tab on an empty nested item, then typing, continues the parent numbering.
- Tab on an empty item creates a nested item; Ctrl+L converts a nested ordered item to bullets.
- Enter at the end of a parent's text after its sublist was deleted continues numbering.

## Decisions (user, 2026-10-06)

- #3 empty item → remove it, caret to the end of the line above (not Google-Docs outdent-first,
  not Typora's paragraph-in-previous-item).
- #5 typed marker in an empty item → switch that item's list kind; the same kind adds no level.
- #6 Tab / Shift+Tab act from anywhere in the item text.
- #7 (revised 2026-10-07) → Enter at the END of an item that has a sub-list adds a new EMPTY FIRST
  item to that sub-list (outliner style: Notion/Workflowy); the sub-list stays with its parent. A
  second Enter on that empty sub-item keeps Vditor's "outdent" (→ the Google-Docs shape).
- #8: patching Lute was tried and REJECTED by the user as too much work (see below).

## Implementation

- `patchFixListOutdent` (esbuild-shared.mjs): seam `window.__vmarkdListKeydown` moved BEFORE fixList's
  "\n\n" empty-item branch and widened to Tab; `listOutdent` re-spins `getTopList(...)` (#4, every
  caller). First-item gate kept.
- `list-backspace.ts`: `removeEmptyItem` (#2/#3), lift spins WITHOUT `<wbr>` and places the caret by
  position (#1, Lute bug), `tabInItem` + `caretOwnedByItem` guard (#6, code/table/quote keep Tab),
  `beforeinput` typed-marker conversion (#5). `asCaret`: the live selection here is often EMPTY but
  not `collapsed` (anchor at a text end, focus on the element boundary right after it) — measured in
  the real webview after End + a pause and while typing fast; checking `collapsed` made Tab escape
  the editor and the marker conversion miss. `respinListAtRange` shared with list-normalize.ts.
- #7: `enterInItem` / `enterSubListTarget` / `addFirstSubItem` (list-backspace.ts). To reach it before
  fixList's own loose-item Enter branch, the `__vmarkdListKeydown` seam now sits at the TOP of fixList's
  `if (liElement)` block (`handleListKeydown` returns false for everything it does not own, so the
  Backspace/Tab branches behave exactly as before — the whole chromium suite proves it).
- Each operation is one undo step (real-VS-Code Ctrl+Z scenarios).

## Verification (2026-10-06)

- RED before: chromium 50/60 red; real VS Code red in both modes on every scenario.
- GREEN: `media-src/e2e/list-scenarios.spec.ts` 62/62 (IR+WYSIWYG), list.spec + list-normalize +
  Tab/escape specs green; real VS Code `list-editing-scenarios` (+ undo, paced Tab) and the list
  regression set (list-backspace, list-enter-start, list-autoformat-space, list-tight, list-ops,
  list-normalize, list-enter-undo-caret, escape-toolbar) 11/11; `--repeat-each=3` 6/6.
- RED again, each fix disarmed separately (md5-verified restore): lift `<wbr>` → only the 6 lift
  scenarios; outdent rebind → only the 4 numbering scenarios; empty-item handler → 26 scenarios incl.
  every delete-from-end (and real VS Code: "press 7 made the list loose", the original signature);
  Tab → the 8 Tab scenarios; marker listener → the 6 marker scenarios; `collapsed` vs `toString()`
  in Tab (chromium, paced) and in beforeinput (real VS Code) → their scenarios.
- Two existing assertions encoded #4's stale number (`1. first entry` → `2. first entry`,
  list.spec.ts + list-tight.spec.ts).
- Coverage: unit covers the pure helpers; chromium e2e covers list-backspace.ts at 91% lines / 96%
  functions (uncovered: text-less target fallback, empty-paragraph lift, non-ir/wysiwyg bail, disposer).
- `npm test` 2969/2969, both typechecks, lint:ci, knip, jscpd, depcruise, coverage gates PASS.
  `npm run quality` FAILS only on `audit` (npm advisories in vitest/undici — unrelated to this task).

## Also done in this task

- **#7 Enter** (2026-10-07, implemented by a Sonnet agent, verified here): 4 chromium scenarios ×2
  modes + 1 real-VS-Code scenario; RED before, GREEN after, RED again with the branch disabled
  (chromium: exactly the 8 #7 runs; real VS Code: exactly #7 in IR + WYSIWYG).
- **`npm audit` → 0** in all three packages (root, media-src, test/vscode-e2e). Root only needed patch
  releases, no major: `undici`, `source-map-js`, `smol-toml` via `npm audit fix`, and `vitest` /
  `@vitest/coverage-v8` 4.1.8 → 4.1.11 (GHSA-82fw-gwwq-j7x9). `npm run quality`: all 9 stages PASS.

## Rejected: patching Lute (2026-10-06/07)

Tried for #8 and for #1's root cause; the user stopped it as too much work for the gain. What was
learned, so nobody repeats it:
- **#1 root cause** is Lute's Vditor #633 hack in `parse/blocks.go` `parseBlocks` (VditorIR/WYSIWYG
  parse options only): a caret-led line under an open list item is appended to the item and the loop
  `break`s — every later line is dropped. Turning `break` into `continue` crashes the next
  `incorporateLine` (stale parser context; nil dereference on the corpus). Our workaround (lift without
  a start-of-paragraph `<wbr>`, caret placed by position) stays.
- **#8 root cause** is two places: `isTightList` (`vditor_wysiwyg.go`) calls an item with MORE THAN ONE
  sub-list loose, and `FormatRenderer.renderList` always ends a list with a blank line.
- No GopherJS release (1.20.0/.1/.2 + go1.20.14) rebuilds the pinned `lute.min.js` byte-for-byte, so a
  real fix means string-patching the minified blob and re-deriving its anchors on every Lute re-pin.

## Still open

- [ ] **#8 — known limitation, not fixed.** Lute rewrites adjacent sub-lists of different kinds inside
      an item (`1. one\n   1. aaa\n   - x`) with blank lines between them, which makes the parent item
      loose. Pre-existing; rare. Also hits #5 when a marker is typed in the MIDDLE of a nested list.
- [x] #442's "big gaps" report — confirmed gone by the user 2026-10-07; 442 closed (done/).

## See also

- [428](428-list-editing-usability-vs-real-editors.md), [442](442-backspace-empty-list-item-loose.md)
  (an unreproduced "big gaps" report: #2/#3 are very likely its mechanism, since the `\n\n` branch makes
  lists loose), [461](461-list-tight-observer-retire.md), [462](462-list-backspace-into-fixlist-patch.md),
  [255](255-list-renumber-command.md) (`list-normalize.ts`, the renumber engine #4 can reuse).
