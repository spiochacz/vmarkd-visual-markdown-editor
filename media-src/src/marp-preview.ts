// Marp deck render + lazy chunk loader (task 107). The deck is a SECOND, independent render of
// the same Markdown source (marp-core, not Lute) — read-only output; the source stays the single
// source of truth. The marp-core bundle is a separate chunk (media/dist/marp.js) loaded on demand
// via an injected <script> (mirrors how Vditor lazy-loads mermaid/echarts), so main.js carries no
// marp-core weight for plain docs. The chunk's URL is `window.__vmarkdMarpSrc`, set from the
// host's init message (msg.marpSrc); the e2e harness sets it to the harness-served path.

export interface MarpApi {
  render(source: string): { html: string; css: string }
}

let loading: Promise<MarpApi> | null = null

/** Load the marp chunk once; resolves with the render API. Idempotent. */
export function loadMarp(): Promise<MarpApi> {
  const existing = (window as any).__vmarkdMarp as MarpApi | undefined
  if (existing) return Promise.resolve(existing)
  if (loading) return loading
  loading = new Promise<MarpApi>((resolve, reject) => {
    const src = (window as any).__vmarkdMarpSrc as string | undefined
    if (!src) {
      reject(new Error('marp chunk URL (__vmarkdMarpSrc) not set'))
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.onload = () => {
      const api = (window as any).__vmarkdMarp as MarpApi | undefined
      if (api) resolve(api)
      else reject(new Error('marp chunk loaded but __vmarkdMarp is missing'))
    }
    script.onerror = () => reject(new Error('failed to load marp chunk'))
    document.head.appendChild(script)
  })
  return loading
}

const STYLE_CLASS = 'vmarkd-marp__style'
const DECK_CLASS = 'vmarkd-marp__deck'

/**
 * Render `source` and inject the deck into `panel`. The panel holds exactly one <style> (the
 * deck's scoped CSS) + one deck container (the <div class="marpit"> Marp emits, which scopes the
 * theme CSS so it can't restyle .vditor-reset / .markdown-body). Returns the number of <section> slides.
 * On a render error, shows the message inside the panel and returns 0.
 */
export function injectDeck(
  panel: HTMLElement,
  source: string,
  marp: MarpApi,
): number {
  let html: string
  let css: string
  try {
    ;({ html, css } = marp.render(source))
  } catch (err) {
    panel.innerHTML = ''
    const msg = document.createElement('div')
    msg.className = 'vmarkd-marp__error'
    msg.textContent = `Marp render failed: ${(err as Error)?.message ?? err}`
    panel.appendChild(msg)
    return 0
  }

  let style = panel.querySelector<HTMLStyleElement>(`.${STYLE_CLASS}`)
  if (!style) {
    style = document.createElement('style')
    style.className = STYLE_CLASS
    panel.appendChild(style)
  }
  if (style.textContent !== css) style.textContent = css

  let deck = panel.querySelector<HTMLElement>(`.${DECK_CLASS}`)
  if (!deck) {
    deck = document.createElement('div')
    deck.className = DECK_CLASS
    panel.appendChild(deck)
  }
  deck.innerHTML = html

  return deck.querySelectorAll('section').length
}

/**
 * Render `source` to a self-contained HTML STRING for Vditor's preview surface: the scoped deck
 * CSS in a `<style>` followed by the `<div class="marpit">…` deck. Written into `.vditor-reset`
 * via Vditor's `innerHTML`. Marp scopes its theme under `.marpit`, so the `<style>` can't restyle
 * `.vditor-reset` itself. Returns '' on render error (caller falls back / shows nothing).
 */
export function renderMarpPreview(source: string, marp: MarpApi): string {
  try {
    const { html, css } = marp.render(source)
    return `<style class="vmarkd-marp__style">${css}</style>${html}`
  } catch (err) {
    return `<div class="vmarkd-marp__error">Marp render failed: ${
      (err as Error)?.message ?? err
    }</div>`
  }
}
