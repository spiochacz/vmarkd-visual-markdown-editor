import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as vscode from 'vscode'
import { mock } from './vscode-mock'

// The webview→disk write-back is the corruption-critical link: a wrong `toWrite` or a
// mishandled applyEdit failure silently loses the user's edit or marks disk reconciled
// while it still holds the old bytes (task 151 item 2). WritebackController's OWN branching
// — the MINDIFF_CAP full-write bypass, the applyEdit-returned-false recovery, the
// echo-suppression flag ordering, and the no-op short-circuits — had no unit coverage
// (task 190 P0). Collaborators are mocked so those branches, not the diff algorithm
// (covered by minimal-diff-writeback.test.ts) or Lute (needs the vm host), are under test.
vi.mock('../../src/lute/lute-host', () => ({
  // Cold Lute: reserialize unavailable → the controller must fall back safely.
  reserializeMarkdown: vi.fn(() => undefined),
}))
vi.mock('../../src/markdown/minimal-diff-writeback', () => ({
  isSemanticNoop: vi.fn(() => false),
  // Identity: the editor form is written verbatim unless a test says otherwise, so the
  // assertions read the controller's decision, not the merge heuristic.
  minimalDiffWriteback: vi.fn((_original: string, next: string) => next),
}))

import {
  isSemanticNoop,
  minimalDiffWriteback,
} from '../../src/markdown/minimal-diff-writeback'
import { WritebackController } from '../../src/writeback/writeback-controller'

function makeController(docText = 'baseline text\n') {
  const doc = mock.createTextDocument('/ws/note.md', docText)
  const deps = {
    extensionPath: '/ext',
    getDocument: () => doc,
    getActiveUri: () => doc.uri,
    setApplyingWebviewEdit: vi.fn(),
    setPendingWebviewContent: vi.fn(),
    setLastSyncedContent: vi.fn(),
    showError: vi.fn(),
    debug: vi.fn(),
  }
  const ctrl = new WritebackController(deps as never)
  return { ctrl, deps, doc }
}

describe('WritebackController.syncToEditor', () => {
  beforeEach(() => {
    mock.reset()
    vi.clearAllMocks()
  })

  it('writes the editor content and toggles the echo-suppression flag around applyEdit', async () => {
    const { ctrl, deps, doc } = makeController('baseline text\n')
    await ctrl.syncToEditor('baseline text CHANGED\n')

    // The write reached applyEdit and updated the document.
    expect(mock.calls.appliedEdits).toHaveLength(1)
    expect(mock.calls.appliedEdits[0].replacements[0].content).toBe(
      'baseline text CHANGED\n',
    )
    expect(doc.getText()).toBe('baseline text CHANGED\n')
    // Echo guard: set true BEFORE the edit, cleared false AFTER (order matters — the
    // change listener reads the flag to skip re-pushing our own write back to the webview).
    expect(deps.setApplyingWebviewEdit.mock.calls).toEqual([[true], [false]])
    // Only reconcile lastSynced once the write actually landed.
    expect(deps.setLastSyncedContent).toHaveBeenCalledWith(
      'baseline text CHANGED\n',
    )
    expect(deps.setPendingWebviewContent).toHaveBeenCalledWith(
      'baseline text CHANGED\n',
    )
    expect(deps.showError).not.toHaveBeenCalled()
  })

  it('bypasses minimal-diff for a baseline over MINDIFF_CAP (full write, no per-block reserialize)', async () => {
    const { ctrl } = makeController('small doc\n')
    ctrl.setCleanBaseline('x'.repeat(100_001)) // > MINDIFF_CAP (100_000)
    await ctrl.syncToEditor(`${'x'.repeat(100_001)} edited`)
    // Over the cap the controller writes the editor output verbatim without invoking the
    // (expensive, and here pointless) per-block merge.
    expect(minimalDiffWriteback).not.toHaveBeenCalled()
    expect(mock.calls.appliedEdits[0].replacements[0].content).toBe(
      `${'x'.repeat(100_001)} edited`,
    )
  })

  it('runs minimal-diff for a baseline under MINDIFF_CAP', async () => {
    const { ctrl } = makeController('baseline text\n')
    await ctrl.syncToEditor('baseline text edited\n')
    expect(minimalDiffWriteback).toHaveBeenCalledTimes(1)
  })

  it('recovers when applyEdit resolves false: surfaces an error, clears pending, does NOT advance lastSynced', async () => {
    const { ctrl, deps, doc } = makeController('baseline text\n')
    // applyEdit RESOLVES false (does not throw) when the doc changed under us. Advancing
    // lastSynced here would mark webview+disk reconciled while disk still holds old bytes.
    vi.mocked(vscode.workspace.applyEdit).mockResolvedValueOnce(false)
    await ctrl.syncToEditor('baseline text CHANGED\n')

    expect(deps.showError).toHaveBeenCalledTimes(1)
    expect(deps.showError.mock.calls[0][0]).toMatch(/could not write/i)
    // pending set to the attempted content, then cleared on the failed write.
    expect(deps.setPendingWebviewContent.mock.calls).toEqual([
      ['baseline text CHANGED\n'],
      [undefined],
    ])
    expect(deps.setLastSyncedContent).not.toHaveBeenCalled()
    // Flag still reset in finally so the next real change isn't wrongly suppressed.
    expect(deps.setApplyingWebviewEdit.mock.calls).toEqual([[true], [false]])
    expect(doc.getText()).toBe('baseline text\n') // disk untouched
  })

  it('short-circuits when the content already equals the document (no write)', async () => {
    const { ctrl, deps } = makeController('baseline text\n')
    await ctrl.syncToEditor('baseline text\n')
    expect(mock.calls.appliedEdits).toHaveLength(0)
    expect(deps.setApplyingWebviewEdit).not.toHaveBeenCalled()
    expect(deps.setLastSyncedContent).toHaveBeenCalledWith('baseline text\n')
  })

  // Task 434 — isSemanticNoop's whole-doc check no longer runs INLINE in syncToEditor (it was the
  // one expensive step on every debounced tick — measured 74ms@10KB to 1000ms+@100KB, see
  // tasks/434-*.md). minimizeWriteback still runs on every tick as before (identity-mocked here,
  // so this always writes `content` verbatim); the no-op decision is DEFERRED — see the
  // 'deferred no-op check' and 'checkNoopOnWillSave' describe blocks below for where it now lives.
  it('a single tick no longer restores the baseline synchronously — it writes the (reflowed) editor output and ARMS a deferred check instead', async () => {
    const { ctrl } = makeController('baseline text\n')
    ctrl.setCleanBaseline('baseline text\n')
    vi.mocked(isSemanticNoop).mockReturnValue(true) // would be a no-op, IF checked synchronously
    await ctrl.syncToEditor('baseline text\n\n\n')
    // isSemanticNoop is not even called synchronously anymore.
    expect(isSemanticNoop).not.toHaveBeenCalled()
    // The tick's own (identity-mocked minimizeWriteback) output was written as-is.
    expect(mock.calls.appliedEdits).toHaveLength(1)
    expect(mock.calls.appliedEdits[0].replacements[0].content).toBe(
      'baseline text\n\n\n',
    )
  })

  // Task 434 defect #3 — a brand-new, never-saved document's clean baseline is legitimately
  // `''` (setCleanBaseline is called with document.getText() at open — editor-session.ts —
  // which is `''` for a blank file). `this.cleanBaseline || document.getText()` treated that
  // `''` as "not set" and silently minimized against the CURRENT (moving) document instead of
  // the true baseline; `??` must not make that substitution.
  it('minimizes against an EMPTY clean baseline, not the current document (task 434 defect #3)', async () => {
    const { ctrl, doc } = makeController('')
    ctrl.setCleanBaseline('') // legitimate empty baseline, not "unset"
    // The document has already moved past the baseline by the time this tick runs — a `||`
    // bug would read THIS as the minimize-against original instead of the true empty baseline.
    doc.__setText('one keystroke landed already\n')
    await ctrl.syncToEditor('one keystroke landed already\nsecond\n')
    expect(minimalDiffWriteback).toHaveBeenCalledWith(
      '', // the true baseline
      'one keystroke landed already\nsecond\n',
      expect.anything(),
    )
  })
})

describe('WritebackController deferred no-op check (task 434)', () => {
  beforeEach(() => {
    mock.reset()
    // mockReset (not clearAllMocks): several tests below QUEUE a mockReturnValueOnce that the
    // controller then CANCELS before ever calling isSemanticNoop (disposeNoopCheck /
    // setCleanBaseline tests) — clearAllMocks only wipes call history, not an unconsumed queued
    // once-value, so it would leak into and corrupt a LATER test's assertion. mockReset clears the
    // queue too; re-establish the module's own default (`() => false`) right after.
    vi.mocked(isSemanticNoop).mockReset().mockReturnValue(false)
    vi.mocked(minimalDiffWriteback).mockReset()
    vi.mocked(minimalDiffWriteback).mockImplementation(
      (_original: string, next: string) => next,
    )
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('restores the clean baseline verbatim once the document settles (no further tick within the idle window)', async () => {
    const { ctrl, deps, doc } = makeController('baseline text\n')
    ctrl.setCleanBaseline('baseline text\n')
    await ctrl.syncToEditor('baseline text\n\n\n') // reflowed but semantically identical
    expect(mock.calls.appliedEdits).toHaveLength(1) // the tick's own write

    vi.mocked(isSemanticNoop).mockReturnValueOnce(true)
    await vi.runOnlyPendingTimersAsync() // fire the armed deferred check
    await vi.runOnlyPendingTimersAsync() // let its own applyEdit's microtasks settle

    // A SECOND applyEdit — the retroactive correction — restores the exact baseline bytes.
    expect(mock.calls.appliedEdits).toHaveLength(2)
    expect(mock.calls.appliedEdits[1].replacements[0].content).toBe(
      'baseline text\n',
    )
    expect(doc.getText()).toBe('baseline text\n')
    expect(deps.setLastSyncedContent).toHaveBeenLastCalledWith(
      'baseline text\n',
    )
  })

  it('a later tick re-arms (does not stack) the deferred check — only the LAST tick in a burst gets checked', async () => {
    const { ctrl } = makeController('baseline text\n')
    ctrl.setCleanBaseline('baseline text\n')
    await ctrl.syncToEditor('baseline text\n\n\n')
    vi.advanceTimersByTime(600) // well under the idle window
    await ctrl.syncToEditor('baseline text\n\n\n\n') // another tick — re-arms, cancels the first
    vi.mocked(isSemanticNoop).mockReturnValueOnce(true)
    await vi.runOnlyPendingTimersAsync()
    await vi.runOnlyPendingTimersAsync()

    // Exactly ONE correction, not two — the first timer never fired.
    const corrections = mock.calls.appliedEdits.filter(
      (e) => e.replacements[0].content === 'baseline text\n',
    )
    expect(corrections).toHaveLength(1)
  })

  it('does nothing when the settled content genuinely is not a no-op', async () => {
    const { ctrl } = makeController('baseline text\n')
    ctrl.setCleanBaseline('baseline text\n')
    await ctrl.syncToEditor('baseline text CHANGED\n')
    vi.mocked(isSemanticNoop).mockReturnValueOnce(false)
    await vi.runOnlyPendingTimersAsync()
    await vi.runOnlyPendingTimersAsync()
    // Only the tick's own write — no follow-up correction.
    expect(mock.calls.appliedEdits).toHaveLength(1)
  })

  it('disposeNoopCheck cancels a pending timer — no stray applyEdit after the panel closes', async () => {
    const { ctrl } = makeController('baseline text\n')
    ctrl.setCleanBaseline('baseline text\n')
    await ctrl.syncToEditor('baseline text\n\n\n')
    ctrl.disposeNoopCheck()
    vi.mocked(isSemanticNoop).mockReturnValueOnce(true)
    await vi.runAllTimersAsync()
    // Only the original tick's write — the (cancelled) deferred check never ran.
    expect(mock.calls.appliedEdits).toHaveLength(1)
  })

  it('setCleanBaseline cancels a pending timer armed against the OLD baseline', async () => {
    const { ctrl } = makeController('baseline text\n')
    ctrl.setCleanBaseline('baseline text\n')
    await ctrl.syncToEditor('baseline text\n\n\n')
    ctrl.setCleanBaseline('a totally different baseline\n') // e.g. a save landed
    vi.mocked(isSemanticNoop).mockReturnValueOnce(true)
    await vi.runAllTimersAsync()
    expect(mock.calls.appliedEdits).toHaveLength(1) // no stale correction against the old baseline
  })

  // Task 434 defect #2 — armDeferredNoopCheck used to be called BEFORE `await applyToDocument`
  // dispatched the tick's own write. If that write took longer than NOOP_CHECK_IDLE_MS, the timer
  // fired against the STALE (pre-write) document, saw it unchanged from the baseline, bailed, and
  // was gone for good — nothing re-arms it once the real write does land, so the eventual no-op
  // for THIS tick would never be caught by the deferred path. Simulates a slow applyEdit by
  // holding its promise open across the idle window before letting it land.
  it('arms the deferred check only AFTER the tick’s own write lands, not against a still in-flight write', async () => {
    const { ctrl, doc } = makeController('baseline text\n')
    ctrl.setCleanBaseline('baseline text\n')
    let landWrite: (() => void) | undefined
    vi.mocked(vscode.workspace.applyEdit).mockImplementationOnce(
      (edit: { replacements: { content: string }[] }) =>
        new Promise((resolve) => {
          landWrite = () => {
            for (const r of edit.replacements) doc.__setText(r.content)
            resolve(true)
          }
        }),
    )
    const syncPromise = ctrl.syncToEditor('baseline text\n\n\n') // reflowed, semantically a no-op
    // The write is still in flight — advance past the FULL idle window while it's still
    // pending. On the pre-fix code the timer was already armed BEFORE the await, so it fires
    // right here, against the still-stale (pre-write) document — sees it byte-identical to
    // the baseline, bails, and is gone for good (nothing re-arms it below).
    await vi.advanceTimersByTimeAsync(1200)
    landWrite!()
    await syncPromise
    vi.mocked(isSemanticNoop).mockReturnValueOnce(true)
    // Arming happens (on the fix) only now, after the write landed — give it its OWN full
    // idle window from here.
    await vi.advanceTimersByTimeAsync(1200)
    await vi.runOnlyPendingTimersAsync()
    expect(isSemanticNoop).toHaveBeenCalled()
    const corrections = mock.calls.appliedEdits.filter(
      (e) => e.replacements[0]?.content === 'baseline text\n',
    )
    expect(corrections).toHaveLength(1)
  })
})

// Task 477 — "could not write your edit (the document changed underneath)" fires during
// ordinary typing. Hypothesis 1 (the lead, per the task file): applyToDocument is shared by
// the debounced tick (syncToEditor, called from editor-session.ts's onEdit on every webview
// 'edit' message) and the deferred no-op correction (resolveNoopCheck, armed
// NOOP_CHECK_IDLE_MS=1200ms after the last tick). Nothing serializes the two — a tick landing
// while the deferred correction's own applyEdit is still in flight races two of OUR OWN
// writers against the same document, and whichever VS Code resolves second sees a stale
// version and gets `applied: false` — which the code (correctly, per task 151 item 2) never
// silently drops, but currently reports as a user-facing error even though we caused it.
describe('WritebackController — task 477 own-writer race (concurrent applyToDocument)', () => {
  beforeEach(() => {
    mock.reset()
    vi.mocked(isSemanticNoop).mockReset().mockReturnValue(false)
    vi.mocked(minimalDiffWriteback).mockReset()
    vi.mocked(minimalDiffWriteback).mockImplementation(
      (_original: string, next: string) => next,
    )
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // THE DECISIVE TEST for task 477's falsifiable prediction. Drives the exact predicted
  // rhythm: tick → pause >=1.2s → deferred correction wakes and starts its own applyEdit →
  // "resume typing" (a fresh tick) while that applyEdit is still unresolved. Asserts that a
  // second `vscode.workspace.applyEdit` is never DISPATCHED while an earlier one from this
  // controller is still in flight — i.e. the two writers are serialized, so they can never
  // race each other on document version. This is the fixed/expected behaviour; see task
  // 477's own file for the confirmed-by-measurement reproduction against the pre-fix code.
  it('a fresh tick does not dispatch applyEdit while the deferred correction’s own applyEdit is still unresolved — writes are serialized, not raced', async () => {
    const { ctrl, deps, doc } = makeController('baseline text\n')
    ctrl.setCleanBaseline('baseline text\n')
    await ctrl.syncToEditor('baseline text\n\n\n') // reflowed, semantically a no-op tick
    expect(mock.calls.appliedEdits).toHaveLength(1)

    // Hold the deferred correction's applyEdit open — models "its applyEdit is then in
    // flight for a few ms" from the task file's predicted collision window. Mirrors the
    // default mock's own bookkeeping (push to appliedEdits, apply the text) so the dispatch
    // is visible immediately but the document mutation + resolution only happen once
    // `releaseDeferred` is called — modelling VS Code validating/applying asynchronously.
    let releaseDeferred: ((value: boolean) => void) | undefined
    vi.mocked(vscode.workspace.applyEdit).mockImplementationOnce(
      (edit: { replacements: { content: string }[] }) =>
        new Promise<boolean>((resolve) => {
          mock.calls.appliedEdits.push(edit as never)
          releaseDeferred = (value) => {
            if (value)
              for (const r of edit.replacements) doc.__setText(r.content)
            resolve(value)
          }
        }),
    )
    vi.mocked(isSemanticNoop).mockReturnValueOnce(true)
    await vi.advanceTimersByTimeAsync(1200) // wake resolveNoopCheck
    expect(releaseDeferred).toBeDefined() // its applyEdit was dispatched and is still open

    const callsBeforeTick = vi.mocked(vscode.workspace.applyEdit).mock.calls
      .length
    // "resume typing inside that await": a fresh tick fires while the deferred correction's
    // applyEdit is still unresolved.
    const tickPromise = ctrl.syncToEditor('baseline text\n\n\n\n')
    const callsRightAfterTick = vi.mocked(vscode.workspace.applyEdit).mock.calls
      .length

    // THE ASSERTION: the tick must NOT have dispatched its own applyEdit yet — it is queued
    // behind the still-open deferred correction, not racing it.
    expect(callsRightAfterTick).toBe(callsBeforeTick)

    // Let the deferred correction land (as it normally would — it was first in line and
    // nothing else touched the document while it was pending).
    releaseDeferred!(true)
    await tickPromise

    // Now the tick's own write has landed too, against the post-correction document —
    // never having raced it. No error was ever shown for this collision.
    expect(deps.showError).not.toHaveBeenCalled()
    expect(mock.calls.appliedEdits).toHaveLength(3) // initial tick + deferred correction + resumed tick
    expect(doc.getText()).toBe('baseline text\n\n\n\n')
  })

  // A genuinely failed write (e.g. a real external edit, hypothesis 3) must not wedge the
  // queue: the failure is reported and lastSyncedContent is not advanced (task 151 item 2),
  // but a LATER write still proceeds normally afterward.
  it('a failed write does not block a later queued write; task 151’s lastSyncedContent invariant holds', async () => {
    const { ctrl, deps, doc } = makeController('baseline text\n')
    vi.mocked(vscode.workspace.applyEdit).mockResolvedValueOnce(false)
    await ctrl.syncToEditor('baseline text FIRST\n')
    expect(deps.showError).toHaveBeenCalledTimes(1)
    expect(deps.setLastSyncedContent).not.toHaveBeenCalled()
    expect(doc.getText()).toBe('baseline text\n') // disk untouched by the failed write

    await ctrl.syncToEditor('baseline text SECOND\n')
    expect(deps.setLastSyncedContent).toHaveBeenCalledWith(
      'baseline text SECOND\n',
    )
    expect(doc.getText()).toBe('baseline text SECOND\n')
  })

  // Both user-facing failure messages (syncToEditor's and resolveNoopCheck's sibling at
  // writeback-controller.ts:~281) share applyToDocument — a failure on the deferred
  // correction's write must not block a later tick either.
  it('a failed deferred-correction write does not block a later tick', async () => {
    const { ctrl, deps, doc } = makeController('baseline text\n')
    ctrl.setCleanBaseline('baseline text\n')
    await ctrl.syncToEditor('baseline text\n\n\n')
    vi.mocked(isSemanticNoop).mockReturnValueOnce(true)
    vi.mocked(vscode.workspace.applyEdit).mockResolvedValueOnce(false)
    await vi.advanceTimersByTimeAsync(1200)
    expect(deps.showError.mock.calls[0][0]).toMatch(/could not restore/i)

    await ctrl.syncToEditor('baseline text CHANGED\n')
    expect(doc.getText()).toBe('baseline text CHANGED\n')
    expect(deps.setLastSyncedContent).toHaveBeenLastCalledWith(
      'baseline text CHANGED\n',
    )
  })
})

// Task 477 — "Instrument before theorising" (the one item left once hypothesis 1 was
// confirmed and fixed by construction). Hypotheses 2/3/4 were only deprioritised, never
// killed: the applyChain serialization above removes OUR OWN two-writer race, but does
// NOT — and must not — silence a genuinely external collision. These tests pin the
// widened debug() payload on applyOnce's (unchanged) failure path for BOTH call sites.
describe('WritebackController — task 477 instrumentation (debug payload on a failed write)', () => {
  beforeEach(() => {
    mock.reset()
    vi.mocked(isSemanticNoop).mockReset().mockReturnValue(false)
    vi.mocked(minimalDiffWriteback).mockReset()
    vi.mocked(minimalDiffWriteback).mockImplementation(
      (_original: string, next: string) => next,
    )
  })

  // syncToEditor's call site. Models hypothesis 3 (a genuine external edit): the mocked
  // applyEdit mutates the document ITSELF — like a real external writer would — before
  // resolving false, so the document's version moves by more than this write's own
  // (failed) edit could account for.
  it('logs the discriminating fields on syncToEditor’s failed write', async () => {
    const { ctrl, deps, doc } = makeController('baseline text\n')
    vi.mocked(vscode.workspace.applyEdit).mockImplementationOnce(async () => {
      doc.__setText('changed by something else entirely\n') // external edit lands mid-await
      return false
    })
    await ctrl.syncToEditor('baseline text CHANGED\n')

    expect(deps.debug).toHaveBeenCalledTimes(1)
    const [message, payload] = deps.debug.mock.calls[0]
    expect(message).toMatch(/^syncToEditor: applyEdit returned false/)
    expect(payload).toMatchObject({
      uri: doc.uri.toString(),
      debugLabel: 'syncToEditor',
      documentVersionAtConstruction: 1,
      documentVersionAtFailure: 2, // bumped by the __setText that simulated the external edit
      anotherApplyInFlight: false, // nothing else was mid-flight on this controller
    })
    expect(typeof payload.elapsedMs).toBe('number')
    expect(payload.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  // resolveNoopCheck's sibling call site (~line 281's user-facing message) — same
  // applyToDocument/applyOnce plumbing, same fields, different debugLabel + message.
  it('logs the discriminating fields on resolveNoopCheck’s failed write', async () => {
    vi.useFakeTimers()
    const { ctrl, deps, doc } = makeController('baseline text\n')
    ctrl.setCleanBaseline('baseline text\n')
    await ctrl.syncToEditor('baseline text\n\n\n') // arms the deferred no-op check
    vi.mocked(isSemanticNoop).mockReturnValueOnce(true)
    vi.mocked(vscode.workspace.applyEdit).mockImplementationOnce(async () => {
      doc.__setText('changed underneath the correction\n')
      return false
    })
    await vi.advanceTimersByTimeAsync(1200) // fire resolveNoopCheck

    const call = deps.debug.mock.calls.find(([msg]: [string]) =>
      msg.includes('resolveNoopCheck'),
    )
    expect(call).toBeDefined()
    const [message, payload] = call as [string, Record<string, unknown>]
    expect(message).toMatch(/^resolveNoopCheck: applyEdit returned false/)
    expect(payload).toMatchObject({
      uri: doc.uri.toString(),
      debugLabel: 'resolveNoopCheck',
      anotherApplyInFlight: false,
    })
    expect(typeof payload.documentVersionAtConstruction).toBe('number')
    expect(payload.documentVersionAtFailure).toBeGreaterThan(
      payload.documentVersionAtConstruction as number,
    )
    expect(typeof payload.elapsedMs).toBe('number')
    vi.useRealTimers()
  })

  // The whole point of `anotherApplyInFlight`: post-fix, it can only ever be true via a
  // window OUTSIDE applyChain's serialization — checkNoopOnWillSave's save-time
  // correction (hypothesis 2), which applies through `event.waitUntil`, not
  // `vscode.workspace.applyEdit`, so it never enters applyChain. This drives a tick's
  // write to fail WHILE that correction's own window is still open (before its
  // setTimeout(0) has fired) and asserts the flag reflects it.
  it('anotherApplyInFlight is true when a tick’s write fails while checkNoopOnWillSave’s own correction window is still open', async () => {
    vi.useFakeTimers()
    const { ctrl, deps, doc } = makeController('baseline text\n\n\n')
    ctrl.setCleanBaseline('baseline text\n')
    vi.mocked(isSemanticNoop).mockReturnValueOnce(true)
    ctrl.checkNoopOnWillSave(doc) // opens the in-flight window; only closes on its own setTimeout(0)

    vi.mocked(vscode.workspace.applyEdit).mockResolvedValueOnce(false)
    await ctrl.syncToEditor('baseline text\n\n\n\n') // races into the still-open window

    expect(deps.debug).toHaveBeenCalledTimes(1)
    const [, payload] = deps.debug.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ]
    expect(payload.anotherApplyInFlight).toBe(true)
    vi.useRealTimers()
  })
})

describe('WritebackController.checkNoopOnWillSave (task 434)', () => {
  beforeEach(() => {
    mock.reset()
    // See the previous describe block's beforeEach comment — mockReset (not clearAllMocks) so no
    // queued-but-uncalled mockReturnValueOnce from an earlier test can leak in here.
    vi.mocked(isSemanticNoop).mockReset().mockReturnValue(false)
  })

  it('returns a baseline-restoring TextEdit when the current content is a semantic no-op', () => {
    const { ctrl, doc } = makeController('baseline text\n\n\n') // already-reflowed on the document
    ctrl.setCleanBaseline('baseline text\n')
    vi.mocked(isSemanticNoop).mockReturnValueOnce(true)
    const edits = ctrl.checkNoopOnWillSave(doc)
    expect(edits).toHaveLength(1)
    expect(edits[0].newText).toBe('baseline text\n')
  })

  it('returns no edits when the content is not a no-op', () => {
    const { ctrl, doc } = makeController('baseline text CHANGED\n')
    ctrl.setCleanBaseline('baseline text\n')
    vi.mocked(isSemanticNoop).mockReturnValueOnce(false)
    expect(ctrl.checkNoopOnWillSave(doc)).toEqual([])
  })

  it('returns no edits when the document already equals the baseline (nothing to correct)', () => {
    const { ctrl, doc } = makeController('baseline text\n')
    ctrl.setCleanBaseline('baseline text\n')
    expect(ctrl.checkNoopOnWillSave(doc)).toEqual([])
    expect(isSemanticNoop).not.toHaveBeenCalled() // short-circuited before the expensive check
  })

  it('cancels a pending deferred check — the save resolves the decision, the timer would be redundant', async () => {
    vi.useFakeTimers()
    const { ctrl, doc } = makeController('baseline text\n\n\n')
    ctrl.setCleanBaseline('baseline text\n')
    await ctrl.syncToEditor('baseline text\n\n\n') // arms the deferred timer
    vi.mocked(isSemanticNoop).mockClear()
    ctrl.checkNoopOnWillSave(doc) // resolves it synchronously now
    vi.mocked(isSemanticNoop).mockClear()
    await vi.runAllTimersAsync() // the (cancelled) deferred timer must not fire a SECOND check
    expect(isSemanticNoop).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  // Task 434 defect #1 — the correction returned here is applied by VS Code via `waitUntil`,
  // which fires the SAME onDidChangeTextDocument listener as any other edit. Without marking
  // itself as an echo first (like every other write path — applyToDocument), that listener
  // couldn't tell the correction apart from an external edit and forced a full webview
  // setValue() rebuild on every save the correction fired for.
  it('sets the echo-suppression flags to the corrected content BEFORE returning the edit', () => {
    const { ctrl, deps, doc } = makeController('baseline text\n\n\n')
    ctrl.setCleanBaseline('baseline text\n')
    vi.mocked(isSemanticNoop).mockReturnValueOnce(true)
    const edits = ctrl.checkNoopOnWillSave(doc)
    expect(edits).toHaveLength(1)
    // pendingWebviewContent is what isEcho() actually compares the resulting
    // onDidChangeTextDocument against (checked first, self-clearing) — it must already hold
    // the correction's content by the time this returns, not asynchronously afterward.
    expect(deps.setPendingWebviewContent).toHaveBeenCalledWith(
      'baseline text\n',
    )
    expect(deps.setApplyingWebviewEdit).toHaveBeenCalledWith(true)
  })

  it('clears setApplyingWebviewEdit asynchronously — waitUntil gives no direct "edit landed" callback', async () => {
    vi.useFakeTimers()
    const { ctrl, deps, doc } = makeController('baseline text\n\n\n')
    ctrl.setCleanBaseline('baseline text\n')
    vi.mocked(isSemanticNoop).mockReturnValueOnce(true)
    ctrl.checkNoopOnWillSave(doc)
    expect(deps.setApplyingWebviewEdit).toHaveBeenCalledWith(true)
    expect(deps.setApplyingWebviewEdit).not.toHaveBeenCalledWith(false)
    await vi.runAllTimersAsync()
    expect(deps.setApplyingWebviewEdit).toHaveBeenLastCalledWith(false)
    vi.useRealTimers()
  })

  it('does NOT touch the echo-suppression flags when there is nothing to correct', () => {
    const { ctrl, deps, doc } = makeController('baseline text\n')
    ctrl.setCleanBaseline('baseline text\n')
    ctrl.checkNoopOnWillSave(doc)
    expect(deps.setPendingWebviewContent).not.toHaveBeenCalled()
    expect(deps.setApplyingWebviewEdit).not.toHaveBeenCalled()
  })

  // Task 434 defect #3 — an empty clean baseline (brand-new, never-saved document) is
  // legitimate, not "unset"; `if (!baseline) return []` treated it as unset and the no-op
  // check silently never ran for the whole class of file where the "undo returns to clean"
  // guarantee (task 61 v2) matters most — right at the start of its life.
  it('still runs the no-op check when the baseline is a legitimate empty string', () => {
    const { ctrl, doc } = makeController('\n\n') // reflowed whitespace-only, baseline == ''
    ctrl.setCleanBaseline('')
    vi.mocked(isSemanticNoop).mockReturnValueOnce(true)
    const edits = ctrl.checkNoopOnWillSave(doc)
    expect(isSemanticNoop).toHaveBeenCalledWith('', '\n\n', expect.anything())
    expect(edits).toHaveLength(1)
    expect(edits[0].newText).toBe('')
  })
})

// Task 516 — a real, measured race (5/10 reproductions in the real-VS-Code suite): a debounced
// syncToEditor tick already in flight when the user saves can land moments AFTER
// checkNoopOnWillSave's atomic save-time correction, re-dirtying a tab the save just cleaned with
// stale-but-semantically-noop content — and unlike checkNoopOnWillSave's own correction (applied
// atomically WITH the save), nothing downstream can ever clear `isDirty` again without another
// real save. These pin the fix: a short guard window, armed only when checkNoopOnWillSave actually
// corrects, during which a straggler no-op tick is skipped instead of written.
describe('WritebackController — task 516 post-save straggler guard', () => {
  beforeEach(() => {
    mock.reset()
    vi.mocked(isSemanticNoop).mockReset().mockReturnValue(false)
    vi.mocked(minimalDiffWriteback).mockReset()
    vi.mocked(minimalDiffWriteback).mockImplementation(
      (_original: string, next: string) => next,
    )
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('skips a straggler tick that lands shortly after a willSave correction, instead of re-dirtying the just-saved document', () => {
    const { ctrl, deps, doc } = makeController('baseline text\n\n\n') // already reflowed vs baseline
    ctrl.setCleanBaseline('baseline text\n')
    vi.mocked(isSemanticNoop).mockReturnValueOnce(true) // the willSave correction itself
    const edits = ctrl.checkNoopOnWillSave(doc)
    expect(edits).toHaveLength(1)
    // Mirror what VS Code + editor-session.ts's onDidSaveTextDocument do: the willSave edit lands
    // and the save completes, adopting the corrected text as the new clean baseline.
    doc.__setText('baseline text\n')
    ctrl.setCleanBaseline('baseline text\n')

    vi.advanceTimersByTime(500) // well inside the 2000ms guard window
    vi.mocked(isSemanticNoop).mockClear()
    vi.mocked(isSemanticNoop).mockReturnValueOnce(true) // the straggler's own content: also a no-op
    return ctrl.syncToEditor('baseline text\n\n\n').then(() => {
      // The straggler's isNoop check DID run (this is the eager path, not the deferred one)...
      expect(isSemanticNoop).toHaveBeenCalledTimes(1)
      // ...but no write landed: the tab stays exactly as the save left it.
      expect(mock.calls.appliedEdits).toHaveLength(0)
      expect(deps.setLastSyncedContent).toHaveBeenCalledWith('baseline text\n')
    })
  })

  it('writes a straggler tick normally once the guard window has elapsed', async () => {
    const { ctrl, doc } = makeController('baseline text\n\n\n')
    ctrl.setCleanBaseline('baseline text\n')
    vi.mocked(isSemanticNoop).mockReturnValueOnce(true)
    ctrl.checkNoopOnWillSave(doc)
    doc.__setText('baseline text\n')
    ctrl.setCleanBaseline('baseline text\n')

    vi.advanceTimersByTime(2_001) // past WILLSAVE_GUARD_MS
    vi.mocked(isSemanticNoop).mockClear()
    await ctrl.syncToEditor('baseline text\n\n\n')
    // Guard expired — this is an ordinary tick again: it writes and defers the no-op decision,
    // exactly like the (unguarded) task 434 behaviour.
    expect(mock.calls.appliedEdits).toHaveLength(1)
    expect(mock.calls.appliedEdits[0].replacements[0].content).toBe(
      'baseline text\n\n\n',
    )
  })

  it('still writes a straggler tick that is a GENUINE edit, not a no-op, even inside the guard window', async () => {
    const { ctrl, doc } = makeController('baseline text\n\n\n')
    ctrl.setCleanBaseline('baseline text\n')
    vi.mocked(isSemanticNoop).mockReturnValueOnce(true)
    ctrl.checkNoopOnWillSave(doc)
    doc.__setText('baseline text\n')
    ctrl.setCleanBaseline('baseline text\n')

    vi.advanceTimersByTime(500)
    vi.mocked(isSemanticNoop).mockReturnValueOnce(false) // a real change, not a no-op
    await ctrl.syncToEditor('baseline text CHANGED\n')
    expect(mock.calls.appliedEdits).toHaveLength(1)
    expect(mock.calls.appliedEdits[0].replacements[0].content).toBe(
      'baseline text CHANGED\n',
    )
  })
})
