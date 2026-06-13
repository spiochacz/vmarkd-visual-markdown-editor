import type { Page } from '@playwright/test'
import { test, expect } from './coverage-fixture'

// The GitHub themes are the vendored upstream github-markdown-css files under
// media/markdown-themes/ (loaded as <link> in the real webview). The harness page
// doesn't include them, so load the actual file via addStyleTag (path resolved
// against the cwd = media-src, where Playwright runs) and add the markdown-body
// class the upstream CSS targets — exactly what the webview does.
const THEME_DIR = '../media/markdown-themes'

// A2: reproduce the cascade the REAL webview sits on but the harness page omits, so a
// theme that "looks fine here" can't quietly lose in the editor:
//   1. Vditor's own content-theme palette (`.vditor-reset …`, loaded via setContentTheme),
//   2. VS Code's injected webview default stylesheet (`blockquote{background:…}`, a bare
//      low-priority rule like the UA sheet).
// Both sit UNDER the theme link in source order. Call this BEFORE adding the theme link
// so the theme loads last (the html-builder order), then add markdown-body + attr 0.
async function installRealWebviewBaseline(
  page: Page,
  mode: 'light' | 'dark' = 'light',
): Promise<void> {
  // Vditor's palette — inlined first, like the vditorContentTheme link in the head.
  await page.addStyleTag({
    path: `../media/vditor/dist/css/content-theme/${mode}.css`,
  })
  // VS Code's injected default (a dark theme's blockquote bg, to make a leak obvious).
  await page.evaluate(() => {
    const s = document.createElement('style')
    s.id = 'vscode-injected-default'
    s.textContent =
      'blockquote{background:var(--vscode-textBlockQuote-background);}'
    document.head.insertBefore(s, document.head.firstChild) // low priority, like UA
    document.documentElement.style.setProperty(
      '--vscode-textBlockQuote-background',
      'rgb(20, 22, 28)',
    )
  })
}

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
    const path = `${location.origin}/vditor/dist/css/content-theme`
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
      'rgb(50, 0, 0)',
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
      'rgb(10, 20, 30)',
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
// `auto` now feeds Vditor's var-ified content-theme via --vmarkd-* (task 84/85 unify),
// so load Vditor's content-theme like the real webview does (the harness omits it).
test('content elements + wrapper layers follow VS Code theme vars when the option is on', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__ready === true)
  await page.addStyleTag({
    path: '../media/vditor/dist/css/content-theme/light.css',
  })
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
        '<hr id="t-hr">',
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
      'rgb(1, 2, 3)',
    )
    document.body.setAttribute('data-use-vscode-theme-color', '0')
    const reset = document.querySelector('.vditor-reset') as HTMLElement
    return getComputedStyle(reset).backgroundColor
  })
  expect(bg).not.toBe('rgb(1, 2, 3)') // override only applies when the attr is "1"
})

// Task 82: a GitHub rendering theme recolours the rendered markdown to the GitHub
// canvas REGARDLESS of the VS Code theme. The upstream CSS uses fixed hex values
// (no --vscode-* vars), so loading it + the markdown-body class is inherently
// independent of the editor theme; simulate the opposite VS Code bg to make that
// explicit. The upstream `.markdown-body` rule paints the container background.
test('github-dark paints the GitHub dark canvas independent of the VS Code theme (task 82)', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__ready === true)
  await page.addStyleTag({ path: `${THEME_DIR}/github-markdown-dark.css` })
  const got = await page.evaluate(() => {
    // simulate a LIGHT VS Code theme to prove the GitHub theme wins
    document.documentElement.style.setProperty(
      '--vscode-editor-background',
      'rgb(255, 255, 255)',
    )
    document.documentElement.style.setProperty(
      '--vscode-editor-font-family',
      'Comic Sans MS',
    )
    document.body.classList.add('markdown-body')
    const reset = document.querySelector('.vditor-reset') as HTMLElement
    return {
      bg: getComputedStyle(document.body).backgroundColor,
      font: getComputedStyle(reset).fontFamily,
    }
  })
  expect(got.bg).toBe('rgb(13, 17, 23)') // GitHub dark canvas #0d1117, not the white VS Code bg
  // content uses GitHub's system font stack, NOT the VS Code editor font (task 43 override)
  expect(got.font).toContain('BlinkMacSystemFont')
  expect(got.font).not.toContain('Comic Sans')
})

test('github-light paints the GitHub light canvas independent of the VS Code theme (task 82)', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__ready === true)
  await page.addStyleTag({ path: `${THEME_DIR}/github-markdown-light.css` })
  const bg = await page.evaluate(() => {
    // simulate a DARK VS Code theme to prove the GitHub theme wins
    document.documentElement.style.setProperty(
      '--vscode-editor-background',
      'rgb(0, 0, 0)',
    )
    document.body.classList.add('markdown-body')
    return getComputedStyle(document.body).backgroundColor
  })
  expect(bg).toBe('rgb(255, 255, 255)') // GitHub light canvas #ffffff, not the black VS Code bg
})

// Task 82: Material Dark (One Dark) content theme — vendored from raycon, adapted.
test('material-dark paints the One Dark palette independent of the VS Code theme (task 82)', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__ready === true)
  await page.addStyleTag({ path: '../media/markdown-themes/material-dark.css' })
  const got = await page.evaluate(() => {
    // simulate a LIGHT VS Code theme to prove the theme wins
    document.documentElement.style.setProperty(
      '--vscode-editor-background',
      'rgb(255, 255, 255)',
    )
    document.body.classList.add('markdown-body')
    const reset = document.querySelector('.vditor-reset') as HTMLElement
    const a = document.createElement('a')
    a.href = '#'
    a.textContent = 'x'
    reset.appendChild(a)
    return {
      bg: getComputedStyle(document.body).backgroundColor,
      text: getComputedStyle(reset).color,
      link: getComputedStyle(a).color,
    }
  })
  expect(got.bg).toBe('rgb(40, 44, 52)') // One Dark canvas #282c34, not the white VS Code bg
  expect(got.text).toBe('rgb(171, 178, 191)') // One Dark fg #abb2bf
  expect(got.link).toBe('rgb(97, 175, 239)') // One Dark accent #61afef
})

// Task 82: VS Code markdown preview dark — fixed dark palette regardless of VS Code.
test('vscode-dark-2026 paints a fixed dark palette independent of the VS Code theme (task 82)', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__ready === true)
  // Vditor's own content-theme palette loads FIRST in the real webview; the theme
  // must out-rank it (esp. inline code, which Vditor tints blue at 0,3,1).
  await page.addStyleTag({
    path: '../media/vditor/dist/css/content-theme/dark.css',
  })
  await page.addStyleTag({ path: `${THEME_DIR}/vscode-dark-2026.css` })
  const got = await page.evaluate(() => {
    document.documentElement.style.setProperty(
      '--vscode-editor-background',
      'rgb(255, 255, 255)',
    )
    document.body.classList.add('markdown-body')
    const reset = document.querySelector('.vditor-reset') as HTMLElement
    const bq = document.createElement('blockquote')
    bq.textContent = 'q'
    reset.appendChild(bq)
    const code = document.createElement('code')
    code.textContent = 'x'
    reset.appendChild(code)
    return {
      bg: getComputedStyle(document.body).backgroundColor,
      text: getComputedStyle(reset).color,
      bqBg: getComputedStyle(bq).backgroundColor,
      codeBg: getComputedStyle(code).backgroundColor,
    }
  })
  expect(got.bg).toBe('rgb(18, 19, 20)') // Dark 2026 editor.background #121314, not the white VS Code bg
  expect(got.text).toBe('rgb(187, 190, 191)') // Dark 2026 editor.foreground #bbbebf
  // VS Code blockquote is a subtle grey panel (textBlockQuote #242526), not transparent
  expect(got.bqBg).toBe('rgb(36, 37, 38)')
  // inline code = textPreformat #262626 — NOT Vditor's blue-tinted dark code bg
  expect(got.codeBg).toBe('rgb(38, 38, 38)')
})

// Task 82: the Vditor toolbar ("bar") always follows VS Code — even with a GitHub
// content theme active (body.markdown-body), the toolbar background resolves from
// --vscode-editor-background, not from the theme. Only the content is themed.
test('toolbar background follows VS Code even with a GitHub content theme (task 82)', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__ready === true)
  const bg = await page.evaluate(() => {
    document.documentElement.style.setProperty(
      '--vscode-editor-background',
      'rgb(7, 8, 9)',
    )
    // a GitHub theme is active on the content…
    document.body.classList.add('markdown-body')
    // …but the toolbar chrome must still resolve to the VS Code background.
    const tb = document.querySelector('.vditor-toolbar') as HTMLElement
    return tb ? getComputedStyle(tb).backgroundColor : null
  })
  expect(bg).toBe('rgb(7, 8, 9)') // VS Code sentinel, not a GitHub palette colour
})

// Task 82 regression: the REAL VS Code webview injects a default stylesheet that
// paints `blockquote { background: var(--vscode-textBlockQuote-background) }`. Our
// `auto` rule overrides it, but GitHub's blockquote rule sets only colour/border —
// no background — so a dark VS Code theme's blockquote background would leak through
// a GitHub (light) content theme: a dark quote box in a light document. The content
// theme must neutralise that so the blockquote matches GitHub (no background).
test('GitHub blockquote ignores the VS Code default blockquote background (task 82)', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__ready === true)
  await page.addStyleTag({
    path: `${THEME_DIR}/github-markdown-light.css`,
  })
  const bg = await page.evaluate(() => {
    // Simulate VS Code's injected webview default (a dark theme's blockquote bg),
    // inserted first so it sits at low priority like the UA/default sheet.
    const s = document.createElement('style')
    s.textContent =
      'blockquote{background:var(--vscode-textBlockQuote-background);}'
    document.head.insertBefore(s, document.head.firstChild)
    document.documentElement.style.setProperty(
      '--vscode-textBlockQuote-background',
      'rgb(20, 22, 28)',
    )
    document.body.classList.add('markdown-body')
    document.body.setAttribute('data-use-vscode-theme-color', '0')
    ;(window as any).vditor.setValue('> **Status:** Done\n> **Source:** x')
    const bq = document.querySelector(
      '.vditor-ir .vditor-reset blockquote',
    ) as HTMLElement
    return getComputedStyle(bq).backgroundColor
  })
  // not the leaked dark VS Code blockquote background — GitHub blockquotes have none
  expect(bg).not.toBe('rgb(20, 22, 28)')
  expect(bg).toBe('rgba(0, 0, 0, 0)')
})

// Task 82: the toolbar dropdown menus (.vditor-panel / .vditor-hint) are chrome —
// they must follow VS Code's menu background even with a GitHub content theme. The
// VS Code-native chrome rules live in vscode-chrome.css; they must NOT be gated on
// the content theme (a white menu on a dark VS Code toolbar otherwise).
test('toolbar dropdown menu follows VS Code with a GitHub content theme (task 82)', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__ready === true)
  await page.addStyleTag({ path: 'src/vscode-chrome.css' })
  const bg = await page.evaluate(() => {
    document.documentElement.style.setProperty(
      '--vscode-menu-background',
      'rgb(30, 31, 34)',
    )
    // GitHub content theme is active (attr 0 + markdown-body) — chrome must still
    // resolve to the VS Code menu surface.
    document.body.classList.add('markdown-body')
    document.body.setAttribute('data-use-vscode-theme-color', '0')
    const panel = document.createElement('div')
    panel.className = 'vditor-hint'
    document.querySelector('.vditor')!.appendChild(panel)
    return getComputedStyle(panel).backgroundColor
  })
  expect(bg).toBe('rgb(30, 31, 34)') // VS Code menu bg, not Vditor's default light panel
})

// Task 82 regression: the REAL webview loads Vditor's own content-theme palette
// (content-theme/light.css, id=vditorContentTheme, applied via setTheme) which styles
// `.vditor-reset blockquote/code/...` — at the SAME specificity as github-markdown-css's
// `.markdown-body …` rules, and the vendored github CSS carries no !important. So github
// only wins if its <link> loads AFTER Vditor's (html-builder emits it after
// prerender.themeLink). The harness page omits Vditor's content-theme, so without this
// test the github cascade looks fine here but loses in the real editor. Mirror the real
// order: Vditor content-theme first, github second, and assert github's palette wins —
// blockquote colour + inline-code background — and that font-size follows --me-font-size.
test("github wins Vditor's content-theme palette when loaded after it (task 82)", async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__ready === true)
  const got = await page.evaluate(async () => {
    // 1) Vditor's bundled content-theme palette — loaded FIRST, like setContentTheme does.
    const vditorCt = document.createElement('link')
    vditorCt.id = 'vditorContentTheme'
    vditorCt.rel = 'stylesheet'
    vditorCt.href = '/vditor/dist/css/content-theme/light.css'
    document.head.appendChild(vditorCt)
    await new Promise((r) => {
      vditorCt.addEventListener('load', r)
      vditorCt.addEventListener('error', r)
    })
    // 2) github-light — loaded AFTER (the html-builder order).
    const gh = document.createElement('link')
    gh.id = 'ct-github-light'
    gh.rel = 'stylesheet'
    gh.href = '/markdown-themes/github-markdown-light.css'
    document.head.appendChild(gh)
    await new Promise((r) => {
      gh.addEventListener('load', r)
      gh.addEventListener('error', r)
    })
    document.body.classList.add('markdown-body')
    // font-size follows --me-font-size (the host/webview default it to 16px for a
    // GitHub theme; an explicit `fontSize` setting still scales it). Pin a sentinel
    // to prove the theme honours it rather than hard-coding a size.
    document.body.style.setProperty('--me-font-size', '19px')
    const reset = document.querySelector('.vditor-reset') as HTMLElement
    reset.insertAdjacentHTML(
      'beforeend',
      '<blockquote id="t-bq">q</blockquote><p><code id="t-code">x</code></p>',
    )
    const cs = (id: string, p: string) =>
      (getComputedStyle(document.getElementById(id)!) as any)[p]
    return {
      bqColor: cs('t-bq', 'color'),
      codeBg: cs('t-code', 'backgroundColor'),
      fontSize: getComputedStyle(reset).fontSize,
    }
  })
  // GitHub blockquote text #59636e — NOT Vditor's content-theme #6a737d rgb(106,115,125)
  expect(got.bqColor).toBe('rgb(89, 99, 110)')
  // GitHub inline-code bg #818b981f — NOT Vditor's rgba(27,31,35,.05)
  expect(got.codeBg).toContain('129, 139, 152')
  // font-size honours --me-font-size (the `fontSize` setting), not a hard-coded value
  expect(got.fontSize).toBe('19px')
})

// Task 82: exercise the REAL mechanism the extension uses — two <link> stylesheets,
// one enabled via link.disabled — and confirm a blockquote follows the enabled
// GitHub theme, and re-follows when the enabled link is switched (auto ↔ light ↔ dark).
test('blockquote follows the enabled GitHub <link>, and switches with link.disabled (task 82)', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__ready === true)
  // Mirror html-builder exactly: both links present, the inactive one carries the
  // `disabled` ATTRIBUTE from the start (setting the .disabled property before load
  // is ineffective — the sheet would load and win regardless).
  await page.evaluate(async () => {
    const light = document.createElement('link')
    light.id = 'ct-github-light'
    light.rel = 'stylesheet'
    light.href = '/markdown-themes/github-markdown-light.css'
    const dark = document.createElement('link')
    dark.id = 'ct-github-dark'
    dark.rel = 'stylesheet'
    dark.href = '/markdown-themes/github-markdown-dark.css'
    dark.setAttribute('disabled', '') // inactive via attribute (server-HTML path)
    document.head.appendChild(light)
    document.head.appendChild(dark)
    await new Promise((r) => {
      light.addEventListener('load', r)
      light.addEventListener('error', r)
    })
    document.body.classList.add('markdown-body')
    ;(window as any).vditor.setValue('> a quoted line')
  })
  const bqColor = () =>
    page.evaluate(() => {
      const bq = document.querySelector(
        '.vditor-ir .vditor-reset blockquote',
      ) as HTMLElement
      return bq ? getComputedStyle(bq).color : null
    })
  // github-light enabled → light blockquote text (#59636e)
  expect(await bqColor()).toBe('rgb(89, 99, 110)')
  // switch enabled link to dark (the applyContentTheme toggle)
  await page.evaluate(() => {
    ;(document.getElementById('ct-github-light') as HTMLLinkElement).disabled =
      true
    ;(document.getElementById('ct-github-dark') as HTMLLinkElement).disabled =
      false
  })
  // github-dark now enabled → dark blockquote text (#9198a1)
  await page.waitForFunction(() => {
    const bq = document.querySelector('.vditor-ir .vditor-reset blockquote')
    return bq && getComputedStyle(bq).color === 'rgb(145, 152, 161)'
  })
  expect(await bqColor()).toBe('rgb(145, 152, 161)')
})

// A3: every content theme renders its blockquote correctly against the REAL webview
// baseline (Vditor's palette + VS Code's injected blockquote bg). GitHub + Material
// have no blockquote background (neutralised to transparent so the injected dark box
// can't leak); the VS Code themes keep their own panel background. One parametrized
// guard for the whole "leaks only in the real editor" class, across all themes.
test.describe('blockquote survives the real webview baseline (task 82 / A3)', () => {
  const cases = [
    {
      theme: 'github-light',
      file: 'github-markdown-light.css',
      mode: 'light',
      bg: 'rgba(0, 0, 0, 0)',
    },
    {
      theme: 'github-dark',
      file: 'github-markdown-dark.css',
      mode: 'dark',
      bg: 'rgba(0, 0, 0, 0)',
    },
    {
      theme: 'material-dark',
      file: 'material-dark.css',
      mode: 'dark',
      bg: 'rgba(0, 0, 0, 0)',
    },
    {
      theme: 'vscode-light-2026',
      file: 'vscode-light-2026.css',
      mode: 'light',
      bg: 'rgb(234, 234, 234)',
    },
    {
      theme: 'vscode-dark-2026',
      file: 'vscode-dark-2026.css',
      mode: 'dark',
      bg: 'rgb(36, 37, 38)',
    },
  ] as const
  for (const c of cases) {
    test(`${c.theme} blockquote = ${c.bg}`, async ({ page }) => {
      await page.goto('/')
      await page.waitForFunction(() => (window as any).__ready === true)
      await installRealWebviewBaseline(page, c.mode)
      await page.addStyleTag({ path: `${THEME_DIR}/${c.file}` })
      const bg = await page.evaluate(() => {
        document.body.classList.add('markdown-body')
        document.body.setAttribute('data-use-vscode-theme-color', '0')
        const reset = document.querySelector('.vditor-reset') as HTMLElement
        const bq = document.createElement('blockquote')
        bq.textContent = 'q'
        reset.appendChild(bq)
        return getComputedStyle(bq).backgroundColor
      })
      expect(bg).not.toBe('rgb(20, 22, 28)') // never the leaked VS Code injected default
      expect(bg).toBe(c.bg) // the theme's own blockquote treatment
    })
  }
})

// Task 85: completeness — `hr` and table-row backgrounds. Vditor's base palette gives
// `hr` a background-coloured bar and zebra-striped rows (and the dark content-theme
// makes the bar light) that don't match a theme; a complete theme owns both on the
// editor surface. Asserted against the real webview baseline (Vditor palette loaded).
test.describe('hr + table row backgrounds are owned by each theme (task 85)', () => {
  const cases = [
    {
      theme: 'github-light',
      file: 'github-markdown-light.css',
      mode: 'light',
      hr: 'rgb(209, 217, 224)',
      even: 'rgb(246, 248, 250)',
    },
    {
      theme: 'github-dark',
      file: 'github-markdown-dark.css',
      mode: 'dark',
      hr: 'rgb(61, 68, 77)',
      even: 'rgb(21, 27, 35)',
    },
    {
      theme: 'material-dark',
      file: 'material-dark.css',
      mode: 'dark',
      hr: 'rgb(59, 64, 72)',
      even: 'rgba(171, 178, 191, 0.04)',
    },
    {
      // VS Code markdown.css: hr = .vscode-light rgba(0,0,0,0.18); no table-row striping.
      theme: 'vscode-light-2026',
      file: 'vscode-light-2026.css',
      mode: 'light',
      hr: 'rgba(0, 0, 0, 0.18)',
      even: 'rgba(0, 0, 0, 0)',
    },
    {
      // VS Code markdown.css: hr = .vscode-dark rgba(255,255,255,0.18); no table-row striping.
      theme: 'vscode-dark-2026',
      file: 'vscode-dark-2026.css',
      mode: 'dark',
      hr: 'rgba(255, 255, 255, 0.18)',
      even: 'rgba(0, 0, 0, 0)',
    },
  ] as const
  // Vditor's default `hr` bar leaks light on a dark theme — must never be the result.
  const VDITOR_HR_LEAK = ['rgb(209, 213, 218)', 'rgb(234, 236, 239)']
  for (const c of cases) {
    test(`${c.theme}: hr=${c.hr}, even row=${c.even}`, async ({ page }) => {
      await page.goto('/')
      await page.waitForFunction(() => (window as any).__ready === true)
      await installRealWebviewBaseline(page, c.mode)
      await page.addStyleTag({ path: `${THEME_DIR}/${c.file}` })
      const got = await page.evaluate(() => {
        document.body.classList.add('markdown-body')
        document.body.setAttribute('data-use-vscode-theme-color', '0')
        const reset = document.querySelector('.vditor-reset') as HTMLElement
        reset.insertAdjacentHTML(
          'beforeend',
          '<hr id="t-hr"><table><tbody><tr><td>a</td></tr><tr id="t-even"><td>b</td></tr></tbody></table>',
        )
        const cs = (id: string) =>
          getComputedStyle(document.getElementById(id)!).backgroundColor
        return { hr: cs('t-hr'), even: cs('t-even') }
      })
      expect(VDITOR_HR_LEAK).not.toContain(got.hr) // never Vditor's leaked bar
      expect(got.hr).toBe(c.hr)
      expect(got.even).toBe(c.even)
    })
  }
})

// Scrollbars + form controls follow the theme's light/dark scheme (color-scheme), not
// the VS Code editor's — else a dark content theme on a light editor shows light
// scrollbars on dark code blocks (and vice-versa). github-markdown-css sets it; the
// vMarkd themes must too.
test.describe('color-scheme matches the theme, not the editor (task 85)', () => {
  const cases = [
    {
      theme: 'github-light',
      file: 'github-markdown-light.css',
      scheme: 'light',
    },
    { theme: 'github-dark', file: 'github-markdown-dark.css', scheme: 'dark' },
    { theme: 'material-dark', file: 'material-dark.css', scheme: 'dark' },
    {
      theme: 'vscode-light-2026',
      file: 'vscode-light-2026.css',
      scheme: 'light',
    },
    {
      theme: 'vscode-dark-2026',
      file: 'vscode-dark-2026.css',
      scheme: 'dark',
    },
  ] as const
  for (const c of cases) {
    test(`${c.theme} → color-scheme: ${c.scheme}`, async ({ page }) => {
      await page.goto('/')
      await page.waitForFunction(() => (window as any).__ready === true)
      await page.addStyleTag({ path: `${THEME_DIR}/${c.file}` })
      const scheme = await page.evaluate(() => {
        document.body.classList.add('markdown-body')
        return getComputedStyle(document.body).colorScheme
      })
      expect(scheme).toBe(c.scheme)
    })
  }
})

// Task 85: content scrollbars follow the content theme, not the VS Code editor. VS Code
// drives the webview's NATIVE scrollbars (it sets color-scheme on the root); we override
// with the inherited `scrollbar-color` on the themed body so EVERY content scroller —
// incl. nested ones like code blocks — is recoloured, beating a root-level value. `auto`
// (no markdown-body) is untouched.
test('content scrollbar-color overrides the editor and inherits to nested scrollers (task 85)', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__ready === true)
  const got = await page.evaluate(() => {
    // simulate VS Code colouring the webview-root scrollbars (a sentinel)
    document.documentElement.style.setProperty(
      'scrollbar-color',
      'rgb(200, 200, 200) rgb(200, 200, 200)',
    )
    document.body.classList.add('markdown-body')
    const reset = document.querySelector('.vditor-reset') as HTMLElement
    const code = document.createElement('pre') // a nested scroller (code block)
    code.style.overflow = 'auto'
    reset.appendChild(code)
    return {
      body: getComputedStyle(document.body).scrollbarColor,
      nested: getComputedStyle(code).scrollbarColor, // inherits from the themed body
      root: getComputedStyle(document.documentElement).scrollbarColor, // editor value, untouched
    }
  })
  // themed body + every nested content scroller use our thumb, NOT the editor sentinel
  expect(got.body).toBe('rgba(128, 128, 128, 0.5) rgba(0, 0, 0, 0)')
  expect(got.nested).toBe('rgba(128, 128, 128, 0.5) rgba(0, 0, 0, 0)')
  expect(got.nested).not.toContain('200, 200, 200')
  expect(got.root).toBe('rgb(200, 200, 200) rgb(200, 200, 200)') // editor scrollbars unchanged
})

// ── Theme completeness contract (task 85) ─────────────────────────────────────
// One parametrized guard: every registry theme renders the FULL palette correctly
// against the real webview baseline (Vditor's palette + VS Code's injected blockquote
// default). Mechanism-agnostic — github wins via direct `.markdown-body` rules, the
// others via `--vmarkd-*` variables; this asserts the RESULT either way. A new theme
// added to the registry must get a row here (the coverage guard fails otherwise), so a
// theme can't silently ship missing a property (the hr / scrollbar class of bug).
import { NAMED_THEME_VALUES } from '../../src/theme-registry'

const THEME_CONTRACT = [
  {
    theme: 'github-light',
    file: 'github-markdown-light.css',
    mode: 'light',
    canvas: 'rgb(255, 255, 255)',
    bqColor: 'rgb(89, 99, 110)',
    bqBg: 'rgba(0, 0, 0, 0)',
    hr: 'rgb(209, 217, 224)',
    code: 'rgba(129, 139, 152, 0.12)',
    stripe: 'rgb(246, 248, 250)',
    scheme: 'light',
  },
  {
    theme: 'github-dark',
    file: 'github-markdown-dark.css',
    mode: 'dark',
    canvas: 'rgb(13, 17, 23)',
    bqColor: 'rgb(145, 152, 161)',
    bqBg: 'rgba(0, 0, 0, 0)',
    hr: 'rgb(61, 68, 77)',
    code: 'rgba(101, 108, 118, 0.2)',
    stripe: 'rgb(21, 27, 35)',
    scheme: 'dark',
  },
  {
    theme: 'material-dark',
    file: 'material-dark.css',
    mode: 'dark',
    canvas: 'rgb(40, 44, 52)',
    bqColor: 'rgb(127, 132, 142)',
    bqBg: 'rgba(0, 0, 0, 0)',
    hr: 'rgb(59, 64, 72)',
    code: 'rgba(171, 178, 191, 0.1)',
    stripe: 'rgba(171, 178, 191, 0.04)',
    scheme: 'dark',
  },
  {
    theme: 'vscode-light-2026',
    file: 'vscode-light-2026.css',
    mode: 'light',
    canvas: 'rgb(255, 255, 255)', // editor.background #ffffff
    bqColor: 'rgb(32, 32, 32)', // editor.foreground #202020
    bqBg: 'rgb(234, 234, 234)', // textBlockQuote.background #eaeaea
    hr: 'rgba(0, 0, 0, 0.18)', // markdown.css .vscode-light hairline
    code: 'rgb(236, 236, 236)', // textPreformat.background #ececec
    stripe: 'rgba(0, 0, 0, 0)', // VS Code does not zebra table rows
    scheme: 'light',
  },
  {
    theme: 'vscode-dark-2026',
    file: 'vscode-dark-2026.css',
    mode: 'dark',
    canvas: 'rgb(18, 19, 20)', // editor.background #121314
    bqColor: 'rgb(187, 190, 191)', // editor.foreground #bbbebf
    bqBg: 'rgb(36, 37, 38)', // textBlockQuote.background #242526
    hr: 'rgba(255, 255, 255, 0.18)', // markdown.css .vscode-dark hairline
    code: 'rgb(38, 38, 38)', // textPreformat.background #262626
    stripe: 'rgba(0, 0, 0, 0)', // VS Code does not zebra table rows
    scheme: 'dark',
  },
] as const

test('every registry theme has a completeness-contract row (no silent gaps)', () => {
  expect([...THEME_CONTRACT.map((c) => c.theme)].sort()).toEqual(
    [...NAMED_THEME_VALUES].sort(),
  )
})

for (const c of THEME_CONTRACT) {
  test(`completeness: ${c.theme} renders the full palette (task 85)`, async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForFunction(() => (window as any).__ready === true)
    await installRealWebviewBaseline(page, c.mode)
    await page.addStyleTag({ path: `${THEME_DIR}/${c.file}` })
    const got = await page.evaluate(() => {
      document.body.classList.add('markdown-body')
      document.body.setAttribute('data-use-vscode-theme-color', '0')
      const reset = document.querySelector('.vditor-reset') as HTMLElement
      reset.insertAdjacentHTML(
        'beforeend',
        '<blockquote id="c-bq">q</blockquote>' +
          '<p><code id="c-code">x</code></p>' +
          '<hr id="c-hr">' +
          '<table><tbody><tr><td>a</td></tr><tr id="c-even"><td>b</td></tr></tbody></table>',
      )
      const bg = (id: string) =>
        getComputedStyle(document.getElementById(id)!).backgroundColor
      return {
        canvas: getComputedStyle(document.body).backgroundColor,
        bqColor: getComputedStyle(document.getElementById('c-bq')!).color,
        bqBg: bg('c-bq'),
        hr: bg('c-hr'),
        code: bg('c-code'),
        stripe: bg('c-even'),
        scheme: getComputedStyle(document.body).colorScheme,
      }
    })
    expect(got.canvas).toBe(c.canvas)
    expect(got.bqColor).toBe(c.bqColor)
    expect(got.bqBg).toBe(c.bqBg)
    expect(got.hr).toBe(c.hr)
    expect(got.code).toBe(c.code)
    expect(got.stripe).toBe(c.stripe)
    expect(got.scheme).toBe(c.scheme)
  })
}

// Link + task-list checkbox follow the content theme via --vmarkd-link. Vditor hardcodes the
// IR edit-surface link span (.vditor-ir__link) to its bright --ir-bracket-color (#0000ff) +
// underline (following no theme), and a named theme's checkbox otherwise falls back to the
// browser-default blue. main.css points both at --vmarkd-link and drops the IR underline.
const LINK_CONTRACT = [
  {
    theme: 'github-light',
    file: 'github-markdown-light.css',
    mode: 'light',
    link: 'rgb(9, 105, 218)',
  },
  {
    theme: 'github-dark',
    file: 'github-markdown-dark.css',
    mode: 'dark',
    link: 'rgb(68, 147, 248)',
  },
  {
    theme: 'material-dark',
    file: 'material-dark.css',
    mode: 'dark',
    link: 'rgb(97, 175, 239)',
  },
  {
    theme: 'vscode-light-2026',
    file: 'vscode-light-2026.css',
    mode: 'light',
    link: 'rgb(0, 105, 204)',
  },
  {
    theme: 'vscode-dark-2026',
    file: 'vscode-dark-2026.css',
    mode: 'dark',
    link: 'rgb(72, 160, 199)',
  },
] as const
for (const c of LINK_CONTRACT) {
  test(`IR link + checkbox follow --vmarkd-link (${c.theme})`, async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForFunction(() => (window as any).__ready === true)
    await installRealWebviewBaseline(page, c.mode)
    await page.addStyleTag({ path: `${THEME_DIR}/${c.file}` })
    const got = await page.evaluate(() => {
      document.body.classList.add('markdown-body')
      document.body.setAttribute('data-use-vscode-theme-color', '0')
      const reset = document.querySelector('.vditor-reset') as HTMLElement
      reset.insertAdjacentHTML(
        'beforeend',
        '<span class="vditor-ir__link" id="c-link">link</span>' +
          '<input type="checkbox" id="c-cb">',
      )
      const link = document.getElementById('c-link')!
      const cb = document.getElementById('c-cb')!
      return {
        linkColor: getComputedStyle(link).color,
        linkDecoration: getComputedStyle(link).textDecorationLine,
        checkboxAccent: getComputedStyle(cb).accentColor,
      }
    })
    expect(got.linkColor).toBe(c.link) // IR link = theme link, NOT Vditor's #0000ff
    expect(got.linkDecoration).toBe('none') // no underline (matches preview / VS Code)
    expect(got.checkboxAccent).toBe(c.link) // accent = theme link, NOT browser default
  })
}

// VS Code table/hr/code STRUCTURE parity (1:1 with markdown.css), scoped to vscode-2026.
// VS Code tables = horizontal rules only (header-bottom rgba .69 + between-row top rgba .18),
// no vertical/outer borders, left-aligned headers, padding 5px 10px; hr = 1px; code radius 3px.
for (const c of [
  {
    theme: 'vscode-light-2026',
    file: 'vscode-light-2026.css',
    mode: 'light',
    thBorder: 'rgba(0, 0, 0, 0.69)',
    tdBorder: 'rgba(0, 0, 0, 0.18)',
  },
  {
    theme: 'vscode-dark-2026',
    file: 'vscode-dark-2026.css',
    mode: 'dark',
    thBorder: 'rgba(255, 255, 255, 0.69)',
    tdBorder: 'rgba(255, 255, 255, 0.18)',
  },
] as const) {
  test(`VS Code table/hr/code structure (${c.theme})`, async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => (window as any).__ready === true)
    await installRealWebviewBaseline(page, c.mode)
    await page.addStyleTag({ path: `${THEME_DIR}/${c.file}` })
    const got = await page.evaluate(() => {
      document.body.classList.add('markdown-body')
      document.body.setAttribute('data-use-vscode-theme-color', '0')
      const reset = document.querySelector('.vditor-reset') as HTMLElement
      reset.insertAdjacentHTML(
        'beforeend',
        '<table><thead><tr><th id="x-th">h</th></tr></thead><tbody>' +
          '<tr><td id="x-td1">a</td></tr><tr><td id="x-td2">b</td></tr></tbody></table>' +
          '<hr id="x-hr"><pre><code class="hljs" id="x-cb">x</code></pre>' +
          '<p><code id="x-ic">inline</code></p>',
      )
      const cs = (id: string) => getComputedStyle(document.getElementById(id)!)
      const th = cs('x-th')
      const td1 = cs('x-td1')
      const td2 = cs('x-td2')
      const cb = cs('x-cb')
      const ic = cs('x-ic')
      return {
        thAlign: th.textAlign,
        thPad: th.padding,
        thSides: `${th.borderTopWidth}/${th.borderRightWidth}/${th.borderBottomWidth}/${th.borderLeftWidth}`,
        thBottomColor: th.borderBottomColor,
        td1Top: td1.borderTopWidth, // first body row: no top border
        td2Top: `${td2.borderTopWidth} ${td2.borderTopColor}`, // between-row rule
        hrH: cs('x-hr').height,
        cbRadius: cb.borderRadius,
        cbPad: cb.padding, // VS Code pre = 16px (hljs theme alone gives ~7px)
        cbOverflowX: cb.overflowX, // long lines scroll, like VS Code
        icPad: ic.padding, // VS Code shell = 1px 3px (GitHub default = .2em .4em, bigger)
        icRadius: ic.borderRadius,
      }
    })
    expect(got.thAlign).toBe('left')
    expect(got.thPad).toBe('5px 10px')
    expect(got.thSides).toBe('0px/0px/1px/0px') // only header-bottom
    expect(got.thBottomColor).toBe(c.thBorder)
    expect(got.td1Top).toBe('0px') // first row has no top rule
    expect(got.td2Top).toBe(`1px ${c.tdBorder}`)
    expect(got.hrH).toBe('1px')
    expect(got.cbRadius).toBe('3px')
    expect(got.cbPad).toBe('16px')
    expect(got.cbOverflowX).toBe('auto')
    expect(got.icPad).toBe('1px 3px')
    expect(got.icRadius).toBe('4px')
  })
}
