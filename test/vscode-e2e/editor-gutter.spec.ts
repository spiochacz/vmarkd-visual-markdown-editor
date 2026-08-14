import { wf } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'

// Side margins must match VS Code's BUILT-IN markdown preview. Its markdown.css puts
// `padding: 0 26px` on `html, body` — BOTH — so the text really sits 52px from the webview edge;
// measured live in native-preview-probe.spec.ts, not read off the stylesheet. Two invariants
// (task 438):
//   (a) the default (full-width) editor's text column starts 52px from the pane edge, symmetric;
//   (b) toggling `vmarkd.editor.headingMarkers` does NOT move that column — the H1–H6 / ↩ / ToC
//       markers float INSIDE that gutter instead of sizing it. It used to be 35px left / 20px
//       right, dropping to 10px with markers off, so the whole document jumped on toggle.
// Real-VS-Code because the gutter is the product of OUR css + VS Code's injected webview CSS + the
// live setPadding() Vditor runs on the real pane — the chromium harness cannot see all three.
const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
const GUTTER = 52

// `editor.fullWidth` differs between the two tests below (true / false) and `editor.headingMarkers`
// is flipped mid-test — neither can be pinned to one shared value.
useSettingsRestore(test, [
  'vmarkd.editor.fullWidth',
  'vmarkd.editor.headingMarkers',
])

// Distance from the PANE's left edge to where the text actually starts, plus the right padding.
async function gutters(frame: ReturnType<typeof wf>) {
  return frame.locator('body').evaluate(() => {
    const el = document.querySelector(
      '.vditor-ir pre.vditor-reset',
    ) as HTMLElement
    const cs = getComputedStyle(el)
    return {
      left: parseFloat(cs.paddingLeft),
      right: parseFloat(cs.paddingRight),
    }
  })
}

test('full-width editor uses the VS Code preview gutter, and markers do not move it', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      const cfg = vscode.workspace.getConfiguration('vmarkd')
      await cfg.update('editor.fullWidth', true, true)
      await cfg.update('editor.headingMarkers', true, true)
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
  await frame
    .locator('.vditor-ir pre.vditor-reset')
    .waitFor({ timeout: 45_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  const on = await gutters(frame)
  expect(Math.round(on.left)).toBe(GUTTER)
  expect(Math.round(on.right)).toBe(GUTTER)

  // The marker box must live INSIDE that gutter: it starts no further left than the pane edge and
  // ends before the text column, so it needs no extra room of its own.
  const marker = await frame.locator('body').evaluate(() => {
    const h1 = document.querySelector(
      '.vditor-ir .vditor-reset h1',
    ) as HTMLElement
    const cs = getComputedStyle(h1, '::before')
    return {
      offset: -parseFloat(cs.marginLeft),
      width: parseFloat(cs.width) + parseFloat(cs.paddingRight),
    }
  })
  expect(marker.offset).toBeLessThanOrEqual(on.left)
  expect(marker.width).toBeLessThanOrEqual(marker.offset)

  // Markers OFF — same text origin (the regression: it collapsed to 10px).
  await evaluateInVSCode(async (vscode) => {
    await vscode.workspace
      .getConfiguration('vmarkd')
      .update('editor.headingMarkers', false, true)
  })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))
  const off = await gutters(frame)
  expect(Math.round(off.left)).toBe(GUTTER)
  expect(Math.round(off.right)).toBe(GUTTER)
})

// Narrow view is the ONE thing allowed to change the margin — and only upwards: the 800px column
// is centred, with the same gutter as its floor once the pane is narrower than 800px.
test('narrow view widens the margin (centred 800px column), never shrinks it', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.workspace
        .getConfiguration('vmarkd')
        .update('editor.fullWidth', false, true)
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
  await frame
    .locator('.vditor-ir pre.vditor-reset')
    .waitFor({ timeout: 45_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  const m = await gutters(frame)
  expect(m.left).toBeGreaterThanOrEqual(GUTTER)
  // centred: both sides equal (the column, not a left-aligned block)
  expect(Math.abs(m.left - m.right)).toBeLessThan(2)
})
