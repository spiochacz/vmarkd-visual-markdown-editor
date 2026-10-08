// Task 532 step 4 — the SYNCHRONOUS renders the instant-paint overlay is missing: syntax-highlighted
// code and typeset math. The live editor gets both from Vditor's own lazy `highlightRender` /
// `mathRender` (they `addScript` hljs / KaTeX and render when the promise lands); the overlay is
// painted before any of that runs and is gone ~150 ms later, so these passes mirror what Vditor
// produces, on the globals the host HTML already loaded (`window.hljs`, `window.katex` — both are
// `<script>`s BEFORE main.js whenever the document needs them, html-builder.ts). When a global is
// missing the pass is a no-op and the overlay keeps its plain code / raw TeX (the old behaviour).
//
// Paint-only: the overlay is removed at the swap and never read back, so nothing here can reach the
// saved markdown. Both passes are idempotent (`.hljs` / `data-math` mark a finished node).

import { engineLangSet } from '../diagram-kit/engine-registry'

export interface HljsLike {
  highlight: (
    code: string,
    opts: { language: string; ignoreIllegals?: boolean },
  ) => { value: string }
  getLanguage?: (name: string) => unknown
}

export interface KatexLike {
  renderToString: (
    math: string,
    opts: { displayMode: boolean; output: string; macros: object },
  ) => string
}

// Blocks that render to a diagram / formula, not to highlighted code (Vditor's highlightRender skips
// the same set; engineLangSet is the registry-derived superset, `math` is KaTeX's own fence).
const NOT_CODE_LANGS = engineLangSet()
NOT_CODE_LANGS.add('math')

const languageOf = (code: Element): string => {
  const cls = Array.from(code.classList).find((c) => c.startsWith('language-'))
  return cls ? cls.slice('language-'.length) : ''
}

/**
 * Colour every rendered `pre > code` fence under `root` the way Vditor's `highlightRender` does
 * (`innerHTML = hljs.highlight(...)`, then `.hljs`). The editable source (`.vditor-ir__marker--pre`
 * / `.vditor-wysiwyg__pre`) stays plain — it gets `.hljs` from code-source.ts — and the diagram /
 * math languages are left alone.
 */
export function highlightPreviewCode(
  root: ParentNode,
  hljs: HljsLike | undefined,
): void {
  if (!hljs) return
  for (const code of Array.from(root.querySelectorAll('pre > code'))) {
    const pre = code.parentElement
    if (
      pre?.classList.contains('vditor-ir__marker--pre') ||
      pre?.classList.contains('vditor-wysiwyg__pre')
    )
      continue
    if (code.classList.contains('hljs')) continue
    const lang = languageOf(code)
    if (lang && NOT_CODE_LANGS.has(lang)) continue
    const language = lang && hljs.getLanguage?.(lang) ? lang : 'plaintext'
    code.innerHTML = hljs.highlight(code.textContent ?? '', {
      language,
      ignoreIllegals: true,
    }).value
    code.classList.add('hljs')
  }
}

/**
 * Typeset every `.language-math` under `root` the way Vditor's `mathRender` does (KaTeX, HTML
 * output, `data-math` = the TeX, display mode for the block `div`, the error text on a bad formula).
 * The editable TeX source (`.vditor-ir__marker--pre` / `.vditor-wysiwyg__pre`) is skipped.
 */
export function renderPreviewMath(
  root: ParentNode,
  katex: KatexLike | undefined,
): void {
  if (!katex) return
  for (const el of Array.from(root.querySelectorAll('.language-math'))) {
    const parent = el.parentElement
    if (
      parent?.classList.contains('vditor-ir__marker--pre') ||
      parent?.classList.contains('vditor-wysiwyg__pre')
    )
      continue
    if (el.getAttribute('data-math')) continue
    const math = (el.textContent ?? '').replace(/ /g, ' ')
    el.setAttribute('data-math', math)
    try {
      el.innerHTML = katex.renderToString(math, {
        displayMode: el.tagName === 'DIV',
        output: 'html',
        macros: {},
      })
    } catch (e) {
      el.innerHTML = e instanceof Error ? e.message : String(e)
      el.className = 'language-math vditor-reset--error'
    }
  }
}
