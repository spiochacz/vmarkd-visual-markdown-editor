# Task: Convert uploaded images to WebP / AVIF

> **Status:** 🟡 Perf spike done (2026-06-05) — benchmark below **confirms the A+C plan**:
> WebP is the default, AVIF opt-in only. Implementation not started. **Source:** dependency
> analysis (2026-06-05) — `sharp` is a declared-but-unused dep; this is the feature it was
> likely meant for. **Decision: do NOT use `sharp`** — go portable (WebP via webview canvas
> + AVIF via WASM), so one `.vsix` works on every platform.
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

## Benchmark (2026-06-05) — `bench/image-encode-bench.mjs`

`node bench/image-encode-bench.mjs`. All three formats via the `@jsquash` WASM codecs
(the exact AVIF lib we'd ship → AVIF numbers are production-faithful; WebP in production
is even faster since the webview encodes it on the Chromium canvas, not libwebp-WASM).
Median of 3 runs, Node v24.

**Real images @ q80 (size as % of JPEG, + encode time):**

| image | jpeg | webp | avif speed6 | avif speed9 |
|---|---|---|---|---|
| hero 640×640 (UI) | 61.9 KB / 83 ms | **52.2 KB / 50 ms (84%)** | 61.5 KB / **926 ms** (99%) | 65.6 KB / 65 ms (106%) |
| pojoaque 140² (photo) | 1.1 KB | **0.8 KB (73%)** | 1.2 KB / 16 ms (109%) | 1.0 KB (94%) |
| paper texture (dense photo) | **5.0 KB** | 5.9 KB (118%) | 8.9 KB (179%) | 8.5 KB (171%) |

**Quality sweep, real hero 640×640 (output KB):**

| q | jpeg | webp | avif s6 |
|---|---|---|---|
| 30 | 22.1 | 27.3 | **18.5** |
| 50 | 32.9 | 34.9 | 32.8 |
| 70 | 45.4 | **42.7** | 53.0 |
| 90 | 89.0 | **72.8** | 79.2 |

**Encode-time scaling (synthetic, content-robust):** AVIF speed 6 is **7–11× slower** than
JPEG — up to **~2.3 s** for a 1280×960 image. AVIF speed 9 drops to ≈JPEG time but then
*loses* its size edge (becomes bigger than WebP on every case).

### Findings → decision
- **WebP wins overall.** Smallest-or-tied at the qualities people actually use (q70–q90),
  and in production it encodes on the **webview Chromium canvas** — native, ~instant, **zero
  deps**. This is the MVP. ✅ confirms option A.
- **AVIF is opt-in only.** Its size win shows up *only at low quality* (≤~q40–50); at q70+
  WebP beats it. And quality-mode encode (speed ≤6) is multi-second — **must be async/off the
  host's hot path**; fast-mode AVIF (speed 9) is pointless (worse than WebP on both axes).
  Keep it behind the setting + busy indicator. ✅ confirms option C, opt-in.
- **JPEG**: no reason to convert *to* JPEG — it's the baseline uploads already are; mozjpeg is
  only competitive on dense/noisy photographic detail.
- **Quality semantics differ per codec** — a fixed nominal "quality 80" is not equal visual
  quality across formats; the sweep (not the single q80 row) is the trustworthy size signal.

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
