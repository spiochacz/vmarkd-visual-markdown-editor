import { wf } from './webview-helpers'
// NET (task 369) — collapsed inline code must stay in the TEXT LINE, where it also sits while you
// edit it.
//
// The rule the whole task converged on: the editing view is the reference. With the caret inside,
// the code sits in the text line; so must the collapsed IR and the Preview, and it should only ever
// wrap INSIDE itself when it cannot fit.
//
// Vditor hides the backtick markers with width:0/overflow:hidden, which only work because the marker
// is an inline-block — and an inline-block is an ATOMIC inline, so a break is allowed before it. That
// gave the collapsed node a break point right before the code: a narrow cell pushed the whole code
// onto its own line (code top 51px in IR vs 30px in Preview), and the caret then pulled it back, so
// the block jumped on every enter/leave.
//
// Both halves are asserted, because the obvious fixes each break one of them: hiding the marker by
// shrinking it keeps the break, and simply un-hiding it (display:inline / display:contents) reveals
// the backtick.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings } from './settings-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

usePinnedSettings(test, { 'vmarkd.theme.content': 'auto' })

// Row 6 of the renderer table is `SVG post-processing` glued to `` `currentColor` `` with no space —
// the shape that has no break opportunity of its own. The FIXTURE had a space there until task 370:
// the IR parse silently deleted it (Lute trims the whitespace in front of a cell's first inline
// element), so the render was glued while the source was not, and this spec was measuring the bug's
// output. With that trim repaired the source had to become what the spec always claimed it was —
// otherwise a break at the real space is ordinary wrapping, and there is nothing here to assert.
const STATE = `(() => {
  const root = window.vditor.vditor.ir.element
  const t = Array.from(root.querySelectorAll('table'))
    .sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0]
  if (!t) return null
  const cell = t.querySelectorAll('tr')[6].children[2]
  const node = cell.querySelector('.vditor-ir__node[data-type="code"]')
  const code = cell.querySelector('code')
  if (!node || !code) return null
  const markerW = () => {
    const m = node.querySelector('.vditor-ir__marker')
    return m ? Math.round(m.getBoundingClientRect().width * 100) / 100 : null
  }
  const codeTop = () =>
    Math.round(code.getBoundingClientRect().top - cell.getBoundingClientRect().top)
  // The character right before the code node, so the fixture guard can prove the cell really is
  // glued — a space there would give the line a legitimate break point and make the assertion moot.
  const prev = node.previousSibling
  const before = prev && prev.textContent ? prev.textContent.slice(-1) : ''
  const collapsed = { markerW: markerW(), codeTop: codeTop(), text: code.textContent, before }
  // Caret inside: Vditor marks the node --expand and the markers must come back so they are editable.
  node.classList.add('vditor-ir__node--expand')
  const expanded = { markerW: markerW() }
  node.classList.remove('vditor-ir__node--expand')
  // Scope guard: the fix must touch ONLY [data-type="code"]. Every other collapsed INLINE marker
  // type (strong/em/link/s…) keeps Vditor's stock hiding (inline-block) — taking THOSE out of flow
  // was never measured and is not covered by this spec. The BLOCK node types are excluded on
  // purpose: code-block/math-block markers are display:block from the phantom-height fix and
  // html-block's from the comment fix — earlier deliberate rules, not this one's scope.
  const others = {}
  for (const el of Array.from(root.querySelectorAll('.vditor-ir__node:not(.vditor-ir__node--expand):not([data-type="code"]):not([data-type="code-block"]):not([data-type="math-block"]):not([data-type="html-block"]) > .vditor-ir__marker'))) {
    const dt = el.parentElement.getAttribute('data-type') || '?'
    if (!(dt in others)) others[dt] = getComputedStyle(el).display
  }
  return { collapsed, expanded, others, lineHeight: parseFloat(getComputedStyle(cell).lineHeight) }
})()`

test('collapsed inline code stays in the text line, and its markers return for editing', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(240_000)
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
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 10_000)))

  const s = (await frame.locator('body').evaluate(STATE)) as {
    collapsed: {
      markerW: number
      codeTop: number
      text: string
      before: string
    }
    expanded: { markerW: number }
    lineHeight: number
  } | null

  expect(
    s,
    'the renderer table / its inline-code node was not found',
  ).not.toBeNull()
  const st = s as NonNullable<typeof s>
  // Guard the fixture shape: if the glued source ever gains a space this spec tests nothing.
  expect(
    st.collapsed.text,
    'the probed cell is not the glued inline-code case',
  ).toBe('currentColor')
  expect(
    /\s/.test(st.collapsed.before),
    'the probed cell gained a space before its code — nothing left to assert',
  ).toBe(false)
  // 1. The code sits on the SAME line as the text before it — not pushed a whole line down.
  expect(
    st.collapsed.codeTop,
    'collapsed inline code was pushed onto its own line instead of staying in the text line',
  ).toBeLessThan(st.lineHeight * 2)
  // 2. The marker is still invisible while collapsed (the naive un-hide fixes reveal the backtick).
  expect(
    st.collapsed.markerW,
    'the backtick marker became visible in the collapsed node',
  ).toBe(0)
  // 3. …and comes back when the caret enters, or the markers could not be edited.
  expect(
    st.expanded.markerW,
    'the backtick marker did not return for editing',
  ).toBeGreaterThan(0)
  // 4. Scope: every OTHER collapsed marker type still uses Vditor's stock inline-block hiding.
  const st2 = st as typeof st & { others: Record<string, string> }
  const otherTypes = Object.keys(st2.others)
  expect(
    otherTypes.length,
    'no non-code collapsed markers found — the scope guard compared nothing',
  ).toBeGreaterThan(1)
  for (const [dt, disp] of Object.entries(st2.others)) {
    expect(disp, `the ${dt} marker was changed by the code-only rule`).toBe(
      'inline-block',
    )
  }
})
