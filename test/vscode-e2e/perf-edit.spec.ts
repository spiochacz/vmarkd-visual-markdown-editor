// Edit-responsiveness quick-wins (task 171) — real VS Code. The bundle removes wasted work on the
// input path (a discarded full-doc serialize on the IR space fast-path + WYSIWYG/SV; a second spin
// via renderToc per keystroke). It is SUBTRACTIVE, so the e2e proves it didn't break the two things
// that path is responsible for: (1) edits still propagate to the host TextDocument (the gated
// `options.input()` still fires editSync), and (2) the ToC still refreshes after the edit settles
// (renderToc is now deferred, not skipped). Only reproducible with the real custom-editor pipeline.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'perf-edit.md')

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
    .evaluate(() => new Promise((r) => setTimeout(r, 1000)))
  return frame
}

// Read the host-side TextDocument text (proves a webview edit reached the host via editSync→applyEdit).
const readDoc = (
  evaluateInVSCode: (fn: unknown, args: unknown) => Promise<unknown>,
) =>
  evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      const [uri] = args
      const doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.fsPath === uri,
      )
      return doc ? doc.getText() : ''
    },
    [FIXTURE],
  ) as Promise<string>

test('IR space-path typing still propagates to the host document (item 1)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const frame = await open(workbox, evaluateInVSCode)

  // type prose WITH SPACES at the end of the paragraph — this is exactly the startSpace/endSpace
  // fast-path whose discarded full-doc serialize item 1 gated away. The edit must still reach the host.
  await frame.locator('.vditor-ir').getByText('edit here').click()
  await workbox.keyboard.press('End')
  await workbox.keyboard.type(' alpha beta gamma', { delay: 50 })
  // let editSync debounce + the host applyEdit settle
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))

  const text = await readDoc(evaluateInVSCode)
  // eslint-disable-next-line no-console
  console.log(`[perf-edit] host doc tail: ${JSON.stringify(text.slice(-60))}`)
  expect(text).toContain('edit here alpha beta gamma') // edit reached the host TextDocument
})

test('typing a new heading still gets an outline id after the deferred renderToc settles (item 2)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const frame = await open(workbox, evaluateInVSCode)

  // renderToc → outlineRender assigns each heading an `ir-<slug>_<index>` id (the numeric suffix is the
  // GLOBAL heading index, which only outlineRender knows — the per-block spin can't). So a new heading
  // getting that id proves the now-DEFERRED renderToc still flushed on settle. (`[toc]` renders no
  // block in IR — confirmed by probe — so the id is the reliable observable, not a toc element.)
  const newHeadingId = () =>
    frame.locator('body').evaluate(() => {
      const ir = (
        window as unknown as {
          vditor?: { vditor?: { ir?: { element?: HTMLElement } } }
        }
      ).vditor?.vditor?.ir?.element
      const h = Array.from(ir?.querySelectorAll('h2') ?? []).find((x) =>
        x.textContent?.includes('Section two'),
      )
      return (h as HTMLElement | undefined)?.id ?? ''
    })

  await frame.locator('.vditor-ir').getByText('edit here').click()
  await workbox.keyboard.press('End')
  await workbox.keyboard.press('Enter')
  await workbox.keyboard.type('## Section two', { delay: 50 })

  // after the edit settles, the deferred renderToc flush assigns the new heading its outline id
  await expect
    .poll(newHeadingId, { timeout: 15_000, intervals: [300, 600, 1000] })
    .toMatch(/^ir-.*_\d+$/)

  // and the heading round-trips to the host document
  const text = await readDoc(evaluateInVSCode)
  expect(text).toContain('## Section two')
})

test('WYSIWYG typing still propagates to the host document (item 4)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const frame = await open(workbox, evaluateInVSCode)

  // switch IR → WYSIWYG via the edit-mode toolbar (same path as callouts-mode.spec.ts)
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
  await frame.locator('.vditor-wysiwyg').first().waitFor({ timeout: 30_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1200)))

  await frame.locator('.vditor-wysiwyg').getByText('edit here').click()
  await workbox.keyboard.press('End')
  await workbox.keyboard.type(' wysiwyg edit', { delay: 50 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))

  const text = await readDoc(evaluateInVSCode)
  // eslint-disable-next-line no-console
  console.log(
    `[perf-edit] wysiwyg host doc tail: ${JSON.stringify(text.slice(-60))}`,
  )
  expect(text).toContain('edit here wysiwyg edit') // the WYSIWYG gated path still reaches the host
})
