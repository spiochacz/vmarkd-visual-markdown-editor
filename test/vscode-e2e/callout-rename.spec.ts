// An UNKNOWN callout type must render as RAW blockquote text, not a styled (blue) callout — like
// GitHub, only known alert names are callouts (user: "niepoprawny typ powinien być surowym tekstem").
// Covers both the static case and renaming a valid callout to an unknown type. Real VS Code (IR).
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'callout-edit-name.md')

function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

async function open(
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: (fn: unknown, args: unknown) => Promise<unknown>,
) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      const [uri] = args
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [FIXTURE],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1200)))
  return frame
}

test('an unknown callout type [!TIPs] is NOT a styled callout — raw blockquote text', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const frame = await open(workbox, evaluateInVSCode)
  const r = await frame.locator('body').evaluate(() => {
    const ir = (
      window as unknown as {
        vditor?: { vditor?: { ir?: { element?: HTMLElement } } }
      }
    ).vditor?.vditor?.ir?.element
    const types = Array.from(
      ir?.querySelectorAll('blockquote[data-callout]') ?? [],
    ).map((b) => b.getAttribute('data-callout'))
    // the blockquote whose source mentions [!TIPs] — is it decorated as a callout?
    const tipsBq = Array.from(ir?.querySelectorAll('blockquote') ?? []).find(
      (b) => (b.textContent ?? '').includes('[!TIPs]'),
    )
    return {
      decoratedTypes: types, // should contain 'tip' (valid) but NOT 'tips' (unknown)
      tipsIsCallout: !!tipsBq?.hasAttribute('data-callout'),
      tipsShowsRawMarker: (tipsBq?.textContent ?? '').includes('[!TIPs]'),
      tipsKeepsBody: (tipsBq?.textContent ?? '').includes('invalid type body'),
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[callout-rename] static ${JSON.stringify(r)}`)
  expect(r.decoratedTypes).toContain('tip') // the valid one renders as a callout
  expect(r.decoratedTypes).not.toContain('tips') // the unknown one does NOT
  expect(r.tipsIsCallout).toBe(false) // [!TIPs] stays a plain blockquote
  expect(r.tipsShowsRawMarker).toBe(true) // showing the raw `[!TIPs]` text…
  expect(r.tipsKeepsBody).toBe(true) // …and its body (nothing lost)
})

test('renaming a valid callout to an unknown type turns it into raw text (body kept)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const frame = await open(workbox, evaluateInVSCode)
  // expand the VALID [!TIP] callout + caret right before the marker's "]"
  const placed = await frame.locator('body').evaluate(() => {
    const ir = (
      window as unknown as {
        vditor?: { vditor?: { ir?: { element?: HTMLElement } } }
      }
    ).vditor?.vditor?.ir?.element
    const bq = Array.from(
      ir?.querySelectorAll('blockquote[data-callout="tip"]') ?? [],
    )[0] as HTMLElement | undefined
    if (!bq) return false
    bq.classList.add('vditor-ir__node--expand')
    const t = bq.querySelector(':scope > p')?.firstChild as Text | null
    const idx = t?.data.indexOf(']') ?? -1
    if (!t || idx < 0) return false
    ir?.focus()
    const range = document.createRange()
    range.setStart(t, idx)
    range.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    return true
  })
  expect(placed).toBe(true)
  await workbox.keyboard.type('s', { delay: 60 }) // [!TIP] → [!TIPs] (unknown)
  await frame.locator('.vditor-ir').getByText('after paragraph').click()
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 700)))

  const r = await frame.locator('body').evaluate(() => {
    const ir = (
      window as unknown as {
        vditor?: {
          getValue?: () => string
          vditor?: { ir?: { element?: HTMLElement } }
        }
      }
    ).vditor
    const el = ir?.vditor?.ir?.element
    const bq = Array.from(el?.querySelectorAll('blockquote') ?? []).find((b) =>
      (b.textContent ?? '').includes('[!TIPs]'),
    )
    return {
      isCallout: !!bq?.hasAttribute('data-callout'),
      text: (bq?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      value: ir?.getValue?.() ?? '',
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[callout-rename] dynamic ${JSON.stringify(r)}`)
  expect(r.isCallout).toBe(false) // the renamed-to-unknown block is no longer a callout
  expect(r.text).toContain('[!TIPs]') // raw marker shown
  expect(r.text).toContain('valid tip body') // body kept (as raw text, not lost)
  expect(r.value).toContain('[!TIPs]') // round-trips
})
