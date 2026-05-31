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
