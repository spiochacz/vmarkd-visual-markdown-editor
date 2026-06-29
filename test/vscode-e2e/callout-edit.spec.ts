// Editing a callout body in the real VS Code IR webview (task 179) — the MANDATE real-webview test.
//
// Regression: typing inside a rendered callout made the text "disappear" and ejected the caret, so
// callouts were effectively uneditable. Cause: every keystroke runs SpinVditorIRDOM (rebuilds the
// blockquote, dropping our `vditor-ir__node--expand`) and observeCallouts re-decorated it
// SYNCHRONOUSLY — before Vditor's keyup re-added `--expand` — collapsing the dual-node so the source
// went display:none (text gone) and the caret fell into / past the non-editable preview. The fix
// drives expand/collapse off the LIVE selection and skips rebuilding the preview of the callout being
// typed in (it re-syncs on caret-leave). This only reproduces with the real custom-editor pipeline
// (VS Code's injected CSS + the real Vditor IR re-spin), so it lives here, not in the chromium harness.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'callout-edit.md')

function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

// Expand the IR callout + put the caret at the END of its body text node, then focus the IR surface
// so a real keystroke burst types into it. Returns the body text we started from (for the assertion).
async function enterCalloutBody(frame: ReturnType<typeof wf>) {
  return frame.locator('body').evaluate(() => {
    const bq = document.querySelector(
      '.vditor-ir blockquote[data-callout]',
    ) as HTMLElement | null
    if (!bq) return null
    const p = bq.querySelector(':scope > p') as HTMLElement | null
    const t = p?.firstChild as Text | null // "[!NOTE]\neditable body text"
    if (t?.nodeType !== 3) return null
    bq.classList.add('vditor-ir__node--expand') // show the source half so the caret can land in it
    const ir = bq.closest('.vditor-ir') as HTMLElement | null
    ir?.focus()
    const r = document.createRange()
    r.setStart(t, t.data.length) // end of the body
    r.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
    return t.data
  })
}

test('typing inside a callout keeps the text + the caret inside (no eject, round-trips)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [FIXTURE] as [string],
  )

  const frame = wf(workbox)
  await frame
    .locator('.vditor-ir blockquote[data-callout]')
    .first()
    .waitFor({ timeout: 60_000 })
  // the dual-node preview must be injected first (so we know editing then keeps the SOURCE visible)
  await frame
    .locator('.vditor-ir blockquote[data-callout] > .vmarkd-callout__preview')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1000)))

  const started = await enterCalloutBody(frame)
  expect(started, 'could not place the caret in the callout body').toContain(
    'editable body text',
  )
  await workbox.keyboard.type(' XYZ', { delay: 50 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 400)))

  const st = await frame.locator('body').evaluate(() => {
    const bq = document.querySelector(
      '.vditor-ir blockquote[data-callout]',
    ) as HTMLElement | null
    const src = bq?.querySelector(':scope > p') as HTMLElement | null
    const sel = window.getSelection()
    const anchor = sel?.rangeCount ? sel.anchorNode : null
    const host = anchor
      ? anchor.nodeType === 1
        ? (anchor as Element)
        : anchor.parentElement
      : null
    return {
      srcText: src?.textContent ?? null,
      srcVisible: src ? getComputedStyle(src).display !== 'none' : false,
      expanded: !!bq?.classList.contains('vditor-ir__node--expand'),
      caretInCallout: !!(
        anchor &&
        bq?.contains(anchor) &&
        !host?.closest('.vmarkd-callout__preview')
      ),
      value:
        (
          window as unknown as { vditor?: { getValue?: () => string } }
        ).vditor?.getValue?.() ?? '',
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[callout-edit] ${JSON.stringify(st)}`)

  expect(st.srcText).toContain('editable body text XYZ') // the typed text PERSISTED…
  expect(st.srcVisible).toBe(true) // …the source stayed visible (the bug collapsed it to display:none)…
  expect(st.expanded).toBe(true) // …the dual-node stayed expanded while editing…
  expect(st.caretInCallout).toBe(true) // …and the caret did NOT get ejected.
  expect(st.value).toContain('editable body text XYZ') // round-trips through Lute (host save path)
})

test('leaving the callout after editing re-syncs the preview to the final source', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [FIXTURE] as [string],
  )

  const frame = wf(workbox)
  await frame
    .locator('.vditor-ir blockquote[data-callout] > .vmarkd-callout__preview')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1000)))

  await enterCalloutBody(frame)
  await workbox.keyboard.type(' LEFT', { delay: 50 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 300)))

  // move the caret OUT by really clicking the trailing paragraph → fires Vditor's caret machinery +
  // our selectionchange handler → the callout collapses + its (skipped-while-editing) preview rebuilds.
  await frame
    .locator('.vditor-ir')
    .getByText('after paragraph')
    .click({ timeout: 30_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 500)))

  const r = await frame.locator('body').evaluate(() => {
    const bq = document.querySelector(
      '.vditor-ir blockquote[data-callout]',
    ) as HTMLElement | null
    const preview = bq?.querySelector(
      ':scope > .vmarkd-callout__preview',
    ) as HTMLElement | null
    return {
      expanded: !!bq?.classList.contains('vditor-ir__node--expand'),
      editing: !!bq?.hasAttribute('data-callout-editing'),
      previewText: preview?.textContent ?? null,
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[callout-edit-leave] ${JSON.stringify(r)}`)

  expect(r.expanded).toBe(false) // collapsed after the caret left
  expect(r.editing).toBe(false) // editing flag cleared
  expect(r.previewText).toContain('editable body text LEFT') // preview shows the edit, not stale text
})
