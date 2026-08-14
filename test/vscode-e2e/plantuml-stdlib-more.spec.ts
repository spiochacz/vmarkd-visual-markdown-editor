import { wf } from './webview-helpers'
// Offline PlantUML stdlib icon libs (task 354) — real-VS-Code only. Seven MIT/Apache libraries vendored
// from the plantuml-stdlib aggregator (k8s, eip, edgy, DomainStory, cloudogu, cloudinsight, kubernetes).
// Same mechanism as task 136 (lazy-load a per-lib .puml file-map via loadScript, inline the referenced
// files before the TeaVM render) — this proves in REAL VS Code (the resource-URI/CSP pipeline + TeaVM
// lazy-load don't reproduce in the Playwright harness) that each lib renders offline with no Fatal
// parsing error, AND that k8s pulls its transitive <C4/C4> dependency (STDLIB_DEPS) though the source
// never names C4.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'plantuml-stdlib-more.md')

// The two `test.skip()` cases below set `vmarkd.theme.content`; the active test doesn't, so this is
// restore-only (harmless no-op for the active test, cleans up if/when the skipped ones run).
useSettingsRestore(test, ['vmarkd.theme.content'])

test('7 stdlib icon libs render offline (+ k8s pulls its C4 dependency)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(180_000)
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
  // Wait until all seven plantuml blocks have rendered an <svg>, then settle (async TeaVM render).
  await expect
    .poll(
      () => frame.locator('.vditor-ir__preview .language-plantuml svg').count(),
      { timeout: 120_000 },
    )
    .toBeGreaterThanOrEqual(7)
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 5000)))

  const report = await frame.locator('body').evaluate(() => {
    const blocks = Array.from(
      document.querySelectorAll('.vditor-ir__preview .language-plantuml'),
    )
    const perBlock = blocks.map((b) => {
      const svg = b.querySelector('svg')
      if (!svg) return { rendered: false, fatal: false, text: '', w: 0, h: 0 }
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
        // intrinsic size — an EMPTY diagram (macros silently produced nothing) is PlantUML's 10×10 canvas.
        w: Number(svg.getAttribute('width') ?? 0),
        h: Number(svg.getAttribute('height') ?? 0),
      }
    })
    return {
      perBlock,
      // each lib's map is fetched once via loadScript (tagged by id); c4 is loaded as k8s's dependency.
      loaded: {
        k8s: !!document.getElementById('vditorPumlStdlib_k8s'),
        c4: !!document.getElementById('vditorPumlStdlib_c4'),
        eip: !!document.getElementById('vditorPumlStdlib_eip'),
        edgy: !!document.getElementById('vditorPumlStdlib_edgy'),
        domainstory: !!document.getElementById('vditorPumlStdlib_domainstory'),
        cloudogu: !!document.getElementById('vditorPumlStdlib_cloudogu'),
        cloudinsight: !!document.getElementById(
          'vditorPumlStdlib_cloudinsight',
        ),
        kubernetes: !!document.getElementById('vditorPumlStdlib_kubernetes'),
      },
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[puml-stdlib-more] ${JSON.stringify(report)}`)

  // Every one of the seven blocks rendered a real diagram — not the Fatal-parsing-error SVG.
  expect(report.perBlock.length).toBeGreaterThanOrEqual(7)
  for (const b of report.perBlock) {
    expect(b.rendered).toBe(true)
    expect(b.fatal).toBe(false)
    // NOT the empty 10×10 canvas — catches a lib whose macros silently render nothing (the EIP block-comment
    // bug: a dropped `'/` left a /' block open, swallowing the whole diagram → 10×10 blank, non-fatal).
    expect(b.w, `block rendered non-empty (w=${b.w})`).toBeGreaterThan(40)
    expect(b.h, `block rendered non-empty (h=${b.h})`).toBeGreaterThan(40)
  }

  // Diagram-specific labels present (proof the macros actually ran, not just "no error"). PlantUML splits
  // multi-word labels across <text> nodes, so normalise the joiner first.
  const all = report.perBlock.map((b) => b.text).join(' || ')
  const norm = all.replace(/·/g, '').replace(/\s+/g, ' ')
  expect(norm).toMatch(/service/) // k8s KubernetesSvc label
  expect(norm).toMatch(/Order/) // eip Message label
  expect(norm).toMatch(/Brand/) // edgy $brandFacet label
  expect(norm).toMatch(/Alice/) // DomainStory Person
  expect(norm).toMatch(/Jenkins/) // cloudogu DOGU_JENKINS
  expect(norm).toMatch(/webapp/) // cloudinsight sprite label
  expect(norm).toMatch(/control/) // kubernetes sprite label

  // Every referenced lib map was fetched — plus c4 (k8s's transitive dependency, never named in source).
  for (const [lib, was] of Object.entries(report.loaded)) {
    expect(was, `stdlib map loaded: ${lib}`).toBe(true)
  }
})

// Task 383 follow-up — k8s/Common's own #3C7FC0 border read as a bright frame once the card fill
// underneath it was darkened for the theme (identical colour, ~10x the surface's luminance).
// Real-webview-only: needs the actual TeaVM-rendered SVG + the live content-theme adaptation pass,
// neither of which the chromium harness reproduces.
// ⛔ SKIPPED since task 355 step 5: the user turned the whole post-render pass OFF
// (`PUML_POST_RENDER_THEMING = false` in plantuml-render.ts). The card is no longer darkened and the
// sprite is no longer composited, so both assertions below describe behaviour that cannot happen —
// they fail with "no sprite was ever composited" rather than catching anything. Un-skip together with
// that flag; nothing else about them needs to change.
test.skip('k8s/Common’s identity-blue border is muted, not raw, on a dark content theme', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(180_000)
  await evaluateInVSCode(async (vscode) => {
    await vscode.workspace
      .getConfiguration('vmarkd')
      .update('theme.content', 'github-dark', vscode.ConfigurationTarget.Global)
  })
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
  await expect
    .poll(
      () => frame.locator('.vditor-ir__preview .language-plantuml svg').count(),
      { timeout: 120_000 },
    )
    .toBeGreaterThanOrEqual(7)
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 5000)))

  const strokes = await frame.locator('body').evaluate(() => {
    // k8s/Common's Namespace_Boundary/KubernetesSvc/KubernetesPod draw component-style rects — the
    // first `.language-plantuml` block in the fixture is the k8s one.
    const svg = document.querySelector(
      '.vditor-ir__preview .language-plantuml svg',
    )
    return Array.from(svg?.querySelectorAll('rect[data-vmarkd-adapted]') ?? [])
      .map((r) => r.getAttribute('stroke'))
      .filter((s): s is string => !!s && /^#[0-9a-f]{6}$/i.test(s))
  })
  expect(
    strokes.length,
    'at least one adapted card carries a stroke',
  ).toBeGreaterThan(0)
  for (const s of strokes) {
    expect(
      s.toLowerCase(),
      'no adapted card kept the raw identity blue',
    ).not.toBe('#3c7fc0')
  }
})

// Task 383 follow-up #2 — the white rim ON the icons themselves ("na brzegach ikon wystaje").
// The stdlib sprites are anti-aliased against a WHITE page, so their semi-transparent edge pixels
// carry white-contaminated RGB that halos on a dark one; `bleedOuterFringe` recolours that fringe
// from the nearest opaque pixel, and (follow-up #3) `erodeInkClearOfFringe` keeps our own ink from
// being painted under that fringe at all. Asserted on the PAINTED result — the composited sprite is decoded
// back into a canvas and its outer fringe measured — because the whole defect lives in pixels the
// DOM cannot describe. Real-webview-only: the sprite only gets composited at all where the render
// pass darkened the card underneath it.
// ⛔ SKIPPED since task 355 step 5: the user turned the whole post-render pass OFF
// (`PUML_POST_RENDER_THEMING = false` in plantuml-render.ts). The card is no longer darkened and the
// sprite is no longer composited, so both assertions below describe behaviour that cannot happen —
// they fail with "no sprite was ever composited" rather than catching anything. Un-skip together with
// that flag; nothing else about them needs to change.
test.skip('k8s icons carry no white halo on their outer edge after compositing', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(180_000)
  await evaluateInVSCode(async (vscode) => {
    await vscode.workspace
      .getConfiguration('vmarkd')
      .update('theme.content', 'github-dark', vscode.ConfigurationTarget.Global)
  })
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
  await expect
    .poll(
      () =>
        frame
          .locator(
            '.vditor-ir__preview .language-plantuml image[data-vmarkd-sprite-filled]',
          )
          .count(),
      { timeout: 120_000, message: 'no sprite was ever composited' },
    )
    .toBeGreaterThan(0)
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 4000)))

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: decodes a sprite data URI and scans the halo pixel ring across the fringe-detection branches; pre-existing (task 469 baseline)
  const halo = await frame.locator('body').evaluate(async () => {
    const img = document.querySelector(
      '.vditor-ir__preview .language-plantuml image[data-vmarkd-sprite-filled]',
    )
    const href = img?.getAttribute('href')
    if (!href?.startsWith('data:image/png;base64,')) return { error: 'no href' }
    const bitmap = new Image()
    bitmap.src = href
    await bitmap.decode()
    const w = bitmap.naturalWidth
    const h = bitmap.naturalHeight
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    if (!ctx) return { error: 'no canvas' }
    ctx.drawImage(bitmap, 0, 0)
    const d = ctx.getImageData(0, 0, w, h).data

    // Walk in from the border through everything that is not fully opaque — the same rule
    // bleedOuterFringe uses, so this measures exactly the region it claims to have repaired.
    const seen = new Uint8Array(w * h)
    const stack: number[] = []
    const push = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return
      const p = y * w + x
      if (seen[p] || d[p * 4 + 3] === 255) return
      seen[p] = 1
      stack.push(p)
    }
    for (let x = 0; x < w; x++) {
      push(x, 0)
      push(x, h - 1)
    }
    for (let y = 0; y < h; y++) {
      push(0, y)
      push(w - 1, y)
    }
    while (stack.length) {
      const p = stack.pop() as number
      push((p % w) + 1, (p / w) | 0)
      push((p % w) - 1, (p / w) | 0)
      push(p % w, ((p / w) | 0) + 1)
      push(p % w, ((p / w) | 0) - 1)
    }
    let bright = 0
    let visible = 0
    for (let p = 0; p < w * h; p++) {
      if (!seen[p]) continue
      const a = d[p * 4 + 3]
      if (a === 0) continue // invisible, cannot halo
      visible++
      if (d[p * 4] > 200 && d[p * 4 + 1] > 200 && d[p * 4 + 2] > 200) bright++
    }
    return { bright, visible, size: `${w}x${h}` }
  })
  // eslint-disable-next-line no-console
  console.log(`[k8s-halo] ${JSON.stringify(halo)}`)

  expect(
    halo.error,
    'could not read the composited sprite back',
  ).toBeUndefined()
  // `visible` is not just a vacuity guard — it is the assertion for follow-up #3. A fringe pixel
  // with our opaque near-white ink under it ends at alpha 255, so this walk STOPS before it and the
  // `bright` count below structurally cannot see it: that is how a pale line survived a green run.
  // The count is therefore the test. The sprite's own fringe is 328 px; with one erosion ring the
  // ink swallowed 80 of them and this read 248, and `erodeInkClearOfFringe` gets all 328 back.
  expect(
    halo.visible,
    'ink is still painted under part of the anti-aliased fringe',
  ).toBeGreaterThan(300)
  expect(halo.bright, 'the outer fringe still holds white-matted pixels').toBe(
    0,
  )
})
