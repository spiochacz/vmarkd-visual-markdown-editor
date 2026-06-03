# Task: Image with empty alt — protective rewrite missing (possible vanish)

> **Status:** ⬜ Not started (reproduce first).
> **Source:** `GongXunSS/vditor` (`feat-vscode`) — `alt=""`→`alt="img"` rewrite ("Fix cannot create img"). Verified the rewrite is absent in our `vditor@3.11.2` (evidence in Problem below).
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
- Reference: GongXunSS `feat-vscode` rewrote `alt=""`→`alt="img"` on the image insert/update path ("Fix cannot create img").

## Reported upstream (repro + verify while in the image path)
- Vditor **#1336** — **image data lost** on mode switch. **Manifests:** insert several images (incl. linked `[![alt](img)](url)` forms), switch edit mode and back → some images/markup are gone from the content. https://github.com/Vanessa219/vditor/issues/1336
- Vditor **#1918** — same-name upload leaves stray markup. **Manifests:** when the backend rejects a duplicate filename (returns `errFiles`), the editor shows the error toast correctly **but also leaves an extra empty `p>span>img` structure** behind in the document. https://github.com/Vanessa219/vditor/issues/1918
- Vditor **#1136** — Firefox: cursor offset on toolbar image upload. **Manifests:** in WYSIWYG with the caret at the bottom of the doc, clicking the upload-image button inserts the image at the **start of the document** (or before existing text) instead of at the caret — the cursor position is lost. https://github.com/Vanessa219/vditor/issues/1136
- Vditor **PR #1872** — `options.preview.markdown.imgPathAllowSpace` (fixes #1871). **Manifests (the bug):** an image whose path contains a space (`![](my image.png)`) fails to render; the new option allows spaces in image paths. Relevant — our local image refs (and `saveFolder` tokens) can contain spaces. https://github.com/Vanessa219/vditor/pull/1872
- _These are distinct image bugs from the empty-alt focus — verify alongside; split out if they need separate fixes._

## Verify
Insert an image with no alt text (popover and paste/upload paths); it renders and survives editing the surrounding text + a save/reload round-trip. If not reproducible in 3.11.2, document as already-fixed and close.
