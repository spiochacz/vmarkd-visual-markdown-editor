import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
// PROBE — a scenario MATRIX for list editing in the real VS Code webview (user report 2026-10-06:
// "ciągle są corner cases które nie działają" — nested list, delete from the end, formatting breaks
// when the deletion reaches the parent list; numbered list → bullet sublist → delete the sublist →
// back to the right numbered item). Records the markdown after EVERY keystroke so the exact press
// that breaks a list is visible, not just the end state. Writes tmp/list-matrix/<mode>.json.
// @probe — asserts nothing; excluded from the default run.
import path from 'node:path'
import { test } from 'vscode-test-playwright'
import { usePinnedSettings } from './settings-helpers'
import { settle, wf } from './webview-helpers'

const OUT = path.join(__dirname, '..', '..', 'tmp', 'list-matrix')

// A step is typed text, or `@Key` / `@Key*N` for a key press (repeated N times).
type Scenario = { name: string; md: string; steps: string[] }

const SCENARIOS: Scenario[] = [
  // ---- delete from the END, through a nested list into its parent ----
  {
    name: 'bs-end: ol > ul',
    md: '1. one\n2. two\n   - aaa\n   - bbb\n',
    steps: ['@Control+End', '@Backspace*22'],
  },
  {
    name: 'bs-end: ul > ul',
    md: '- one\n- two\n  - aaa\n  - bbb\n',
    steps: ['@Control+End', '@Backspace*22'],
  },
  {
    name: 'bs-end: ol > ol',
    md: '1. one\n2. two\n   1. aaa\n   2. bbb\n',
    steps: ['@Control+End', '@Backspace*22'],
  },
  {
    name: 'bs-end: ul > ol',
    md: '- one\n- two\n  1. aaa\n  2. bbb\n',
    steps: ['@Control+End', '@Backspace*22'],
  },
  {
    name: 'bs-end: ol > ul > ul (3 levels)',
    md: '1. one\n2. two\n   - aaa\n     - xxx\n',
    steps: ['@Control+End', '@Backspace*20'],
  },
  {
    name: 'bs-end: ol > ul, then 3rd ol item',
    md: '1. one\n2. two\n   - aaa\n   - bbb\n3. three\n',
    steps: ['@Control+End', '@Backspace*24'],
  },
  {
    name: 'bs-end: checklist > ul',
    md: '- [ ] one\n- [ ] two\n  - aaa\n',
    steps: ['@Control+End', '@Backspace*16'],
  },
  // ---- build from scratch by typing, then edit ----
  {
    name: 'type: ol, Tab sublist, Enter-Enter back out, continue numbering',
    md: '',
    steps: [
      '1. one',
      '@Enter',
      'two',
      '@Enter',
      '@Tab',
      'aaa',
      '@Enter',
      'bbb',
      '@Enter',
      '@Enter',
      'three',
    ],
  },
  {
    name: 'type: ol, Tab sublist, Shift+Tab back out, continue numbering',
    md: '',
    steps: [
      '1. one',
      '@Enter',
      'two',
      '@Enter',
      '@Tab',
      'aaa',
      '@Enter',
      '@Shift+Tab',
      'three',
    ],
  },
  {
    name: 'type: ol then nested bullet by typing "- " after Tab',
    md: '',
    steps: [
      '1. one',
      '@Enter',
      'two',
      '@Enter',
      '@Tab',
      '- aaa',
      '@Enter',
      'bbb',
    ],
  },
  {
    name: 'type: ol, nested bullets, then delete bullets and continue ol',
    md: '1. one\n2. two\n   - aaa\n   - bbb\n',
    steps: ['@Control+End', '@Backspace*10', '@Enter', 'three'],
  },
  {
    name: 'type: ol, nested bullets, Backspace to parent text end, Enter, three',
    md: '1. one\n2. two\n   - aaa\n',
    steps: ['@Control+End', '@Backspace*5', '@Enter', 'three'],
  },
  // ---- empty nested item behaviour ----
  {
    name: 'enter on empty nested item (ol > ul)',
    md: '1. one\n2. two\n   - aaa\n',
    steps: ['@Control+End', '@Enter', '@Enter', 'three'],
  },
  {
    name: 'backspace on empty nested item (ol > ul)',
    md: '1. one\n2. two\n   - aaa\n',
    steps: ['@Control+End', '@Enter', '@Backspace', '@Backspace', 'X'],
  },
  {
    name: 'bs on nested item marker with text (ol > ul, last)',
    md: '1. one\n2. two\n   - aaa\n   - bbb\n',
    steps: ['@Control+End', '@Home', '@Backspace', '@Backspace', '@Backspace'],
  },
  // ---- one press then TYPE: does the caret land where the user sees it? ----
  {
    name: 'empty nested item: Enter, Backspace once, type X',
    md: '1. one\n2. two\n   - aaa\n',
    steps: ['@Control+End', '@Enter', '@Backspace', 'X'],
  },
  {
    name: 'empty top-level item after a sublist: Backspace once, type X',
    md: '1. one\n2. two\n   - aaa\n   - bbb\n3. \n',
    steps: ['@Control+End', '@Backspace', 'X'],
  },
  {
    name: 'empty flat item: Enter, Backspace once, type X',
    md: '1. one\n2. two\n',
    steps: ['@Control+End', '@Enter', '@Backspace', 'X'],
  },
  // ---- Backspace at the START of a top-level item whose previous sibling has a sublist ----
  {
    name: 'bs at start of middle item after a sublist (lift)',
    md: '1. one\n   - aaa\n2. two\n3. three\n',
    steps: ['@Control+End', '@ArrowUp', '@Home', '@Backspace', 'X'],
  },
  {
    name: 'bs at start of last item after a sublist (lift)',
    md: '1. one\n   - aaa\n2. two\n',
    steps: ['@Control+End', '@Home', '@Backspace', 'X'],
  },
  // ---- deleting a middle item renumbers ----
  {
    name: 'delete middle ol item by backspacing its text',
    md: '1. aa\n2. bb\n3. cc\n',
    steps: ['@Control+End', '@ArrowUp', '@End', '@Backspace*4', 'X'],
  },
  // ---- outdent a MIDDLE nested item that has siblings after it ----
  {
    name: 'Shift+Tab a middle nested item',
    md: '1. one\n   - aaa\n   - bbb\n   - ccc\n2. two\n',
    steps: ['@Control+End', '@ArrowUp', '@ArrowUp', '@End', '@Shift+Tab', 'X'],
  },
  // ---- Enter at the end of a parent item that already has a sublist ----
  {
    name: 'Enter at end of parent with sublist',
    md: '1. one\n   - aaa\n2. two\n',
    steps: ['@Control+End', '@ArrowUp', '@ArrowUp', '@End', '@Enter', 'X'],
  },
  // ---- convert an empty nested item's type by typing a marker ----
  {
    name: 'type "1. " in an empty nested bullet item',
    md: '- one\n',
    steps: ['@Control+End', '@Enter', '@Tab', '1. aaa'],
  },
  // ---- Tab to create a nested bullet under a numbered item, then Ctrl+L ----
  {
    name: 'Tab nested ol item then Ctrl+L (format.list)',
    md: '1. one\n2. two\n',
    steps: ['@Control+End', '@Enter', '@Tab', 'aaa', '@Control+l'],
  },
]

const getValue = (frame: ReturnType<typeof wf>) =>
  frame
    .locator('body')
    .evaluate(
      () =>
        (
          window as unknown as { vditor?: { getValue?: () => string } }
        ).vditor?.getValue?.() ?? '',
    ) as Promise<string>

// Where the caret is: the surrounding text, so "jumped to document start" is visible.
const caretInfo = (frame: ReturnType<typeof wf>) =>
  frame.locator('body').evaluate(() => {
    const sel = window.getSelection()
    if (!sel?.rangeCount) return 'no-selection'
    const n = sel.anchorNode
    const t = n?.textContent ?? ''
    const li = (n?.nodeType === 1 ? (n as Element) : n?.parentElement)?.closest(
      'li',
    )
    const depth = (() => {
      let d = 0
      for (
        let e: Element | null | undefined = li;
        e;
        e = e.parentElement?.closest('li')
      )
        d++
      return d
    })()
    return `${JSON.stringify(t.slice(0, sel.anchorOffset))}|${JSON.stringify(t.slice(sel.anchorOffset))} li-depth=${depth}`
  })

// DOM-level red flags a markdown snapshot can hide.
const domFlags = (frame: ReturnType<typeof wf>, surface: string) =>
  frame.locator('body').evaluate((_el, surface) => {
    const root = document.querySelector(surface as string)
    if (!root) return ['no-root']
    const flags: string[] = []
    for (const li of Array.from(root.querySelectorAll('li'))) {
      const ps = Array.from(li.children).filter((c) => c.tagName === 'P')
      if (ps.length) flags.push(`li>p(${ps.length})`)
    }
    for (const list of Array.from(root.querySelectorAll('ol,ul')))
      if (list.children.length === 0) flags.push(`empty-${list.tagName}`)
    return [...new Set(flags)]
  }, surface)

async function runMatrix(
  mode: 'ir' | 'wysiwyg',
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: (fn: unknown, arg?: unknown) => Promise<unknown>,
) {
  const dir = path.join(tmpdir(), 'vmarkd-list-matrix')
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `matrix-${mode}.md`)
  writeFileSync(file, '# list matrix\n')
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

  const results: unknown[] = []
  for (const sc of SCENARIOS) {
    await frame.locator('body').evaluate((_el, md) => {
      ;(
        window as unknown as { vditor: { setValue: (m: string) => void } }
      ).vditor.setValue(md as string)
    }, sc.md)
    await settle(frame, 400)
    await frame
      .locator(surface)
      .first()
      .click({ position: { x: 30, y: 10 } })
    await settle(frame, 200)
    await workbox.keyboard.press('Control+End')
    await settle(frame, 150)
    const snapshot = async (step: string) => ({
      step,
      md: await getValue(frame),
      caret: await caretInfo(frame),
      dom: await domFlags(frame, surface),
    })
    const trail = [await snapshot('start')]
    for (const step of sc.steps) {
      if (!step.startsWith('@')) {
        await workbox.keyboard.type(step, { delay: 40 })
        await settle(frame, 250)
        trail.push(await snapshot(`type ${JSON.stringify(step)}`))
        continue
      }
      const [key, times] = step.slice(1).split('*')
      for (let i = 0; i < Number(times ?? 1); i++) {
        await workbox.keyboard.press(key)
        await settle(frame, 180)
        trail.push(await snapshot(times ? `${key}#${i + 1}` : key))
      }
    }
    results.push({ name: sc.name, trail })
    const last = trail[trail.length - 1]
    console.log(
      `\n[list-matrix ${mode}] === ${sc.name} ===\n${last.md.replace(/^/gm, '    ')}`,
    )
  }
  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    path.join(OUT, `${mode}.json`),
    JSON.stringify(results, null, 1),
  )
}

for (const mode of ['ir', 'wysiwyg'] as const) {
  test.describe(`list scenario matrix (${mode}) @probe`, () => {
    usePinnedSettings(test, { 'vmarkd.editor.defaultMode': mode })
    test(`probe: list scenario matrix (${mode}) @probe`, async ({
      workbox,
      evaluateInVSCode,
    }) => {
      test.setTimeout(900_000)
      await runMatrix(mode, workbox, evaluateInVSCode as never)
    })
  })
}
