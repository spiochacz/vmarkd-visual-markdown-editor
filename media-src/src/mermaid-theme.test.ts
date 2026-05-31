import { describe, it, expect } from 'vitest'
import { applyMermaidTheme, MERMAID_THEMES } from './mermaid-theme'

function fakeWin(mermaid?: any) {
  return { mermaid } as any
}

describe('applyMermaidTheme', () => {
  it('injects the chosen theme into an already-loaded mermaid.initialize', () => {
    let seen: any
    const win = fakeWin({ initialize: (cfg: any) => (seen = cfg) })
    applyMermaidTheme(win, 'forest')
    win.mermaid.initialize({ securityLevel: 'loose' })
    expect(seen).toEqual({ securityLevel: 'loose', theme: 'forest' })
  })

  it('wraps mermaid that is assigned later (Vditor lazy-loads it)', () => {
    let seen: any
    const win = fakeWin(undefined)
    applyMermaidTheme(win, 'neutral')
    win.mermaid = { initialize: (cfg: any) => (seen = cfg) } // lazy assignment
    win.mermaid.initialize({ a: 1 })
    expect(seen).toEqual({ a: 1, theme: 'neutral' })
  })

  it('leaves initialize untouched for "auto" / empty', () => {
    let seen: any
    const win = fakeWin({ initialize: (cfg: any) => (seen = cfg) })
    applyMermaidTheme(win, 'auto')
    win.mermaid.initialize({ a: 1 })
    expect(seen).toEqual({ a: 1 }) // no theme injected
    applyMermaidTheme(win, undefined)
    win.mermaid.initialize({ b: 2 })
    expect(seen).toEqual({ b: 2 })
  })

  it('re-themes on a later call without double-wrapping the original', () => {
    const calls: any[] = []
    const win = fakeWin({ initialize: (cfg: any) => calls.push(cfg) })
    applyMermaidTheme(win, 'forest')
    applyMermaidTheme(win, 'dark') // setting changed → re-init
    win.mermaid.initialize({ x: 1 })
    expect(calls).toEqual([{ x: 1, theme: 'dark' }]) // latest theme, single wrap
  })

  it('can fall back from a forced theme to auto (restores original)', () => {
    let seen: any
    const win = fakeWin({ initialize: (cfg: any) => (seen = cfg) })
    applyMermaidTheme(win, 'dark')
    applyMermaidTheme(win, 'auto')
    win.mermaid.initialize({ a: 1 })
    expect(seen).toEqual({ a: 1 }) // theme injection removed
  })

  it('exposes auto + the supported mermaid themes', () => {
    expect(MERMAID_THEMES).toContain('auto')
    expect(MERMAID_THEMES).toContain('forest')
    expect(MERMAID_THEMES).toContain('default')
  })
})
