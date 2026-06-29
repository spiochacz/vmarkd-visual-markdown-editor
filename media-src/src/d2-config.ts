// Typed owner for the D2 render-config globals (task 152 item 5), mirroring
// echarts-apply / mermaid-theme. main.ts (init + theme flip) SETS these; renderD2 /
// reRenderD2 (custom-diagrams.ts) READ them. Replaces the raw, untyped
// `(window as any).__vmarkd*` channel with one typed get/set so a key rename is a
// compile error and there's a single documented owner.
//
// `mode` + `contentTheme` are the editor's light/dark + content theme — only the
// D2 'auto' theme pairs to them, but they're the diagram-theme inputs renderD2
// reads, so they live here too. `geoBasemap` (the `theme.geoBasemap` setting) is a
// geojson/topojson render input read by initLeafletMap alongside `mode`, so it lives
// here too. (`__vmarkdAllowRemoteImages` is the CSP/security gate and stays separate.)
interface D2ConfigWindow {
  __vmarkdD2Layout?: string
  __vmarkdD2Theme?: string
  __vmarkdContentTheme?: string
  __vmarkdMode?: 'dark' | 'light'
  __vmarkdGeoBasemap?: string
}

export interface D2Config {
  layout?: string
  theme?: string
  contentTheme?: string
  mode?: 'dark' | 'light'
  geoBasemap?: string
}

const win = (): D2ConfigWindow => window as unknown as D2ConfigWindow

// Patch only the provided keys (each write site sets a different subset).
export function setD2Config(patch: Partial<D2Config>): void {
  const g = win()
  if ('layout' in patch) g.__vmarkdD2Layout = patch.layout
  if ('theme' in patch) g.__vmarkdD2Theme = patch.theme
  if ('contentTheme' in patch) g.__vmarkdContentTheme = patch.contentTheme
  if ('mode' in patch) g.__vmarkdMode = patch.mode
  if ('geoBasemap' in patch) g.__vmarkdGeoBasemap = patch.geoBasemap
}

export function getD2Config(): D2Config {
  const g = win()
  return {
    layout: g.__vmarkdD2Layout,
    theme: g.__vmarkdD2Theme,
    contentTheme: g.__vmarkdContentTheme,
    mode: g.__vmarkdMode,
    geoBasemap: g.__vmarkdGeoBasemap,
  }
}
