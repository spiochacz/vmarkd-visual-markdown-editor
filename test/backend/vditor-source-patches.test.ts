import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  patchIrLinkClick,
  patchWysiwygLinkClick,
  patchListToggle,
  patchOutlineCurrent,
  patchMathRender,
  patchProcessCode,
  patchIrInputSerialize,
  patchInfoDialog,
  patchPreviewCopyTip,
  patchIrBlurExpand,
  patchSetContentTheme,
  patchCalloutArrowNav,
} from '../../media-src/esbuild-shared.mjs'

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const irSource = read('../../media-src/node_modules/vditor/src/ts/ir/index.ts')
const fixBrowserSource = read(
  '../../media-src/node_modules/vditor/src/ts/util/fixBrowserBehavior.ts',
)
const mathSource = read(
  '../../media-src/node_modules/vditor/src/ts/markdown/mathRender.ts',
)
const wysiwygSource = read(
  '../../media-src/node_modules/vditor/src/ts/wysiwyg/index.ts',
)
const processCodeSource = read(
  '../../media-src/node_modules/vditor/src/ts/util/processCode.ts',
)
const outlineSource = read(
  '../../media-src/node_modules/vditor/src/ts/toolbar/Outline.ts',
)
const irProcessSource = read(
  '../../media-src/node_modules/vditor/src/ts/ir/process.ts',
)
const infoSource = read(
  '../../media-src/node_modules/vditor/src/ts/toolbar/Info.ts',
)
// Reading this path also guards against a file rename: if Vditor moves
// preview/index.ts, this readFileSync throws at load and the suite fails loudly —
// the esbuild onLoad filter would otherwise silently skip the patch (no build error).
const previewSource = read(
  '../../media-src/node_modules/vditor/src/ts/preview/index.ts',
)
const editorCommonEventSource = read(
  '../../media-src/node_modules/vditor/src/ts/util/editorCommonEvent.ts',
)
const setContentThemeSource = read(
  '../../media-src/node_modules/vditor/src/ts/ui/setContentTheme.ts',
)

// The unguarded link-open condition Vditor ships — plain click follows the link.
const UNGATED =
  'if (aElement && (!aElement.classList.contains("vditor-ir__node--expand"))) {'

describe('patchIrLinkClick (task 62)', () => {
  // Confirms the behaviour exists in the code we actually ship today: a plain
  // (no-modifier) click on an IR link enters the open branch.
  it('the shipped Vditor IR source opens links on a plain click (pre-patch)', () => {
    expect(irSource).toContain(UNGATED)
    expect(irSource).toContain(
      'window.open(aElement.querySelector(":scope > .vditor-ir__marker--link").textContent);',
    )
  })

  it('gates the open branch behind the runtime link-open policy', () => {
    const patched = patchIrLinkClick(irSource)
    expect(patched).not.toContain(UNGATED)
    expect(patched).toContain('window.__vmarkdShouldOpenLink(event)')
    // The marker still feeds link.click/window.open inside the now-gated block.
    expect(patched).toContain(
      'window.open(aElement.querySelector(":scope > .vditor-ir__marker--link").textContent);',
    )
  })

  it('throws (fails the build loudly) if the anchor is gone — version-bump guard', () => {
    expect(() => patchIrLinkClick('// unrelated source')).toThrow(
      /fixIrLinkClick/,
    )
  })

  it('is idempotent-safe: re-running on patched output does not double-gate', () => {
    const once = patchIrLinkClick(irSource)
    // The original anchor is gone after patching, so a second run must throw
    // rather than silently patch again.
    expect(() => patchIrLinkClick(once)).toThrow(/fixIrLinkClick/)
  })
})

describe('patchWysiwygLinkClick (task 62)', () => {
  const WYSIWYG_UNGATED =
    'const a = hasClosestByMatchTag(event.target, "A");\n            if (a) {'

  it('the shipped Vditor WYSIWYG source opens links on a plain click (pre-patch)', () => {
    expect(wysiwygSource).toContain(WYSIWYG_UNGATED)
  })

  it('gates the WYSIWYG open branch behind the runtime link-open policy', () => {
    const patched = patchWysiwygLinkClick(wysiwygSource)
    expect(patched).not.toContain(WYSIWYG_UNGATED)
    expect(patched).toContain(
      'if (a && (window.__vmarkdShouldOpenLink ? window.__vmarkdShouldOpenLink(event) : true)) {',
    )
  })

  it('throws (fails the build loudly) if the anchor is gone — version-bump guard', () => {
    expect(() => patchWysiwygLinkClick('// unrelated source')).toThrow(
      /fixWysiwygLinkClick/,
    )
  })
})

describe('patchCalloutArrowNav (callout dual-node arrow navigation)', () => {
  it('the shipped Vditor source checks last-line against raw textContent and splices only TABLE/data-type (pre-patch)', () => {
    expect(fixBrowserSource).toContain(
      'element.textContent.trimRight().substr(position.start).indexOf("\\n") === -1',
    )
    expect(fixBrowserSource).toContain(
      '(nextElement && (nextElement.tagName === "TABLE" || nextElement.getAttribute("data-type")))',
    )
    expect(fixBrowserSource).toContain(
      '(previousElement && (previousElement.tagName === "TABLE" || previousElement.getAttribute("data-type")))',
    )
  })

  it('compares the EDITABLE text (callout preview stripped) and splices for data-callout neighbours', () => {
    const patched = patchCalloutArrowNav(fixBrowserSource)
    // last-line / at-end checks use the preview-stripped text
    expect(patched).toContain(
      'vmarkdEditableText(element).trimRight().substr(position.start).indexOf("\\n") === -1',
    )
    expect(patched).toContain(
      'position.start >= vmarkdEditableText(element).trimRight().length',
    )
    // the helper is injected before insertAfterBlock
    expect(patched).toContain('const vmarkdEditableText = ')
    // both splice sets gain data-callout; TABLE/data-type behaviour preserved
    expect(patched).toContain(
      'nextElement.getAttribute("data-type") || nextElement.hasAttribute("data-callout")',
    )
    expect(patched).toContain(
      'previousElement.getAttribute("data-type") || previousElement.hasAttribute("data-callout")',
    )
    // …and a contenteditable=false neighbour (our #fix-table-ir-wrapper panel) is a splice
    // boundary too — Vditor inserts a paragraph instead of dropping the caret into the panel
    // (which is pinned at top:0 → the end-of-file "jump to top").
    expect(patched).toContain(
      'nextElement.getAttribute("contenteditable") === "false"',
    )
    expect(patched).toContain(
      'previousElement.getAttribute("contenteditable") === "false"',
    )
  })

  it('throws (fails the build loudly) if any anchor is gone — version-bump guard', () => {
    expect(() => patchCalloutArrowNav('// unrelated source')).toThrow(
      /fixCalloutArrowNav/,
    )
  })
})

describe('patchListToggle (task 56 — null-deref crash fix)', () => {
  // Confirms the crashing call ships today: in listToggle's uncheck branch the
  // guard checks only the clicked <li> for an <input>, then iterates ALL sibling
  // <li>; a sibling without a checkbox throws on `.remove()` of null.
  it('the shipped Vditor source removes an <input> without optional chaining (pre-patch)', () => {
    expect(fixBrowserSource).toContain('item.querySelector("input").remove()')
  })

  it('adds optional chaining so a checkbox-less sibling no longer crashes the toggle', () => {
    const patched = patchListToggle(fixBrowserSource)
    expect(patched).not.toContain('item.querySelector("input").remove()')
    expect(patched).toContain('item.querySelector("input")?.remove()')
  })

  it('throws (fails the build loudly) if the anchor is gone — version-bump guard', () => {
    expect(() => patchListToggle('// unrelated source')).toThrow(
      /fixListToggle/,
    )
  })
})

describe('patchSetContentTheme (content-theme stylesheet reload flicker)', () => {
  it('the shipped Vditor source reloads on a raw-string href mismatch (pre-patch)', () => {
    expect(setContentThemeSource).toContain(
      'vditorContentTheme.getAttribute("href") !== cssPath',
    )
  })

  it('compares RESOLVED urls so the same file is not reloaded', () => {
    const patched = patchSetContentTheme(setContentThemeSource)
    expect(patched).not.toContain(
      'vditorContentTheme.getAttribute("href") !== cssPath',
    )
    expect(patched).toContain(
      'new URL(vditorContentTheme.getAttribute("href"), document.baseURI).href !== new URL(cssPath, document.baseURI).href',
    )
  })

  it('throws (fails the build loudly) if the anchor is gone — version-bump guard', () => {
    expect(() => patchSetContentTheme('// unrelated source')).toThrow(
      /fixSetContentTheme/,
    )
  })
})

describe('patchOutlineCurrent (outline toolbar button blue-flash on init)', () => {
  // The shipped Outline item highlights itself with `if (vditor.options.outline)`,
  // an always-truthy object check — so the button is marked active on init even
  // when the outline panel is closed.
  it('the shipped Vditor source checks the truthy object (pre-patch)', () => {
    expect(outlineSource).toContain('if (vditor.options.outline) {')
  })

  it('gates the active highlight on .enable so it matches the panel state', () => {
    const patched = patchOutlineCurrent(outlineSource)
    expect(patched).not.toContain('if (vditor.options.outline) {')
    expect(patched).toContain('if (vditor.options.outline.enable) {')
  })

  it('throws (fails the build loudly) if the anchor is gone — version-bump guard', () => {
    expect(() => patchOutlineCurrent('// unrelated source')).toThrow(
      /fixOutlineCurrent/,
    )
  })
})

describe('patchMathRender (task 57 — KaTeX error resilience)', () => {
  // Confirms the shipped katex call lacks the resilience options today, so a single
  // malformed formula can throw out of renderToString instead of rendering KaTeX's
  // inline red error.
  it('the shipped katex.renderToString has no throwOnError/strict options (pre-patch)', () => {
    expect(mathSource).toContain('katex.renderToString(math, {')
    const call = mathSource.slice(
      mathSource.indexOf('katex.renderToString(math, {'),
    )
    const optionsBlock = call.slice(0, call.indexOf('});'))
    expect(optionsBlock).not.toContain('throwOnError')
    expect(optionsBlock).not.toContain('strict')
  })

  it('adds strict:false + throwOnError:false to the katex call', () => {
    const patched = patchMathRender(mathSource)
    const call = patched.slice(patched.indexOf('katex.renderToString(math, {'))
    const optionsBlock = call.slice(0, call.indexOf('});'))
    expect(optionsBlock).toContain('throwOnError: false')
    expect(optionsBlock).toContain('strict: false')
  })

  it('leaves the (MathJax) tex.macros config untouched — only the katex call changes', () => {
    const patched = patchMathRender(mathSource)
    // throwOnError must appear exactly once (the katex call), not leak into the
    // MathJax branch that shares `macros: options.math.macros`.
    expect(patched.split('throwOnError').length - 1).toBe(1)
  })

  it('throws (fails the build loudly) if the anchor is gone — version-bump guard', () => {
    expect(() => patchMathRender('// unrelated source')).toThrow(
      /fixMathRender/,
    )
  })
})

describe('patchProcessCode (task 63 — content-based paste code detection, PR #1921)', () => {
  // Confirms the marker-based heuristics ship today (they cause #1917/#1914).
  it('the shipped source detects code by IDE markers (pre-patch)', () => {
    expect(processCodeSource).toContain('monospace') // VS Code marker
    expect(processCodeSource).toContain('\\n<p class="p1">') // Xcode marker
  })

  it('replaces marker heuristics with content-based detection', () => {
    const patched = patchProcessCode(processCodeSource)
    expect(patched).toContain('const looksLikeCodeContent =')
    expect(patched).toContain('isCode = hasCodeChild || looksLikeCodeContent(')
    // The brittle IDE/Xcode markers are gone.
    expect(patched).not.toContain('monospace')
    expect(patched).not.toContain('\\n<p class="p1">')
    // The output half (isCode → code block) is preserved.
    expect(patched).toContain('data-type="code-block"')
    expect(patched).toContain('export const processPasteCode =')
  })

  it('throws (fails the build loudly) if the anchors are gone — version-bump guard', () => {
    expect(() => patchProcessCode('// unrelated source')).toThrow(
      /fixProcessCode/,
    )
  })
})

describe('patchIrInputSerialize (task 68 — webview owns the serialize)', () => {
  it('the shipped IR process serialises on every input (pre-patch)', () => {
    expect(irProcessSource).toContain('const text = getMarkdown(vditor);')
    expect(irProcessSource).toContain('vditor.options.input(text);')
  })

  it('turns options.input into a cheap signal; serialises only for counter/cache', () => {
    const patched = patchIrInputSerialize(irProcessSource)
    expect(patched).toContain('vditor.options.input();') // signal, no markdown
    expect(patched).not.toContain('vditor.options.input(text);')
    // getMarkdown is now gated behind counter/cache (both off → no serialize).
    expect(patched).toContain(
      '(vditor.options.counter.enable || vditor.options.cache.enable) ? getMarkdown(vditor) : ""',
    )
  })

  it('throws (fails the build loudly) if the anchors are gone — version-bump guard', () => {
    expect(() => patchIrInputSerialize('// unrelated source')).toThrow(
      /fixIrInputSerialize/,
    )
  })
})

describe('patchInfoDialog (original Vditor About, English, + Help section)', () => {
  const pin = {
    commit: '36ea9e0966025d7f4f343cdf9a611109bfb29ef6',
    committedAt: '2026-06-03',
  }

  // The shipped Info dialog is Chinese, loads a remote unpkg logo, and interpolates
  // a stale Lute.Version. The Help dialog (its links folded in here) is also Chinese.
  it('the shipped Info.ts is Chinese with a remote unpkg logo (pre-patch)', () => {
    expect(infoSource).toContain('组件版本：')
    expect(infoSource).toContain('unpkg.com')
  })

  it('keeps Vditor’s original About (translated) and appends a Help section', () => {
    const patched = patchInfoDialog(infoSource, pin)
    // top half = Vditor's original About content, in English (no vMarkd branding)
    expect(patched).toContain(
      'The next-generation Markdown editor, built for the future',
    )
    expect(patched).toContain('Project: ')
    expect(patched).toContain('License: MIT')
    expect(patched).not.toContain('vMarkd —') // not rebranded
    // Help folded in as its own section below
    expect(patched).toContain('<strong>Markdown guide</strong>')
    expect(patched).toContain('<strong>Vditor support</strong>')
    expect(patched).toContain('Syntax cheatsheet')
    expect(patched).toContain('Keyboard shortcuts')
    // no Chinese left (Info or the folded-in Help)
    expect(patched).not.toContain('组件版本')
    expect(patched).not.toContain('Markdown 使用指南')
    // Lute commit link (short sha) + date; Vditor version still interpolated
    expect(patched).toContain(
      `https://github.com/88250/lute/commit/${pin.commit}`,
    )
    expect(patched).toContain('>36ea9e0<')
    expect(patched).toContain('2026-06-03')
    // eslint-disable-next-line no-template-curly-in-string
    expect(patched).toContain('Vditor v${VDITOR_VERSION}')
    // logo repointed off unpkg to the locally-served asset (CSP task 67)
    expect(patched).not.toContain('unpkg.com')
    // eslint-disable-next-line no-template-curly-in-string
    expect(patched).toContain('${vditor.options.cdn}/dist/images/logo.png')
    // upstream links kept (Vditor project + ld246 help/community + sponsor)
    expect(patched).toContain('https://b3log.org/vditor')
    expect(patched).toContain('https://ld246.com/article/1583308420519')
    expect(patched).toContain('https://github.com/Vanessa219/vditor/issues')
    expect(patched).toContain('https://ld246.com/sponsor')
  })

  it('without a vendored pin, keeps Vditor’s runtime version interpolation', () => {
    const patched = patchInfoDialog(infoSource, null)
    // eslint-disable-next-line no-template-curly-in-string
    expect(patched).toContain('Lute v${Lute.Version}')
  })

  it('throws (fails the build loudly) if the dialog anchor is gone — version-bump guard', () => {
    expect(() => patchInfoDialog('// unrelated source', pin)).toThrow(
      /fixInfoDialog/,
    )
  })
})

describe('patchPreviewCopyTip (Ctrl+C in preview shows a hardcoded Chinese toast)', () => {
  const CHINESE_TIP = '已复制到剪切板'

  // The shipped preview shows a hardcoded Chinese "copied to clipboard" toast on
  // Ctrl+C, NOT routed through VditorI18n, so an English-locale user sees Chinese.
  it('the shipped preview/index.ts shows the Chinese tip (pre-patch)', () => {
    expect(previewSource).toContain(`\`${CHINESE_TIP}\``)
  })

  it('translates the copy toast to English', () => {
    const patched = patchPreviewCopyTip(previewSource)
    expect(patched).not.toContain(CHINESE_TIP)
    expect(patched).toContain('Copied to clipboard')
  })

  it('throws (fails the build loudly) if the anchor is gone — version-bump guard', () => {
    expect(() => patchPreviewCopyTip('// unrelated source')).toThrow(
      /fixPreviewCopyTip/,
    )
  })
})

describe('patchIrBlurExpand (code-block edit click flash)', () => {
  const ANCHOR = 'expandElement.classList.remove("vditor-ir__node--expand");'

  it('Vditor ships the unguarded synchronous collapse-on-blur', () => {
    expect(editorCommonEventSource).toContain(ANCHOR)
  })

  it('defers the collapse and skips it when focus returns to the editor', () => {
    const patched = patchIrBlurExpand(editorCommonEventSource)
    // wrapped in a deferred, focus-rechecked callback
    expect(patched).toContain('requestAnimationFrame(')
    expect(patched).toContain('document.activeElement')
    expect(patched).toContain('editorElement.contains(ae)')
    // the removal still happens — but only inside the guard
    expect(patched).toContain(ANCHOR)
  })

  it('throws (fails the build loudly) if the anchor is gone — version-bump guard', () => {
    expect(() => patchIrBlurExpand('// unrelated source')).toThrow(
      /fixIrBlurExpand/,
    )
  })
})
