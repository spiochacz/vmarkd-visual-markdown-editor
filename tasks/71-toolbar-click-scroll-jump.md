# Task: Toolbar click jumps a scrolled large doc back to the top

> **Status:** ✅ Fixed (2026-06-04). Reproduced + guarded by
> `media-src/e2e/scrolljump.spec.ts`. Reported on `out/vmarkd-big-instant-preview-test.md`:
> open a large file, scroll to the bottom **without clicking into the text**, click a
> toolbar button → the view jumps to the top.
> **Value / Risk:** 🟡 everyday editing annoyance on long docs / low — fix is a webview-side
> scroll guard that only ever corrects an upward jump.

## Root cause (localized by probing, not patched in Vditor)
With no live selection AND no stored `vditor[mode].range` (the user only scrolled, never
placed a caret), a toolbar action makes Vditor focus the editor and drop the caret at the
element ROOT `(element, 0)`:
- `getEditorRange()` fallback (`util/selection.ts`) — `element.focus()` + range at start;
- `EditMode.setEditMode()` (`toolbar/EditMode.ts`) — `element.focus()` + a full re-render.

The operation then re-renders the editor, **replacing its innerHTML**, which resets the
scroll container's (`pre.vditor-reset`) `scrollTop` to 0 **silently — no scroll event**.
For the IR formatting path the reset is **debounced** (the re-render lands ~250 ms after
the click), so a single post-click restore is too early; mid-render the content height
also briefly collapses (so a one-shot restore lands at 0).

Empirically ruled out: `focus({preventScroll})` (the scroll isn't from `focus()`),
anchoring the fallback caret to the first visible block (re-render still resets scroll),
and `setSelectionFocus` (it doesn't scroll). The unifying cause is the **innerHTML
re-render resetting scrollTop**, across multiple trigger paths.

## Fix
`media-src/src/toolbar-scroll-guard.ts` (`guardToolbarScroll`, wired from `main.ts`
`finishInit`; `findScroller` moved here too): snapshot the scroller's `scrollTop` on a
capture-phase toolbar `mousedown` (before Vditor), then restore it — **with no visible
flash** — on the click, via three layers timed to land *before any paint at the top*:
1. a **synchronous** restore in the bubble `click` handler — for a synchronous re-render
   (mode switch), Vditor has already reset scrollTop by the time this runs in the SAME
   task, so restoring now means the browser never paints the top state;
2. a **MutationObserver** on the editor wrapper — the reset happens via an innerHTML
   replacement, and the observer's callback runs as a microtask right after that mutation
   (before paint), so it catches the DEBOUNCED IR-format re-render (~250 ms later) without
   a flash (a plain `requestAnimationFrame` restore runs one painted frame too late —
   that was the residual flash);
3. a `requestAnimationFrame` loop bounding a ~600 ms window as a fallback, then disconnect.

All restores are **upward-only** (never fight a downward user scroll) and a no-op when the
click didn't move the scroll (a real caret → local re-render → scroll already preserved),
so the guard never interferes with legitimate behavior.

**Also**: the capture-phase toolbar `mousedown` listener calls `event.preventDefault()`.
A user report showed the viewport jumps to the top **on mousedown** (and returns on
mouseup) — a browser focus-scroll-to-caret: pressing a toolbar button shifts focus, and
the browser scrolls the editor's caret (at the top, since the user only scrolled) into
view. `preventDefault` keeps focus/selection put so there's no scroll to undo — exactly
what Vditor already does for its built-in formatting buttons; the click still fires so
every button keeps working (verified by the full e2e suite). NOTE: this mousedown jump
only reproduces in the VS Code webview (iframe focus behavior), not in the Playwright
harness, so the visual jump can't be asserted directly. Instead a guard test asserts the
**mechanism** — a toolbar `mousedown` is `defaultPrevented` — so a future refactor that
drops it goes red. User-confirmed fixed in the real webview (2026-06-04).

## Verify
✅ `media-src/e2e/scrolljump.spec.ts` (real Vditor, large doc, bounded-height layout so
`pre.vditor-reset` scrolls with a fixed toolbar, mirroring the webview): scroll to the
bottom, click `bold` (getEditorRange + debounced re-render) and re-select the current
edit-mode (EditMode focus + full re-render). Each test samples the MINIMUM scrollTop across
the window (rAF + a 1 ms timer) and asserts it never dropped toward the top — i.e. **no
flash**, not just the right final position. A third test guards the mousedown
`defaultPrevented` mechanism (the webview-only focus-scroll fix). Full gate: 381 unit,
93 e2e, biome ci clean, build OK.

## Note (harness fidelity)
The repro only manifests when `pre.vditor-reset` is the scroll container (bounded `height`)
with the toolbar fixed — the webview layout. A naive harness lets the **document** scroll,
which moves the toolbar off-screen and makes Playwright's click scroll it back (a false
signal). The harness sets Vditor `height: 600` to match the webview.
