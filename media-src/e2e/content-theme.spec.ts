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
