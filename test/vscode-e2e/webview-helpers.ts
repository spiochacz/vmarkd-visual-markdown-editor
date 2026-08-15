// Shared helpers for the real-VS-Code spec suite. Extracted 2026-08-01 (task 483) — 187 of 190
// specs previously carried their own inline copy of these, which is why `jscpd` attributed 79% of
// the repository's duplication to this directory duplicating itself. `wf()`'s selector chain
// encodes a fact about how VS Code nests the webview's iframes; keeping it in one place means a
// nesting change is fixed once, not corrected in every spec that happens to still have a fresh copy.
//
// A handful of specs keep their own LOCAL variant instead of importing from here — that is
// deliberate, not an oversight: `caret-focused-open-probe.spec.ts` and `caret-empty-typing.spec.ts`
// use `.last()` because a donor tab can leave two vmarkd webview iframes in the DOM at once;
// `anchor-links.spec.ts` and `webview-message-origin-probe.spec.ts` add `:visible`;
// `prerender-first-open.spec.ts` uses `.locator(...).last().contentFrame()`. Each is solving a
// real, spec-specific timing/ambiguity problem — do not "fix" them to import this instead.

export function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

export const ev = (
  evaluateInVSCode: (fn: unknown, args: [string]) => Promise<unknown>,
  fn: unknown,
  arg = '',
) => evaluateInVSCode(fn, [arg] as [string])

export const settle = (frame: ReturnType<typeof wf>, ms: number) =>
  frame
    .locator('body')
    .evaluate((_el, d) => new Promise((r) => setTimeout(r, d as number)), ms)

export const docText = (
  evaluateInVSCode: (fn: unknown, args: [string]) => Promise<unknown>,
  file: string,
) =>
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
