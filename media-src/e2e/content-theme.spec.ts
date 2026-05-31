import { test, expect } from './coverage-fixture'

// Guards the content-theme fix (table/content theme must follow live theme
// switches). Vditor's setContentTheme is a no-op when its path is empty — which
// happens once the host strips the stale baked `preview.theme.path` from saved
// options. applyVditorTheme therefore passes the content-theme path EXPLICITLY
// (4th setTheme arg); assert that swaps the `#vditorContentTheme` link between
// light.css and dark.css.
test('setTheme with an explicit path swaps the content-theme stylesheet', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__ready === true)
  const result = await page.evaluate(() => {
    const v = (window as any).vditor
    const path = location.origin + '/vditor/dist/css/content-theme'
    v.setTheme('classic', 'light', 'github', path)
    const light = document
      .getElementById('vditorContentTheme')
      ?.getAttribute('href')
    v.setTheme('dark', 'dark', 'github-dark', path)
    const dark = document
      .getElementById('vditorContentTheme')
      ?.getAttribute('href')
    return { light, dark }
  })
  expect(result.light).toContain('/content-theme/light.css')
  expect(result.dark).toContain('/content-theme/dark.css')
})

// Tables/code follow the VS Code theme colours (not Vditor's fixed content-theme
// palette) when use-vscode-theme-color is on — so content matches a custom theme.
test('table background follows --vscode-editor-background when the option is on', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__ready === true)
  const bg = await page.evaluate(() => {
    document.documentElement.style.setProperty(
      '--vscode-editor-background',
      'rgb(50, 0, 0)'
    )
    document.body.setAttribute('data-use-vscode-theme-color', '1')
    const tr = document.querySelector('.vditor-reset table tr') as HTMLElement
    return tr ? getComputedStyle(tr).backgroundColor : null
  })
  expect(bg).toBe('rgb(50, 0, 0)') // the sentinel VS Code colour, not #2f363d
})

test('blockquote uses a translucent overlay (theme-following) when the option is on', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__ready === true)
  const bg = await page.evaluate(() => {
    document.body.setAttribute('data-use-vscode-theme-color', '1')
    const reset = document.querySelector('.vditor-reset')!
    const bq = document.createElement('blockquote')
    bq.textContent = 'q'
    reset.appendChild(bq)
    return getComputedStyle(bq).backgroundColor
  })
  // not the fixed --vscode-textBlockQuote-background; a translucent overlay
  expect(bg).toBe('rgba(127, 127, 127, 0.1)')
})

test('task-list checkbox accent follows the VS Code theme when the option is on', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__ready === true)
  const accent = await page.evaluate(() => {
    document.documentElement.style.setProperty(
      '--vscode-checkbox-background',
      'rgb(10, 20, 30)'
    )
    document.body.setAttribute('data-use-vscode-theme-color', '1')
    const reset = document.querySelector('.vditor-reset')!
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    reset.appendChild(cb)
    return getComputedStyle(cb).accentColor
  })
  expect(accent).toBe('rgb(10, 20, 30)') // themed accent, not the browser default
})

// Consolidated theme-following contract: with the option on, the content layers
// + elements resolve their colours from --vscode-* vars (so a custom VS Code
// theme is honoured), and the background stays consistent across wrapper layers
// (the focus-shade fix). Sentinel colours prove the var — not a fixed palette.
test('content elements + wrapper layers follow VS Code theme vars when the option is on', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__ready === true)
  const got = await page.evaluate(() => {
    const root = document.documentElement.style
    root.setProperty('--vscode-editor-background', 'rgb(1, 2, 3)')
    root.setProperty('--vscode-textCodeBlock-background', 'rgb(4, 5, 6)')
    root.setProperty('--vscode-panel-border', 'rgb(7, 8, 9)')
    document.body.setAttribute('data-use-vscode-theme-color', '1')
    const reset = document.querySelector('.vditor-reset') as HTMLElement
    reset.insertAdjacentHTML(
      'beforeend',
      '<pre id="t-pre"><code>x</code></pre>' +
        '<p><code id="t-inline">y</code></p>' +
        '<hr id="t-hr">'
    )
    const cs = (id: string, p: string) =>
      (getComputedStyle(document.getElementById(id)!) as any)[p]
    const td = document.querySelector('.vditor-reset table td') as HTMLElement
    return {
      resetBg: getComputedStyle(reset).backgroundColor,
      preBg: cs('t-pre', 'backgroundColor'),
      inlineBg: cs('t-inline', 'backgroundColor'),
      hrBg: cs('t-hr', 'backgroundColor'),
      tdBorder: td ? getComputedStyle(td).borderTopColor : null,
    }
  })
  expect(got.resetBg).toBe('rgb(1, 2, 3)') // wrapper bg = editor bg (focus-consistent)
  expect(got.preBg).toBe('rgb(4, 5, 6)') // code block
  expect(got.inlineBg).toBe('rgb(4, 5, 6)') // inline code
  expect(got.hrBg).toBe('rgb(7, 8, 9)') // rule
  expect(got.tdBorder).toBe('rgb(7, 8, 9)') // table border
})

test('the theme overrides are gated on the option (off → not applied)', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__ready === true)
  const bg = await page.evaluate(() => {
    document.documentElement.style.setProperty(
      '--vscode-editor-background',
      'rgb(1, 2, 3)'
    )
    document.body.setAttribute('data-use-vscode-theme-color', '0')
    const reset = document.querySelector('.vditor-reset') as HTMLElement
    return getComputedStyle(reset).backgroundColor
  })
  expect(bg).not.toBe('rgb(1, 2, 3)') // override only applies when the attr is "1"
})
