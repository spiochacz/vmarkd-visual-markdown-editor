import { docText, settle, wf } from './webview-helpers'
// C6 (task 516) — HTML-comment editing. Unit (html-comment.test.ts) and the chromium harness
// cover the DECORATION (collapsed `<!-- ... -->` shown as visible text via
// `applyCommentPreviews`/`decorateHtmlBlock`, media-src/src/editing/html-comment.ts); no
// real-VS-Code journey drives a caret INTO the comment, edits the raw markers, and checks the
// saved bytes. This is the one C-phase journey with an OWNED mechanism to break for a red proof
// (unlike C2/C3, which are pure Lute round-trips) — see the second test.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const SRC = path.join(__dirname, 'fixtures', 'html-comment-edit.md')
const TEMP_DIR = path.join(__dirname, '..', '..', 'tmp', 'vscode-e2e')
mkdirSync(TEMP_DIR, { recursive: true })

async function open(
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: (fn: unknown, args: [string]) => Promise<unknown>,
  file: string,
) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [file] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('.vditor-ir [data-type="html-block"]')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 4, y: 4 } })
  await settle(frame, 300)
  return frame
}

// The collapsed preview text vmarkd's decoration injects (html-comment.ts's decorateHtmlBlock).
async function previewText(frame: ReturnType<typeof wf>): Promise<string> {
  return frame
    .locator('body')
    .evaluate(
      () =>
        document.querySelector(
          '.vditor-ir [data-type="html-block"] .vmarkd-comment',
        )?.textContent ?? '',
    )
}

async function expandAndPlaceCaretAfter(
  frame: ReturnType<typeof wf>,
  anchor: string,
) {
  // NOT stickySelection (2026-08-15): this caret goes INSIDE an expanded IR source, and the
  // helper's verification wait is long enough for the node to re-collapse — the keystrokes then land
  // in the rendered preview. Measured: this spec failed through the helper and passes with the plain
  // write. Editing an expanded IR source has to type IMMEDIATELY after the caret lands.
  return frame.locator('body').evaluate((_el, anchor) => {
    const node = document.querySelector(
      '.vditor-ir [data-type="html-block"]',
    ) as HTMLElement | null
    if (!node) return false
    node.classList.add('vditor-ir__node--expand')
    const source = node.querySelector(
      'pre.vditor-ir__marker--pre, .vditor-ir__marker--pre',
    ) as HTMLElement | null
    if (!source) return false
    const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT)
    let target: Text | null = null
    for (
      let n = walker.nextNode() as Text | null;
      n;
      n = walker.nextNode() as Text | null
    ) {
      if (n.textContent?.includes(anchor)) {
        target = n
        break
      }
    }
    if (!target) return false
    const idx = (target.textContent ?? '').indexOf(anchor) + anchor.length
    const r = document.createRange()
    r.setStart(target, idx)
    r.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
    source.focus()
    return true
  }, anchor)
}

test('caret-in reveals the raw comment markers; editing round-trips on save', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const tmp = path.join(TEMP_DIR, 'vmarkd-html-comment-edit.md')
  writeFileSync(tmp, readFileSync(SRC, 'utf8'))
  const frame = await open(workbox, evaluateInVSCode, tmp)

  // Collapsed: our decoration shows the styled preview text, not raw markers.
  const collapsed = await previewText(frame)
  // eslint-disable-next-line no-console
  console.log(
    `[html-comment-edit] collapsed preview: ${JSON.stringify(collapsed)}`,
  )
  expect(collapsed).toContain('Original comment body')

  const placed = await expandAndPlaceCaretAfter(frame, 'Original comment body')
  expect(
    placed,
    'expanded the node and placed the caret in the raw source',
  ).toBe(true)
  await workbox.keyboard.type(' plus edit', { delay: 40 })
  // Leave the node — collapses again, decoration re-applies.
  await frame.locator('.vditor-ir').getByText('untouched by any edit').click()
  await settle(frame, 500)

  await expect
    .poll(
      async () => (await docText(evaluateInVSCode, tmp)).includes('plus edit'),
      { message: 'the comment edit reached the saved TextDocument' },
    )
    .toBe(true)

  const recollapsed = await previewText(frame)
  // eslint-disable-next-line no-console
  console.log(
    `[html-comment-edit] recollapsed preview: ${JSON.stringify(recollapsed)}`,
  )
  expect(
    recollapsed,
    'the decoration re-applies with the edited text',
  ).toContain('plus edit')

  await evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand('workbench.action.files.save')
    },
    [] as [string],
  )
  await settle(frame, 500)
  const saved = readFileSync(tmp, 'utf8')
  rmSync(tmp, { force: true })
  // eslint-disable-next-line no-console
  console.log(`[html-comment-edit] saved: ${JSON.stringify(saved)}`)

  expect(saved, 'the comment markers are still real markers').toMatch(
    /<!--[\s\S]*plus edit[\s\S]*-->/,
  )
  expect(saved, 'the original body text survived').toContain(
    'Original comment body',
  )
  expect(saved, 'the untouched paragraph is unchanged').toContain(
    'Paragraph after the comment, untouched by any edit in this spec.',
  )
})
