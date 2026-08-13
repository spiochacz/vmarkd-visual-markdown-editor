# 522 — the caret rAF loop steals focus from the find box (task 514, second half)

**Status:** 📋 OPEN — diagnosed with captured stacks, NOT fixed (the fix is a design decision in
shared code, see below) · **Impact:** 🔴 the reported Ctrl+F bug still happens, ~1 run in 2 ·
**Found:** 2026-08-13 during [task 516](516-qa-journey-coverage-plan.md)'s full-suite triage.

## Symptom

The bug [task 514](done/514-find-widget-steals-focus.md) set out to fix: you press Ctrl+F, type a
query, and partway through the letters stop reaching the search box and start landing in the
document. 514 fixed one route into it; this is a second, independent route that 514's gate does not
cover.

Reproduced by `test/vscode-e2e/find-widget-modes.spec.ts`, which fails about half the time:

```
Error: [sv] focus left the find box: [{"char":"a","host":"IFRAME.webview.ready"}]
Error: [wysiwyg] focus left the find box: [{"char":"r","host":"IFRAME.webview.ready"}]
```

## Mechanism (measured, not inferred)

Instrumented in the real webview by wrapping `HTMLElement.prototype.focus`,
`Selection.prototype.addRange` and `window.__vmarkdRequestCaret`, plus a focusin/focusout/window
event trail, then run until a failure reproduced with the instrumentation live.

1. **`media-src/src/editing/caret.ts`** — `tick()`/`tryPlace()` (≈lines 271-355) call
   `sel.addRange(range)` on EVERY animation frame while a caret intent is live, up to
   `MAX_TOTAL_TICKS` (300, ~5 s). The file contains **no `document.hasFocus()` check at all**
   (`grep -n hasFocus media-src/src/editing/caret.ts` → nothing), unlike its sibling
   `focus-restore.ts`, which task 514 gated at lines 143 and 176.
2. **What arms the intent is not find-related at all**: Vditor's own undo checkpointing. The
   vendored-source patch `patchUndoCaretSplitRestore` (`media-src/esbuild-shared.mjs`, task 445)
   makes Vditor's `addToUndoStack`/`addCaret` call `window.__vmarkdRequestCaret(...)`, measured
   firing ~1 s after every document open. Stack: `wrappedRequestCaret ← Li.addCaret ←
   Li.addToUndoStack`.
3. Electron's `findInFrame` handshake gives the webview frame **brief, real, periodic focus** while
   the user types into the host find box (this is the mechanism task 514 documented). When one of
   the loop's blind `addRange()` calls lands inside such a window, the browser's own side effect of
   `Selection.addRange()` into a contenteditable focuses that element — and the keystroke stream
   goes with it.

Captured during a failing wysiwyg run:

```
#15 t=2370 Selection.addRange()-call  active=BODY.vscode-dark      hasFocus=true
#16 t=2371 win-focus                  active=PRE.vditor-reset      hasFocus=true
  AT: Selection.wrappedAddRange ← tick (caret.ts) ← tryPlace
#17 t=2371 focusin target=PRE.vditor-reset active=PRE.vditor-reset hasFocus=true
```

No `focusout` follows — focus stays on the editor for the rest of the run, which is exactly the
reported symptom.

This is consistent with [task 515](done/515-caret-write-focus-theft.md)'s finding rather than a
contradiction of it: a caret write only takes focus inside an ALREADY-focused document, and 515
measured a single static `__vmarkdRequestCaret` call with no real-focus flicker live. The rAF loop
plus Electron's periodic frame focus supplies exactly the condition 515 could not produce.

## Why 514's fix does not cover it

514 gated the **entry points** in `focus-restore.ts` — the code that decides whether to CALL
`requestCaret`/`editor.focus()`. `caret.ts`'s loop is not a focus-event listener and re-asserts
blindly regardless of who armed it or whether the document legitimately holds focus.

## Not an IR-vs-other-modes difference

Tempting but wrong: the same arming (`Li.addCaret ← Li.addToUndoStack`) and the same
`addRange`-with-`hasFocus=true` focus flip were measured in **IR** too, at near-identical call
volumes (12 requestCaret / 84 addRange in ir, 10/82 wysiwyg, 12/84 sv). `find-widget-focus.spec.ts`
reading green 3/3 is a small sample of the same race, not architectural immunity. Do not assume IR
is safe.

## Fix — the design decision this needs

`caret.ts` is the shared caret authority; tasks 439, 445 and 490 all route through it, so a gate
must not regress those. Options:

- Gate `tryPlace`'s write on `document.hasFocus()`, mirroring `focus-restore.ts:176`. Simplest, and
  the precedent exists — but the harness path matters: `caret-on-open.spec.ts` relies on a caret
  write in a webview that never gets real OS focus, which is exactly why 514's gate also keys off
  `isTrusted`. A blanket `hasFocus()` gate here would likely break it.
- Keep writing but stop the loop from RE-asserting once placed (the repeat is what widens the window
  from one frame to ~300).
- Have the undo-checkpoint arming path (`patchUndoCaretSplitRestore`) request a one-shot placement
  rather than a live intent — it is a checkpoint, not a user navigation.

Whichever is chosen: red-green-red against `find-widget-modes.spec.ts` with `--repeat-each` (a
single green run proves nothing at a ~1/2 failure rate), and re-run `caret-on-open.spec.ts`,
`codenav.spec.ts` and the undo specs, which are the other consumers.

## Sample sizes behind this report

Baseline `find-widget-modes.spec.ts` at `--repeat-each=4`: 3 flaky, 1 pass. Instrumented probe runs:
24 repeats across wysiwyg/sv/preview/ir, the stray-focus failure reproduced twice with
instrumentation live, both tracing to the same call site.
