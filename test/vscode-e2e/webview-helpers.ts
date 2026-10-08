// Shared helpers for the real-VS-Code spec suite. Extracted 2026-08-01 (task 483) — 187 of 190
// specs previously carried their own inline copy of these, which is why `jscpd` attributed 79% of
// the repository's duplication to this directory duplicating itself. `wf()`'s selector chain
// encodes a fact about how VS Code nests the webview's iframes; keeping it in one place means a
// nesting change is fixed once, not corrected in every spec that happens to still have a fresh copy.
//
// A handful of specs keep their own LOCAL variant instead of importing from here — that is
// deliberate, not an oversight: `caret-focused-open-probe.spec.ts` and `caret-empty-typing.spec.ts`
// use `.last()` because a donor tab can leave two vmarkd webview iframes in the DOM at once;
// `anchor-links.spec.ts`, `webview-message-origin-probe.spec.ts` and `local-link-open-probe.spec.ts`
// add `:visible`; `prerender-first-open.spec.ts` uses `.locator(...).last().contentFrame()`. Each
// is solving a real, spec-specific timing/ambiguity problem — do not "fix" them to import this instead.

export function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

/**
 * The playwright fixture's REAL `evaluateInVSCode` type (vscode-test-playwright's
 * `VSCodeTestFixtures`) is overloaded: a no-arg call is legitimate (`evaluateInVSCode(fn)`), and
 * a second overload adds an `arg`. Specs that pass the fixture down into their own local helper
 * functions need to re-annotate it (the real overloaded type doesn't survive being destructured
 * into a plain parameter), and hand-written re-annotations used to pin that second parameter as
 * always-required and typed to a specific tuple (e.g. `[string]`). That forced genuinely no-arg
 * call sites into a lying `[] as [string]` cast (TS2352) and broke every call that correctly
 * omitted the argument (TS2554). Keeping the argument optional and untyped here reproduces both
 * real overloads without a cast, in one place instead of a hand-copied literal per spec.
 */
export type EvaluateInVSCode = (fn: unknown, arg?: unknown) => Promise<unknown>

export const ev = (evaluateInVSCode: EvaluateInVSCode, fn: unknown, arg = '') =>
  evaluateInVSCode(fn, [arg] as [string])

export const settle = (frame: ReturnType<typeof wf>, ms: number) =>
  frame
    .locator('body')
    .evaluate((_el, d) => new Promise((r) => setTimeout(r, d as number)), ms)

/**
 * Open `file` in the vMarkd custom editor in `mode` (sets `vmarkd.editor.defaultMode` first, closes every
 * other editor). Callers that change the setting should list it in `useSettingsRestore`.
 */
export async function openInMode(
  evaluateInVSCode: EvaluateInVSCode,
  file: string,
  mode: 'ir' | 'wysiwyg' | 'sv',
) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      const [uri, defaultMode] = args
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.workspace
        .getConfiguration('vmarkd')
        .update(
          'editor.defaultMode',
          defaultMode,
          vscode.ConfigurationTarget.Global,
        )
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [file, mode],
  )
}

export const docText = (evaluateInVSCode: EvaluateInVSCode, file: string) =>
  evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) =>
      vscode.workspace.textDocuments
        .find((d) => d.uri.fsPath === args[0])
        ?.getText() ?? '',
    [file] as [string],
  ) as Promise<string>

/**
 * Click into the editor and WAIT until a caret is actually there before returning. For any spec that
 * then sends real keystrokes (`workbox.keyboard.*`).
 *
 * Why it exists: a bare `click()` + `settle()` is what most keyboard specs do, and when the caret
 * does not land the keystrokes go nowhere — the spec fails later with "the document is empty" or
 * "undo did not roll back", i.e. it reports a product symptom for what is really a setup miss. Two
 * specs failed exactly that way in a full run (heading-space-drop, paste-real, task 516 round 8) and
 * neither failure named focus. Returning only once `rangeInsideEditor` holds makes the setup either
 * succeed or fail AS ITSELF.
 *
 * NOTE: this is a diagnostic guarantee, not a proven cure for those two flakes — their mechanism is
 * still undetermined (a focus-survival probe measured 6/6 clean, refuting the obvious `settle()`
 * theory). If they fail again WITH this in place, the failure will at least say which half broke.
 */
export const clickIntoEditor = async (
  frame: ReturnType<typeof wf>,
  workbox: import('@playwright/test').Page,
  position: { x: number; y: number } = { x: 20, y: 12 },
): Promise<void> => {
  const caretIsInEditor = () =>
    frame.locator('body').evaluate(() => {
      const ir = document.querySelector('.vditor-ir') as HTMLElement | null
      const sel = window.getSelection()
      if (!ir || !sel?.rangeCount) return false
      return ir.contains(sel.getRangeAt(0).startContainer as Node)
    })
  for (let attempt = 0; attempt < 5; attempt++) {
    await frame
      .locator('.vditor-ir')
      .click({ position })
      // A missed click is not fatal — the loop retries and the caret check below is what decides.
      // Log it so a run that ends in the throw shows how it got there.
      .catch((err: Error) => {
        console.log(`[clickIntoEditor] click failed: ${err.message}`)
      })
    await workbox.waitForTimeout(200)
    if (await caretIsInEditor().catch(() => false)) return
  }
  throw new Error(
    'clickIntoEditor: no caret inside .vditor-ir after 5 attempts — the keystrokes that follow would go nowhere',
  )
}

// The selection as a comparable value: the STRUCTURAL path (tag + child index, editor-rootwards) of
// the node each end sits in. Node identity cannot cross the evaluate boundary, and neither text nor
// offset is stable enough to stand in for it: expanding an IR node inserts its marker text and
// shifts every offset after it, and Vditor rebuilds the block outright on a spin, so an exact
// text+offset comparison reports "moved" for a caret that never left. A path changes when the caret
// lands in a DIFFERENT block — which is exactly the clobber this guards against.
const SELECTION_SNAPSHOT = () => {
  const pathOf = (node: Node | null | undefined): string | null => {
    if (!node) return null
    const parts: string[] = []
    for (
      let n: Node | null = node;
      n && n !== document.body;
      n = n.parentNode
    ) {
      const parent: Node | null = n.parentNode
      if (!parent) break
      parts.push(
        `${n.nodeName}:${Array.prototype.indexOf.call(parent.childNodes, n)}`,
      )
    }
    return parts.join('/')
  }
  const s = window.getSelection()
  if (!s || s.rangeCount === 0) return 'none'
  return JSON.stringify({
    a: pathOf(s.anchorNode),
    f: pathOf(s.focusNode),
    c: s.isCollapsed,
  })
}

/**
 * Run a spec's OWN selection-writing function and make it stick: apply, snapshot what it set, wait
 * out the editor's post-click re-assert window, and re-apply if the selection drifted.
 *
 * The generic counterpart to `placeCaretAtEndOf` — for the call sites that cannot be expressed as
 * "caret at the end of the line containing X": a caret at a specific offset mid-text, inside a code
 * block or a diagram's source, or a non-collapsed RANGE for the cut/paste specs. Those keep their
 * own targeting code; this only makes the write authoritative.
 *
 * Same mechanism as `placeCaretAtEndOf` guards against (see its comment): a `Range` written from
 * `evaluate()` inside the window after a click is discarded when Vditor's block spin restores the
 * caret to where the click landed. Measured on a non-empty fixture, clicking one paragraph and
 * writing a Range into another: 3 of 6 runs were reverted to the CLICK position — never to some
 * third place, which is what rules out a stray armed caret intent and puts the blame on the spin's
 * own restore.
 */
export const stickySelection = async <A, R>(
  frame: ReturnType<typeof wf>,
  apply: (el: SVGElement | HTMLElement, arg: A) => R,
  arg: A,
  attempts = 5,
): Promise<R> => {
  const body = frame.locator('body')
  let result!: Awaited<R>
  for (let attempt = 0; attempt < attempts; attempt++) {
    // `before` is what makes this honest. The snapshot after `apply` is a SECOND round trip, so a
    // clobber that lands in between would be read back as "what we set" and accepted — measured, 2
    // of 8 runs returned with the caret at the click position that way. If the selection did not
    // MOVE, the write either found nothing or was already reverted; either way, retry.
    const before = await body.evaluate(SELECTION_SNAPSHOT)
    // Cast: Playwright types `evaluate`'s callback as `PageFunctionOn<El, A, R>`, which a caller's
    // free generic `R` cannot satisfy structurally (it would have to exclude function types). The
    // call is the ordinary one-argument `evaluate` at runtime; only the generic loses.
    result = (await body.evaluate(
      apply as unknown as (el: SVGElement | HTMLElement) => Awaited<R>,
      arg,
    )) as Awaited<R>
    const want = await body.evaluate(SELECTION_SNAPSHOT)
    const isLastAttempt = attempt === attempts - 1
    // A caller re-asserting a selection that is ALREADY where it wants it is legitimate, and
    // indistinguishable from a no-op write until it has held; accept it only once retrying has
    // stopped being an option.
    const wroteNothing = want === before
    if (want === 'none' || (wroteNothing && !isLastAttempt)) continue
    await settle(frame, 200)
    if ((await body.evaluate(SELECTION_SNAPSHOT)) === want) {
      // A retry that succeeds still gets logged, but the two outcomes that reach this line are not
      // the same thing. If the write MOVED the selection (`!wroteNothing`), the editor was
      // clobbering it and has now stopped — "held after N attempts" is accurate, and it is only
      // worth logging past the first attempt. If the structural path did not change (`wroteNothing`),
      // that is weaker than "the write did nothing": SELECTION_SNAPSHOT deliberately ignores offset,
      // so a write that moves the caret WITHIN the node it already occupied — offset 0 of a text node
      // it was already inside, say — reports identically to a write that landed nowhere. Both are
      // logged unconditionally, worded to state only the node-level observation rather than guess
      // which of the two happened.
      if (wroteNothing) {
        console.log(
          `[stickySelection] selection stayed in the same node after ${attempt + 1} attempts — SELECTION_SNAPSHOT compares structural path, not offset, so this also matches a caret write within a node the selection already occupied (the common case); it's also what a write that found nothing looks like, so worth a look if the spec around it fails`,
        )
      } else if (attempt > 0) {
        console.log(`[stickySelection] held after ${attempt + 1} attempts`)
      }
      return result
    }
  }
  throw new Error(
    `stickySelection: the selection would not hold after ${attempts} attempts — the editor is re-asserting its own caret over it, and the keystrokes that follow would go somewhere else`,
  )
}

/**
 * Put the caret at the END of the line of the first `selector` element containing `anchor`, by
 * CLICKING it and pressing End — then verify it actually landed before returning.
 *
 * Do NOT place a caret here by writing a `Range` from `evaluate()`. Measured 2026-08-15 on
 * footnote-editing.spec.ts: the range write itself succeeds (a read inside the SAME evaluate sees
 * the target node at the right offset), but in 2 of 4 runs the caret is back at the previously
 * clicked position (`"# "@0`, the document start) by the next evaluate — and a SECOND write is
 * clobbered the same way, so retrying a range write does not converge. Vditor restores its own
 * caret asynchronously after a click; a synthetic range is fighting the editor's caret authority
 * and loses on a race. Typing then lands in whatever block the editor chose: the spec's text ended
 * up inside the `# ` heading, or vanished, and it failed 5 of 10 solo runs with "the saved bytes
 * lack EXTRACONTEXT" — a save-fidelity symptom for a caret miss.
 *
 * Clicking + End goes through the editor's own caret machinery instead, and measured 4 of 4 on the
 * same probe. The verify + retry keeps a miss failing AS ITSELF.
 */
export const placeCaretAtEndOf = async (
  frame: ReturnType<typeof wf>,
  workbox: import('@playwright/test').Page,
  selector: string,
  anchor: string,
  attempts = 5,
): Promise<void> => {
  const target = frame.locator(selector).filter({ hasText: anchor }).first()
  const verify = (args: { selector: string; anchor: string }) =>
    frame.locator('body').evaluate((_el, { selector, anchor }) => {
      const sel = window.getSelection()
      const node = sel?.anchorNode as Text | null
      if (!node || !sel?.isCollapsed) return false
      if (!node.textContent?.includes(anchor)) return false
      if (!(node.parentElement as HTMLElement | null)?.closest(selector))
        return false
      return sel.anchorOffset === (node.textContent ?? '').length
    }, args)

  for (let attempt = 0; attempt < attempts; attempt++) {
    await target.click().catch((err: Error) => {
      console.log(`[placeCaretAtEndOf] click failed: ${err.message}`)
    })
    // Give the editor's own post-click caret restore time to run BEFORE End, so End moves the
    // final caret and not one that is about to be replaced.
    await settle(frame, 200)
    await workbox.keyboard.press('End')
    await settle(frame, 150)
    if (await verify({ selector, anchor }).catch(() => false)) {
      if (attempt > 0)
        console.log(
          `[placeCaretAtEndOf] landed on ${JSON.stringify(anchor)} after ${attempt + 1} attempts`,
        )
      return
    }
  }
  throw new Error(
    `placeCaretAtEndOf: the caret would not land at the end of ${JSON.stringify(anchor)} in ${selector} after ${attempts} attempts — the keystrokes that follow would land in another block`,
  )
}
