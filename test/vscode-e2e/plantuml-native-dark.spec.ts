import { wf } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings } from './settings-helpers'

// Task 384 — on a dark theme we now tell every stdlib diagram which page it draws for
// (`injectPumlMode` writes BOTH `PUML_MODE` and `$PUML_MODE`; they are two different preprocessor
// variables — domainstory reads the bare one, awslib the `$` one). Two of the ten vendored libraries
// act on it and theme themselves; the other eight ignore it and still need our light-page
// compensation. The spec pins BOTH halves, because each one broke the other during development:
//
//  - domainstory: its icon ink is baked into a sprite data URI (`#1f2833` under the library's
//    `PUML_MODE ?= "light"` default), so NO post-pass can repaint it — the mode is the only fix.
//    Measured before: dominant opaque pixel at luminance 0.02 on a page at 0.006, ≈1.3:1.
//  - awslib: it picks a BLACK card with white labels, and `themePumlSvg` used to read that `#000000`
//    as baked ink and lift it to `currentColor` — a near-white card under white text. Hence
//    `usesModeAwareStdlib` gating the whole compensation off for these two.
//  - k8s: reads nothing. It used to come out of `adaptBakedColours` with our surface on its card;
//    with the post-render pass off (task 355 step 5) it keeps its own white one. The row stays as
//    the tripwire for that flag — the mode-aware halves above are independent of it and still hold.
const FIXTURE = path.join(__dirname, 'fixtures', 'plantuml-native-dark.md')

usePinnedSettings(test, {
  'workbench.colorTheme': 'Default Dark Modern',
  'vmarkd.theme.content': 'github-dark',
})

test('mode-aware libs keep their own dark palette; mode-blind libs are left untouched', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(300_000)
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
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 90_000 })
  await expect
    .poll(
      () => frame.locator('.vditor-ir__preview .language-plantuml svg').count(),
      { timeout: 240_000 },
    )
    .toBeGreaterThanOrEqual(3)
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 4000)))

  const out = await frame.locator('body').evaluate(async () => {
    const blocks = Array.from(
      document.querySelectorAll('.vditor-ir__preview .language-plantuml'),
    )
    // Decode a sprite and report the luminance of its dominant OPAQUE colour — the icon's ink.
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: decodes a sprite data URI and scans pixels for the dominant opaque colour's luminance; pre-existing (task 469 baseline)
    const inkLuminance = async (img: Element | null) => {
      const uri =
        img?.getAttribute('href') ?? img?.getAttribute('xlink:href') ?? ''
      if (!uri.startsWith('data:image')) return null
      const el = new Image()
      await new Promise((res, rej) => {
        el.onload = res
        el.onerror = rej
        el.src = uri
      })
      const c = document.createElement('canvas')
      c.width = el.naturalWidth
      c.height = el.naturalHeight
      const ctx = c.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(el, 0, 0)
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      const counts = new Map<string, number>()
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 250) continue
        const k = `${d[i]},${d[i + 1]},${d[i + 2]}`
        counts.set(k, (counts.get(k) ?? 0) + 1)
      }
      const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]
      if (!top) return null
      const [r, g, b] = top[0].split(',').map(Number)
      const f = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return +(0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)).toFixed(4)
    }
    const fillsOf = (i: number) =>
      Array.from(blocks[i]?.querySelectorAll('[fill]') ?? []).map(
        (el) => el.getAttribute('fill') ?? '',
      )
    return {
      domainstoryInk: await inkLuminance(blocks[0]?.querySelector('image')),
      awsFills: fillsOf(1),
      awsTexts: Array.from(blocks[1]?.querySelectorAll('text') ?? []).map((t) =>
        t.getAttribute('fill'),
      ),
      k8sAdapted: blocks[2]?.querySelectorAll('[data-vmarkd-adapted]').length,
      k8sFills: fillsOf(2),
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[native-dark] ${JSON.stringify(out).slice(0, 400)}`)

  // domainstory's icons draw in a LIGHT ink now — the whole point of injecting the mode.
  expect(out.domainstoryInk).not.toBeNull()
  expect(out.domainstoryInk as number).toBeGreaterThan(0.3)

  // awslib keeps its own dark card: the black fill survives instead of being lifted to currentColor
  // (which resolved to the near-white theme foreground), and its labels stay white.
  expect(out.awsFills).toContain('#000000')
  expect(out.awsTexts).toContain('#FFFFFF')

  // k8s reads no mode — and since task 355 step 5 turned `PUML_POST_RENDER_THEMING` off, nothing
  // compensates for that any more: it comes out exactly as the engine drew it, white card included.
  // Asserted rather than dropped, because this is the row that would catch the flag being flipped
  // back on (then it inverts: `k8sAdapted > 0` and no '#FFFFFF' in `k8sFills`).
  expect(out.k8sAdapted).toBe(0)
  expect(out.k8sFills).toContain('#FFFFFF')
})
