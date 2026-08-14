import { wf } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings } from './settings-helpers'

// Edit↔Preview parity in the REAL webview (real content theme + custom-editor pipeline). A
// collapsed IR document must render at the SAME size/spacing as the full Preview overlay, so
// nothing "jumps" on toggle. We measure cross-mode-stable signals — NOT IR's `data-type`, which
// the Preview pane (plain Lute HTML: `<pre>`, `<div class="language-*">`, bare `.katex-display`)
// does NOT carry, so a data-type filter would silently measure nothing in Preview.
//
// Covers the fixes on this branch:
//  - diagram/math block phantom-height (IR dual-node was ~58–72px taller) → total doc height,
//  - block-math top gap (KaTeX `.katex-display` margin didn't collapse through the IR wrapper),
//  - callouts (Preview pane now styles `[!TYPE]` the same as IR),
//  - inline math (`$x$`) must stay inline (block-collapse rule must not match `inline-node`).

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

// PRECONDITION: the DEFAULT content theme ('auto'). This spec was authored and calibrated under it,
// but several sibling specs (flowchart-theme, d2-theme, vega-theme, …) pin `theme.content` GLOBALLY
// and never restore it, so in a full-suite run this one silently inherited e.g. 'github-light'.
// Under that theme the d2 block at index 96 renders 9px taller in IR than in Preview (133 vs 124) —
// reproducible in ~1min with `flowchart-theme.spec.ts parity.spec.ts`. That delta is REAL but it is
// NOT this spec's target (the phantom-height bug it guards was 58–72px, which is why the threshold
// is >8px); it is a diagram-sizing question, tracked in tasks/362. Pinning the precondition makes the
// run deterministic WITHOUT masking anything: the 9px case stays reproducible on demand, and the
// threshold is untouched.
usePinnedSettings(test, { 'vmarkd.theme.content': 'auto' })

// Cross-mode metrics, evaluated against `.vditor-ir .vditor-reset` or `.vditor-preview .vditor-reset`.
const METRICS = `(sel => {
  const reset = document.querySelector(sel);
  if (!reset) return null;
  // Every top-level block, in document order (IR & Preview render the same doc in the same order,
  // so child[i] pairs — until IR's trailing edit paragraph). IR carries data-type; Preview doesn't.
  const kids = Array.from(reset.children).map(el => ({
    irType: el.getAttribute ? el.getAttribute('data-type') : null,
    h: Math.round(el.getBoundingClientRect().height),
  }));
  // block-math: the formula's visual top relative to the previous block's bottom
  const kd = reset.querySelector('.katex-display');
  let mathGap = null;
  if (kd) {
    let top = kd; while (top.parentElement && top.parentElement !== reset) top = top.parentElement;
    const prev = top.previousElementSibling;
    if (prev) mathGap = Math.round(kd.getBoundingClientRect().top - prev.getBoundingClientRect().bottom);
  }
  // callouts: type + injected render + height, in document order
  const callouts = Array.from(reset.querySelectorAll(':scope > blockquote[data-callout]')).map(b => ({
    type: b.getAttribute('data-callout'),
    injected: !!b.querySelector(':scope > .vmarkd-callout__preview'),
    h: Math.round(b.getBoundingClientRect().height),
  }));
  // inline math markers must NOT be block (would break onto their own line)
  const inlineMarkers = Array.from(reset.querySelectorAll('.vditor-ir__node[data-type="inline-node"]')).map(n => {
    const m = n.querySelector('.vditor-ir__marker');
    return m ? getComputedStyle(m).display : 'none';
  });
  return { kids, mathGap, callouts, inlineMarkers };
})`

test('IR (collapsed) renders at the same size/spacing as Preview', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(async (vscode, uri) => {
    await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
    await vscode.commands.executeCommand(
      'vscode.openWith',
      vscode.Uri.file(uri),
      'vmarkd.editor',
    )
  }, FIXTURE)

  const frame = wf(workbox)
  await expect(
    frame.locator('.vditor-ir__node[data-type="code-block"]').first(),
  ).toBeVisible({ timeout: 45_000 })
  await expect(
    frame.locator('.vditor-ir__preview code.hljs').first(),
  ).toBeVisible({ timeout: 20_000 })
  // Wait for highlighting across the WHOLE pane to settle, not just the first block. Heights are
  // compared block-by-block, and an un-highlighted code block is ~1em shorter than a highlighted one
  // (the .hljs padding box) — so measuring while later blocks are still being coloured reports a bogus
  // IR-vs-Preview height delta. Waiting on the FIRST block plus a fixed sleep was enough when idle and
  // not under full-suite load: that is the "9px taller code-block" failure this spec showed only in the
  // suite. Settle = the highlighted count stops moving (not a fixed total: diagram fences never get
  // .hljs, so there is no count to equal).
  const settleHljs = async (paneSel: string) => {
    let last = -1
    await expect
      .poll(
        async () => {
          const n = await frame.locator(`${paneSel} code.hljs`).count()
          const stable = n > 0 && n === last
          last = n
          return stable
        },
        { timeout: 30_000, intervals: [400, 400, 600, 800] },
      )
      .toBe(true)
  }
  await settleHljs('.vditor-ir__preview')
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))

  const ir = (await frame
    .locator('body')
    .evaluate(
      (_b, s) =>
        new Function('sel', `return (${s})(sel)`)('.vditor-ir .vditor-reset'),
      METRICS,
    )) as any
  await frame.locator('body').evaluate(() => {
    const inst = (window as any).vditor
    const v = inst.vditor
    v.preview.element.style.display = 'block'
    v[inst.getCurrentMode()].element.parentElement.style.display = 'none'
    v.preview.render(v)
  })
  await expect(frame.locator('.vditor-preview code.hljs').first()).toBeVisible({
    timeout: 20_000,
  })
  await expect(
    frame.locator('.vditor-preview .katex-display').first(),
  ).toBeVisible({ timeout: 20_000 })
  await settleHljs('.vditor-preview') // same settle as the IR pane — both sides must be fully coloured
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3000)))

  const pv = (await frame
    .locator('body')
    .evaluate(
      (_b, s) =>
        new Function('sel', `return (${s})(sel)`)(
          '.vditor-preview .vditor-reset',
        ),
      METRICS,
    )) as any

  // The phantom-height bug made IR's code/diagram/math blocks ~58–72px TALLER than their Preview
  // render. Pair blocks by document order and assert no IR special block is taller than its Preview
  // counterpart (the bug's signature). We DON'T require exact equality both ways — PlantUML is
  // CSP-blocked (`object-src 'none'`), so its Preview render can be larger; that's environmental,
  // not an IR phantom. Headings are excluded (a pre-existing IR/Preview wrap difference, unrelated).

  const taller = []
  for (let i = 0; i < Math.min(ir.kids.length, pv.kids.length); i++) {
    const k = ir.kids[i]
    if (k.irType !== 'code-block' && k.irType !== 'math-block') continue
    if (k.h - pv.kids[i].h > 8)
      taller.push({ i, type: k.irType, ir: k.h, pv: pv.kids[i].h })
  }
  expect(taller, JSON.stringify(taller)).toEqual([])

  // Block-math: the formula sits the same distance below the preceding text in both modes.
  expect(ir.mathGap).not.toBeNull()
  expect(Math.abs(ir.mathGap - pv.mathGap)).toBeLessThanOrEqual(2)

  // Callouts: Preview styles `[!TYPE]` exactly like IR — same types, injected render, same height.
  expect(ir.callouts.length).toBeGreaterThan(3)
  expect(pv.callouts.map((c: { type: string }) => c.type)).toEqual(
    ir.callouts.map((c: { type: string }) => c.type),
  )
  expect(pv.callouts.every((c: { injected: boolean }) => c.injected)).toBe(true)
  const calloutOffenders = ir.callouts
    .map((c: { type: string; h: number }, k: number) => ({
      type: c.type,
      d: Math.abs(c.h - (pv.callouts[k]?.h ?? 0)),
    }))
    .filter((c: { d: number }) => c.d > 8)
  expect(calloutOffenders, JSON.stringify(calloutOffenders)).toEqual([])

  // Inline math stays inline (the block-collapse rule must not match `inline-node`).
  expect(ir.inlineMarkers.length).toBeGreaterThan(0)
  expect(ir.inlineMarkers.every((d: string) => d !== 'block')).toBe(true)
})
