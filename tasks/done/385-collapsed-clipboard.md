# 385 — Ctrl+C / Ctrl+X with nothing selected

**Status: ✅ DONE (2026-08-11).** Collapsed copy and cut now match VS Code: Ctrl+C copies and
Ctrl+X removes the current Markdown block.

**Impact:** 🔴 high (this is the reported "copy/paste doesn't work") · **Origin:** user report
2026-07-27; both defects were probe-confirmed a month earlier in task 191 and left in place.

## What the user reported, and what it turned out to be

"copy paste doesn't work for me", with no further detail. The basic mechanism turned out to be
FINE — every one of these was verified working in a real VS Code before anything was changed:
plain Ctrl+C/Ctrl+X/Ctrl+V, pasting rich HTML from a browser (`<strong>` → `**bold**`,
`<a href>` → `[link](url)`), pasting HTML with no `text/plain` fallback, pasting multi-line
markdown, copying a multi-block selection (the clipboard gets real markdown SOURCE, not DOM text),
pasting into a fenced code block, and pasting into a table cell.

What was broken is the **collapsed caret** — no selection. Task 191 had already probe-confirmed
both cases (`media-src/e2e/copy-cut-probes.spec.ts`, PROBE-14/15) and pinned them as current
behaviour, explicitly deferring the fix as "a product decision":

1. **Ctrl+C did nothing** in IR and WYSIWYG, and in split mode it **WIPED the clipboard**. `sv`'s
   copy handler writes `getSelectText(...)` to `text/plain` with no empty-selection guard, so an
   empty selection sets it to `""`. Copy, then paste, and nothing comes back — which is exactly
   what "copy/paste doesn't work" describes.
2. **Ctrl+X was a stealth backspace.** `cutEvent` runs `document.execCommand("delete")`
   unconditionally, even when the copy half early-returned, so it silently ate the character
   before the caret.

The decision, taken because the user asked for copy/paste to be fixed and was not available to
consult: **a VS Code editor should behave like VS Code**, where a collapsed Ctrl+C copies the
current line.

## Why the expansion runs on KEYDOWN

The obvious place — Vditor's copy handler — cannot work: **with a collapsed selection Chromium does
not dispatch a `copy` event at all.** There is nothing to copy, so the browser never asks, and no
handler runs. This was measured, not assumed: the first implementation expanded inside the copy
handler and the clipboard came back empty. Expanding in a capture-phase `keydown`, before the
browser decides, turns the keystroke into an ordinary copy of a real selection, and every
downstream handler — Vditor's markdown serializer included — behaves normally.

"Line" means the containing BLOCK (paragraph, heading, list item, blockquote, table row, code
block), which is the markdown analogue of a VS Code source line: a soft-wrapped paragraph is one
line of markdown however many rows it occupies on screen. Note the consequence — a paragraph with a
soft line break copies BOTH of its lines, because they are one block.

## Line-cut follow-up — completed 2026-08-11

Task 387 replaced Vditor's deferred `execCommand("delete")` with synchronous
`Range.deleteContents()` plus its input pipeline. That removed the old selection-collapse race, so
collapsed Ctrl+X can now expand to the current block before Vditor copies and deletes it. A real
VS Code regression test proves the complete block is removed with no leftover fragment.

## The element matrix — RUN, and it clears the editor

`clipboard-elements.spec.ts` (23 tests, ~4 min, one VS Code boot per test) walks copy and paste
across every element the fixture contains. **All 23 pass.** Copy puts real markdown SOURCE on the VS
Code clipboard for heading, bold, italic, inline code, link, bullet list, ordered list, blockquote,
table, fenced code, indented code, callout and math block; paste turns markdown back into the
element for all ten paste cases, with the rest of the document intact.

The first run reported 5 failures — **all five were bugs in this spec, not in the editor**, and the
distinction was settled by measurement rather than by argument. A throwaway probe ran the exact
serialization Vditor's IR copy handler runs (`VditorIRDOM2Md` of `range.cloneContents()`) against
three selection strategies and printed the result for each element:

| selection | heading | bold | link |
| --- | --- | --- | --- |
| `selectNodeContents(innermost match)` — what the spec did | `H2 heading to copy` | `bold text` | `link` |
| `selectNode(construct wrapper)` — what it does now | `## H2 heading to copy` | `**bold text**` | `[link](https://example.com)` |

Every marker a construct carries lives on or inside its WRAPPER — the `##` span in the `<h2>`, the
`**` spans in `span.vditor-ir__node[data-type="strong"]`, the `<ul>` that makes an `<li>` a bullet.
The old helper took the innermost element containing the search text (`<strong>`, `<em>`, `<code>`,
`span.vditor-ir__link`) and selected its CONTENTS, handing the serializer a bare text fragment that
could only ever come back as rendered text. So the spec now names an explicit selector per case and
uses `selectNode`.

Worth stating: the 17 that "passed" first time were passing for a weak reason — their expectations
only asserted the words (`/ELEM bullet one/`), which no selection strategy could fail. Every
expectation now names the marker, so the matrix asserts what its own comment claims.

Two things this changes about the diagnosis in "What the user reported": copy/paste fidelity in IR
is now covered element by element and is **correct throughout**, which narrows the user's report
further onto the sv preview pane (below) or the stale 1.2.2 VSIX.

One flake: `paste: inline emphasis` failed once and passed on retry, then passed again when run
alone. Timing of the document write-back, not a wrong result.

## Verification

- **Unit** (`media-src/src/clipboard-line.test.ts`, 18): block resolution for paragraph / heading /
  list item / blockquote / code block, innermost-block wins, a real selection is never touched, and
  every case where the helper must REFUSE (empty block, caret outside the editor, no selection at
  all) so a cut can never delete on its word. Plus the keydown gate: Ctrl+C expands, Ctrl+X does
  not, Ctrl+Alt+C and a bare C are ignored.
- **e2e, real VS Code** (`clipboard-collapsed.spec.ts`, in the fast tier) — real keystrokes and the
  real VS Code clipboard, because the whole defect is in what the handlers do to the SYSTEM
  clipboard and a synthetic `ClipboardEvent` proves nothing about it:
  - a collapsed Ctrl+C puts the current line on the clipboard;
  - a collapsed Ctrl+X leaves the document byte-identical — no stealth backspace;
  - a real selection still cuts normally (the control that proves the guard did not disable cut).
  - **Verified to FAIL without the fix**: both defect tests go red when the keydown gate and the
    cut guard are stubbed out.

### The two cut tests were `test.fixme` — and the "harness flake" diagnosis was WRONG

This section previously blamed a harness flake: "they pass when the spec runs alone and fail once any
test has run before them… most likely the selection/focus state Ctrl+C leaves in the previous test's
webview". **That was wrong, and the correction matters more than the original claim.**

Instrumenting the sequence disproved every part of it. There was never a stale webview — one
`iframe.webview`, one open tab, on every pass — and the live selection in the frame under test was
always exactly what the test had set (collapsed when it should be, non-collapsed when it should be).
The editor really was eating a character.

**The collapsed cut: real defect, now fixed and green.** The guard read the selection at the wrong
moment. Measured: **VS Code's webview clipboard bridge answers Ctrl+X by calling
`document.execCommand("cut")` from a host-message handler** (stack:
`HostMessaging.channel.port1.onmessage`), and by the time the resulting `cut` event reaches Vditor,
the selection reports `collapsed === false` — an empty range that is nonetheless not collapsed. So
`vmarkdCollapsed` computed `false`, `execCommand("delete")` was let through, and the stealth
backspace the guard exists to prevent happened anyway: `deleteContentBackward`, one character,
every time.

The fix is to read the user's intent where it is unambiguous — the keystroke. `clipboard-line.ts`
records on a capture-phase `keydown` whether the selection was collapsed when Ctrl+X was pressed, and
the `cutEvent` patch consumes that answer **read-once**, falling back to the live selection for a cut
that did not come from Ctrl+X (context menu, toolbar). A recorded intent older than 2 s is treated as
stale, so an old keystroke can never govern a later cut. The original safety test (no character
lost) passed; the completed line-cut follow-up above replaces it with full-block removal.

**The selected cut: a different, pre-existing defect — split out as [task 387](387-cut-leaves-last-line.md).**
Cutting a selected multi-line paragraph leaves its last line behind (85 of ~96 characters removed).
It fails alone, on every retry, and fails identically with this task's fix stashed out and the bundle
rebuilt — so it is not a regression from this work. Root cause measured: `fixCut`'s deferral makes
the delete land a macrotask late, as a backspace against an already-collapsed selection. Fixing it
means restructuring the cut path, so it stays `test.fixme` with that diagnosis written on it rather
than the old flake story.

## Second, independent investigation (Codex) — agreed, plus two things it added

A parallel agent investigated the same report from scratch and **also failed to reproduce a broken
copy/paste path**, by the same method (real keystrokes, real VS Code clipboard). It additionally
proved the OS-clipboard → webview leg for IMAGES by seeding a real PNG with
`xclip -selection clipboard -t image/png -i` and pressing a real Ctrl+V: `clipboardData.types` came
back `["Files"]`, one `image/png`. So there is no webview clipboard-permission problem — native
`ClipboardEvent`s bypass the async Clipboard API's permission model entirely.

Two findings worth keeping:

1. **The sv PREVIEW pane copies by a completely different mechanism, and nothing tests it.**
   **RESOLVED — it was broken, and it is fixed: see [task 386](386-sv-preview-copy.md).** The probe
   below stayed inconclusive because it clicked the pane AFTER setting the selection, which collapses
   the very selection under test. Clicking first and selecting second made the defect reproducible on
   demand: the copy event fired, `execCommand("copy")` returned `true`, and the clipboard kept its
   previous value — while the same keystroke in the sv EDIT pane copied correctly in the same run.
   The original note is kept below because its reasoning was right.

   `vditor/src/ts/preview/index.ts:35-46,261-286` builds a detached clone, selects it, and calls
   `document.execCommand("copy")` — where IR, WYSIWYG and sv-edit all use
   `clipboardData.setData` + `preventDefault`. `execCommand("copy")` in a double-nested webview
   iframe is a known-flakier path. **This is the top remaining candidate** for the user's report if
   they work in split mode and copy from the rendered right-hand pane.

   **I tried to test it and the probe was INCONCLUSIVE** — the selection would not hold inside
   `.vditor-preview` (`getSelection().toString()` came back empty after `selectNodeContents`), so
   the Ctrl+C never exercised the handler; the clipboard simply kept its previous value. That is
   NOT evidence the path works, and not evidence it is broken. The probe is kept at
   `tmp/copypaste/sv-copy-probe.spec.ts`. Next attempt should select via a real mouse drag in the
   pane rather than programmatically, and first confirm where sv's rendered content actually lives
   (`.vditor-preview` may not be the right container in split mode).

2. **`fixCut()` is the root cause of the half-deleted paragraph measured above.** Codex reached it
   by reading code, independently of the measurement: `media-src/src/utils.ts:52` monkey-patches
   `document.execCommand` so a `'delete'` is deferred into a `setTimeout` (working around a
   recursive-execution error). Vditor's shared `cutEvent` calls `copy()` synchronously — which
   `preventDefault`s the native cut and writes the clipboard — and only THEN calls
   `execCommand("delete")`, which now lands a macrotask later, against whatever the selection has
   become. That is exactly the window the line-cut attempt fell into. It also means **every** real
   Ctrl+X in this editor has a one-macrotask gap between "clipboard written, native cut suppressed"
   and "content actually removed"; `copy-clipboard.spec.ts` cannot rule out a race there because it
   polls for up to 10 s. Not reproduced as a failure — recorded as the mechanism to attack first if
   line-cut parity was picked up and closed in the follow-up above.

Separately, Codex reported a defect: clicking outside the editable surface (the toolbar, or webview
padding) leaves `activeElement === BODY` with no Range, and then **all** keyboard input silently
no-ops — typing included, not just paste. **This did NOT reproduce.** Probed against
`.vditor-toolbar`, `.vditor`, `body` and `.vditor-ir`, each clicked at its extreme edge, with a
baseline keystroke first to prove the harness reaches the webview: `activeElement` stayed
`PRE.vditor-reset`, `rangeCount` stayed 1, and the typed character landed in the document every
time. Filed as a negative result in [task 388](388-focus-lost-outside-click.md) rather than as a
confirmed bug, with the gaps that probe does not cover listed there.

## Caveat on the diagnosis

The user's report had no repro, and the paths above were the only ones found broken out of
everything probed. It is therefore possible their complaint is something else — for instance their
installed VSIX is **1.2.2** while the repo is at **1.2.3**, so they have been testing an older
build. Worth confirming before treating this as closed.
