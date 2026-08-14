// NET (task 381) — the d2 sql_table / class CHROME in the REAL webview, on a dark theme.
//
// The bug: border, header band and row dividers were all painted with d2's N1 token. On d2's own
// themes N1 is dark ink on white N7 paper; an editor-paired palette maps N1 to the FOREGROUND, so on
// a dark theme every table turned into a near-white slab. Measured in this very editor before the
// fix: fill "#FAFAFA" under the default `theme.content: auto`, "#bbbebf" under vscode-dark-2026 —
// against a "#18181B" body. The unit tests pin the token wiring; this pins the fact that the wiring
// survives the whole custom-editor / render-cache pipeline into the pixels the user looks at.
//
// No golden here on purpose: this is a COLOUR contract, and colour is exactly what a geometry
// assertion can state without depending on the machine's fonts. The pixel suite (task 375) captures
// the FIRST d2 block, which has no sql_table — so it would have stayed green through this whole bug.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings, useSettingsRestore } from './settings-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
const wf = (w: any) =>
  w.frameLocator('iframe.webview').frameLocator('#active-frame')

// colorTheme is the same value in both loop iterations below → pinned. theme.content differs per
// iteration (that's the whole point of the loop) → restore-only, kept inline.
usePinnedSettings(test, { 'workbench.colorTheme': 'Default Dark Modern' })
useSettingsRestore(test, ['vmarkd.theme.content'])

// Both the default (`auto` → the zinc fallback) and a pinned content theme: they resolve through
// different palette paths and BOTH were broken.
for (const content of ['auto', 'vscode-dark-2026'] as const) {
  test(`d2 tables keep the chrome muted on a dark theme — content=${content}`, async ({
    workbox,
    evaluateInVSCode,
  }) => {
    test.setTimeout(300_000)
    await evaluateInVSCode(
      async (vscode: typeof import('vscode'), args: string[]) => {
        await vscode.workspace
          .getConfiguration('vmarkd')
          .update('theme.content', args[0], vscode.ConfigurationTarget.Global)
      },
      [content] as [string],
    )
    await evaluateInVSCode(
      async (vscode: typeof import('vscode'), args: string[]) => {
        await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(args[0]),
          'vmarkd.editor',
        )
      },
      [FIXTURE] as [string],
    )
    const frame = wf(workbox)
    await frame.locator('.vditor-ir').first().waitFor({ timeout: 90_000 })
    // d2 compiles through WASM + a layout pass; it is one of the two slowest engines on the page —
    // task 451: was a blind 25s sleep. d2 emits its SVG as ONE atomic write (compile+layout finish
    // server-side before any DOM insertion — unlike echarts/mermaid there is no progressive resize
    // pass after paint, precedent: d2-theme.spec.ts:63's `.language-d2 svg` waitFor), so once the
    // svg with the sql_table's header band exists its fill/stroke attributes are already final —
    // poll for the SAME shape-probe the assertions below read, so "settled" means "found the exact
    // block under test", not just "some d2 svg landed" (the fixture has other d2 blocks too).
    await expect
      .poll(
        () =>
          frame.locator('body').evaluate(() => {
            const HEADER_H = 32
            for (const block of Array.from(
              document.querySelectorAll(
                '.vditor-ir .vditor-ir__preview .language-d2',
              ),
            )) {
              const svg = block.querySelector('svg')
              if (!svg) continue
              const band = Array.from(svg.querySelectorAll('rect')).find(
                (r) =>
                  Math.round((r as SVGGraphicsElement).getBBox().height) ===
                  HEADER_H,
              )
              if (band) return true
            }
            return false
          }),
        { message: 'the sql_table/class d2 block rendered its header band' },
      )
      .toBe(true)

    const probe = await frame.locator('body').evaluate(() => {
      const HEADER_H = 32 // the header band is the only rect drawn at exactly this height
      for (const block of Array.from(
        document.querySelectorAll(
          '.vditor-ir .vditor-ir__preview .language-d2',
        ),
      )) {
        const svg = block.querySelector('svg')
        if (!svg) continue
        const band = Array.from(svg.querySelectorAll('rect')).find(
          (r) =>
            Math.round((r as SVGGraphicsElement).getBBox().height) === HEADER_H,
        )
        if (!band) continue // not the block with the sql_table / class
        const bandBox = (band as SVGGraphicsElement).getBBox()
        const body = Array.from(svg.querySelectorAll('rect')).find((r) => {
          const b = (r as SVGGraphicsElement).getBBox()
          return (
            Math.abs(b.x - bandBox.x) < 2 &&
            Math.abs(b.y - bandBox.y) < 2 &&
            b.height > HEADER_H
          )
        })
        const title = Array.from(svg.querySelectorAll('text')).find((t) => {
          const b = (t as SVGGraphicsElement).getBBox()
          return (
            b.y >= bandBox.y - 4 && b.y + b.height <= bandBox.y + HEADER_H + 4
          )
        })
        return {
          band: band.getAttribute('fill'),
          bodyFill: body?.getAttribute('fill') ?? null,
          border: body?.getAttribute('stroke') ?? null,
          titleFill: title?.getAttribute('fill') ?? null,
          // Connections use the LINE token. The table border must be the same colour: the whole point
          // is that a table carries the same visual weight as the rest of its own diagram.
          edgeStroke:
            svg.querySelector('path[fill="none"]')?.getAttribute('stroke') ??
            null,
          pageBg: getComputedStyle(document.body).backgroundColor,
        }
      }
      return null
    })

    // A fixture that stopped containing a table would make every assertion below vacuous.
    expect(probe, 'a rendered d2 block with a sql_table / class').not.toBeNull()
    const p = probe!

    const lum = (c: string) => {
      const m = c.startsWith('#')
        ? [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16))
        : (c.match(/\d+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number)
      return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255
    }

    // The page really is dark — otherwise "too bright" would not be the right test at all.
    expect(lum(p.pageBg)).toBeLessThan(0.3)
    // THE REGRESSION: the band is a raised SURFACE, so it sits near the body it belongs to, not near
    // the title ink drawn on top of it. Before the fix this was inverted (band #FAFAFA vs body
    // #18181B: 0.98 vs 0.09).
    expect(Math.abs(lum(p.band!) - lum(p.bodyFill!))).toBeLessThan(
      Math.abs(lum(p.band!) - lum(p.titleFill!)),
    )
    expect(lum(p.band!)).toBeLessThan(0.4) // never a light slab on a dark page
    // Same weight as the diagram around it: table border == connection stroke.
    expect(p.border).toBe(p.edgeStroke)
  })
}
