import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'

// Task 86 — a named mermaid palette (or a content-theme pairing) is injected as mermaid's
// `base` theme + themeVariables, so the diagram renders in that palette. We assert the SVG's
// embedded theme CSS carries the palette's colours (ids stripped — they're per-render random).

function strip(s: string): string {
  return s.replace(/mermaid[A-Za-z0-9_-]+/g, 'ID')
}

async function themeStyle(page: Page): Promise<string> {
  return page.evaluate(() => {
    const svg = (window as any)
      .__el()
      .querySelector(
        '.vditor-ir__preview .language-mermaid svg',
      ) as SVGElement | null
    return svg?.querySelector('style')?.textContent || ''
  })
}

async function waitProcessed(page: Page) {
  await page.waitForFunction(
    () =>
      !!(window as any)
        .__el()
        .querySelector(
          '.vditor-ir__preview .language-mermaid[data-processed="true"] svg',
        ),
    undefined,
    { timeout: 8000 },
  )
}

// Re-render via __applyTheme and wait until the embedded style differs from `prev`.
async function applyAndWait(
  page: Page,
  setting: string | undefined,
  contentTheme: string | undefined,
  mode: 'dark' | 'light',
  prev: string,
): Promise<string> {
  await page.evaluate(([s, c, m]) => (window as any).__applyTheme(s, c, m), [
    setting,
    contentTheme,
    mode,
  ] as const)
  await page.waitForFunction(
    (p) => {
      const svg = (window as any)
        .__el()
        .querySelector(
          '.vditor-ir__preview .language-mermaid svg',
        ) as SVGElement | null
      const s = (svg?.querySelector('style')?.textContent || '').replace(
        /mermaid[A-Za-z0-9_-]+/g,
        'ID',
      )
      return s.length > 0 && s !== p
    },
    strip(prev),
    { timeout: 8000 },
  )
  return themeStyle(page)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/mermaid.html')
  await page.waitForFunction(() => (window as any).__ready === true)
  await waitProcessed(page)
})

test('explicit palette renders the diagram in that palette (task 86)', async ({
  page,
}) => {
  const base = await themeStyle(page)
  expect(base.length).toBeGreaterThan(0)

  // Dracula — its line colour #6272a4 must appear in the rendered theme CSS.
  const dracula = await applyAndWait(page, 'dracula', undefined, 'dark', base)
  expect(strip(dracula)).not.toBe(strip(base))
  expect(dracula.toLowerCase()).toContain('#6272a4')

  // A different palette (nord) yields a different style + carries nord's line #4c566a.
  const nord = await applyAndWait(page, 'nord', undefined, 'dark', dracula)
  expect(strip(nord)).not.toBe(strip(dracula))
  expect(nord.toLowerCase()).toContain('#4c566a')
})

test('content-theme pairing: auto + github-dark injects the github-dark palette', async ({
  page,
}) => {
  const base = await themeStyle(page)
  const paired = await applyAndWait(page, 'auto', 'github-dark', 'dark', base)
  expect(paired.toLowerCase()).toContain('#3d444d') // github-dark line colour
})

test('explicit setting wins over the content-theme pairing', async ({
  page,
}) => {
  const base = await themeStyle(page)
  // content theme pairs github-light, but an explicit nord must win.
  const nord = await applyAndWait(page, 'nord', 'github-light', 'light', base)
  expect(nord.toLowerCase()).toContain('#4c566a') // nord line, not github
  expect(nord.toLowerCase()).not.toContain('#d1d9e0') // github-light line absent
})

// The webview must actually load the Mermaid version we vendor over Vditor's bundled
// copy (build.mjs syncMermaid + the esbuild ?v= bump) — not Vditor's pinned 11.6.0.
// Guards that the version bump reaches the running webview, not just the vendored file.
test("loads a bumped Mermaid build (not Vditor's pinned 11.6.0)", async ({
  page,
}) => {
  const src = await page.evaluate(
    () =>
      (
        document.getElementById(
          'vditorMermaidScript',
        ) as HTMLScriptElement | null
      )?.src ?? '',
  )
  expect(src).toMatch(/mermaid\.min\.js\?v=\d+\.\d+\.\d+/) // cache-buster present
  expect(src).not.toContain('v=11.6.0') // the esbuild ?v= bump applied
})

// Each content theme's `auto` pairing resolves to the same palette as picking that
// palette explicitly — proves the registry rows (incl. the user's vscode/material
// picks) are wired end-to-end through the bundled resolver, not just in unit tests.
const PAIRINGS: Array<[string, string, 'dark' | 'light']> = [
  ['github-dark', 'github-dark', 'dark'],
  ['material-dark', 'one-dark', 'dark'],
  ['vscode-dark-modern', 'zinc-dark', 'dark'],
  ['vscode-light-modern', 'zinc-light', 'light'],
  ['github-light', 'github-light', 'light'],
]
for (const [content, palette, mode] of PAIRINGS) {
  test(`auto pairs ${content} → ${palette}`, async ({ page }) => {
    // __applyTheme stores the resolved themeVariables on window before re-rendering;
    // read them for auto+content vs the explicit palette and assert they match.
    const vars = (setting: string, ct?: string) =>
      page.evaluate(
        ([s, c, m]) => {
          ;(window as any).__applyTheme(s, c, m)
          return (window as any).__vmarkdMermaidVars
        },
        [setting, ct, mode] as const,
      )
    const auto = await vars('auto', content)
    const explicit = await vars(palette, undefined)
    expect(auto).not.toBeNull()
    expect(auto).toEqual(explicit)
  })
}
