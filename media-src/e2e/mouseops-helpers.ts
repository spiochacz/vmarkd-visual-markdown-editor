import type { Page } from '@playwright/test'

// Shared Playwright-side helpers for the mouse-ops specs (task 191 Infra-3):
// copy-cut / paste-pipeline / mouse-selection all drive the same mouseops harness.

export type Mode = 'ir' | 'wysiwyg' | 'sv'

export async function gotoMouseops(
  page: Page,
  mode: Mode = 'ir',
  opts: { toolbar?: boolean } = {},
) {
  // Installed before the bundle runs, so the harness's explicit initVsCodeApi()
  // call (task 470) picks up the recording stub and window.vscode.postMessage
  // lands on window.__posted.
  await page.addInitScript(() => {
    ;(window as any).__posted = []
    ;(window as any).acquireVsCodeApi = () => ({
      postMessage: (m: any) => (window as any).__posted.push(m),
      getState: () => undefined,
      setState: () => {
        /* vscode API stub: state persistence unused in these helpers */
      },
    })
  })
  const q = opts.toolbar ? `?mode=${mode}&toolbar=1` : `?mode=${mode}`
  await page.goto(`/mouseops.html${q}`)
  await page.waitForFunction(() => (window as any).__ready === true)
}

// setValue + drop the setValue-driven edit so the spec counts only the op under test.
export async function setDoc(page: Page, md: string) {
  await page.evaluate((v) => {
    ;(window as any).vditor.setValue(v)
    ;(window as any).__posted.length = 0
  }, md)
  await page.waitForTimeout(300) // let the render (chips/diagrams) settle
}

export function getValue(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).vditor.getValue() as string)
}

// Select the entire editable content of the active mode (cross-block selection).
// Focuses the editable first so a subsequent execCommand('delete') (the cut path)
// actually operates on it.
export function selectAllContent(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = (window as any).__modeEl() as HTMLElement
    el.focus()
    const r = document.createRange()
    r.selectNodeContents(el)
    const s = getSelection()!
    s.removeAllRanges()
    s.addRange(r)
    return r.toString()
  })
}

// Select the contents of the first element matching `selector` inside the editor
// (used to land both range endpoints inside a specific CODE / A / P for the branchy
// wysiwyg copy handler). Focuses the editable so the cut path's execCommand applies.
export function selectWithin(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = (window as any).__modeEl() as HTMLElement
    el.focus()
    const target = el.querySelector(sel) as HTMLElement | null
    if (!target) throw new Error(`selectWithin: no match for ${sel}`)
    const r = document.createRange()
    r.selectNodeContents(target)
    const s = getSelection()!
    s.removeAllRanges()
    s.addRange(r)
    return r.toString()
  }, selector)
}

// Collapse a caret at the very end of the editable content (append point), for any
// mode — sv has no <p> structure, so a per-block selector doesn't generalize.
//
// WARNING (task 518): this produces a COARSE, container-level collapsed range (the whole
// editable root, not the text), which is NOT equivalent to a real caret for
// composition/IME-adjacent testing — it triggered a false "IME corrupts text" finding that
// root-caused to this placement, not a product bug (see tasks/518-ime-composition-corrupts-text.md
// and media-src/e2e/ime-composition.spec.ts's PROBE-C5-HARNESS-ARTIFACT). If a spec needs to
// compose/type immediately after positioning the caret, prefer real `page.keyboard` input instead.
export function caretToEnd(page: Page): Promise<void> {
  return page.evaluate(() => {
    const el = (window as any).__modeEl() as HTMLElement
    el.focus()
    const r = document.createRange()
    r.selectNodeContents(el)
    r.collapse(false)
    const s = getSelection()!
    s.removeAllRanges()
    s.addRange(r)
  })
}

// Select the first occurrence of `word` within a single text node of the editor
// (a sub-node range — selectWithin can only select a whole element). Focuses first.
export function selectWord(page: Page, word: string): Promise<string> {
  return page.evaluate((w) => {
    const el = (window as any).__modeEl() as HTMLElement
    el.focus()
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let node: Node | null = walker.nextNode()
    while (node) {
      const i = (node.textContent ?? '').indexOf(w)
      if (i >= 0) {
        const r = document.createRange()
        r.setStart(node, i)
        r.setEnd(node, i + w.length)
        const s = getSelection()!
        s.removeAllRanges()
        s.addRange(r)
        return r.toString()
      }
      node = walker.nextNode()
    }
    throw new Error(`selectWord: "${w}" not found`)
  }, word)
}

// Select a cross-block range from the first occurrence of `fromWord` to the end of the
// first occurrence of `toWord` (each in its own text node). Focuses the editable so a
// following real Backspace/Delete operates on the selection.
export function selectAcross(
  page: Page,
  fromWord: string,
  toWord: string,
): Promise<string> {
  return page.evaluate(
    ({ f, t }) => {
      const el = (window as any).__modeEl() as HTMLElement
      el.focus()
      const find = (w: string) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        let n: Node | null = walker.nextNode()
        while (n) {
          const i = (n.textContent ?? '').indexOf(w)
          if (i >= 0) return { node: n, i }
          n = walker.nextNode()
        }
        return null
      }
      const a = find(f)
      const b = find(t)
      if (!a || !b) throw new Error(`selectAcross: "${f}"/"${t}" not found`)
      const r = document.createRange()
      r.setStart(a.node, a.i)
      r.setEnd(b.node, b.i + t.length)
      const s = getSelection()!
      s.removeAllRanges()
      s.addRange(r)
      return r.toString()
    },
    { f: fromWord, t: toWord },
  )
}

export function collapseCaret(page: Page): Promise<void> {
  return page.evaluate(() => {
    const el = (window as any).__modeEl() as HTMLElement
    el.focus()
    const r = document.createRange()
    r.setStart(el, 0)
    r.collapse(true)
    const s = getSelection()!
    s.removeAllRanges()
    s.addRange(r)
  })
}

// Dispatch a synthetic ClipboardEvent on the active mode element and read the
// DataTransfer the handler wrote. Sentinels pre-seed the transfer so an early-return
// (e.g. the empty-selection guard) is observable as an UNTOUCHED payload.
export const UNSET = '__UNSET__'
export function syntheticClipboard(
  page: Page,
  type: 'copy' | 'cut',
): Promise<{ plain: string; html: string }> {
  return page.evaluate((evType) => {
    const el = (window as any).__modeEl() as HTMLElement
    const dt = new DataTransfer()
    dt.setData('text/plain', '__UNSET__')
    dt.setData('text/html', '__UNSET__')
    const ev = new ClipboardEvent(evType, {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    })
    el.dispatchEvent(ev)
    return { plain: dt.getData('text/plain'), html: dt.getData('text/html') }
  }, type)
}

// Real triple-click selects the whole line under the pointer (marker-inclusive in IR).
export async function tripleClick(page: Page, selector: string) {
  await page.locator(selector).first().click({ clickCount: 3 })
}

// Place a collapsed caret inside the first element matching `selector` (default: at its
// end). Focuses the editable so a subsequent paste's insertHTML lands there.
export function placeCaret(
  page: Page,
  selector: string,
  atEnd = true,
): Promise<void> {
  return page.evaluate(
    ({ sel, end }) => {
      const modeEl = (window as any).__modeEl() as HTMLElement
      modeEl.focus()
      const target = modeEl.querySelector(sel) as HTMLElement | null
      if (!target) throw new Error(`placeCaret: no match for ${sel}`)
      const r = document.createRange()
      r.selectNodeContents(target)
      r.collapse(!end)
      const s = getSelection()!
      s.removeAllRanges()
      s.addRange(r)
    },
    { sel: selector, end: atEnd },
  )
}

// Dispatch a synthetic paste on `target` (a selector inside the editor, or the mode
// element by default) carrying the given text/plain and/or text/html. Vditor's paste
// listener bubbles from the target, and its `paste()` handler reads event.target's
// closest CODE (so a fence-literal paste MUST target the code element). The handler is
// async — poll getValue()/the DOM afterwards rather than reading synchronously.
export function syntheticPaste(
  page: Page,
  opts: { plain?: string; html?: string; target?: string },
): Promise<void> {
  return page.evaluate((o) => {
    const modeEl = (window as any).__modeEl() as HTMLElement
    const target = o.target
      ? ((modeEl.querySelector(o.target) as HTMLElement | null) ?? modeEl)
      : modeEl
    const dt = new DataTransfer()
    if (o.plain != null) dt.setData('text/plain', o.plain)
    if (o.html != null) dt.setData('text/html', o.html)
    const ev = new ClipboardEvent('paste', {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    })
    target.dispatchEvent(ev)
  }, opts)
}
