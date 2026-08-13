import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { settle, wf } from './webview-helpers'

// Task 519 diagnostic — WHO rebuilds the heading block and drops its trailing space?
//
// Two rounds of elimination (instrumenting gap-paragraph.ts's invariants and message-router.ts's
// setValue path) came up empty: neither fired at ANY of the four block rebuilds visible in the
// keystroke trace. So instead of guessing at more call sites, this wraps Lute's own entry points
// AT RUNTIME — from the test, with no product-source edit at all — and captures a stack for every
// call. Whoever rebuilds the block has to come through one of these.
type Vs = typeof import('vscode')
const TMP = path.join(tmpdir(), 'vmarkd-519-caller.md')

interface LuteCall {
  fn: string
  argHasTrailingSpace: boolean
  retHasTrailingSpace: boolean
  stack: string
}

test('@probe who calls Lute when the heading space disappears', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  writeFileSync(TMP, '')
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
      [TMP] as [string],
    )
    const frame = wf(workbox)
    await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
    await settle(frame, 2500)

    // Wrap every Lute md<->DOM entry point, recording a stack per call.
    await frame.locator('body').evaluate(() => {
      const w = window as unknown as {
        // The global is the Vditor CLASS instance; the IVditor internals (lute included) live one
        // level down on `.vditor` — the same shape `vditor.vditor.undo` is reached by elsewhere.
        vditor?: {
          lute?: Record<string, unknown>
          vditor?: { lute?: Record<string, unknown> }
        }
        __luteCalls?: unknown[]
      }
      w.__luteCalls = []
      const lute = w.vditor?.vditor?.lute ?? w.vditor?.lute
      if (!lute) {
        throw new Error(
          `no lute; window.vditor keys=${JSON.stringify(Object.keys(w.vditor ?? {}))} inner=${JSON.stringify(Object.keys(w.vditor?.vditor ?? {}))}`,
        )
      }
      for (const fn of [
        'SpinVditorIRDOM',
        'Md2VditorIRDOM',
        'VditorIRDOM2Md',
        'Md2VditorDOM',
        'SpinVditorDOM',
      ]) {
        const orig = lute[fn]
        if (typeof orig !== 'function') continue
        lute[fn] = function wrapped(this: unknown, ...args: unknown[]) {
          const ret = (orig as (...a: unknown[]) => unknown).apply(this, args)
          const a = String(args[0] ?? '')
          const r = String(ret ?? '')
          // Log raw tails rather than a cleverness: an earlier version tested for a trailing
          // space with a regex and reported "false" on every call, because in the IR DOM a `<wbr>`
          // caret marker sits BETWEEN the space and `</h1>`. Read the text, don't pattern-match it.
          w.__luteCalls?.push({
            fn,
            argHasTrailingSpace: a.slice(-60),
            retHasTrailingSpace: r.slice(-60),
            stack: new Error().stack?.split('\n').slice(1, 6).join(' | ') ?? '',
          })
          return ret
        }
      }
    })

    await frame.locator('.vditor-ir').first().click()
    await workbox.keyboard.type('# Untitled journey', { delay: 60 })
    await settle(frame, 2000)

    const calls = (await frame
      .locator('body')
      .evaluate(
        () =>
          (window as unknown as { __luteCalls?: LuteCall[] }).__luteCalls ?? [],
      )) as LuteCall[]

    const text = await evaluateInVSCode(
      async (vscode: Vs, args: [string]) =>
        vscode.workspace.textDocuments
          .find((d) => d.uri.fsPath === args[0])
          ?.getText() ?? '',
      [TMP] as [string],
    )
    console.log(`[519-caller] final document: ${JSON.stringify(text)}`)
    console.log(`[519-caller] ${calls.length} lute calls`)
    for (const [i, c] of calls.entries()) {
      console.log(
        `[519-caller] #${i} ${c.fn}\n  IN : ${JSON.stringify(c.argHasTrailingSpace)}\n  OUT: ${JSON.stringify(c.retHasTrailingSpace)}\n  AT : ${c.stack}`,
      )
    }
    expect(true).toBe(true)
  } finally {
    rmSync(TMP, { force: true })
  }
})
