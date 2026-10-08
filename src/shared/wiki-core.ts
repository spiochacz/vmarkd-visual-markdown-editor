// Pure wiki-link primitives shared by host (src/) and webview (media-src/src/).
// ZERO dependencies on vscode, Node, or browser APIs — just strings and regexes.
// Both sides import this module so normalization is guaranteed identical.

export const WikiLinkPattern = /\[\[([^[\]\n]+?)\]\]/g

// WikiLinkPattern is a MUTABLE `/g`-flagged RegExp — its `.lastIndex` is call-order-dependent
// state. It's read/exec'd from four places across two runtime layers (this module's own
// extractWikiTargets below, media-src/src/custom-renderer.ts, media-src/src/wiki-serialize.ts,
// src/lute-host.ts); sharing the SAME object across those meant every stateful consumer had to
// remember its own `.lastIndex = 0` resets to avoid leaking match position into an unrelated
// caller — a footgun task 470 proved reachable (temporarily dropping one reset in
// custom-renderer.ts silently broke wiki-link rendering). Each consumer now holds its OWN
// instance via this factory instead — created ONCE, at module scope (not per call, which would
// pay the RegExp-compile cost on every invocation of a hot per-token render path) — so cross-
// module leakage is structurally impossible, leaving only the ordinary "reset before each use"
// discipline a stateful `/g` regex needs regardless of how many callers touch it.
export function newWikiLinkPattern(): RegExp {
  return new RegExp(WikiLinkPattern.source, WikiLinkPattern.flags)
}

function extractWikiTarget(raw: string): string {
  const [target] = raw.split('|', 1)
  return target.trim()
}

export function parseWikiPayload(raw: string): {
  target: string
  label: string
} {
  const [target, label] = raw.split('|', 2).map((p) => p.trim())
  return { target, label: label || '' }
}

export function stripMarkdownExtension(value: string): string {
  return value.replace(/\.(?:md|markdown)$/i, '')
}

function normalizeWikiSegment(value: string): string {
  return stripMarkdownExtension(value)
    .trim()
    .toLowerCase()
    .replace(/[ _]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function normalizeWikiLookupKey(value: string): string {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => normalizeWikiSegment(segment))
    .filter(Boolean)
    .join('/')
}

// Compute lookup keys for a wiki file given its relative path from the wiki root.
// Returns [relativeKey, basenameKey] (deduplicated). Pure string operation — the
// caller passes the relative path (forward-slashed, with extension).
export function wikiKeysForRelativePath(relativePath: string): string[] {
  const ext = relativePath.match(/\.[^./\\]+$/)?.[0] ?? ''
  const withoutExt = relativePath.slice(0, -ext.length || undefined)
  const basename = withoutExt.split('/').pop() ?? withoutExt

  return Array.from(
    new Set(
      [
        normalizeWikiLookupKey(withoutExt),
        normalizeWikiLookupKey(basename),
      ].filter(Boolean),
    ),
  )
}

// Own instance (see newWikiLinkPattern's doc comment above) — isolated from the other three
// consumers even though they all live in the same process; only this function ever touches it.
const extractTargetsPattern = newWikiLinkPattern()

// Extract all wiki link targets from a markdown string. Returns normalized,
// deduplicated keys. Used by the host to resolve only the targets the current
// document needs (fast-path init).
export function extractWikiTargets(markdown: string): string[] {
  extractTargetsPattern.lastIndex = 0
  const keys = new Set<string>()
  let m: RegExpExecArray | null
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex exec loop
  while ((m = extractTargetsPattern.exec(markdown)) !== null) {
    const key = normalizeWikiLookupKey(extractWikiTarget(m[1]))
    if (key) keys.add(key)
  }
  return Array.from(keys)
}

/**
 * Undo the entity escapes Lute applies to text it renders (`[[A&B]]` arrives as `[[A&amp;B]]`).
 * `&amp;` goes LAST: `&amp;lt;` is the text `&lt;`, not `<`.
 */
export function unescapeHtmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}
