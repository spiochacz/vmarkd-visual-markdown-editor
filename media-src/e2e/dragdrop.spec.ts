import { expect, test } from './coverage-fixture'
import { caretToEnd, getValue, gotoMouseops, setDoc } from './mouseops-helpers'

// NET (task 191 P1-17) + PROBE-4 — drag & drop into the editor. A dropped image File must
// route to the upload wire exactly like a paste (dropEvent → paste() files branch); a
// text/plain-only drop is a no-op (Vditor's drop only reacts to Files / text/html). Drives
// the real dropEvent with a synthetic DragEvent carrying a DataTransfer.

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function uploadPosts(page: import('@playwright/test').Page) {
  return page.evaluate(() =>
    ((window as any).__posted as any[]).filter((m) => m.command === 'upload'),
  )
}

test('P1-17: dropping an image File posts one upload with a sanitized, timestamped name', async ({
  page,
}) => {
  await gotoMouseops(page, 'ir')
  await setDoc(page, 'Drop target body.\n')
  await caretToEnd(page)
  await page.evaluate((b64) => {
    const el = (window as any).__modeEl() as HTMLElement
    el.focus()
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }))
    el.dispatchEvent(
      new DragEvent('drop', {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
      }),
    )
  }, PNG_B64)

  await expect
    .poll(async () => (await uploadPosts(page)).length, {
      timeout: 8_000,
      intervals: [100, 200, 400],
    })
    .toBe(1)
  const { name } = (await uploadPosts(page))[0].files[0]
  expect(name).toMatch(/^\d{8}_\d{6}_.+\.(webp|png)$/)
  expect(name).not.toContain('..')
})

// PROBE-4 (documented behaviour): a text/plain-only drop reaches dropEvent but its guard only
// fires for Files / text/html, so nothing is inserted and no upload is posted — the drop is a
// silent no-op. Pinned so a future drop-handling change is a conscious decision.
test('PROBE-4: a text/plain-only drop is a no-op (no upload, document unchanged)', async ({
  page,
}) => {
  await gotoMouseops(page, 'ir')
  await setDoc(page, 'Only this line.\n')
  await caretToEnd(page)
  const before = await getValue(page)
  await page.evaluate(() => {
    const el = (window as any).__modeEl() as HTMLElement
    el.focus()
    const dt = new DataTransfer()
    dt.setData('text/plain', 'dropped text')
    el.dispatchEvent(
      new DragEvent('drop', {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
      }),
    )
  })
  await page.waitForTimeout(400)
  expect(await uploadPosts(page)).toHaveLength(0)
  expect(await getValue(page)).toBe(before)
})

// C7 (task 516) — a drop carrying BOTH text/plain (a URL) AND a non-image File.
//
// FINDING (worth a product-side follow-up, not fixed here per the probe brief): this drop
// combination CRASHES the upload pipeline and silently loses BOTH payloads. Root cause, traced
// with a throwaway debug spec (page.on('pageerror')):
//   - Vditor's `paste()` (node_modules/vditor/dist/index.js) picks the FILES branch whenever
//     `dataTransfer.types` includes "Files" and there's no text/html — `files.length > 0`
//     short-circuits BEFORE the `textPlain` branch (which only runs when `files.length === 0`),
//     so the text/plain payload is discarded outright regardless of what happens next.
//   - `uploadFiles` (same bundle) reads `files = event.dataTransfer.items` — ALL items, string
//     AND file kind, not filtered to `kind === 'file'` — then takes `fileList.push(files[i])`
//     for `i < filesMax` (`filesMax` is 1 here: `upload.multiple` isn't set). In Chromium,
//     `DataTransferItemList` enumerates the text/plain STRING item before the File item
//     regardless of the order `setData`/`items.add` were called in, so `files[0]` is the
//     string item, `.getAsFile()` on it returns `null`, and `fileList` becomes `[null]`.
//   - vmarkd's own `upload.handler` (createUploadHandler, media-src/src/clipboard/upload-
//     handler.ts) does no mime/null filtering either — it maps every entry through
//     `convertForUpload(f, …)`, which reads `file.type` and throws a TypeError on `null`.
//   - The handler is `async`, called from an unawaited `Promise.all(...)` inside another
//     async fn Vditor doesn't catch — so the TypeError surfaces only as an unhandled promise
//     rejection (a console pageerror), never a UI-visible error. No upload is posted, no
//     markup is inserted, and the drop just silently does nothing.
// This is NARROWER than "any file + any text/plain" — an image file dropped ALONE (no
// text/plain sibling) works fine (P1-17 above); it's specifically a mixed string+file
// DataTransfer that hits the wrong-item-at-files[0] bug. Pinned here so a future change to
// the drop/upload pipeline is a conscious decision, and reported to team-lead as a finding.
test('PROBE-C7: dropping a File alongside text/plain crashes the upload pipeline — no upload posted, document unchanged', async ({
  page,
}) => {
  await gotoMouseops(page, 'ir')
  await setDoc(page, 'Drop target body.\n')
  await caretToEnd(page)
  const before = await getValue(page)
  const pageErrors: string[] = []
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  await page.evaluate(() => {
    const el = (window as any).__modeEl() as HTMLElement
    el.focus()
    const dt = new DataTransfer()
    dt.setData('text/plain', 'https://example.com/dropped-url')
    dt.items.add(
      new File(['not an image'], 'notes.txt', { type: 'text/plain' }),
    )
    el.dispatchEvent(
      new DragEvent('drop', {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
      }),
    )
  })
  await page.waitForTimeout(600)

  // Both payloads are lost: no upload posted, document unchanged, URL never inserted.
  expect(await uploadPosts(page)).toHaveLength(0)
  expect(await getValue(page)).toBe(before)
  expect(await getValue(page)).not.toContain('example.com')
  // The unhandled-rejection TypeError is the actual current failure mode — asserted so a
  // FIX (the real, wanted behaviour) is a conscious, visible change to this probe rather than
  // a silent flip. See the FINDING comment above for the fix shape (filter dataTransfer.items
  // to kind === 'file' before indexing, and/or handle text/plain even with a stray file item).
  expect(pageErrors.some((e) => e.includes("reading 'name'"))).toBe(true)
})
