import { wf } from './webview-helpers'
// NET (task 374) — a painted copy must keep its stylesheet.
//
// Reported with a screenshot: mermaid came out as BLACK boxes in a default font. Cause: task 373's
// id namespacing renamed EVERY id, and mermaid emits its whole stylesheet as rules scoped under the
// root svg's id (`#mermaid-abc .node path{fill:…}`). That selector lives in CSS text, so renaming the
// id attribute orphaned every rule at once.
//
// Two independent assertions, because each catches a different way of getting this wrong:
//  1. structural — every mermaid svg's own id must still equal the id its <style> scopes on. A
//     namespacing pass that touches scope ids fails here immediately.
//  2. computed — the painted pane's node fill/stroke must EQUAL the natively rendered pane's, and not
//     be the SVG initial black. This is the user-visible symptom, and it also covers a CSS-text
//     rewrite that renames both sides but corrupts a hex colour (`fill:#111` vs `id="111"`).
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings } from './settings-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

usePinnedSettings(test, { 'vmarkd.theme.content': 'auto' })

// getComputedStyle resolves cascaded values on a display:none subtree too, so the hidden IR pane is
// still comparable — which is what makes the cross-pane check possible while only one pane is shown.
const PROBE = `(() => {
  const paneOf = (root) => {
    const out = { scopes: [], probe: null }
    for (const svg of Array.from(root.querySelectorAll('.language-mermaid svg'))) {
      const css = svg.querySelector('style')?.textContent || ''
      const scope = (css.match(/#([A-Za-z][\\w-]{6,})[\\s{]/) || [])[1] || null
      out.scopes.push({ svgId: svg.id || null, scope })
      if (!out.probe) {
        const el = svg.querySelector('.node .label-container, .node rect, .node polygon, .node path')
        if (el) {
          const cs = getComputedStyle(el)
          out.probe = { tag: el.tagName, fill: cs.fill, stroke: cs.stroke }
        }
      }
    }
    return out
  }
  const v = window.vditor.vditor
  const ir = v[window.vditor.getCurrentMode()].element
  return { preview: paneOf(v.preview.previewElement), edit: paneOf(ir) }
})()`

test('a reused mermaid keeps its id-scoped stylesheet (same colours in both panes)', async ({
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
  // task 451: was a blind 12s sleep. Markup/attribute check (id-scope match, computed fill/stroke
  // equality), not a geometry measurement, so there's no "still growing" risk — poll for the
  // fixture's own known block count (measured: 2 mermaid fences in all-renderers.md).
  await expect
    .poll(() => frame.locator('.language-mermaid svg').count(), {
      message: 'IR pane finished rendering its mermaid blocks',
    })
    .toBeGreaterThanOrEqual(2)
  // Switch to the full Preview — this is the paint that reuses the edit pane's render.
  await frame.locator('body').evaluate(() => {
    const inst = (window as any).vditor
    const v = inst.vditor
    v.preview.element.style.display = 'block'
    v[inst.getCurrentMode()].element.parentElement.style.display = 'none'
    v.preview.render(v)
  })
  // task 451: was a blind 12s sleep. Poll the SAME `PROBE` the final assertions read, so "settled"
  // means "the Preview pane has a scoped stylesheet AND a probed node colour" — not just "some svg
  // count is stable". `.catch()` is deliberate (same pattern as svg-marker-refs.spec.ts): a REAL
  // regression must not throw away its diagnostic here — it falls through to the hard assertions
  // below, which report exactly which pane/property broke.
  await expect
    .poll(
      async () => {
        const r = (await frame.locator('body').evaluate(PROBE)) as {
          preview: { scopes: unknown[]; probe: unknown }
        }
        return r.preview.scopes.length > 0 && r.preview.probe !== null
      },
      {
        message:
          'Preview pane finished rendering its mermaid stylesheet + probed node',
      },
    )
    .toBe(true)
    .catch(() => {
      /* deliberate — see comment above */
    })

  type Pane = {
    scopes: { svgId: string | null; scope: string | null }[]
    probe: { tag: string; fill: string; stroke: string } | null
  }
  const r = (await frame.locator('body').evaluate(PROBE)) as {
    preview: Pane
    edit: Pane
  }

  // Never let an unrendered pane pass as "nothing broken".
  expect(
    r.preview.scopes.length,
    'no rendered mermaid found in the Preview pane',
  ).toBeGreaterThan(0)
  for (const s of [...r.preview.scopes, ...r.edit.scopes]) {
    expect(
      s.scope,
      'a mermaid svg carries no id-scoped stylesheet at all',
    ).not.toBeNull()
    expect(
      s.svgId,
      'the mermaid svg id no longer matches the id its stylesheet scopes on',
    ).toBe(s.scope)
  }

  expect(r.preview.probe, 'no mermaid node shape found to probe').not.toBeNull()
  expect(r.edit.probe, 'no mermaid node shape found to probe').not.toBeNull()
  const pv = r.preview.probe as NonNullable<Pane['probe']>
  const ed = r.edit.probe as NonNullable<Pane['probe']>
  expect(pv.tag, 'the two panes probed different shapes').toBe(ed.tag)
  expect(
    pv.fill,
    'the Preview mermaid node lost its themed fill (orphaned stylesheet)',
  ).toBe(ed.fill)
  expect(pv.stroke, 'the Preview mermaid node lost its themed stroke').toBe(
    ed.stroke,
  )
  // The orphaned-stylesheet symptom exactly: SVG's initial fill is black.
  expect(
    pv.fill,
    'the mermaid node fell back to the SVG initial black',
  ).not.toBe('rgb(0, 0, 0)')
})
