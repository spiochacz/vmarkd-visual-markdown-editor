import { wf } from './webview-helpers'
// NET (task 363) — a content-theme switch that lands DURING the first diagram render must not
// destroy the diagram.
//
// The live re-theme re-renders these mono engines in place: clear the node, call the renderer again.
// That is safe once a render has FINISHED, because the patched renderers stamp the source into
// `data-code` as they draw. A flip arriving before that found the source only in `textContent` and
// `innerHTML = ''` deleted it — the re-render then had nothing to draw from and the diagram stayed
// permanently empty: no svg, no error box, no source text, no recovery even after two minutes.
//
// It showed up on graphviz (Viz.js WASM) and plantuml (TeaVM) purely because they are the slowest
// and therefore the ones wide enough to be caught mid-render.
//
// So this spec deliberately flips the theme IMMEDIATELY AFTER `openWith`, which is the ordering
// every other spec had to work around. Do not "fix" it by moving the update before the open — that
// is exactly the bug being guarded.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

// Flips vmarkd.theme.content mid-render (deliberately, see header comment) so this can't be pinned.
useSettingsRestore(test, ['vmarkd.theme.content'])

// The mono engines the live re-theme re-renders in place.
const LANGS = ['graphviz', 'plantuml', 'abc']

const STATE = `((langs) => {
  const v = window.vditor
  const root = v.vditor[v.getCurrentMode()].element
  const out = {}
  for (const lang of langs) {
    out[lang] = Array.from(root.querySelectorAll('.language-' + lang))
      .filter((el) => !el.closest('.vditor-ir__marker--pre, .vditor-wysiwyg__pre'))
      .map((el) => ({
        drawn: !!el.querySelector('svg'),
        // An error box still counts as "not silently blank" — the failure being guarded leaves
        // absolutely nothing behind.
        errored: !!el.querySelector('.vmarkd-diagram-error'),
        empty: el.innerHTML.trim() === '',
        chars: el.textContent.trim().length,
      }))
  }
  return out
})(${JSON.stringify(LANGS)})`

test('flipping the content theme mid-render does not blank a slow diagram', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(240_000)
  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.workspace
      .getConfiguration('vmarkd')
      .update('theme.content', 'auto', vscode.ConfigurationTarget.Global)
  })
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

  // The whole point: flip while the slow engines are still working. Deliberately NOT waiting for
  // them to settle first.
  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.workspace
      .getConfiguration('vmarkd')
      .update(
        'theme.content',
        'github-light',
        vscode.ConfigurationTarget.Global,
      )
  })

  // Generous: the engines are slow and a re-theme queues another pass behind them.
  // task 451: leave. Task 451's own Rules section names this file as "largely this shape" — the
  // whole point (see the comment above) is flipping WHILE mid-render and then confirming nothing
  // is left broken/stuck once every queued pass has had time to finish; there's no single "done"
  // marker to poll for across N engines each possibly mid-first-render-then-requeued-re-render, and
  // a poll that returns as soon as ONE block looks drawn would defeat the "queued pass behind them"
  // case this guards.
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 45_000)))

  const state = (await frame.locator('body').evaluate(STATE)) as Record<
    string,
    { drawn: boolean; errored: boolean; empty: boolean; chars: number }[]
  >

  const problems: string[] = []
  let checked = 0
  for (const lang of LANGS) {
    const blocks = state[lang] ?? []
    if (!blocks.length) {
      problems.push(`${lang}: no block found at all`)
      continue
    }
    blocks.forEach((b, i) => {
      checked++
      // Blank means blank: no svg, no error box, not even the source text left behind.
      if (!b.drawn && !b.errored && (b.empty || b.chars === 0))
        problems.push(`${lang}#${i}: permanently blank after the flip`)
    })
  }
  expect(checked, 'no mono-engine blocks were checked').toBeGreaterThan(2)
  expect(
    problems,
    'a diagram was destroyed by the mid-render theme flip',
  ).toEqual([])
  // Cleanup is handled by the `useSettingsRestore` afterEach above.
})
