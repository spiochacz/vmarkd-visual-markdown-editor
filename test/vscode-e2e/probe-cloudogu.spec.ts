import { wf } from './webview-helpers'
// THROWAWAY probe (not a regression test): dumps the sprite bytes the editor ACTUALLY paints, on a
// dark AND a light theme, so the two can be compared byte-for-byte. The light run is the control the
// first probe was missing — `fillSpriteShape` (erodeInward + bleedOuterFringe) REWRITES the artwork's
// own pixels on the dark path, so a dark-processed sprite placed on white is not the light render.
// @probe — excluded from the default run; run with `npm --prefix test/vscode-e2e run test:probes`
// (task 449).
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'probe-cloudogu.md')
const OUT = path.join(__dirname, '..', '..', 'tmp', 'icons', 'probe-cloudogu')

// Each looped test() below sets a DIFFERENT colorTheme/theme.content pair, so this can't be
// pinned to one shared value — just declare the keys for cleanup.
useSettingsRestore(test, ['workbench.colorTheme', 'vmarkd.theme.content'])

for (const theme of [
  { content: 'github-dark', vscode: 'Default Dark Modern' },
  { content: 'github-light', vscode: 'Default Light Modern' },
] as const)
  test(`probe: cloudogu on ${theme.content} @probe`, async ({
    workbox,
    evaluateInVSCode,
  }) => {
    test.setTimeout(240_000)
    mkdirSync(OUT, { recursive: true })
    await evaluateInVSCode(
      async (vscode, args) => {
        const [content, colorTheme] = args as [string, string]
        await vscode.commands.executeCommand('workbench.action.closeAllEditors')
        await vscode.workspace
          .getConfiguration('workbench')
          .update('colorTheme', colorTheme, vscode.ConfigurationTarget.Global)
        await vscode.workspace
          .getConfiguration('vmarkd')
          .update('theme.content', content, vscode.ConfigurationTarget.Global)
      },
      [theme.content, theme.vscode] as [string, string],
    )
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
        () =>
          frame.locator('.vditor-ir__preview .language-plantuml svg').count(),
        { timeout: 150_000 },
      )
      .toBeGreaterThanOrEqual(2)
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 6000)))

    const blocks = frame.locator('.vditor-ir__preview .language-plantuml')
    const n = await blocks.count()
    for (let i = 0; i < n; i++) {
      await blocks.nth(i).screenshot({
        path: path.join(OUT, `${theme.content}-block-${i}.png`),
        scale: 'css',
      })
    }

    const dump = await frame.locator('body').evaluate(() => {
      const out: unknown[] = []
      for (const b of Array.from(
        document.querySelectorAll('.vditor-ir__preview .language-plantuml'),
      )) {
        const svg = b.querySelector('svg')
        if (!svg) {
          out.push({ rendered: false })
          continue
        }
        out.push({
          rendered: true,
          color: getComputedStyle(svg).color,
          rects: Array.from(svg.querySelectorAll('rect, polygon'))
            .slice(0, 10)
            .map((r) => ({
              fill: r.getAttribute('fill'),
              adapted: r.hasAttribute('data-vmarkd-adapted'),
            })),
          images: Array.from(svg.querySelectorAll('image')).map((img) => ({
            filled: img.hasAttribute('data-vmarkd-sprite-filled'),
            hrefLen: (
              img.getAttribute('href') ??
              img.getAttribute('xlink:href') ??
              ''
            ).length,
          })),
        })
      }
      return out
    })
    writeFileSync(
      path.join(OUT, `${theme.content}-dump.json`),
      JSON.stringify(dump, null, 2),
    )

    const hrefs = await frame
      .locator('body')
      .evaluate(() =>
        Array.from(
          document.querySelectorAll(
            '.vditor-ir__preview .language-plantuml svg image',
          ),
        ).map(
          (img) =>
            img.getAttribute('href') ?? img.getAttribute('xlink:href') ?? '',
        ),
      )
    hrefs.forEach((h, i) => {
      writeFileSync(path.join(OUT, `${theme.content}-sprite-${i}.txt`), h)
    })
    console.log(`probe ${theme.content}: ${n} blocks, ${hrefs.length} sprites`)
  })
