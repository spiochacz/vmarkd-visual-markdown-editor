import { type EvaluateInVSCode, stickySelection, wf } from './webview-helpers'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Task 477 — "[vMarkd] vMarkd: could not write your edit (the document changed underneath)"
// fired during ORDINARY TYPING, singly and rarely. Root cause, proven deterministically in
// test/backend/writeback-controller.test.ts: WritebackController.applyToDocument is shared by
// multiple of OUR OWN writers — the debounced edit-sync tick (syncToEditor, one call per
// webview 'edit' message) and the deferred whole-doc no-op correction (resolveNoopCheck) among
// them — with nothing serializing them. Two of our own writes landing with overlapping
// in-flight `vscode.workspace.applyEdit` calls meant the loser saw a stale document version,
// got `applied: false`, and the (correct, task 151 item 2) failure handling surfaced a scary
// error for a collision WE caused. The fix chains every applyToDocument call onto a single
// `applyChain` in WritebackController so two of our own writes can never overlap.
//
// This spec proves the fix holds through the REAL Vditor edit pipeline — genuine keystrokes,
// not synthetic events (AGENTS.md's L2-vs-L3 rule: synthetic events change getValue() without
// driving Vditor's real edit-post pipeline). Forcing the EXACT tick-vs-deferred-correction
// collision the task file predicts needs a live document's own applyEdit to still be
// unresolved at the instant a follow-up keystroke's tick fires — a window a few ms wide, which
// real keyboard timing cannot land reliably (confirmed by hand: typing immediately after
// detecting the correction's applyEdit in flight consistently failed to produce a further
// edit-sync tick at all, most likely a focus/DOM side effect of the undo dance rather than
// anything WritebackController does — the unit test is what pins that exact pairing
// deterministically). What real keys CAN reliably force is two ORDINARY ticks close enough
// together that their applyEdit calls would overlap without the queue — same call
// (syncToEditor), same shared applyToDocument, same fix. This spec widens the real race window
// deterministically (mirroring the task file's own "temporarily slow applyEdit" suggestion) by
// patching vscode.workspace.applyEdit in the extension host with an artificial delay, then
// asserts from REAL, host-recorded timestamps that consecutive real-keystroke writes never
// overlap and no error ever surfaces.
const SRC = path.join(__dirname, 'fixtures', 'undo-dirty.md')

// EvaluateInVSCode imported from webview-helpers.ts (see its comment) instead of a local
// hand-copied literal that pinned the arg as mandatory.

interface LogEntry {
  start: number
  end: number | null
}

// Extension-host-side patch, mirroring local-link-open.spec.ts's showErrorMessage spy: records
// every showErrorMessage call, AND wraps vscode.workspace.applyEdit with an artificial delay +
// a [start, end] log — the real, host-recorded evidence needed to prove no two of our own
// writes ever had overlapping in-flight applyEdit calls.
async function installSpies(
  evaluateInVSCode: EvaluateInVSCode,
  delayMs: number,
) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: [number]) => {
      const [delay] = args
      const g = globalThis as unknown as {
        __wb477Errors?: string[]
        __wb477Log?: LogEntry[]
      }
      g.__wb477Errors = []
      g.__wb477Log = []
      const origShow = vscode.window.showErrorMessage.bind(vscode.window)
      vscode.window.showErrorMessage = ((msg: string, ...rest: unknown[]) => {
        g.__wb477Errors!.push(msg)
        return (origShow as any)(msg, ...rest)
      }) as typeof vscode.window.showErrorMessage
      const origApply = vscode.workspace.applyEdit.bind(vscode.workspace)
      vscode.workspace.applyEdit = (async (
        edit: import('vscode').WorkspaceEdit,
      ) => {
        const entry: LogEntry = { start: Date.now(), end: null }
        g.__wb477Log!.push(entry)
        await new Promise((r) => setTimeout(r, delay))
        const result = await origApply(edit)
        entry.end = Date.now()
        return result
      }) as typeof vscode.workspace.applyEdit
    },
    [delayMs] as [number],
  )
}

async function readSpies(evaluateInVSCode: EvaluateInVSCode) {
  return evaluateInVSCode(async () => {
    const g = globalThis as unknown as {
      __wb477Errors?: string[]
      __wb477Log?: LogEntry[]
    }
    return { errors: g.__wb477Errors ?? [], log: g.__wb477Log ?? [] }
  }, []) as Promise<{ errors: string[]; log: LogEntry[] }>
}

async function waitForCount(
  evaluateInVSCode: EvaluateInVSCode,
  atLeast: number,
): Promise<void> {
  const deadline = Date.now() + 15_000
  for (;;) {
    const { log } = await readSpies(evaluateInVSCode)
    if (log.length >= atLeast) return
    if (Date.now() > deadline) {
      throw new Error(
        `applyEdit was only dispatched ${log.length} time(s), expected >= ${atLeast} within 15s`,
      )
    }
    await new Promise((r) => setTimeout(r, 100))
  }
}

test('two closely-spaced real keystroke ticks never let their applyEdit calls overlap, and no error surfaces (task 477)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  const before = readFileSync(SRC, 'utf8')
  const tmp = path.join(tmpdir(), 'vmarkd-writeback-477.md')
  writeFileSync(tmp, before)

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
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1000)))

  // Place the caret at the end of "Edit here last line no trailing newline" (real click, real
  // selection).
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 4, y: 4 } })
  await stickySelection(
    frame,
    () => {
      const p = Array.from(
        document.querySelectorAll('.vditor-ir p, .vditor-ir li, .vditor-ir h1'),
      ).find((x) => x.textContent?.includes('Edit here')) as
        | HTMLElement
        | undefined
      const t = p?.lastChild as Text | null
      if (!t) return
      const r = document.createRange()
      r.setStart(t, (t.textContent ?? '').length)
      r.collapse(true)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
      p?.focus()
    },
    null,
  )

  // Widen the real race window: every applyEdit now takes >= 500ms to actually land — far
  // longer than the edit-sync 250ms trailing debounce that separates two real keystroke ticks
  // below, so their applyEdit calls WILL be dispatched close enough together to overlap unless
  // WritebackController's own queue prevents it.
  await installSpies(evaluateInVSCode, 500)

  // First real keystroke burst → its own edit-sync tick → its own (now delayed) applyEdit.
  await workbox.keyboard.type('AAA', { delay: 30 })
  await waitForCount(evaluateInVSCode, 1) // the first tick's applyEdit has genuinely dispatched

  // Second real keystroke burst, fired well before the first applyEdit's artificial 500ms delay
  // has elapsed — its own tick's applyEdit is dispatched (or queued) while the first is still
  // unresolved. This is the same WritebackController.applyToDocument collision the task file
  // describes, forced reliably via two ordinary ticks instead of the much narrower
  // tick-vs-deferred-correction window.
  await workbox.keyboard.type('BBB', { delay: 30 })
  await waitForCount(evaluateInVSCode, 2)

  // Let both (delayed) applyEdit calls fully resolve.
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  const { errors, log } = await readSpies(evaluateInVSCode)

  // eslint-disable-next-line no-console
  console.log(
    `[477] applyEdit windows: ${log.map((w) => `[${w.start - log[0].start},${w.end === null ? '…' : w.end - log[0].start}]`).join(' ')} errors=${JSON.stringify(errors)}`,
  )

  // THE HEADLINE ASSERTION: no "document changed underneath" (or any) error surfaced for this
  // collision — it was ours to avoid, not the user's to be warned about.
  expect(errors, 'no writeback error should surface for our own race').toEqual(
    [],
  )

  // THE MECHANISM ASSERTION, from REAL host timestamps: the writers' applyEdit calls never
  // overlapped — each one only started once the previous one had fully landed.
  expect(log.length).toBeGreaterThanOrEqual(2)
  const sorted = [...log].sort((a, b) => a.start - b.start)
  for (let i = 1; i < sorted.length; i++) {
    expect(
      sorted[i].start,
      `applyEdit #${i} must not start before applyEdit #${i - 1} finished — they raced`,
    ).toBeGreaterThanOrEqual(sorted[i - 1].end as number)
  }

  // Data safety: both keystrokes' content survives, the file saves cleanly, and the tab goes
  // non-dirty — task 151's invariant end to end, through the real pipeline.
  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.commands.executeCommand('workbench.action.files.save')
  })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 800)))

  const after = readFileSync(tmp, 'utf8')
  rmSync(tmp, { force: true })
  expect(
    after,
    'both keystrokes must survive, nothing lost to the race',
  ).toContain('AAABBB')

  const isDirty = await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) =>
      vscode.workspace.textDocuments.find((d) => d.uri.fsPath === args[0])
        ?.isDirty ?? true,
    [tmp] as [string],
  )
  expect(isDirty, 'an explicit save must clear the dirty flag').toBe(false)
})
