import { test, expect } from './coverage-fixture'

// Inline-code horizontal padding must MATCH across IR and WYSIWYG. Vditor zeroes WYSIWYG
// inline-code h-padding with !important; our build patch (patchVditorIndexCss) re-asserts it
// as `var(--vmarkd-code-px, .4em)` so WYSIWYG tracks the theme: vscode-2026 sets 3px (VS Code's
// `1px 3px`), github/material default to .4em. Guards against the IR↔WYSIWYG divergence that
// appeared when vscode-2026's inline padding was tightened without updating the WYSIWYG patch.
const cases = [
  { theme: 'vscode-light-2026.css', px: '3px' },
  { theme: 'github-markdown-light.css', px: '5.6px' }, // .4em @ 14px
] as const

for (const c of cases) {
  for (const mode of ['ir', 'wysiwyg'] as const) {
    test(`inline-code h-padding ${mode} (${c.theme}) = ${c.px}`, async ({
      page,
    }) => {
      await page.goto(`/keybugs.html?mode=${mode}`)
      await page.waitForFunction(() => (window as any).vditor)
      await page.addStyleTag({
        path: '../media/vditor/dist/css/content-theme/light.css',
      })
      await page.addStyleTag({ path: `../media/markdown-themes/${c.theme}` })
      await page.evaluate(() => {
        document.body.classList.add('markdown-body')
        document.body.setAttribute('data-use-vscode-theme-color', '0')
        ;(window as any).vditor.setValue('aaaa `kod` bbbb')
      })
      await page.waitForTimeout(400)
      const pad = await page.evaluate(() => {
        const code = (window as any)
          .__modeEl()
          .querySelector('code') as HTMLElement
        const cs = getComputedStyle(code)
        return { l: cs.paddingLeft, r: cs.paddingRight }
      })
      expect(pad.l).toBe(c.px)
      expect(pad.r).toBe(c.px)
    })
  }
}
