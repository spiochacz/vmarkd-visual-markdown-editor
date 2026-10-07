// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Task 83 (increment 4) — the toolbar toggle for vmarkd.editor.reflowLineBreaks: the pressed state
// follows the EFFECTIVE setting (class + aria-pressed), a click applies locally and tells the host,
// and an already-confirmed value never re-renders an open Preview a second time.
const h = vi.hoisted(() => ({ inner: undefined as unknown }))
vi.mock('../util/inner-vditor', () => ({ innerVditor: () => h.inner }))

import {
  applyReflowLineBreaks,
  getReflowLineBreaks,
  resetReflowLineBreaksForTest,
} from './reflow-line-breaks'
import {
  installReflowToggleSync,
  REFLOW_TOGGLE_NAME,
  syncReflowToggle,
  toggleReflowLineBreaks,
} from './reflow-toggle'
import { createToolbar } from '../chrome/toolbar'

const posted: unknown[] = []
;(globalThis as any).vscode = { postMessage: (m: unknown) => posted.push(m) }

function mountButton(): HTMLElement {
  document.body.innerHTML = `<div class="vditor-toolbar"><div class="vditor-toolbar__item"><button data-type="${REFLOW_TOGGLE_NAME}"></button></div></div>`
  return document.querySelector(
    `[data-type="${REFLOW_TOGGLE_NAME}"]`,
  ) as HTMLElement
}

beforeEach(() => {
  resetReflowLineBreaksForTest()
  posted.length = 0
  h.inner = undefined
})

describe('toolbar item config', () => {
  it('is authored in the main row between outline and preview, with a tip, icon and click', () => {
    const items = createToolbar() as Array<{ name?: string } | string>
    const names = items.map((it) => (typeof it === 'string' ? it : it.name))
    const at = names.indexOf(REFLOW_TOGGLE_NAME)
    expect(at).toBeGreaterThan(-1)
    expect(names[at - 1]).toBe('outline')
    expect(names[at + 1]).toBe('preview')
    const item = items[at] as Record<string, unknown>
    expect(item.tip).toBe('Reflow line breaks')
    expect(String(item.icon)).toContain('<svg')
    expect(typeof item.click).toBe('function')
  })

  it('its click handler toggles the setting', () => {
    applyReflowLineBreaks(true)
    const item = (
      createToolbar({ onToggleReflow: toggleReflowLineBreaks }) as any[]
    ).find((it) => it.name === REFLOW_TOGGLE_NAME)
    item.click()
    expect(getReflowLineBreaks()).toBe(false)
  })
})

describe('pressed state', () => {
  it('syncReflowToggle mirrors the effective value onto class and aria-pressed', () => {
    const btn = mountButton()
    syncReflowToggle(true)
    expect(btn.classList.contains('vditor-menu--current')).toBe(true)
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    syncReflowToggle(false)
    expect(btn.classList.contains('vditor-menu--current')).toBe(false)
    expect(btn.getAttribute('aria-pressed')).toBe('false')
  })

  it('also reaches the live Vditor toolbar before it is attached to the document (initUI is later)', () => {
    const detached = document.createElement('div')
    detached.innerHTML = `<div class="vditor-toolbar__item"><button data-type="${REFLOW_TOGGLE_NAME}"></button></div>`
    h.inner = { toolbar: { element: detached } }
    syncReflowToggle(false)
    const btn = detached.querySelector('button') as HTMLElement
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    syncReflowToggle(true)
    expect(btn.classList.contains('vditor-menu--current')).toBe(true)
  })

  it('defaults to pressed when the setting was never applied', () => {
    const btn = mountButton()
    syncReflowToggle()
    expect(btn.getAttribute('aria-pressed')).toBe('true')
  })

  it('follows every effective change once installed (e.g. a VS Code Settings edit)', () => {
    const btn = mountButton()
    installReflowToggleSync()
    applyReflowLineBreaks(true)
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    applyReflowLineBreaks(false)
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    expect(btn.classList.contains('vditor-menu--current')).toBe(false)
    applyReflowLineBreaks(true)
    expect(btn.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('toggleReflowLineBreaks (click)', () => {
  it('flips on -> off, applies locally and posts the new value to the host', () => {
    applyReflowLineBreaks(true)
    toggleReflowLineBreaks()
    expect(getReflowLineBreaks()).toBe(false)
    expect(posted).toEqual([
      { command: 'set-reflow-line-breaks', value: false },
    ])
  })

  it('flips off -> on', () => {
    applyReflowLineBreaks(false)
    toggleReflowLineBreaks()
    expect(getReflowLineBreaks()).toBe(true)
    expect(posted).toEqual([{ command: 'set-reflow-line-breaks', value: true }])
  })

  it('re-renders an open Preview once: the optimistic apply, not the config-changed confirmation', () => {
    const render = vi.fn()
    h.inner = {
      preview: { element: { style: { display: 'block' } }, render },
    }
    applyReflowLineBreaks(true)
    toggleReflowLineBreaks()
    expect(render).toHaveBeenCalledTimes(1)
    // The host's config-changed echo carries the same value: unchanged -> no second re-render.
    expect(applyReflowLineBreaks(false)).toBe(false)
  })
})
