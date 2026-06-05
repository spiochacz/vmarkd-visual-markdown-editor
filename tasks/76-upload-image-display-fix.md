# Task: Fix uploaded images not displaying inline

> **Status:** ✅ DONE (2026-06-05). Two bugs fixed in one commit.
> **Value / Risk:** 🟢 images now render after upload / low.

## Bug 1: `handleUploaded` inserted a link, not an image
`handleUploaded` in `main.ts` created `new Image()` with a relative `src`
(e.g. `assets/pic.webp`) to preload, but relative paths don't resolve in the
webview context → `Image.onerror` fired → inserted `[name](path)` (plain link)
instead of `![](path)` (rendered image). The preload was unnecessary — the file
was just written by the host, it always exists.

**Fix:** removed the `Image` preload; always insert `![](path)`.

## Bug 2: CSP `base-uri 'none'` blocked `<base href>`
The webview HTML has `<base href="...">` pointing at the document's directory
(via `asWebviewUri`), which makes relative image paths resolve to local files.
But CSP `base-uri 'none'` **blocked** the `<base>` element entirely — relative
paths resolved to the webview's virtual origin instead of the filesystem.

**Fix:** changed `base-uri 'none'` to `base-uri ${cspSource}` — allows `<base href>`
on the webview origin (safe: external base injection still blocked by origin mismatch).

## See also
- `media-src/src/main.ts` `handleUploaded`
- `src/extension.ts` CSP meta (`base-uri`)
- `test/backend/webview-html.test.ts` — CSP test updated
