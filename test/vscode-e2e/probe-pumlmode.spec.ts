import { wf } from './webview-helpers'
// THROWAWAY probe (task 384 follow-up, 2026-07-28): can ONE injected `PUML_MODE` line drive every
// vendored library that reads it? `awslib` tests `$PUML_MODE`, `domainstory` tests the bare name —
// blocks 1/2/3 settle whether the `$` prefix is syntax sugar. Block 4 (C4) is the inert control.
// @probe — excluded from the default run; run with `npm --prefix test/vscode-e2e run test:probes`
// (task 449).
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings } from './settings-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'probe-pumlmode.md')
const OUT = path.join(__dirname, '..', '..', 'tmp', 'icons', 'probe-pumlmode')

usePinnedSettings(test, {
  'workbench.colorTheme': 'Default Dark Modern',
  'vmarkd.theme.content': 'github-dark',
})

test('probe: PUML_MODE injection across libs (github-dark) @probe', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(420_000)
  mkdirSync(OUT, { recursive: true })
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  }, [])
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
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await expect
    .poll(
      () => frame.locator('.vditor-ir__preview .language-plantuml svg').count(),
      { timeout: 300_000 },
    )
    .toBeGreaterThanOrEqual(5)
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 8000)))

  const blocks = frame.locator('.vditor-ir__preview .language-plantuml')
  const n = await blocks.count()
  for (let i = 0; i < n; i++) {
    await blocks
      .nth(i)
      .screenshot({ path: path.join(OUT, `block-${i}.png`), scale: 'css' })
  }

  const dump = await frame.locator('body').evaluate(async () => {
    const href = (img: Element) =>
      img.getAttribute('href') ?? img.getAttribute('xlink:href') ?? ''
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: decodes a sprite data URI and builds a colour histogram across pixel/alpha branches; pre-existing (task 469 baseline)
    const histogram = async (uri: string) => {
      if (!uri.startsWith('data:image')) return { error: 'not a data URI' }
      const img = new Image()
      await new Promise((res, rej) => {
        img.onload = res
        img.onerror = rej
        img.src = uri
      })
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const ctx = c.getContext('2d')
      if (!ctx) return { error: 'no 2d context' }
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      let clear = 0
      let partial = 0
      let opaque = 0
      const counts = new Map<string, number>()
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3]
        if (a === 0) clear++
        else if (a < 250) partial++
        else {
          opaque++
          const k = `${d[i]},${d[i + 1]},${d[i + 2]}`
          counts.set(k, (counts.get(k) ?? 0) + 1)
        }
      }
      const lum = (k: string) => {
        const [r, g, b] = k.split(',').map(Number)
        const f = (v: number) => {
          const s = v / 255
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        }
        return +(0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)).toFixed(4)
      }
      const px = c.width * c.height
      return {
        size: `${c.width}x${c.height}`,
        clearPct: +((clear / px) * 100).toFixed(1),
        partialPct: +((partial / px) * 100).toFixed(1),
        opaquePct: +((opaque / px) * 100).toFixed(1),
        topOpaque: Array.from(counts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([k, v]) => ({
            rgb: k,
            pct: +((v / px) * 100).toFixed(1),
            luminance: lum(k),
          })),
      }
    }

    const out: unknown[] = []
    const els = Array.from(
      document.querySelectorAll('.vditor-ir__preview .language-plantuml'),
    )
    for (const b of els) {
      const svg = b.querySelector('svg')
      if (!svg) {
        out.push({ rendered: false, text: b.textContent?.slice(0, 160) })
        continue
      }
      const images = []
      for (const img of Array.from(svg.querySelectorAll('image'))) {
        images.push({
          spriteFilled: img.hasAttribute('data-vmarkd-sprite-filled'),
          parentHasAdapted: !!img.parentElement?.querySelector(
            '[data-vmarkd-adapted]',
          ),
          pixels: await histogram(href(img)),
        })
      }
      out.push({
        rendered: true,
        svgColor: getComputedStyle(svg).color,
        adaptedCount: svg.querySelectorAll('[data-vmarkd-adapted]').length,
        fills: Array.from(
          new Set(
            Array.from(svg.querySelectorAll('[fill]')).map(
              (el) =>
                `${el.tagName}:${el.getAttribute('fill')}${el.hasAttribute('data-vmarkd-adapted') ? '*' : ''}`,
            ),
          ),
        ).slice(0, 25),
        texts: Array.from(svg.querySelectorAll('text'))
          .slice(0, 8)
          .map((t) => `${t.textContent}=${t.getAttribute('fill')}`),
        note: b.querySelector('.vmarkd-diagram-note__msg')?.textContent ?? null,
        images,
      })
    }
    return out
  })
  writeFileSync(path.join(OUT, 'dump.json'), JSON.stringify(dump, null, 2))
  console.log(`probe: ${n} blocks -> ${OUT}`)
})
