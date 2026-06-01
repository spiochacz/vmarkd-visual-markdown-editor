import type Vditor from 'vditor'

const WalkContinue = 0
const WikiLinkPattern = /\[\[([^[\]\n]+?)\]\]/g

interface WikiRendererOptions {
  enabled: boolean
  knownPages?: Set<string>
}

export function setupCustomRenderer(
  vditor: Vditor,
  options: WikiRendererOptions,
) {
  // Only override Lute's renderers when wiki links are actually enabled.
  // For ordinary files this keeps Vditor's default rendering intact across
  // all modes (registering custom renderers broke wysiwyg/sv rendering).
  if (!options.enabled) {
    return
  }
  // Vditor 3.11.x exposes lute on the internal instance, not the public one
  const lute = (vditor as any).vditor.lute as Vditor['vditor']['lute']
  const renderText = (node: any, entering: boolean) => {
    if (!entering) {
      return ['', WalkContinue]
    }

    const text = node.TokensStr()
    WikiLinkPattern.lastIndex = 0

    if (!options.enabled || !WikiLinkPattern.test(text)) {
      WikiLinkPattern.lastIndex = 0
      return [escapeHTML(text), WalkContinue]
    }

    WikiLinkPattern.lastIndex = 0
    const fragments: string[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null

    // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex exec() loop, explicit `!== null`
    while ((match = WikiLinkPattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        fragments.push(escapeHTML(text.slice(lastIndex, match.index)))
      }

      const source = match[0]
      const payload = parseWikiLinkPayload(match[1])
      const displayText = payload.label || payload.target
      const isMissing = options.knownPages
        ? !options.knownPages.has(normalizeWikiTarget(payload.target))
        : false

      fragments.push(
        `<span class="wiki-link-chip" data-wiki-link="1" data-wiki-target="${escapeAttribute(
          payload.target,
        )}" data-wiki-source="${escapeAttribute(source)}"${isMissing ? ' data-wiki-missing="1"' : ''} title="${isMissing ? 'Missing wiki page' : 'Open wiki page'} ${escapeAttribute(
          payload.target,
        )}" role="link" tabindex="0">${escapeHTML(displayText)}</span>`,
      )

      lastIndex = WikiLinkPattern.lastIndex
    }

    if (lastIndex < text.length) {
      fragments.push(escapeHTML(text.slice(lastIndex)))
    }

    return [fragments.join(''), WalkContinue]
  }

  const renderInlineHTML = (node: any, entering: boolean) => {
    if (!entering) {
      return ['', WalkContinue]
    }

    const html = node.TokensStr()
    const match = html.match(/data-wiki-source="([^"]+)"/)
    if (match) {
      return [unescapeHTML(match[1]), WalkContinue]
    }

    return [html, WalkContinue]
  }

  lute.SetJSRenderers({
    renderers: {
      Md2VditorIRDOM: { renderText },
      Md2VditorDOM: { renderText },
      Md2VditorSVDOM: { renderText },
      Md2HTML: { renderText },
      // Vditor 3.11's Lute dropped the JS *DOM2Md reverse renderers; only
      // HTML2Md remains valid. Registering VditorIRDOM2Md/VditorDOM2Md throws
      // "unknown ext renderer func" and aborts editor init.
      HTML2Md: { renderInlineHTML },
    },
  })
}

function parseWikiLinkPayload(payload: string) {
  const [target, label] = payload.split('|', 2).map((part) => part.trim())

  return {
    target,
    label: label || '',
  }
}

function escapeHTML(str: string) {
  return str.replace(/[&<>"']/g, (match) => HtmlEscapeMap[match] || match)
}

function escapeAttribute(str: string) {
  return escapeHTML(str)
}

function unescapeHTML(str: string) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

const HtmlEscapeMap: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function normalizeWikiTarget(target: string): string {
  return target
    .trim()
    .toLowerCase()
    .replace(/\.(?:md|markdown)$/i, '')
    .replace(/[ _]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}
