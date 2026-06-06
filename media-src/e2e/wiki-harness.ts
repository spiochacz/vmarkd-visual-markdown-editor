import '../src/preload'
import Vditor from 'vditor'
import { setupCustomRenderer, wikiTextToHtml } from '../src/custom-renderer'
import { patchLuteSerialize, setKnownPagesRef } from '../src/wiki-serialize'
import { fixLinkClick } from '../src/utils'
import {
  installLinkOpenGate,
  applyLinkOpenSetting,
} from '../src/link-open-policy'

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

for (const k of [
  'home',
  'alpha',
  'beta',
  'target',
  'getting-started',
  'sub/deep-page',
])
  knownPages.add(k)

// 'sub/Deep Page' models a path-qualified display name (duplicate-basename case):
// the host sends the relative path so the autocomplete entry is distinguishable
// and the inserted [[sub/Deep Page]] resolves to exactly one file.
const hintPages = new Set([
  'Home',
  'Alpha',
  'Beta',
  'Target',
  'Getting Started',
  'sub/Deep Page',
])
;(window as any).__knownPages = knownPages
;(window as any).__wikiTextToHtml = wikiTextToHtml
;(window as any).__originalValue = value

;(window as any).__setKnownPages = (keys: string[]) => {
  knownPages.clear()
  for (const k of keys) knownPages.add(k)
}

;(window as any).__reRender = () => {
  const v = (window as any).vditor
  const md = v.getValue()
  v.setValue(md.includes('[[') ? md : value)
}

// Capture postMessage calls so the spec can assert on navigation messages.
const messages: any[] = []
;(window as any).__messages = messages
const origPostMessage = (window as any).__vscodeApi?.postMessage
if (origPostMessage) {
  ;(window as any).__vscodeApi.postMessage = (msg: any) => {
    messages.push(msg)
    origPostMessage(msg)
  }
}

// Install link-open policy (default: modifier mode = Ctrl+click to follow).
installLinkOpenGate()
applyLinkOpenSetting(true)

function wikiHintExtend(value: string) {
  const esc = (s: string) =>
    s.replace(
      /[&<>"]/g,
      (c: string) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
    )
  const lower = value.toLowerCase()
  const results: { html: string; value: string }[] = []
  for (const page of hintPages) {
    if (page.toLowerCase().includes(lower)) {
      const src = `[[${page}]]`
      results.push({
        html: page,
        value: `<span class="wiki-link-chip" data-wiki-link="1" data-wiki-target="${esc(page)}" data-wiki-source="${esc(src)}">${esc(page)}</span>`,
      })
    }
  }
  return results
}
;(window as any).__wikiHintExtend = wikiHintExtend

const editor = new Vditor('app', {
  cache: { enable: false },
  mode: 'ir',
  cdn: `${location.origin}/vditor`,
  value,
  toolbar: ['preview'],
  hint: {
    parse: false,
    extend: [{ key: '[[', hint: wikiHintExtend }],
  },
  after() {
    ;(window as any).vditor = editor
    setupCustomRenderer(editor, { enabled: true, knownPages })
    setKnownPagesRef(knownPages)
    patchLuteSerialize(editor)
    editor.setValue(value)

    // Wire up click handling (fixLinkClick installs the wiki + link handlers).
    fixLinkClick()

    // Re-intercept postMessage after fixLinkClick may have re-acquired the API.
    const api = (window as any).__vscodeApi
    if (api && !api.__patched) {
      const orig = api.postMessage.bind(api)
      api.postMessage = (msg: any) => {
        messages.push(msg)
        return orig(msg)
      }
      api.__patched = true
    }

    ;(window as any).__ready = true
  },
})
