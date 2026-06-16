// HTML comment previews — make `<!-- ... -->` visible in IR, WYSIWYG, and Preview.
//
// Lute renders a markdown HTML comment as a `data-type="html-block"` dual-node whose preview
// holds the LITERAL HTML comment — browsers don't display it, so the comment is invisible when
// collapsed (caret outside). We replace the preview's content with styled text showing the
// comment body. Idempotent (signature guard); round-trip safe (Lute serializes from the source
// marker only, ignores the preview subtree).
//
// In the full Preview pane, Lute emits raw HTML → comments are DOM Comment nodes (nodeType 8),
// not wrapped in `data-type`. A separate walker replaces those with visible elements.

const COMMENT_CLOSED = /^<!--([\s\S]*?)-->$/
const COMMENT_OPEN = /^<!--([\s\S]*)$/

function extractComment(
  source: string,
): { text: string; closed: boolean } | null {
  const s = source.trim()
  const mc = COMMENT_CLOSED.exec(s)
  if (mc) return { text: mc[1].trim(), closed: true }
  const mo = COMMENT_OPEN.exec(s)
  if (mo) return { text: mo[1].trim(), closed: false }
  return null
}

/**
 * IR / WYSIWYG: inject visible text into the preview element of each html-block comment.
 * Non-comment html-blocks (`<div>`, `<audio>`, …) are left alone — their preview already renders.
 */
export function applyCommentPreviews(
  root: ParentNode | null | undefined,
): void {
  if (!root || typeof root.querySelectorAll !== 'function') return
  for (const block of Array.from(
    root.querySelectorAll<HTMLElement>('[data-type="html-block"]'),
  )) {
    const code = block.querySelector<HTMLElement>(
      'pre.vditor-ir__marker--pre > code, pre > code',
    )
    if (!code) continue
    const source = code.textContent || ''
    const comment = extractComment(source)
    if (!comment) continue

    const preview = block.querySelector<HTMLElement>(
      '.vditor-ir__preview, .vditor-wysiwyg__preview',
    )
    if (!preview) continue
    if (preview.dataset.vmarkdCommentSig === source) continue

    const doc = block.ownerDocument
    const span = doc.createElement('span')
    span.className = 'vmarkd-comment'
    const body = comment.text || '(empty)'
    span.textContent = comment.closed ? `<!-- ${body} -->` : `<!-- ${body}`
    preview.textContent = ''
    preview.appendChild(span)
    preview.dataset.vmarkdCommentSig = source
  }
}

/**
 * Full Preview pane: Lute emits raw HTML, so comments are DOM Comment nodes (no wrapper).
 * Replace each with a visible element. Safe to re-run — Comment nodes are gone after the first
 * pass; fresh preview renders re-inject them from Lute output.
 */
export function revealPreviewComments(
  root: HTMLElement | null | undefined,
): void {
  if (!root) return
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_COMMENT,
  )
  const comments: Comment[] = []
  let node: Comment | null
  while (true) {
    node = walker.nextNode() as Comment | null
    if (!node) break
    comments.push(node)
  }
  for (const c of comments) {
    const text = (c.textContent ?? '').trim()
    const el = root.ownerDocument.createElement('div')
    el.className = 'vmarkd-comment'
    el.setAttribute('contenteditable', 'false')
    el.textContent = `<!-- ${text || '(empty)'} -->`
    c.parentNode?.replaceChild(el, c)
  }
}

export function observeHtmlComments(
  editorEl: HTMLElement | null | undefined,
): () => void {
  if (!editorEl) return () => {}
  const run = () => applyCommentPreviews(editorEl)
  const obs = new MutationObserver(run)
  obs.observe(editorEl, {
    childList: true,
    subtree: true,
    characterData: true,
  })
  run()
  return () => obs.disconnect()
}

export function observePreviewComments(
  previewEl: HTMLElement | null | undefined,
): () => void {
  if (!previewEl) return () => {}
  const run = () => revealPreviewComments(previewEl)
  const obs = new MutationObserver(run)
  obs.observe(previewEl, { childList: true, subtree: true })
  run()
  return () => obs.disconnect()
}
