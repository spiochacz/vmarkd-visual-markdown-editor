// C4 (tasks/516 Phase 4) — the emoji toolbar submenu opens (covered by toolbar-overflow.spec.ts's
// ARIA/keyboard-reachability tests) but nothing asserts that CLICKING an emoji actually reaches the
// saved document. This closes that gap: open the emoji picker, click a known default emoji
// ("smile" → 😄, from Vditor's built-in `hint.emoji` map — media-src/node_modules/vditor/src/ts/
// util/Options.ts), and assert the saved TextDocument contains it.
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { settle, wf } from './webview-helpers'

type Vs = typeof import('vscode')

test('clicking an emoji in the toolbar picker inserts it into the saved document', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  const target = path.join(tmpdir(), `vmarkd-emoji-insert-${Date.now()}.md`)
  writeFileSync(target, '')

  try {
    await evaluateInVSCode(
      async (vscode: Vs, args: [string]) => {
        await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(args[0]),
          'vmarkd.editor',
        )
      },
      [target] as [string],
    )
    const frame = wf(workbox)
    await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
    await settle(frame, 300)

    // Place a REAL caret first: a user clicks into the document before reaching for the toolbar,
    // and an insertion with no caret has nowhere to land. (Task 518's lesson, the expensive way.)
    await frame.locator('.vditor-ir').click({ position: { x: 20, y: 12 } })
    await workbox.keyboard.type('Emoji: ', { delay: 40 })
    await settle(frame, 300)

    const toolbar = frame.locator('.vditor-toolbar')
    // Emoji is first to overflow into "more" on a narrow toolbar (toolbar-overflow.spec.ts) — on
    // the default test-window width it should still be a direct row item, but fall back to
    // opening "more" first if it isn't, so this doesn't depend on incidental window sizing.
    let emojiTrigger = toolbar.locator(
      '.vditor-toolbar__item:has([data-type="emoji"])',
    )
    if (!(await emojiTrigger.isVisible().catch(() => false))) {
      await toolbar.locator('[data-type="more"]').click()
      emojiTrigger = toolbar.locator(
        '.vmarkd-toolbar-more [data-vmarkd-overflow="true"]:has([data-type="emoji"])',
      )
      await emojiTrigger.waitFor({ state: 'visible', timeout: 10_000 })
    }
    await emojiTrigger.locator('[data-type="emoji"]').click()

    const panel = emojiTrigger.locator('.vditor-panel')
    await expect(panel).toBeVisible()
    const smileButton = panel.locator('.vditor-emojis button[data-key="smile"]')
    await expect(smileButton).toBeVisible()
    await smileButton.click()

    // Vditor hides the panel and re-renders the block synchronously on click (Emoji.ts's own
    // handler), but the host sync is NOT a flat 250ms: IR mode's own internal debounce
    // (ir/process.ts's processAfterRender, keyed off `vditor.options.undoDelay` — 800ms,
    // DEFAULT_UNDO_DELAY in edit-sync-tuning.ts) has to fire FIRST, calling our `input` hook,
    // before edit-sync's 250ms debounce (edit-sync.ts) even starts — a designed ~1.05s worst
    // case for one discrete edit, not a bug (measured directly via an instrumented probe: the
    // saved doc is provably correct — DOM + `vditor.getValue()` — within ~200ms of the click;
    // only the HOST's copy lags on Vditor's own debounce). Poll instead of a fixed sleep so this
    // isn't sensitive to the exact interleaving of Vditor's two debounce stages.
    let text = '<not found>'
    await expect
      .poll(
        async () => {
          text = await evaluateInVSCode(
            async (vscode: Vs, args: [string]) =>
              vscode.workspace.textDocuments
                .find((d) => d.uri.fsPath === args[0])
                ?.getText() ?? '<not found>',
            [target] as [string],
          )
          return text
        },
        { timeout: 15_000, intervals: [250, 500] },
      )
      .toMatch(/😄|:smile:/)
    console.log(`[emoji] document after insert: ${JSON.stringify(text)}`)
    // Vditor may serialize either the unicode char or its :shortcode: — accept either, the
    // journey is "the picker puts the emoji into the saved document".
    expect(text).toMatch(/😄|:smile:/)
  } finally {
    rmSync(target, { force: true })
  }
})
