// Wiki chip ↔ [[source]] rewrite for Lute serialization and live editing.
//
// Lute's Go-compiled serializers (VditorIRDOM2Md, SpinVditorIRDOM, etc.) have no
// JS hooks and don't know about our custom wiki chip spans. Without intervention:
//   - VditorIRDOM2Md drops chips to plain text → [[links]] lost on save
//   - SpinVditorIRDOM (live edit re-parse) drops chips → all wiki links in the
//     edited block vanish on the first keystroke
//
// Fix: monkey-patch every Lute method that consumes IR/DOM HTML to:
//   1. PRE-PROCESS: replace chip spans with their data-wiki-source text ([[...]])
//   2. Let the Go code run (it sees [[...]] as literal text, passes through)
//   3. POST-PROCESS (Spin only): re-render [[...]] text back to chip spans
//      (SpinVditorIRDOM doesn't call our custom JS renderers, so we do it here)

import { WikiLinkPattern, parseWikiPayload } from '../../src/wiki-core'

const CHIP_RE =
  /<span\b[^>]*\bclass="[^"]*wiki-link-chip[^"]*"[^>]*\bdata-wiki-source="([^"]*)"[^>]*>.*?<\/span>/g

function unescapeAttr(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function rewriteWikiChipsToSource(html: string): string {
  return html.replace(CHIP_RE, (_, source) => unescapeAttr(source))
}

let _knownPages: Set<string> | undefined

export function setKnownPagesRef(pages: Set<string> | undefined): void {
  _knownPages = pages
}

function reintroduceChips(html: string): string {
  WikiLinkPattern.lastIndex = 0
  return html.replace(WikiLinkPattern, (full, inner) => {
    const { target, label } = parseWikiPayload(inner)
    const displayText = label || target
    const isMissing = _knownPages
      ? !_knownPages.has(
          target
            .trim()
            .toLowerCase()
            .replace(/[ _]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, ''),
        )
      : false
    return (
      `<span class="wiki-link-chip" data-wiki-link="1" ` +
      `data-wiki-target="${escapeAttr(target)}" ` +
      `data-wiki-source="${escapeAttr(full)}"` +
      `${isMissing ? ' data-wiki-missing="1"' : ''} ` +
      `title="${isMissing ? 'Missing wiki page' : 'Open wiki page'} ${escapeAttr(target)}"` +
      `>${escapeAttr(displayText)}</span>`
    )
  })
}

export function patchLuteSerialize(vditor: any): void {
  const lute = vditor?.vditor?.lute
  if (!lute) return

  const origIR2Md = lute.VditorIRDOM2Md.bind(lute)
  lute.VditorIRDOM2Md = (html: string): string =>
    origIR2Md(rewriteWikiChipsToSource(html))

  const origDOM2Md = lute.VditorDOM2Md.bind(lute)
  lute.VditorDOM2Md = (html: string): string =>
    origDOM2Md(rewriteWikiChipsToSource(html))

  const origSpinIR = lute.SpinVditorIRDOM.bind(lute)
  lute.SpinVditorIRDOM = (html: string): string =>
    reintroduceChips(origSpinIR(rewriteWikiChipsToSource(html)))

  if (lute.SpinVditorDOM) {
    const origSpinDOM = lute.SpinVditorDOM.bind(lute)
    lute.SpinVditorDOM = (html: string): string =>
      reintroduceChips(origSpinDOM(rewriteWikiChipsToSource(html)))
  }
}
