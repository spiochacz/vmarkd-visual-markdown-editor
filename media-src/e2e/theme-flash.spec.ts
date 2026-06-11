import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Open-flash regression guards (the "mrugnięcie" on every fresh open). Root cause chain:
// saveVditorOptions persists the whole `preview` blob, so a STALE `preview.theme.current`
// from a previous session reached Vditor's constructor (initUI → setContentTheme), which
// REPLACED the correct content-theme <link> the initial HTML shipped with the wrong file;
// after()'s setTheme replaced it back — and a <link> replacement is an async re-fetch, so
// for ~100 ms NO content-theme sheet was loaded → wrong colours flashed (text/hr/inline-
// code/code-panel, theme-dependent). Two fixes under guard here:
//   1. buildVditorOptions makes `preview.theme.current` mode-authoritative (last merge),
//      so the constructor never sees a stale mode → the link is never touched on open.
//   2. fixSetContentTheme (esbuild patch) makes Vditor's setContentTheme compare RESOLVED
//      URLs, so an equal-file call (same stylesheet, differently written href) never
//      tears the link down. A genuine theme switch must still reload.
// Reuses prerender.html — the real main.ts init flow with the content-theme link shipped
// in the initial HTML, exactly like the production webview.

const STALE_INIT = {
  command: 'update',
  type: 'init',
  content:
    '# Hello world\n\nA paragraph.\n\n---\n\n`inline` and:\n\n```js\nconst x = 1\n```\n',
  cdn: '/vditor',
  options: {
    showToolbar: true,
    useVscodeThemeColor: true,
    enableFullWidth: true,
    // The replayed saved blob from a PREVIOUS (light) session — the trigger of the bug:
    // pre-fix this reached the Vditor constructor and swapped the dark link to light.css.
    preview: { theme: { current: 'light' } },
  },
  theme: 'dark',
  wiki: { enabled: false },
}

async function open(page: Page) {
  // Record every add/remove of the content-theme <link> from BEFORE any page script —
  // a replacement (remove+add) is exactly the async re-fetch window that flashed.
  await page.addInitScript(() => {
    const events: string[] = []
    ;(window as any).__ctLinkEvents = events
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of Array.from(m.addedNodes)) {
          const e = n as HTMLLinkElement
          if (e.tagName === 'LINK' && e.id === 'vditorContentTheme') {
            events.push(`+${(e.getAttribute('href') || '').split('/').pop()}`)
          }
        }
        for (const n of Array.from(m.removedNodes)) {
          const e = n as HTMLLinkElement
          if (e.tagName === 'LINK' && e.id === 'vditorContentTheme') {
            events.push(`-${(e.getAttribute('href') || '').split('/').pop()}`)
          }
        }
      }
      // Observe the Document node itself: at init-script time documentElement may not
      // be parsed yet (observing it would throw and silently disable the recorder).
    }).observe(document, { childList: true, subtree: true })
  })
  await page.addInitScript((init) => {
    ;(window as any).acquireVsCodeApi = () => ({
      postMessage: (m: any) => {
        if (m && m.command === 'ready') window.postMessage(init, '*')
      },
      getState: () => undefined,
      setState: () => {},
    })
  }, STALE_INIT)
  await page.goto('/prerender.html', { waitUntil: 'domcontentloaded' })
  // live editor mounted (overlay swapped out) + after()'s theme application done
  await page.waitForFunction(
    () =>
      !document.getElementById('vmarkd-prerender') &&
      !!document.querySelector('#app .vditor-ir pre.vditor-reset'),
    undefined,
    { timeout: 15_000 },
  )
  await page.waitForTimeout(300)
}

test('a stale saved preview.theme.current cannot touch the content-theme link on open (no flash)', async ({
  page,
}) => {
  await open(page)
  // The initial HTML shipped dark.css; with the mode-authoritative merge the constructor
  // and after() both see 'dark' → the link must never be removed/re-added (each
  // replacement is an async re-fetch = a visible unstyled window). The observer starts
  // before parsing, so the parser inserting the initial link records ONE "+dark.css" —
  // the only event allowed; any "-" entry is a runtime teardown (the flash).
  const events = await page.evaluate(() => (window as any).__ctLinkEvents)
  expect(events).toEqual(['+dark.css'])
  const href = await page.evaluate(() =>
    document.getElementById('vditorContentTheme')?.getAttribute('href'),
  )
  expect(href).toContain('dark.css')
})

test('setContentTheme no-ops on an equal-file href written differently (resolved-URL compare)', async ({
  page,
}) => {
  await open(page)
  // Rewrite the link href to an EQUIVALENT but textually different URL (absolute with
  // origin vs the root-relative cssPath Vditor builds) and mark the node. Pre-patch the
  // raw-string compare saw a difference and replaced the link (async re-fetch → flash);
  // the patched resolved-URL compare must keep the original node.
  const replaced = await page.evaluate(() => {
    const l = document.getElementById('vditorContentTheme') as HTMLLinkElement
    l.setAttribute(
      'href',
      `${location.origin}/vditor/dist/css/content-theme/dark.css`,
    )
    l.setAttribute('data-orig', '1')
    ;(window as any).vditor.setTheme(
      'dark',
      'dark',
      'github-dark',
      '/vditor/dist/css/content-theme',
    )
    const after = document.getElementById(
      'vditorContentTheme',
    ) as HTMLLinkElement
    return !after.hasAttribute('data-orig')
  })
  expect(replaced).toBe(false)
})

test('material-dark: un-highlighted block code already shows the settled colours (no green/tinted panel)', async ({
  page,
}) => {
  // Hold highlight.js so the rendered code stays `code.language-js` (no `.hljs`) — the
  // exact state the prerender overlay and the pre-highlight live window paint. Without
  // the main.css colour rule, material-dark's INLINE-code styling leaked here: green
  // #98c379 text on a --vmarkd-code-bg tinted panel, snapping to atom-one-dark's
  // no-panel look once `.hljs` landed.
  await page.route('**/highlight.js/highlight.min.js**', () => {})
  await open(page)
  // The real material-dark content theme + the markdown-body class, as the webview has it.
  await page.addStyleTag({ url: '/markdown-themes/material-dark.css' })
  await page.evaluate(() => document.body.classList.add('markdown-body'))
  const res = await page.evaluate(() => {
    const code = document.querySelector(
      '#app pre.vditor-ir__preview > code:not(.hljs)',
    ) as HTMLElement
    const reset = document.querySelector('#app pre.vditor-reset') as HTMLElement
    const cs = getComputedStyle(code)
    return {
      cls: code.className,
      bg: cs.backgroundColor,
      color: cs.color,
      prose: getComputedStyle(reset).color,
    }
  })
  expect(res.cls).not.toContain('hljs')
  // Transparent child → the page canvas shows through = atom-one-dark's settled look
  // (its code bg == material's page bg), no inline-code tint panel.
  expect(res.bg).toBe('rgba(0, 0, 0, 0)')
  // Prose colour (#abb2bf), NOT material's inline-code green (#98c379).
  expect(res.color).toBe(res.prose)
  expect(res.color).not.toBe('rgb(152, 195, 121)')
})

test('a GENUINE theme switch still reloads the content-theme stylesheet', async ({
  page,
}) => {
  await open(page)
  // Guard against over-suppression: switching to a genuinely different file must still
  // replace the link (that reload is wanted — it carries the new palette).
  const href = await page.evaluate(() => {
    ;(window as any).vditor.setTheme(
      'classic',
      'light',
      'github',
      '/vditor/dist/css/content-theme',
    )
    return document.getElementById('vditorContentTheme')?.getAttribute('href')
  })
  expect(href).toContain('light.css')
  const events = await page.evaluate(() => (window as any).__ctLinkEvents)
  expect(events).toContain('-dark.css')
  expect(events).toContain('+light.css')
})
