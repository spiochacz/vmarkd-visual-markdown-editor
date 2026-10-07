import type { Page } from '@playwright/test'
import { expect, test } from './coverage-fixture'

/**
 * Task 525 — list editing corner cases, as a scenario net (IR + WYSIWYG, same expectations: every
 * measured behaviour was mode-identical). Each scenario loads `?md=`, puts the caret at the end of the
 * document, drives REAL keys and asserts the serialised markdown. Typing a marker character at the
 * end ("X") is how a scenario asserts where the caret landed: the X shows up in the markdown exactly
 * where the user would see it appear.
 *
 * The "delete everything from the end" scenarios also check an invariant after EVERY Backspace: the
 * visible state must change (no dead key press), no `<li>` may hold a `<p>` (a tight list gone loose),
 * and the markdown must not grow a blank line inside the list. That is the user-reported class
 * ("lista w liście, kasuję od końca, przy liście nadrzędnej psuje się formatowanie").
 *
 * The real-VS-Code twin is test/vscode-e2e/list-editing-scenarios.spec.ts.
 */

type Mode = 'ir' | 'wysiwyg'
const surface = (mode: Mode) =>
  mode === 'ir' ? '.vditor-ir' : '.vditor-wysiwyg'

async function load(page: Page, mode: Mode, md: string) {
  await page.goto(`/list.html?fix=1&mode=${mode}&md=${encodeURIComponent(md)}`)
  await page.waitForFunction(() => (window as any).__ready === true)
  await page.locator(surface(mode)).click({ position: { x: 30, y: 10 } })
  await page.keyboard.press('Control+End')
}

const getValue = (page: Page) =>
  page.evaluate(() => (window as any).vditor.getValue() as string)

// `@Key` / `@Key*N` presses a key (N times); `~N` waits N ms; anything else is typed text.
async function drive(page: Page, steps: string[]) {
  for (const step of steps) {
    if (step.startsWith('~')) {
      await page.waitForTimeout(Number(step.slice(1)))
    } else if (step.startsWith('@')) {
      const [key, times] = step.slice(1).split('*')
      for (let i = 0; i < Number(times ?? 1); i++) {
        await page.keyboard.press(key)
        await page.waitForTimeout(60)
      }
    } else {
      await page.keyboard.type(step, { delay: 20 })
    }
  }
  await page.waitForTimeout(150)
}

// One round trip per check: the markdown, the rendered item count (an empty item is visible as a bare
// marker even when it no longer serialises) and how many items went loose (`<li><p>`).
type Snapshot = { md: string; li: number; loose: number }
const snapshot = (page: Page, mode: Mode): Promise<Snapshot> =>
  page.evaluate((sel) => {
    const items = Array.from(document.querySelectorAll(`${sel} li`))
    return {
      md: (window as any).vditor.getValue() as string,
      li: items.length,
      loose: items.filter((li) =>
        Array.from(li.children).some((c) => c.tagName === 'P'),
      ).length,
    }
  }, surface(mode))

const looseItems = async (page: Page, mode: Mode) =>
  (await snapshot(page, mode)).loose

type Expectation = {
  name: string
  md: string
  steps: string[]
  expected: string | RegExp
}

const SCENARIOS: Expectation[] = [
  // --- #2 the user's case: empty item after an item that has a sublist ---
  {
    name: 'Backspace on the empty item after a sublist lands at the end of the last sub-item',
    md: '1. one\n2. two\n   - aaa\n   - bbb\n3. three\n',
    steps: ['@Backspace*6', 'X'],
    expected: '1. one\n2. two\n   - aaa\n   - bbbX\n',
  },
  {
    name: 'one Backspace on an empty item after a sublist, then type',
    md: '1. one\n2. two\n   - aaa\n   - bbb\n3. \n',
    steps: ['@Backspace', 'X'],
    expected: '1. one\n2. two\n   - aaa\n   - bbbX\n',
  },
  // --- #3 empty item: one Backspace removes it and the caret is at the end of the line above ---
  {
    name: 'empty flat item: Enter, Backspace, type continues the previous item',
    md: '1. one\n2. two\n',
    steps: ['@Enter', '@Backspace', 'X'],
    expected: '1. one\n2. twoX\n',
  },
  {
    name: 'empty nested item: Enter, Backspace, type continues the previous sub-item',
    md: '1. one\n2. two\n   - aaa\n',
    steps: ['@Enter', '@Backspace', 'X'],
    expected: '1. one\n2. two\n   - aaaX\n',
  },
  {
    name: 'empty FIRST nested item: Backspace returns to the end of the parent text',
    md: '1. one\n2. two\n',
    steps: ['@Enter', '@Tab', '@Backspace', 'X'],
    expected: '1. one\n2. twoX\n',
  },
  {
    name: 'emptying a middle ordered item renumbers the rest',
    md: '1. aa\n2. bb\n3. cc\n',
    steps: ['@ArrowUp', '@End', '@Backspace*3', 'X'],
    expected: '1. aaX\n2. cc\n',
  },
  // --- #1 data loss: Backspace at the START of an item whose previous sibling has a sublist ---
  {
    name: 'lifting a middle item after a sublist keeps the following items',
    md: '1. one\n   - aaa\n2. two\n3. three\n',
    steps: ['@ArrowUp', '@Home', '@Backspace', 'X'],
    expected: /^1\. one\n {3}- aaa\n\nXtwo\n\n\d+\. three\n$/,
  },
  {
    name: 'lifting the last item after a sublist makes it a paragraph',
    md: '1. one\n   - aaa\n2. two\n',
    steps: ['@Home', '@Backspace', 'X'],
    expected: '1. one\n   - aaa\n\nXtwo\n',
  },
  // --- #4 outdent renumbers ---
  // No typing after the key here: typing re-renders the list, which used to hide the stale number.
  {
    name: 'Backspace at the start of the last sub-item outdents it with the right number',
    md: '1. one\n2. two\n   - aaa\n   - bbb\n',
    steps: ['@Home', '@Backspace'],
    expected: '1. one\n2. two\n   - aaa\n3. bbb\n',
  },
  {
    name: 'Shift+Tab on an empty sub-item shows the right number before typing',
    md: '1. one\n2. two\n   - aaa\n',
    steps: ['@Enter', '@Shift+Tab'],
    expected: '1. one\n2. two\n   - aaa\n3.\n',
  },
  {
    name: 'two Backspaces at the start of the last sub-item: outdent, then lift to a paragraph',
    md: '1. one\n2. two\n   - aaa\n   - bbb\n',
    steps: ['@Home', '@Backspace', '@Backspace', 'X'],
    expected: '1. one\n2. two\n   - aaa\n\nXbbb\n',
  },
  {
    name: 'Shift+Tab on a middle sub-item renumbers and keeps its later siblings under it',
    md: '1. one\n   - aaa\n   - bbb\n   - ccc\n2. two\n',
    steps: ['@ArrowUp', '@ArrowUp', '@End', '@Shift+Tab', 'X'],
    expected: '1. one\n   - aaa\n2. bbbX\n   - ccc\n3. two\n',
  },
  // --- #6 Tab / Shift+Tab anywhere in the item text ---
  {
    name: 'Tab at the END of an item indents it',
    md: '- one\n- two\n',
    steps: ['@Tab', 'X'],
    expected: '- one\n  - twoX\n',
  },
  // A human pause after End: the selection Vditor then hands fixList is NOT `collapsed` (one end sits on
  // the element boundary) though it is empty — Tab must still indent.
  {
    name: 'Tab after End + a pause indents it',
    md: '1. one\n2. two\n3. three\n',
    steps: ['~400', '@ArrowUp', '~400', '@End', '~400', '@Tab', 'X'],
    expected: '1. one\n   1. twoX\n2. three\n',
  },
  {
    name: 'Tab in the MIDDLE of an item indents it and keeps the caret',
    md: '- one\n- two\n',
    steps: ['@ArrowLeft', '@Tab', 'X'],
    expected: '- one\n  - twXo\n',
  },
  {
    name: 'Tab then Shift+Tab at the end of an item round-trips',
    md: '- one\n- two\n',
    steps: ['@Tab', '@Shift+Tab', 'X'],
    expected: '- one\n- twoX\n',
  },
  {
    name: 'Tab at the end of an ordered item renumbers the rest',
    md: '1. one\n2. two\n3. three\n',
    steps: ['@ArrowUp', '@End', '@Tab', 'X'],
    expected: '1. one\n   1. twoX\n2. three\n',
  },
  // --- #5 typing a marker in an EMPTY item converts that item, never adds a third level ---
  {
    name: 'typing "- " in an empty nested ordered item makes it a bullet',
    md: '1. one\n2. two\n',
    steps: ['@Enter', '@Tab', '- aaa', '@Enter', 'bbb'],
    expected: '1. one\n2. two\n   - aaa\n   - bbb\n',
  },
  {
    name: 'typing "1. " in an empty nested bullet item makes it ordered',
    md: '- one\n',
    steps: ['@Enter', '@Tab', '1. aaa'],
    expected: '- one\n  1. aaa\n',
  },
  {
    name: 'typing the SAME marker in an empty item adds no level',
    md: '- one\n',
    steps: ['@Enter', '- aaa'],
    expected: '- one\n- aaa\n',
  },
  // Typed in an empty item with items AFTER it: the list splits into three. At top level that is clean
  // markdown (adjacent lists of different kinds are separate lists; the remainder restarts at 1, as
  // after a lifted paragraph). NOT covered here: the same split INSIDE an item — Lute's serializer
  // puts a blank line between adjacent lists, which makes the parent item loose (task 525 #8).
  {
    name: 'typing "- " in an empty item in the middle of a top-level list splits it',
    md: '1. aa\n2. bb\n3. cc\n',
    steps: ['@ArrowUp', '@ArrowUp', '@End', '@Enter', '- x'],
    expected: '1. aa\n\n- x\n\n1. bb\n2. cc\n',
  },
  {
    name: 'a marker typed after text is just text',
    md: '- one\n',
    steps: [' - x'],
    expected: '- one - x\n',
  },
  // --- #7 Enter at the END of an item that has a sublist starts a new FIRST sub-item (outliner style:
  //     the sublist stays with its parent; user decision 2026-10-07) ---
  {
    name: 'Enter at the end of an item with a bullet sublist adds a first sub-item',
    md: '1. one\n   - aaa\n2. two\n',
    steps: ['@ArrowUp', '@ArrowUp', '@End', '@Enter', 'X'],
    expected: '1. one\n   - X\n   - aaa\n2. two\n',
  },
  {
    name: 'Enter at the end of an item with an ordered sublist adds a first sub-item and renumbers',
    md: '- one\n  1. aaa\n  2. bbb\n',
    steps: ['@ArrowUp', '@ArrowUp', '@End', '@Enter', 'X'],
    expected: '- one\n  1. X\n  2. aaa\n  3. bbb\n',
  },
  {
    name: 'Enter at the end of an item with a checklist sublist adds an unchecked first sub-item',
    md: '- one\n  - [ ] aaa\n',
    steps: ['@ArrowUp', '@End', '@Enter', 'X'],
    // Lute's IR serialiser writes some task items with TWO spaces after `[ ]` (pre-existing).
    expected: /^- one\n {2}- \[ \] {1,2}X\n {2}- \[ \] {1,2}aaa\n$/,
  },
  {
    name: 'Enter twice at the end of an item with a sublist leaves the new item at the parent level',
    md: '1. one\n   - aaa\n2. two\n',
    steps: ['@ArrowUp', '@ArrowUp', '@End', '@Enter', '@Enter', 'X'],
    expected: '1. one\n2. X\n   - aaa\n3. two\n',
  },
  // --- already-correct behaviour, kept as a net ---
  {
    name: 'Enter, Enter on an empty sub-item returns to the parent level with the next number',
    md: '1. one\n2. two\n   - aaa\n',
    steps: ['@Enter', '@Enter', 'three'],
    expected: '1. one\n2. two\n   - aaa\n3. three\n',
  },
]

// "Delete everything from the end" fixtures — the invariant is checked after every key press.
const DELETE_ALL: string[] = [
  '1. one\n2. two\n   - aaa\n   - bbb\n',
  '- one\n- two\n  - aaa\n  - bbb\n',
  '1. one\n2. two\n   1. aaa\n   2. bbb\n',
  '- one\n- two\n  1. aaa\n  2. bbb\n',
  '1. one\n2. two\n   - aaa\n     - xxx\n',
  '1. one\n2. two\n   - aaa\n   - bbb\n3. three\n',
  '1. one\n   - aaa\n2. two\n   - bbb\n3. three\n',
  '- [ ] one\n- [ ] two\n  - aaa\n',
]

for (const mode of ['ir', 'wysiwyg'] as const) {
  test.describe(`list scenarios (task 525, ${mode})`, () => {
    for (const sc of SCENARIOS) {
      test(sc.name, async ({ page }) => {
        await load(page, mode, sc.md)
        await drive(page, sc.steps)
        const md = await getValue(page)
        if (typeof sc.expected === 'string') expect(md).toBe(sc.expected)
        else expect(md).toMatch(sc.expected)
        expect(
          await looseItems(page, mode),
          'no tight item turned loose (<li><p>)',
        ).toBe(0)
      })
    }

    for (const md of DELETE_ALL) {
      test(`Backspace from the end deletes everything cleanly: ${JSON.stringify(md)}`, async ({
        page,
      }) => {
        await load(page, mode, md)
        const trail: string[] = []
        let prev = await snapshot(page, mode)
        // Generous bound: one press per character plus one per item, plus slack.
        for (let i = 0; i < md.length + 10; i++) {
          if (prev.md.trim() === '' && prev.li === 0) break
          await page.keyboard.press('Backspace')
          await page.waitForTimeout(60)
          const now = await snapshot(page, mode)
          trail.push(`${now.md}|li=${now.li}`.replace(/\n/g, '⏎'))
          const tail = `\n${trail.slice(-4).join('\n')}`
          expect(
            `${now.md}|li=${now.li}`,
            `press ${i + 1} changed nothing visible (dead key)${tail}`,
          ).not.toBe(`${prev.md}|li=${prev.li}`)
          expect(now.loose, `press ${i + 1} made the list loose${tail}`).toBe(0)
          expect(
            now.md.trim(),
            `press ${i + 1} opened a blank line in the list${tail}`,
          ).not.toContain('\n\n')
          prev = now
        }
        expect(prev.md.trim(), 'everything was deleted').toBe('')
      })
    }
  })
}
