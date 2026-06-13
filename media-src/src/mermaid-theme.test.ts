import { describe, it, expect } from 'vitest'
import {
  applyMermaidTheme,
  MERMAID_THEMES,
  resolveMermaidInit,
} from './mermaid-theme'

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

  it('injects a palette via base theme + themeVariables (object spec)', () => {
    let seen: any
    const win = fakeWin({ initialize: (cfg: any) => (seen = cfg) })
    applyMermaidTheme(win, {
      theme: 'base',
      themeVariables: { background: '#0d1117', darkMode: true },
    })
    win.mermaid.initialize({ securityLevel: 'loose' })
    expect(seen).toEqual({
      securityLevel: 'loose',
      theme: 'base',
      themeVariables: { background: '#0d1117', darkMode: true },
    })
  })

  it('null spec leaves initialize untouched', () => {
    let seen: any
    const win = fakeWin({ initialize: (cfg: any) => (seen = cfg) })
    applyMermaidTheme(win, null)
    win.mermaid.initialize({ a: 1 })
    expect(seen).toEqual({ a: 1 })
  })

  it('exposes auto + the built-in mermaid themes + the palettes', () => {
    expect(MERMAID_THEMES).toContain('auto')
    expect(MERMAID_THEMES).toContain('forest')
    expect(MERMAID_THEMES).toContain('default')
    expect(MERMAID_THEMES).toContain('github-dark')
    expect(MERMAID_THEMES).toContain('dracula')
  })
})

describe('resolveMermaidInit', () => {
  it('built-in setting → theme only, no themeVariables', () => {
    expect(resolveMermaidInit('forest', undefined)).toEqual({ theme: 'forest' })
    expect(resolveMermaidInit('dark', 'github-light')).toEqual({
      theme: 'dark',
    })
  })

  it('explicit palette → base + themeVariables (wins over content pairing)', () => {
    const init = resolveMermaidInit('dracula', 'github-light')
    expect(init?.theme).toBe('base')
    expect(init?.themeVariables?.background).toBe('#282a36')
  })

  it('auto + paired content theme → that palette', () => {
    const gh = resolveMermaidInit('auto', 'github-dark')
    expect(gh?.theme).toBe('base')
    expect(gh?.themeVariables?.background).toBe('#0d1117')
    // vscode/material are paired too (zinc / one-dark)
    const vs = resolveMermaidInit('auto', 'vscode-dark-2026')
    expect(vs?.theme).toBe('base')
    expect(vs?.themeVariables?.background).toBe('#18181b') // zinc-dark
  })

  it('auto + unpaired/unknown content theme → null (mermaid keeps its own light/dark)', () => {
    expect(resolveMermaidInit('auto', 'no-such-theme')).toBeNull()
    expect(resolveMermaidInit('auto', undefined)).toBeNull()
    expect(resolveMermaidInit(undefined, undefined)).toBeNull()
  })
})
