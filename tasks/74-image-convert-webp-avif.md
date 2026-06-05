# Task: Convert uploaded images to WebP / AVIF

> **Status:** ⬜ Not started. **Source:** dependency analysis (2026-06-05) — `sharp` is a
> declared-but-unused dep; this is the feature it was likely meant for. **Decision: do NOT
> use `sharp`** — go portable (WebP via webview canvas + AVIF via WASM), so one `.vsix`
> works on every platform.
> **Value / Risk:** 🟢 smaller assets, modern formats / low–medium (encode plumbing +
> link/filename rewrite; AVIF encode is CPU-heavy).

## Why
Image upload (`onUpload` in `src/extension.ts`) currently writes the bytes **verbatim**:
`Buffer.from(file.base64, 'base64')` → `vscode.workspace.fs.writeFile(...)`, no conversion.
The webview reads files as base64 (`utils.ts` `fileToBase64` → `reader.readAsDataURL`) and
the host posts back the saved names (`command: 'uploaded', files: [...]`), which the webview
turns into `![](…)` links. We want an **opt-in** convert-to-WebP/AVIF on upload to shrink
assets.

## Why NOT `sharp`
`sharp` is fast and does both formats, **but it's a native binary**: `vsce package` bundles
only the **current platform's** binary, so the `.vsix` would break on other OSes. Supporting
all platforms means per-target vsix (`vsce package --target …`) or bundling every binary
(huge). Not worth it here. (This is almost certainly why `sharp` was added years ago but
never wired up — see the dependency analysis. `sharp` can be removed.)

## Approach (portable — A + C)
- **WebP → in the WEBVIEW (option A), zero deps.** The webview is Chromium, which encodes
  WebP natively:
  ```ts
  async function fileToWebp(file: File, quality = 0.8): Promise<Blob> {
    const bmp = await createImageBitmap(file)
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    c.getContext('2d')!.drawImage(bmp, 0, 0)
    return c.convertToBlob({ type: 'image/webp', quality })
  }
  ```
  Convert before upload, rename to `.webp`, send the new blob's base64 + new name.
- **AVIF → in the HOST via WASM (option C):** `@jsquash/avif` (Squoosh codecs, pure WASM —
  no native binary, cross-platform; decode source → `ImageData` → `encode()`). Browser AVIF
  *encode* via `canvas.toBlob('image/avif')` is not reliably supported, so it lives host-side.
  AVIF encode is slow regardless of library (cost of the format) — keep it opt-in + show the
  existing busy/stream indicator if it blocks.

| | where | deps | vsix | notes |
|---|---|---|---|---|
| WebP | webview canvas | none | clean | simplest; ship first as MVP |
| AVIF | host `@jsquash/avif` (WASM) | 1 WASM pkg | clean | slower encode; opt-in |
| ~~sharp~~ | host native | sharp | ❗per-platform | rejected (packaging) |

## Steps
1. **Setting** `vmarkd.upload.imageFormat`: `none` (default) | `webp` | `avif`, plus
   `vmarkd.upload.imageQuality` (0–100). Read in the webview (for webp) and host (for avif).
2. **WebP MVP (webview):** in the upload path (`main.ts` ~`fileToBase64(f)` call site), if the
   file is a raster (`image/png|jpeg|…`) and format is `webp`, convert via `fileToWebp`, set
   the sent name to `name.replace(/\.[^.]+$/, '.webp')`. Skip SVG (vector) and GIF (animation).
3. **AVIF (host):** add `@jsquash/avif` (+ a decoder, e.g. `@jsquash/jpeg`/`@jsquash/png`).
   In `onUpload`, when format is `avif` and the file is a raster: decode → encode AVIF →
   write `.avif`; **post back the converted name** so the link matches. Format the encode as
   async; never block the extension host hard.
4. **Fallback (both):** if encode throws (corrupt / unsupported), write the **original bytes
   verbatim** under the original name — never lose an upload.
5. **Link/filename:** always feed the *output* name into the `uploaded` reply (the protocol
   already returns names → the inserted `![](…)` link follows automatically).
6. **Remove `sharp`** from root `devDependencies` (now confirmed dead either way).
7. **Tests:** unit for the format/skip decision + name rewrite + fallback; e2e — upload a PNG
   with `imageFormat: webp` → a `.webp` file lands in the assets folder and the inserted link
   points to it (webview canvas works in the Playwright Chromium harness). AVIF: at least a
   host unit test of the encode+rename+fallback (WASM runs in Node).

## Gotchas
- **Rename the link**, not just the file — covered by posting the output name back.
- **Skip SVG/GIF** (vector / animation). Optionally keep animated GIF → animated WebP later.
- **AVIF encode is slow** (seconds for big images) — opt-in, async, surface progress.
- **No native deps** — that's the whole point; keep it WASM/canvas so the `.vsix` stays
  single-artifact and cross-platform.

## See also
- `src/extension.ts` `onUpload` (verbatim write today), `media-src/src/utils.ts` `fileToBase64`,
  `media-src/src/main.ts` upload call site (~`base64: await fileToBase64(f)`) + `uploaded` handler.
- Dependency analysis (2026-06-05): `sharp` unused; `media-src` `typescript` unused.
- `@jsquash/avif` (WASM AVIF), `OffscreenCanvas.convertToBlob` (WebP).
