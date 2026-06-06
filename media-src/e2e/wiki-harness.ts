import '../src/preload'
import Vditor from 'vditor'
import { setupCustomRenderer, wikiTextToHtml } from '../src/custom-renderer'
import { patchLuteSerialize } from '../src/wiki-serialize'

// Wiki-link rendering harness. Creates a real Vditor (IR mode) with wiki
// custom renderers registered, so [[wiki]] syntax renders as chip spans.
// The spec can update knownPages via __setKnownPages and re-render to verify
// chip states (existing vs missing).

const knownPages = new Set<string>()

const value = [
  '# Wiki test page',
  '',
  'A link to [[Home]] and one to [[Missing Page]].',
  '',
  'A pipe link: [[Target|Display Label]].',
  '',
  'Multiple on one line: [[Alpha]] and [[Beta]] and [[Gamma]].',
  '',
  'Inline with text before [[Page A]] and after.',
  '',
  'Nested in bold: **see [[Bold Link]]**.',
  '',
].join('\n')

// Pre-populate knownPages — the spec can change this and re-render.
for (const k of ['home', 'alpha', 'beta', 'target']) knownPages.add(k)
;(window as any).__knownPages = knownPages
;(window as any).__wikiTextToHtml = wikiTextToHtml

// Update knownPages set and optionally re-render the editor.
;(window as any).__originalValue = value

;(window as any).__setKnownPages = (keys: string[]) => {
  knownPages.clear()
  for (const k of keys) knownPages.add(k)
}

// Re-render with current knownPages. With patchLuteSerialize, getValue()
// preserves [[wiki]] syntax, so we can use it for re-render. Falls back
// to the original value in case of any issue.
;(window as any).__reRender = () => {
  const v = (window as any).vditor
  const md = v.getValue()
  v.setValue(md.includes('[[') ? md : value)
}

const editor = new Vditor('app', {
  cache: { enable: false },
  mode: 'ir',
  cdn: `${location.origin}/vditor`,
  value,
  after() {
    ;(window as any).vditor = editor
    setupCustomRenderer(editor, { enabled: true, knownPages })
    patchLuteSerialize(editor)
    // Re-render with wiki renderers active (constructor ran before setup).
    editor.setValue(value)
    ;(window as any).__ready = true
  },
})
