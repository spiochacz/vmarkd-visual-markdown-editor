// Pure reading-time helpers for the status bar (task 35). Dependency-free so the
// host wiring stays thin and this is unit-tested directly. Distinct from the
// in-webview word counter (task 02) — if both ship they share the same notion of
// "a word" (runs of non-whitespace).

const WORDS_PER_MINUTE = 200

export function wordCount(text: string): number {
  const matches = text.match(/\S+/g)
  return matches ? matches.length : 0
}

// e.g. "~3 min read". Rounds up; a non-empty doc is always at least 1 min so it
// never reads "~0 min" for a few words. Empty doc → "~0 min read".
export function readingTime(text: string): string {
  const words = wordCount(text)
  const minutes =
    words === 0 ? 0 : Math.max(1, Math.ceil(words / WORDS_PER_MINUTE))
  return `~${minutes} min read`
}
