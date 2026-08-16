// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import type { WebviewMessage } from '../../../src/shared/protocol'
import {
  clearRenderKey,
  findBlocks,
  RENDER_KEY_ATTR,
} from '../diagram-kit/diagram-dom'

// Stub native-offscreen so the native cache-miss path can be asserted without loading the real
// engines (which need addScript + a live DOM). renderNativeJobs is spied; NATIVE_CACHE_LANGS is a
// plain constant. `nativeSourceForLive` is NOT stubbed here (task 466 moved it out of
// native-offscreen.ts into diagram-surfaces.ts, which has no heavy engine imports) — render-cache-
// client.ts now imports the REAL one, so this test exercises the actual source-resolution logic
// instead of a hand-copied stand-in (which had already drifted from the real selector constants
// before this move — see diagram-surfaces.ts's `blockScopeOf`/`BLOCK_WRAPPER_SEL`). vi.hoisted so
// the spy exists before the hoisted vi.mock factory references it.
const { renderNativeJobs } = vi.hoisted(() => ({ renderNativeJobs: vi.fn() }))
vi.mock('../diagram-kit/native-offscreen', () => ({
  renderNativeJobs,
  NATIVE_CACHE_LANGS: ['mermaid', 'abc', 'flowchart'],
}))

// Stub plantumlRender so the plantuml live-MISS path (re-call plantumlRender, not renderNativeJobs)
// can be asserted without loading the real ~7 MB TeaVM engine in jsdom. backSpritesIn comes from the
// same module and runs after every cached paint (task 382 — the cache can store a sprite whose async
// composite had not landed); stub it too and assert the paint calls it.
const { plantumlRender, backSpritesIn } = vi.hoisted(() => ({
  plantumlRender: vi.fn(),
  backSpritesIn: vi.fn(),
}))
// PUML_POST_RENDER_THEMING gates the post-cache sprite re-apply; mirror the real module's value so a
// flip there is exercised here rather than silently mocked away.
vi.mock('./plantuml/plantuml-render', () => ({
  plantumlRender,
  backSpritesIn,
  PUML_POST_RENDER_THEMING: false,
}))

import {
  hashOf,
  setRenderCacheConfig,
  installRenderCache,
  applyCacheHits,
  rethemeCacheFirst,
} from './render-cache-client'

// NOTE: painted ids that something REFERENCES carry a per-paint `-vmN` namespace since task 373
// (duplicate ids across panes made url(#…) resolve into the hidden pane and arrowheads vanished).
// Unreferenced ids are deliberately left alone — mermaid scopes its stylesheet on one (task 374).
// Task 184 — webview cache client: hashOf determinism/sensitivity + the reserve→hit/miss paint
// path (the offscreen-swap into the LIVE constrained div, data-render="1" for byte-identity).

describe('hashOf — determinism + sensitivity', () => {
  beforeEach(() =>
    setRenderCacheConfig({ version: 'v1', themeKey: 'dark|github' }),
  )

  it('is deterministic for the same (lang, source, themeKey, version)', () => {
    expect(hashOf('d2', 'a -> b')).toBe(hashOf('d2', 'a -> b'))
  })
  it('changes when the SOURCE changes', () => {
    expect(hashOf('d2', 'a -> b')).not.toBe(hashOf('d2', 'a -> c'))
  })
  it('changes when the LANG changes', () => {
    expect(hashOf('d2', 'x')).not.toBe(hashOf('nomnoml', 'x'))
  })
  it('changes when the THEME key changes', () => {
    const a = hashOf('d2', 'x')
    setRenderCacheConfig({ themeKey: 'light|github' })
    expect(hashOf('d2', 'x')).not.toBe(a)
  })
  it('changes when the engine VERSION changes', () => {
    setRenderCacheConfig({ themeKey: 'dark|github' })
    const a = hashOf('d2', 'x')
    setRenderCacheConfig({ version: 'v2' })
    expect(hashOf('d2', 'x')).not.toBe(a)
  })
  // Task 406 — a 32-bit hash (8 hex chars) collides at ~0.07% over the cache's realistic entry
  // count (~2500 at the 50MB cap); a collision silently paints the WRONG diagram. Widen to a
  // 64-bit-class key so the collision probability is irrelevant at any realistic cache size.
  it('emits a 64-bit-class hex key (16 hex chars) — task 406 collision-width fix', () => {
    expect(hashOf('d2', 'a -> b')).toMatch(/^[0-9a-f]{16}$/)
  })
  it('zero collisions across a corpus of distinct sources (task 406)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 2000; i++) {
      const h = hashOf('d2', `node${i} -> next${i}: label number ${i}`)
      expect(seen.has(h), `collision at i=${i}`).toBe(false)
      seen.add(h)
    }
  })
})

// Task 408 — a per-lang cache-key fragment (engineCacheKeyFragment, driven by the engine's own
// registry-declared configKeys) so a single engine's setting change only invalidates ITS OWN
// cached hashes, not every other engine's. Before this, `themeKey` folded EVERY engine's settings
// into one global string, so e.g. a D2 layout change silently nuked mermaid's/vega's/etc. cache
// entries too (unreachable under the new hash, forcing a needless live re-render on next open).
describe('hashOf — per-engine cache-key fragment (task 408)', () => {
  beforeEach(() =>
    setRenderCacheConfig({
      version: 'v1',
      themeKey: 'dark|github|14px',
      options: {
        d2Layout: 'dagre',
        mermaidTheme: 'default',
        mermaidLayout: 'dagre',
      },
    }),
  )

  it("a D2-only options change does NOT change mermaid's hash", () => {
    const before = hashOf('mermaid', 'graph TD; A-->B')
    setRenderCacheConfig({
      options: {
        d2Layout: 'elk',
        mermaidTheme: 'default',
        mermaidLayout: 'dagre',
      },
    })
    expect(hashOf('mermaid', 'graph TD; A-->B')).toBe(before)
  })

  it("a D2-only options change DOES change d2's own hash", () => {
    const before = hashOf('d2', 'a -> b')
    setRenderCacheConfig({
      options: {
        d2Layout: 'elk',
        mermaidTheme: 'default',
        mermaidLayout: 'dagre',
      },
    })
    expect(hashOf('d2', 'a -> b')).not.toBe(before)
  })

  it('an engine with no own configKeys (vega) is unaffected by any diagram setting change', () => {
    const before = hashOf('vega', '{"mark":"bar"}')
    setRenderCacheConfig({
      options: { d2Layout: 'elk', mermaidTheme: 'dark', mermaidLayout: 'elk' },
    })
    expect(hashOf('vega', '{"mark":"bar"}')).toBe(before)
  })
})

// The key's fields are joined by NUL (`\x00`), not a space — deliberate, committed since before
// task 408 (see hashOf's own comment). A space (or any separator that CAN occur inside a field
// value) lets two DIFFERENT (themeKey, engineFragment) splits concatenate into the IDENTICAL key
// string, which is a hash COLLISION (not a miss) — the wrong diagram gets painted. This is the
// structural case a wider hash (task 406) cannot help with: two inputs that serialise to the same
// string collide at ANY hash width. Constructed so that under a SPACE join both states produce the
// literal string "d2 v1 T X Y|| src" (state A: themeKey="T X", d2Layout="Y" → fragment="Y||";
// state B: themeKey="T", d2Layout="X Y" → fragment="X Y||") — proving the two states MUST still
// hash differently, which only holds if the separator can never appear inside a field.
describe('hashOf — NUL-delimited fields prevent boundary-shift collisions (task 408 restore)', () => {
  it('two different (themeKey, engineFragment) splits that would concatenate identically under a space join still hash differently', () => {
    setRenderCacheConfig({
      version: 'v1',
      themeKey: 'T X',
      options: { d2Layout: 'Y' },
    })
    const a = hashOf('d2', 'src')
    setRenderCacheConfig({
      themeKey: 'T',
      options: { d2Layout: 'X Y' },
    })
    const b = hashOf('d2', 'src')
    expect(a).not.toBe(b)
  })
})

// Build an IR preview pane holding one d2 source block (as Vditor emits it before render).
function mountD2(source: string): HTMLElement {
  const app = document.createElement('div')
  app.id = 'app'
  app.innerHTML = `<div class="vditor-ir__preview" data-render="2"><pre><code class="language-d2">${source}</code></pre></div>`
  document.body.replaceChildren(app)
  return app
}

describe('installRenderCache — reserve + paint from cache', () => {
  beforeEach(() => setRenderCacheConfig({ version: 'v1', themeKey: 't' }))

  it('reserves each cacheable block and requests its cached SVG on open', () => {
    const app = mountD2('a -> b')
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    const req = posted.find((m) => m.command === 'diagram-cache-get')
    expect(req).toBeTruthy()
    // The block was reserved (data-processed) so the engine won't render it before the reply.
    const wrapper = app.querySelector('div.language-d2') as HTMLElement
    expect(wrapper.getAttribute('data-processed')).toBe('true')
    if (req && req.command === 'diagram-cache-get') {
      expect(req.hashes).toContain(hashOf('d2', 'a -> b'))
    }
  })

  it('paints a HIT into the live div with data-render="1" (byte-identical) + a cache marker', () => {
    const app = mountD2('a -> b')
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    const req = posted.find((m) => m.command === 'diagram-cache-get')!
    const hash = hashOf('d2', 'a -> b')
    applyCacheHits(req.requestId, { [hash]: '<svg data-t="cached"></svg>' })
    const wrapper = app.querySelector('div.language-d2') as HTMLElement
    expect(wrapper.querySelector('svg')?.getAttribute('data-t')).toBe('cached')
    expect(wrapper.getAttribute('data-render')).toBe('1') // Lute-invisible → serialize byte-identical
    expect(wrapper.getAttribute('data-vmarkd-cache-hit')).toBe('1')
    expect(wrapper.getAttribute('data-processed')).toBe('true') // engine stays skipped
  })

  it('unblocks the engine on a MISS (drops data-processed, retriggers a render pass)', () => {
    const app = mountD2('a -> b')
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    const req = posted.find((m) => m.command === 'diagram-cache-get')!
    applyCacheHits(req.requestId, {}) // empty = miss
    const wrapper = app.querySelector('div.language-d2') as HTMLElement
    expect(wrapper.getAttribute('data-processed')).toBeNull() // engine may render live now
    expect(wrapper.getAttribute('data-vmarkd-cache-hit')).toBeNull()
  })
})

// Task 184 Phase 3 — Vditor-NATIVE engines (mermaid/graphviz/abc/flowchart): the render target is
// the preview-pane `.language-<lang>` (Vditor renders it, no code→div swap), and the hash SOURCE is
// the editable marker (survives the render). Reserve blocks Vditor's deferred render; a MISS
// re-renders OFFSCREEN via renderNativeJobs(lang, …) (Vditor won't re-fire) rather than the
// custom-block comment-append.
function mountNative(lang: string, source: string): HTMLElement {
  const app = document.createElement('div')
  app.id = 'app'
  // Dual-node: editable marker source + the preview render target (both .language-<lang>).
  app.innerHTML = `<div class="vditor-ir__node" data-type="code-block"><pre class="vditor-ir__marker--pre"><code class="language-${lang}">${source}</code></pre><pre class="vditor-ir__preview" data-render="2"><div class="language-${lang}">${source}</div></pre></div>`
  document.body.replaceChildren(app)
  return app
}
// The preview-pane render target for `lang` (NOT the editable marker code).
function nativeTarget(app: HTMLElement, lang: string): HTMLElement {
  return app.querySelector(
    `.vditor-ir__preview .language-${lang}`,
  ) as HTMLElement
}

describe('installRenderCache — native engine reserve + paint', () => {
  beforeEach(() => {
    renderNativeJobs.mockClear()
    setRenderCacheConfig({
      version: 'v1',
      themeKey: 't',
      cdn: '/cdn',
      mode: 'dark',
    })
  })

  it('reserves the mermaid preview target and requests it hashed from the MARKER source', () => {
    const app = mountNative('mermaid', 'graph TD;A-->B')
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    const req = posted.find((m) => m.command === 'diagram-cache-get')
    expect(req?.command === 'diagram-cache-get' && req.hashes).toContain(
      hashOf('mermaid', 'graph TD;A-->B'),
    )
    // The engine's deferred pass is blocked on the preview target.
    expect(nativeTarget(app, 'mermaid').getAttribute('data-processed')).toBe(
      'true',
    )
  })

  it('generalises to abc (reserve + HIT paint)', () => {
    const app = mountNative('abc', 'X:1\nK:C\nCDEF|')
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    const req = posted.find((m) => m.command === 'diagram-cache-get')!
    expect(req.command === 'diagram-cache-get' && req.hashes).toContain(
      hashOf('abc', 'X:1\nK:C\nCDEF|'),
    )
    applyCacheHits(req.requestId, {
      [hashOf('abc', 'X:1\nK:C\nCDEF|')]: '<svg id="a-cached"></svg>',
    })
    const target = nativeTarget(app, 'abc')
    expect(target.querySelector('svg')?.id).toBe('a-cached') // unreferenced ids are left alone
    expect(target.getAttribute('data-vmarkd-cache-hit')).toBe('1')
    expect(target.getAttribute('data-processed')).toBe('true')
  })

  it('paints a HIT into the preview target (data-render="1" + cache marker, stays processed)', () => {
    const app = mountNative('mermaid', 'graph TD;A-->B')
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    const req = posted.find((m) => m.command === 'diagram-cache-get')!
    applyCacheHits(req.requestId, {
      [hashOf('mermaid', 'graph TD;A-->B')]: '<svg id="m-cached"></svg>',
    })
    const target = nativeTarget(app, 'mermaid')
    expect(target.querySelector('svg')?.id).toBe('m-cached') // unreferenced ids are left alone
    expect(target.getAttribute('data-render')).toBe('1')
    expect(target.getAttribute('data-vmarkd-cache-hit')).toBe('1')
    expect(target.getAttribute('data-processed')).toBe('true') // engine stays skipped
    expect(renderNativeJobs).not.toHaveBeenCalled() // no re-render on a hit
  })

  it('re-renders OFFSCREEN on a MISS (keeps data-processed; Vditor cannot re-fire)', () => {
    const app = mountNative('mermaid', 'graph TD;A-->B')
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    const req = posted.find((m) => m.command === 'diagram-cache-get')!
    applyCacheHits(req.requestId, {}) // miss
    const target = nativeTarget(app, 'mermaid')
    // Unlike a custom block, data-processed stays set — the engine's one-shot already skipped it.
    expect(target.getAttribute('data-processed')).toBe('true')
    expect(target.getAttribute('data-vmarkd-cache-reserve')).toBeNull()
    // The offscreen re-render was invoked with (lang, [job], cdn, mode).
    expect(renderNativeJobs).toHaveBeenCalledTimes(1)
    const [lang, jobs, cdn, mode] = renderNativeJobs.mock.calls[0]
    expect(lang).toBe('mermaid')
    expect(jobs).toEqual([{ live: target, source: 'graph TD;A-->B' }])
    expect(cdn).toBe('/cdn')
    expect(mode).toBe('dark')
  })
})

// PlantUML (task 347 cache) — native + reservable, but its cache-MISS re-renders LIVE via plantumlRender
// (our engine sets data-processed early + skips reserved blocks, so the offscreen path is both wrong and
// unnecessary — and, crucially, no Viz.js double-invoke like graphviz). Reserve + HIT paint are identical
// to the other native engines; only the miss path differs (plantumlRender(root, cdn), not renderNativeJobs).
describe('installRenderCache — plantuml reserve + live-miss', () => {
  beforeEach(() => {
    plantumlRender.mockClear()
    renderNativeJobs.mockClear()
    setRenderCacheConfig({
      version: 'v1',
      themeKey: 't',
      cdn: '/cdn',
      mode: 'dark',
    })
  })

  it('reserves the plantuml preview target, hashed from the MARKER source', () => {
    const app = mountNative('plantuml', '@startuml\nA->B\n@enduml')
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    const req = posted.find((m) => m.command === 'diagram-cache-get')
    expect(req?.command === 'diagram-cache-get' && req.hashes).toContain(
      hashOf('plantuml', '@startuml\nA->B\n@enduml'),
    )
    // Reserved → our plantuml loop skips it (so the engine/Viz never runs) until the reply lands.
    expect(nativeTarget(app, 'plantuml').getAttribute('data-processed')).toBe(
      'true',
    )
  })

  it('paints a HIT + stays processed + does NO engine work (no plantumlRender, no offscreen)', () => {
    const app = mountNative('plantuml', '@startuml\nA->B\n@enduml')
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    const req = posted.find((m) => m.command === 'diagram-cache-get')!
    applyCacheHits(req.requestId, {
      [hashOf('plantuml', '@startuml\nA->B\n@enduml')]:
        '<svg id="p-cached"></svg>',
    })
    const target = nativeTarget(app, 'plantuml')
    expect(target.querySelector('svg')?.id).toBe('p-cached') // unreferenced ids are left alone
    expect(target.getAttribute('data-render')).toBe('1')
    expect(target.getAttribute('data-vmarkd-cache-hit')).toBe('1')
    expect(target.getAttribute('data-processed')).toBe('true')
    expect(plantumlRender).not.toHaveBeenCalled()
    expect(renderNativeJobs).not.toHaveBeenCalled()
    // The sprite backing re-apply follows the RENDER path's post-render pass: while
    // PUML_POST_RENDER_THEMING is off (user's call, 2026-07-29) neither runs, so the warm paint and a
    // cold render agree. Flip the mocked flag above with the real one to restore the task 382/370
    // behaviour: on a hit no renderer runs, so nothing else would re-apply a backing whose async
    // composite the stored markup can predate.
    expect(backSpritesIn).not.toHaveBeenCalled()
  })

  it('on a MISS: un-reserves (drops data-processed) + re-renders LIVE via plantumlRender(root, cdn), NOT offscreen', () => {
    const app = mountNative('plantuml', '@startuml\nA->B\n@enduml')
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    const req = posted.find((m) => m.command === 'diagram-cache-get')!
    applyCacheHits(req.requestId, {}) // empty = miss
    const target = nativeTarget(app, 'plantuml')
    // Unblocked so plantumlRender can render it live (unlike native offscreen, which KEEPS data-processed).
    expect(target.getAttribute('data-processed')).toBeNull()
    expect(target.getAttribute('data-vmarkd-cache-reserve')).toBeNull()
    expect(renderNativeJobs).not.toHaveBeenCalled() // NOT the offscreen path
    expect(plantumlRender).toHaveBeenCalledTimes(1)
    const [root, cdn] = plantumlRender.mock.calls[0]
    expect(root).toBe(app) // scoped to the captured editor root
    expect(cdn).toBe('/cdn')
  })
})

// Task 365 — SAME-SESSION reuse. The host store only answers an async round-trip issued at OPEN, so
// a pane built LATER (a mode switch into full Preview) never reached it: its d2 blocks were laid out
// a SECOND time by the engine and came out with different text metrics than their IR twins. The
// local map closes that: a block whose (lang, source, themeKey, version) was already rendered in
// this session is painted from the stored markup, synchronously, before the engine sees it.

// Append a full-Preview pane holding the SAME source — what a mode switch does.
function appendPreviewPane(app: HTMLElement, source: string): HTMLElement {
  const pane = document.createElement('div')
  pane.className = 'vditor-preview'
  pane.innerHTML = `<pre><code class="language-d2">${source}</code></pre>`
  app.appendChild(pane)
  return pane
}
// MutationObserver callbacks are microtasks in jsdom; paintLocalHits runs inside one.
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('installRenderCache — same-session reuse into a later pane (task 365)', () => {
  beforeEach(() => setRenderCacheConfig({ version: 'v1', themeKey: 't' }))

  it('paints a pane built AFTER open from the render this session already produced', async () => {
    const app = mountD2('a -> b')
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    const req = posted.find((m) => m.command === 'diagram-cache-get')!
    applyCacheHits(req.requestId, {
      [hashOf('d2', 'a -> b')]: '<svg id="s"></svg>',
    })

    const pane = appendPreviewPane(app, 'a -> b')
    await flush()
    const target = pane.querySelector('div.language-d2') as HTMLElement
    // Same markup as the first pane — byte-identical BY CONSTRUCTION, not by two engines agreeing.
    expect(target.querySelector('svg')?.id).toBe('s') // unreferenced ids are left alone
    expect(target.getAttribute('data-vmarkd-cache-hit')).toBe('1')
    // Reserved, so the custom-diagram observer never re-runs the engine over it.
    expect(target.getAttribute('data-processed')).toBe('true')
    // The task-361 trap: without data-code the next theme flip re-renders this node EMPTY.
    expect(target.getAttribute('data-code')).toBe('a -> b')
  })

  it('leaves a DIFFERENT source to the engine (no false reuse)', async () => {
    const app = mountD2('a -> b')
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    const req = posted.find((m) => m.command === 'diagram-cache-get')!
    applyCacheHits(req.requestId, {
      [hashOf('d2', 'a -> b')]: '<svg id="s"></svg>',
    })

    const pane = appendPreviewPane(app, 'x -> y')
    await flush()
    const target = pane.querySelector('div.language-d2') as HTMLElement
    expect(target.querySelector('svg')).toBeNull()
    expect(target.getAttribute('data-vmarkd-cache-hit')).toBeNull()
    expect(target.getAttribute('data-processed')).toBeNull() // engine still owns it
  })

  it('drops the reusable renders when the THEME changes (their markup is the old theme)', async () => {
    const app = mountD2('a -> b')
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    const req = posted.find((m) => m.command === 'diagram-cache-get')!
    applyCacheHits(req.requestId, {
      [hashOf('d2', 'a -> b')]: '<svg id="s"></svg>',
    })

    setRenderCacheConfig({ themeKey: 't2' })
    const pane = appendPreviewPane(app, 'a -> b')
    await flush()
    // Still the raw <code> block: with nothing reusable left, paintLocalHits bails before findBlocks
    // (which is what converts code→div), so the engine finds the block exactly as Vditor emitted it.
    const target = pane.querySelector('.language-d2') as HTMLElement
    expect(target.querySelector('svg')).toBeNull()
    expect(target.getAttribute('data-processed')).toBeNull()
  })
})

// Task 366 — the same reuse for the Vditor-NATIVE engines in the FULL Preview pane. That pane is
// outside the open-path reserve (PREVIEW_PANE_SEL covers only the IR/WYSIWYG collapsed previews), and
// it has no editable marker sibling to read the source from — an un-rendered target holds its own
// fence source as textContent instead. Measured before this: abc rendered 451.99x98.83 in IR and
// 420.02x87.83 in Preview.
function appendFullPreview(
  app: HTMLElement,
  lang: string,
  source: string,
): HTMLElement {
  const pane = document.createElement('div')
  pane.className = 'vditor-preview'
  pane.innerHTML = `<div class="language-${lang}">${source}</div>`
  app.appendChild(pane)
  return pane
}

describe('installRenderCache — native reuse into the full Preview pane (task 366)', () => {
  beforeEach(() =>
    setRenderCacheConfig({
      version: 'v1',
      themeKey: 't',
      cdn: '/cdn',
      mode: 'dark',
    }),
  )

  it('paints a native Preview target from the render this session already produced', async () => {
    const app = mountNative('mermaid', 'graph TD;A-->B')
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    const req = posted.find((m) => m.command === 'diagram-cache-get')!
    applyCacheHits(req.requestId, {
      [hashOf('mermaid', 'graph TD;A-->B')]: '<svg id="m"></svg>',
    })

    const pane = appendFullPreview(app, 'mermaid', 'graph TD;A-->B')
    await flush()
    const target = pane.querySelector('.language-mermaid') as HTMLElement
    expect(target.querySelector('svg')?.id).toBe('m') // unreferenced ids are left alone
    expect(target.getAttribute('data-vmarkd-cache-hit')).toBe('1')
    // Reserved, so Vditor's deferred render pass skips it.
    expect(target.getAttribute('data-processed')).toBe('true')
  })

  // The whole point of the namespace, end to end on the reuse path: the painted copy's marker must
  // NOT resolve to the first pane's element, which is display:none while this pane is shown (373).
  it('namespaces the REFERENCED ids of the painted copy so the arrowheads keep their own marker', async () => {
    const svg =
      '<svg id="m"><style>#m .node{fill:#111;}</style>' +
      '<marker id="pointEnd"/><path marker-end="url(#pointEnd)"/></svg>'
    const app = mountNative('mermaid', 'graph TD;A-->B')
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    const req = posted.find((m) => m.command === 'diagram-cache-get')!
    applyCacheHits(req.requestId, {
      [hashOf('mermaid', 'graph TD;A-->B')]: svg,
    })

    const pane = appendFullPreview(app, 'mermaid', 'graph TD;A-->B')
    await flush()
    const target = pane.querySelector('.language-mermaid') as HTMLElement
    const marker = target.querySelector('marker')?.id as string
    expect(marker).toMatch(/^pointEnd-vm\d+$/)
    expect(target.querySelector('path')?.getAttribute('marker-end')).toBe(
      `url(#${marker})`,
    )
    // …and the stylesheet the copy carries still matches, hex colour intact (task 374).
    expect(target.querySelector('style')?.textContent).toBe(
      '#m .node{fill:#111;}',
    )
  })

  it('matches across the fence trailing newline (textContent vs marker source)', async () => {
    const app = mountNative('mermaid', 'graph TD;A-->B')
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    const req = posted.find((m) => m.command === 'diagram-cache-get')!
    applyCacheHits(req.requestId, {
      [hashOf('mermaid', 'graph TD;A-->B')]: '<svg id="m"></svg>',
    })

    const pane = appendFullPreview(app, 'mermaid', 'graph TD;A-->B\n')
    await flush()
    expect(
      pane.querySelector('.language-mermaid')?.querySelector('svg')?.id,
    ).toBe('m') // unreferenced ids are left alone
  })

  it('never reuses graphviz even after it rendered (Viz.js double-invokes on a reserved block and hangs)', async () => {
    // A FULLY RENDERED graphviz in the IR pane — the only state from which a reuse could occur. It
    // must not enter the map (reportRenders skips it) and so must not be painted into Preview
    // either. Asserted this way round on purpose: a bare "Preview graphviz is unpainted" check
    // passes vacuously whether or not the exclusion is the reason.
    const app = mountNative('graphviz', 'digraph{A->B}')
    const live = nativeTarget(app, 'graphviz')
    live.innerHTML = '<svg id="g"></svg>'
    live.setAttribute('data-processed', 'true')
    installRenderCache(app, () => {
      /* post no-op — these tests don't assert on outbound webview messages */
    })
    await flush()

    const pane = appendFullPreview(app, 'graphviz', 'digraph{A->B}')
    await flush()
    const target = pane.querySelector('.language-graphviz') as HTMLElement
    expect(target.querySelector('svg')).toBeNull()
    expect(target.getAttribute('data-processed')).toBeNull() // Vditor still owns the render
    expect(target.getAttribute('data-vmarkd-cache-hit')).toBeNull()
  })

  it('DOES reuse a rendered mermaid the same way (the graphviz case above is an exclusion, not a no-op)', async () => {
    const app = mountNative('mermaid', 'graph TD;A-->B')
    const live = nativeTarget(app, 'mermaid')
    live.innerHTML = '<svg id="m"></svg>'
    live.setAttribute('data-processed', 'true')
    installRenderCache(app, () => {
      /* post no-op — these tests don't assert on outbound webview messages */
    })
    await flush()

    const pane = appendFullPreview(app, 'mermaid', 'graph TD;A-->B')
    await flush()
    expect(
      pane.querySelector('.language-mermaid')?.querySelector('svg')?.id,
    ).toBe('m') // unreferenced ids are left alone
  })
})

// Task 373 — a painted cache copy duplicated every id in the document, and url(#…) resolves to the
// FIRST match in document order: the ORIGINAL pane's element. That pane is display:none while the
// other is shown, and a marker in a display:none subtree is not painted — mermaid and flowchart lost
// every arrowhead after a mode switch.
import { uniquifySvgIds, stripSvgIdNamespace } from './render-cache-client'

describe('uniquifySvgIds', () => {
  it('renames ids and every reference to them together', () => {
    const out = uniquifySvgIds(
      '<svg><marker id="pointEnd"/><path marker-end="url(#pointEnd)"/></svg>',
    )
    const id = /id="([^"]+)"/.exec(out)?.[1] as string
    expect(id).not.toBe('pointEnd')
    expect(out).toContain(`url(#${id})`)
    expect(out).not.toContain('url(#pointEnd)')
  })

  it('gives a DIFFERENT namespace on each paint (two panes must not collide)', () => {
    const svg = '<svg><marker id="m"/><path marker-end="url(#m)"/></svg>'
    const a = /id="([^"]+)"/.exec(uniquifySvgIds(svg))?.[1]
    const b = /id="([^"]+)"/.exec(uniquifySvgIds(svg))?.[1]
    expect(a).not.toBe(b)
  })

  it('never partially rewrites an id that is a PREFIX of another', () => {
    const out = uniquifySvgIds(
      '<svg><g id="111"/><g id="1111"/><path stroke="url(#111)" fill="url(#1111)"/></svg>',
    )
    const ids = Array.from(out.matchAll(/id="([^"]+)"/g)).map((m) => m[1])
    expect(new Set(ids).size, 'the two ids collapsed into one').toBe(2)
    // The reference must still point at the 1111 one, not at a mangled 111 + "1".
    const long = ids.find((x) => x.startsWith('1111')) as string
    expect(out).toContain(`url(#${long})`)
  })

  it('rewrites href/xlink:href references too', () => {
    const out = uniquifySvgIds('<svg><g id="a"/><use xlink:href="#a"/></svg>')
    const id = /id="([^"]+)"/.exec(out)?.[1] as string
    expect(out).toContain(`xlink:href="#${id}"`)
  })

  it('does not let namespaces accumulate across repeated paints', () => {
    // The map is fed from innerHTML AFTER a paint, so without stripping the suffixes stack up.
    const once = uniquifySvgIds(
      '<svg><marker id="m"/><path marker-end="url(#m)"/></svg>',
    )
    const twice = uniquifySvgIds(stripSvgIdNamespace(once))
    const id = /id="([^"]+)"/.exec(twice)?.[1] as string
    expect(id).toMatch(/^m-vm\d+$/)
    expect(twice).toContain(`url(#${id})`)
  })

  it('is a no-op on markup with no ids', () => {
    const svg = '<svg><path d="M0 0"/></svg>'
    expect(uniquifySvgIds(svg)).toBe(svg)
  })

  // Task 374 — the regression this cost us. mermaid emits its ENTIRE stylesheet as rules scoped under
  // the root svg's id; renaming that id orphaned every rule and the diagram came out with black boxes
  // and the default font. An id used only as a CSS SCOPE is never url-referenced, so it must be left
  // exactly as it is — the reference rewrite is the only thing uniqueness actually requires.
  it('leaves an id that only SCOPES a stylesheet alone, so the CSS keeps matching', () => {
    const svg =
      '<svg id="mermaid-abc"><style>#mermaid-abc{font-family:sans-serif;}' +
      '#mermaid-abc .node rect{fill:#ccc;}</style>' +
      '<marker id="mermaid-abc-pointEnd"/><path marker-end="url(#mermaid-abc-pointEnd)"/></svg>'
    const out = uniquifySvgIds(svg)
    expect(out).toContain('<svg id="mermaid-abc">')
    expect(out).toContain('#mermaid-abc .node rect{fill:#ccc;}')
    // …while the marker it DOES reference is still namespaced, or the arrowheads break again.
    const marker = /id="(mermaid-abc-pointEnd[^"]*)"/.exec(out)?.[1] as string
    expect(marker).not.toBe('mermaid-abc-pointEnd')
    expect(out).toContain(`url(#${marker})`)
  })

  it('does not corrupt a hex colour that looks like an id reference', () => {
    // flowchart emits `id="111"`, and `#111` is equally a valid CSS colour — which is why ids are
    // never rewritten inside CSS text, only their url()/href reference forms.
    const out = uniquifySvgIds(
      '<svg><style>.a{fill:#111;stroke:#1111;}</style><g id="111"/><path fill="url(#111)"/></svg>',
    )
    expect(out).toContain('fill:#111;stroke:#1111;')
  })

  it('rewrites an url(#…) reference that sits INSIDE a <style> block', () => {
    const out = uniquifySvgIds(
      '<svg><linearGradient id="g"/><style>.node path{stroke:url(#g);}</style></svg>',
    )
    const id = /id="(g[^"]*)"/.exec(out)?.[1] as string
    expect(id).not.toBe('g')
    expect(out).toContain(`stroke:url(#${id});`)
  })
})

// Task 436 — the theme-flip lookup. Split out from the open path because it starts from ALREADY
// RENDERED blocks (they carry data-processed + their markup) instead of empty ones, which is what
// makes the ordering safe: nothing is un-reserved while the host reply is in flight.
describe('rethemeCacheFirst — cache-first re-render after a theme flip', () => {
  // A d2 block as it looks AFTER a render: a data-code div holding its svg, marked processed.
  function mountRendered(source = 'a -> b', lang = 'd2') {
    const app = document.createElement('div')
    app.id = 'app'
    app.innerHTML =
      `<div class="vditor-ir__preview" data-render="2">` +
      `<div class="language-${lang}" data-code="${source}" data-processed="true"><svg data-t="old"></svg></div>` +
      `</div>`
    document.body.replaceChildren(app)
    return app
  }

  beforeEach(() => setRenderCacheConfig({ version: 'v1', themeKey: 'flip-a' }))

  it('reserves the rendered block and asks the host, WITHOUT un-processing it', () => {
    const app = mountRendered()
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    posted.length = 0

    expect(rethemeCacheFirst(app, ['d2'])).toBe(true)
    const req = posted.find((m) => m.command === 'diagram-cache-get')
    expect(req, 'it asked the host').toBeTruthy()
    const wrapper = app.querySelector('div.language-d2') as HTMLElement
    // The whole ordering argument in one assertion: the engine stays blocked while we wait, so no
    // observer can start a live render underneath the pending lookup.
    expect(wrapper.getAttribute('data-processed')).toBe('true')
    expect(wrapper.getAttribute('data-vmarkd-cache-reserve')).toBe('1')
  })

  it('a HIT paints the cached SVG and never touches the engine', () => {
    const app = mountRendered()
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    posted.length = 0
    rethemeCacheFirst(app, ['d2'])
    const req = posted.find((m) => m.command === 'diagram-cache-get')
    if (req?.command !== 'diagram-cache-get') throw new Error('no request')

    applyCacheHits(req.requestId, {
      [hashOf('d2', 'a -> b')]: '<svg data-t="cached"></svg>',
    })
    const wrapper = app.querySelector('div.language-d2') as HTMLElement
    expect(wrapper.innerHTML).toContain('data-t="cached"')
    expect(wrapper.innerHTML, 'the stale render is gone').not.toContain(
      'data-t="old"',
    )
    // Still reserved against the engine, and the miss-trigger node was never appended.
    expect(wrapper.getAttribute('data-processed')).toBe('true')
    expect(wrapper.innerHTML).not.toContain('vmarkd-cache-miss')
  })

  it('a HIT stamps the block with the CURRENT key — so a later flip cannot mistake it for fresh', () => {
    // Invariant: cache-painted bytes belong to whatever key the GET was hashed under (cfg.themeKey).
    // Leaving the block's PRIOR stamp behind is a latent poison reachable via flip A->B->A->B: the
    // flip-back-to-A HIT would repaint A's bytes but keep a B stamp, and the next flip to B then passes
    // the guard's condition 1 (stamp==key) and files A's svg as fresh. Stamping on paint closes it.
    const app = mountRendered()
    installRenderCache(app, () => {
      /* post no-op — these tests don't assert on outbound webview messages */
    })
    const wrapper = app.querySelector('div.language-d2') as HTMLElement
    wrapper.setAttribute(RENDER_KEY_ATTR, 'stale-prior-key') // as if painted under an earlier theme

    setRenderCacheConfig({ themeKey: 'flip-b' })
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    rethemeCacheFirst(app, ['d2'])
    const req = posted.find((m) => m.command === 'diagram-cache-get')
    if (req?.command !== 'diagram-cache-get') throw new Error('no request')
    applyCacheHits(req.requestId, {
      [hashOf('d2', 'a -> b')]: '<svg data-t="painted-under-b"></svg>',
    })

    expect(
      wrapper.getAttribute(RENDER_KEY_ATTR),
      'the painted block carries the key it was served under, not the stale prior one',
    ).toBe('flip-b')
  })

  it('a MISS un-blocks the block so the live engine re-renders it', () => {
    const app = mountRendered()
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    posted.length = 0
    rethemeCacheFirst(app, ['d2'])
    const req = posted.find((m) => m.command === 'diagram-cache-get')
    if (req?.command !== 'diagram-cache-get') throw new Error('no request')

    applyCacheHits(req.requestId, {}) // host has nothing for this hash
    const wrapper = app.querySelector('div.language-d2') as HTMLElement
    expect(wrapper.hasAttribute('data-processed')).toBe(false)
    expect(wrapper.hasAttribute('data-vmarkd-cache-reserve')).toBe(false)
    // The observer re-fire marker (the engine watches childList, not attributes).
    expect(
      Array.from(wrapper.childNodes).some(
        (n) => n.nodeType === Node.COMMENT_NODE,
      ),
    ).toBe(true)
  })

  it('the hash follows the NEW themeKey — a flip cannot hit on the pre-flip render', () => {
    const app = mountRendered()
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    const before = hashOf('d2', 'a -> b')
    posted.length = 0

    setRenderCacheConfig({ themeKey: 'flip-b' }) // what the flip handler does before re-theming
    rethemeCacheFirst(app, ['d2'])
    const req = posted.find((m) => m.command === 'diagram-cache-get')
    if (req?.command !== 'diagram-cache-get') throw new Error('no request')
    expect(req.hashes).toContain(hashOf('d2', 'a -> b'))
    expect(req.hashes, 'not the pre-flip key').not.toContain(before)
  })

  it('declines a NON-cacheable lang, so its caller re-renders live (geojson is a Leaflet map)', () => {
    const app = mountRendered('{"type":"Point"}', 'geojson')
    installRenderCache(app, () => {
      /* post no-op — these tests don't assert on outbound webview messages */
    })
    expect(rethemeCacheFirst(app, ['geojson'])).toBe(false)
  })

  it('declines a block that has not drawn yet — a first render is already in flight', () => {
    const app = mountRendered()
    ;(app.querySelector('div.language-d2') as HTMLElement).innerHTML = ''
    installRenderCache(app, () => {
      /* post no-op — these tests don't assert on outbound webview messages */
    })
    expect(rethemeCacheFirst(app, ['d2'])).toBe(false)
  })
})

// Task 436 — the stale-render guard. The PUT observer fires on ANY mutation, and a theme flip
// changes `themeKey` 400 ms before the re-theme runs, so without this a block still holding the
// PRE-flip render gets filed under the POST-flip key. That is not a miss: the next lookup paints it
// straight back, and the diagram stops following the theme (measured in retheme-flip-matrix — all
// 12 D2 blocks). Comparing markup instead is NOT sound (a cached paint re-namespaces svg ids, the
// sizing passes rewrite width/height), which is why the block carries the key it was rendered under.
describe('reportRenders — a stale render is never filed under a new themeKey', () => {
  const flush = () => new Promise((r) => setTimeout(r, 50))
  // The PUT pass is rAF-scheduled and jsdom does not run frames unless it is pretending to be
  // visual — drive it off a timer so the observer's work actually happens under test.
  beforeEach(() =>
    vi.stubGlobal(
      'requestAnimationFrame',
      (cb: FrameRequestCallback) =>
        setTimeout(() => cb(0), 0) as unknown as number,
    ),
  )
  afterEach(() => vi.unstubAllGlobals())

  // A source unique to this block: `reportedHashes` is a MODULE-global dedupe set shared by every
  // test in this file, so re-using another test's (lang, source, key) would silently suppress the
  // PUT this test is about.
  function mountRendered(source = 'stale-guard -> block') {
    const app = document.createElement('div')
    app.id = 'app'
    app.innerHTML =
      `<div class="vditor-ir__preview" data-render="2">` +
      `<div class="language-d2" data-code="${source}" data-processed="true"><svg data-t="old"></svg></div>` +
      `</div>`
    document.body.replaceChildren(app)
    return app
  }

  beforeEach(() => setRenderCacheConfig({ version: 'v1', themeKey: 'key-a' }))

  // A block that was itself PAINTED from the cache carries a `-vmN` paint namespace on its
  // referenced ids (uniquifySvgIds). What gets filed with the host must be the STEM, exactly as
  // rememberLocal stores it locally — otherwise the next paint from that host entry adds its own
  // namespace on top (`id="…-vm7-vm9"`), the markup grows with every mode switch, and the two panes
  // stop being byte-comparable (mode-switch-render-reuse.spec.ts).
  it('files the host copy WITHOUT the paint id namespace, so suffixes cannot stack', async () => {
    const app = document.createElement('div')
    app.id = 'app'
    app.innerHTML =
      `<div class="vditor-ir__preview" data-render="2">` +
      `<div class="language-d2" data-code="namespaced -> put" data-processed="true">` +
      `<svg><defs><mask id="lbl-vm7"></mask></defs><g mask="url(#lbl-vm7)"></g></svg>` +
      `</div></div>`
    document.body.replaceChildren(app)
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    await flush()
    const put = posted.find((m) => m.command === 'diagram-render-cached') as
      | { svg: string }
      | undefined
    expect(put, 'the render was filed with the host').toBeDefined()
    expect(
      put?.svg,
      'no paint namespace rides into the host cache',
    ).not.toMatch(/-vm\d+/)
    expect(put?.svg, 'the id stem itself survives').toContain('id="lbl"')
  })

  it('reports once under the key it rendered under, then not again after a flip', async () => {
    const app = mountRendered()
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    await flush()
    const puts = () =>
      posted.filter((m) => m.command === 'diagram-render-cached')
    expect(puts(), 'the initial render is reported').toHaveLength(1)
    posted.length = 0

    // The flip: the key moves first, the re-theme has not run yet, and any mutation re-fires the
    // observer over a block that still holds the OLD render.
    setRenderCacheConfig({ themeKey: 'key-b' })
    app.appendChild(document.createComment('a flip mutates the DOM'))
    await flush()
    expect(
      puts(),
      'the pre-flip render is not filed under the new key',
    ).toEqual([])

    // Now the engine actually redraws it. findBlocks / resetCustomBlocks drop the stamp for exactly
    // this reason, so mirror what they do — the fresh markup must be reported normally.
    const wrapper = app.querySelector('div.language-d2') as HTMLElement
    wrapper.removeAttribute(RENDER_KEY_ATTR)
    wrapper.innerHTML = '<svg data-t="new"></svg>'
    await flush()
    expect(puts(), 'the real re-render IS reported').toHaveLength(1)
  })

  it('a NATIVE block is guarded too — a flip does not file its pre-flip render (436 follow-up)', async () => {
    // The first cut of the guard skipped the native family (mermaid/abc/flowchart/plantuml) because
    // nothing cleared their stamp — they would simply stop being cached after one flip. Their redraw
    // paths are ours after all (reRenderLang, reRenderMermaid, reRenderFlowchart, adoptRender), so
    // they now clear it, and this pins both halves: no poison on a flip, and caching still works
    // once the engine has actually redrawn.
    const app = document.createElement('div')
    app.id = 'app'
    app.innerHTML =
      `<div class="vditor-ir__node" data-type="code-block">` +
      `<pre class="vditor-ir__marker--pre"><code class="language-mermaid">graph TD;S-->T</code></pre>` +
      `<pre class="vditor-ir__preview" data-render="2"><div class="language-mermaid"><svg data-t="old"></svg></div></pre>` +
      `</div>`
    document.body.replaceChildren(app)
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    await flush()
    const puts = () =>
      posted.filter((m) => m.command === 'diagram-render-cached')
    expect(puts(), 'the initial render is reported').toHaveLength(1)
    posted.length = 0

    setRenderCacheConfig({ themeKey: 'key-b' })
    app.appendChild(document.createComment('a flip mutates the DOM'))
    await flush()
    expect(
      puts(),
      'the pre-flip native render is not filed under the new key',
    ).toEqual([])

    // adoptRender / reRenderMermaid clear the stamp when the fresh render lands.
    const live = app.querySelector(
      '.vditor-ir__preview .language-mermaid',
    ) as HTMLElement
    clearRenderKey(live)
    live.innerHTML = '<svg data-t="new"></svg>'
    await flush()
    expect(puts(), 'the real re-render IS reported').toHaveLength(1)
  })

  it('an ASYNC engine cannot slip the OLD picture through while it redraws', async () => {
    // Clearing the stamp announces the INTENT to redraw; d2's WASM compile (~365 ms) and the
    // offscreen native passes leave the old picture up meanwhile. A report landing in that window
    // would carry the stale markup with a cleared stamp — which is why `put` also requires the
    // markup itself to have changed.
    const app = mountRendered('async -> window')
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    await flush()
    posted.length = 0
    const wrapper = app.querySelector('div.language-d2') as HTMLElement

    setRenderCacheConfig({ themeKey: 'key-b' })
    clearRenderKey(wrapper) // the engine is about to redraw, but has not yet
    app.appendChild(document.createComment('mid-compile mutation'))
    await flush()
    expect(
      posted.filter((m) => m.command === 'diagram-render-cached'),
      'the old picture is not filed under the new key mid-render',
    ).toEqual([])
  })

  it('findBlocks drops the stamp, so a block it hands to an engine can report again', () => {
    const app = mountRendered()
    const wrapper = app.querySelector('div.language-d2') as HTMLElement
    wrapper.setAttribute(RENDER_KEY_ATTR, 'key-a')
    wrapper.removeAttribute('data-processed') // findBlocks skips processed blocks
    findBlocks(app, 'd2')
    expect(wrapper.hasAttribute(RENDER_KEY_ATTR)).toBe(false)
  })

  it('the reserve/miss trigger comment on the wrapper does not slip the stale svg through', async () => {
    // The measured flake (d2-content-theme-flip.spec, 4/6). rethemeCacheFirst's MISS branch does
    // exactly `wrapper.appendChild(<!--vmarkd-cache-miss-->)` to re-fire the observer, then the async
    // engine redraws. In that window findBlocks has cleared the stamp (condition 1 off) AND the comment
    // changed el.innerHTML — so an innerHTML-based condition 2 read the STILL-STALE svg as "changed" and
    // filed it under the new key. The guard compares SVG-only, so the trigger comment is invisible to it
    // and the stale svg is correctly skipped until the engine swaps the svg for real.
    const app = mountRendered('miss -> trigger')
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    await flush()
    posted.length = 0
    const wrapper = app.querySelector('div.language-d2') as HTMLElement

    setRenderCacheConfig({ themeKey: 'key-b' })
    clearRenderKey(wrapper) // findBlocks does this on the re-render pass
    wrapper.appendChild(document.createComment('vmarkd-cache-miss')) // the exact miss-branch move
    await flush()
    expect(
      posted.filter((m) => m.command === 'diagram-render-cached'),
      'the stale svg is not filed under the new key just because a trigger comment was appended',
    ).toEqual([])

    // The engine finally swaps the svg (renderD2 replaces innerHTML, dropping the trigger comment) →
    // a genuine change → reported normally under the new key.
    wrapper.innerHTML = '<svg data-t="new"></svg>'
    await flush()
    expect(
      posted.filter((m) => m.command === 'diagram-render-cached'),
      'the real re-render IS reported',
    ).toHaveLength(1)
  })

  it('a miss-comment still present beats a changed svg markup (task 491)', async () => {
    // The measured 491 flake (retheme-preview-surface, 3/3): the spec TAGS the live svg child
    // (`data-preflip-491`) before the flip, so svgOnly() — which concatenates svg.outerHTML — differs
    // from the last reported markup for a reason that is NOT a re-render. When the miss branch then
    // clears the stamp + appends the re-fire comment, condition 1 is off (stamp null) and condition 2
    // is fooled (svg looks "changed") → the pre-flip svg is filed under the post-flip key. The explicit
    // miss-comment guard closes it: the comment survives until the engine replaces innerHTML, so its
    // presence means "not re-rendered yet" regardless of what else changed in the markup.
    const app = mountRendered('tagged -> svg')
    const posted: WebviewMessage[] = []
    installRenderCache(app, (m) => posted.push(m))
    await flush()
    posted.length = 0
    const wrapper = app.querySelector('div.language-d2') as HTMLElement

    setRenderCacheConfig({ themeKey: 'key-b' })
    clearRenderKey(wrapper) // findBlocks on the re-render pass
    // The spec's pre-flip tag mutates svg.outerHTML — the "changed markup" that is NOT a redraw.
    ;(wrapper.querySelector('svg') as SVGElement).setAttribute(
      'data-preflip-491',
      '1',
    )
    wrapper.appendChild(document.createComment('vmarkd-cache-miss'))
    await flush()
    expect(
      posted.filter((m) => m.command === 'diagram-render-cached'),
      'a pre-flip-tagged svg with a pending miss-comment is not filed under the new key',
    ).toEqual([])

    // Real re-render (engine swaps svg, dropping the tag + the comment) → reported.
    wrapper.innerHTML = '<svg data-t="new"></svg>'
    await flush()
    expect(
      posted.filter((m) => m.command === 'diagram-render-cached'),
      'the real re-render IS reported',
    ).toHaveLength(1)
  })
})
