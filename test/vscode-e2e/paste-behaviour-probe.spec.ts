import { stickySelection, wf } from './webview-helpers'
// @probe — measurement only, asserts nothing (task 449 convention).
//
// One probe serving four planned paste tasks, because they all share ONE hook point and each one's
// task file states a premise about current behaviour that nobody has re-measured:
//   242 (ANSI strip)      — do raw ESC bytes really survive a paste into the saved markdown?
//   218 (CSV/TSV → table) — what does pasting spreadsheet data actually produce today?
//   224 (URL over selection → link) — the task says "Vditor's paste path has no such branch", but
//                           reading vditor's source shows it DOES wrap a selection
//                           (`range.toString() !== "" && IsValidLinkDest`), and task 392 shipped the
//                           no-selection half. Measure before writing anything.
//   287 (Ctrl+Shift+V)    — does the chord even reach the webview, or does VS Code claim it?
//
// Real keystrokes and the real VS Code clipboard throughout: a synthetic ClipboardEvent proves
// nothing here, because every question is about what the REAL paste pipeline does (task 191's L2
// vs L3 lesson — synthetic clipboard events change getValue without driving Vditor's edit pipeline).
import path from 'node:path'
import { test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'paste-behaviour.md')

test('@probe what the paste pipeline does today', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(180_000)

  const writeClip = (text: string) =>
    evaluateInVSCode(
      async (vscode: typeof import('vscode'), args: string[]) => {
        await vscode.env.clipboard.writeText(args[0])
      },
      [text] as [string],
    )

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
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })

  const value = () =>
    frame
      .locator('body')
      .evaluate(
        () =>
          (
            window as unknown as { vditor?: { getValue(): string } }
          ).vditor?.getValue() ?? '',
      )

  // Put the caret just after `needle`, or SELECT `needle` when select=true.
  const place = (needle: string, select: boolean) =>
    stickySelection(
      frame, // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: in-page caret placement across text-node walk/needle-match/select branches; pre-existing (task 469 baseline)
      (_el, args) => {
        const { needle, select } = args as { needle: string; select: boolean }
        const p = [...document.querySelectorAll('.vditor-ir p')].find((x) =>
          x.textContent?.includes(needle),
        ) as HTMLElement | undefined
        if (!p) throw new Error(`anchor ${needle} not found`)
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const i = (n.textContent ?? '').indexOf(needle)
          if (i < 0) continue
          const r = document.createRange()
          if (select) {
            r.setStart(n as Text, i)
            r.setEnd(n as Text, i + needle.length)
          } else {
            r.setStart(n as Text, i + needle.length)
            r.collapse(true)
          }
          const s = window.getSelection()
          s?.removeAllRanges()
          s?.addRange(r)
          p.focus()
          return
        }
        throw new Error('anchor text node not found')
      },
      { needle, select },
    )

  const settle = (ms: number) =>
    frame
      .locator('body')
      .evaluate((_el, d) => new Promise((r) => setTimeout(r, d as number)), ms)

  const results: Record<string, unknown> = {}

  const leg = async (
    name: string,
    clip: string,
    needle: string,
    select: boolean,
    chord = 'Control+v',
  ) => {
    await writeClip(clip)
    await frame
      .locator('.vditor-ir')
      .first()
      .click({ position: { x: 4, y: 4 } })
    await place(needle, select)
    await workbox.keyboard.press(chord)
    await settle(1200)
    const v = await value()
    // The line the paste landed on, plus explicit escape-byte accounting — a raw ESC is invisible
    // in a JSON dump otherwise.
    const line =
      v.split('\n').find((l) => l.includes(needle) || l.includes('paste')) ?? ''
    results[name] = {
      line: line.slice(0, 160),
      hasEsc: v.includes('\x1b'),
      // biome-ignore lint/suspicious/noControlCharactersInRegex: counting escape bytes is what this probe measures
      escCount: (v.match(/\x1b/g) ?? []).length,
      hasPipeTable: /\|.*\|/.test(v),
      hasMdLink: /\[[^\]]+\]\([^)]+\)/.test(v),
    }
    // Undo so each leg starts from the same document.
    await workbox.keyboard.press('Control+z')
    await settle(800)
  }

  // 224 — a URL pasted OVER a selection. The task claims this produces a bare URL; vditor's source
  // says it wraps. Whichever it is, this settles it.
  await leg('224_url_over_selection', 'https://example.com', 'TARGET', true)

  // 224/392 — the same URL with nothing selected (392 shipped this half; confirm it still holds).
  await leg('392_url_collapsed_caret', 'https://example.com', 'CARET', false)

  // 242 — a terminal/log line carrying real SGR escape sequences.
  await leg(
    '242_ansi',
    '\x1b[31mred\x1b[0m and \x1b[1mbold\x1b[0m',
    'CARET',
    false,
  )

  // 218 — spreadsheet data: tab-separated, 3 columns x 3 rows.
  await leg('218_tsv', 'a\tb\tc\n1\t2\t3\n4\t5\t6', 'CARET', false)

  // 287 — does Ctrl+Shift+V reach the webview at all, or does VS Code claim the chord? Pasting a
  // URL makes the answer visible: if our smart-paste ran, it becomes a link; if the literal text
  // landed, it did not; if NOTHING changed, the chord never reached us.
  await leg(
    '287_ctrl_shift_v',
    'https://example.com',
    'CARET',
    false,
    'Control+Shift+v',
  )

  console.log('[paste-probe]', JSON.stringify(results, null, 2))
})
