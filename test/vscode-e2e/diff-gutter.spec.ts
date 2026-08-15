// Git gutter (task 17) in the real editor: an edit to a tracked file paints exactly one `modified`
// bar, aligned with the block that changed.
//
// The bars only exist when the host can read the file's git-HEAD blob, and it does that through the
// built-in `vscode.git` extension's repository list (src/writeback/git-diff.ts `getHeadContent`).
// The test instance opens a throwaway `/tmp/pwtest-*` workspace, so that list is EMPTY: a fixture
// living inside this project's own checkout is invisible to it, `getHeadContent` returns null, and
// the gutter renders nothing no matter how correct the product is. That is why this spec failed on a
// clean `main` too (task 516 full-suite triage) — it was asserting a feature it never enabled.
//
// So build the precondition instead of assuming it: create a real one-file git repo in tmp/, commit
// the fixture content, register it with the git extension (`git.openRepository`), and wait until the
// API actually reports it. The repo is self-contained, so the assertion no longer depends on whether
// this project's own working tree happens to be clean.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { settle, wf } from './webview-helpers'

const REPO_DIR = path.join(
  __dirname,
  '..',
  '..',
  'tmp',
  'vscode-e2e',
  'diff-gutter-repo',
)
const TARGET = path.join(REPO_DIR, 'diff-list.md')
const COMMITTED = '- first item\n- second item\n- third item\n'

function makeRepo() {
  rmSync(REPO_DIR, { recursive: true, force: true })
  mkdirSync(REPO_DIR, { recursive: true })
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', REPO_DIR, ...args], { stdio: 'pipe' })
  git('init', '-q')
  git('config', 'user.email', 'e2e@example.com')
  git('config', 'user.name', 'vMarkd e2e')
  writeFileSync(TARGET, COMMITTED)
  git('add', 'diff-list.md')
  git('commit', '-q', '-m', 'fixture')
}

test('editing a list renders one modified gutter bar on the list', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  makeRepo()

  try {
    // Register the repo and wait for the git extension to report it — `git.openRepository` resolves
    // before the repository shows up in `getAPI(1).repositories`, and the host reads that list.
    await expect
      .poll(
        async () =>
          evaluateInVSCode(
            async (vscode, args) => {
              const [repoDir] = args as [string]
              await vscode.commands.executeCommand(
                'git.openRepository',
                repoDir,
              )
              const ext = vscode.extensions.getExtension('vscode.git')
              const exports = ext?.isActive
                ? ext.exports
                : await ext?.activate()
              const git = (exports as any)?.getAPI?.(1)
              return (git?.repositories ?? []).some((r: any) =>
                repoDir.startsWith(r.rootUri.fsPath),
              )
            },
            [REPO_DIR] as [string],
          ),
        {
          message: 'the git extension picked up the temp repo',
          timeout: 30_000,
        },
      )
      .toBe(true)

    await evaluateInVSCode(
      async (vscode, args) => {
        await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file((args as string[])[0]),
          'vmarkd.editor',
        )
      },
      [TARGET] as [string],
    )

    const frame = wf(workbox)
    await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
    await settle(frame, 1_500)

    await frame
      .locator('.vditor-ir')
      .first()
      .click({ position: { x: 4, y: 4 } })
    await frame.locator('body').evaluate(() => {
      const root = document.querySelector('.vditor-ir')
      const walker = document.createTreeWalker(
        root ?? document.body,
        NodeFilter.SHOW_TEXT,
      )
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent !== 'second item') continue
        const range = document.createRange()
        range.setStart(node, node.textContent.length)
        range.collapse(true)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        ;(node.parentElement as HTMLElement | null)?.focus()
        return
      }
      throw new Error('second list item not found')
    })
    await workbox.keyboard.type(' edited')
    await settle(frame, 2_000)

    const result = await frame.locator('body').evaluate(() => {
      const editor = document.querySelector('.vditor-ir .vditor-reset')
      const bars = Array.from(
        document.querySelectorAll('.me-diff-marker'),
      ) as HTMLElement[]
      const blocks = Array.from(editor?.children ?? []) as HTMLElement[]
      return {
        bars: bars.map((bar) => ({
          className: bar.className,
          top: bar.offsetTop,
        })),
        blocks: blocks
          .filter((block) => !block.classList.contains('me-diff-marker'))
          .map((block) => ({ text: block.textContent, top: block.offsetTop })),
      }
    })
    // eslint-disable-next-line no-console
    console.log(`[diff-gutter] ${JSON.stringify(result.bars)}`)

    expect(result.bars).toHaveLength(1)
    expect(result.bars[0].className).toContain('me-diff-marker--modified')
    const listBlock = result.blocks.find((block) =>
      block.text?.includes('second item edited'),
    )
    expect(listBlock).toBeDefined()
    expect(result.bars[0].top).toBe(listBlock?.top)
  } finally {
    rmSync(REPO_DIR, { recursive: true, force: true })
  }
})
