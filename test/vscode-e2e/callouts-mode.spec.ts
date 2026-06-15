import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Callouts must stay coloured across edit-mode switches (and preview round-trips). observeCallouts
// is wired once at init; binding it to the active-mode element only covered THAT mode, so a user in
// (or switching to) WYSIWYG — especially after a Preview round-trip — lost the callout colouring
// ("przy przełączaniu preview ↔ wysiwyg znika kolorowanie calloutów"). Binding the observer to the
// stable #app mount covers IR + WYSIWYG regardless of mode. This test switches IR→WYSIWYG and
// asserts the WYSIWYG callouts are decorated + coloured — it FAILS on the old (per-mode) wiring,
// which left WYSIWYG callouts undecorated. Real-VS-Code because it depends on the live mode DOM.
const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

function webviewFrame(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('callouts stay coloured in WYSIWYG after switching from IR', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.workspace
        .getConfiguration('vmarkd')
        .update('theme.content', 'vscode-dark-2026', true)
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [FIXTURE] as [string],
  )
  const frame = webviewFrame(workbox)
  await frame
    .locator('.vditor-ir [data-callout]')
    .first()
    .waitFor({ timeout: 45_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1200)))

  // Switch IR → WYSIWYG via the edit-mode toolbar panel.
  await frame.locator('body').evaluate(() => {
    const v = (
      window as unknown as {
        vditor: {
          vditor: { toolbar: { elements: Record<string, HTMLElement> } }
        }
      }
    ).vditor.vditor
    v.toolbar.elements['edit-mode']?.children[0]?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    document
      .querySelector('button[data-mode="wysiwyg"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))

  const wy = await frame.locator('body').evaluate(() => {
    const root = document.querySelector('.vditor-wysiwyg')
    const decorated = Array.from(
      (root || document).querySelectorAll('blockquote[data-callout]'),
    )
    const first = decorated[0] as HTMLElement | undefined
    const marker = (root || document).querySelector(
      'blockquote[data-callout] .vmarkd-callout__marker',
    ) as HTMLElement | null
    return {
      decorated: decorated.length,
      border: first ? getComputedStyle(first).borderLeftColor : 'NONE',
      borderWidth: first ? getComputedStyle(first).borderLeftWidth : 'NONE',
      // The IR dual-node preview must NOT be injected in WYSIWYG (no expandMarker there → it would
      // duplicate the callout content + add a stray scroll container). Colour classes only.
      injectedPreviews: (root || document).querySelectorAll(
        'blockquote[data-callout] > .vditor-ir__preview',
      ).length,
      // WYSIWYG callouts show a non-editable title label (the type picker lives in Vditor's block
      // popover; the raw `[!TYPE]` marker is hidden, kept in the source for round-trip)…
      titles: (root || document).querySelectorAll(
        'blockquote[data-callout] > .vmarkd-callout__title',
      ).length,
      markerHidden: marker ? getComputedStyle(marker).display === 'none' : null,
    }
  })

  // eslint-disable-next-line no-console
  console.log(`[callouts-mode] ${JSON.stringify(wy)}`)

  // Old per-mode wiring → 0 here. With the #app observer the WYSIWYG callouts are decorated…
  expect(wy.decorated).toBeGreaterThan(0)
  // …and visibly coloured (a real left accent border, not the default/none).
  expect(wy.border).not.toBe('NONE')
  expect(wy.border).not.toBe('rgb(0, 0, 0)')
  expect(wy.borderWidth).not.toBe('0px')
  // …with NO injected IR dual-node preview in WYSIWYG (would duplicate content + add a 2nd scroll).
  expect(wy.injectedPreviews).toBe(0)
  // …each WYSIWYG callout shows a non-editable title label, and the raw `[!TYPE]` marker is hidden.
  expect(wy.titles).toBeGreaterThan(0)
  expect(wy.markerHidden).toBe(true)
})
