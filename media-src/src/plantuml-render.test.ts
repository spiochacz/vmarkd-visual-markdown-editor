// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { injectPlantumlTheme, themePumlSvg } from './plantuml-render'

// A minimal stand-in for a rendered PlantUML SVG carrying the default-skin colours
// themePumlSvg must neutralise (task 144 item 2 — the render test for the colour mapping).
function fixture(): HTMLElement {
  const container = document.createElement('div')
  container.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg">
      <rect id="bg" fill="#00000000" stroke="#00000000" width="100" height="100"></rect>
      <rect id="box" fill="#E2E2F0" stroke="#181818"></rect>
      <line id="edge" stroke="#181818"></line>
      <path id="border" stroke="#000000" fill="#181818"></path>
      <text id="t-baked" fill="#000000">a</text>
      <text id="t-nofill">b</text>
    </svg>`
  return container
}
const q = (c: HTMLElement, id: string) =>
  c.querySelector(`#${id}`) as SVGElement | null

describe('themePumlSvg', () => {
  let container: HTMLElement
  beforeEach(() => {
    container = fixture()
    themePumlSvg(container)
  })

  it('repaints baked foreground (#181818 / #000000) on lines, borders + text to currentColor', () => {
    expect(q(container, 'edge')?.getAttribute('stroke')).toBe('currentColor')
    expect(q(container, 'border')?.getAttribute('stroke')).toBe('currentColor')
    expect(q(container, 'border')?.getAttribute('fill')).toBe('currentColor')
    expect(q(container, 't-baked')?.getAttribute('fill')).toBe('currentColor')
  })

  it('gives text with no fill an explicit currentColor (SVG default black is invisible on dark)', () => {
    expect(q(container, 't-nofill')?.getAttribute('fill')).toBe('currentColor')
  })

  it('flattens participant-box fills to a faint currentColor tint', () => {
    const box = q(container, 'box')
    expect(box?.getAttribute('fill')).toBe('currentColor')
    expect(box?.getAttribute('fill-opacity')).toBe('0.06')
  })

  it('removes the fully-transparent background rect', () => {
    expect(q(container, 'bg')).toBeNull()
  })

  it('is idempotent — a second pass is a no-op (no baked colour remains to match)', () => {
    const before = container.innerHTML
    themePumlSvg(container)
    expect(container.innerHTML).toBe(before)
  })

  it('no-ops when the container holds no <svg> yet (render not complete)', () => {
    const empty = document.createElement('div')
    expect(() => themePumlSvg(empty)).not.toThrow()
  })
})

// Full palette-pairing: injectPlantumlTheme prepends a <style> block (built from the active diagram
// palette) so PlantUML colours the diagram from the content theme. With no d2-config set it resolves
// the github fallback palette (a valid hex set), which is all these structural assertions need.
describe('injectPlantumlTheme', () => {
  it('inserts a <style> block right after the @startuml directive', () => {
    const out = injectPlantumlTheme([
      '@startuml',
      'Alice -> Bob: Hi',
      '@enduml',
    ])
    expect(out[0]).toBe('@startuml')
    expect(out[1]).toBe('<style>')
    expect(out).toContain('</style>')
    // the diagram body still follows the injected style.
    expect(out).toContain('Alice -> Bob: Hi')
    expect(out[out.length - 1]).toBe('@enduml')
  })

  it('builds the style from palette colours (themed, not raw defaults)', () => {
    const out = injectPlantumlTheme(['@startuml', 'A -> B', '@enduml']).join(
      '\n',
    )
    // element/arrow/text/note declarations carry concrete hex colours.
    expect(out).toMatch(/element \{ LineColor #[0-9a-f]{6}/i)
    expect(out).toMatch(/note \{ BackgroundColor #[0-9a-f]{6}/i)
    expect(out).toContain('document { BackgroundColor transparent }')
  })

  it('prepends the style when the source has no @start directive (bare source)', () => {
    const out = injectPlantumlTheme(['Alice -> Bob: Hi'])
    expect(out[0]).toBe('<style>')
    expect(out).toContain('Alice -> Bob: Hi')
  })

  it('leaves the source untouched when the author supplies skinparam', () => {
    const src = [
      '@startuml',
      'skinparam backgroundColor #222',
      'A -> B',
      '@enduml',
    ]
    expect(injectPlantumlTheme(src)).toEqual(src)
  })

  it('leaves the source untouched when the author supplies their own <style>', () => {
    const src = [
      '@startuml',
      '<style>',
      'root { FontColor red }',
      '</style>',
      'A -> B',
      '@enduml',
    ]
    expect(injectPlantumlTheme(src)).toEqual(src)
  })

  it('leaves the source untouched when the author uses !theme', () => {
    const src = ['@startuml', '!theme cerulean', 'A -> B', '@enduml']
    expect(injectPlantumlTheme(src)).toEqual(src)
  })
})
