// Task 184 — webview side of the persistent diagram render cache. The cache itself lives in
// the HOST (survives tab close + restart); this module is the webview's client:
//   1. PUT: after a diagram render lands, report `{diagramId, hash, svg}` to the host.
//   2. GET: on open, find each cacheable diagram block, compute its hash, ask the host for the
//      cached SVGs, and PAINT the hits WITHOUT running the engine (zero re-render on reopen).
//
// Scope: the reusable-SVG CUSTOM-diagram engines that flow through `findBlocks` (d2 the
// flagship, + wavedrom/nomnoml/vega/vega-lite — Phase 1/2) AND the reservable Vditor-NATIVE
// engines mermaid/abc/flowchart (Phase 3, NATIVE_CACHE_LANGS below). Both have a clean render
// target (a `.language-X` node in a preview pane) that we (a) RESERVE before the engine runs —
// by setting `data-processed="true"`, which findBlocks, Vditor's code-render AND the native
// engines' deferred pass all skip — and (b) fill from cache or unblock/re-render on a miss.
// See task 184 for the excluded engines (canvas/live-instance/worker-hang).
//
// Fidelity (the task-183 lesson): the cached SVG is injected into the LIVE, already-laid-out,
// width-CONSTRAINED `.language-X` div — the SAME discipline as the mermaid-retheme offscreen
// swap (`live.innerHTML = rendered`), NOT a detached overlay laid out at natural width (which
// caused the 183 mermaid grow/shrink: 545px overlay vs 309px constrained live svg). The svg was
// stored AFTER its `max-width:100%` styling, so it re-sizes to the column exactly like a live
// render. The div sits inside the `.vditor-ir__preview` (data-render="2"/contenteditable=false)
// half, which is already Lute-invisible; we additionally tag the div `data-render="1"` so
// getValue()/serializeForHost() are byte-identical present vs absent (belt-and-suspenders,
// covers the WYSIWYG direct-open flatten path too).
import { engineLangs } from '../diagram-kit/engine-registry'
import {
  backSpritesIn,
  PUML_POST_RENDER_THEMING,
} from './plantuml/plantuml-render'
import type {
  VmarkdConfigOptions,
  WebviewMessage,
} from '../../../src/shared/protocol'
import { engineCacheKeyFragment } from '../diagram-kit/diagram-config-delta'
import { findBlocks, RENDER_KEY_ATTR } from '../diagram-kit/diagram-dom'
import { nativeSourceForLive } from '../diagram-kit/diagram-surfaces'
import { isTyping } from '../editing/edit-activity'
import {
  NATIVE_CACHE_LANGS,
  renderNativeJobs,
} from '../diagram-kit/native-offscreen'
import { plantumlRender } from './plantuml/plantuml-render'
import { logToHost } from '../util/webview-log'

// The reusable-SVG custom-diagram languages (see scope note above). Keyed by lang+source so
// the mechanism is engine-agnostic across these; canvas/WebGL engines (stl) and Leaflet maps
// (geojson/topojson) are excluded — their output isn't a reusable static SVG. 185/2a: derived
// from the engine registry (custom + cacheable).
const CACHEABLE_LANGS = engineLangs((e) => e.family === 'custom' && e.cacheable)

// Vditor-NATIVE engines we also reserve+paint (task 184 Phase 3): mermaid, abc, flowchart
// (NATIVE_CACHE_LANGS, from native-offscreen). Unlike CACHEABLE_LANGS these are rendered by Vditor's
// OWN deferred `addScript().then()` pass, not our custom observer — but that pass re-checks
// `data-processed` inside the `.then()`, so a synchronous reserve on open (finish-init runs in the
// same task, before the microtask) still blocks it. ⚠ ORDERING CONTRACT (185/2d): this only holds
// while installRenderCache runs SYNCHRONOUSLY inside runFinishInit's task — the other side of the
// contract is documented at the finish-init.ts install site. Guarded twice: the
// diagram-cache-mermaid e2e fails when the cache-hit attribute stops appearing, and resolveRequest
// logs an ordering-violation warning when a HIT finds an already-engine-rendered block. All three
// engines emit a reusable static <svg> and set `data-processed` on completion (our miss-poll
// signal). echarts/mindmap (canvas), markmap (live d3 instance), and graphviz (Viz.js worker hangs
// on the double-invoke a reserve causes) are excluded — see task 184.
//
// PlantUML (task 347 follow-up) is ALSO native + reservable + paintable, but it is deliberately NOT in
// NATIVE_CACHE_LANGS (the offscreen tier) because its cache-MISS re-renders LIVE, not offscreen. Two
// properties of our own plantuml-render.ts force this: (1) it sets `data-processed` EARLY — before the
// async engine render — which the offscreen poll (native-offscreen.ts) would mis-read as "done" and
// swap an empty node; (2) it cleanly SKIPS any `data-processed` block up front, so a reserve never
// reaches the engine and therefore never invokes Viz.js. That second property is exactly why plantuml
// is SAFE to reserve where graphviz is not: graphviz's Vditor renderer still calls Viz.instance() on a
// reserved block (→ the double-invoke hang), but our plantuml loop bails first. So on a plantuml miss we
// simply un-reserve the blocks and re-call plantumlRender, which renders them live (incrementally, with
// its own task-139 "Rendering…" placeholder) while skipping the still-reserved hits. Kept as an explicit
// named tier here rather than a registry `cacheable` flag because that flag is coupled to the offscreen
// RENDERERS set (engine-registry.test.ts) which plantuml's live-miss path is not part of.
const PLANTUML = 'plantuml'
// Every native lang the cache reserves+paints (reserve target + PUT are identical across them); the MISS
// path branches by PendingBlock.kind — offscreen for NATIVE_CACHE_LANGS, live re-trigger for plantuml.
const NATIVE_RESERVE_LANGS = [...NATIVE_CACHE_LANGS, PLANTUML]
// The editor root (#app), captured on install — the scope a plantuml miss re-renders live under.
let cacheRoot: HTMLElement | null = null
// The post fn, captured on install for the same reason: a theme flip (task 436's rethemeCacheFirst)
// runs from the re-theme path, which has no host channel of its own. Null until installRenderCache
// runs, which is what makes rethemeCacheFirst degrade to "caller re-renders live" instead of
// throwing when the cache client is absent (a unit test, a stripped build).
let cachePost: ((msg: WebviewMessage) => void) | null = null
const PREVIEW_PANE_SEL = '.vditor-ir__preview, .vditor-wysiwyg__preview'
// …plus the full Preview overlay. PREVIEW_PANE_SEL alone is the OPEN-path scope (only the collapsed
// editor previews exist then); the same-session reuse also has to reach panes a mode switch builds
// later, which is either of the other two (task 366).
const ANY_PREVIEW_PANE_SEL = `${PREVIEW_PANE_SEL}, .vditor-preview`

// Preview panes containing `lang` in `root`, in document order — the render target for a native engine.
function nativePanes(root: ParentNode, lang: string): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(PREVIEW_PANE_SEL),
  ).filter((p) => p.querySelector(`.language-${lang}`))
}

interface RenderCacheConfig {
  // Engine-version stamp (extension version) — a bump invalidates every hash.
  version: string
  // Task 408 — the GLOBAL fragment only: mode + content theme + font size, i.e. everything that
  // changes EVERY engine's render output. Per-engine settings (mermaidTheme, d2Layout, …) used to
  // live here too (folded into one flat string for all engines), which meant a single engine's
  // setting change invalidated every OTHER engine's cache entries as a side effect — nothing read
  // `options` per-lang, so the only way to react to e.g. a d2Layout change was to bump a key that
  // every hash shared. Now `options` (below) carries the live per-engine settings, and hashOf
  // looks up just the one engine's own configKeys via engineCacheKeyFragment.
  themeKey: string
  // The live merged config options (task 408) — hashOf reads each engine's OWN configKeys off
  // this via engineCacheKeyFragment, so e.g. a D2-only change reshapes only d2's hash inputs.
  options?: VmarkdConfigOptions
  // For the native cache-MISS offscreen re-render: the asset CDN + the current theme mode. A
  // native engine can't be re-fired once its one-shot open pass skipped a reserved block, so on a
  // miss we render its source offscreen ourselves (renderNativeJobs) using these — matching what
  // Vditor would have rendered.
  cdn: string
  mode: 'dark' | 'light'
}

let cfg: RenderCacheConfig = {
  version: '0',
  themeKey: '',
  options: undefined,
  cdn: '',
  mode: 'light',
}

// Update the cache config from the init / live-config message. Called by main.ts on every
// (re-)init and config-changed so a theme/engine change flips the hash (→ miss → live render).
export function setRenderCacheConfig(next: Partial<RenderCacheConfig>): void {
  const prev = cfg
  cfg = { ...cfg, ...next }
  // version/themeKey are the two GLOBAL fragments folded into EVERY hash (task 408 narrowed
  // themeKey to mode/contentTheme/fontSize only), so a change to either makes the WHOLE local map
  // permanently unreachable — drop it rather than hold stale SVGs until eviction. A per-engine
  // `options` change (e.g. d2Layout) does NOT need this: only the affected engine's OWN hashes
  // change (engineCacheKeyFragment), so its old entries become unreachable on their own while
  // every other engine's entries stay valid and reusable — clearing the whole map here would
  // defeat that isolation for no correctness benefit.
  if (prev.version !== cfg.version || prev.themeKey !== cfg.themeKey) {
    localSvgByHash.clear()
  }
}

// FNV-1a, two 32-bit lanes over the SAME input seeded with different offset bases, concatenated
// into a 16-hex-char key (task 406's own prescription: "two 32-bit rounds with different offsets,
// concatenated"). Both lanes run the identical recurrence over the identical string, so they are
// CORRELATED, not two independent 32-bit hashes — effective entropy is meaningfully under a true
// 64 bits — but it is still an enormous improvement over a bare 32-bit key (a plain 32-bit hash
// collides at ~0.07% at this cache's realistic ~2500-entry size, and a collision silently paints
// the WRONG diagram — a correctness bug, not a miss). Fast, dependency-free, deterministic. The
// webview is the sole authority on the hash (it computes it for both PUT and GET); the host is a
// dumb hash-keyed store, so the only requirement is that the SAME (lang, source, themeKey,
// version) always yields the SAME string here. Folds every render determinant into the key.
// Widening the LANE COUNT/BIT-WIDTH (32→64-bit-class, as task 406 did) is a cache-format break —
// see the `version`-tag bump at the `DiagramCache` construction site (`src/extension.ts`) that
// forces a clean disk wipe alongside that kind of change, rather than silently mixing 8-char and
// 16-char keys. Reshuffling what feeds the `key` STRING below (task 408 — moving per-engine
// settings out of `themeKey` into a per-lang fragment) is a DIFFERENT, safe kind of change: the
// same width, different ingredients. Old (lang, source) pairs simply hash to a different string
// than before and stop matching — they don't collide with anything, they just become unreachable
// orphans (harmless; bounded by localSvgByHash's own LRU cap, and the host disk store's own cap).
// No host-side version bump needed for this class of change.
function fnv1aLane(key: string, offsetBasis: number): number {
  let h = offsetBasis
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    // FNV prime multiply via shifts, kept in 32-bit unsigned range.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h
}
export function hashOf(lang: string, source: string): string {
  // Task 408 — this engine's OWN configKeys only (empty for an engine with none, e.g. vega/
  // wavedrom/plantuml), so a setting owned by a DIFFERENT engine never appears in this key.
  const engineFragment = engineCacheKeyFragment(lang, cfg.options)
  // DELIBERATE: the fields are joined by `\x00` (NUL), NOT a space or any other printable
  // separator. A concatenation-based key needs a separator that CANNOT occur inside any field,
  // or field boundaries become ambiguous: e.g. themeKey="T X" + fragment="Y" and themeKey="T" +
  // fragment="X Y" both join to "T X Y" under a space — the SAME key string for DIFFERENT render
  // inputs, i.e. a hash COLLISION (the wrong cached SVG gets painted), not merely a miss. `\x00`
  // cannot appear in a lang slug, the version stamp, a theme key, an engine config value, or the
  // fenced source, so the split stays unambiguous by construction. Do NOT "clean this up" to a
  // space/pipe/anything printable — see render-cache-client.test.ts's "NUL-delimited fields
  // prevent boundary-shift collisions" regression test, which reproduces the exact collision
  // above if this separator is ever weakened.
  const key = `${lang}\x00${cfg.version}\x00${cfg.themeKey}\x00${engineFragment}\x00${source}`
  const lo = fnv1aLane(key, 0x811c9dc5) // the standard FNV-1a 32-bit offset basis
  const hi = fnv1aLane(key, 0x1000193 ^ 0xffffffff) // a distinct seed for the second lane (correlated, not independent — see header)
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0')
}

// A stable id for a diagram block within a document: `${lang}#${ordinal}`, ordinal = its index
// among the rendered `div.language-${lang}` targets in document order. Used ONLY host-side for
// the per-doc pinned current-set (fairness); the hash is the correctness layer, so a best-effort
// id is fine (editing a block keeps its id → its new render supersedes the old under the same id).
function diagramIdFor(
  root: ParentNode,
  wrapper: HTMLElement,
  lang: string,
): string {
  const all = Array.from(
    root.querySelectorAll<HTMLElement>(`div.language-${lang}[data-code]`),
  )
  const ordinal = Math.max(0, all.indexOf(wrapper))
  return `${lang}#${ordinal}`
}

// Post the finished renders we haven't reported yet. Engine-agnostic within CACHEABLE_LANGS:
// walk each rendered target that now holds an <svg>, hash its source, and PUT new hashes only.
function reportRenders(
  root: ParentNode,
  post: (msg: WebviewMessage) => void,
  reported: Set<string>,
): void {
  // The PUT itself is identical for both families — only FINDING the target and its source differs
  // (see each loop). Shared so a fix to the remember/dedup/post bookkeeping can't land on one family
  // and miss the other.
  const put = (
    lang: string,
    el: HTMLElement,
    source: string,
    diagramId: string,
  ): void => {
    const hash = hashOf(lang, source)
    // STALE-RENDER GUARD (task 436, measured). This observer fires on ANY mutation, including the
    // ones a theme flip causes — and the flip moves `themeKey` 400 ms BEFORE the re-theme runs, so
    // `hash` is already the new theme's key while the block still holds the render made under the
    // OLD one. Reporting that files a pre-flip SVG under the post-flip key: not a miss, a POISONED
    // entry that the next lookup paints straight back, and the diagram stops following the theme.
    // Measured in retheme-flip-matrix: all 12 D2 blocks, reported under the light key while still
    // painted dark.
    //
    // TWO conditions, because one is not enough for an ASYNC engine:
    //
    // 1. The STAMP — the key the block's current markup was produced under. A mismatch means it has
    //    not been redrawn since the flip. Dropped by every redraw entry point in both families
    //    (`clearRenderKey`: findBlocks / resetCustomBlocks for custom; reRenderLang, reRenderMermaid,
    //    reRenderFlowchart and adoptRender for native), so a real re-render reports normally.
    // 2. The rendered SVG must differ from what was last reported. Clearing the stamp announces the
    //    INTENT to redraw, and d2's WASM compile (~365 ms), mermaid's and plantuml's offscreen
    //    passes all leave the old picture on screen while they work — a report landing in that
    //    window would file the old markup under the new key with a cleared stamp, i.e. exactly the
    //    poison the stamp exists to stop.
    //
    // The comparison is over the block's SVG(s) ONLY, deliberately NOT el.innerHTML — measured
    // (d2-content-theme-flip.spec, 4/6 flake): rethemeCacheFirst's own MISS branch appends a
    // `vmarkd-cache-miss` comment to the reserved wrapper to re-fire the observer, which mutated
    // innerHTML, so during the async re-render window the STILL-STALE svg read as "changed" and slipped
    // past this guard while findBlocks had already cleared the stamp (defeating condition 1). Comparing
    // the concatenated svg outerHTML(s) ignores that trigger node and any other non-render sibling, so
    // an un-redrawn block is correctly seen as unchanged and skipped until the engine actually swaps the
    // svg. The no-svg case (a d2 error box) never reaches here — the loops below require an <svg>.
    //
    // Comparing markup ALONE (even svg-only) was tried first and is not sound in the other direction: a
    // cached paint re-namespaces the svg's ids (task 373) and the sizing passes rewrite width/height, so
    // a merely REPAINTED block reads as changed — which is why the STAMP (condition 1) is the primary
    // guard and this is only its async-window backstop.
    const stamp = el.getAttribute(RENDER_KEY_ATTR)
    if (stamp !== null && stamp !== cfg.themeKey) return
    // Task 491 — a `vmarkd-cache-miss` comment still present means resolveRequest's miss branch
    // un-reserved this block (cleared data-processed + stamped a re-fire comment) but the engine's
    // re-render has NOT swapped innerHTML yet. The svg is still the PRE-flip bytes while cfg.themeKey
    // is already the post-flip one — filing them now is the exact stale-render poison the guard
    // exists to stop. The stamp was cleared by findBlocks (render starting) so condition 1 can't
    // catch it, and `svgOnly` deliberately ignores the comment node (it's a non-render sibling), so
    // condition 2 can't see it either — check for the comment explicitly. Once renderD2 replaces
    // innerHTML the comment is gone with the old svg and this block reports normally.
    if (el.innerHTML.includes('vmarkd-cache-miss')) return
    const svgMarkup = svgOnly(el)
    if (stamp === null && lastPutMarkup.get(el) === svgMarkup) return
    el.setAttribute(RENDER_KEY_ATTR, cfg.themeKey)
    lastPutMarkup.set(el, svgMarkup)
    // Remember it locally even when the host already has it — the host copy is only readable via
    // an async round-trip that no longer happens after open (task 365).
    rememberLocal(localKey(lang, source), el.innerHTML)
    if (reported.has(hash)) return
    reported.add(hash)
    post({
      command: 'diagram-render-cached',
      diagramId,
      hash,
      // Same STEM the local cache stores (see rememberLocal / stripSvgIdNamespace). Posting the
      // painted markup verbatim let a `-vmN` namespace ride into the HOST cache, and the next paint
      // from that entry added its own on top — `id="…-vm7-vm9"`. Ids stayed unique, so nothing broke
      // visibly, but the markup grew with every mode switch and the two panes stopped being
      // byte-comparable, which is what mode-switch-render-reuse.spec.ts asserts.
      svg: stripSvgIdNamespace(el.innerHTML),
    })
  }
  for (const lang of CACHEABLE_LANGS) {
    for (const wrapper of Array.from(
      root.querySelectorAll<HTMLElement>(`div.language-${lang}[data-code]`),
    )) {
      if (!wrapper.querySelector('svg')) continue // not (yet) rendered
      const source = wrapper.getAttribute('data-code') ?? ''
      if (!source) continue
      put(lang, wrapper, source, diagramIdFor(root, wrapper, lang))
    }
  }
  // Native engines (incl. plantuml): the render target is the preview-pane `.language-<lang>` (now
  // holding an <svg>); hash from the editable marker source (survives render, matches the reserve).
  // Ordinal among that lang's previews in document order = a stable diagramId for the host pinned set.
  for (const lang of NATIVE_RESERVE_LANGS) {
    nativePanes(root, lang).forEach((pane, ord) => {
      const live = pane.querySelector<HTMLElement>(`.language-${lang}`)
      if (!live?.querySelector('svg')) return
      // Task 466 — read the source off `live` itself (`nativePanes` is currently scoped to
      // `PREVIEW_PANE_SEL`, IR/WYSIWYG only, which pair 1:1 with `live` anyway), not a pane-wide
      // first-match query — see `nativeSourceForLive`'s own comment for why that matters the moment
      // this scope ever widens to include `.vditor-preview`.
      const source = nativeSourceForLive(live, lang)
      if (!source) return
      // Remembering matters here for the same reason as above: this is what a LATER pane (the full
      // Preview, which the open-path reserve never covers) reuses instead of running the engine again.
      put(lang, live, source, `${lang}#${ord}`)
    })
  }
}

// Task 365 — the SAME-SESSION, in-memory half of the cache: hash → the SVG markup this webview
// already produced. The host store is keyed identically but only answers ASYNCHRONOUSLY (a
// postMessage round-trip) and only at open, so it cannot serve a pane that is built LATER — which is
// exactly what a mode switch does. Measured consequence before this map existed: every d2 block in
// the full Preview pane carried `reserve: null, hit: null` (it never reached the cache at all) and
// was laid out a SECOND time by the engine, and 3 of 12 came out narrower than their IR twin
// (375→342, 247→197, 863→851px) — the user's "diagrams shift left / labels overflow their box".
// Reusing the markup makes the two panes byte-identical BY CONSTRUCTION instead of hoping two
// independent text measurements agree, and skips a full redundant layout pass per diagram.
const localSvgByHash = new Map<string, string>()
// Editing a diagram re-renders it on every settle, and each intermediate source is a distinct hash,
// so the map would otherwise grow without bound over a long session (SVGs run 2–17 KB here). Cap it
// and evict the least-recently-used — Map iterates in insertion order, and rememberLocal re-inserts
// on every touch, so the first key is always the coldest.
const LOCAL_CACHE_MAX = 200

// The local map's key. TRIMMED, unlike the host key: a custom block's source comes from findBlocks
// (already trimmed) but a native block in the full Preview pane is read straight off its textContent,
// which still carries the fence's trailing newline. Trimming both ends makes the two agree instead of
// missing on whitespace. The host key is left alone — it is the webview's contract with the store.
function localKey(lang: string, source: string): string {
  return hashOf(lang, source.trim())
}

function rememberLocal(hash: string, svg: string): void {
  const clean = stripSvgIdNamespace(svg)
  localSvgByHash.delete(hash)
  localSvgByHash.set(hash, clean)
  if (localSvgByHash.size > LOCAL_CACHE_MAX) {
    const oldest = localSvgByHash.keys().next()
    if (!oldest.done) localSvgByHash.delete(oldest.value)
  }
}

// Strip a paint namespace back off. The map is fed from `wrapper.innerHTML` AFTER a paint, so without
// this the `-vmN` suffixes ACCUMULATE across mode switches (`m-vm10-vm12`) — ids stay unique, but the
// markup grows and the panes stop being comparable. Storing the STEM keeps the cache stable and makes
// every paint's namespace exactly one level deep.
export function stripSvgIdNamespace(html: string): string {
  return html.replace(/-vm\d+(?=["')])/g, '')
}

// Re-namespace the REFERENCED ids inside a painted SVG. The cached markup is a VERBATIM copy of a
// render that is already live in another pane, so painting it duplicates ids — and an `url(#marker)`
// reference resolves to the FIRST match in DOCUMENT ORDER, i.e. the ORIGINAL pane's element. That
// pane is `display:none` while the other is shown, and a marker inside a display:none subtree is not
// painted: mermaid and flowchart lost every ARROWHEAD after a mode switch (task 373). Measured then:
// the Preview pane's `url(#…-pointEnd)` owner was the IR pane's element, the id present twice.
// Every rewrite is anchored on the closing quote / paren so an id that is a PREFIX of another
// (`111` vs `1111`) can never be partially rewritten.
let paintSeq = 0
export function uniquifySvgIds(html: string): string {
  // Only ids that something actually REFERENCES are renamed — those are the only ones whose
  // resolution another pane's copy can steal. Renaming EVERY id (what this first did) broke mermaid
  // (task 374): mermaid emits its whole stylesheet as rules SCOPED under the root svg's id
  // (`#mermaid-abc .node rect{fill:…}`), and that selector lives in CSS TEXT, so renaming the id
  // attribute alone orphaned every rule — black boxes, default font. Rewriting ids inside CSS text is
  // NOT safely possible either: flowchart emits `id="111"` and `#111` is equally a valid hex colour,
  // so such a pass would corrupt `fill:#111`.
  // Leaving unreferenced duplicates is safe: reuse only fires on an identical hash (lang + version +
  // themeKey + source), so both panes' style blocks are byte-identical and scope-collide harmlessly.
  // Verified across all 33 cached blobs: the referenced-id set and the CSS-selector-id set are
  // DISJOINT (every `#id` inside a <style> is either the root scope, which nothing url-references, or
  // an `url(#…)` form, which the reference rewrite below covers anyway).
  const ids = new Set<string>()
  for (const m of html.matchAll(/url\(#([^)]+)\)/g)) ids.add(m[1])
  for (const m of html.matchAll(/(?:xlink:)?href="#([^"]+)"/g)) ids.add(m[1])
  if (!ids.size) return html
  const suffix = `-vm${++paintSeq}`
  let out = html
  for (const id of ids) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out
      .replace(new RegExp(`(\\sid=")${esc}(")`, 'g'), `$1${id}${suffix}$2`)
      .replace(new RegExp(`url\\(#${esc}\\)`, 'g'), `url(#${id}${suffix})`)
      .replace(
        new RegExp(`((?:xlink:)?href=")#${esc}(")`, 'g'),
        `$1#${id}${suffix}$2`,
      )
  }
  return out
}

// Paint a cached SVG into a LIVE, already-laid-out render target. Shared by the host-reply HIT path
// and the local same-session paint so the two can never drift — in particular `data-code`, whose
// absence is the task-361 bug (a painted node with no source re-renders EMPTY on the next theme
// flip, because reRenderLang clears innerHTML and the patched renderers read data-code).
function paintCached(
  wrapper: HTMLElement,
  svg: string,
  source: string | undefined,
): void {
  // Ids must be unique per paint — see uniquifySvgIds (arrowheads vanish otherwise).
  wrapper.innerHTML = uniquifySvgIds(svg)
  if (source) wrapper.setAttribute('data-code', source)
  // Keeps the node Lute-invisible (getValue must be byte-identical present vs absent).
  wrapper.setAttribute('data-render', '1')
  wrapper.setAttribute('data-vmarkd-cache-hit', '1')
  wrapper.removeAttribute('data-vmarkd-cache-reserve')
  // Stamp the render key these bytes came out under — the CURRENT key, since both cache sources are
  // key-scoped (the host GET hashes with it; localSvgByHash is dropped whenever it changes). Without
  // it, a HIT that repaints one theme's bytes into a block still stamped ANOTHER theme leaves a wrong
  // stamp behind, and a later flip whose new key happens to equal that stale stamp then passes the
  // guard's condition-1 and files the stale svg as fresh — a poison the SVG-only condition 2 can't
  // catch either (the block genuinely holds different bytes than last reported). Reachable via
  // flip A -> B -> A -> B, where the flip-back-to-A HIT stamps the block A while it shows A's bytes;
  // stamping here makes condition 1 reject the stale render on the next flip. (paintCached runs on
  // both the open-path HIT and the deferred cache-first re-theme HIT, so this covers both.)
  wrapper.setAttribute(RENDER_KEY_ATTR, cfg.themeKey)
  // Task 491 — a cache-painted block must have a `lastPutMarkup` baseline or the stale-render
  // guard's condition 2 (`lastPutMarkup.get(el) === svgOnly(el)`, see reportRenders' put) can never
  // hold for it: `lastPutMarkup` is only ever set by put(), so a block painted from the local cache
  // (paintLocalHits on a mode switch / the deferred cache-first re-theme HIT) reads `undefined`
  // there. A later flip then clears the stamp (findBlocks, as renderD2 starts) and reportRenders
  // treats the still-pre-flip svg as "changed" → files it under the post-flip key — the exact
  // poison the task-436 guard exists to stop. Mirror what put() records so condition 2 sees the
  // paint's own bytes and correctly skips the block until the engine actually swaps the svg.
  lastPutMarkup.set(wrapper, svgOnly(wrapper))
  // A cached paint runs NO renderer, so nothing re-applies PlantUML's sprite backing — and the
  // stored bytes may predate it (the composite is async and the PUT observer watches childList
  // only, so it never sees the later href swap). Re-apply it here; it skips sprites that already
  // carry the marker, so a cache that did hold the final markup pays nothing. See backSpritesIn.
  // Gated with the render path's own post-render pass (PUML_POST_RENDER_THEMING, currently off): the
  // backing exists to make an adapted dark card readable, so re-applying it after a cached paint while
  // the render path no longer applies it would make the WARM result diverge from the cold one.
  if (
    PUML_POST_RENDER_THEMING &&
    wrapper.classList.contains('language-plantuml')
  )
    backSpritesIn(wrapper)
}

// Guards the re-entrancy that paintCached's own innerHTML write would otherwise cause: the paint
// mutates the subtree the observer below is watching, so its callback re-enters. (Terminating even
// without this — a painted block is data-processed, so findBlocks skips it on the next pass — but
// the guard keeps a mode switch to ONE pass instead of two.)
let painting = false

// SYNCHRONOUSLY fill any freshly-appeared cacheable block from this session's own renders. Called
// straight from the MutationObserver callback, NOT from the rAF below: observeCustomDiagrams
// schedules its render pass on rAF too, so a paint deferred to rAF would race the engine it exists
// to pre-empt, whereas a mutation callback always runs first. `data-processed` (set by findBlocks'
// caller contract, here by us) is what keeps the engine off the block afterwards.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: synchronous local-cache-hit paint with the painting/typing/empty-cache pre-empt guards; pre-existing (task 469 baseline)
function paintLocalHits(root: ParentNode): void {
  // Nothing rendered yet (the open path — the host reply owns that), or the user is mid-edit: a
  // block being typed into changes hash every keystroke, so a lookup can only miss, and the
  // per-mutation findBlocks walk is pure cost. observeCustomDiagrams defers on the same signal.
  if (painting || !localSvgByHash.size || isTyping()) return
  painting = true
  try {
    // Look the source up in the same-session map and, on a hit, reserve exactly as the open path
    // does — so neither our own observer nor Vditor's code-render re-runs the engine over the node
    // we just filled. Shared by both families; only the target/source lookup differs below.
    const paintIfCached = (
      lang: string,
      el: HTMLElement,
      source: string,
    ): void => {
      const svg = localSvgByHash.get(localKey(lang, source))
      if (!svg) return
      el.setAttribute('data-processed', 'true')
      paintCached(el, svg, source)
    }
    for (const lang of CACHEABLE_LANGS)
      for (const { wrapper, code } of findBlocks(root, lang))
        paintIfCached(lang, wrapper, code)
    // The Vditor-NATIVE engines in any pane BUILT AFTER OPEN. The open-path reserve only ever saw
    // the pane that existed at init, so both the full Preview (`.vditor-preview`) and the WYSIWYG
    // collapsed previews built by a mode switch went to the engine instead. Both diverged the same
    // way d2 did — measured on the all-renderers fixture, abc rendered 451.99×98.83 in IR against
    // 420.02×87.83 in Preview and 420.02×72.83 in WYSIWYG. (abc is not even self-consistent between
    // two fresh renders: the same pane measured 72.83 and 87.83 on consecutive runs, so comparing
    // two engine passes could never have been made to agree — reuse is the only fix.)
    // There is no editable marker sibling to read in the full Preview, but in EVERY pane an
    // un-rendered target still holds its own fence source as textContent, which is exactly what the
    // IR render was hashed under. Deliberately NOT graphviz: its Vditor renderer calls
    // Viz.instance() even on a reserved block, and that double-invoke hangs the webview (task 184).
    for (const lang of NATIVE_RESERVE_LANGS) {
      for (const live of Array.from(
        root.querySelectorAll<HTMLElement>(
          `:is(${ANY_PREVIEW_PANE_SEL}) .language-${lang}:not([data-processed="true"])`,
        ),
      )) {
        // Already drawn (we lost the race) → leave it; the hash would miss anyway, since textContent
        // is now the rendered markup rather than the source.
        if (live.querySelector('svg')) continue
        // NOTE the trim: an un-rendered native target holds its fence source as textContent, and
        // paintCached stores the TRIMMED form as data-code — the lookup key stays untrimmed because
        // that is what the IR render was hashed under.
        const source = live.textContent ?? ''
        const svg = localSvgByHash.get(localKey(lang, source))
        if (!svg) continue
        live.setAttribute('data-processed', 'true')
        paintCached(live, svg, source.trim())
      }
    }
  } finally {
    painting = false
  }
}

interface PendingBlock {
  wrapper: HTMLElement
  hash: string
  // The diagram language — for a native miss, picks the offscreen renderer.
  lang: string
  // 'custom' = a findBlocks div (d2 etc.); its miss re-triggers our own observer. 'native' =
  // a Vditor-engine preview target; its miss re-renders offscreen (Vditor won't re-fire).
  // 'plantuml' = a native target whose miss re-renders LIVE via plantumlRender (see NATIVE_RESERVE_LANGS).
  kind: 'custom' | 'native' | 'plantuml'
  // The exact source that produced `hash` — needed to re-render a native block on a miss.
  source: string
}
// requestId → the blocks awaiting a host reply. One entry per open (a fresh reserve).
const pending = new Map<string, { blocks: PendingBlock[]; timer: number }>()
let requestSeq = 0

// Task 433 — how each cache request got resolved: by a real host reply, or by the 2000 ms fallback
// that exists only so a dropped reply can't leave every diagram blocked forever. Exposed on window so
// a real-VS-Code spec can assert `timeout === 0` across a run instead of us assuming the timer is
// unreachable. Two counters; no cost on the render path.
const cacheResolveStats = { reply: 0, timeout: 0 }
;(
  window as unknown as { __vmarkdCacheResolveStats?: typeof cacheResolveStats }
).__vmarkdCacheResolveStats = cacheResolveStats

// RESERVE the cacheable blocks + ask the host for their cached SVGs. Runs on open BEFORE the
// engine render pass, so `data-processed="true"` blocks the engine until we know hit/miss.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: reserves every cacheable block + builds the host request across per-block/per-engine eligibility branches; pre-existing (task 469 baseline)
function reserveAndRequest(
  root: ParentNode,
  post: (msg: WebviewMessage) => void,
): void {
  const blocks: PendingBlock[] = []
  const hashes: string[] = []
  // The RESERVE itself is identical for both families: hash, block the engine
  // (`data-processed`), mark the block ours to unblock on a miss, and queue it. Only the way a
  // target and its source are found differs (see each loop).
  const reserve = (
    el: HTMLElement,
    lang: string,
    source: string,
    kind: PendingBlock['kind'],
  ): void => {
    const hash = hashOf(lang, source)
    el.setAttribute('data-processed', 'true')
    el.setAttribute('data-vmarkd-cache-reserve', '1')
    blocks.push({ wrapper: el, hash, lang, kind, source })
    hashes.push(hash)
  }
  for (const lang of CACHEABLE_LANGS) {
    // findBlocks converts <code>→<div>, sets data-code, and skips edit-surface markers +
    // already-processed blocks — the exact same view the engine's renderX() sees.
    // Reserving blocks the engine: findBlocks / Vditor's code-render both skip data-processed.
    for (const { wrapper, code } of findBlocks(root, lang))
      reserve(wrapper, lang, code, 'custom')
  }
  // Native engines (mermaid/abc/flowchart + plantuml): reserve each preview-pane render target the
  // SAME way (data-processed blocks Vditor's deferred render pass — and our plantuml loop, which skips
  // data-processed blocks up front). The render target's textContent is overwritten by the SVG, so hash
  // from the editable marker source (nativeSourceForLive, task 466) — the value that survives and that
  // reportRenders re-hashes on PUT. Skip a pane already holding an <svg> (already drawn). plantuml's
  // miss re-renders live (kind 'plantuml'); the others render offscreen (kind 'native').
  for (const lang of NATIVE_RESERVE_LANGS) {
    for (const pane of nativePanes(root, lang)) {
      const live = pane.querySelector<HTMLElement>(`.language-${lang}`)
      if (!live || live.querySelector('svg')) continue
      const source = nativeSourceForLive(live, lang)
      if (source == null) continue
      reserve(live, lang, source, lang === PLANTUML ? 'plantuml' : 'native')
    }
  }
  if (!blocks.length) return
  sendRequest(blocks, hashes, post)
}

// Post one cache request and arm its fallback. Shared by the open-path reserve above and the
// theme-flip reserve below (task 436) so both are unblocked by the same timer and counted by the
// same stats — a second copy of this bookkeeping is exactly how one path ends up un-timed.
function sendRequest(
  blocks: PendingBlock[],
  hashes: string[],
  post: (msg: WebviewMessage) => void,
): void {
  const requestId = `rc-${++requestSeq}`
  // Never leave a block reserved forever if the host never replies (e.g. flag mismatch):
  // treat the whole request as a miss after a short grace period.
  // Task 433 — every block above is now reserved (`data-processed`, engines blocked) until
  // resolveRequest fires. If the host reply is ever dropped, THIS timer is the only thing that
  // unblocks them, i.e. a worst case of 2 s of inert diagrams. No evidence it ever fires (the host
  // side is synchronous in-memory lookups), so instead of pre-emptively tightening it, count it:
  // the fallback path is recorded on window (read by diagram-cache-reply-source.spec.ts) and — since
  // it would be a real anomaly, not routine — also surfaced to the Output channel.
  const timer = window.setTimeout(() => {
    cacheResolveStats.timeout++
    logToHost(
      `render-cache: host reply for ${requestId} never arrived — falling back to a full miss after 2000 ms (task 433)`,
    )
    resolveRequest(requestId, {})
  }, 2000)
  pending.set(requestId, { blocks, timer })
  post({ command: 'diagram-cache-get', requestId, hashes })
}

/**
 * Task 436 — ask the cache BEFORE re-rendering a custom diagram after a theme flip.
 *
 * The re-theme path used to clear every rendered block and re-invoke the engine unconditionally, so
 * flipping back to a theme this session (or a previous one) already rendered still paid a full D2
 * WASM compile + layout per diagram. This reserves the ALREADY-RENDERED blocks and asks the host,
 * exactly as the open path does; hits are painted, misses fall through to the live engine.
 *
 * Two things make this safe that a naive "look it up first" would get wrong:
 *
 * 1. **The local map cannot serve this.** `setRenderCacheConfig` DROPS `localSvgByHash` whenever
 *    `themeKey` changes, and a flip changes `themeKey` by definition — so a same-session lookup can
 *    only miss, and the host round-trip is the only path to a hit. (The caller must therefore have
 *    updated the cache config BEFORE calling this, or the hash is the pre-flip one and a "hit"
 *    would paint the colours the flip was supposed to change. Both flip sites now do — see
 *    message-router's set-theme/config-changed handlers.)
 * 2. **Nothing is un-reserved while we wait.** The blocks keep the `data-processed` they already
 *    carry, so neither `observeCustomDiagrams` nor `paintLocalHits` can start an engine pass on
 *    them mid-flight. The open path gets this ordering from `installRenderCache` running before the
 *    first render pass; mid-session there is no such guarantee, so it is bought by never opening a
 *    window in which the block looks renderable. Until the reply lands the user keeps seeing the
 *    PREVIOUS render — the same thing that happens today during the 400 ms deferral and the async
 *    compile that follows it.
 *
 * Blocks are hashed from `data-code`, the same attribute `reportRenders` hashes on PUT, so the GET
 * key and the PUT key agree by construction.
 *
 * @returns true when it took the langs over (the caller must NOT live-re-render), false when there
 * was nothing to reserve or the cache client is not installed — then the caller re-renders as before.
 */
export function rethemeCacheFirst(
  root: ParentNode,
  langs: readonly string[],
): boolean {
  if (!cachePost) return false
  rethemeCacheStats.calls++
  const blocks: PendingBlock[] = []
  const hashes: string[] = []
  for (const lang of langs) {
    // A non-cacheable engine has nothing to ask for. geojson/topojson are `cacheable: false` in the
    // registry (their render is a live Leaflet map, not an SVG), which is why the geo half of task
    // 411's cache proposal is void rather than unimplemented.
    if (!CACHEABLE_LANGS.includes(lang)) continue
    for (const el of Array.from(
      root.querySelectorAll<HTMLElement>(`div.language-${lang}[data-code]`),
    )) {
      const source = el.getAttribute('data-code') ?? ''
      if (!source) continue
      // Not yet drawn (a first render still in flight) → leave it alone: it is already going to
      // produce a render for the CURRENT theme, and reserving it would only race that.
      if (!el.querySelector('svg')) continue
      const hash = hashOf(lang, source)
      el.setAttribute('data-vmarkd-cache-reserve', '1')
      // kind 'custom' deliberately: the miss branch it takes (un-reserve + a throwaway node to
      // re-fire the observer) is exactly right here too, and the engine overwrites the stale
      // markup that is still in the block.
      blocks.push({ wrapper: el, hash, lang, kind: 'custom', source })
      hashes.push(hash)
    }
  }
  if (!blocks.length) return false
  rethemeCacheStats.reserved += blocks.length
  sendRequest(blocks, hashes, cachePost)
  return true
}

// Task 436 — how often the flip lookup ran and how many blocks it took over, on window for a
// real-VS-Code spec to read. Same posture as __vmarkdCacheResolveStats (task 433). Hit/miss counts
// are deliberately NOT here: the useful number is the one on the other side of the decision — how
// many live engine renders a flip caused (__vmarkdD2RenderStats) — and a hit/miss counter shared
// with the open path would only invite reading one path's numbers as the other's.
const rethemeCacheStats = { calls: 0, reserved: 0 }
;(
  window as unknown as { __vmarkdRethemeCacheStats?: typeof rethemeCacheStats }
).__vmarkdRethemeCacheStats = rethemeCacheStats

// Apply a host reply (or the timeout's empty map): paint hits, unblock misses.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: applies a host reply or timeout across the per-block hit/miss/already-resolved branches; pre-existing (task 469 baseline)
function resolveRequest(
  requestId: string,
  svgByHash: Record<string, string>,
): void {
  const entry = pending.get(requestId)
  if (!entry) return
  pending.delete(requestId)
  window.clearTimeout(entry.timer)
  // Native misses grouped by lang → one offscreen sandbox pass per engine.
  const nativeMisses = new Map<
    string,
    { live: HTMLElement; source: string }[]
  >()
  // A plantuml miss un-reserves in the loop; a single plantumlRender pass below renders every unblocked
  // block (it re-scans + skips the still-reserved hits), so we only need to know IF one missed.
  let plantumlMissed = false
  for (const { wrapper, hash, lang, kind, source } of entry.blocks) {
    const svg = svgByHash[hash]
    if (typeof svg === 'string') {
      if (wrapper.querySelector('svg')) {
        // The engine rendered this block despite our reserve → the reserve-beats-deferred-
        // render ordering contract broke (see the finish-init.ts install comment + the
        // NATIVE_CACHE_LANGS note above). The cached paint below still wins visually —
        // surface the violation instead of hiding it (185/2d).
        logToHost(
          `render-cache: ordering violated — a reserved ${lang} block was engine-rendered before the cache reply`,
        )
      }
      // HIT — paint the cached SVG into the LIVE constrained node (offscreen-swap discipline;
      // no detached overlay → correct size, no 183 jump). Stays data-processed so the engine
      // never runs it. paintCached also stamps data-code (the task-361 trap) and the
      // data-vmarkd-cache-hit / data-render attributes — see its own comment.
      // NOTE this site is invisible to the e2e suite: playwright.config sets VMARKD_E2E=1 →
      // DiagramCache freshStart wipes the store per test, so every suite render is a MISS and only a
      // real user's re-open takes this branch.
      paintCached(wrapper, svg, source)
      // A pane built LATER (mode switch) can reuse it without another round-trip (task 365).
      rememberLocal(localKey(lang, source), svg)
    } else if (kind === 'native') {
      // MISS on a NATIVE block: Vditor's one-shot open render already skipped it (we reserved
      // it) and won't re-fire, so we must render it ourselves. Render the source OFFSCREEN and
      // swap it in (no in-place collapse → no scroll jump); keep data-processed so Vditor never
      // touches it. The reportRenders observer then PUTs the fresh SVG to the host cache.
      wrapper.removeAttribute('data-vmarkd-cache-reserve')
      const arr = nativeMisses.get(lang) ?? []
      arr.push({ live: wrapper, source })
      nativeMisses.set(lang, arr)
    } else if (kind === 'plantuml') {
      // MISS on a PLANTUML block — un-reserve and let the live re-render below draw it. Removing
      // data-processed is enough: plantumlRender re-scans, skips the still-reserved hits, and renders
      // this (now unblocked) block with its own placeholder. No offscreen pass (its early data-processed
      // + clean skip make offscreen wrong AND unnecessary — see NATIVE_RESERVE_LANGS).
      wrapper.removeAttribute('data-processed')
      wrapper.removeAttribute('data-vmarkd-cache-reserve')
      plantumlMissed = true
    } else {
      // MISS on a CUSTOM block — unblock the engine. Removing data-processed alone won't re-fire
      // the custom-diagram observer (it watches childList, not attributes), so append a throwaway
      // node to trigger a fresh pass; the engine's renderX() then overwrites innerHTML.
      wrapper.removeAttribute('data-processed')
      wrapper.removeAttribute('data-vmarkd-cache-reserve')
      wrapper.appendChild(document.createComment('vmarkd-cache-miss'))
    }
  }
  if (nativeMisses.size || plantumlMissed) {
    const cdn =
      cfg.cdn ||
      (window as unknown as { vditor?: { options?: { cdn?: string } } }).vditor
        ?.options?.cdn ||
      ''
    for (const [lang, jobs] of nativeMisses) {
      renderNativeJobs(lang, jobs, cdn, cfg.mode)
    }
    // Re-render every unblocked plantuml block in one pass — plantumlRender skips the reserved hits
    // and (via loadScript dedup + its render queue) serialises the misses just like a normal open.
    if (plantumlMissed) plantumlRender(cacheRoot ?? document, cdn)
  }
}

// Route a host `diagram-cache-hits` reply (called from main.ts's message dispatch).
export function applyCacheHits(
  requestId: string,
  svgByHash: Record<string, string>,
): void {
  // A hit we paint has already been reported (it IS the host's copy) — no need to echo it back.
  for (const h of Object.keys(svgByHash)) reportedHashes.add(h)
  // Task 433: a genuine host reply, i.e. the normal path. Counted against `timeout` so a spec can
  // assert the fallback timer is unreachable in practice rather than us assuming it.
  if (pending.has(requestId)) cacheResolveStats.reply++
  resolveRequest(requestId, svgByHash)
}

// Hashes already known to the host (reported renders + served hits) — dedupes PUTs.
const reportedHashes = new Set<string>()

// The SVG(s) each block was last reported with — condition 2 of the stale-render guard in `put`.
// SVG-only (not innerHTML) on purpose: the reserve/miss path appends a trigger comment that would
// otherwise read as a markup change and defeat the guard — see the guard comment in `put`. A WeakMap:
// a block that leaves the DOM takes its entry with it.
const lastPutMarkup = new WeakMap<HTMLElement, string>()

// The block's rendered SVG(s), concatenated — the stale-render guard's comparison key. Concatenation
// (not first-svg) so a block that ever holds more than one <svg> can't hide a real change; comments and
// other non-render siblings (the reserve/miss trigger node) are excluded by construction.
function svgOnly(el: HTMLElement): string {
  return Array.from(el.querySelectorAll('svg'))
    .map((s) => s.outerHTML)
    .join('')
}

// Install the cache client on the editor mount: reserve+request on open, then observe for
// completed renders to PUT. Always on (task 184 graduated from an opt-in flag). Bound to the
// stable `#app` (same rationale as the other observers) so it survives mode switches.
export function installRenderCache(
  appEl: HTMLElement | null | undefined,
  post: (msg: WebviewMessage) => void,
): () => void {
  // No editor root mounted yet — nothing to observe; hand back a no-op
  // disposer so callers can always call the returned teardown unconditionally.
  if (!appEl)
    return () => {
      /* no-op disposer */
    }
  // Capture the editor root for a plantuml cache-miss's live re-render (resolveRequest runs later,
  // from the host reply / timeout, with no root in hand).
  cacheRoot = appEl
  cachePost = post
  // Reserve + request BEFORE the custom-diagram observer runs its first pass (finish-init
  // installs this earlier). Runs once per (re-)init — observers.set disposes the prior install.
  reserveAndRequest(appEl, post)
  // PUT observer: after any render lands, report new SVGs. rAF-debounced + idempotent
  // (dedup by reported hash), so the wider #app scope is cheap.
  let raf = 0
  const schedule = () => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      reportRenders(appEl, post, reportedHashes)
    })
  }
  const obs = new MutationObserver(() => {
    // SYNCHRONOUS first — a mode switch builds a whole new pane in one batch, and this must land
    // before observeCustomDiagrams' rAF pass re-runs the engine over it (task 365).
    paintLocalHits(appEl)
    schedule()
  })
  obs.observe(appEl, { childList: true, subtree: true })
  schedule()
  return () => {
    obs.disconnect()
    if (raf) cancelAnimationFrame(raf)
  }
}
