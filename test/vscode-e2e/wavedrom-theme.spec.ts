// WaveDrom is paired with the content theme (task 101). Its wave LINES/dashes/hatch get their colour
// from CLASSES in an embedded <style> skin (stroke/fill/color:#000), not inline attrs — so they stayed
// BLACK and were invisible on a dark theme (user report: "wavedrom na ciemnym tle ma czarne waves").
// themeWavedromSvg now rewrites the skin CSS (black → currentColor, white fill → transparent). Assert
// the embedded skin no longer hard-codes black and that a wave path resolves to the themed foreground.
// Real-VS-Code-only (WaveDrom SVG render).
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('wavedrom wave lines follow the theme foreground (not baked black) on dark', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.workspace
        .getConfiguration('vmarkd')
        .update('theme.content', 'github-dark', true)
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
    .locator('.vditor-ir__preview .language-wavedrom svg')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2000)))

  const info = await frame.locator('body').evaluate(() => {
    const el = document.querySelector(
      '.vditor-ir__preview .language-wavedrom',
    ) as HTMLElement | null
    const svg = el?.querySelector('svg')
    const styleText = svg
      ? [...svg.querySelectorAll('style')].map((s) => s.textContent).join('\n')
      : ''
    // .s1/.s2 are the signal wave lines; grab the first one and read its RESOLVED stroke colour.
    const wave = svg?.querySelector('.s1, .s2') as SVGElement | null
    return {
      fg: el ? getComputedStyle(el).color : '',
      // After the rewrite the skin must NOT hard-code black on stroke/fill/color any more.
      styleHasBlackStroke:
        /(stroke|fill|color)\s*:\s*(#0{3}(?:0{3})?|black)\b/i.test(styleText),
      foundWave: !!wave,
      waveStroke: wave ? getComputedStyle(wave).stroke : '',
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[wavedrom github-dark] ${JSON.stringify(info)}`)

  expect(info.foundWave).toBe(true)
  // The skin no longer bakes black anywhere (every #000/black → currentColor).
  expect(info.styleHasBlackStroke).toBe(false)
  // The wave line resolves to the themed foreground (a light colour on dark) — NOT black.
  expect(info.waveStroke).not.toBe('')
  expect(info.waveStroke).toBe(info.fg)
  expect(info.waveStroke).not.toMatch(/rgb\(0, 0, 0\)|#000/)
})

// WaveDrom renders three diagram types (`signal`, `reg` bitfield, `assign` logic) + a `config` block;
// the fixture has one of each (in that order). `reg`/`assign` use different shapes than signal lines,
// so the dark-theme recolor must hold for them too — otherwise they repeat the "black on dark" bug.
test('wavedrom reg/assign/config render themed (not black) on dark', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.workspace
        .getConfiguration('vmarkd')
        .update('theme.content', 'github-dark', true)
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
  // wait for the 4th wavedrom block (the config one) so all of signal/reg/assign/config have rendered
  await frame
    .locator('.vditor-ir__preview .language-wavedrom svg')
    .nth(3)
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))

  const info = await frame.locator('body').evaluate(() => {
    const blocks = [
      ...document.querySelectorAll('.vditor-ir__preview .language-wavedrom'),
    ] as HTMLElement[]
    const fg = blocks[0] ? getComputedStyle(blocks[0]).color : ''
    // Analyse a rendered wavedrom block: count elements whose RESOLVED stroke is pure black (the
    // bug — invisible on dark). Fill is skipped: SVG's default fill is black, so a fill-less element
    // reports black and would give false positives; explicit strokes are the reliable signal.
    const analyze = (el: HTMLElement | undefined) => {
      const svg = el?.querySelector('svg')
      if (!svg)
        return { hasSvg: false, childCount: 0, blackStroke: 0, strokes: [] }
      const strokes = new Set<string>()
      let blackStroke = 0
      for (const e of [...svg.querySelectorAll('*')] as SVGElement[]) {
        const s = getComputedStyle(e).stroke
        if (s && s !== 'none') {
          strokes.add(s)
          if (s === 'rgb(0, 0, 0)') blackStroke++
        }
      }
      return {
        hasSvg: true,
        childCount: svg.querySelectorAll('*').length,
        width: Math.round(svg.getBoundingClientRect().width),
        blackStroke,
        strokes: [...strokes],
      }
    }
    return {
      fg,
      count: blocks.length,
      signal: analyze(blocks[0]),
      reg: analyze(blocks[1]),
      assign: analyze(blocks[2]),
      config: analyze(blocks[3]),
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[wavedrom reg/assign/config] ${JSON.stringify(info, null, 2)}`)

  expect(info.count).toBeGreaterThanOrEqual(4)
  expect(info.reg.hasSvg).toBe(true)
  expect(info.assign.hasSvg).toBe(true)
  expect(info.config.hasSvg).toBe(true)
  // The recolor must hold for the other diagram types too — no pure-black strokes on dark.
  expect(info.reg.blackStroke).toBe(0)
  expect(info.assign.blackStroke).toBe(0)
})

// In the full Preview pane the diagram lives in a plain `<pre>` that the content theme / `auto` paints
// with the code-panel background. wavedrom is currentColor LINE-ART with no fill, so that grey showed
// THROUGH it ("wszystkie diagramy mają tło jak temat prócz wavedrom" — the other engines' SVGs have
// opaque fills that hid it). The diagram-preview transparency rule must cover `.vditor-preview pre`,
// not just the IR/WYSIWYG preview panes. Use `auto` + a light VS Code so the code-panel grey is real.
test('wavedrom in the full Preview pane sits on the page bg, not the code-panel grey', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.workspace
        .getConfiguration('workbench')
        .update('colorTheme', 'Default Light Modern', true)
      await vscode.workspace
        .getConfiguration('vmarkd')
        .update('theme.content', 'auto', true)
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
    .locator('.vditor-ir__preview .language-wavedrom svg')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1000)))
  // enter the full Preview pane via the toolbar button. The Preview re-renders async; a fixed settle
  // is more reliable here than waitFor(svg) — the SVG can be present but fail Playwright's strict
  // "visible" check, and `info.hasReg` below asserts it actually rendered.
  const previewBtn = frame.locator('.vditor-toolbar [data-type="preview"]')
  await previewBtn.first().click()
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3000)))

  const info = await frame.locator('body').evaluate(() => {
    const reg = document.querySelectorAll(
      '.vditor-preview .language-wavedrom',
    )[1] as HTMLElement | null
    const pre = reg?.closest('pre') as HTMLElement | null
    return {
      hasReg: !!reg,
      preBg: pre ? getComputedStyle(pre).backgroundColor : 'no-pre',
      codeBgVar: getComputedStyle(document.documentElement)
        .getPropertyValue('--vscode-textCodeBlock-background')
        .trim(),
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[wavedrom preview-pane] ${JSON.stringify(info)}`)

  expect(info.hasReg).toBe(true)
  // The wavedrom <pre> in the Preview pane must be transparent (page shows through), NOT the code panel.
  expect(info.preBg).toBe('rgba(0, 0, 0, 0)')
})
