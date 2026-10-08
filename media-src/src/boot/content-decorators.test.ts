// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import * as vm from 'node:vm'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prewarmLute, renderForMode } from '../../../src/lute/lute-host'
import {
  isLuteArtifactBuilt,
  waitForLuteWarm,
  warnLuteArtifactMissing,
} from '../../../test/backend/lute-artifact'
import {
  buildParityFixture,
  PARITY_MARKERS,
} from '../../../test/parity/elements'
import {
  CONTENT_DECORATORS,
  decorateOverlay,
  observeDecorators,
  type ObserveContext,
} from './content-decorators'

// Task 532 step 4 — the overlay pass of the decorator registry, on the REAL host render of the
// canonical parity fixture (Node Lute, the same HTML the instant-paint overlay is built from), with
// the real hljs / KaTeX builds the host HTML preloads. jsdom has no layout, so this pins DOM facts
// (markers, idempotence, round-trip); the colours and heights are the parity gate's job.

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

const ROOT = path.resolve(__dirname, '../../..')
const LUTE_BUILT = isLuteArtifactBuilt(ROOT)
if (!LUTE_BUILT) warnLuteArtifactMissing('content-decorators > overlay', ROOT)

const requireCjs = createRequire(import.meta.url)
const vditorJs = (rel: string) => path.join(ROOT, 'media/vditor/dist/js', rel)

// highlight.min.js is a plain `var hljs=…` script (no module.exports) — evaluate it as a global.
function loadHljs(): unknown {
  return new Function(
    `${readFileSync(vditorJs('highlight.js/highlight.min.js'), 'utf8')}\nreturn hljs`,
  )()
}
// third-languages.js registers the extra grammars on the global hljs it finds.
function loadHljsThirdLanguages(hljs: unknown): void {
  const g = globalThis as { hljs?: unknown }
  const prev = g.hljs
  g.hljs = hljs
  new Function(
    readFileSync(vditorJs('highlight.js/third-languages.js'), 'utf8'),
  )()
  g.hljs = prev
}

let irHtml = ''
let lute: { VditorIRDOM2Md(html: string): string } | undefined

beforeAll(async () => {
  if (!LUTE_BUILT) return
  prewarmLute(ROOT)
  await waitForLuteWarm()
  irHtml = renderForMode(ROOT, buildParityFixture(), 'ir') ?? ''
  // A separate Lute instance for the round-trip check (decorated vs plain DOM → markdown).
  const sandbox: Record<string, unknown> = {
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(
    readFileSync(
      path.join(ROOT, 'media/vditor/dist/js/lute/lute.min.js'),
      'utf8',
    ),
    sandbox,
  )
  lute = (sandbox as { Lute: { New(): typeof lute } }).Lute.New()
})

afterEach(() => {
  document.body.innerHTML = ''
  const w = window as unknown as { hljs?: unknown; katex?: unknown }
  w.hljs = undefined
  w.katex = undefined
})

function overlayRoot(html: string): HTMLElement {
  document.body.innerHTML = `<div id="vmarkd-prerender"><div class="vditor-ir"><pre class="vditor-reset">${html}</pre></div></div>`
  return document.querySelector<HTMLElement>(
    '#vmarkd-prerender .vditor-reset',
  ) as HTMLElement
}

function installGlobals() {
  const hljs = loadHljs()
  loadHljsThirdLanguages(hljs)
  const w = window as unknown as { hljs?: unknown; katex?: unknown }
  w.hljs = hljs
  w.katex = requireCjs(vditorJs('katex/katex.min.js'))
}

const count = (root: Element, marker: string) =>
  root.querySelectorAll(PARITY_MARKERS[marker]).length

describe('decorateOverlay (the overlay stage of the registry)', () => {
  it('is a no-op for a missing root and for missing hljs / KaTeX globals', () => {
    expect(decorateOverlay(null)).toBe(0)
    if (!LUTE_BUILT) return
    const root = overlayRoot(irHtml)
    const before = root.innerHTML
    decorateOverlay(root)
    // Callouts / comments / `.hljs` source tagging need no global; token colours and KaTeX do.
    expect(count(root, 'hljs-token')).toBe(0)
    expect(count(root, 'katex')).toBe(0)
    expect(root.innerHTML).not.toBe(before)
  })

  it('adds every overlay-stage marker of the canonical document', () => {
    if (!LUTE_BUILT) return
    installGlobals()
    const root = overlayRoot(irHtml)
    const plain = Object.fromEntries(
      CONTENT_DECORATORS.flatMap((d) => d.parityMarkers).map((m) => [
        m,
        count(root, m),
      ]),
    )
    decorateOverlay(root)
    const reached = CONTENT_DECORATORS.filter((d) => d.decorate)
      .flatMap((d) => d.parityMarkers)
      .filter((m, i, all) => all.indexOf(m) === i)
    expect(reached.sort()).toEqual(
      [
        'callout-title',
        'callout-type',
        'hljs',
        'hljs-token',
        'html-comment',
        'katex',
      ].sort(),
    )
    for (const m of reached)
      expect(
        count(root, m),
        `marker "${m}" after decorateOverlay`,
      ).toBeGreaterThan(plain[m] ?? 0)
  })

  it('is idempotent', () => {
    if (!LUTE_BUILT) return
    installGlobals()
    const root = overlayRoot(irHtml)
    decorateOverlay(root)
    const once = root.innerHTML
    decorateOverlay(root)
    expect(root.innerHTML).toBe(once)
  })

  it('never changes the markdown the DOM serializes to (paint-only)', () => {
    if (!LUTE_BUILT || !lute) return
    installGlobals()
    const root = overlayRoot(irHtml)
    const plain = lute.VditorIRDOM2Md(root.innerHTML)
    decorateOverlay(root)
    expect(lute.VditorIRDOM2Md(root.innerHTML)).toBe(plain)
  })

  it('typesets math with the same options as Vditor (display mode for the block)', () => {
    if (!LUTE_BUILT) return
    installGlobals()
    const root = overlayRoot(irHtml)
    decorateOverlay(root)
    const block = root.querySelector('div.language-math[data-math]')
    const inline = root.querySelector('span.language-math[data-math]')
    expect(block?.querySelector('.katex-display')).not.toBeNull()
    expect(inline?.querySelector('.katex')).not.toBeNull()
    expect(inline?.querySelector('.katex-display')).toBeNull()
  })

  it('keeps going when one decorator throws', () => {
    if (!LUTE_BUILT) return
    installGlobals()
    const root = overlayRoot(irHtml)
    const spy = vi
      .spyOn(CONTENT_DECORATORS[0], 'decorate')
      .mockImplementationOnce(() => {
        throw new Error('boom')
      })
    expect(() => decorateOverlay(root)).not.toThrow()
    spy.mockRestore()
    // the first decorator (callouts) threw; a later one (math) still ran
    expect(count(root, 'katex')).toBeGreaterThan(0)
  })

  describe('only the first two viewports are decorated', () => {
    // jsdom has no layout: block i sits at i * 100px (document order), the window is 500px tall.
    const BLOCK = 100
    const html = Array.from(
      { length: 20 },
      (_, i) => `<div class="language-math">x^${i}</div>`,
    ).join('')
    const stubLayout = () => {
      const orig = Element.prototype.getBoundingClientRect
      Element.prototype.getBoundingClientRect = function (this: Element) {
        const i = this.parentElement
          ? Array.prototype.indexOf.call(this.parentElement.children, this)
          : 0
        return { top: i * BLOCK } as DOMRect
      }
      vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(500)
      return () => {
        Element.prototype.getBoundingClientRect = orig
        vi.restoreAllMocks()
      }
    }

    it('typesets the blocks within two viewports, leaves the tail plain, keeps the order', () => {
      installGlobals()
      const root = overlayRoot(html)
      const restore = stubLayout()
      try {
        decorateOverlay(root)
      } finally {
        restore()
      }
      const blocks = Array.from(root.children)
      expect(blocks).toHaveLength(20)
      // tops 0..1000 are inside 2 x 500; the first block past it (top 1100, index 11) ends the head
      const typeset = blocks.map((b) => b.hasAttribute('data-math'))
      expect(typeset.indexOf(false)).toBe(11)
      expect(typeset.lastIndexOf(true)).toBe(10)
      expect(blocks.map((b) => b.textContent?.startsWith('x^'))).toEqual(
        blocks.map((_, i) => i >= 11),
      )
      expect(blocks[11].textContent).toBe('x^11')
    })

    it('decorates everything when there is no layout to measure', () => {
      installGlobals()
      const root = overlayRoot(html)
      decorateOverlay(root)
      expect(
        Array.from(root.children).every((b) => b.hasAttribute('data-math')),
      ).toBe(true)
    })
  })
})

describe('observeDecorators (the live stages of the registry)', () => {
  const ctx = (): ObserveContext => ({
    app: document.createElement('div'),
    previewEl: document.createElement('div'),
    activeMode: document.createElement('div'),
    blockMode: () => null,
    post: () => undefined,
    getHljs: () => undefined,
  })

  it('registers the edit and preview instances under the keys finish-init always used', () => {
    const keys: string[] = []
    const dispose = vi.fn()
    observeDecorators('edit', ctx(), (k, d) => {
      keys.push(k)
      d()
      dispose()
    })
    observeDecorators('preview', ctx(), (k, d) => {
      keys.push(k)
      d()
      dispose()
    })
    expect(keys.sort()).toEqual(
      [
        'callouts',
        'code-refs',
        'code-source',
        'diagram-zoom',
        'html-comments',
        'soft-breaks',
        'wysiwyg-highlight',
        'preview-callouts',
        'preview-code-refs',
        'preview-html-comments',
      ].sort(),
    )
  })
})
