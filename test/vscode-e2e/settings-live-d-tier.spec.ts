import { settle, wf } from './webview-helpers'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings, useSettingsRestore } from './settings-helpers'

// Phase 4, journeys D4/D5/D6 (tasks/516-qa-journey-coverage-plan.md) — three small,
// individually cheap settings journeys, batched into one file (each still its own boot/test() —
// the setups diverge enough, and D6 needs its own single-folder workspace, that sharing a boot
// would blur failure attribution — see the `*-render-sweep.spec.ts` precedent this batching
// follows: one FILE, not one boot).
const SRC = path.join(__dirname, 'fixtures', 'save-fidelity.md')
const REMOTE_IMAGE_SRC = path.join(__dirname, 'fixtures', 'remote-image.md')

type Vs = typeof import('vscode')

test.describe('D4 — css.external live reload', () => {
  // A real workspace FOLDER, with both the doc and the CSS file placed INSIDE it. Note that
  // where the file lives was NOT the cause of task 520 — the watcher failed even in this, the
  // most favourable setup, because the pattern itself could never match (see below). Kept as a
  // workspace anyway so the test exercises the ordinary configuration.
  const WORKSPACE = path.join(tmpdir(), `vmarkd-d4-workspace-${process.pid}`)
  test.use({ baseDir: WORKSPACE })

  // `css.external` is set once up front (before opening the editor) and never changed again during
  // the test — the FILE on disk is what changes, not the setting. Kept as an inline write (its
  // value is the workspace-scoped `cssFile` path computed inside the test) with just the cleanup
  // declared here.
  useSettingsRestore(test, ['vmarkd.css.external'])

  // NET — `settings-live-apply.spec.ts` already proves `css.custom` (an inline string setting)
  // applies live; `css.external` is a DIFFERENT mechanism entirely (panel-config.ts's
  // `refreshExternalCssWatchers`: a `FileSystemWatcher` on the configured file path, not a
  // config-change listener) and was untested. This edits the FILE ON DISK, not the setting.
  test('editing the external CSS file on disk restyles the open editor without reopening', async ({
    workbox,
    evaluateInVSCode,
  }) => {
    test.setTimeout(120_000)
    mkdirSync(WORKSPACE, { recursive: true })
    const tmp = path.join(WORKSPACE, 'vmarkd-d4-doc.md')
    const cssFile = path.join(WORKSPACE, 'vmarkd-d4-external.css')
    writeFileSync(tmp, readFileSync(SRC, 'utf8'))
    writeFileSync(cssFile, '.vditor-reset{outline:2px solid rgb(11,22,33)}')

    try {
      await evaluateInVSCode(
        async (vscode: Vs, args: [string, string]) => {
          await vscode.commands.executeCommand(
            'workbench.action.closeAllEditors',
          )
          await vscode.workspace
            .getConfiguration('vmarkd')
            .update(
              'css.external',
              [args[1]],
              vscode.ConfigurationTarget.Global,
            )
          await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
          await vscode.commands.executeCommand(
            'vscode.openWith',
            vscode.Uri.file(args[0]),
            'vmarkd.editor',
          )
        },
        [tmp, cssFile] as [string, string],
      )
      const frame = wf(workbox)
      await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
      await settle(frame, 1500)

      const outlineColor = () =>
        frame.locator('body').evaluate(() => {
          const el =
            (document.querySelector('.vditor-reset') as HTMLElement) ??
            (document.querySelector('.vditor-ir') as HTMLElement)
          return getComputedStyle(el).outlineColor
        }) as Promise<string>

      // The css.external file applied at OPEN.
      await expect
        .poll(outlineColor, { timeout: 15_000 })
        .toBe('rgb(11, 22, 33)')

      // Edit the FILE on disk (not the setting) — the FileSystemWatcher path.
      writeFileSync(cssFile, '.vditor-reset{outline:2px solid rgb(44,55,66)}')
      let sawLiveReload = true
      try {
        await expect
          .poll(outlineColor, { timeout: 20_000 })
          .toBe('rgb(44, 55, 66)')
      } catch {
        sawLiveReload = false
      }
      console.log(
        `[d4] fs.writeFileSync (separate Node process) live-reload observed=${sawLiveReload}`,
      )

      // DIAGNOSTIC CONTROL (team-lead's isolation, task 516) — write the SAME new content
      // through VS Code's OWN API (`vscode.workspace.fs.writeFile`) from INSIDE the extension
      // host, removing "does inotify deliver a write from a separate Node process" from the
      // question entirely. If THIS one fires, the product watcher is fine and the gap is an
      // environment (WSL2/inotify cross-process) limitation, not ours; if this ALSO never
      // fires, the gap is in our own watcher wiring.
      await evaluateInVSCode(
        async (vscode: Vs, args: [string]) => {
          await vscode.workspace.fs.writeFile(
            vscode.Uri.file(args[0]),
            Buffer.from(
              '.vditor-reset{outline:2px solid rgb(77,88,99)}',
              'utf8',
            ),
          )
        },
        [cssFile] as [string],
      )
      let sawApiReload = true
      try {
        await expect
          .poll(outlineColor, { timeout: 20_000 })
          .toBe('rgb(77, 88, 99)')
      } catch {
        sawApiReload = false
      }
      console.log(
        `[d4] vscode.workspace.fs.writeFile (in-host API) live-reload observed=${sawApiReload}`,
      )

      // Task 520 (FIXED). Both legs must live-reload. Before the fix neither did, because
      // `resolveExternalCssPaths` returns ABSOLUTE paths and they were handed to
      // `createFileSystemWatcher` as plain STRING globs — which VS Code matches against
      // workspace-RELATIVE paths, so the pattern matched nothing while still constructing a
      // valid disposable. The in-host `workspace.fs.writeFile` leg is the control that rules out
      // cross-process inotify delivery: if only that one regressed, suspect the environment; if
      // BOTH regress, suspect the watcher pattern again.
      expect(
        sawApiReload,
        "an external CSS edit written through VS Code's own API must live-reload the open editor (task 520)",
      ).toBe(true)
      expect(
        sawLiveReload,
        'an external CSS edit from another process must live-reload the open editor (task 520)',
      ).toBe(true)
    } finally {
      // `css.external` cleanup is handled by the `useSettingsRestore` afterEach above.
      rmSync(WORKSPACE, { recursive: true, force: true })
    }
  })
})

test.describe('D5 — remote-image gate', () => {
  // `image.allowRemote` is explicitly reset to a known baseline up front, then flipped mid-test
  // (the live-flip-does-nothing-until-reopen behaviour IS the test), so it can't be pinned — just
  // declared for cleanup.
  useSettingsRestore(test, ['vmarkd.image.allowRemote'])

  // NET — the map-tiles variant of the remote-image gate is covered by geojson-tiles.spec.ts; a
  // PLAIN `![]()` markdown image is not. Deliberately offline-safe: `example.invalid` is an
  // RFC 2606-reserved TLD that never resolves, and the assertion reads the CSP META TAG'S own
  // `img-src` directive rather than waiting on (or racing) a real image load/error event.
  //
  // MEASURED (not assumed) while writing this test: CSP is written into the webview's HTML
  // exactly ONCE, at panel creation (`editor-session.ts`'s `webviewPanel.webview.html = …`, in
  // `start()`) — there is no code path that re-assigns it later, and browsers cannot relax an
  // already-parsed CSP via any live mechanism (`config-changed` posts the flag into
  // `window.__vmarkdAllowRemoteImages`, which the geojson engine consults at RENDER time — a
  // fundamentally different, JS-level gate — but a plain `<img>` has no such re-render hook; its
  // fate is sealed by the CSP the page loaded with). So flipping `image.allowRemote` on an
  // ALREADY-OPEN document is expected NOT to unblock a plain remote image without a reopen —
  // this test asserts exactly that observed contract, not the "flips live" framing the journey
  // table describes (that framing matches the geojson-tiles case, not this one).
  test('a plain https image is CSP-blocked by default and stays blocked after a live allowRemote flip (requires reopen)', async ({
    workbox,
    evaluateInVSCode,
  }) => {
    test.setTimeout(120_000)
    const tmp = path.join(tmpdir(), 'vmarkd-d5-doc.md')
    writeFileSync(tmp, readFileSync(REMOTE_IMAGE_SRC, 'utf8'))

    const cspImgSrc = () =>
      wf(workbox)
        .locator('body')
        .evaluate(() => {
          const meta = document.querySelector(
            'meta[http-equiv="Content-Security-Policy"]',
          )
          const content = meta?.getAttribute('content') ?? ''
          const m = /img-src ([^;]+);/.exec(content)
          return m?.[1] ?? null
        }) as Promise<string | null>

    // The bare `https:` WILDCARD scheme source, not a substring match — `img-src` always
    // contains `https://*.vscode-cdn.net` (the extension's own CDN source), which itself
    // contains the substring "https:" and would false-positive a plain `.includes('https:')`
    // (caught while writing this test — the unguarded version failed even with the setting off).
    const hasHttpsWildcard = (imgSrc: string | null) =>
      !!imgSrc && /(^|\s)https:(\s|$)/.test(imgSrc)

    try {
      await evaluateInVSCode(
        async (vscode: Vs, args: [string]) => {
          await vscode.commands.executeCommand(
            'workbench.action.closeAllEditors',
          )
          await vscode.workspace
            .getConfiguration('vmarkd')
            .update(
              'image.allowRemote',
              undefined,
              vscode.ConfigurationTarget.Global,
            )
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
      await settle(frame, 1500)

      const before = await cspImgSrc()
      console.log(`[d5] img-src BEFORE allowRemote flip: ${before}`)
      expect(hasHttpsWildcard(before), 'blocked by default').toBe(false)

      // Flip the setting LIVE on the already-open editor (no reopen).
      await evaluateInVSCode(async (vscode: Vs) => {
        await vscode.workspace
          .getConfiguration('vmarkd')
          .update('image.allowRemote', true, vscode.ConfigurationTarget.Global)
      })
      await settle(frame, 2000)

      const after = await cspImgSrc()
      console.log(`[d5] img-src AFTER live allowRemote flip: ${after}`)
      // The CSP the page already loaded with cannot be relaxed live — see the header comment.
      expect(
        after,
        'CSP is fixed at panel creation; a live flip does not change it',
      ).toBe(before)

      // Reopening picks up the new CSP.
      await evaluateInVSCode(
        async (vscode: Vs) => {
          await vscode.commands.executeCommand(
            'workbench.action.closeActiveEditor',
          )
        },
        [tmp] as [string],
      )
      await expect
        .poll(() => workbox.locator('iframe.webview').count(), {
          timeout: 30_000,
        })
        .toBe(0)
      await evaluateInVSCode(
        async (vscode: Vs, args: [string]) => {
          await vscode.commands.executeCommand(
            'vscode.openWith',
            vscode.Uri.file(args[0]),
            'vmarkd.editor',
          )
        },
        [tmp] as [string],
      )
      const frame2 = wf(workbox)
      await frame2.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
      await settle(frame2, 1500)
      const afterReopen = await cspImgSrc()
      console.log(`[d5] img-src AFTER reopen: ${afterReopen}`)
      expect(
        hasHttpsWildcard(afterReopen),
        'a REOPEN picks up the new allowRemote value',
      ).toBe(true)
    } finally {
      // `image.allowRemote` cleanup is handled by the `useSettingsRestore` afterEach above.
      rmSync(tmp, { force: true })
    }
  })
})

test.describe('D6 — defaultModeByGlob', () => {
  const WORKSPACE = path.join(tmpdir(), `vmarkd-d6-workspace-${process.pid}`)
  const DOCS_FILE = path.join(WORKSPACE, 'docs', 'guide.md')
  const PLAIN_FILE = path.join(WORKSPACE, 'plain.md')

  test.beforeAll(() => {
    mkdirSync(path.join(WORKSPACE, 'docs'), { recursive: true })
    writeFileSync(DOCS_FILE, '# Docs guide\n\nGlob-matched.\n')
    writeFileSync(PLAIN_FILE, '# Plain\n\nNot glob-matched.\n')
  })
  test.afterAll(() => {
    rmSync(WORKSPACE, { recursive: true, force: true })
  })

  // A real workspace FOLDER is required — `resolveDefaultMode`'s glob match needs a
  // workspace-relative path (`vscode.workspace.asRelativePath`); a bare tmp file opened outside
  // any workspace folder never gets one.
  test.use({ baseDir: WORKSPACE })

  // Set once up front, before any assertions, and never changed again in the test below.
  usePinnedSettings(test, {
    'vmarkd.editor.defaultModeByGlob': { 'docs/**': 'wysiwyg' },
  })

  // Reading the live Vditor instance, same pattern as default-open-mode.spec.ts.
  const mode = (workbox: import('@playwright/test').Page) =>
    wf(workbox)
      .locator('body')
      .evaluate(
        () =>
          (
            window as unknown as {
              vditor?: { vditor?: { currentMode?: string } }
            }
          ).vditor?.vditor?.currentMode ?? null,
      ) as Promise<string | null>

  test('a glob-matched path opens in the configured mode; a non-matching path does not', async ({
    workbox,
    evaluateInVSCode,
  }) => {
    test.setTimeout(150_000)
    await evaluateInVSCode(async (vscode: Vs) => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    })

    // 1. The glob-matched file opens in wysiwyg.
    await evaluateInVSCode(
      async (vscode: Vs, args: [string]) => {
        await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(args[0]),
          'vmarkd.editor',
        )
      },
      [DOCS_FILE] as [string],
    )
    await wf(workbox).locator('.vditor-wysiwyg, .vditor-ir').first().waitFor({
      timeout: 60_000,
    })
    await expect.poll(() => mode(workbox), { timeout: 30_000 }).toBe('wysiwyg')

    await evaluateInVSCode(async (vscode: Vs) => {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    })
    await expect
      .poll(() => workbox.locator('iframe.webview').count(), {
        timeout: 30_000,
      })
      .toBe(0)

    // 2. The NON-matching file does not — it falls through to the hardcoded 'ir' default (no
    // flat `editor.defaultMode` set in this test).
    await evaluateInVSCode(
      async (vscode: Vs, args: [string]) => {
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(args[0]),
          'vmarkd.editor',
        )
      },
      [PLAIN_FILE] as [string],
    )
    await wf(workbox).locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
    await expect.poll(() => mode(workbox), { timeout: 30_000 }).toBe('ir')
  })
})
