import '../src/boot/preload'
import { applyHardBreakStyle } from '../../src/shared/lute-hard-break'
import { setupHardBreakKey } from '../src/editing/hard-break-key'
import { blockModeElement } from '../src/util/source-map'
// Source import so the fixListToggle esbuild patch is applied (see link-harness).
import Vditor from 'vditor/src/index'
import { listToggle } from 'vditor/src/ts/util/fixBrowserBehavior'
// Tasks 461/462 — the outdent seam is wired ONLY behind `?fix=1` (see below); this harness always
// bundles the patchFixListOutdent-patched Vditor regardless (see list.spec.ts's header), so `?fix=1`
// toggles just whether `window.__vmarkdListKeydown` is installed, not which Vditor source runs.
import { installListBackspace } from '../src/editing/list-backspace'
import {
  fixAllListNumbering,
  fixListNumberingAtCaret,
} from '../src/editing/list-normalize'

// Task 391's invariant, kept as a DETECTOR after task 461 retired the repair module: in a list still
// marked `data-tight="true"`, no item may hold exactly one `<p>`-wrapped block (2+ is deliberate
// multi-block content, never the merge artifact — see task 391's rationale). Counting instead of
// repairing is deliberate now that nothing repairs it in production: a spec asserting "no corruption"
// must not be able to silently fix the thing it is asserting about.
function countTightListCorruption(root: ParentNode): number {
  let found = 0
  for (const list of Array.from(
    root.querySelectorAll('ol[data-tight="true"], ul[data-tight="true"]'),
  )) {
    // Direct children only: a nested list carries its own data-tight and is visited in its own right.
    for (const item of Array.from(list.children)) {
      if (item.tagName !== 'LI') continue
      if (
        Array.from(item.children).filter((c) => c.tagName === 'P').length === 1
      )
        found++
    }
  }
  return found
}

// Real Vditor (IR) to exercise the listToggle bugs (task 56): the null-deref
// crash on a checkbox-less sibling, and the sibling-scope mutation (toggling one
// item must not affect the others). The list shape is read from the URL
// (`?list=plain|mixed`) so the spec can pick the right fixture per assertion.
const lists: Record<string, string> = {
  // Plain bullets — toggling "check" on one item should make ONLY that item a task.
  plain: ['- one', '- two', '- three', ''].join('\n'),
  // Some items have a checkbox, some don't — the uncheck path used to null-deref
  // on the checkbox-less sibling.
  mixed: [
    '- [ ] task one',
    '- [x] task two done',
    '- plain bullet, no checkbox',
    '- [ ] task four',
    '',
  ].join('\n'),
  // Task 453 — mirrors test/vscode-e2e/fixtures/list-ops.md (a task list ABOVE a bullet list,
  // in the same doc) so the ported "Enter continues a list" spec can assert the task list is
  // undisturbed by editing the bullets below it, same as the real-VS-Code original did.
  ops: [
    '## Tasks',
    '',
    '- [ ] task one',
    '- [ ] task two',
    '',
    '## Bullets',
    '',
    '- bullet A',
    '- bullet B',
    '',
  ].join('\n'),
  // Tasks 461/462 probe — mirrors the exact fixture task 391 measured the corruption against
  // (list-tight.test.ts's CORRUPTED constant), so Backspace on the FIRST nested item can be probed
  // with the outdent seam present or absent (`?fix=1`, below) against this harness's always-patched
  // Vditor (finish-init.ts is never wired here — see list.spec.ts's header for why "stock Vditor"
  // isn't reachable from a running build).
  nested: [
    '1. Analysis of email threads',
    '   * first entry',
    '   * second entry',
    '',
  ].join('\n'),
  // Task 255 — a list + nested sublist for the "Fix list numbering" (caret-scoped) command.
  // The SOURCE numbers below are inert — Vditor renumbers on its own initial parse (see
  // __removeListItem's comment) — real staleness gets injected later via that helper; this
  // fixture just needs to BE a list.
  stale: [
    '1. alpha',
    '1. beta',
    '5. gamma',
    '   1. nested-x',
    '   7. nested-y',
    '4. delta',
    '',
  ].join('\n'),
  // Task 255 — TWO lists with a heading + plain paragraph between them, for "Renormalize all
  // lists": both lists must renumber (after __removeListItem injects real staleness), and the
  // paragraph (deliberately NOT list-shaped, so a wrong block-boundary would corrupt or absorb
  // it) must survive byte-identical. Source numbers are inert, same as `stale` above.
  staleAll: [
    '## Notes',
    '',
    '1. alpha',
    '1. beta',
    '',
    'A plain paragraph that must stay untouched by the whole-document command.',
    '',
    '1. first',
    '1. second',
    '3. third',
    '',
  ].join('\n'),
}
// Task 530 — lets the spec flip vmarkd.editor.hardBreakStyle the way a live config change does.
;(window as any).__applyHardBreakStyle = applyHardBreakStyle
const params = new URLSearchParams(location.search)
// `?md=<markdown>` loads an arbitrary document (list scenario matrix, task 525) instead of a named
// fixture; `?mode=wysiwyg` boots the WYSIWYG surface instead of IR.
const value =
  params.get('md') ?? (lists[params.get('list') || 'plain'] || lists.plain)
const mode = params.get('mode') === 'wysiwyg' ? 'wysiwyg' : 'ir'

const editor = new Vditor('app', {
  cache: { enable: false },
  mode,
  cdn: `${location.origin}/vditor`,
  value,
  // Vditor 3.11 calls this unconditionally while rendering the wysiwyg
  // toolbar; without it init throws (see main.ts).
  customWysiwygToolbar: () => {
    /* required stub — see comment above */
  },
  after() {
    ;(window as any).vditor = editor
    // Task 530 — the real Shift+Enter handler, wired as main.ts does.
    setupHardBreakKey(
      () => blockModeElement(editor),
      () => (editor as any).vditor,
    )
    ;(window as any).vditorTest = editor

    // Toggle list type on the Nth <li> in the IR editor, mirroring what the
    // toolbar list/check buttons do (ir/process.ts → listToggle). Returns
    // {ok, error} so the spec can assert "no crash".
    ;(window as any).__listToggle = (liIndex: number, type: string) => {
      try {
        const irEl = (editor as any).vditor.ir.element as HTMLElement
        const li = irEl.querySelectorAll('li')[liIndex] as HTMLElement
        const range = document.createRange()
        range.selectNodeContents(li)
        range.collapse(true)
        const sel = window.getSelection()!
        sel.removeAllRanges()
        sel.addRange(range)
        listToggle((editor as any).vditor, range, type)
        return { ok: true, error: null }
      } catch (e) {
        return { ok: false, error: String((e as Error)?.message ?? e) }
      }
    }
    // Tasks 461/462 — `?fix=1` wires what finish-init.ts installs in production (the
    // `window.__vmarkdListKeydown` seam patched `fixList` calls into), so specs can probe
    // "does the corruption still happen with our real fix active?" against genuine keydown handling.
    if (params.get('fix') === '1') {
      installListBackspace(() => (editor as any).vditor)
    }
    // Always exposed (harmless when unused) so any spec can ask "did this operation leave the
    // tight-list corruption behind?" without wiring a whole MutationObserver.
    ;(window as any).__tightListCorruption = () =>
      countTightListCorruption((editor as any).vditor.ir.element as HTMLElement)

    // Task 255 — drive the "Fix list numbering" / "Renormalize all lists" commands directly
    // (the same functions message-router.ts's handlers call), so the spec can assert on
    // getValue() without going through a real VS Code command/postMessage round trip — that
    // host↔webview wiring is covered separately by test/vscode-e2e/list-normalize.spec.ts.
    ;(window as any).__fixListNumbering = () => {
      const irEl = (editor as any).vditor.ir.element as HTMLElement
      return fixListNumberingAtCaret((editor as any).vditor as never, irEl)
    }
    ;(window as any).__renormalizeAllLists = () => {
      const irEl = (editor as any).vditor.ir.element as HTMLElement
      return fixAllListNumbering((editor as any).vditor as never, irEl)
    }
    // Task 255 spec helper — Vditor's OWN initial parse already renumbers ordered-list
    // `data-marker` attributes (Lute normalizes on spin, including the very first render), so a
    // document merely loaded with wrong source numbers is NOT actually stale by the time the spec
    // can observe it. Genuine staleness (the real bug: "task 65 #9 — IR editing doesn't renumber")
    // only arises from a live DOM edit that skips Lute's spin — a raw `<li>.remove()` reproduces
    // that exactly (siblings keep their now-wrong `data-marker`), without needing to fake a whole
    // drag/Backspace gesture.
    ;(window as any).__removeListItem = (needle: string) => {
      const irEl = (editor as any).vditor.ir.element as HTMLElement
      const li = [...irEl.querySelectorAll('li')].find((x) =>
        (x.childNodes[0]?.textContent ?? x.textContent ?? '').includes(needle),
      )
      if (!li) throw new Error(`__removeListItem: ${needle} not found`)
      li.remove()
    }

    ;(window as any).__ready = true
  },
})
