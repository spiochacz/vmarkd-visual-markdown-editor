// TEMP diagnostic for task 519 — logs block textContent + vditor.getValue() after EVERY
// keystroke of "# Untitled journey" in a real VS Code webview, to find the exact keystroke
// where the inter-word space disappears and whether it disappears from the DOM or only from
// getValue()'s markdown serialization first. Not a regression test — delete after the bug is
// diagnosed (see heading-space-drop.spec.ts for the permanent pin).
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { settle, wf } from './webview-helpers'

type Vs = typeof import('vscode')

test('@probe diagnose: per-keystroke DOM + getValue trace', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  const target = path.join(
    tmpdir(),
    `vmarkd-space-drop-diag-${Date.now()}.md`,
  )
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

    await frame.locator('.vditor-ir').click({ position: { x: 20, y: 12 } })
    await settle(frame, 200)

    // Install an IN-PAGE MutationObserver + input-event logger BEFORE typing, so the trace is
    // captured synchronously in the same task as the browser's native DOM edit — no Playwright
    // round-trip latency to hide a "lands then vanishes a few ms later" sequence.
    await frame.locator('body').evaluate(() => {
      const w = window as unknown as {
        __spaceDropLog?: Array<Record<string, unknown>>
        vditor?: { getValue: () => string }
      }
      w.__spaceDropLog = []
      // Bisect hook (task 519): gap-paragraph.ts and message-router.ts push here — TEMP,
      // installed from the diagnostic so production stays a no-op check.
      ;(window as unknown as { __spaceDropTrace?: unknown[] }).__spaceDropTrace =
        w.__spaceDropLog
      const blockText = () =>
        (
          document.querySelector(
            '.vditor-ir [data-block="0"]',
          ) as HTMLElement | null
        )?.textContent ?? null
      const editor = document.querySelector('.vditor-ir') as HTMLElement
      new MutationObserver((records) => {
        w.__spaceDropLog?.push({
          t: performance.now(),
          kind: 'mutation',
          mutCount: records.length,
          types: records.map((r) => r.type).join(','),
          text: blockText(),
        })
      }).observe(editor, {
        childList: true,
        subtree: true,
        characterData: true,
      })
      document.addEventListener(
        'input',
        () => {
          w.__spaceDropLog?.push({
            t: performance.now(),
            kind: 'input-event',
            text: blockText(),
            getValue: w.vditor?.getValue?.() ?? null,
          })
        },
        true,
      )
      document.addEventListener(
        'keydown',
        (e) => {
          w.__spaceDropLog?.push({
            t: performance.now(),
            kind: 'keydown',
            key: (e as KeyboardEvent).key,
          })
        },
        true,
      )
    })

    // Type the WHOLE phrase in one go (real delay, matching the pinning spec) — the in-page log
    // captures every intermediate event, so there's no need to round-trip after each char.
    await workbox.keyboard.type('# Untitled journey', { delay: 60 })
    await settle(frame, 500)

    const log = (await frame.locator('body').evaluate(() => {
      return (
        window as unknown as { __spaceDropLog: Array<Record<string, unknown>> }
      ).__spaceDropLog
    })) as Array<Record<string, unknown>>
    console.log(JSON.stringify(log, null, 0))

    const finalText = await evaluateInVSCode(
      async (vscode: Vs, args: [string]) =>
        vscode.workspace.textDocuments
          .find((d) => d.uri.fsPath === args[0])
          ?.getText() ?? '<not found>',
      [target] as [string],
    )
    console.log('FINAL TextDocument:', JSON.stringify(finalText))
    expect(true).toBe(true)
  } finally {
    rmSync(target, { force: true })
  }
})
