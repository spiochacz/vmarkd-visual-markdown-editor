// Marp activation detection (task 107). Marp is document-level: a `marp: true` key in the
// document's leading YAML frontmatter turns the whole file into a deck. PURE + host-isomorphic
// — the host (src/extension.ts) reads it to set the initial init flag, and the webview
// (marp-preview-intercept.ts) re-evaluates it on every preview render so adding/removing the key
// toggles the deck live.
//
// We do a deliberately small, dependency-free scan (no YAML parser): frontmatter must start at
// offset 0 with a `---` fence line, end at the next `---`/`...` fence, and contain a top-level
// `marp:` whose value's first token is `true`. That matches how Marp itself gates activation.

const FENCE = /^(---|\.\.\.)\s*$/

export function parseMarpEnabled(md: string): boolean {
  if (typeof md !== 'string' || md.length === 0) return false
  // Frontmatter must be the very first thing in the file.
  const lines = md.split(/\r?\n/)
  if (lines.length === 0 || lines[0].trim() !== '---') return false

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (FENCE.test(line)) break // end of frontmatter
    const m = /^\s*marp\s*:\s*(\S+)/.exec(line)
    if (m) {
      // First token of the value; strip a trailing YAML `#` comment if it abuts.
      const value = m[1].replace(/#.*$/, '').trim().toLowerCase()
      return value === 'true'
    }
  }
  return false
}
