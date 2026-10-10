// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CUSTOM_LANGS, observeCodeSource, tagCodeSource } from './code-source'

function markerPre(lang: string): HTMLElement {
  const pre = document.createElement('pre')
  pre.className = 'vditor-ir__marker--pre'
  const code = document.createElement('code')
  code.className = `language-${lang}`
  pre.appendChild(code)
  return pre
}

// A `.vditor-reset` root with 2 top-level code-block nodes, matching Vditor's real IR shape closely
// enough for mutation-scope.ts's topLevelBlock climb (`ir.element` IS the `.vditor-reset` node).
function irWithTwoBlocks(): {
  ir: HTMLElement
  nodeA: HTMLElement
  nodeB: HTMLElement
} {
  const ir = document.createElement('pre')
  ir.className = 'vditor-ir vditor-reset'
  const nodeA = document.createElement('div')
  nodeA.className = 'vditor-ir__node'
  nodeA.setAttribute('data-type', 'code-block')
  nodeA.appendChild(markerPre('js'))
  const nodeB = document.createElement('div')
  nodeB.className = 'vditor-ir__node'
  nodeB.setAttribute('data-type', 'code-block')
  nodeB.appendChild(markerPre('python'))
  ir.append(nodeA, nodeB)
  document.body.appendChild(ir)
  return { ir, nodeA, nodeB }
}

describe('tagCodeSource', () => {
  it('tags real code-block source with .hljs (theme-driven edit == render)', () => {
    const root = document.createElement('div')
    root.append(markerPre('js'), markerPre('python'))
    tagCodeSource(root)
    for (const code of Array.from(root.querySelectorAll('code'))) {
      expect(code.classList.contains('hljs')).toBe(true)
    }
  })

  it('leaves diagram-language source alone (no .hljs code panel — sits on the page bg)', () => {
    // Every custom-diagram renderer must be excluded, or its editable source gets the dark
    // code panel instead of the page background (the bug behind "te nowe trzeba poprawic").
    for (const lang of [
      'd2',
      'wavedrom',
      'nomnoml',
      'geojson',
      'topojson',
      'vega',
      'vega-lite',
      'stl',
      'smiles',
      'mermaid',
    ]) {
      const root = document.createElement('div')
      root.append(markerPre(lang))
      tagCodeSource(root)
      const code = root.querySelector('code')!
      expect(code.classList.contains('hljs')).toBe(false)
    }
  })

  it('CUSTOM_LANGS covers every custom-diagram renderer', () => {
    for (const lang of [
      'wavedrom',
      'nomnoml',
      'geojson',
      'topojson',
      'vega',
      'vega-lite',
      'stl',
      'd2',
    ]) {
      expect(CUSTOM_LANGS.has(lang)).toBe(true)
    }
  })
})

// Task 173: observeCodeSource is scoped via mutation-scope.ts instead of a whole-root tagCodeSource
// on every batch. These exercise the REAL MutationObserver-driven path (not a direct tagCodeSource
// call), the same way the product actually runs it, so the scoped branch is covered.
//
// Deterministic rAF (same pattern as observe-coalesce.test.ts): coalescePerFrameWithRecords's leading
// edge runs synchronously, but it ALSO arms a trailing-edge rAF — a real, un-stubbed jsdom rAF may not
// resolve within a plain `await`, which would silently strand a same-"frame" edit in `pending`. Stub
// it so the trailing pass is triggered explicitly via `fireFrame()`.
describe('observeCodeSource (task 173 scoping)', () => {
  let dispose: (() => void) | null = null
  let frameCallbacks: FrameRequestCallback[]
  beforeEach(() => {
    frameCallbacks = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frameCallbacks.push(cb)
      return frameCallbacks.length
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      // Mark the slot cancelled so a later flush of frameCallbacks can't
      // re-invoke a callback the code under test already cancelled.
      frameCallbacks[id - 1] = () => {
        /* cancelled */
      }
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    dispose?.()
    dispose = null
    document.body.innerHTML = ''
  })
  const fireFrame = () => {
    const cbs = frameCallbacks
    frameCallbacks = []
    for (const cb of cbs) cb(0)
  }

  it('tags both sources on mount (initial full-walk pass)', () => {
    const { ir } = irWithTwoBlocks()
    dispose = observeCodeSource(ir)
    for (const code of Array.from(ir.querySelectorAll('code')))
      expect(code.classList.contains('hljs')).toBe(true)
  })

  it('a real outerHTML replace of ONE block re-tags the FRESH code element via the scoped path', async () => {
    const { ir, nodeA } = irWithTwoBlocks()
    dispose = observeCodeSource(ir) // mount's leading run also arms a trailing-edge rAF
    // Mirrors the spin's `blockElement.outerHTML = html`: the pre-existing `<code>` is destroyed and
    // a brand-new one takes its place — the real regression risk task 173 warns about (a freshly
    // recreated node the scoped re-tag pass must still find).
    nodeA.outerHTML =
      '<div class="vditor-ir__node" data-type="code-block"><pre class="vditor-ir__marker--pre"><code class="language-ts">const x = 1</code></pre></div>'
    await Promise.resolve() // flush the MutationObserver microtask → coalesced into `pending` (mount's rAF is still armed)
    fireFrame() // …flush the trailing pass, which resolves the scoped block via mutation-scope.ts
    const codes = Array.from(ir.querySelectorAll('code'))
    expect(codes).toHaveLength(2)
    for (const code of codes) expect(code.classList.contains('hljs')).toBe(true)
  })

  // The bug: bound once to the mode element active at init, so a live sv/WYSIWYG -> IR switch (Vditor
  // rebuilds ir.element.innerHTML) left the IR sources untagged. Bound to the stable root instead.
  it('tags IR sources rebuilt into the pane AFTER mount when bound to the stable root (mode switch)', async () => {
    const app = document.createElement('div')
    app.innerHTML =
      '<div class="vditor-ir vditor-reset"></div><div class="vditor-sv vditor-reset"></div>'
    document.body.append(app)
    dispose = observeCodeSource(app)
    const ir = app.querySelector('.vditor-ir') as HTMLElement
    ir.innerHTML =
      '<div class="vditor-ir__node" data-type="code-block"><pre class="vditor-ir__marker--pre"><code class="language-ts">a</code></pre></div>'
    await Promise.resolve()
    fireFrame()
    expect(ir.querySelector('code')?.classList.contains('hljs')).toBe(true)
  })

  it('never tags anything outside the IR pane, and does not scan a non-IR block', async () => {
    const app = document.createElement('div')
    app.innerHTML =
      '<div class="vditor-ir vditor-reset"></div><div class="vditor-sv vditor-reset"><div data-block="0"></div></div>'
    document.body.append(app)
    dispose = observeCodeSource(app)
    const sv = app.querySelector('.vditor-sv > div') as HTMLElement
    sv.innerHTML =
      '<pre class="vditor-ir__marker--pre"><code class="language-ts">a</code></pre>'
    await Promise.resolve()
    fireFrame()
    expect(sv.querySelector('code')?.classList.contains('hljs')).toBe(false)
  })
})
