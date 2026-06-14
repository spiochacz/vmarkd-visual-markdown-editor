import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// ECharts must stay responsive to a window/pane resize. echarts.init installs no resize handler, so
// without installEchartsResize the chart keeps its old pixel width when the editor widens — it stays
// anchored left while the container grows to the right ("lewa nie zmienia, prawa rozciąga się w
// prawo"). installEchartsResize (window 'resize' listener) resizes every instance to fill its
// container. We widen the editor by hiding the sidebar and assert the canvas tracks the container.
const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

function webviewFrame(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('echarts canvas tracks its container when the editor pane is resized', async ({
  workbox,
  evaluateInVSCode,
}) => {
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
  const frame = webviewFrame(workbox)
  await frame
    .locator('.vditor-ir__preview .language-echarts canvas')
    .first()
    .waitFor({ timeout: 45_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3000)))

  const measure = () =>
    frame.locator('body').evaluate(() => {
      const ech = document.querySelector(
        '.vditor-ir__preview .language-echarts',
      ) as HTMLElement
      const cv = ech.querySelector('canvas') as HTMLCanvasElement
      return {
        container: Math.round(ech.getBoundingClientRect().width),
        canvas: Math.round(cv.getBoundingClientRect().width),
      }
    })

  const before = await measure()
  const near = (a: number, b: number) => Math.abs(a - b) <= 2
  // Sanity: the chart filled its container before the resize.
  expect(near(before.canvas, before.container)).toBe(true)

  // Widen the editor pane: hide the sidebar → the webview (and the echarts container) grows.
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand(
      'workbench.action.toggleSidebarVisibility',
    )
  })
  // Let the sidebar collapse animation settle, then fire a resize. A real window drag emits resize
  // events continuously (chart tracks live); the sidebar toggle animates, so we assert the
  // deterministic contract: once a resize event arrives, the visible chart fits its settled
  // container. Poll (the webview can throttle timers when backgrounded), re-firing resize each tick.
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2000)))
  // Fire ONE resize after the pane has settled, then poll WITHOUT re-firing: the listener's
  // trailing timer may be clamped to ~1s while the webview is backgrounded, and re-firing every
  // poll tick would keep re-arming (resetting) it so it never elapses.
  await frame
    .locator('body')
    .evaluate(() => window.dispatchEvent(new Event('resize')))
  await expect
    .poll(
      async () => {
        const m = await measure()
        // eslint-disable-next-line no-console
        console.log(`[resize] ${JSON.stringify(m)}`)
        return (
          m.container > before.container + 20 && near(m.canvas, m.container)
        )
      },
      { timeout: 15_000, intervals: [400, 600, 1000, 1500] },
    )
    .toBe(true)
})

// A window resize that fires WHILE the full Preview overlay is shown must NOT collapse the hidden
// IR chart to 0×0 — otherwise it stays blank after returning to edit ("po przełączeniu z preview na
// edycję echarts się nie pojawia"). installEchartsResize skips hidden (clientWidth 0) containers.
test('a resize while in Preview does not blank the hidden IR chart', async ({
  workbox,
  evaluateInVSCode,
}) => {
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
  const frame = webviewFrame(workbox)
  await frame
    .locator('.vditor-ir__preview .language-echarts canvas')
    .first()
    .waitFor({ timeout: 45_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3000)))

  const irCanvas = () =>
    frame.locator('body').evaluate(() => {
      const cv = document.querySelector(
        '.vditor-ir__preview .language-echarts canvas',
      ) as HTMLCanvasElement | null
      return cv ? Math.round(cv.getBoundingClientRect().width) : -1
    })
  const wait = (ms: number) =>
    frame
      .locator('body')
      .evaluate((_b, m) => new Promise((r) => setTimeout(r, m)), ms)
  // Faithful to Vditor's Preview toolbar toggle (toolbar/Preview.ts): show preview + hide the
  // current edit mode's pane.
  const setPreview = (on: boolean) =>
    frame.locator('body').evaluate((_b, show) => {
      const v = (
        window as unknown as {
          vditor: {
            vditor: {
              currentMode: string
              preview: { element: HTMLElement; render: (x: unknown) => void }
              [mode: string]: unknown
            }
          }
        }
      ).vditor.vditor
      const editParent = (v[v.currentMode] as { element: HTMLElement }).element
        .parentElement as HTMLElement
      if (show) {
        v.preview.element.style.display = 'block'
        editParent.style.display = 'none'
        v.preview.render(v)
      } else {
        editParent.style.display = 'block'
        v.preview.element.style.display = 'none'
      }
    }, on)

  const start = await irCanvas()
  await setPreview(true)
  await frame
    .locator('.vditor-preview .language-echarts canvas')
    .first()
    .waitFor({ timeout: 30_000 })
  await wait(1500)
  // The resize that bit us: it arrives while the IR chart's container is display:none (width 0).
  await frame
    .locator('body')
    .evaluate(() => window.dispatchEvent(new Event('resize')))
  await wait(600)
  await setPreview(false)
  await wait(1500)
  const end = await irCanvas()

  // eslint-disable-next-line no-console
  console.log(`[preview-resize] start=${start} end=${end}`)
  expect(start).toBeGreaterThan(0)
  // The IR chart survived (was NOT collapsed to 0 by the in-preview resize).
  expect(end).toBeGreaterThan(0)
})
