import { wf } from './webview-helpers'
// NET (task 373) — every SVG reference must resolve INSIDE its own pane.
//
// Reported: "flowchart i mermaid nie mają strzałek pomiędzy preview i ir". The render reuse paints a
// VERBATIM copy of the other pane's SVG, which duplicates every `id` in the document — and
// `url(#marker)` resolves to the FIRST match in DOCUMENT ORDER, i.e. the ORIGINAL (IR) pane. That
// pane is display:none while Preview is shown, and a marker inside a display:none subtree is not
// painted, so every arrowhead disappeared.
//
// Asserting "arrowheads are visible" pixel-wise would be brittle; the mechanism is exact: for each
// url(#id) in a pane's SVG, the FIRST element with that id in the document must be in the SAME pane.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings } from './settings-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

usePinnedSettings(test, { 'vmarkd.theme.content': 'auto' })

const CHECK = `(() => {
  const pv = window.vditor.vditor.preview.previewElement
  const bad = []
  const dangling = []
  let checked = 0
  for (const svg of Array.from(pv.querySelectorAll('.language-mermaid svg, .language-flowchart svg'))) {
    const refs = new Set((svg.innerHTML.match(/url\\(#([^)]+)\\)/g) || [])
      .map((r) => r.replace(/url\\(#|\\)/g, '')))
    for (const id of refs) {
      checked++
      const first = document.querySelector('[id="' + CSS.escape(id) + '"]')
      // A reference that is DEFINED SOMEWHERE ELSE is the bug: the browser paints nothing when that
      // somewhere is a display:none pane. A reference defined NOWHERE is a different, pre-existing
      // thing (mermaid emits url(#…-gradient) without ever defining the gradient) — record it, but
      // do not fail on it, or this spec would be red for a reason it does not guard.
      if (!first) dangling.push(id)
      else if (!pv.contains(first))
        bad.push(id + ' -> ' + (first.closest('.vditor-ir') ? 'IR pane (hidden)' : 'elsewhere'))
    }
  }
  return { checked, bad: bad.slice(0, 5), dangling: dangling.slice(0, 3) }
})()`

test('mermaid/flowchart marker references resolve inside the visible pane', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(180_000)
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
  // task 451: was a blind 12s sleep. This is a markup/attribute check (id refs), not a
  // cross-engine geometry measurement, so there's no "still growing" risk — poll for the fixture's
  // own known block count (measured: 3 mermaid/flowchart fences in all-renderers.md). Deliberately
  // the IR pane's own svgs (not `preview.previewElement`, which `CHECK` below reads): this is the
  // PRE-switch gate — "IR finished rendering, so the switch-to-preview copy has something to
  // reuse" — not the same read as the post-switch check further down. NOTE this is the ELEMENT
  // count, not `checked` (the ref count further down) — those are different numbers; a first pass
  // conflated them and timed out at exactly 3 elements while polling `> 3`.
  await expect
    .poll(
      () =>
        frame
          .locator(
            '.vditor-ir .language-mermaid svg, .vditor-ir .language-flowchart svg',
          )
          .count(),
      { message: 'IR pane finished rendering its mermaid/flowchart blocks' },
    )
    .toBeGreaterThanOrEqual(3)
  await frame.locator('body').evaluate(() => {
    const inst = (window as any).vditor
    const v = inst.vditor
    v.preview.element.style.display = 'block'
    v[inst.getCurrentMode()].element.parentElement.style.display = 'none'
    v.preview.render(v)
  })
  // task 451: was a blind 12s sleep. Poll the SAME `CHECK` the final assertion runs, so "settled"
  // means "passes its own check" — not just "some svg count is stable" (a stale-but-stable state
  // between ids landing and their `-vmN` namespacing pass would falsely look done). `.catch()`
  // makes this best-effort ON PURPOSE: a REAL regression (ids that never resolve inside the pane)
  // must NOT throw here and lose the diagnostic — it has to fall through to the hard assertions
  // below, which carry the actual offending ref list (`bad.slice(0, 5)`) and the message that names
  // the bug ("arrowheads vanish"). A poll timeout only rules out a TRANSIENT bad state; a
  // persistent one is reported properly by the fresh read right after.
  await expect
    .poll(
      async () => {
        const c = (await frame.locator('body').evaluate(CHECK)) as {
          checked: number
          bad: string[]
        }
        return { checked: c.checked > 3, clean: c.bad.length === 0 }
      },
      {
        message:
          'preview pane marker references resolved (no ids left dangling in the hidden pane)',
      },
    )
    .toEqual({ checked: true, clean: true })
    .catch(() => {
      /* deliberate — see comment above */
    })

  const r = (await frame.locator('body').evaluate(CHECK)) as {
    checked: number
    bad: string[]
    dangling: string[]
  }
  // Never let an unrendered pane pass as "no broken references".
  expect(r.checked, 'no marker references found to check').toBeGreaterThan(3)
  if (r.dangling.length)
    console.log(`dangling (pre-existing): ${r.dangling.join(', ')}`)
  expect(
    r.bad,
    'a marker reference pointed outside the visible pane — arrowheads vanish',
  ).toEqual([])
})
