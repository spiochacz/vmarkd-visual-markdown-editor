// @vitest-environment jsdom

import { beforeEach, expect, it, vi } from 'vitest'
import { Disposables } from '../util/disposables'

const installDiagramRuntime = vi.fn()
const installDiagramZoomGate = vi.fn()

vi.mock('../diagrams/diagram-runtime', () => ({ installDiagramRuntime }))
// Task 412 — finish-init.ts registers this directly (not through installDiagramRuntime's per-lang
// adapter table, mocked above), so it needs its own mock here.
vi.mock('../diagrams/diagram-retheme', () => ({
  disposeDiagramRethemeGate: vi.fn(),
}))
vi.mock('../util/inner-vditor', () => ({
  innerVditor: () => ({
    preview: { previewElement: undefined as HTMLElement | undefined },
  }),
}))
// `blockModeElement` is null in sv (see source-map.test.ts) — the trailing-paragraph invariant must be
// bound to it, not to `activeModeElement`, or the sv pane gets a ZWSP paragraph that is saved to disk.
const blockModeElement = vi.fn((): HTMLElement | null => null)
const observeTrailingParagraph = vi.fn(
  (_root: HTMLElement | null, _get?: () => HTMLElement | null) => vi.fn(),
)
vi.mock('../util/source-map', () => ({
  activeModeElement: (): HTMLElement | undefined => undefined,
  blockModeElement,
}))
vi.mock('../chrome/responsive-tables', () => ({ fixResponsiveTables: vi.fn() }))
vi.mock('../chrome/toolbar-actions', () => ({
  handleToolbarClick: vi.fn(),
  reportEditorMode: vi.fn(),
}))
vi.mock('../chrome/toolbar-scroll-guard', () => ({
  guardToolbarScroll: vi.fn(),
}))
vi.mock('../editing/fix-table-ir', () => ({ fixTableIr: vi.fn() }))
vi.mock('../nav/outline', () => ({ setupOutlineFlash: vi.fn() }))
vi.mock('../nav/outline-resize', () => ({ setupOutlineResize: vi.fn() }))
vi.mock('../editing/preview-morph', () => ({ installPreviewMorph: vi.fn() }))
vi.mock('../nav/split-scroll-sync', () => ({ setupSplitScrollSync: vi.fn() }))
vi.mock('../nav/preview-scroll-preserve', () => ({
  setupPreviewScrollPreserve: vi.fn(),
}))
vi.mock('../editing/callouts', () => ({ observeCallouts: () => vi.fn() }))
vi.mock('../diagrams/diagram-zoom', () => ({
  observeDiagramZoom: () => vi.fn(),
}))
vi.mock('../editing/html-comment', () => ({
  observeHtmlComments: () => vi.fn(),
  observePreviewComments: () => vi.fn(),
}))
vi.mock('../editing/code-source', () => ({ observeCodeSource: () => vi.fn() }))
vi.mock('../editing/wysiwyg-code-highlight', () => ({
  ensureHljsLoaded: () => Promise.resolve(),
  observeWysiwygCodeHighlight: () => vi.fn(),
  wrapLuteFlatten: vi.fn(),
}))
vi.mock('../editing/gap-paragraph', () => ({ observeTrailingParagraph }))
vi.mock('../diagrams/diagram-zoom-gate', () => ({ installDiagramZoomGate }))
// list-backspace imports Vditor internals (constants.ts → the esbuild-defined VDITOR_VERSION global),
// so it must be mocked here like the other installers — the real thing is covered by list-backspace.spec.
vi.mock('../editing/list-backspace', () => ({
  installListBackspace: () => vi.fn(),
}))
vi.mock('../diagrams/echarts-fit', () => ({
  installEchartsResize: () => vi.fn(),
}))
vi.mock('../diagrams/smiles-render', () => ({ observeSmiles: () => vi.fn() }))
vi.mock('../diagrams/custom-diagrams', () => ({
  observeCustomDiagrams: () => vi.fn(),
}))
vi.mock('../diagrams/render-cache-client', () => ({
  installRenderCache: () => vi.fn(),
}))
vi.mock('../diagrams/markmap-fit', () => ({
  installMarkmapResize: () => vi.fn(),
}))
vi.mock('../diagrams/abc-fit', () => ({ observeAbc: () => vi.fn() }))
vi.mock('../diagrams/echarts-retheme', () => ({
  observeMindmaps: () => vi.fn(),
}))
vi.mock('../diagrams/mermaid/mermaid-retheme', () => ({
  disposeMermaidDeferObserver: vi.fn(),
}))
vi.mock('../editing/edit-activity', () => ({
  installEditActivity: () => vi.fn(),
}))

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>'
  installDiagramRuntime.mockClear()
  ;(window as unknown as { vditor: unknown }).vditor = {}
  ;(
    globalThis as unknown as {
      vscode: { postMessage: ReturnType<typeof vi.fn> }
    }
  ).vscode = { postMessage: vi.fn() }
})

it('delegates the diagram lifecycle to the phased runtime installer', async () => {
  const { runFinishInit } = await import('./finish-init')
  const observers = new Disposables()

  runFinishInit(
    { content: '', options: {} } as Parameters<typeof runFinishInit>[0],
    {
      observers,
      cdn: 'test',
      reportDocMode: vi.fn(),
    },
  )

  expect(installDiagramRuntime).toHaveBeenCalledOnce()
  expect(installDiagramZoomGate.mock.invocationCallOrder[0]).toBeLessThan(
    installDiagramRuntime.mock.invocationCallOrder[0],
  )
  const runtimeContext = installDiagramRuntime.mock.calls[0][0]
  expect(runtimeContext).toMatchObject({
    app: document.getElementById('app'),
    win: window,
    observers,
  })

  runtimeContext.postCacheMessage({ command: 'diagram-cache-get' })
  expect(vscode.postMessage).toHaveBeenCalledWith({
    command: 'diagram-cache-get',
  })
})

it('binds the trailing-paragraph invariant to #app with a lazy block-mode getter (null in sv)', async () => {
  const { runFinishInit } = await import('./finish-init')
  document.body.replaceChildren()
  const app = document.createElement('div')
  app.id = 'app'
  document.body.appendChild(app)
  const ir = document.createElement('div')
  const wysiwyg = document.createElement('div')
  // The mode changes between runs WITHOUT a re-init: ir -> sv -> wysiwyg.
  blockModeElement
    .mockReturnValueOnce(ir)
    .mockReturnValueOnce(null)
    .mockReturnValueOnce(wysiwyg)
  observeTrailingParagraph.mockClear()
  runFinishInit(
    { content: '', options: {} } as Parameters<typeof runFinishInit>[0],
    { observers: new Disposables(), cdn: 'test', reportDocMode: vi.fn() },
  )
  const [root, getEditor] = observeTrailingParagraph.mock
    .calls[0] as unknown as [HTMLElement, () => HTMLElement | null]
  expect(root).toBe(app)
  expect([getEditor(), getEditor(), getEditor()]).toEqual([ir, null, wysiwyg])
  app.remove()
})
