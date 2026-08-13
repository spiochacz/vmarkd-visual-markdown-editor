# 517 — dropping a file alongside text/plain silently crashes the upload pipeline

**Status:** ✅ FIXED 2026-08-13 — bug, found by QA probe · **Impact:** 🟠 user-visible silent failure
(nothing uploads, nothing inserts, no error shown) · **Found:** 2026-08-13 while implementing
[task 516](516-qa-journey-coverage-plan.md) journey C7.

## Symptom

Drag a file into the editor when the drag ALSO carries a `text/plain` payload — the ordinary case
when dragging a link+file together, or any browser drag that stamps both. Result: **nothing
happens**. No upload, no inserted link, no error box. The failure surfaces only as an unhandled
promise rejection in the devtools console:

```
TypeError: Cannot read properties of null (reading 'name')
```

An image file dropped **alone** (no `text/plain` sibling) works fine — that path is covered by
`media-src/e2e/dragdrop.spec.ts`'s existing test. The bug needs the mixed payload.

## Root cause (traced, not guessed)

Four layers line up:

1. **Vditor `paste()`** picks the FILES branch whenever `dataTransfer.types` includes `"Files"`,
   regardless of a `text/plain` also being present — and discards `textPlain` outright in that
   branch. So the text is never considered as a fallback.
2. **Vditor `uploadFiles`** reads `files = event.dataTransfer.items` — **all** items, not filtered
   to `kind === 'file'` — and takes `files[0]` under `filesMax = 1`.
3. **Chromium** enumerates the string item *before* the File item in `DataTransferItemList`
   regardless of add order, so `files[0]` is the text entry and `.getAsFile()` returns `null`.
4. **`createUploadHandler`** (`media-src/src/clipboard/upload-handler.ts`) does no null-filtering —
   it maps every entry through `convertForUpload(f, …)`, which reads `file.type`/`file.name` and
   throws on the null entry.

The throw happens inside a promise nobody awaits, hence the total silence.

## Fix — DONE (two layers)

- [x] **esbuild patch on Vditor** (`patchUploadFilesKindFilter`, `media-src/esbuild-shared.mjs`):
  drop non-file `DataTransferItem`s BEFORE the `filesMax` slice, so the slice counts real files
  and the actual File is reached. Without this the File never gets to us at all — filtering only
  on our side would stop the crash but still upload nothing.
- [x] **Defensive filter in `createUploadHandler`** (`media-src/src/clipboard/upload-handler.ts`):
  non-`File` entries can no longer reach `convertForUpload`, so a null can never resurface as an
  unhandled rejection even if the upstream shape changes again.
- [ ] NOT changed, deliberately: the `text/plain` sibling is still discarded rather than inserted
  as a link. That is Vditor's branch choice (`paste()` takes the Files branch whenever `types`
  includes "Files"), it is a feature decision rather than a defect, and the C7 test now asserts
  the current behaviour explicitly so changing it later is a conscious act.

Worth checking at the same time whether the same unfiltered-`items` assumption bites the **paste**
path (`paste-upload.spec.ts` covers image paste only).

## Regression coverage already in place

- `media-src/e2e/dragdrop.spec.ts` → the C7 test now asserts the FIXED contract: the real file is
  uploaded, no `TypeError` fires, and the URL is still not inserted. It first landed pinning the
  broken behaviour and was flipped by this fix, so it is known to fail without it.
- `test/backend/vditor-source-patches.test.ts` → asserts the shipped Vditor source still has the
  slice-before-filter shape, that the patch inserts the kind filter BEFORE the slice (a filter
  after it would change nothing), and that the patch throws on anchor drift so a Vditor version
  bump fails the build loudly instead of silently un-fixing this.

## Verification

- The mixed drop uploads (or links) as decided, with no unhandled rejection.
- `PROBE-C7` rewritten to the new contract and green.
- Image-alone drop (existing test) still green.
