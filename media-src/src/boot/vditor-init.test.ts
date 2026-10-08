// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Coverage-ratchet net (task 403 group 1) for the two pieces of vditor-init.ts that are
// separable from actually constructing a Vditor instance: renderCacheThemeKey (pure) and
// applyVditorTheme (a thin wrapper over setVditorTheme, gated on window.vditor). initVditor
// itself constructs a REAL `vditor/src/index` instance and is deliberately left to the
// real-VS-Code e2e suite (task 399's fast-tier run) — mocking Vditor's own construction for a
// unit test would test the mock, not the editor, the same reason editor-caret.ts/
// prerender-overlay.ts stay e2e-only.
const h = vi.hoisted(() => ({ setVditorTheme: vi.fn() }))
vi.mock('./vditor-theme', () => ({ setVditorTheme: h.setVditorTheme }))
// vditor-init.ts imports the SOURCE entry ('vditor/src/index', not the published dist), which
// pulls in Vditor's whole source tree including its .less assets (see vscode-api.ts's own
// comment on why it avoids this as a type root) — vitest's CSS pipeline has no `less`
// preprocessor installed and fails just importing the file. Stub it out entirely: nothing
// under test here calls `new Vditor(...)`.
vi.mock('vditor/src/index', () => ({ default: class MockVditor {} }))
// stream-render.ts (only used by initVditor's streaming branch, not by the two functions under
// test) imports Vditor's INTERNAL ts files directly (`vditor/src/ts/ir/process`, `.../
// util/processCode`), bypassing the barrel above — those reference a `VDITOR_VERSION` global
// esbuild injects via `define` at build time (media-src/esbuild-shared.mjs) and vitest does not.
// Stub the whole module rather than chase every internal Vditor import transitively.
vi.mock('../diagrams/stream-render', () => ({
  streamRenderIR: vi.fn(),
}))
// Everything below is a collaborator of `initVditor` (the Vditor-construction/streaming
// lifecycle we deliberately do NOT unit test — see header) that the two functions under test
// never touch. Several transitively import Vditor's internal ts files the same way
// stream-render.ts does (toolbar icons, callout/link DOM patches, mermaid/echarts wiring,
// finish-init's ~12 observer modules) — mocked wholesale so loading this file doesn't drag in
// Vditor's whole source tree a second (third, fourth…) time.
vi.mock('../diagram-kit/d2-config', () => ({ setD2Config: vi.fn() }))
vi.mock('../clipboard/upload-handler', () => ({ createUploadHandler: vi.fn() }))
vi.mock('../chrome/toolbar', () => ({ createToolbar: vi.fn(() => []) }))
vi.mock('../links/custom-renderer', () => ({ setupCustomRenderer: vi.fn() }))
vi.mock('../links/wiki-serialize', () => ({
  patchLuteSerialize: vi.fn(),
  setKnownPagesRef: vi.fn(),
}))
vi.mock('../bridge/edit-sync', () => ({ createEditSync: vi.fn() }))
vi.mock('./finish-init', () => ({ runFinishInit: vi.fn() }))
vi.mock('../chrome/prerender-overlay', () => ({
  bridgePrepaintScroll: vi.fn(),
  removePrerenderOverlay: vi.fn(),
  removeStreamSpinner: vi.fn(),
  showRealToolbarInOverlay: vi.fn(),
  showStreamSpinner: vi.fn(),
}))
vi.mock('../diagrams/render-cache-client', () => ({
  setRenderCacheConfig: vi.fn(),
}))
vi.mock('../diagrams/mermaid/mermaid-theme', () => ({
  applyMermaidTheme: vi.fn(),
  resolveMermaidInit: vi.fn(),
}))
vi.mock('../../../src/shared/echarts-theme', () => ({
  resolveEchartsTheme: vi.fn(),
}))
vi.mock('../diagrams/echarts-apply', () => ({
  applyEchartsTheme: vi.fn(),
  readVscodePalette: vi.fn(),
}))
vi.mock('../diagrams/flowchart-retheme', () => ({
  applyFlowchartLabelHalo: vi.fn(),
  flowchartDrawOptions: vi.fn(),
}))
vi.mock('../editing/callouts', () => ({ calloutWysiwygToolbar: vi.fn() }))
vi.mock('../links/link-click', () => ({ openLinkFromMarker: vi.fn() }))
vi.mock('../links/link-url', () => ({ applyPasteUrlSetting: vi.fn() }))
vi.mock('../bridge/edit-sync-tuning', () => ({
  undoDelayForContentLength: vi.fn(),
}))
vi.mock('../chrome/toolbar-actions', () => ({
  setPersistModeOverride: vi.fn(),
}))

import { applyVditorTheme, renderCacheThemeKey } from './vditor-init'
import { sessionState } from './editor-session-state'

describe('renderCacheThemeKey', () => {
  // Task 408 — narrowed to the GLOBAL fragment only (mode/contentTheme/fontSize: everything that
  // changes EVERY engine's render output). Per-engine settings (mermaidTheme, d2Layout, …) used to
  // live here too, folded into one flat string shared by every engine's cache key — meaning a
  // single engine's setting change invalidated every OTHER engine's cached SVGs as a side effect.
  // They now feed render-cache-client's per-lang engineCacheKeyFragment instead (see
  // diagram-config-delta.test.ts + render-cache-client.test.ts's "per-engine cache-key fragment").
  it('folds mode/contentTheme/fontSize into one pipe-joined key', () => {
    const key = renderCacheThemeKey({
      content: '',
      theme: 'dark',
      options: {
        contentTheme: 'github-dark',
        mermaidTheme: 'auto',
        mermaidLayout: 'elk',
        echartsTheme: 'auto',
        d2Layout: 'dagre',
        d2Theme: '0',
        d2Sketch: false,
        fontSize: '14px',
      },
    })
    expect(key).toBe('dark|github-dark|14px')
  })

  it('a non-dark theme normalises to "light"', () => {
    const key = renderCacheThemeKey({ content: '', theme: 'system' as any })
    expect(key.startsWith('light|')).toBe(true)
  })

  it('missing options fold to empty segments, not "undefined"', () => {
    const key = renderCacheThemeKey({ content: '', theme: 'light' })
    expect(key).toBe('light||')
    expect(key).not.toContain('undefined')
  })

  it('two payloads differing only in a PER-ENGINE option (d2Theme) produce the SAME global key', () => {
    // d2Theme is now d2's own configKeys concern (render-cache-client's engineCacheKeyFragment),
    // not part of the global themeKey — so it must NOT move this key at all any more.
    const base = {
      content: '',
      theme: 'dark' as const,
      options: { d2Theme: '0' },
    }
    const changed = { ...base, options: { d2Theme: '1' } }
    expect(renderCacheThemeKey(base)).toBe(renderCacheThemeKey(changed))
  })

  it('two payloads differing in a GLOBAL option (contentTheme) produce different keys', () => {
    const base = {
      content: '',
      theme: 'dark' as const,
      options: { contentTheme: 'auto' },
    }
    const changed = { ...base, options: { contentTheme: 'github-dark' } }
    expect(renderCacheThemeKey(base)).not.toBe(renderCacheThemeKey(changed))
  })
})

describe('applyVditorTheme', () => {
  beforeEach(() => {
    sessionState.lastInitMsg = null
    h.setVditorTheme.mockClear()
  })
  afterEach(() => {
    ;(window as any).vditor = undefined
  })

  it('no-ops when there is no live Vditor instance yet', () => {
    ;(window as any).vditor = undefined
    applyVditorTheme('dark')
    expect(h.setVditorTheme).not.toHaveBeenCalled()
  })

  it('applies the theme through setVditorTheme, reading code style + cdn from sessionState', () => {
    const vd = {}
    ;(window as any).vditor = vd
    sessionState.lastInitMsg = {
      content: '',
      cdn: 'https://cdn.example/vditor',
      options: { codeTheme: 'monokai' },
    }
    applyVditorTheme('dark')
    expect(h.setVditorTheme).toHaveBeenCalledTimes(1)
    expect(h.setVditorTheme).toHaveBeenCalledWith(
      vd,
      'dark',
      'monokai',
      'https://cdn.example/vditor',
    )
  })

  it('falls back to no cdn / no explicit code style when lastInitMsg is unset', () => {
    ;(window as any).vditor = {}
    applyVditorTheme('light')
    expect(h.setVditorTheme).toHaveBeenCalledTimes(1)
    const [, mode, , cdn] = h.setVditorTheme.mock.calls[0]
    expect(mode).toBe('light')
    expect(cdn).toBeUndefined()
  })
})
