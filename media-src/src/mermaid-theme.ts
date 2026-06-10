// User-configurable mermaid diagram theme. Vditor renders mermaid with
// theme='dark' iff its UI theme is dark and exposes no hook to override, so a
// plain flowchart in a dark editor looks monochrome. We wrap `mermaid.initialize`
// (whenever Vditor lazy-loads it and on every render call) to inject the chosen
// theme. `'auto'` / empty leaves Vditor's own behavior untouched — unless the active
// content theme pairs a palette (task 86), in which case we inject mermaid's `base`
// theme + that palette's themeVariables.
//
// Pure except for the `win` it's given — unit-tested with a fake window.

import {
  MERMAID_PALETTE_NAMES,
  MERMAID_PALETTES,
  paletteToThemeVariables,
} from '../../src/mermaid-palettes'
import { autoMermaidTheme } from '../../src/theme-registry'

/** Mermaid's customisable + built-in themes (no palette injection). */
const BUILTIN_THEMES = ['default', 'dark', 'forest', 'neutral'] as const

export const MERMAID_THEMES = [
  'auto',
  ...BUILTIN_THEMES,
  ...MERMAID_PALETTE_NAMES,
] as const
export type MermaidTheme = (typeof MERMAID_THEMES)[number]

/** What gets merged into `mermaid.initialize` — a theme name, optionally with vars. */
export interface MermaidInit {
  theme?: string
  themeVariables?: Record<string, string | boolean>
}

/**
 * Resolve the effective mermaid init from the setting + active content theme.
 * Precedence: explicit built-in → explicit palette → content-theme paired palette →
 * none (null → leave mermaid's own light/dark behavior). The `mode` is accepted for
 * symmetry with the code-theme resolver but pairing is purely content-theme driven.
 */
export function resolveMermaidInit(
  setting: string | undefined,
  contentTheme: string | undefined,
  _mode?: 'dark' | 'light',
): MermaidInit | null {
  if (setting && (BUILTIN_THEMES as readonly string[]).includes(setting)) {
    return { theme: setting }
  }
  if (setting && MERMAID_PALETTES[setting]) {
    return {
      theme: 'base',
      themeVariables: paletteToThemeVariables(MERMAID_PALETTES[setting]),
    }
  }
  // auto / empty / unknown → content-theme pairing, else nothing.
  const paired = autoMermaidTheme(contentTheme)
  if (paired && MERMAID_PALETTES[paired]) {
    return {
      theme: 'base',
      themeVariables: paletteToThemeVariables(MERMAID_PALETTES[paired]),
    }
  }
  return null
}

export function applyMermaidTheme(
  win: any,
  spec: string | MermaidInit | null | undefined,
): void {
  // Normalise: a bare string is a theme name (legacy callers); an object carries
  // theme + themeVariables; null/'auto'/undefined → no injection.
  let init: MermaidInit | null
  if (spec && typeof spec === 'object') init = spec
  else if (typeof spec === 'string') init = { theme: spec }
  else init = null
  const theme = init?.theme && init.theme !== 'auto' ? init.theme : null

  // Desired theme/vars kept on the window so the lazy-load setter always reads the
  // current value (re-init can change it before mermaid has even loaded).
  win.__vmarkdMermaidTheme = theme
  win.__vmarkdMermaidVars = init?.themeVariables ?? null

  const apply = (m: any) => {
    if (!m || typeof m.initialize !== 'function') return
    const orig = m.__vmarkdMermaidInit || m.initialize.bind(m)
    m.__vmarkdMermaidInit = orig
    const t = win.__vmarkdMermaidTheme
    const v = win.__vmarkdMermaidVars
    m.initialize =
      t || v
        ? (cfg: any) =>
            orig({
              ...cfg,
              ...(t ? { theme: t } : {}),
              ...(v ? { themeVariables: v } : {}),
            })
        : orig
  }

  // Re-theme an already-loaded mermaid (covers re-init with a changed setting).
  if (win.mermaid) apply(win.mermaid)

  // Intercept Vditor's lazy `window.mermaid = …` assignment exactly once.
  if (!win.__vmarkdMermaidHook) {
    let current = win.mermaid
    try {
      Object.defineProperty(win, 'mermaid', {
        configurable: true,
        get() {
          return current
        },
        set(v) {
          current = v
          apply(v)
        },
      })
      win.__vmarkdMermaidHook = true
    } catch {
      // property non-configurable in this env — the eager apply above is best-effort
    }
  }
}
