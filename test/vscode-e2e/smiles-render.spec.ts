// SMILES render on a DIRECT WYSIWYG open. Lute flattens the `<code>`-wrapped smiles preview SVG to
// its style-text on the WYSIWYG DOM round-trip at mount, and `data-processed` sticks → the diagram
// "disappears" (showed the SVG's `<style>` CSS as raw text). smiles-render.ts repairs it from the
// editable source. This ONLY reproduces in the real VS Code webview (the headless harness never
// round-trips the drawn SVG) — so it lives here, run headless via `xvfb-run -a npx playwright test
// smiles-render.spec` (the repair LOGIC has a fast headless unit test in media-src/src/
// smiles-render.test.ts). To repro the user's exact "pierwsze otwarcie": open (default IR), switch
// to WYSIWYG (persists mode=wysiwyg), close, reopen → a DIRECT wysiwyg render.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

function webviewFrame(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('smiles renders on a direct WYSIWYG open (not flattened to style-text)', async ({
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
  let frame = webviewFrame(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1200)))

  // switch to WYSIWYG so the host persists mode=wysiwyg in globalState
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
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  // close, then reopen → DIRECT wysiwyg open (the user's "pierwsze otwarcie")
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await new Promise((r) => setTimeout(r, 900))
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [FIXTURE] as [string],
  )

  frame = webviewFrame(workbox)
  await frame.locator('.vditor-wysiwyg').first().waitFor({ timeout: 60_000 })
  // The repair observer redraws from source after the init round-trip flattens the svg — give it
  // a moment to settle.
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3500)))

  const info = await frame.locator('body').evaluate(() => {
    const box = (el: Element | null) =>
      el
        ? [
            Math.round(el.getBoundingClientRect().width),
            Math.round(el.getBoundingClientRect().height),
          ]
        : null
    const smCode = document.querySelector(
      '.vditor-wysiwyg__preview > code.language-smiles',
    ) as HTMLElement | null
    const smSvg = smCode?.querySelector('svg') ?? null
    const smScript = document.querySelector(
      'script[src*="smiles-drawer.min.js"]',
    ) as HTMLScriptElement | null
    return {
      directWysiwyg: !!document.querySelector('.vditor-wysiwyg'),
      smSvgPresent: !!smSvg,
      smSvgBox: box(smSvg),
      smScriptSrc: smScript?.src ?? '',
      visibleText: (smCode?.innerText ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60),
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[probe DIRECT] ${JSON.stringify(info)}`)
  expect(info.directWysiwyg).toBe(true)
  // The fix: smiles renders as an SVG on direct WYSIWYG open (not flattened to its style-text).
  expect(info.smSvgPresent).toBe(true)
  expect(info.smSvgBox?.[1] ?? 0).toBeGreaterThan(50)
  expect(info.visibleText).not.toContain('.element')
  // task 96 bump: the loaded engine is the vendored 2.3.0 (the `?v=` cache-buster patch emits it).
  expect(info.smScriptSrc).toContain('smiles-drawer.min.js?v=2.3.0')
})
