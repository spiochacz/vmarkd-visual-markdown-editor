// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { themeGraphvizSvg } from './graphviz-render'

// A minimal stand-in for a Viz.js-rendered Graphviz SVG with the DOT default colours
// themeGraphvizSvg must neutralise (task 144 item 2).
function fixture(): HTMLElement {
  const container = document.createElement('div')
  container.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg">
      <polygon id="bg" fill="white" stroke="none" points="0,0 100,0 100,100 0,100"></polygon>
      <path id="edge" stroke="black"></path>
      <text id="t-baked" fill="#000000">a</text>
      <text id="t-nofill">b</text>
      <ellipse id="node" fill="none" stroke="black"></ellipse>
    </svg>`
  return container
}
const q = (c: HTMLElement, id: string) =>
  c.querySelector(`#${id}`) as SVGElement | null

describe('themeGraphvizSvg', () => {
  let container: HTMLElement
  beforeEach(() => {
    container = fixture()
    themeGraphvizSvg(container)
  })

  it('repaints baked foreground (black / #000000) on edges + text to currentColor', () => {
    expect(q(container, 'edge')?.getAttribute('stroke')).toBe('currentColor')
    expect(q(container, 't-baked')?.getAttribute('fill')).toBe('currentColor')
  })

  it('gives text with no fill an explicit currentColor', () => {
    expect(q(container, 't-nofill')?.getAttribute('fill')).toBe('currentColor')
  })

  it('removes the solid white background polygon', () => {
    expect(q(container, 'bg')).toBeNull()
  })

  it('tints empty node shapes (ellipse fill:none) to a faint currentColor', () => {
    const node = q(container, 'node')
    expect(node?.getAttribute('fill')).toBe('currentColor')
    expect(node?.getAttribute('fill-opacity')).toBe('0.06')
  })

  it('is idempotent — a second pass is a no-op', () => {
    const before = container.innerHTML
    themeGraphvizSvg(container)
    expect(container.innerHTML).toBe(before)
  })

  it('no-ops when the container holds no <svg> yet', () => {
    const empty = document.createElement('div')
    expect(() => themeGraphvizSvg(empty)).not.toThrow()
  })
})
