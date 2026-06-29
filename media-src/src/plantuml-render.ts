// Offline PlantUML render + theme-agnostic post-processing (task 87; extracted from a ~75-line
// esbuild patch STRING into a real, typed, unit-tested module by task 144 item 1). Vditor's
// `plantumlRender.ts` is rewritten at bundle time into a thin shim that re-exports `plantumlRender`
// from here (see `patchPlantumlRender` in esbuild-shared.mjs) — so this is the single source of the
// runtime logic, type-checked + linted + covered by `plantuml-render.test.ts`. Deliberately imports
// NO Vditor internals (the adapter's getElements/getCode are one-liners, inlined; script loading uses
// our shared `loadScript`) so the theming logic is testable in jsdom without pulling Vditor's source.

import { renderDiagramError } from './diagram-error'
import { resolveDiagramPalette } from './diagram-palette'
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

// Full palette-pairing (default per ADR-0006): inject a PlantUML modern `<style>` block built from
// the active diagram palette so every diagram type is themed semantically — element fill = surface,
// lines/borders/lifelines = line, text = fg, notes = accent-tinted — pairing PlantUML with the
// content theme like mermaid (was: foreground-monochrome via themePumlSvg only). The `<style>` route
// (not skinparam) is the cross-diagram-type mechanism; verified offline against the bundled TeaVM
// engine on sequence/class/activity/component/state/mindmap/gantt/json/wbs — all theme cleanly with
// no baked default surviving, and none error on the `<style>` (so it's safe to always inject).
// themePumlSvg still runs afterwards as the safety net (drops the transparent bg rect; neutralises
// any baked default in a user-skinned diagram we DON'T inject into).
function plantumlStyleBlock(): string {
  const p = resolveDiagramPalette()
  // `;`-separated declarations inside `{ }` is valid PlantUML <style> syntax (verified).
  return [
    '<style>',
    'document { BackgroundColor transparent }',
    `root { LineColor ${p.line} ; FontColor ${p.fg} ; BackgroundColor ${p.surface} ; HyperLinkColor ${p.accent} }`,
    `element { LineColor ${p.line} ; FontColor ${p.fg} ; BackgroundColor ${p.surface} }`,
    `arrow { LineColor ${p.line} ; FontColor ${p.fg} }`,
    `note { BackgroundColor ${p.note} ; LineColor ${p.accent} ; FontColor ${p.fg} }`,
    `title { FontColor ${p.fg} }`,
    '</style>',
  ].join('\n')
}

// The author already themes the diagram → leave their colours alone (ADR-0006: user directives win).
const HAS_OWN_THEME = /<style>|^\s*(?:skinparam|!theme)\b/im

// Inject our palette `<style>` INSIDE the @start*/@end* wrapper (PlantUML requires <style> within the
// block) right after the opening directive; if the source has no @start* line (PlantUML allows bare
// source) prepend it (the engine wraps implicitly). No-op when the author supplies their own theme.
export function injectPlantumlTheme(lines: string[]): string[] {
  if (HAS_OWN_THEME.test(lines.join('\n'))) return lines
  const style = plantumlStyleBlock().split('\n')
  const i = lines.findIndex((l) => /^\s*@start/i.test(l))
  return i >= 0
    ? [...lines.slice(0, i + 1), ...style, ...lines.slice(i + 1)]
    : [...style, ...lines]
}

// The vendored TeaVM PlantUML engine carries STICKY diagram-TYPE state across render() calls on a
// single module instance: once it renders e.g. a class diagram, a later VALID sequence source is
// misclassified as a class diagram and never recovers (and a 2nd render racing on the shared instance
// is dropped). The bundle exposes no reset, so the only reset lever is a FRESH module instance via a
// cache-busted dynamic import (`?rev=N` → a distinct module URL → fresh module statics → independent
// diagram-type detection). Re-importing on EVERY render re-evaluates the ~7 MB module and lags editing,
// so we REUSE one cached engine and only re-import when the diagram TYPE actually switches
// (class<->non-class) — the only thing that poisons it. `isClassSource()` is the cheap source probe;
// `engineLastClass` is the type the cached engine last rendered. Editing a diagram's content (type
// unchanged) reuses the engine → no lag; a type switch (the bug trigger) pays one re-import.
// (task 178 follow-up; root-caused via the multi-agent reproduction.)
let plantumlRenderFn: ((lines: string[], targetId: string) => void) | null =
  null
let engineLastClass: boolean | null = null
let engineRev = 0

// Cheap probe: does this PlantUML source render as a CLASS diagram? (used only to decide engine resets,
// not to drive rendering; `engineLastClass` is also corrected from the actual render below as a safety
// net). Class markers: class/interface/enum/abstract/annotation keywords; class relations
// (`<|--`/`--|>`/`*--`/`o--`/…); or a connector between two names that is NOT a plain sequence message.
// Sequence message arrows are dashes + an arrowhead (`->`, `-->`, `->>`, `<-`, …) — they carry `>`/`<`
// and NEVER a `.`. So a connector that (a) contains a `.` (dotted: `.->`, `..>`) or (b) has NO
// arrowhead (a bare association: `A - B`, `A -- B`, `A .. B`) is class-diagram syntax. Pure + unit-
// tested; it only needs to FLIP when class<->non-class flips so the engine is reset across that switch.
export function isClassSource(src: string): boolean {
  if (/^\s*(?:abstract\s+)?(?:class|interface|enum|annotation)\b/im.test(src))
    return true
  if (/<\|--|--\|>|\*--|--\*|o--|--o|<\.\.|\.\.>/.test(src)) return true
  for (const line of src.split(/\r\n|\r|\n/)) {
    // capture the connector token (run of arrow/relation chars) between two identifiers
    const m = /^\s*\w[\w.]*\s+([-.<>|*o]+)\s+\w/.exec(line)
    if (!m) continue
    const conn = m[1]
    if (conn.includes('.')) return true // dotted connector (.->, ..>) = class/dependency
    if (!/[<>]/.test(conn)) return true // no arrowhead = bare association = class
  }
  return false
}

// Did the engine ACTUALLY render a class/object diagram? PlantUML draws a circled type icon — a
// standalone single-letter <text> "C"/"I"/"E"/"A" (class/interface/enum/abstract); sequence/activity/
// etc. have none. Used as the safety net for engineLastClass: if isClassSource misreads an exotic arrow
// form, the rendered output corrects it, so the next type switch is still detected (worst case: one
// extra reset = a brief lag, never a stuck wrong diagram). A class literally named "C" would false-
// positive → harmless (an unnecessary reset).
function renderedIsClass(el: HTMLElement): boolean {
  const svg = el.querySelector('svg')
  if (!svg) return false
  for (const t of Array.from(svg.querySelectorAll('text'))) {
    if (/^[CIEA]$/.test((t.textContent ?? '').trim())) return true
  }
  return false
}

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

  // viz-global.js lives in its own dir (task 144 item 6) — shared with graphviz; plantuml.js stays.
  const vizUrl = `${cdn}/dist/js/viz/viz-global.js`
  const pumlUrl = `${cdn}/dist/js/plantuml/plantuml.js`

  loadScript(vizUrl, 'vditorVizGlobalScript').then(async () => {
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
        // Reset the engine ONLY across a diagram-type switch (see engineLastClass note above): drop the
        // cached instance so a fresh one is imported, otherwise reuse it (no lag). The await serializes
        // the loop, so two blocks never race one instance.
        const srcClass = isClassSource(text)
        if (
          plantumlRenderFn &&
          engineLastClass !== null &&
          engineLastClass !== srcClass
        ) {
          plantumlRenderFn = null
        }
        if (!plantumlRenderFn) {
          engineRev += 1
          const mod = (await import(`${pumlUrl}?rev=${engineRev}`)) as {
            render: (lines: string[], targetId: string) => void
          }
          plantumlRenderFn = mod.render
        }
        engineLastClass = srcClass
        // Inject the palette `<style>` (unless the author themed it) so PlantUML colours the diagram
        // from the content theme; themePumlSvg still runs afterwards as the safety net.
        plantumlRenderFn(
          injectPlantumlTheme(text.split(/\r\n|\r|\n/)),
          targetId,
        )
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
            // Safety net: correct engineLastClass from what the engine ACTUALLY rendered, so a
            // misread by isClassSource (e.g. an unhandled arrow form) can't leave the engine
            // mismarked and wedge a later type switch. Reliable (the C/I/E/A class icon).
            engineLastClass = renderedIsClass(e)
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
        // HARD infra throw only (engine boot / encode) — PlantUML renders its OWN red "syntax error"
        // SVG for bad source, so this box never fights that; it surfaces the rare infra failure (task
        // 178), was a raw "plantuml render error:" dump.
        renderDiagramError(e, 'plantuml', error)
      }
    }
  })
}
