import { wf } from './webview-helpers'
// Offline PlantUML stdlib includes (task 136) — real-VS-Code only. Our vendored TeaVM engine ships no
// stdlib and exposes no include hook, so `!include <C4/…>` / `<awslib/…>` / `<azure/…>` produce a
// "Fatal parsing error" SVG. We fix it by lazy-loading a per-lib .puml file-map (window global via
// loadScript — CSP allows script-src, not fetch) and INLINING the referenced files into the source
// before render() (plantuml-stdlib.ts, wired in plantuml-render.ts). This proves in REAL VS Code (the
// resource-URI/CSP pipeline + the TeaVM lazy-load don't reproduce in the Playwright harness) that all
// three libraries render a real diagram offline — no Fatal parsing error, the expected labels present,
// and only the referenced lib maps are fetched.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'plantuml-stdlib.md')
const FIXTURE_ALL = path.join(__dirname, 'fixtures', 'plantuml-stdlib-all.md')

// The second test below cycles `workbench.colorTheme` and `vmarkd.theme.content` through 3 different
// values across its loop to observe theming per-theme, so it can't be pinned.
useSettingsRestore(test, ['workbench.colorTheme', 'vmarkd.theme.content'])

test('stdlib includes and synthesized aggregators render offline', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(300_000)
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
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
  // Wait until all three plantuml blocks have rendered an <svg>, then settle (async TeaVM render).
  await expect
    .poll(
      () => frame.locator('.vditor-ir__preview .language-plantuml svg').count(),
      { timeout: 90_000 },
    )
    .toBeGreaterThanOrEqual(3)
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 4000)))

  const report = await frame.locator('body').evaluate(() => {
    const blocks = Array.from(
      document.querySelectorAll('.vditor-ir__preview .language-plantuml'),
    )
    const perBlock = blocks.map((b) => {
      const svg = b.querySelector('svg')
      if (!svg) return { rendered: false }
      const text = Array.from(svg.querySelectorAll('text'))
        .map((t) => t.textContent ?? '')
        .join(' · ')
      return {
        rendered: true,
        // Any PlantUML error render: a failed include → "Fatal parsing error"; a wrong macro call →
        // "Syntax Error? (Assumed diagram type: …)". Catch both so a broken block can't pass by echoing
        // its own source text into the error SVG.
        fatal: /Fatal parsing error|Syntax Error|Assumed diagram type/i.test(
          text,
        ),
        text,
      }
    })
    return {
      perBlock,
      // only the referenced libs were fetched (all three here); the loader tags each script by id
      loaded: {
        c4: !!document.getElementById('vditorPumlStdlib_c4'),
        awslib: !!document.getElementById('vditorPumlStdlib_awslib'),
        azure: !!document.getElementById('vditorPumlStdlib_azure'),
      },
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[puml-stdlib] ${JSON.stringify(report)}`)

  const [c4, aws, azure] = report.perBlock
  // Every block rendered a real diagram — not the Fatal-parsing-error SVG.
  for (const b of report.perBlock) {
    expect(b.rendered).toBe(true)
    expect(b.fatal).toBe(false)
  }
  // …and the diagram-specific labels are present (proof the macros actually ran, not just "no error").
  // PlantUML splits multi-word labels across separate <text> nodes, so normalise the joiner first.
  const norm = (s: string | undefined) =>
    (s ?? '').replace(/·/g, '').replace(/\s+/g, ' ').trim()
  expect(norm(c4.text)).toMatch(/Web App/) // C4 Container label
  expect(norm(c4.text)).toMatch(/Uses \[HTTPS\]/) // C4 Rel
  expect(norm(aws.text)).toMatch(/Web Server/) // awslib EC2 sprite label
  expect(norm(azure.text)).toMatch(/My VM/) // azure AzureVirtualMachine label
  // The lazy-load fetched each referenced lib map.
  expect(report.loaded.c4).toBe(true)
  expect(report.loaded.awslib).toBe(true)
  expect(report.loaded.azure).toBe(true)
  // A per-category `<awslib/Compute/all>` aggregator is NOT vendored — the expander SYNTHESIZES it by
  // concatenating the ~38 individual `<awslib/Compute/*>` icons we do ship (option C: no redundant 3.4 MB
  // of aggregators). Its own single-block fixture keeps this isolated from the multi-diagram engine
  // type-stickiness flakiness. If EC2 + Lambda (icons from the synthesized aggregator) render, synthesis
  // pulled the whole category correctly.
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [FIXTURE_ALL] as [string],
  )
  const allFrame = wf(workbox)
  await allFrame
    .locator('.vditor-ir__preview .language-plantuml svg')
    .first()
    .waitFor({ timeout: 60_000 })
  await allFrame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 4000)))

  const info = await allFrame.locator('body').evaluate(() => {
    const svg = document.querySelector(
      '.vditor-ir__preview .language-plantuml svg',
    )
    const text = svg
      ? Array.from(svg.querySelectorAll('text'))
          .map((t) => t.textContent ?? '')
          .join(' · ')
      : ''
    return {
      rendered: !!svg,
      fatal: /Fatal parsing error|Syntax Error|Assumed diagram type/i.test(
        text,
      ),
      text,
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[puml-stdlib-all] ${JSON.stringify(info)}`)
  const allNorm = (s: string) => s.replace(/·/g, '').replace(/\s+/g, ' ').trim()
  expect(info.rendered).toBe(true)
  expect(info.fatal).toBe(false) // synthesized Compute/all defined every icon → EC2/Lambda parse
  expect(allNorm(info.text)).toMatch(/Web Server/) // EC2, from the synthesized aggregator
  expect(allNorm(info.text)).toMatch(/Worker/) // Lambda, from the synthesized aggregator
})

// Task 382/355 — these stdlib diagrams carry their own skinparam (our inlined libraries emit hundreds
// of them), so the palette `<style>` is deliberately NOT injected and the library's LIGHT-PAGE palette
// survives into the SVG. Task 382 used to compensate for that on a dark theme; task 355 step 5 turned
// the whole post-render pass OFF at the user's request, so the library palette now stands on every
// theme. This pins what we do (and no longer do) to the real stdlib expansion + the real TeaVM render
// + the real custom-editor pipeline — none of which the unit tests exercise.
//
// Colour assertions, not pixels: the pixel suite (task 375) captures the FIRST plantuml block of ITS
// fixture, a plain sequence diagram that takes the palette-injection path, so it never sees any of
// this and would have stayed green through the whole bug.
test('stdlib diagrams keep the library palette across content themes', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(540_000)
  for (const theme of [
    { content: 'vscode-dark-2026', vscode: 'Default Dark Modern', dark: true },
    { content: 'github-dark', vscode: 'Default Dark Modern', dark: true },
    {
      content: 'vscode-light-2026',
      vscode: 'Default Light Modern',
      dark: false,
    },
  ] as const) {
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
        { timeout: 90_000 },
      )
      .toBeGreaterThanOrEqual(3)
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 6000)))

    const probe = await frame.locator('body').evaluate(() => {
      const blocks = Array.from(
        document.querySelectorAll('.vditor-ir__preview .language-plantuml'),
      )
      const fills = (b: Element, sel: string, attr: string) =>
        Array.from(b.querySelectorAll(sel))
          .map((e) => (e.getAttribute(attr) ?? '').toUpperCase())
          .filter(Boolean)
      return {
        fg: getComputedStyle(document.body).color,
        // Block order follows the fixture: C4, AWS, Azure. Azure is the COMPENSATED one — AWS moved
        // to the library-native dark palette in task 384 (it reads `$PUML_MODE`), so it is asserted
        // separately below and excluded from the compensation expectations here. The sprite TILE is
        // excluded — it is deliberately white (it is the backing an icon's knocked-out highlights are
        // drawn against), so counting it here would fail the "no white cards left" check on the fix.
        cardFills: blocks
          .slice(2)
          .flatMap((b) =>
            fills(b, 'rect:not([data-vmarkd-sprite-tile])', 'fill'),
          ),
        // AWS on a dark theme now carries its OWN palette: a black card with white labels, which our
        // passes must NOT touch (lifting that black to currentColor produced a near-white card under
        // white text — task 384).
        awsRectFills: fills(blocks[1], 'rect', 'fill'),
        awsTextFills: fills(blocks[1], 'text', 'fill'),
        // A sprite is backed either by having its own outline composited into it (the real path,
        // needs a canvas) or, failing that, by the fallback rectangle. Count both: the contract is
        // that no sprite is left unbacked, not which of the two did it.
        spritesBacked: blocks
          .slice(2)
          .reduce(
            (n, b) =>
              n +
              b.querySelectorAll(
                '[data-vmarkd-sprite-filled], [data-vmarkd-sprite-tile]',
              ).length,
            0,
          ),
        c4RectFills: fills(blocks[0], 'rect', 'fill'),
        c4Strokes: fills(blocks[0], 'rect', 'stroke'),
        c4TextFills: fills(blocks[0], 'text', 'fill'),
        spriteCount: blocks
          .slice(2)
          .reduce((n, b) => n + b.querySelectorAll('image').length, 0),
        awsSpriteCount: blocks[1]?.querySelectorAll('image').length ?? 0,
      }
    })

    // The sprites are the whole point of these libraries — a theming pass that dropped them would
    // otherwise pass every colour assertion below.
    expect
      .soft(probe.spriteCount, `${theme.content}: Azure sprites`)
      .toBeGreaterThan(0)
    expect
      .soft(probe.awsSpriteCount, `${theme.content}: AWS sprites`)
      .toBeGreaterThan(0)
    // C4's IDENTITY colours are never touched: the saturated container blue survives on every theme.
    expect
      .soft(probe.c4RectFills, `${theme.content}: C4 fill`)
      .toContain('#438DD5')
    expect
      .soft(probe.c4Strokes, `${theme.content}: C4 stroke`)
      .toContain('#3C7FC0')
    // …and so do its white labels — only light FILLS become the surface, never text.
    expect
      .soft(probe.c4TextFills, `${theme.content}: C4 text`)
      .toContain('#FFFFFF')
    // A transparent shape is not ink. C4's boundary rect is `#00000000`; painting it (the bug this
    // guards) filled it solid and swallowed the diagram.
    expect
      .soft(probe.c4RectFills, `${theme.content}: transparent boundary`)
      .toContain('#00000000')

    // Task 355 step 5 — `PUML_POST_RENDER_THEMING` is OFF by the user's call, so EVERY theme now gets
    // the library's own palette verbatim: no dark adaptation of the white card, and no sprite backing
    // tile. That is a deliberate trade — the dark-page contrast this test used to enforce (card
    // repainted to the surface, >=4.5:1 against the foreground) is knowingly given up in exchange for
    // the libraries rendering exactly as they were drawn. What is still pinned is that we do not
    // TOUCH them, on any theme.
    //
    // To restore the old contract: flip the flag in plantuml-render.ts and re-add the dark branch —
    // sprites all backed, `cardFills` free of '#FFFFFF', every opaque card fill >=4.5:1 vs `probe.fg`
    // (which needs a relative-luminance contrast helper back — this spec still carried one AT
    // 88aec4f, where it was left behind unused; recover it from there rather than rewriting it).
    expect
      .soft(probe.cardFills, `${theme.content}: untouched white cards`)
      .toContain('#FFFFFF')
    expect
      .soft(probe.spritesBacked, `${theme.content}: no sprite backing`)
      .toBe(0)
    // AWS themes ITSELF from the injected mode (task 384) — the one dark mechanism that is NOT part
    // of the post-render pass, so it still applies: a black card with white labels on a dark theme,
    // its own white card on a light one.
    expect
      .soft(probe.awsRectFills, `${theme.content}: AWS card`)
      .toContain(theme.dark ? '#000000' : '#FFFFFF')
    if (theme.dark) {
      expect
        .soft(probe.awsTextFills, `${theme.content}: AWS text`)
        .toContain('#FFFFFF')
    }
  }
})
