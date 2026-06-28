// Offline PlantUML render + theme-agnostic post-processing (task 87; extracted from a ~75-line
// esbuild patch STRING into a real, typed, unit-tested module by task 144 item 1). Vditor's
// `plantumlRender.ts` is rewritten at bundle time into a thin shim that re-exports `plantumlRender`
// from here (see `patchPlantumlRender` in esbuild-shared.mjs) — so this is the single source of the
// runtime logic, type-checked + linted + covered by `plantuml-render.test.ts`. Deliberately imports
// NO Vditor internals (the adapter's getElements/getCode are one-liners, inlined; script loading uses
// our shared `loadScript`) so the theming logic is testable in jsdom without pulling Vditor's source.

import { loadScript } from './load-script'

// PlantUML default-skin colours (snapshot dep `1.2026.7beta3`). Named so a skin change in a future
// PlantUML bump is greppable here, not a silent "renders in the wrong colour" (task 144 item 2): if
// the engine changes its defaults these stop matching and `plantuml-render.test.ts` catches it.
// FOREGROUND = the baked ink (lines, borders, text) we repaint to currentColor so it follows the
// theme. BOX = participant/box fills we flatten to a faint tint. TRANSPARENT = the bg rect we drop.
const PUML_FOREGROUND = new Set(['#181818', '#000000'])
const PUML_BOX_FILL = new Set(['#E2E2F0', '#222222'])
const PUML_TRANSPARENT = '#00000000'
const BOX_FILL_OPACITY = '0.06'

// Repaint a rendered PlantUML SVG to be theme-agnostic: baked foreground → currentColor, box fills →
// a faint currentColor tint, transparent bg rect removed. Pure DOM walk (querySelectorAll +
// setAttribute) — NOT an innerHTML serialize→reparse (task 144 item 3: the old reparse cost a full
// reflow on large diagrams + dropped listeners). Idempotent: a second pass finds currentColor, which
// is in none of the colour sets, so it's a no-op.
export function themePumlSvg(container: HTMLElement): void {
  const svg = container.querySelector('svg')
  if (!svg) return
  // Baked foreground on ANY element (lines/borders/text) → currentColor.
  for (const el of Array.from(svg.querySelectorAll('[fill], [stroke]'))) {
    if (PUML_FOREGROUND.has(el.getAttribute('fill') ?? ''))
      el.setAttribute('fill', 'currentColor')
    if (PUML_FOREGROUND.has(el.getAttribute('stroke') ?? ''))
      el.setAttribute('stroke', 'currentColor')
  }
  // Text with no fill attr (SVG default = black, invisible on dark) → currentColor.
  for (const t of Array.from(svg.querySelectorAll('text'))) {
    if (!t.getAttribute('fill')) t.setAttribute('fill', 'currentColor')
  }
  // Participant/box fills → a faint currentColor tint (like mermaid's themed node backgrounds).
  for (const r of Array.from(svg.querySelectorAll('rect'))) {
    if (PUML_BOX_FILL.has(r.getAttribute('fill') ?? '')) {
      r.setAttribute('fill', 'currentColor')
      r.setAttribute('fill-opacity', BOX_FILL_OPACITY)
    }
  }
  // Drop the fully-transparent background rect (it composites a stray box over the page bg).
  for (const r of Array.from(svg.querySelectorAll('rect'))) {
    const f = r.getAttribute('fill')
    const s = r.getAttribute('stroke')
    if (f === PUML_TRANSPARENT && (s === PUML_TRANSPARENT || !s)) r.remove()
  }
}

// Lazily-loaded TeaVM `render(lines, targetId)` (cached after first load).
let plantumlRenderFn: ((lines: string[], targetId: string) => void) | null =
  null

// Render every `.language-plantuml` block under `element` via the local TeaVM engine, then theme the
// SVG. Lazy-loads the engine once (no main-bundle cost). element/cdn come from Vditor's previewRender
// through the shim; getElements/getCode are the (trivial) inlined adapter.
export function plantumlRender(
  element: Document | HTMLElement = document,
  cdn = '',
): void {
  const plantumlElements =
    element.querySelectorAll<HTMLElement>('.language-plantuml')
  if (plantumlElements.length === 0) return

  const vizUrl = `${cdn}/dist/js/plantuml/viz-global.js`
  const pumlUrl = `${cdn}/dist/js/plantuml/plantuml.js`

  loadScript(vizUrl, 'vditorVizGlobalScript').then(async () => {
    if (!plantumlRenderFn) {
      const mod = (await import(pumlUrl)) as {
        render: (lines: string[], targetId: string) => void
      }
      plantumlRenderFn = mod.render
    }
    for (const e of Array.from(plantumlElements)) {
      if (
        e.parentElement?.classList.contains('vditor-wysiwyg__pre') ||
        e.parentElement?.classList.contains('vditor-ir__marker--pre')
      ) {
        continue
      }
      if (e.getAttribute('data-processed') === 'true') continue
      const text = (e.getAttribute('data-code') || e.textContent || '').trim()
      if (!text) continue
      try {
        e.setAttribute('data-code', text)
        const targetId = `vmarkd-puml-${Math.random().toString(36).slice(2, 10)}`
        e.id = targetId
        e.innerHTML = ''
        e.setAttribute('data-processed', 'true')
        // Render in LIGHT (no {dark}); themePumlSvg makes it theme-agnostic afterwards.
        plantumlRenderFn(text.split(/\r\n|\r|\n/), targetId)
        // The TeaVM render is async and exposes no completion promise, so we observe for the <svg>
        // to appear and theme it once. `themed` guards the fallback below so we never theme twice.
        let themed = false
        const themeOnce = () => {
          if (themed) return
          themed = true
          themePumlSvg(e)
        }
        const obs = new MutationObserver(() => {
          if (e.querySelector('svg')) {
            obs.disconnect()
            themeOnce()
          }
        })
        obs.observe(e, { childList: true, subtree: true })
        // Fallback: if the observer never fires (engine error / it rendered before observe began),
        // theme after a generous grace window so the diagram can't stay un-themed forever. 5000ms is
        // arbitrary but well past any real render; `themed` makes it a no-op when the observer won.
        setTimeout(() => {
          obs.disconnect()
          themeOnce()
        }, 5000)
      } catch (error) {
        e.className = 'vditor-reset--error'
        e.innerHTML = `plantuml render error: <br>${error}`
      }
    }
  })
}
