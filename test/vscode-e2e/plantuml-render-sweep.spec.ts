import { type EvaluateInVSCode, wf } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Task 511 — cross-file shared-boot merge of the PlantUML "render a fixture, assert on it" group.
//
// Donor files (each paid its OWN ~8-13s VS Code boot, task 448 — merged here into one):
//   - plantuml-domainstory.spec.ts     (1 test)
//   - plantuml-missing-include.spec.ts (1 test)
//   - plantuml-multidiagram.spec.ts    (2 tests)
//   - plantuml-sprite-size.spec.ts     (1 test)
// All 4 were independently audited (tasks/511-e2e-cross-file-shared-boot.md) as: no document
// mutation, no persistent/global settings mutation, and no cache/engine-instance-count assertion.
// Their fixtures are 4 distinct .md files with distinct diagram source, so the DiagramCache
// (which wipes ONCE per VS Code boot under VMARKD_E2E=1, not per document open) cannot alias
// between cases.
//
// This is NOT a merge of the whole plantuml-* family. The same audit found most of it
// state-coupled BY DESIGN, not by oversight: PlantUML's sticky/shared-engine-instance history
// (tasks 178/347/350) makes "how many times did the engine load in this webview session"
// load-bearing for `plantuml-family-matrix`/`plantuml-typeswitch`/`plantuml-multiblock`; its lazy
// stdlib loading (task 136) makes "is this the first fetch" load-bearing for
// `plantuml-cache`/`plantuml-loading`/`plantuml-stdlib`/`plantuml-stdlib-more`; several others
// mutate global settings (`plantuml.spec.ts`, `plantuml-native-dark`, `plantuml-theme-flip`) or are
// timing instruments meant to run standalone (`plantuml-rapid-edit`, `plantuml-phase-timing`).
// Merging any of those into a shared boot would change exactly the thing under test — so they stay
// as their own files. See the task file for the full per-file audit table.
//
// The local boot() below is the same close-all + reopen pattern as
// clipboard-elements.spec.ts's boot() (:35) — a fresh panel inside the same test(), not a new VS
// Code launch. expect.soft() throughout so a failure in one case doesn't abort the test and drop
// the report for every case after it (task 450's documented trap, repeated by 511).
const DOMAINSTORY = path.join(__dirname, 'fixtures', 'plantuml-domainstory.md')
const MISSING_INCLUDE = path.join(
  __dirname,
  'fixtures',
  'plantuml-missing-include.md',
)
const MULTI = path.join(__dirname, 'fixtures', 'plantuml-multidiagram.md')
const NEWPAGE = path.join(__dirname, 'fixtures', 'plantuml-newpage.md')
const SPRITE_SIZE = path.join(__dirname, 'fixtures', 'plantuml-sprite-size.md')

async function boot(
  evaluateInVSCode: EvaluateInVSCode,
  workbox: import('@playwright/test').Page,
  uri: string,
) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    },
    [] as unknown as [string],
  )
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), a: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(a[0]),
        'vmarkd.editor',
      )
    },
    [uri] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 90_000 })
  return frame
}

test('plantuml render-and-assert sweep: domainstory, missing-include, multidiagram, newpage, sprite-size', async ({
  workbox,
  evaluateInVSCode,
}) => {
  // Scaled to the sum of the 5 original per-test test.setTimeout()s
  // (240_000 + 240_000 + 120_000 + 120_000 + 180_000 = 900_000) — each case below still carries
  // its own internal locator/poll timeouts unchanged from its donor file, so this is a ceiling on
  // the whole sweep, not a tighter budget than any single case had on its own.
  test.setTimeout(900_000)

  // ---- domainstory (task 384) ------------------------------------------------------------
  // The library ships NO sprites: it pulls each one with `!include <material2.1.19/$icon>`, where
  // `$icon` is a procedure parameter — a key our textual expander can never resolve, and the
  // reason every icon was silently missing. It does not need to resolve: the include is not
  // load-bearing (the library's own `%set_variable_value($var, "$ma_" + $icon)` runs regardless),
  // so an icon draws as soon as its sprite EXISTS. We vendor the 15 icons the library names by
  // default (15 KB packed) and the expander inlines that whole trimmed map on the variable key.
  //
  // Two halves, and the second is the one that rots quietly: the icons must DRAW, and the
  // missing-include note must NOT fire any more — it was a true report before the icons shipped
  // and would be a false alarm now.
  {
    const frame = await boot(evaluateInVSCode, workbox, DOMAINSTORY)
    await frame
      .locator('.vditor-ir__preview .language-plantuml svg')
      .first()
      .waitFor({ timeout: 150_000 })
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 3000)))

    const out = await frame.locator('body').evaluate(() => {
      const el = document.querySelector(
        '.vditor-ir__preview .language-plantuml',
      )
      const svg = el?.querySelector('svg')
      return {
        // Each drawn sprite is an <image> in the rendered SVG.
        images: svg ? svg.querySelectorAll('image').length : 0,
        note:
          el?.querySelector('.vmarkd-diagram-note__msg')?.textContent ?? null,
      }
    })
    // eslint-disable-next-line no-console
    console.log(`[domainstory] ${JSON.stringify(out)}`)

    // Person, Document and System — one sprite each, from the vendored material set.
    expect.soft(out.images, 'the three icons drew').toBe(3)
    expect
      .soft(
        out.note,
        'nothing is missing any more, so the note must stay silent',
      )
      .toBeNull()
  }

  // ---- missing-include (task 384) --------------------------------------------------------
  // A PlantUML diagram whose `!include <lib/…>` cannot be resolved offline renders WITHOUT
  // whatever that file defined, and used to say nothing at all: `expandStdlibIncludes` already
  // returned the list of missing keys and the render path threw it away. Found on `domainstory`,
  // whose icons all live in a `material2.1.19` library task 354 deliberately did not vendor
  // (16 MB for an optional feature) — the diagram drew its structure with every icon gone and
  // looked complete.
  //
  // The note is webview surface, so this is the layer that can prove it: a real editor, a real
  // engine, the note element actually in the DOM under the diagram — and NOT under a diagram that
  // lost nothing.
  {
    const frame = await boot(evaluateInVSCode, workbox, MISSING_INCLUDE)
    // PlantUML boots a ~7 MB TeaVM engine and renders serialised, so give both blocks room.
    await frame
      .locator('.vditor-ir__preview .language-plantuml svg')
      .first()
      .waitFor({ timeout: 120_000 })
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 8000)))

    const blocks = await frame.locator('body').evaluate(() => {
      const out: { rendered: boolean; note: string | null }[] = []
      for (const pane of Array.from(
        document.querySelectorAll('.vditor-ir__preview'),
      )) {
        const el = pane.querySelector('.language-plantuml')
        if (!el) continue
        const note = el.querySelector('.vmarkd-diagram-note__msg')
        out.push({
          rendered: !!el.querySelector('svg'),
          note: note ? (note.textContent ?? '') : null,
        })
      }
      return out
    })
    // eslint-disable-next-line no-console
    console.log(`[missing-include] ${JSON.stringify(blocks)}`)

    expect.soft(blocks.length, 'both plantuml blocks found').toBe(2)
    // The diagram still draws — the note is an INFO note beside a successful render, not an error
    // box.
    expect
      .soft(
        blocks[0]?.rendered,
        'the diagram with the bad include still renders',
      )
      .toBe(true)
    expect
      .soft(blocks[0]?.note, 'it says which file it could not resolve')
      .toContain('<nosuchlib/NoSuchFile>')
    expect.soft(blocks[0]?.note).toContain('not available offline')
    // …and a diagram that lost nothing stays quiet, or the note would be noise on every document.
    expect.soft(blocks[1]?.rendered, 'the clean diagram renders').toBe(true)
    expect.soft(blocks[1]?.note, 'a clean diagram carries no note').toBeNull()
  }

  // ---- multidiagram (task 140) -----------------------------------------------------------
  // The TeaVM engine's render() draws only the FIRST diagram when one ` ```plantuml ` fence holds
  // several `@startuml…@enduml` pairs (verified in Step 0), so the rest would vanish silently. We
  // keep rendering the first, but APPEND a note ("Only the first of N…") so nothing is dropped
  // without a signal. `newpage` (multi-page within ONE @startuml) is rendered in full by the
  // engine → NO note. Real-VS-Code only: the render path + resource pipeline don't reproduce in
  // the harness. countPlantumlDiagrams + the note DOM are unit-tested; this proves the wiring
  // end-to-end. Each sub-case is its OWN single-block fixture so the multi-diagram engine
  // type-stickiness (task 347) can't confound the run.
  {
    const frame = await boot(evaluateInVSCode, workbox, MULTI)
    await frame
      .locator('.vditor-ir__preview .language-plantuml svg')
      .first()
      .waitFor({ timeout: 60_000 })
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

    const info = await frame.locator('body').evaluate(() => {
      const block = document.querySelector(
        '.vditor-ir__preview .language-plantuml',
      )
      const svg = block?.querySelector('svg')
      const svgText = svg
        ? Array.from(svg.querySelectorAll('text'))
            .map((t) => t.textContent ?? '')
            .join(' ')
        : ''
      const note = block?.querySelector('.vmarkd-diagram-note')
      return {
        hasSvg: !!svg,
        showsFirst: /FirstDiagram|Bob/.test(svgText),
        showsSecond: /SecondDiagram|Dave/.test(svgText),
        noteText: note?.textContent ?? '',
      }
    })
    // eslint-disable-next-line no-console
    console.log(`[multidiagram] ${JSON.stringify(info)}`)

    expect.soft(info.hasSvg).toBe(true)
    expect.soft(info.showsFirst).toBe(true) // first diagram still renders
    expect.soft(info.showsSecond).toBe(false) // engine dropped the second (the whole point)
    expect
      .soft(info.noteText)
      .toContain('Only the first of 2 PlantUML diagrams') // …and we flag it
    expect.soft(info.noteText).toContain('its own code block')
  }

  // ---- newpage (task 140, same underlying guard as multidiagram above) ------------------
  // `newpage` renders all pages with NO note (it is one diagram, not several).
  {
    const frame = await boot(evaluateInVSCode, workbox, NEWPAGE)
    await frame
      .locator('.vditor-ir__preview .language-plantuml svg')
      .first()
      .waitFor({ timeout: 60_000 })
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

    const info = await frame.locator('body').evaluate(() => {
      const block = document.querySelector(
        '.vditor-ir__preview .language-plantuml',
      )
      const svgText = Array.from(block?.querySelectorAll('svg text') ?? [])
        .map((t) => t.textContent ?? '')
        .join(' ')
      return {
        showsPageOne: /PageOne|Frank/.test(svgText),
        showsPageTwo: /PageTwo|Heidi/.test(svgText),
        noteCount: block?.querySelectorAll('.vmarkd-diagram-note').length ?? -1,
      }
    })
    // eslint-disable-next-line no-console
    console.log(`[newpage] ${JSON.stringify(info)}`)

    expect.soft(info.showsPageOne).toBe(true) // both pages render (engine handles newpage natively)
    expect.soft(info.showsPageTwo).toBe(true)
    expect.soft(info.noteCount).toBe(0) // …so NO "only the first" note
  }

  // ---- sprite-size (task 354/355) --------------------------------------------------------
  // A BITMAP-sprite PlantUML diagram must never be scaled above its intrinsic size.
  //
  // Why this exists: `main.css` used to boost small PlantUML to `min-width:300px` so a short
  // sequence diagram isn't tiny. The stdlib icon libraries (k8s/aws/azure — task 136/354) emit
  // bitmap `<image>` sprites, and boosting those stretched and blurred them (user: "za duże,
  // sprity porozciągane"). Task 354 scoped the boost to `svg:not(:has(image))`; task 355 then
  // removed the boost outright, because with `height:auto` it scaled the vector diagrams' LABELS
  // just as badly (~2.8x), and settled on a uniform 14 layout font at scale 1. Both families now
  // render at natural size, so this covers both.
  //
  // That fix had NO regression guard: the sizing net (`diagram-width.spec.ts`) measures
  // `all-renderers.md`, which contains exactly one PlantUML block — a pure-vector sequence. There
  // was no sprite diagram in ANY fixture, so nothing would have caught the regression that
  // produced 355.
  //
  // Asserted: neither family is upscaled (a bitmap degrades; a vector's labels inflate — the two
  // ways the boost went wrong), plus the column-fit invariant.
  {
    const frame = await boot(evaluateInVSCode, workbox, SPRITE_SIZE)
    // task 451: was a blind 25s sleep. This fixture has exactly 2 plantuml blocks (see its own
    // header) and no mode switching, so — unlike wysiwyg-parity/mode-switch-parity's multi-engine
    // cross-pane reflow — there is no other content whose completion could still shift this
    // pane's width. Poll for each block's own finished-state signal instead of its geometry
    // directly:
    //  - the VECTOR block goes through our layout-font/scale pass (scalePumlSvg), which stamps
    //    `data-vmarkd-scaled` as the LAST thing it does after writing the final width/height
    //    attributes — presence of the attribute means the geometry the assertions read below is
    //    already final, not "some svg landed".
    //  - the SPRITE block themes itself (scalePumlSvg explicitly skips svgs with baked/own
    //    themes — see the fixture comment), so it has no such marker; its width/height are the
    //    raw TeaVM-engine-emitted attributes, written once, synchronously, on insertion, and
    //    never touched again — so "found, with a nonzero box" IS its finished state.
    //
    // Wrapped in .catch() (task 450/511 idiom, same as clipboard-elements.spec.ts's paste sweep):
    // this is a settle-wait, not itself one of the assertions under test — a timeout here must
    // not abort the whole sweep, the `expect.soft()` calls below already re-derive and check the
    // real geometry.
    await expect
      .poll(
        () =>
          frame.locator('body').evaluate(() => {
            const svgs = Array.from(
              document.querySelectorAll(
                '.language-plantuml > svg, code.language-plantuml > svg',
              ),
            ) as SVGSVGElement[]
            const sprite = svgs.find((s) => s.querySelector('image'))
            const vector = svgs.find((s) => !s.querySelector('image'))
            return {
              spriteDrawn: !!sprite && sprite.getBoundingClientRect().width > 0,
              vectorScaled: !!vector?.hasAttribute('data-vmarkd-scaled'),
            }
          }),
        {
          message:
            'both plantuml blocks finished rendering (sprite drawn, vector scale-stamped)',
          timeout: 30_000,
        },
      )
      .toEqual({ spriteDrawn: true, vectorScaled: true })
      .catch(() => {
        /* best-effort settle wait — see comment above */
      })

    const m = await frame.locator('body').evaluate(() => {
      const col = Math.round(
        (
          document.querySelector(
            '.vditor-ir__preview, .vditor-wysiwyg__preview, .vditor-preview',
          ) as HTMLElement
        ).getBoundingClientRect().width,
      )
      const svgs = (
        [
          ...document.querySelectorAll(
            '.language-plantuml > svg, code.language-plantuml > svg',
          ),
        ] as SVGSVGElement[]
      ).filter((s) => s.getBoundingClientRect().width > 0)
      const shape = (s: SVGSVGElement) => {
        const r = s.getBoundingClientRect()
        const vb = (s.getAttribute('viewBox') ?? '').split(/[ ,]+/).map(Number)
        return {
          sprite: !!s.querySelector('image'),
          w: Math.round(r.width),
          h: Math.round(r.height),
          vbW: vb.length === 4 ? Math.round(vb[2]) : null,
          vbH: vb.length === 4 ? Math.round(vb[3]) : null,
        }
      }
      return { col, svgs: svgs.map(shape) }
    })
    // eslint-disable-next-line no-console
    console.log(`[plantuml-sprite-size] ${JSON.stringify(m)}`)

    const sprite = m.svgs.find((s) => s.sprite)
    const vector = m.svgs.find((s) => !s.sprite)

    // The fixture itself is part of the guard: if the icon library ever stops emitting <image>,
    // this case would silently stop testing anything.
    expect
      .soft(sprite, 'no sprite (<image>) plantuml svg rendered')
      .toBeDefined()
    expect.soft(vector, 'no pure-vector plantuml svg rendered').toBeDefined()
    expect.soft(sprite?.vbW ?? 0).toBeGreaterThan(0)

    // THE GUARD: a bitmap sprite diagram is never scaled up. Allow 2% for sub-pixel layout
    // rounding.
    const scale = (sprite?.w ?? 0) / (sprite?.vbW ?? 1)
    expect
      .soft(
        scale,
        `sprite plantuml upscaled ${scale.toFixed(2)}x (${sprite?.vbW}px -> ${sprite?.w}px) — the min-width boost must exclude svg:has(image)`,
      )
      .toBeLessThanOrEqual(1.02)

    // Same for the pure-vector one: task 355 settled on no upscale for either family (the CSS
    // boost is gone and the layout-font/scale pair ships at 14/1), so both render at their
    // intrinsic size.
    expect.soft(vector?.vbW ?? 0).toBeGreaterThan(0)
    const vScale = (vector?.w ?? 0) / (vector?.vbW ?? 1)
    expect
      .soft(
        vScale,
        `vector plantuml upscaled ${vScale.toFixed(2)}x (${vector?.vbW}px -> ${vector?.w}px) — nothing may scale the render`,
      )
      .toBeLessThanOrEqual(1.02)

    // Neither diagram may overflow the text column.
    expect.soft(sprite?.w ?? 9999).toBeLessThanOrEqual(m.col + 1)
    expect.soft(vector?.w ?? 9999).toBeLessThanOrEqual(m.col + 1)
  }
})
