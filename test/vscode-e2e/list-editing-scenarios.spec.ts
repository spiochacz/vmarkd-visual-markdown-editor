import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
// REGRESSION (task 525) — list editing corner cases in the REAL webview, IR and WYSIWYG. The full
// scenario net (every case, both modes, seconds per run) is media-src/e2e/list-scenarios.spec.ts; this
// spec repeats one representative per finding through the real keydown pipeline (VS Code keybindings,
// the patched Vditor bundle, finish-init's real wiring) so a harness-only pass can't hide a gap.
//
// One test per mode (boot cost is per test(), task 448): each scenario resets the document with
// vditor.setValue(md, true) — the `true` also clears the undo stack, so an undo scenario can't
// reach back into the previous scenario's edits. The scenarios are independent without a reboot. expect.soft collects every
// failing scenario in one run instead of stopping at the first.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings } from './settings-helpers'
import { settle, wf } from './webview-helpers'

type Scenario = {
  name: string
  md: string
  steps: string[]
  expected: string | RegExp
}

const SCENARIOS: Scenario[] = [
  {
    name: '#2 Backspace on the empty item after a sublist → end of the last sub-item',
    md: '1. one\n2. two\n   - aaa\n   - bbb\n3. three\n',
    steps: ['@Backspace*6', 'X'],
    expected: '1. one\n2. two\n   - aaa\n   - bbbX\n',
  },
  {
    name: '#3 empty item: Enter, Backspace, type continues the previous item',
    md: '1. one\n2. two\n   - aaa\n',
    steps: ['@Enter', '@Backspace', 'X'],
    expected: '1. one\n2. two\n   - aaaX\n',
  },
  {
    name: '#1 lifting an item after a sublist keeps the items after it',
    md: '1. one\n   - aaa\n2. two\n3. three\n',
    steps: ['@ArrowUp', '@Home', '@Backspace', 'X'],
    expected: /^1\. one\n {3}- aaa\n\nXtwo\n\n\d+\. three\n$/,
  },
  {
    name: '#4 outdent by Backspace shows the right number',
    md: '1. one\n2. two\n   - aaa\n   - bbb\n',
    steps: ['@Home', '@Backspace'],
    expected: '1. one\n2. two\n   - aaa\n3. bbb\n',
  },
  {
    // Human-paced: after End + a pause the range is empty but not `collapsed` (see list-backspace.ts).
    name: '#6 Tab at the end of an item indents it',
    md: '1. one\n2. two\n3. three\n',
    steps: ['~400', '@ArrowUp', '~400', '@End', '~400', '@Tab', 'X'],
    expected: '1. one\n   1. twoX\n2. three\n',
  },
  {
    name: '#5 typing "- " in an empty nested ordered item makes it a bullet',
    md: '1. one\n2. two\n',
    steps: ['@Enter', '@Tab', '- aaa', '@Enter', 'bbb'],
    expected: '1. one\n2. two\n   - aaa\n   - bbb\n',
  },
  {
    name: '#7 Enter at the end of an item with a sublist adds a first sub-item',
    md: '1. one\n   - aaa\n2. two\n',
    steps: ['@ArrowUp', '@ArrowUp', '@End', '@Enter', 'X'],
    expected: '1. one\n   - X\n   - aaa\n2. two\n',
  },
  // Each new operation is ONE undo step through VS Code's real Ctrl+Z keybinding. The 1200 ms pauses
  // outlast Vditor's 800 ms undoDelay debounce: the baseline after setValue and the operation's own
  // snapshot are both recorded on that debounce, and an edit before it has nothing to undo back to.
  {
    name: 'undo restores the empty item Backspace removed',
    md: '1. one\n2. two\n   - aaa\n   - bbb\n3.\n',
    steps: ['~1200', '@Backspace', '~1200', '@Control+z'],
    expected: '1. one\n2. two\n   - aaa\n   - bbb\n3.\n',
  },
  {
    name: 'undo restores an item lifted to a paragraph',
    md: '1. one\n   - aaa\n2. two\n3. three\n',
    steps: ['~1200', '@ArrowUp', '@Home', '@Backspace', '~1200', '@Control+z'],
    expected: '1. one\n   - aaa\n2. two\n3. three\n',
  },
  {
    name: 'undo restores a Tab indent',
    md: '1. one\n2. two\n3. three\n',
    steps: [
      '~400',
      '@ArrowUp',
      '~400',
      '@End',
      '~400',
      '@Tab',
      '~1200',
      '@Control+z',
    ],
    expected: '1. one\n2. two\n3. three\n',
  },
]

// The reported case, deleted from the end down to nothing; checked after every press.
const DELETE_ALL = '1. one\n2. two\n   - aaa\n   - bbb\n3. three\n'

async function run(
  mode: 'ir' | 'wysiwyg',
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: (fn: unknown, arg?: unknown) => Promise<unknown>,
) {
  const dir = path.join(tmpdir(), 'vmarkd-list-scenarios')
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `scenarios-${mode}.md`)
  writeFileSync(file, '# list scenarios\n')
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [file],
  )
  const surface = mode === 'ir' ? '.vditor-ir' : '.vditor-wysiwyg'
  const frame = wf(workbox)
  await frame.locator(surface).first().waitFor({ timeout: 60_000 })
  await settle(frame, 1500)

  const snap = () => snapshot(frame, surface)
  const load = async (md: string) => {
    await frame.locator('body').evaluate((_el, value) => {
      ;(
        window as unknown as {
          vditor: { setValue: (m: string, clearStack?: boolean) => void }
        }
      ).vditor.setValue(value as string, true)
    }, md)
    await settle(frame, 300)
    await frame
      .locator(surface)
      .first()
      .click({ position: { x: 30, y: 10 } })
    await settle(frame, 200)
    await workbox.keyboard.press('Control+End')
    await settle(frame, 150)
  }

  for (const sc of SCENARIOS) {
    await load(sc.md)
    await drive(workbox, frame, sc.steps)
    await settle(frame, 300)
    const { md, loose } = await snap()
    if (typeof sc.expected === 'string')
      expect.soft(md, `${mode}: ${sc.name}`).toBe(sc.expected)
    else expect.soft(md, `${mode}: ${sc.name}`).toMatch(sc.expected)
    expect.soft(loose, `${mode}: ${sc.name} — no <li><p>`).toBe(0)
  }

  await load(DELETE_ALL)
  await deleteAllFromEnd(mode, frame, workbox, snap)
}

// `@Key` / `@Key*N` presses a key (N times); `~N` waits N ms; anything else is typed text.
async function drive(
  workbox: import('@playwright/test').Page,
  frame: ReturnType<typeof wf>,
  steps: string[],
) {
  for (const step of steps) {
    if (step.startsWith('~')) {
      await settle(frame, Number(step.slice(1)))
      continue
    }
    if (!step.startsWith('@')) {
      await workbox.keyboard.type(step, { delay: 40 })
      continue
    }
    const [key, times] = step.slice(1).split('*')
    for (let i = 0; i < Number(times ?? 1); i++) {
      await workbox.keyboard.press(key)
      await settle(frame, 120)
    }
  }
}

type Snapshot = { md: string; li: number; loose: number }

// One round trip: the markdown, the rendered item count (an empty item is visible as a bare marker
// even when it no longer serialises) and how many items went loose (`<li><p>`).
const snapshot = (frame: ReturnType<typeof wf>, surface: string) =>
  frame.locator('body').evaluate((_el, sel): Snapshot => {
    const items = Array.from(document.querySelectorAll(`${sel} li`))
    return {
      md: (
        window as unknown as { vditor: { getValue: () => string } }
      ).vditor.getValue(),
      li: items.length,
      loose: items.filter((li) =>
        Array.from(li.children).some((c) => c.tagName === 'P'),
      ).length,
    }
  }, surface)

// Backspace until nothing is left, checking after EVERY press that something visible changed (no
// dead key) and that no tight item went loose — the user-reported failure shape.
async function deleteAllFromEnd(
  mode: string,
  frame: ReturnType<typeof wf>,
  workbox: import('@playwright/test').Page,
  snap: () => Promise<Snapshot>,
) {
  const visible = (s: Snapshot) => `${s.md}|li=${s.li}`
  let prev = await snap()
  for (let i = 0; i < DELETE_ALL.length + 10; i++) {
    if (prev.md.trim() === '' && prev.li === 0) break
    await workbox.keyboard.press('Backspace')
    await settle(frame, 120)
    const now = await snap()
    expect(
      visible(now),
      `${mode}: delete-from-end press ${i + 1} changed nothing (dead key)`,
    ).not.toBe(visible(prev))
    expect(
      now.loose,
      `${mode}: delete-from-end press ${i + 1} made the list loose`,
    ).toBe(0)
    prev = now
  }
  expect(prev.md.trim(), `${mode}: delete-from-end removed everything`).toBe('')
}

for (const mode of ['ir', 'wysiwyg'] as const) {
  test.describe(`list editing scenarios (${mode})`, () => {
    usePinnedSettings(test, { 'vmarkd.editor.defaultMode': mode })
    test(`list editing scenarios behave like a real editor (${mode})`, async ({
      workbox,
      evaluateInVSCode,
    }) => {
      test.setTimeout(300_000)
      await run(mode, workbox, evaluateInVSCode as never)
    })
  })
}
