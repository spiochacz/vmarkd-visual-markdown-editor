// User-configurable mermaid diagram theme. Vditor renders mermaid with
// theme='dark' iff its UI theme is dark and exposes no hook to override, so a
// plain flowchart in a dark editor looks monochrome. We wrap `mermaid.initialize`
// (whenever Vditor lazy-loads it and on every render call) to inject the chosen
// theme. `'auto'` / empty leaves Vditor's own behavior untouched.
//
// Pure except for the `win` it's given — unit-tested with a fake window.

export const MERMAID_THEMES = [
  'auto',
  'default',
  'dark',
  'forest',
  'neutral',
] as const
export type MermaidTheme = (typeof MERMAID_THEMES)[number]

export function applyMermaidTheme(win: any, theme: string | undefined): void {
  // Desired theme kept on the window so the lazy-load setter always reads the
  // current value (re-init can change it before mermaid has even loaded).
  win.__vmarkdMermaidTheme = theme && theme !== 'auto' ? theme : null

  const apply = (m: any) => {
    if (!m || typeof m.initialize !== 'function') return
    const orig = m.__vmarkdMermaidInit || m.initialize.bind(m)
    m.__vmarkdMermaidInit = orig
    const t = win.__vmarkdMermaidTheme
    m.initialize = t ? (cfg: any) => orig({ ...cfg, theme: t }) : orig
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
