import { settle, stickySelection, wf } from './webview-helpers'
// ADR-0007 / task 446 — the caret authority's real-VS-Code acceptance test: a programmatic caret
// SURVIVES a Vditor DOM rebuild instead of vanishing, and stays PAINTABLE throughout (not just
// "present" — task 439 shipped a Range that existed, was collapsed, at the right offset, and had a
// ZERO-HEIGHT client rect; three test layers passed against that build because none measured paint).
//
// The rebuild trigger here is deliberately NOT a keydown: decision 3 invalidates the live intent on
// ANY keydown, so a keyboard-driven re-spin would test the "user typed, caret follows" path, not
// "an intent survives a rebuild it didn't cause". caret-preserve.ts's `preserveCaretAndScroll` — the
// external-document-update path (git pull / another editor tab / a formatter; see doc-sync.spec.ts,
// which exercises the SAME mechanism but only asserts scroll, never caret paint) — is Vditor's most
// drastic rebuild: `setValue()` tears down and recreates every node. It runs from a host→webview
// `update` message, no keyboard event at all, so it is exactly the non-keyboard trigger this test
// needs, and it is the caret.ts `{ textOffset }` intent's one real production caller.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const SRC = path.join(__dirname, 'fixtures', 'caret-authority-rebuild.md')

// Everything that decides whether a caret is actually DRAWN, not just present in the DOM — the
// measurement task 439 was missing. A collapsed Range reports a zero-WIDTH but non-zero HEIGHT rect
// wherever a caret can be painted; height 0 means there is nowhere to draw one (caret-on-open.spec.ts
// / caret-empty-typing.spec.ts use the same signal).
const MEASURE = () => {
  const sel = window.getSelection()
  const r = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null
  const editor = (
    window as unknown as {
      vditor?: { vditor?: { ir?: { element?: HTMLElement } } }
    }
  ).vditor?.vditor?.ir?.element
  return {
    rangeCount: sel?.rangeCount ?? 0,
    collapsed: r?.collapsed ?? null,
    inAnchorParagraph: !!(
      r &&
      editor &&
      [...editor.querySelectorAll('p')]
        .find((p) => p.textContent?.includes('CARET-ANCHOR'))
        ?.contains(r.startContainer)
    ),
    startOffset: r?.startOffset ?? -1,
    caretHeight: r ? Math.round(r.getBoundingClientRect().height) : -1,
  }
}
type Measurement = ReturnType<typeof MEASURE>

test('a caret placed by caret.ts survives a full Vditor setValue() rebuild and stays paintable throughout', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  const tmp = path.join(tmpdir(), 'vmarkd-caret-authority-rebuild.md')
  writeFileSync(tmp, readFileSync(SRC, 'utf8'))

  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [tmp] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await settle(frame, 1000)

  // Place a real, focused caret mid-way through the anchor paragraph's text — a KNOWN offset this
  // test can check survived the rebuild. (Programmatic setup, not itself the thing under test: what
  // is under test is whether the SUBSEQUENT external edit's rebuild preserves it.)
  const setup = await stickySelection(
    frame,
    () => {
      const p = [...document.querySelectorAll('.vditor-ir p')].find((x) =>
        x.textContent?.includes('CARET-ANCHOR'),
      ) as HTMLElement | undefined
      const t = p?.firstChild as Text | null
      if (!t) return { ok: false }
      const r = document.createRange()
      r.setStart(t, 14) // inside "CARET-ANCHOR" — an offset with real text either side
      r.collapse(true)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
      p?.focus()
      return { ok: true }
    },
    null,
  )
  expect(setup.ok, 'the anchor paragraph and its text node were found').toBe(
    true,
  )

  const before = (await frame.locator('body').evaluate(MEASURE)) as Measurement
  expect(before.rangeCount, 'a Range exists before the rebuild').toBe(1)
  expect(before.inAnchorParagraph, 'caret is in the anchor paragraph').toBe(
    true,
  )
  expect(
    before.caretHeight,
    'the caret is paintable before the rebuild (sanity)',
  ).toBeGreaterThan(0)

  // The rebuild trigger: an EXTERNAL edit (a different paragraph — the caret's own line is
  // untouched, so the character offset should map identically in the fresh DOM). This is a
  // WorkspaceEdit the webview did not originate, exactly what a git pull / another editor tab / a
  // formatter looks like — no keyboard event anywhere in this path.
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      const doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.fsPath === args[0],
      )
      if (!doc) return
      const idx = doc
        .getText()
        .split('\n')
        .findIndex((l) => l.includes('EXTERNAL-TARGET'))
      const line = doc.lineAt(idx)
      const edit = new vscode.WorkspaceEdit()
      edit.replace(
        doc.uri,
        line.range,
        'EXTERNAL-TARGET rewritten from outside, forcing setValue()',
      )
      await vscode.workspace.applyEdit(edit)
    },
    [tmp] as [string],
  )

  // Sample repeatedly, not once — 439's bug was flash-then-vanish: a Range that existed and was
  // even briefly paintable, then wasn't. A single post-rebuild measurement would have missed it.
  const samples: Measurement[] = []
  for (const ms of [50, 300, 800, 1500]) {
    await settle(frame, ms === 50 ? 50 : 250)
    samples.push((await frame.locator('body').evaluate(MEASURE)) as Measurement)
  }
  // eslint-disable-next-line no-console
  console.log(`[caret-authority-rebuild] samples=${JSON.stringify(samples)}`)

  const rebuilt = await frame
    .locator('body')
    .evaluate(() =>
      (document.querySelector('.vditor-ir') as HTMLElement).innerText.includes(
        'rewritten from outside',
      ),
    )
  expect(
    rebuilt,
    'the external edit actually reached the webview (setValue ran)',
  ).toBe(true)

  for (const [i, m] of samples.entries()) {
    expect(
      m.rangeCount,
      `sample ${i}: a Range still exists after the rebuild`,
    ).toBe(1)
    expect(
      m.inAnchorParagraph,
      `sample ${i}: caret is still in the (freshly rebuilt) anchor paragraph`,
    ).toBe(true)
    expect(
      m.startOffset,
      `sample ${i}: caret is at the same character offset`,
    ).toBe(14)
    // THE assertion this test exists for: not merely present, but PAINTABLE — a zero-height Range
    // is exactly the invisible-caret regression task 439 shipped and this ADR closes structurally.
    expect(
      m.caretHeight,
      `sample ${i}: the caret survived the rebuild AND is paintable (not just present)`,
    ).toBeGreaterThan(0)
  }

  rmSync(tmp, { force: true })
})
