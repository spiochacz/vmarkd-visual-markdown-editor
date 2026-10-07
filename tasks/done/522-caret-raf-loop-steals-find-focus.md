# 522 — the caret rAF loop steals focus from the find box (task 514, second half)

**Status:** ✅ DONE (2026-10-07) — keystroke leak into the document 4/120 → 0/120 legs; residual VS Code handshake transient under heavy load documented. · **Impact:** 🔴 the reported Ctrl+F bug still happens, ~1 run in 2 ·
**Found:** 2026-08-13 during [task 516](../516-qa-journey-coverage-plan.md)'s full-suite triage.

## Re-measured 2026-10-07 — rarer, same mechanism, now caught with a trail

- `find-widget-modes.spec.ts --repeat-each=10 --retries=0`: 1/10, then 0/10 (≈1 in 21 runs, ~1 in 63
  legs; it was ~1 in 2 in August). The preview leg no longer fails at all.
- An instrumented probe (focus()/addRange/collapse/setBaseAndExtent/requestCaret wrapped inside the
  webview + window focus/blur/focusin/selectionchange trail; 80 legs wysiwyg+sv) caught 2 failures
  (sv round 37, wysiwyg round 38). Both show the same chain: undo checkpoint arms an intent
  (`requestCaret ← addCaret ← addToUndoStack`, ≈300 ms) → every find keystroke gives the frame a brief
  real focus (`win-focus`, `hasFocus=true`, active BODY) + a `selectionchange` → ≈3 ms later
  `addRange ← tryPlace ← tick` re-asserts the caret → `win-focus active=PRE`, `focusin PRE` → focus
  stays in the editor. When the write lands after `win-blur` nothing happens (why it is rare).
- So the caret loop IS the remaining theft path. Fix: the loop's re-assertions skip the write while
  the document has focus but the editor does not (implemented 2026-10-07, see below).

## Fix and proof (2026-10-07)

Three layers, each red-green-red proven deterministically (unit + chromium harness):
1. `caret.ts` — the rAF loop's re-assertions skip the write while the document has focus but the
   editor does not (`wouldStealFocus`).
2. `focus-restore.ts` — the window-focus restore waits a 60 ms settle window and skips if a `blur`
   followed the `focus` (the find handshake).
3. Host signal — Ctrl/Cmd+F and Escape go through `vmarkd.findOpen` / `vmarkd.findClose`
   (package.json, `src/app/commands.ts`), which post `find-open` / `find-close`; while open
   (`media-src/src/editing/host-find.ts`, cleared on find-close or the first trusted pointerdown —
   NOT keydown: the find box's keystrokes reach the webview as trusted keydowns) neither the restore
   nor the caret loop writes.

Layers 1–2 alone did not move the HOST-focus rate. What settled it was measuring the user-visible
symptom instead: the probe (removed after use) also checked the find box value and the document text.

| 120 legs, wysiwyg+sv, real VS Code | host focus off the find box at a sample | **keys leaked into the document** |
|---|---|---|
| all three gates disabled | 10 | **4** (e.g. find box `brao`, the `v` went into the doc) |
| fixed | 1 | **0** |

The residual "host activeElement = IFRAME.webview" samples (~1%) happen while the webview itself
never takes focus (trail: every `win-focus` is followed by `win-blur`, document active element BODY)
and nothing leaks — a transient of VS Code's own findInFrame handshake, not ours. `find-widget-modes`
/ `find-widget-focus` still assert host focus per keystroke, so they can show that transient as a rare
flake (Playwright retries cover it); asserting the leak instead would be the stricter-to-the-symptom
alternative if it ever becomes noisy.

## Residual under heavy machine load (2026-10-07, measured)

`find-widget-modes.spec.ts` now asserts the user-visible symptom (the find box holds the whole query +
the document is untouched); host-focus samples are only logged. At machine load 10-15 (other sessions)
it still failed 2/8: one VS Code close timeout (load), and one PREVIEW leg with the find box at `brao`.
Preview has no editable surface, so nothing of ours took focus: during the findInFrame handshake VS
Code delivers a keystroke to the webview frame (observed: find keystrokes arrive in the webview as
trusted keydowns), and under load that window is long enough to swallow a letter. That is a
platform transient — no extension API can type into the webview find box — and it did not occur at
normal load (0/120 legs). Re-check at idle load before treating a failure of this spec as a regression.

## Symptom

The bug [task 514](514-find-widget-steals-focus.md) set out to fix: you press Ctrl+F, type a
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

This is consistent with [task 515](515-caret-write-focus-theft.md)'s finding rather than a
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

## A fix attempt that did NOT work — do not repeat it (2026-08-13)

Tried the most obvious candidate from the list below: gate the loop's write on "the editor already
owns DOM focus" (`l.editor.contains(document.activeElement)`), leaving the FIRST placement ungated
so `caret-on-open` and 439's lazy-block case keep working, and deferring rather than counting a miss
so an unfocused second does not retire a resolvable intent. Unit tests stayed green (43/43).

**It made no measurable difference.** `find-widget-modes.spec.ts` at `--repeat-each=10`:

| | result | failing legs |
|---|---|---|
| gate ON | 8 passed, 1 failed, 1 flaky | wysiwyg, preview, sv |
| gate OFF (same session) | 8 passed, 1 failed, 1 flaky | sv, sv, wysiwyg |

An earlier `--repeat-each=5` pair looked like an improvement (1/2 → 1/10) and was pure noise; at this
failure rate anything under ~10 repeats per side proves nothing. The change was reverted
(`caret.ts` byte-identical to HEAD) rather than shipped on a hunch — it modifies the shared caret
authority and bought nothing measurable.

What this rules out: "the re-assertion loop is the ONLY theft path, and editor-focus is the
discriminator". It does not rule out the loop being ONE path — the captured stack in the section
above is still real.

**The `preview` leg is the strongest remaining lead.** Preview has no contenteditable editor for a
caret write to focus, yet it fails the same way, so at least one theft path is NOT the caret loop.
Instrument that leg first: whatever steals focus there is either a second mechanism or the actual
single mechanism, and either answer redirects this whole task.

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
