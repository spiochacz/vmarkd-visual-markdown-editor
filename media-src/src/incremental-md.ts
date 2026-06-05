// Incremental IR → markdown serialization (task 69).
//
// IR reserializes the WHOLE document to markdown on every (debounced) edit:
// `vditor.lute.VditorIRDOM2Md(ir.element.innerHTML)` — super-linear (~O(n²)), seconds
// on a large doc. This keeps a cached full-document markdown string plus a per-top-level
// -block content-range map, and on each edit re-serializes only the block(s) that
// changed, splicing the result into the cache. Per-edit cost becomes O(edited block).
//
// Proven byte-exact by the task-69 spike (Findings in tasks/69-incremental-ir-serialize.md):
//  - per-block serialize has no content drift vs the full serialize; only inter-block
//    separators differ — and those are INHERITED from the cache (never synthesized).
//  - structural edits (split/merge/insert/delete/paste) are handled by re-serializing a
//    narrow CONTIGUOUS WINDOW of blocks (expanded by one neighbour each side) in ONE
//    `serialize()` call, so Lute emits the authoritative separators. 4000-edit fuzz: 0 drift.
//
// Pure & framework-free: the caller supplies `serialize(html)` (= the Lute call) and the
// list of top-level block `outerHTML` strings. Unit-testable without Lute/DOM.

export interface IncrementalMd {
  /**
   * Recompute the document markdown from the current top-level block `outerHTML` list,
   * reusing the cache for unchanged blocks. Returns the full markdown — byte-identical
   * to a full `serialize(allBlocks)`. Always correct: on any internal inconsistency it
   * falls back to a full serialize (today's behaviour), never corrupts.
   */
  update(blocks: readonly string[]): string
  /** Force a full re-serialize from `blocks` and re-baseline the cache. Returns it. */
  reset(blocks: readonly string[]): string
  /** Drop all cached state; the next `update` rebaselines with a full serialize. */
  invalidate(): void
  /** The last computed markdown (cache). */
  readonly markdown: string
}

type Range = [number, number] | null // [start, end) of a block's CONTENT in the cache, or null if empty

const stripTrailingNewlines = (s: string): string => s.replace(/\n+$/, '')

export function createIncrementalMd(
  serialize: (html: string) => string,
): IncrementalMd {
  let cache = ''
  let prev: string[] | null = null // last-seen block outerHTML list
  let ranges: Range[] = [] // content range per block, parallel to prev

  const ser = (html: string): string => stripTrailingNewlines(serialize(html))

  // Lay out each block's content range within `region` (a serialized string), offset by
  // `base`. Locates each block's isolated serialize sequentially — used only for the
  // small initial baseline and the narrow structural window, never the whole doc per edit.
  function layout(
    blocks: readonly string[],
    region: string,
    base: number,
  ): Range[] {
    const out: Range[] = []
    let cur = 0
    for (const b of blocks) {
      const content = ser(b)
      if (content === '') {
        out.push(null)
        continue
      }
      const at = region.indexOf(content, cur)
      if (at < 0) throw new Error('incremental-md: block content not locatable')
      out.push([base + at, base + at + content.length])
      cur = at + content.length
    }
    return out
  }

  function fullReset(blocks: readonly string[]): string {
    // The full serialize keeps Lute's authoritative separators AND the doc's trailing
    // newline (which lives in the final gap, outside every block's content range).
    cache = blocks.length ? serialize(blocks.join('')) : ''
    prev = blocks.slice()
    ranges = blocks.length ? layout(blocks, cache, 0) : []
    return cache
  }

  function incrementalUpdate(blocks: readonly string[]): string {
    const ob = prev as string[]

    if (ob.length === blocks.length) {
      // In-block edits: splice each changed block's content, shift the rest.
      let shift = 0
      for (let i = 0; i < blocks.length; i++) {
        const r = ranges[i]
        if (blocks[i] === ob[i]) {
          if (shift && r) ranges[i] = [r[0] + shift, r[1] + shift]
          continue
        }
        if (!r) throw new Error('incremental-md: edited an empty-content block') // → fallback
        const nc = ser(blocks[i])
        const s = r[0] + shift
        const e = r[1] + shift
        cache = cache.slice(0, s) + nc + cache.slice(e)
        ranges[i] = [s, s + nc.length]
        shift += nc.length - (r[1] - r[0])
      }
      prev = blocks.slice()
      return cache
    }

    // Structural edit (block count changed): prefix/suffix diff → narrow window,
    // expanded by one neighbour each side so Lute emits authoritative boundary separators.
    let p = 0
    while (p < ob.length && p < blocks.length && ob[p] === blocks[p]) p++
    let s = 0
    while (
      s < ob.length - p &&
      s < blocks.length - p &&
      ob[ob.length - 1 - s] === blocks[blocks.length - 1 - s]
    )
      s++
    let oWs = p
    let oWe = ob.length - s
    let nWs = p
    let nWe = blocks.length - s
    if (oWs > 0) {
      oWs--
      nWs--
    }
    if (oWe < ob.length) {
      oWe++
      nWe++
    }

    // Cache span = content extent of the OLD window.
    let spanStart: number | null = null
    let spanEnd = 0
    for (let i = oWs; i < oWe; i++) {
      const r = ranges[i]
      if (r) {
        if (spanStart === null) spanStart = r[0]
        spanEnd = r[1]
      }
    }
    if (spanStart === null)
      throw new Error('incremental-md: empty structural window') // → fallback

    const region = ser(blocks.slice(nWs, nWe).join(''))
    const winRanges = layout(blocks.slice(nWs, nWe), region, spanStart)
    cache = cache.slice(0, spanStart) + region + cache.slice(spanEnd)
    const delta = region.length - (spanEnd - spanStart)
    const after = ranges
      .slice(oWe)
      .map((r): Range => (r ? [r[0] + delta, r[1] + delta] : null))
    ranges = ranges.slice(0, oWs).concat(winRanges, after)
    prev = blocks.slice()
    return cache
  }

  return {
    update(blocks) {
      if (prev === null) return fullReset(blocks)
      try {
        return incrementalUpdate(blocks)
      } catch {
        return fullReset(blocks) // self-heal: worst case equals today's full serialize
      }
    },
    reset(blocks) {
      return fullReset(blocks)
    },
    invalidate() {
      prev = null
      ranges = []
      cache = ''
    },
    get markdown() {
      return cache
    },
  }
}
