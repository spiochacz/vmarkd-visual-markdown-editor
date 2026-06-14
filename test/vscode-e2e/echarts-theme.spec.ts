import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// ECharts + mindmap must follow the CONTENT theme regardless of the VS Code window mode.
// Ground truth = the PAINTED canvas pixels (getImageData), not getOption(). Run light/dark as
// SEPARATE process invocations (the suite reuses one VS Code instance → a 2nd test in the same
// run can read a stale shared echarts theme). Select with: -g "light" or -g "dark".
const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

function webviewFrame(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

// Dominant SATURATED colour of a canvas: skip near-grey + near-bg pixels, bucket the rest to the
// nearest 32 and return the most common as "r,g,b". This is the series/bar/node fill the user sees.
const DOMINANT = `(canvas => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return 'NO-CTX';
  const w = canvas.width, h = canvas.height;
  if (!w || !h) return 'ZERO-SIZE';
  const { data } = ctx.getImageData(0, 0, w, h);
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
    if (a < 128) continue;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    if (max - min < 40) continue; // grey / white / near-bg
    const key = (Math.round(r/32)*32) + ',' + (Math.round(g/32)*32) + ',' + (Math.round(b/32)*32);
    counts.set(key, (counts.get(key)||0) + 1);
  }
  let best = 'NONE', bestN = 0;
  for (const [k, n] of counts) if (n > bestN) { bestN = n; best = k; }
  return best;
})`

async function dominant(
  frame: ReturnType<typeof webviewFrame>,
  selector: string,
) {
  return frame.locator('body').evaluate(
    (_b, args) => {
      const [sel, fn] = args as [string, string]
      const canvas = document.querySelector(sel) as HTMLCanvasElement | null
      if (!canvas) return 'NO-CANVAS'
      // biome-ignore lint/security/noGlobalEval: test-only metric blob.
      return new Function('canvas', `return (${fn})(canvas)`)(canvas)
    },
    [selector, DOMINANT] as [string, string],
  )
}

for (const { mode, theme, lightBlue } of [
  { mode: 'light', theme: 'vscode-light-2026', lightBlue: true },
  { mode: 'dark', theme: 'vscode-dark-2026', lightBlue: false },
]) {
  test(`echarts + mindmap follow content theme (${mode})`, async ({
    workbox,
    evaluateInVSCode,
  }) => {
    await evaluateInVSCode(
      async (vscode, args) => {
        const [uri, contentTheme] = args as [string, string]
        await vscode.workspace
          .getConfiguration('vmarkd')
          .update('theme.content', contentTheme, true)
        await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(uri),
          'vmarkd.editor',
        )
      },
      [FIXTURE, theme] as [string, string],
    )

    const frame = webviewFrame(workbox)
    await frame
      .locator('.vditor-ir__node[data-type="code-block"]')
      .first()
      .waitFor({ timeout: 45_000 })

    // Let the IR render settle before swapping into Preview (the overlay render is flaky if
    // entered the instant the first code block appears).
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 2000)))

    // Enter the full Preview overlay (charts render there at a real size).
    await frame.locator('body').evaluate(() => {
      // biome-ignore lint/suspicious/noExplicitAny: webview global.
      const v = (window as any).vditor
      const editEls = document.querySelectorAll(
        '.vditor-ir, .vditor-wysiwyg, .vditor-sv',
      )
      for (const el of Array.from(editEls))
        (el as HTMLElement).style.display = 'none'
      if (v?.vditor?.preview?.element) {
        v.vditor.preview.element.style.display = 'block'
        v.vditor.preview.render(v.vditor)
      }
    })

    await frame
      .locator('.vditor-preview .language-echarts canvas')
      .first()
      .waitFor({ timeout: 30_000 })
    // mindmap may take a beat longer; don't hard-fail the wait — sample whatever painted.
    await frame
      .locator('.vditor-preview .language-mindmap canvas')
      .first()
      .waitFor({ timeout: 15_000 })
      .catch(() => {})
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 4000)))

    // ECharts chart: the bars are large → assert on the DOMINANT saturated canvas pixel.
    const chart = await dominant(
      frame,
      '.vditor-preview .language-echarts canvas',
    )
    // Mindmap: the `tree` node symbols are tiny (7px) and most pixels are grey label
    // surfaces, so dominant-pixel can't see them. ECharts paints node symbols with exactly
    // the explicit itemStyle.color we set from the theme → read that painted-truth value
    // (the whole point of the fix; before it the tree fell back to ECharts-default grey).
    const mindColor = await frame.locator('body').evaluate(() => {
      // biome-ignore lint/suspicious/noExplicitAny: webview globals.
      const w = window as any
      const el = document.querySelector('.vditor-preview .language-mindmap')
      const inst = el && w.echarts?.getInstanceByDom?.(el)
      if (!inst) return 'NO-INST'
      // biome-ignore lint/suspicious/noExplicitAny: option blob.
      const opt = inst.getOption() as any
      const tree = opt?.series?.find((s: any) => s?.type === 'tree')
      return (tree?.itemStyle?.color as string) || 'NO-COLOR'
    })
    const LIGHT = '0,96,224' // #0063d3 = rgb(0,99,211) bucketed to nearest 32
    const DARK = '96,160,256' // #59a4f9 = rgb(89,164,249) bucketed
    if (lightBlue) {
      expect(chart).toBe(LIGHT)
      expect(mindColor.toLowerCase()).toBe('#0063d3')
    } else {
      expect(chart).toBe(DARK)
      expect(mindColor.toLowerCase()).toBe('#59a4f9')
    }
  })
}

// Live theme flip (no reopen): the chart + mindmap BACKGROUND must follow the new content theme.
// Regression for the "background doesn't follow light/dark" bug — reRenderEcharts re-themes the
// IR-pane chart by reconstructing from source (always worked), but the mindmap path used to require
// a live echarts instance via getInstanceByDom (null on the snapshot IR-pane node) and preserved
// getOption().backgroundColor, so the mindmap's background stayed stale. The fix reconstructs the
// mindmap from `data-code` like the chart and lets the registered theme drive the background.
// Asserts on the painted canvas CORNER pixel (the background the user actually sees), in the IR
// preview pane (the default editing surface), and that no chart is rendered into the editable source.
test('chart + mindmap background follows a live light->dark flip', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.workspace
        .getConfiguration('vmarkd')
        .update('theme.content', 'vscode-light-2026', true)
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
    .locator('.vditor-ir__node[data-type="code-block"]')
    .first()
    .waitFor({ timeout: 45_000 })
  // Stay in IR mode (default) — sample the IR preview panes (what reRenderEcharts targets).
  await frame
    .locator('.vditor-ir__preview .language-echarts canvas')
    .first()
    .waitFor({ timeout: 30_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3000)))

  // Live flip to dark via config change (extension -> webview configChanged -> reRenderEcharts).
  await evaluateInVSCode(async (vscode) => {
    await vscode.workspace
      .getConfiguration('vmarkd')
      .update('theme.content', 'vscode-dark-2026', true)
  })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 4000)))

  const after = await frame.locator('body').evaluate(() => {
    const w = window as unknown as {
      echarts?: { getInstanceByDom?: (el: Element) => unknown }
    }
    const corner = (sel: string) => {
      const el = document.querySelector(sel)
      const canvas = el?.querySelector('canvas') as HTMLCanvasElement | null
      const ctx = canvas?.getContext('2d')
      if (!ctx) return 'NO-CANVAS'
      const d = ctx.getImageData(2, 2, 1, 1).data
      return `${d[0]},${d[1]},${d[2]}`
    }
    // Count rendered mindmaps that landed in an EDITABLE source surface (regression guard).
    const srcRendered = Array.from(
      document.querySelectorAll('.language-mindmap'),
    ).filter(
      (el) =>
        !el.closest(
          '.vditor-ir__preview, .vditor-wysiwyg__preview, .vditor-preview',
        ) && w.echarts?.getInstanceByDom?.(el),
    ).length
    return {
      chart: corner('.vditor-ir__preview .language-echarts'),
      mind: corner('.vditor-ir__preview .language-mindmap'),
      srcRendered,
    }
  })

  // #121314 (Dark 2026 editor.background) = rgb(18,19,20). After the flip both backgrounds match it.
  expect(after.chart).toBe('18,19,20')
  expect(after.mind).toBe('18,19,20')
  // Never render a chart into the editable source `.language-mindmap`.
  expect(after.srcRendered).toBe(0)
})
