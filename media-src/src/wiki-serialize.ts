// Pre-serialize rewrite for wiki chips. Lute's VditorIRDOM2Md (Go, no JS hooks)
// doesn't know how to serialize custom <span class="wiki-link-chip"> elements
// back to [[wiki]] syntax — it drops them to plain text. Fix: intercept the HTML
// string BEFORE Lute sees it and replace each chip span with its data-wiki-source
// attribute value. The regex is anchored on the class + attribute so it won't match
// arbitrary spans. data-wiki-source holds the exact original [[...]] syntax
// (including pipe labels), HTML-escaped by custom-renderer.ts's escapeAttribute.

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

export function rewriteWikiChipsToSource(html: string): string {
  return html.replace(CHIP_RE, (_, source) => unescapeAttr(source))
}

// Monkey-patch lute.VditorIRDOM2Md and lute.VditorDOM2Md to run the rewrite
// before the real Go serializer. Called once after Vditor init, when wiki is enabled.
export function patchLuteSerialize(vditor: any): void {
  const lute = vditor?.vditor?.lute
  if (!lute) return

  const origIR = lute.VditorIRDOM2Md.bind(lute)
  lute.VditorIRDOM2Md = (html: string): string =>
    origIR(rewriteWikiChipsToSource(html))

  const origDOM = lute.VditorDOM2Md.bind(lute)
  lute.VditorDOM2Md = (html: string): string =>
    origDOM(rewriteWikiChipsToSource(html))
}
