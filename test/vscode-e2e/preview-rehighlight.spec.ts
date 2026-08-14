import { wf } from './webview-helpers'
// NET (task 371) — code stays coloured across REPEATED Preview toggles.
//
// Reported as: "w preview blok kodu się nie koloruje ... po 2 kliknięciu w preview". The first
// Preview was coloured; every one after it was not.
//
// Vditor reads the language with `block.className.replace("language-", "")`, which assumes one class.
// True on the FIRST pass — but that pass then appends `hljs`, so a SECOND pass computes
// `"language-js hljs".replace("language-", "")` = "js hljs", no such language, falls back to
// plaintext, and re-renders the block with ZERO token spans.
//
// A second pass over the same element only became reachable with the task-187 preview morph: before
// it, each render replaced the pane via innerHTML so highlightRender always met a fresh
// `<code class="language-js">`. Measured here: the code element is the SAME DOM node across toggles.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings } from './settings-helpers'

// The fixture is the one that EMPIRICALLY reproduces, and the choice is load-bearing: verified by
// mutation, the bug does NOT surface on `all-renderers.md` (too much engine churn — the morph falls
// back to a full innerHTML set, so every block is rebuilt fresh and re-highlighted from a clean
// class list) NOR on a plain diagram-free document. Do not "simplify" this fixture without
// re-running the mutation check, or the spec silently stops testing anything.
const FIXTURE = path.join(__dirname, 'fixtures', 'preview-rehighlight.md')

// Token spans are the real signal: the `.hljs` CLASS survives the bug, the colouring does not.
const READ = `(() => {
  const pv = window.vditor.vditor.preview.previewElement
  // Self-selecting: '.hljs' is exactly the set highlightRender processed, so this can never
  // accidentally assert on a diagram host or an unknown language.
  return Array.from(pv.querySelectorAll('pre > code.hljs'))
    .slice(0, 3)
    .map((c) => ({
      lang: (c.className.match(/language-([^ ]+)/) || [])[1] || '?',
      spans: c.querySelectorAll('span').length,
    }))
})()`

const TOGGLE = `(() => {
  const el = window.vditor.vditor.toolbar.elements['preview']
  const btn = el && (el.querySelector('button') || el.children[0])
  if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})()`

// task 451: was a blind 8000ms sleep after `.vditor-ir` first appeared. `preview.render()` fires
// `highlightRender` through a `addScript(...).then(() => addScript(...).then(() => {...})))` chain
// (vditor's own highlightRender.ts) even when the scripts are already loaded, so "the class got
// stamped" is never available on the same tick — poll for the two things the toggle loop actually
// needs settled in IR before it starts: the real code block hljs-highlighted (`code-source.ts`
// stamps `.hljs` on the IR marker's own `<code>`, no separate preview render there) and the d2
// fence rendered to an svg (its own async compile+layout — a real floor, per this task's own rule,
// so poll for the render marker rather than guess a shorter fixed delay).
const IR_SETTLED = `(() => {
  const ir = document.querySelector('.vditor-ir')
  if (!ir) return false
  const jsHljs = ir.querySelector('pre > code.hljs')
  const d2Svg = ir.querySelector('.language-d2 svg')
  return !!jsHljs && !!d2Svg
})()`

// task 451: was a blind 5000ms sleep after each toggle INTO Preview. Two independent async
// pipelines race here: highlightRender's script-load chain (above) and the custom-diagram
// scheduler's `findBlocks` (`diagram-kit/diagram-dom.ts`), which swaps the d2 fence's `<code>` for
// a `<div>` — DROPPING it out of the `pre > code` selector entirely, and only fires after a
// MutationObserver + `requestAnimationFrame`, so it does not land on the same tick as the preview
// HTML being set either. Reading `pre > code.hljs` before that swap lands would transiently match
// BOTH the js block and the still-`<code>` d2 block, an ORDER/COUNT-dependent false read the fixed
// sleep only avoided by outlasting it. Poll for the STRUCTURAL end state instead — exactly one
// `pre > code` left (the real js block) and it carries `.hljs` — not the span COUNT the assertion
// below actually checks: `block.classList.add("hljs")` runs unconditionally in vditor's
// highlightRender regardless of whether real language tokens were found, so this poll target
// cannot itself go true on the very regression (0 spans) this test exists to catch — it only
// confirms the pane finished mutating, and the hard assertions below do the real check.
const PREVIEW_SETTLED = `(() => {
  const pv = window.vditor.vditor.preview.previewElement
  const codeBlocks = pv.querySelectorAll('pre > code')
  return codeBlocks.length === 1 && codeBlocks[0].classList.contains('hljs')
})()`

// task 451: was a blind 3000ms sleep after each toggle BACK to edit. Nothing async happens on this
// path (`Preview.ts`'s toggle handler flips `style.display` and calls `outline.render` synchronously)
// — poll for the edit pane's own display flip, the one thing the NEXT toggle-to-Preview click
// depends on, instead of a fixed margin (block-fidelity, same task, found that skipping a settle
// wait before a toolbar click can turn it into a LOST click if the toolbar isn't ready yet — this
// poll is what makes sure it is).
const EDIT_SETTLED = `(() => {
  const v = window.vditor.vditor
  return v.preview.element.style.display === 'none'
})()`

usePinnedSettings(test, {
  'vmarkd.theme.content': 'auto',
})

test('code stays highlighted after repeated IR -> Preview toggles', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(300_000)
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
  await expect
    .poll(() => frame.locator('body').evaluate(IR_SETTLED), {
      message: 'IR finished highlighting its code block and rendering d2',
    })
    .toBe(true)

  type Blk = { lang: string; spans: number }
  let first: Blk[] = []
  // THREE visits: the bug needs the second and only shows on a re-render of a SURVIVING element.
  for (let visit = 1; visit <= 3; visit++) {
    await frame.locator('body').evaluate(TOGGLE) // -> Preview
    await expect
      .poll(() => frame.locator('body').evaluate(PREVIEW_SETTLED), {
        message: `Preview settled on visit ${visit} (highlighted + d2 swapped)`,
      })
      .toBe(true)
    const blocks = (await frame.locator('body').evaluate(READ)) as Blk[]
    if (visit === 1) {
      // Never let an empty pane pass as "everything matched".
      // One block is enough and is what this fixture has — the guard exists so an EMPTY pane can
      // never pass as "nothing changed".
      expect(
        blocks.length,
        'no highlightable code blocks found in Preview',
      ).toBeGreaterThan(0)
      for (const b of blocks)
        expect(
          b.spans,
          `${b.lang} was not highlighted on the FIRST visit`,
        ).toBeGreaterThan(0)
      first = blocks
    } else {
      expect(blocks, `highlighting changed on Preview visit ${visit}`).toEqual(
        first,
      )
    }
    await frame.locator('body').evaluate(TOGGLE) // -> back to edit
    await expect
      .poll(() => frame.locator('body').evaluate(EDIT_SETTLED), {
        message: `edit pane visible again after visit ${visit}`,
      })
      .toBe(true)
  }
})
