import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

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

function webviewFrame(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

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

  const frame = webviewFrame(workbox)
  await expect(
    frame.locator('.vditor-ir__node[data-type="code-block"]').first(),
  ).toBeVisible({ timeout: 45_000 })
  await expect(
    frame.locator('.vditor-ir__preview code.hljs').first(),
  ).toBeVisible({ timeout: 20_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))

  // biome-ignore lint/suspicious/noExplicitAny: cross-mode metric blob.
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
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3000)))

  // biome-ignore lint/suspicious/noExplicitAny: cross-mode metric blob.
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
