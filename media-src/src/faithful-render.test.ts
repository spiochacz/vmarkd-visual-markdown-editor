// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { faithfulRender } from './faithful-render'

afterEach(() => {
  ;(globalThis as { vscode?: unknown }).vscode = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function makeWrapper(source: string): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.textContent = source // the raw source the user would see if render fails
  document.body.appendChild(wrapper)
  return wrapper
}

describe('faithfulRender', () => {
  it('swaps the produced output into the wrapper on success + marks it processed', async () => {
    const wrapper = makeWrapper('SOURCE')
    const ok = await faithfulRender(wrapper, 'demo', (stage) => {
      const svg = document.createElement('svg')
      svg.setAttribute('id', 'rendered')
      stage.appendChild(svg)
    })
    expect(ok).toBe(true)
    expect(wrapper.querySelector('#rendered')).not.toBeNull()
    expect(wrapper.textContent).not.toContain('SOURCE')
    expect(wrapper.getAttribute('data-processed')).toBe('true')
    expect(wrapper.hasAttribute('data-demo-error')).toBe(false)
    // The offscreen stage is cleaned up.
    expect(document.body.querySelectorAll('div').length).toBe(1) // just the wrapper
  })

  it('keeps the raw source + stamps data-<lang>-error + logs on a throwing render', async () => {
    const post = vi.fn()
    ;(globalThis as { vscode?: unknown }).vscode = { postMessage: post }
    const wrapper = makeWrapper('SOURCE')
    const ok = await faithfulRender(wrapper, 'demo', () => {
      throw new Error('bad spec')
    })
    expect(ok).toBe(false)
    // Source is untouched (NOT blanked) — the whole point of the helper.
    expect(wrapper.textContent).toContain('SOURCE')
    expect(wrapper.getAttribute('data-demo-error')).toBe('render')
    expect(wrapper.hasAttribute('data-processed')).toBe(false)
    // The failure is logged to the host (Output channel), not swallowed.
    const logged = post.mock.calls.map(
      (c) => c[0] as { command: string; text?: string },
    )
    const log = logged.find((m) => m.command === 'log')
    expect(log?.text).toContain('demo')
    expect(log?.text).toContain('bad spec')
    // Stage removed even on failure.
    expect(document.body.querySelectorAll('div').length).toBe(1)
  })

  it('keeps the raw source when an async render rejects', async () => {
    ;(globalThis as { vscode?: unknown }).vscode = { postMessage: vi.fn() }
    const wrapper = makeWrapper('SOURCE')
    const ok = await faithfulRender(wrapper, 'vega', async () => {
      await Promise.reject(new Error('async fail'))
    })
    expect(ok).toBe(false)
    expect(wrapper.textContent).toContain('SOURCE')
    expect(wrapper.getAttribute('data-vega-error')).toBe('render')
  })
})
