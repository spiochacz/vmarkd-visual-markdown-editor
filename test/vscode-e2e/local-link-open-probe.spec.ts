import { type EvaluateInVSCode, settle } from './webview-helpers'
import { rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'vscode-test-playwright'

// PROBE for task 359 (planned — probe-first). Pure measurement: no fix lives here.
//
// Task 359 alleges two bugs in `onOpenLink` (src/asset-link-actions.ts):
//   #1 `Uri.parse(local)` on a filesystem path — wrong constructor, mis-splits `#`/`?`/`%`.
//   #2 the webview posts a browser-RESOLVED href (`HTMLAnchorElement.href` is always
//      absolute). Since the webview's `<base href>` points at the doc directory's
//      vscode-resource URL (markdown-editor-provider.ts:179), a relative `./sibling.md`
//      resolves to `https://file+…vscode-resource…/sibling.md` — which then matches
//      `onOpenLink`'s `/^https?:/` test and routes to `env.openExternal` instead of the
//      local-file branch. Flagged "must be probed before fixing — CSP/<base href> may
//      already neutralise it."
//
// This probe answers, per surface (WYSIWYG, Preview-via-split-SV; IR is a different DOM
// shape covered by source reading, see link-click.ts), for a relative link, an anchor-only
// link, a mailto link and an http link:
//   (a) what raw `getAttribute('href')` the anchor carries,
//   (b) what `open-link` href the webview ACTUALLY posts today (window.vscode.postMessage
//       is wrapped to record, but still forwards — severing the host would only prove #2,
//       not which host branch runs, which is the blocking question),
//   (c) which host branch ran, inferred from `vscode.window.tabGroups` (a new tab with the
//       resolved fsPath ⇒ local-open branch ran) and `env.openExternal` never being
//       observable directly, so its signature is "posted href starts with https:, no new
//       tab, target file was never opened".

// LOCAL variant, not the shared `wf()` from webview-helpers.ts (see that file's header comment,
// which lists this spec among the ones that need it): `probeSurface` ctrl-clicks links, which
// opens target files in new tabs, then explicitly closes them again to keep the main doc active
// for the next case. VS Code doesn't remove a closed webview's iframe from the DOM immediately,
// so by the time this spec re-fetches the frame for its SV phase, a second — hidden — `iframe.webview`
// is still around and a bare `iframe.webview` locator hits Playwright's strict-mode ambiguity.
// `:visible` picks the live one, matching `anchor-links.spec.ts`.
const wf = (w: import('@playwright/test').Page) =>
  w
    .frameLocator('iframe.webview:visible')
    .frameLocator('iframe[title="vMarkd"], #active-frame')

let bootCount = 0

async function boot(
  evaluateInVSCode: EvaluateInVSCode,
  workbox: import('@playwright/test').Page,
) {
  const dir = path.join(
    tmpdir(),
    `vmarkd-link-probe-${process.pid}-${bootCount++}`,
  )
  mkdirSync(dir, { recursive: true })
  const main = path.join(dir, 'main.md')
  writeFileSync(path.join(dir, 'sibling.md'), '# Sibling\n')
  writeFileSync(
    main,
    [
      '# Local links probe',
      '',
      '- [relative](./sibling.md)',
      '- [anchor](#target)',
      '- [mail](mailto:test@example.com)',
      '- [web](https://example.com)',
      '',
      '## target',
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

  // Extension-host-side instrumentation (unlike the webview's acquireVsCodeApi() handle,
  // `vscode.env`/`vscode.window` are plain mutable objects in the extension host — patching
  // is reliable here, unlike the webview postMessage handle, see postMessageWritable:false
  // below). Records every env.openExternal call and every error/info message shown, so we
  // can tell "routed to openExternal" apart from "silently did nothing" without needing to
  // see the message the webview posted.
  await evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      const g = globalThis as unknown as {
        __linkProbeExternal?: string[]
        __linkProbeMessages?: string[]
      }
      g.__linkProbeExternal = []
      g.__linkProbeMessages = []
      const origExternal = vscode.env.openExternal.bind(vscode.env)
      vscode.env.openExternal = (async (uri: import('vscode').Uri) => {
        g.__linkProbeExternal!.push(uri.toString())
        return origExternal(uri)
      }) as typeof vscode.env.openExternal
      const origErr = vscode.window.showErrorMessage.bind(vscode.window)
      vscode.window.showErrorMessage = ((msg: string, ...rest: unknown[]) => {
        g.__linkProbeMessages!.push(`error: ${msg}`)
        return (origErr as any)(msg, ...rest)
      }) as typeof vscode.window.showErrorMessage
    },
    [] as unknown as [string],
  )

  return { dir, main, frame }
}

async function readHostProbeLog(evaluateInVSCode: EvaluateInVSCode) {
  return evaluateInVSCode(
    async () => {
      const g = globalThis as unknown as {
        __linkProbeExternal?: string[]
        __linkProbeMessages?: string[]
      }
      const result = {
        external: g.__linkProbeExternal ?? [],
        messages: g.__linkProbeMessages ?? [],
      }
      g.__linkProbeExternal = []
      g.__linkProbeMessages = []
      return result
    },
    [] as unknown as [string],
  ) as Promise<{ external: string[]; messages: string[] }>
}

/** Switch IR → WYSIWYG through the toolbar edit-mode panel (the user's own path). */
async function toWysiwyg(frame: ReturnType<typeof wf>) {
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
}

/** Switch IR → split SV (gives BOTH `.vditor-sv` source and `.vditor-preview` render). */
async function toSv(frame: ReturnType<typeof wf>) {
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
      .querySelector('button[data-mode="sv"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await frame.locator('.vditor-preview').first().waitFor({ timeout: 30_000 })
}

// Wrap window.vscode.postMessage to RECORD open-link posts while still forwarding to the
// real host — severing the host would only measure what the webview sends (#2), not which
// host branch runs, which is the blocking question this probe exists to answer.
async function installPostSpy(frame: ReturnType<typeof wf>) {
  await frame.locator('body').evaluate(() => {
    const w = window as unknown as {
      vscode: { postMessage: (m: unknown) => void }
      __linkProbeLog: unknown[]
    }
    w.__linkProbeLog = []
    const orig = w.vscode.postMessage.bind(w.vscode)
    w.vscode.postMessage = (m: any) => {
      w.__linkProbeLog.push(m)
      return orig(m)
    }
  })
}

async function readSpyLog(
  frame: ReturnType<typeof wf>,
): Promise<{ href: string }[]> {
  return frame
    .locator('body')
    .evaluate(
      () =>
        (window as unknown as { __linkProbeLog: { href: string }[] })
          .__linkProbeLog,
    )
}

/** Raw href attribute of every `a[href]` in a surface, in document order. */
async function rawHrefs(frame: ReturnType<typeof wf>, surfaceSelector: string) {
  return frame.locator('body').evaluate((_el, sel) => {
    return Array.from(
      document.querySelectorAll<HTMLAnchorElement>(`${sel} a[href]`),
    ).map((a) => ({ raw: a.getAttribute('href'), resolved: a.href }))
  }, surfaceSelector)
}

async function openTabFsPaths(
  evaluateInVSCode: EvaluateInVSCode,
): Promise<string[]> {
  return evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      return vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .map(
          (t) =>
            (t.input as { uri?: { fsPath?: string } } | undefined)?.uri?.fsPath,
        )
        .filter((p): p is string => !!p)
    },
    [] as unknown as [string],
  ) as Promise<string[]>
}

/** Ctrl+click a real `<a href>` matching `hrefSubstring` (task-62 modifier policy — preview
 * and WYSIWYG are both "editor content", so a plain click would edit/do nothing, not open). */
async function ctrlClickLink(
  frame: ReturnType<typeof wf>,
  surfaceSelector: string,
  hrefSubstring: string,
) {
  const debug = await frame.locator('body').evaluate(
    (_el, args) => {
      const [sel, needle] = args as [string, string]
      const a = Array.from(
        document.querySelectorAll<HTMLAnchorElement>(`${sel} a[href]`),
      ).find((el) => (el.getAttribute('href') ?? '').includes(needle))
      if (!a) throw new Error(`link containing "${needle}" not found in ${sel}`)
      const ev = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
      })
      const ok = a.dispatchEvent(ev)
      const w = window as any
      const desc = Object.getOwnPropertyDescriptor(w.vscode, 'postMessage')
      w.vscode.postMessage({ command: 'test-probe-canary' })
      ;(w as any).__postMessageDescWritable =
        desc?.writable ?? 'no-own-prop(proto?)'
      const shouldOpen = w.__vmarkdShouldOpenLink?.({
        ctrlKey: true,
        metaKey: false,
      })
      return {
        href: a.getAttribute('href'),
        defaultPrevented: ev.defaultPrevented,
        dispatchReturnedTrue: ok,
        vscodeType: typeof w.vscode,
        postMessageType: typeof w.vscode?.postMessage,
        shouldOpenLinkResult: shouldOpen,
        navigatorPlatform: navigator.platform,
        userAgentIncludesMac: /Mac/i.test(navigator.userAgent),
        postMessageWritable: (w as any).__postMessageDescWritable,
      }
    },
    [surfaceSelector, hrefSubstring] as [string, string],
  )
  // eslint-disable-next-line no-console
  console.log(
    `[link-probe] ctrlClick debug for "${hrefSubstring}":`,
    JSON.stringify(debug),
  )
}

async function probeSurface(
  label: string,
  frame: ReturnType<typeof wf>,
  surfaceSelector: string,
  evaluateInVSCode: EvaluateInVSCode,
  main: string,
) {
  const hrefs = await rawHrefs(frame, surfaceSelector)
  // eslint-disable-next-line no-console
  console.log(`[link-probe] ${label} anchors:`, JSON.stringify(hrefs))

  for (const needle of [
    'sibling.md',
    '#target',
    'mailto:',
    'https://example.com',
  ]) {
    await installPostSpy(frame)
    const before = await openTabFsPaths(evaluateInVSCode)
    await ctrlClickLink(frame, surfaceSelector, needle)
    await settle(frame, 800)
    const posted = await readSpyLog(frame)
    const after = await openTabFsPaths(evaluateInVSCode)
    const newTabs = after.filter((p) => !before.includes(p))
    const hostLog = await readHostProbeLog(evaluateInVSCode)
    // eslint-disable-next-line no-console
    console.log(
      `[link-probe] ${label} click "${needle}": posted=${JSON.stringify(posted)} newTabs=${JSON.stringify(newTabs)} hostLog=${JSON.stringify(hostLog)}`,
    )
    // Close any tab the click opened, keep the main doc as the active one for the next case.
    if (newTabs.length > 0) {
      await evaluateInVSCode(
        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: extension-host probe checking every opened tab against the expected-target branches; pre-existing (task 469 baseline)
        async (vscode: typeof import('vscode'), args: string[]) => {
          const [mainPath] = args
          for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
              const p = (tab.input as { uri?: { fsPath?: string } } | undefined)
                ?.uri?.fsPath
              if (p && p !== mainPath) {
                await vscode.window.tabGroups.close(tab)
              }
            }
          }
        },
        [main] as [string],
      )
    }
  }
}

test('@probe probe: what open-link carries per surface (WYSIWYG / preview) and which host branch runs', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  const { dir, main, frame: irFrame } = await boot(evaluateInVSCode, workbox)

  // IR: link markers are NOT real <a> elements (source-reading confirms link-click.ts posts
  // the raw marker textContent, never a resolved href) — dump what the marker DOM looks like
  // for the record, no click needed.
  const irMarkers = await irFrame.locator('body').evaluate(() =>
    Array.from(
      document.querySelectorAll('[data-type="a"], .vditor-ir a[href]'),
    ).map((el) => ({
      tag: el.tagName,
      hasHrefAttr: el.hasAttribute('href'),
      text: el.textContent,
    })),
  )
  // eslint-disable-next-line no-console
  console.log('[link-probe] IR markers:', JSON.stringify(irMarkers))

  await toWysiwyg(irFrame)
  await settle(irFrame, 1000)
  await probeSurface(
    'WYSIWYG',
    irFrame,
    '.vditor-wysiwyg',
    evaluateInVSCode,
    main,
  )

  // Re-fetch IR frame handle then switch to split SV — same panel, new DOM.
  const frame2 = wf(workbox)
  await toSv(frame2)
  await settle(frame2, 1000)
  // SV's LEFT pane (.vditor-sv) is raw markdown TEXT (syntax-highlighted spans), not real
  // <a href> elements — dump what's there for the record, no click loop (nothing to click).
  const svSourceAnchors = await rawHrefs(frame2, '.vditor-sv')
  // eslint-disable-next-line no-console
  console.log(
    '[link-probe] SV-source anchors (expect none):',
    JSON.stringify(svSourceAnchors),
  )
  await probeSurface(
    'Preview',
    frame2,
    '.vditor-preview',
    evaluateInVSCode,
    main,
  )

  rmSync(dir, { recursive: true, force: true })
})
