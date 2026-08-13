// PROBE (task 516 B1/B2) — reconnaissance for the find widget beyond IR (WYSIWYG/split/preview,
// multi-match navigation). Nothing here is a regression assertion; it logs what the find widget's
// DOM actually looks like in each mode and how multi-match navigation behaves, so the real specs
// can be written against confirmed structure instead of a guess. Combined into ONE test() to
// minimize real-VS-Code boots under heavy shared e2e-lock contention (task 516 A7 measured 5+
// bounces per run this session). Per test/backend/probe-tier-convention.test.ts: a spec asserting
// nothing must be `*-probe.spec.ts` and carry `@probe`.
import { settle, wf } from './webview-helpers'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'vscode-test-playwright'

const TEMP_DIR = path.join(__dirname, '..', '..', 'tmp', 'vscode-e2e')
mkdirSync(TEMP_DIR, { recursive: true })
const MODES_FIXTURE = path.join(TEMP_DIR, 'find-widget-modes-probe.md')
writeFileSync(
  MODES_FIXTURE,
  [
    '# Find modes probe',
    '',
    ...Array(40).fill('alpha filler line'),
    '',
    'bravo target line',
    '',
  ].join('\n'),
)
const MULTI_FIXTURE = path.join(TEMP_DIR, 'find-widget-multi-probe.md')
writeFileSync(
  MULTI_FIXTURE,
  [
    '# Find multi probe',
    '',
    'zulu match one here',
    '',
    ...Array(20).fill('alpha filler line'),
    '',
    'zulu match two here',
    '',
    ...Array(20).fill('alpha filler line'),
    '',
    'zulu match three here',
    '',
  ].join('\n'),
)

test.afterEach(async ({ evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode) => {
    await vscode.workspace
      .getConfiguration('vmarkd')
      .update(
        'editor.defaultMode',
        undefined,
        vscode.ConfigurationTarget.Global,
      )
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

test('@probe find widget: modes DOM shape + multi-match navigation shape', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(200_000)

  const openWithMode = async (mode: string, file: string) => {
    await evaluateInVSCode(
      async (vscode: typeof import('vscode'), args: string[]) => {
        const [m, f] = args
        await vscode.workspace
          .getConfiguration('vmarkd')
          .update('editor.defaultMode', m, vscode.ConfigurationTarget.Global)
        await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(f),
          'vmarkd.editor',
        )
      },
      [mode, file] as [string, string],
    )
  }

  const close = async () => {
    await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    })
    await workbox.waitForTimeout(500)
  }

  const showFind = async () => {
    await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand(
        'editor.action.webvieweditor.showFind',
      )
    })
  }

  // ── Leg 1: wysiwyg ──
  await openWithMode('wysiwyg', MODES_FIXTURE)
  let frame = wf(workbox)
  await frame.locator('.vditor-wysiwyg').first().waitFor({ timeout: 60_000 })
  await settle(frame, 300)
  await frame.locator('.vditor-wysiwyg').click({ position: { x: 20, y: 12 } })
  await showFind()
  let findWrapper = workbox.locator('.simple-find-part-wrapper').first()
  let visible = await findWrapper.isVisible().catch(() => false)
  console.log(`[probe] wysiwyg: find widget visible = ${visible}`)
  if (visible) {
    const html = await findWrapper.innerHTML()
    console.log(
      `[probe] wysiwyg find widget HTML (first 1800): ${html.slice(0, 1800)}`,
    )
  }
  await workbox.keyboard.press('Escape')
  await close()

  // ── Leg 2: sv ──
  await openWithMode('sv', MODES_FIXTURE)
  frame = wf(workbox)
  await frame.locator('.vditor-sv').first().waitFor({ timeout: 60_000 })
  await settle(frame, 300)
  await frame.locator('.vditor-sv').click({ position: { x: 20, y: 12 } })
  await showFind()
  findWrapper = workbox.locator('.simple-find-part-wrapper').first()
  visible = await findWrapper.isVisible().catch(() => false)
  console.log(`[probe] sv: find widget visible = ${visible}`)
  await workbox.keyboard.press('Escape')
  await close()

  // ── Leg 3: preview ──
  await openWithMode('preview', MODES_FIXTURE)
  frame = wf(workbox)
  await frame
    .locator('.vditor-ir')
    .first()
    .waitFor({ state: 'attached', timeout: 60_000 })
  await settle(frame, 300)
  const previewVisible = await frame
    .locator('.vditor-preview')
    .first()
    .isVisible()
    .catch(() => false)
  console.log(`[probe] preview: .vditor-preview visible = ${previewVisible}`)
  await frame
    .locator('.vditor-preview')
    .click({ position: { x: 20, y: 12 } })
    .catch((e) => {
      console.log(
        `[probe] preview: click on .vditor-preview failed: ${String(e)}`,
      )
    })
  await showFind()
  findWrapper = workbox.locator('.simple-find-part-wrapper').first()
  visible = await findWrapper.isVisible().catch(() => false)
  console.log(`[probe] preview: find widget visible = ${visible}`)
  await workbox.keyboard.press('Escape')
  await close()

  // ── Leg 4: multi-match navigation shape (ir mode) ──
  await openWithMode('ir', MULTI_FIXTURE)
  frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await settle(frame, 300)
  await frame.locator('.vditor-ir').click({ position: { x: 20, y: 12 } })
  await showFind()
  const findInput = workbox.locator('.simple-find-part input').first()
  await findInput.waitFor({ timeout: 15_000 })
  await workbox.keyboard.type('zulu', { delay: 60 })
  await workbox.waitForTimeout(700)
  const wrapperHtml1 = await workbox
    .locator('.simple-find-part-wrapper')
    .first()
    .innerHTML()
  console.log(
    `[probe] multi-match after typing 'zulu' (first 2500): ${wrapperHtml1.slice(0, 2500)}`,
  )

  const matchesCountText = async () =>
    workbox
      .locator('.matchesCount')
      .first()
      .textContent()
      .catch((e) => `<error: ${String(e)}>`)
  console.log(
    `[probe] matchesCount text after type: ${JSON.stringify(await matchesCountText())}`,
  )

  await workbox.keyboard.press('Enter')
  await workbox.waitForTimeout(500)
  console.log(
    `[probe] matchesCount text after Enter #1: ${JSON.stringify(await matchesCountText())}`,
  )
  await workbox.keyboard.press('Enter')
  await workbox.waitForTimeout(500)
  console.log(
    `[probe] matchesCount text after Enter #2: ${JSON.stringify(await matchesCountText())}`,
  )
  await workbox.keyboard.press('Enter')
  await workbox.waitForTimeout(500)
  console.log(
    `[probe] matchesCount text after Enter #3 (should wrap): ${JSON.stringify(await matchesCountText())}`,
  )
  await workbox.keyboard.press('Shift+Enter')
  await workbox.waitForTimeout(500)
  console.log(
    `[probe] matchesCount text after Shift+Enter (back): ${JSON.stringify(await matchesCountText())}`,
  )

  const hostActive = () =>
    workbox.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      return el
        ? `${el.tagName}${el.className ? `.${String(el.className).split(' ').join('.')}` : ''}`
        : 'none'
    })
  await workbox.keyboard.press('Escape')
  await workbox.waitForTimeout(500)
  const wrapperGoneVisible = await workbox
    .locator('.simple-find-part-wrapper')
    .first()
    .isVisible()
    .catch(() => false)
  console.log(
    `[probe] find widget still visible after Escape: ${wrapperGoneVisible}`,
  )
  console.log(`[probe] host active element after Escape: ${await hostActive()}`)
  const frameActive = await frame.locator('body').evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return el
      ? `${el.tagName}${el.className ? `.${String(el.className).split(' ').join('.')}` : ''}`
      : 'none'
  })
  console.log(`[probe] frame active element after Escape: ${frameActive}`)

  // Second Ctrl+F reopen
  await showFind()
  const reopened = await workbox
    .locator('.simple-find-part-wrapper')
    .first()
    .isVisible()
    .catch(() => false)
  console.log(`[probe] find widget reopened after second showFind: ${reopened}`)
  const reopenedInputFocused = (await hostActive()).includes('INPUT')
  console.log(`[probe] input focused on reopen: ${reopenedInputFocused}`)

  // Document integrity check
  const text = (await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) =>
      vscode.workspace.textDocuments
        .find((d) => d.uri.fsPath === args[0])
        ?.getText() ?? '',
    [MULTI_FIXTURE] as [string],
  )) as string
  console.log(
    `[probe] doc text unchanged: ${
      text.includes('zulu match one here') &&
      text.includes('zulu match three here')
    }`,
  )
})
