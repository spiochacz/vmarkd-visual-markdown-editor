import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { settle, stickySelection, wf } from './webview-helpers'

// Journey D8 (tasks/516-qa-journey-coverage-plan.md, Phase 4), probe-first — "Developer: Reload
// Webviews" (`workbench.action.webview.reloadWebviewAction`) tears down and re-creates every
// webview's iframe/content while leaving the VS Code TextDocument model (and its dirty state)
// alone. With an UNSAVED edit in the buffer, does the re-created webview repaint the still-dirty
// document content, or does it repaint stale/blank content because the custom editor's own webview
// state doesn't survive the reload? Correct behaviour is undefined anywhere in this codebase, so
// this MEASURES. `@probe`-tagged, excluded from every run tier including FULL (task 449 convention).
const SRC = path.join(__dirname, 'fixtures', 'dirty-close.md')
const MARKER = 'WEBVIEWRELOADMARKER'

type Vs = typeof import('vscode')

test('@probe probe: reload webviews with an unsaved edit — does content and dirty state survive', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  const original = readFileSync(SRC, 'utf8')
  const tmp = path.join(tmpdir(), 'vmarkd-webview-reload.md')
  writeFileSync(tmp, original)

  try {
    await evaluateInVSCode(
      async (vscode: Vs, args: [string]) => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors')
        await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(args[0]),
          'vmarkd.editor',
        )
      },
      [tmp] as [string],
    )
    const frame = wf(workbox)
    await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
    await settle(frame, 1000)

    await frame
      .locator('.vditor-ir')
      .first()
      .click({ position: { x: 4, y: 4 } })
    await stickySelection(
      frame,
      () => {
        const p = Array.from(document.querySelectorAll('.vditor-ir p')).find(
          (x) => x.textContent?.includes('Edit here'),
        ) as HTMLElement | undefined
        const t = p?.lastChild as Text | null
        if (!t) throw new Error('edit target not found')
        const r = document.createRange()
        r.setStart(t, (t.textContent ?? '').length)
        r.collapse(true)
        const s = window.getSelection()
        s?.removeAllRanges()
        s?.addRange(r)
        p?.focus()
      },
      null,
    )
    await workbox.keyboard.type(MARKER, { delay: 40 })

    const docState = () =>
      evaluateInVSCode(
        async (vscode: Vs, args: [string]) => {
          const doc = vscode.workspace.textDocuments.find(
            (d) => d.uri.fsPath === args[0],
          )
          return { isDirty: !!doc?.isDirty, text: doc?.getText() ?? '' }
        },
        [tmp] as [string],
      ) as Promise<{ isDirty: boolean; text: string }>

    await expect
      .poll(async () => (await docState()).isDirty, { timeout: 10_000 })
      .toBe(true)
    const beforeReload = await docState()
    console.log(
      `[webview-reload] BEFORE reload: isDirty=${beforeReload.isDirty} hasMarker=${beforeReload.text.includes(MARKER)}`,
    )

    // "Developer: Reload Webviews" — tears down and recreates every webview's content.
    await evaluateInVSCode(async (vscode: Vs) => {
      await vscode.commands.executeCommand(
        'workbench.action.webview.reloadWebviewAction',
      )
    })
    await new Promise((r) => setTimeout(r, 3000))

    const afterReloadDoc = await docState()
    console.log(
      `[webview-reload] AFTER reload: isDirty=${afterReloadDoc.isDirty} hasMarker=${afterReloadDoc.text.includes(MARKER)}`,
    )

    // Re-locate the webview iframe — it may be a genuinely new DOM node post-reload.
    const frameAfter = wf(workbox)
    const irCount = await frameAfter.locator('.vditor-ir').count()
    console.log(
      `[webview-reload] webview .vditor-ir present after reload: count=${irCount}`,
    )

    if (irCount > 0) {
      await frameAfter
        .locator('.vditor-ir')
        .first()
        .waitFor({ timeout: 30_000 })
      const webviewText = await frameAfter
        .locator('body')
        .evaluate(() => document.body.innerText.slice(0, 500))
      const webviewValue = await frameAfter
        .locator('body')
        .evaluate(() => (window as any).vditor?.getValue?.() ?? null)
      console.log(
        `[webview-reload] webview repainted text preview=${JSON.stringify(webviewText.slice(0, 200))} ` +
          `webviewGetValueHasMarker=${typeof webviewValue === 'string' ? webviewValue.includes(MARKER) : `N/A (${webviewValue})`}`,
      )
    } else {
      console.log(
        '[webview-reload] webview did NOT come back with .vditor-ir after reload',
      )
    }

    // Now try saving — does the (still?) dirty document, if any, save correctly post-reload?
    await evaluateInVSCode(async (vscode: Vs) => {
      await vscode.commands.executeCommand('workbench.action.files.save')
    })
    await new Promise((r) => setTimeout(r, 2000))
    const diskAfterSave = readFileSync(tmp, 'utf8')
    console.log(
      `[webview-reload] AFTER save post-reload: diskHasMarker=${diskAfterSave.includes(MARKER)} ` +
        `diskEqualsOriginal=${diskAfterSave === original}`,
    )
  } finally {
    rmSync(tmp, { force: true })
    await evaluateInVSCode(async (vscode: Vs) => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    })
  }
})
