# Task: Image with empty alt — protective rewrite missing (possible vanish)

> **Status:** ⬜ Not started (reproduce first).
> **Source:** `GongXunSS/vditor` (`feat-vscode`) — `alt=""`→`alt="img"` rewrite ("Fix cannot create img"). Verified the rewrite is absent in our `vditor@3.11.2`. See bug-hunt addendum.
> **Value / Risk:** 🟡 image may disappear after insertion / low-medium (confirm the vanish before patching)

## Problem
When an image is inserted/edited via the WYSIWYG popover, `alt` is written verbatim, including empty string: `highlightToolbarWYSIWYG.ts:1080` `imgElement.setAttribute("alt", alt.value)` where `alt.value` seeds from `getAttribute("alt") || ""` (`:1110`). The GongXunSS workaround that rewrites `alt=""`→`alt="img"` is **absent** (grep `alt="img"` = 0 hits). On that fork, an empty-alt image could vanish after creation through the Lute markdown round-trip.

Whether the image actually disappears in our `vditor@3.11.2` is **runtime-dependent** (depends on Lute's `![](src)` round-trip) — so this needs a repro before we commit to a fix.

## Goal
Inserting an image without alt text leaves a stable, visible image that survives the markdown round-trip.

## Steps
1. **Reproduce**: insert an image with empty alt in WYSIWYG; confirm whether it vanishes / fails to render after the next spin/round-trip. If it does NOT vanish in 3.11.2, close this as not-applicable (the fork's base was older).
2. If reproduced, either:
   - rewrite empty alt to a placeholder (`alt="img"`) on the insert/update path (`highlightToolbarWYSIWYG.ts:1080`), via the esbuild `onLoad` patch (task 56 mechanism), or
   - fix at our layer if the insertion goes through our own code (it currently doesn't — images come via Vditor popover + the upload path `main.ts:612-629` which inserts `![](relpath)` with empty alt).
3. Check the upload-insert path too: `media-src/src/main.ts:612-629` inserts `![](relpath)` (empty alt) — if the vanish reproduces, this path needs the same placeholder.

## See also
- `media-src/src/main.ts:612-629` (upload → `insertValue('![](…)')`).
- `out/vditor-forki-analiza.md` §3c.

## Verify
Insert an image with no alt text (popover and paste/upload paths); it renders and survives editing the surrounding text + a save/reload round-trip. If not reproducible in 3.11.2, document as already-fixed and close.
