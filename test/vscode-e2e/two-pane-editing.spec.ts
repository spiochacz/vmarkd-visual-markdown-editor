import { docText, settle, wf } from './webview-helpers'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Journey A3 (tasks/516-qa-journey-coverage-plan.md, Phase 1) — same document, two panes.
// Two independent sub-journeys, each its own test() (boot cost is per test(), and the two
// setups diverge enough — closeAllEditors+reopen vs. open+openSourceToSide+dual-surface
// edits — that sharing a boot would make failures harder to attribute):
//
// (a) tab dedup — src/platform/tab-targeting.ts's findTabForUri is what makes
//     `vmarkd.openEditor` REVEAL an existing vMarkd tab instead of opening a duplicate
//     (task 36's own comment). Only unit-tested against a mocked tabGroups
//     (test/backend/commands-and-handlers.test.ts) before this file.
// (b) vMarkd + a plain text editor open on the SAME file, side by side, edited
//     alternately — the highest-risk half: two live editors sharing one TextDocument
//     through our writeback controller + doc-sync push (src/writeback/doc-sync.ts).
const SRC = path.join(__dirname, 'fixtures', 'save-fidelity.md')
// Blocks neither surface ever touches — must survive both edits + the save byte-for-byte.
const UNTOUCHED = [
  'Intro paragraph that stays byte-for-byte unchanged.',
  '## Section B',
  '- Second item',
  '| Alpha | 1 |',
  'const answer = 42',
  'Closing paragraph unchanged.',
]

type Vs = typeof import('vscode')
type EvalInVSCode = (fn: unknown, args: unknown) => Promise<unknown>

async function openVmarkd(evaluateInVSCode: EvalInVSCode, tmp: string) {
  await evaluateInVSCode(
    async (vscode: Vs, args: [string]) => {
      // Close any editor left over from a previous test/repeat FIRST — reopening the same
      // tmp path while a stale tab is still open reveals the OLD buffer instead of the
      // freshly-written file (same discipline as checkbox-toggle.spec.ts /
      // autosave-writeback.spec.ts).
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [tmp] as [string],
  )
}

async function tabCountForUri(
  evaluateInVSCode: EvalInVSCode,
  tmp: string,
  viewType: 'vmarkd.editor',
): Promise<number> {
  return evaluateInVSCode(
    async (vscode: Vs, args: [string, string]) =>
      vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .filter((t) => {
          const input = t.input
          return (
            input instanceof vscode.TabInputCustom &&
            input.viewType === args[1] &&
            input.uri.fsPath === args[0]
          )
        }).length,
    [tmp, viewType] as [string, string],
  ) as Promise<number>
}

test('opening the same file with vMarkd a second time reveals the existing tab instead of duplicating it', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(60_000)
  const tmp = path.join(tmpdir(), 'vmarkd-tab-dedup.md')
  const other = path.join(tmpdir(), 'vmarkd-tab-dedup-other.md')
  writeFileSync(tmp, readFileSync(SRC, 'utf8'))
  writeFileSync(other, '# a second file in another column\n')

  try {
    await openVmarkd(evaluateInVSCode, tmp)
    const frame = wf(workbox)
    await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
    await settle(frame, 1000)

    expect(
      await tabCountForUri(evaluateInVSCode, tmp, 'vmarkd.editor'),
      'exactly one vMarkd tab after the first open',
    ).toBe(1)
    const iframesBefore = await workbox.locator('iframe.webview').count()

    // Move focus to a SECOND, unrelated file in a DIFFERENT editor group first — this is the
    // scenario findTabForUri's own comment (task 36) actually guards: without it, `vscode.
    // openWith` (called with no explicit viewColumn) opens in the CURRENTLY ACTIVE column, and
    // if that active column has no tab for this URI+viewType yet, VS Code creates a fresh one
    // there rather than jumping back to the existing tab in the first column. A same-column
    // re-invoke (tried first while writing this spec) passes even with findTabForUri broken,
    // because VS Code's own singleton-per-column behaviour already reveals it there — this
    // setup is the one that actually exercises the dedup logic.
    await evaluateInVSCode(
      async (vscode: Vs, args: [string]) => {
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(args[0]),
          'default',
          vscode.ViewColumn.Beside,
        )
      },
      [other] as [string],
    )
    await settle(frame, 500)

    // Invoke the dedup-aware command on the ORIGINAL file from this second-column context — the
    // mechanism under test (findTabForUri) is what decides whether this reveals the tab back in
    // column 1 or opens a duplicate in column 2 (the now-active column).
    await evaluateInVSCode(
      async (vscode: Vs, args: [string]) => {
        await vscode.commands.executeCommand(
          'vmarkd.openEditor',
          vscode.Uri.file(args[0]),
        )
      },
      [tmp] as [string],
    )
    await settle(frame, 1000)

    expect(
      await tabCountForUri(evaluateInVSCode, tmp, 'vmarkd.editor'),
      'still exactly one vMarkd tab after re-invoking openEditor from another column',
    ).toBe(1)
    const iframesAfter = await workbox.locator('iframe.webview').count()
    expect(
      iframesAfter,
      'no second webview iframe was created for the same file',
    ).toBe(iframesBefore)
  } finally {
    rmSync(tmp, { force: true })
    rmSync(other, { force: true })
  }
})

test('vMarkd and a plain text editor on the same file converge on save, with no duplicated/lost content', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  const before = readFileSync(SRC, 'utf8')
  const tmp = path.join(tmpdir(), 'vmarkd-two-pane.md')
  writeFileSync(tmp, before)
  const TEXT_EDIT_MARKER = 'TEXTEDITORXYZ'
  const WEBVIEW_EDIT_MARKER = 'WEBVIEWXYZ'

  try {
    await openVmarkd(evaluateInVSCode, tmp)
    const frame = wf(workbox)
    await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
    await settle(frame, 1500)

    // Open the SAME file's plain-text source beside the webview (vmarkd.openSourceToSide —
    // reveal-caret.ts ends in vscode.window.showTextDocument, which focuses the new editor).
    await evaluateInVSCode(
      async (vscode: Vs, args: [string]) => {
        await vscode.commands.executeCommand(
          'vmarkd.openSourceToSide',
          vscode.Uri.file(args[0]),
        )
      },
      [tmp] as [string],
    )
    await settle(frame, 800)

    // Confirm both tabs are really open, in different columns — the setup this journey is
    // meant to exercise, not just one editor replacing the other.
    const tabsInfo = (await evaluateInVSCode(
      async (vscode: Vs, args: [string]) =>
        vscode.window.tabGroups.all
          .flatMap((g) =>
            g.tabs.map((t) => {
              const input = t.input
              if (
                input instanceof vscode.TabInputCustom &&
                input.uri.fsPath === args[0]
              ) {
                return { kind: 'custom', column: g.viewColumn }
              }
              if (
                input instanceof vscode.TabInputText &&
                input.uri.fsPath === args[0]
              ) {
                return { kind: 'text', column: g.viewColumn }
              }
              return undefined
            }),
          )
          .filter(
            (x): x is { kind: string; column: number } => x !== undefined,
          ),
      [tmp] as [string],
    )) as Array<{ kind: string; column: number }>
    expect(tabsInfo.map((t) => t.kind).sort()).toEqual(['custom', 'text'])
    expect(
      tabsInfo[0]?.column,
      'the two tabs are in different editor groups',
    ).not.toBe(tabsInfo[1]?.column)

    // 1. Type in the TEXT editor. A host-driven `TextEditor.edit()` — the active editor after
    // openSourceToSide is the side text editor — produces the exact same
    // TextDocumentContentChangeEvent + onDidChangeTextDocument our extension listens to as a
    // real keystroke would; the mechanism under test (doc-sync's document→webview push) does
    // not distinguish the two.
    await evaluateInVSCode(
      async (vscode: Vs, args: [string, string]) => {
        const [file, marker] = args
        const editor = vscode.window.activeTextEditor
        if (!editor || editor.document.uri.fsPath !== file) {
          throw new Error(
            `expected the side text editor to be active, got ${editor?.document.uri.fsPath}`,
          )
        }
        const doc = editor.document
        const lastLine = doc.lineAt(doc.lineCount - 1)
        await editor.edit((e) =>
          e.insert(lastLine.range.end, `\n\n${marker}\n`),
        )
      },
      [tmp, TEXT_EDIT_MARKER] as [string, string],
    )

    // The webview must reflect the text-editor edit (doc-sync's push).
    await expect
      .poll(
        () =>
          frame
            .locator('body')
            .evaluate(
              (_el, marker) =>
                document.body.textContent?.includes(marker as string) ?? false,
              TEXT_EDIT_MARKER,
            ),
        { timeout: 15_000, intervals: [300, 500, 800, 1200] },
      )
      .toBe(true)

    // 2. Type in the WEBVIEW — same click+range pattern as save-fidelity.spec.ts /
    // autosave-writeback.spec.ts.
    await frame
      .locator('.vditor-ir')
      .first()
      .click({ position: { x: 4, y: 4 } })
    await frame.locator('body').evaluate(() => {
      const p = Array.from(
        document.querySelectorAll('.vditor-ir p, .vditor-ir li, .vditor-ir h1'),
      ).find((x) => x.textContent?.includes('Edit here')) as
        | HTMLElement
        | undefined
      const t = p?.lastChild as Text | null
      if (!t) throw new Error('edit target not found')
      const r = document.createRange()
      r.setStart(t, (t.textContent ?? '').length)
      r.collapse(true)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
      p?.focus()
    })
    await workbox.keyboard.type(WEBVIEW_EDIT_MARKER, { delay: 40 })

    // The TextDocument (read on the host, the authority) must reflect the webview edit.
    await expect
      .poll(
        async () =>
          (await docText(evaluateInVSCode, tmp)).includes(WEBVIEW_EDIT_MARKER),
        { timeout: 15_000, intervals: [300, 500, 800, 1200] },
      )
      .toBe(true)

    // 3. Save through the real command, then read the bytes back off disk.
    await evaluateInVSCode(
      async (vscode: Vs) => {
        await vscode.commands.executeCommand('workbench.action.files.save')
      },
      [] as unknown as [string],
    )
    await settle(frame, 1000)

    const after = readFileSync(tmp, 'utf8')
    console.log(
      `[two-pane-editing] beforeLen=${before.length} afterLen=${after.length} ` +
        `hasTextEditorMarker=${after.includes(TEXT_EDIT_MARKER)} hasWebviewMarker=${after.includes(WEBVIEW_EDIT_MARKER)}`,
    )

    // Both edits landed…
    expect(
      after.includes(TEXT_EDIT_MARKER),
      'the text-editor edit reached disk',
    ).toBe(true)
    expect(
      after.includes(WEBVIEW_EDIT_MARKER),
      'the webview edit reached disk',
    ).toBe(true)
    // …exactly once each — no duplication from the round trip between the two surfaces.
    const occurrences = (haystack: string, needle: string) =>
      haystack.split(needle).length - 1
    expect(
      occurrences(after, TEXT_EDIT_MARKER),
      'the text-editor marker was not duplicated',
    ).toBe(1)
    expect(
      occurrences(after, WEBVIEW_EDIT_MARKER),
      'the webview marker was not duplicated',
    ).toBe(1)
    // …and every untouched block survived both edits.
    for (const anchor of UNTOUCHED) {
      expect(
        after.includes(anchor),
        `untouched block preserved across both surfaces: ${anchor}`,
      ).toBe(true)
    }

    // No divergence left between the two surfaces: the TextDocument's own text must match the
    // saved bytes exactly (no feedback loop still mid-flight).
    const finalDocText = await docText(evaluateInVSCode, tmp)
    expect(
      finalDocText,
      'the TextDocument and the saved disk bytes must match exactly',
    ).toBe(after)
  } finally {
    rmSync(tmp, { force: true })
  }
})
