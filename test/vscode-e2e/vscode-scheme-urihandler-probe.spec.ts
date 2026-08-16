import { type EvaluateInVSCode, settle } from './webview-helpers'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'vscode-test-playwright'

// PROBE for task 359's adversarial follow-up: is bare `vscode:` a confused-deputy hole in the
// scheme allowlist (src/link-target.ts SAFE_SCHEMES)?
//
// `onOpenLink` (src/asset-link-actions.ts) passes an allowlisted `vscode:` href straight to
// `vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(href))`, unparsed, on the
// theory that it is "just" a real URI string, not a filesystem path. The open question: does
// `vscode.open` on `vscode://<publisher>.<extid>/...` route through VS Code's URI-HANDLER
// dispatch — the same mechanism auth-callback deep links use (`vscode.window.
// registerUriHandler`)? If it does, a markdown link in an UNTRUSTED document can invoke another
// extension's registered handler with attacker-controlled path/query, and nothing in our
// containment logic can defend against that — the target extension does the acting. This can only
// be settled empirically in a real webview + real URI-handler registration, not by reading docs.
//
// Method: register a throwaway `vscode.window.registerUriHandler` for THIS extension
// (spiochacz.vmarkd) in the extension host, record every `handleUri` call, then click a real
// `[x](vscode://spiochacz.vmarkd/probe-path?q=1)` link in the webview via the SAME code path
// `onOpenLink` uses (open-link -> classifyHref -> 'scheme' -> vscode.open(Uri.parse(href))) and
// see whether the handler fires and with what payload. Using our OWN extension's authority is
// sufficient to prove the DISPATCH MECHANISM — VS Code routes a vscode:// URI by its authority
// component to whichever extension registered a handler for that id; nothing about routing
// changes based on which document/webview the click originated from, so a positive result here
// generalises to "any installed extension's handler is reachable this way", and a negative result
// generalises to "the mechanism doesn't fire for this scheme/path shape at all".
//
// Pure measurement: no fix lives here, nothing is asserted pass/fail — the console output IS the
// deliverable. The task-359 classifier/task file are updated separately based on this result.
// @probe — excluded from the default run; run with `npm --prefix test/vscode-e2e run test:probes`.

const wf = (w: import('@playwright/test').Page) =>
  w
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')

async function registerProbeUriHandler(evaluateInVSCode: EvaluateInVSCode) {
  return evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      const g = globalThis as unknown as {
        __uriHandlerCalls?: {
          toString: string
          path: string
          query: string
          scheme: string
          authority: string
        }[]
        __uriHandlerDisposable?: { dispose(): void }
      }
      g.__uriHandlerCalls = []
      // Idempotent across runs in the same worker — registerUriHandler throws if called twice for
      // the same extension without disposing the first registration.
      g.__uriHandlerDisposable?.dispose()
      const ext = vscode.extensions.getExtension('spiochacz.vmarkd')
      await ext?.activate()
      try {
        g.__uriHandlerDisposable = vscode.window.registerUriHandler({
          handleUri(uri: import('vscode').Uri) {
            g.__uriHandlerCalls!.push({
              toString: uri.toString(),
              path: uri.path,
              query: uri.query,
              scheme: uri.scheme,
              authority: uri.authority,
            })
          },
        })
        return { registered: true, error: null }
      } catch (e) {
        return { registered: false, error: String(e) }
      }
    },
    [] as unknown as [string],
  ) as Promise<{ registered: boolean; error: string | null }>
}

async function readUriHandlerCalls(evaluateInVSCode: EvaluateInVSCode) {
  return evaluateInVSCode(
    async () => {
      return (
        (globalThis as unknown as { __uriHandlerCalls?: unknown[] })
          .__uriHandlerCalls ?? []
      )
    },
    [] as unknown as [string],
  ) as Promise<unknown[]>
}

let bootCount = 0

async function boot(
  evaluateInVSCode: EvaluateInVSCode,
  workbox: import('@playwright/test').Page,
) {
  const dir = path.join(
    tmpdir(),
    `vmarkd-urihandler-probe-${process.pid}-${bootCount++}`,
  )
  mkdirSync(dir, { recursive: true })
  const main = path.join(dir, 'main.md')
  writeFileSync(
    main,
    [
      '# URI handler probe',
      '',
      '- [probe link](vscode://spiochacz.vmarkd/probe-path?q=1&secret=attacker-controlled)',
      '',
    ].join('\n'),
  )
  await evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    },
    [] as unknown as [string],
  )
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [main] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await settle(frame, 1500)

  // Switch to WYSIWYG (real <a href>, the surface task 359 fixed the raw-href posting for).
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
  await settle(frame, 1000)

  return { dir, frame }
}

test('probe: does vscode.open(vscode://spiochacz.vmarkd/...) dispatch to a registered UriHandler? @probe', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)

  const reg = await registerProbeUriHandler(evaluateInVSCode)
  // eslint-disable-next-line no-console
  console.log(
    `[urihandler-probe] registerUriHandler result: ${JSON.stringify(reg)}`,
  )

  const { dir, frame } = await boot(evaluateInVSCode, workbox)

  // Real click on the real <a href>, ctrl-held per the task-62 modifier policy (WYSIWYG is
  // "editor content" — a plain click would edit, not open).
  await frame.locator('body').evaluate(() => {
    const a = document.querySelector<HTMLAnchorElement>(
      '.vditor-wysiwyg a[href]',
    )
    if (!a) throw new Error('probe link anchor not found')
    a.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
      }),
    )
  })
  await settle(frame, 2000)

  const calls = await readUriHandlerCalls(evaluateInVSCode)
  // eslint-disable-next-line no-console
  console.log(
    `[urihandler-probe] handleUri call count: ${calls.length}, payload: ${JSON.stringify(calls)}`,
  )

  // Cross-check: exercise the exact host code path directly too (open-link -> classifyHref ->
  // 'scheme' -> vscode.open(Uri.parse(href))), independent of the click/webview plumbing, in
  // case the click path has its own quirks that would muddy the dispatch-mechanism question.
  await evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand(
        'vscode.open',
        vscode.Uri.parse('vscode://spiochacz.vmarkd/probe-path-direct?q=2'),
      )
    },
    [] as unknown as [string],
  )
  await new Promise((r) => setTimeout(r, 1000))
  const callsAfterDirect = await readUriHandlerCalls(evaluateInVSCode)
  // eslint-disable-next-line no-console
  console.log(
    `[urihandler-probe] handleUri call count after DIRECT vscode.open (bypassing webview/click): ${callsAfterDirect.length}, payload: ${JSON.stringify(callsAfterDirect)}`,
  )

  rmSync(dir, { recursive: true, force: true })
})
