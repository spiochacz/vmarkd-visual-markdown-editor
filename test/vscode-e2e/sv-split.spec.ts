import { stickySelection, wf } from './webview-helpers'
// sv (split view) mode polish — task 187. Real-VS-Code-only: mode switching drives the
// real toolbar + custom-editor pipeline, and the assertions cover behaviour the harness
// can't reproduce (custom renderers in the split preview, the preview morph across an
// edit settle, scroll hand-off between panes, the editorMode host report).
//
// Scroller gotcha (cost a debugging session): in the real webview the `.vditor-ir`
// WRAPPER is overflow:hidden — the inner `pre.vditor-reset` is the scroll container.
// Scrolling the wrapper silently clamps to 0 (no event, no anchor). Every scroll here
// targets the pane's true scroller and VERIFIES the write stuck.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

// The edit-mode dropdown panel is display:none until hover — playwright can't click
// its buttons, so dispatch the event straight at the listener.
async function switchMode(
  frame: ReturnType<typeof wf>,
  mode: 'ir' | 'wysiwyg' | 'sv',
) {
  await frame.locator('body').evaluate((_b, m) => {
    document
      .querySelector(`.vditor-toolbar button[data-mode="${m}"]`)!
      .dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      )
  }, mode)
}

test('sv split: renders the battery, morph keeps diagram DOM, scroll + mode report', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(240_000)
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
  await frame
    .locator('.vditor-ir .language-d2 svg')
    .first()
    .waitFor({ timeout: 60_000 })
  // task 512: leave — this file is SMOKE-tier (runs every PR), treated as the most conservative
  // of the batch. This settle lets the whole engine battery (mermaid, wavedrom, callouts, not just
  // the one d2 svg waited for above) finish its first render before the scroll-and-verify block
  // below runs, so `pre.scrollHeight` reflects the FINAL document height when we set `scrollTop =
  // 600` — scrolling into a still-growing document is a real (if narrow) risk this settle guards
  // against. Borderline convertible (a `scrollHeight - clientHeight` floor is nameable), but the
  // brief's own instruction for this file is to leave anything borderline rather than risk the PR
  // gate for ~1.1s.
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  // Scroll the IR pane's TRUE scroller (a real scroll event → the preserve module
  // snapshots the anchor). Verify the write stuck — a clamped write means we scrolled
  // the wrong element and the rest of the test would silently assert nothing.
  const irScrollSet = await frame.locator('body').evaluate(async () => {
    const pre = document.querySelector(
      '.vditor-ir pre.vditor-reset',
    ) as HTMLElement
    const wrapper = pre.closest('.vditor-ir') as HTMLElement
    const scroller = [pre, wrapper].find((el) => {
      el.scrollTop = 600
      return el.scrollTop > 0
    })
    // task 512: leave — ≤1s (rule: not worth the flake risk alone), and it runs inside the
    // browser-context evaluate() rather than top-level test code, so converting it would mean
    // polling an internal module state (the preserve module's anchor snapshot) from inside the
    // page rather than the ordinary expect.poll pattern — real effort for under a second saved.
    await new Promise((r) => setTimeout(r, 400)) // scroll event + rAF snapshot
    return scroller
      ? { cls: scroller.className, top: scroller.scrollTop }
      : null
  })
  console.log(`[sv-split] irScrollSet=${JSON.stringify(irScrollSet)}`)
  expect(irScrollSet?.top ?? 0).toBeGreaterThan(400)

  await switchMode(frame, 'sv')
  // preview delay (500) + engine passes + the source-pane pin (EDIT_PIN_MS 400).
  // task 512: leave — the tempting one (6s is the biggest single sleep in this file), but it
  // gates a WHOLE engine battery landing at once (d2, d2's embedded markdown foreignObject,
  // mermaid, wavedrom, callouts — 5 independent async render pipelines read by the `sv` object
  // below), plus the sv-mode toolbar click is the same pre-mode-switch-click shape `block-fidelity`
  // (task 451) had to revert after a poll-based fix passed solo and still flaked in the FAST tier.
  // A composite poll ("all 5 counts nonzero") would resolve the instant the SLOWEST-to-settle
  // engine first crosses its own threshold — but the very next block (the morph probe) depends on
  // the battery being fully QUIESCENT, not just first-true: if the poll resolves while another
  // engine pass is still in flight, the morph's `markSurvived` check races a still-moving preview.
  // Leaving this sleep is what keeps that downstream check meaningful.
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 6000)))

  const sv = await frame.locator('body').evaluate(() => {
    const pv = document.querySelector('.vditor-preview') as HTMLElement
    const svEl = document.querySelector('.vditor-sv') as HTMLElement
    const pvCount = (s: string) => pv.querySelectorAll(s).length
    return {
      mode: (
        window as { vditor?: { getCurrentMode(): string } }
      ).vditor?.getCurrentMode(),
      svDisplay: getComputedStyle(svEl).display,
      pvDisplay: getComputedStyle(pv).display,
      // engine battery in the split preview
      d2: pvCount('.language-d2 svg'),
      d2md: pvCount('.language-d2 svg foreignObject .vmarkd-d2-md'),
      mermaid: pvCount('.language-mermaid svg'),
      wavedromLive: [...pv.querySelectorAll('.language-wavedrom')].filter(
        (el) => el.getBoundingClientRect().height > 10,
      ).length,
      callouts: pvCount('blockquote[data-callout] .vmarkd-callout__preview'),
      // task 187 P2a: the source pane must land at the anchor, not at 0
      svScrollTop: svEl.scrollTop,
    }
  })
  console.log(`[sv-split] ${JSON.stringify(sv)}`)

  expect(sv.mode).toBe('sv')
  expect(sv.svDisplay).toBe('block')
  expect(sv.pvDisplay).toBe('block')
  expect(sv.d2).toBeGreaterThan(0)
  expect(sv.d2md).toBeGreaterThan(0)
  expect(sv.mermaid).toBeGreaterThan(0)
  expect(sv.wavedromLive).toBeGreaterThanOrEqual(4)
  expect(sv.callouts).toBeGreaterThan(0)
  expect(sv.svScrollTop).toBeGreaterThan(50) // was 0 before the source-pane pin

  // task 187 P2c: the webview reported sv and the HOST recorded it (end-to-end,
  // via the activate() test API — the status-bar label reads this same map).
  const hostMode = await evaluateInVSCode(
    (vscode, args) => {
      const [uri] = args as [string]
      const api = vscode.extensions.getExtension('spiochacz.vmarkd')?.exports as
        | { webviewEditorMode: Map<string, string> }
        | undefined
      return api?.webviewEditorMode.get(vscode.Uri.file(uri).toString())
    },
    [FIXTURE] as [string],
  )
  expect(hostMode).toBe('sv')

  // ── morph (task 187 P1b): an edit settle must NOT re-mount unchanged diagrams ──
  const morph = await stickySelection(
    frame,
    async () => {
      const pv = document.querySelector('.vditor-preview') as HTMLElement
      const mark = pv.querySelector('.language-mermaid svg, .language-d2 svg')!
      mark.setAttribute('data-probe-mark', '1')
      const svEl = document.querySelector('.vditor-sv') as HTMLElement
      svEl.focus()
      const r = document.createRange()
      r.selectNodeContents(svEl)
      r.collapse(true)
      const sel = getSelection()!
      sel.removeAllRanges()
      sel.addRange(r)
      document.execCommand('insertText', false, 'Z')
      // preview delay 500 + morph + engine pass
      // task 512: leave — rule 2 outright. `markSurvived` exists to prove a DELAYED teardown (morph
      // runs, THEN a later engine pass tears the unchanged mark off) does NOT happen. A poll on
      // `typedVisible` would resolve the instant the edit lands, before the delayed engine pass had
      // any chance to run — deleting exactly the regression coverage this settle provides.
      await new Promise((res) => setTimeout(res, 3000))
      return {
        markSurvived: !!pv.querySelector('[data-probe-mark]'),
        typedVisible: (pv.textContent ?? '').includes('Z#'),
        d2StillThere: pv.querySelectorAll('.language-d2 svg').length,
      }
    },
    null,
  )
  console.log(`[sv-morph] ${JSON.stringify(morph)}`)
  expect(morph.typedVisible).toBe(true) // the edit DID re-render its block
  expect(morph.markSurvived).toBe(true) // …without tearing the unchanged diagram down
  expect(morph.d2StillThere).toBeGreaterThan(0)

  // ── back to IR: the editor returns to (near) where it was, not to the top ──
  await frame.locator('body').evaluate(async () => {
    // Scroll the source (fires the split sync + preview-anchor snapshot).
    const svEl = document.querySelector('.vditor-sv') as HTMLElement
    svEl.scrollTop = 700
    // task 512: leave — ≤1s (rule: not worth the flake risk alone).
    await new Promise((r) => setTimeout(r, 600))
  })
  await switchMode(frame, 'ir')
  // task 512: leave — this is a POST-mode-switch-click settle (same family as `block-fidelity`'s
  // reverted pre-click settle, task 451): the click fires `setEditMode`, whose actual completion
  // is the unidentified mechanism that investigation traced and gave up on. This file is
  // SMOKE-tier; not worth re-litigating that open question here for ~1.1s.
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))
  const back = await frame.locator('body').evaluate(() => {
    const pre = document.querySelector(
      '.vditor-ir pre.vditor-reset',
    ) as HTMLElement
    const wrapper = pre.closest('.vditor-ir') as HTMLElement
    return {
      irScrollTop: Math.max(pre.scrollTop, wrapper.scrollTop),
      mode: (
        window as { vditor?: { getCurrentMode(): string } }
      ).vditor?.getCurrentMode(),
    }
  })
  console.log(`[sv-back] ${JSON.stringify(back)}`)
  expect(back.mode).toBe('ir')
  expect(back.irScrollTop).toBeGreaterThan(100) // was 0 (top) before task 187
})
