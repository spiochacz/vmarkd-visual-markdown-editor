import { type EvaluateInVSCode, wf } from './webview-helpers'
// NET (task 366) — WYSIWYG is the THIRD editing surface and had no parity coverage at all. It has
// its own render path (Vditor rebuilds the block DOM differently from IR), and the sweep that
// produced this spec found two real divergences there:
//
//   - abc rendered 451.99×98.83 in IR, 420.02×87.83 in Preview and 420.02×72.83 in WYSIWYG. abc is
//     not even self-consistent between two fresh renders of the SAME pane (72.83 and 87.83 on
//     consecutive runs), so no amount of tuning could have made three engine passes agree — the fix
//     was to extend the same-session reuse to panes a mode switch builds.
//   - every callout was 62px in WYSIWYG against 58px in BOTH other panes: a WYSIWYG-only 4px title
//     margin. Removed rather than added to the others, because the IR rule zeroes it deliberately
//     (the expanded source puts the marker and the first content line in ONE paragraph, so a title
//     margin changes the box height on collapse⇄expand).
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings } from './settings-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

usePinnedSettings(test, { 'vmarkd.theme.content': 'auto' })

// Every engine whose render is reused across panes, so its markup must be identical in all three.
const LANGS = [
  'd2',
  'wavedrom',
  'nomnoml',
  'vega-lite',
  'mermaid',
  'abc',
  'flowchart',
  'plantuml',
]

const READ = (paneExpr: string) => `((langs) => {
  const v = window.vditor
  const root = ${paneExpr}
  if (!root) return null
  const out = { diagrams: {}, callouts: [] }
  for (const lang of langs) {
    out.diagrams[lang] = Array.from(root.querySelectorAll('.language-' + lang))
      .filter((el) => !el.closest('.vditor-ir__marker--pre, .vditor-wysiwyg__pre'))
      .filter((el) => el.querySelector('svg'))
      .map((el) => ({
        html: el.innerHTML,
        size: el.querySelector('svg').getAttribute('width') + 'x' + el.querySelector('svg').getAttribute('height'),
        hit: el.getAttribute('data-vmarkd-cache-hit'),
      }))
  }
  out.callouts = Array.from(root.querySelectorAll('blockquote[data-callout]')).map((b) => ({
    type: b.getAttribute('data-callout'),
    h: Math.round(b.getBoundingClientRect().height),
  }))
  return out
})(${JSON.stringify(LANGS)})`

const TO_WYSIWYG = () => {
  const v = (window as any).vditor.vditor
  v.toolbar.elements['edit-mode']?.children[0]?.dispatchEvent(
    new MouseEvent('click', { bubbles: true }),
  )
  document
    .querySelector('button[data-mode="wysiwyg"]')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

const TO_PREVIEW = () => {
  const inst = (window as any).vditor
  const v = inst.vditor
  v.preview.element.style.display = 'block'
  v[inst.getCurrentMode()].element.parentElement.style.display = 'none'
  v.preview.render(v)
}

type Snap = {
  diagrams: Record<string, { html: string; size: string; hit: string | null }[]>
  callouts: { type: string; h: number }[]
}

async function openAndSweep(
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: EvaluateInVSCode,
) {
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
  // task 451 looked at converting these three to polls and deliberately left them: this reads
  // callout `getBoundingClientRect().height` and diagram markup across 8 engines on
  // all-renderers.md, switching panes between reads. A poll can only test "has something
  // appeared", not "has everything finished growing" — declaring done on a mid-reflow plateau
  // would be a FALSE PASS on exactly the class of bug this file exists to catch (see the header:
  // abc wasn't even self-consistent between two fresh renders). Leave as a quiescence wait.
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 15_000)))
  const ir = (await frame
    .locator('body')
    .evaluate(READ('v.vditor.ir.element'))) as Snap

  await frame.locator('body').evaluate(TO_WYSIWYG)
  // task 451: same reasoning as above — leave.
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 18_000)))
  const wys = (await frame
    .locator('body')
    .evaluate(READ('v.vditor.wysiwyg.element'))) as Snap

  await frame.locator('body').evaluate(TO_PREVIEW)
  // task 451: same reasoning as above — leave.
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 18_000)))
  const pv = (await frame
    .locator('body')
    .evaluate(READ('v.vditor.preview.previewElement'))) as Snap

  return { ir, wys, pv }
}

// Ids MUST differ between panes since task 373: a verbatim copy duplicated every id, and url(#…)
// resolves to the first match in document order — the hidden pane's copy — so mermaid/flowchart lost
// their arrowheads. Each paint namespaces its ids with `-vmN`; strip that before comparing, so this
// still asserts byte-identity of everything that is supposed to be identical.
const stripIdNs = (html: string) => html.replace(/-vm\d+(?=["')])/g, '')
function compareDiagrams(a: Snap, b: Snap, label: string) {
  const diffs: string[] = []
  let compared = 0
  for (const lang of LANGS) {
    const x = a.diagrams[lang] ?? []
    const y = b.diagrams[lang] ?? []
    if (x.length !== y.length) {
      diffs.push(`${label} ${lang}: ${x.length} drew vs ${y.length}`)
      continue
    }
    x.forEach((blk, i) => {
      compared++
      if (stripIdNs(blk.html) !== stripIdNs(y[i].html))
        diffs.push(
          `${label} ${lang}#${i}: markup differs (size ${blk.size} -> ${y[i].size})`,
        )
    })
  }
  return { compared, diffs }
}

test('WYSIWYG reuses diagram renders and preserves diagram/callout parity across panes', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(300_000)
  const { ir, wys, pv } = await openAndSweep(workbox, evaluateInVSCode)

  const a = compareDiagrams(ir, wys, 'IR->WYSIWYG')
  const b = compareDiagrams(wys, pv, 'WYSIWYG->Preview')
  // Never let "nothing rendered" pass as "everything matched".
  expect
    .soft(a.compared, 'no diagram pairs were compared between IR and WYSIWYG')
    .toBeGreaterThan(10)
  expect.soft(b.compared).toBeGreaterThan(10)
  expect.soft([...a.diffs, ...b.diffs]).toEqual([])
  // Pins the MECHANISM, so a regression is caught even on a document where two engine passes
  // happen to agree — which for abc they demonstrably do not.
  const abc = wys.diagrams.abc ?? []
  expect.soft(abc.length, 'abc did not render in WYSIWYG').toBeGreaterThan(0)
  expect
    .soft(
      abc.filter((x) => x.hit !== '1').length,
      'a WYSIWYG abc block was rendered by the engine instead of reused',
    )
    .toBe(0)
  expect.soft(ir.callouts.length, 'no callouts found').toBeGreaterThan(4)
  expect
    .soft(wys.callouts.map((c) => c.type))
    .toEqual(ir.callouts.map((c) => c.type))
  expect
    .soft(pv.callouts.map((c) => c.type))
    .toEqual(ir.callouts.map((c) => c.type))
  // IR <-> WYSIWYG is still the exact-match regression guard this test was written for (task 366's
  // 4px WYSIWYG-only title margin) — both are "edit surface" and ADR-0003 never touched their
  // relationship to each other, only edit-vs-preview.
  expect
    .soft(
      wys.callouts.map((c) => c.h),
      'callouts resize when switching IR -> WYSIWYG',
    )
    .toEqual(ir.callouts.map((c) => c.h))
  // Preview vs edit surface is exact-match again (task 532 step 3, ADR-0009): every stage reads the
  // same --vmarkd-geo-* profile, so a callout is the same height in the Preview as in IR/WYSIWYG.
  // (Task 480 had loosened this to a bounded delta to accept task 110's Preview-only rhythm.)
  expect
    .soft(
      pv.callouts.map((c) => c.h),
      'callouts resize when switching to the Preview',
    )
    .toEqual(ir.callouts.map((c) => c.h))
})
