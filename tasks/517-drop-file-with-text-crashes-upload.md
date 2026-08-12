# 517 — dropping a file alongside text/plain silently crashes the upload pipeline

**Status:** 📋 OPEN — bug, found by QA probe · **Impact:** 🟠 user-visible silent failure
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

## Fix shape (not implemented)

In vmarkd's own `createUploadHandler` — our code, no Vditor patch needed for the crash itself:

- Filter/guard `null` and non-`File` entries before mapping to `convertForUpload`.
- Decide the intended behaviour for a mixed drop rather than just not-crashing: either upload the
  real file (ignoring the text sibling), or route the drop through the text-insertion path so the
  URL becomes a link. Journey C7 in task 516 assumed "insert a link or be inert" — neither happens
  today.
- If the drop carries no usable file at all, fail visibly (the themed error path) instead of
  rejecting into the void.

Worth checking at the same time whether the same unfiltered-`items` assumption bites the **paste**
path (`paste-upload.spec.ts` covers image paste only).

## Regression coverage already in place

`media-src/e2e/dragdrop.spec.ts` → `PROBE-C7` pins **today's broken behaviour** deliberately: no
upload posted, document unchanged, URL never inserted, and the specific `TypeError` fires. It was
proven red by temporarily applying the null-filter fix (the probe then failed with an upload
posted). **So fixing this bug MUST flip that probe** — that is by design: update it to assert the
fixed behaviour in the same commit as the fix, never delete it.

## Verification

- The mixed drop uploads (or links) as decided, with no unhandled rejection.
- `PROBE-C7` rewritten to the new contract and green.
- Image-alone drop (existing test) still green.
