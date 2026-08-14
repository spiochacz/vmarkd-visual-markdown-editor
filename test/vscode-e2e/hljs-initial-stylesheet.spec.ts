import { wf } from './webview-helpers'
// Task 431 (option 2) — the hljs stylesheet now ships in the initial HTML (html-builder.ts), instead of
// being created for the first time at runtime by Vditor's setCodeTheme inside after().
//
// The load-bearing property is NOT "a link exists at the end" — it is that the link the host emitted is
// the SAME element Vditor then accepts. `setCodeTheme` compares the raw `href` attribute and, on any
// mismatch, does `link.remove()` + re-add (vditor/src/ts/ui/setCodeTheme.ts:12) — which would restore the
// exact stylesheet-swap window this change exists to close, while still passing a naive
// "is there a link?" assertion. So this spec pins:
//   1. the emitted href resolves to a LOCAL asset that actually loaded (`link.sheet` is non-null), and
//   2. the element was never replaced — proven by stamping the node and checking the stamp survives.
//
// Runs against material-dark (paired atom-one-dark) rather than the default, so the assertion exercises
// the content-theme pairing path in the shared resolver, not just the `github` fallback.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings } from './settings-helpers'

const DOC = path.join(__dirname, 'fixtures', 'frontmatter-code.md')

usePinnedSettings(test, { 'vmarkd.theme.content': 'material-dark' })

test('the hljs stylesheet ships in the initial HTML and Vditor never tears it down (task 431)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(180_000)
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [DOC] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })

  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 4000)))

  const state = await frame.locator('body').evaluate(() => {
    const el = document.getElementById(
      'vditorHljsStyle',
    ) as HTMLLinkElement | null
    const head = [...document.head.children]
    return {
      present: !!el,
      // The teardown signal, observable AFTER the fact: the host emits this link BEFORE the user-CSS
      // <style> blocks, whereas `addStyle` APPENDS to <head>. So if setCodeTheme disagreed with our
      // href and did remove() + re-add, the link ends up after them. (Stamping the node instead does
      // not work — by the time a spec can reach the frame, any teardown has already happened and the
      // stamp would land on the replacement.)
      beforeUserCss:
        !!el &&
        head.indexOf(el) <
          head.findIndex(
            (n) => n.id === 'custom-css' || n.id === 'external-css',
          ),
      href: el?.getAttribute('href') ?? '',
      // Non-null only once the stylesheet has actually loaded and parsed.
      loaded: !!el?.sheet,
      count: document.querySelectorAll('#vditorHljsStyle').length,
    }
  })

  console.log(`[task 431] ${JSON.stringify(state)}`)
  expect(state.present, 'the hljs stylesheet link is in the document').toBe(
    true,
  )
  expect(
    state.beforeUserCss,
    'the link is still in its HOST-emitted position (before the user-CSS blocks) — i.e. setCodeTheme accepted it instead of removing and re-appending it, which is what a byte-mismatched href would cause',
  ).toBe(true)
  expect(state.loaded, 'the stylesheet actually loaded (local asset)').toBe(
    true,
  )
  expect(state.count, 'exactly one hljs stylesheet link').toBe(1)
  expect(
    state.href,
    'material-dark resolves to its paired atom-one-dark style through the shared resolver',
  ).toContain('/styles/atom-one-dark.min.css')
  expect(state.href, 'no cache-bust suffix').not.toContain('?')
})
