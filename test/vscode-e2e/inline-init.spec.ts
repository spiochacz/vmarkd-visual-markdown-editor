import { wf } from './webview-helpers'
// Task 38: the editor boots Vditor synchronously from an inlined `#vmark-init` JSON data island
// (non-wiki, non-huge docs) instead of the serial `ready→init` host roundtrip. Real-VS-Code-only —
// the inline payload + nonce + custom-editor resource pipeline only exist in the actual webview.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'inline-init.md')

// Task 470 — `vmarkd.editor.toolbar` is an INIT_ONLY_OPTIONS setting (live-config.ts): changing it
// makes message-router.ts's handleConfigChanged call initVditor() again in the SAME page (a real
// Vditor re-init, not a reload). Flipped mid-test to trigger that re-init, so it can't be pinned;
// restored so a failure mid-test doesn't leak the setting into later specs sharing this run's
// user-data dir (same reasoning as default-open-mode.spec.ts's afterEach).
useSettingsRestore(test, ['vmarkd.editor.toolbar'])

test('boots from the inlined #vmark-init payload', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  // Task 470 — acquireVsCodeApi() may be called only once per webview; a second call throws. If
  // vscode-api.ts's initVsCodeApi() guard below were broken, the re-init this test triggers would
  // throw synchronously in the webview page, surfacing here as an uncaught exception.
  const pageErrors: string[] = []
  workbox.on('pageerror', (err) => pageErrors.push(String(err)))

  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [FIXTURE] as [string],
  )

  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  // settle (the host also re-sends the no-op init echo)
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3000)))

  const info = await frame.locator('body').evaluate(() => {
    const el = document.getElementById('vmark-init')
    let parsed: { type?: string; content?: string } | null = null
    try {
      parsed = el?.textContent ? JSON.parse(el.textContent) : null
    } catch {
      parsed = null
    }
    return {
      hasInit: !!el,
      scriptType: el?.getAttribute('type') ?? null,
      initType: parsed?.type ?? null,
      contentHasMarker:
        typeof parsed?.content === 'string' &&
        parsed.content.includes('INLINEINITMARKER42'),
      irText:
        (document.querySelector('.vditor-ir') as HTMLElement | null)
          ?.innerText ?? '',
    }
  })

  // the host inlined the payload (only happens for non-wiki, non-huge docs)
  expect(info.hasInit).toBe(true)
  expect(info.scriptType).toBe('application/json')
  expect(info.initType).toBe('init')
  expect(info.contentHasMarker).toBe(true)
  // …and the editor actually rendered that content
  expect(info.irText).toContain('INLINEINITMARKER42')

  // Task 470 — vscode-api.ts's acquireVsCodeApi() acquisition moved from an import-time side
  // effect on vscode-api.ts itself to an explicit initVsCodeApi() call in preload.ts's boot path
  // (the module every real entry point and e2e harness already imports first). The inline-init
  // boot above already exercised that call once; window.vscode must be live afterwards.
  const bootstrapped = await frame.locator('body').evaluate(() => {
    const w = window as any
    // Stash the acquired object's REFERENCE (not a copy — real VS Code's webview API object isn't
    // extensible, so tagging a property on it directly is not reliable) so a later evaluate can
    // compare identity with `===`: if a re-init replaced it with a NEW object (rather than
    // initVsCodeApi()'s guard short-circuiting), this reference would no longer be `===  w.vscode`.
    w.__vmarkdVscodeRefBeforeReinit = w.vscode
    return typeof w.vscode?.postMessage === 'function'
  })
  expect(bootstrapped).toBe(true)

  // Flip an INIT_ONLY_OPTIONS setting (live-config.ts) — this is the "re-initialises on the
  // streaming path" scenario: message-router.ts's handleConfigChanged calls initVditor() again in
  // this SAME page (a real second `new Vditor(...)`), never re-running main.ts's top-level
  // bootstrap. `showToolbar: false` maps to `toolbar: []`, so the toolbar disappearing is proof a
  // real re-init happened, not just a live CSS/option tweak.
  await evaluateInVSCode(async (vscode) => {
    await vscode.workspace
      .getConfiguration('vmarkd')
      .update('editor.toolbar', false, vscode.ConfigurationTarget.Global)
  })
  // `toolbar: []` still leaves the wrapper <div class="vditor-toolbar"> in the DOM (Vditor always
  // renders the container); it's empty of buttons that proves the re-init applied the new option.
  await expect(async () => {
    const buttonCount = await frame
      .locator('.vditor-toolbar')
      .evaluate((el) => el.childElementCount)
    expect(buttonCount).toBe(0)
  }).toPass({ timeout: 20_000 })

  // window.vscode survived the re-init untouched: still the same object reference (belt-and-
  // suspenders — consistent with the guard firing, though the pageerror check below is the
  // load-bearing assertion), still functional, and — the strongest signal — no page error was
  // thrown. A broken guard would call acquireVsCodeApi() a second time, which VS Code makes throw
  // ("An instance of the WebView API has already been acquired"), surfacing as a pageerror event.
  const afterReinit = await frame.locator('body').evaluate(() => {
    const w = window as any
    return {
      sameIdentity: w.__vmarkdVscodeRefBeforeReinit === w.vscode,
      stillFunctional: typeof w.vscode?.postMessage === 'function',
    }
  })
  expect(afterReinit.sameIdentity).toBe(true)
  expect(afterReinit.stillFunctional).toBe(true)
  // Scoped to the acquisition failure mode this test targets, not "zero errors": forcing a second
  // `new Vditor(...)` in one page also makes Vditor itself reload its icon-sprite <script> (removed
  // + re-added synchronously, vditor/src/index.ts), which can independently throw an unrelated
  // resource-load error under the vscode-resource:// XHR pipeline in this test env — a pre-existing
  // re-init characteristic of Vditor's own icon loading, not of vscode-api.ts, and out of task 470's
  // scope. What matters here is that acquireVsCodeApi() specifically wasn't called a second time.
  const acquireErrors = pageErrors.filter((e) =>
    /acquireVsCodeApi|WebView API has already been acquired/i.test(e),
  )
  expect(acquireErrors).toEqual([])
})
