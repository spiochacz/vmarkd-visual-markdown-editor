// Custom diagram renderers for languages Vditor doesn't natively support.
// Each renderer: lazy-loads the engine script, finds unprocessed code blocks,
// replaces them with rendered SVG. Themed via currentColor (same as graphviz/plantuml).

// D2: compile-only WASM (compileD2) -> graph JSON -> dagre+Canvas SVG (renderD2Graph),
// with a LOUD fallback for shapes dagre can't faithfully render (unsupportedReason).
import { compileD2 } from './d2-wasm'
import {
  renderD2Graph,
  canvasMeasure,
  unsupportedReason,
  d2Theme,
} from './d2-render'
import { renderD2GraphElk } from './elk-layout'

declare const window: Window & {
  vditor?: { options?: { cdn?: string } }
  wavedrom?: {
    // 3rd arg is an id PREFIX string: renderWaveForm renders into document.getElementById(prefix+index).
    renderWaveForm: (index: number, source: object, idPrefix: string) => void
    waveSkin?: unknown // unpkg bundle exposes the skin here; bridged to window.WaveSkin (legacy global)
  }
  nomnoml?: {
    renderSvg: (source: string) => string
  }
  L?: any
  topojson?: {
    feature: (topology: any, object: any) => any
  }
  __threeSTL?: any
  WaveSkin?: any
  vegaEmbed?: (el: HTMLElement, spec: any, opts?: any) => Promise<any>
}

function getCdn(): string {
  const v = window.vditor as any
  return v?.vditor?.options?.cdn ?? v?.options?.cdn ?? ''
}

function addScript(src: string, id: string): Promise<void> {
  return new Promise((resolve) => {
    if (document.getElementById(id)) {
      resolve()
      return
    }
    const s = document.createElement('script')
    s.id = id
    s.src = src
    s.onload = () => resolve()
    s.onerror = () => resolve()
    document.head.appendChild(s)
  })
}

function addStylesheet(href: string, id: string): void {
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
}

function themeSvg(svg: SVGElement): void {
  svg.style.maxWidth = '100%'
  svg.style.height = 'auto'
  svg.querySelectorAll('text').forEach((t) => {
    if (
      !t.getAttribute('fill') ||
      t.getAttribute('fill') === '#000' ||
      t.getAttribute('fill') === 'black'
    )
      t.setAttribute('fill', 'currentColor')
  })
  svg.querySelectorAll('path, line, polyline, rect, polygon').forEach((el) => {
    const s = el.getAttribute('stroke')
    if (s === '#000' || s === 'black' || s === '#000000')
      el.setAttribute('stroke', 'currentColor')
  })
}

// WaveDrom bakes colors into inline style attrs (not fill/stroke attrs). The default
// skin is light-only: white backgrounds, black text/grid, #0041c4 signal arrows.
// Post-process: white bg → transparent, black → currentColor, dark grids → muted.
// Signal wave colors (greens, blues, reds, yellows) are intentional data colors — keep them.
function themeWavedromSvg(svg: SVGElement): void {
  svg.style.maxWidth = '100%'
  svg.style.height = 'auto'
  // The wave LINES (.s1/.s2), dashes (.s3/.s4) and hatch (.s6) get their colour from CLASSES in an
  // embedded <style> skin (stroke/fill/color:#000), NOT inline attrs — so the inline pass below misses
  // them and they stay black (invisible on dark; reported). Rewrite the skin CSS: black → currentColor
  // (incl. `color:#000`, which would otherwise pin currentColor itself to black so even recoloured
  // strokes render black), white fill → transparent. The pastel data-value fills (.s8–.s14) and the
  // #0041c4 signal arrows are intentional data colours — their hexes don't match these patterns, so
  // they're left untouched.
  svg.querySelectorAll('style').forEach((styleEl) => {
    const css = styleEl.textContent
    if (!css) return
    const next = css
      .replace(
        /(stroke|fill|color)\s*:\s*#0{3}(?:0{3})?\b/gi,
        '$1:currentColor',
      )
      .replace(/(stroke|fill|color)\s*:\s*black\b/gi, '$1:currentColor')
      .replace(/fill\s*:\s*#f{3}(?:f{3})?\b/gi, 'fill:transparent')
      .replace(/fill\s*:\s*white\b/gi, 'fill:transparent')
    if (next !== css) styleEl.textContent = next
  })
  const WHITE = ['white', '#fff', '#ffffff', '#FFF', '#ffffffcc']
  const BLACK = ['#000', 'black', '#000000']
  svg.querySelectorAll('*').forEach((el) => {
    const st = (el as HTMLElement).style
    if (!st) return
    if (WHITE.some((w) => st.fill === w)) st.fill = 'transparent'
    if (BLACK.some((b) => st.fill === b)) st.fill = 'currentColor'
    if (BLACK.some((b) => st.stroke === b)) st.stroke = 'currentColor'
    // Gray grid lines → follow theme (muted currentColor with opacity)
    const rawStyle = el.getAttribute('style') ?? ''
    if (rawStyle.includes('stroke:#888')) {
      st.stroke = 'currentColor'
      st.opacity = '0.3'
    }
  })
  svg.querySelectorAll('text').forEach((t) => {
    const fill = t.getAttribute('fill')
    if (!fill || BLACK.includes(fill)) t.setAttribute('fill', 'currentColor')
    if (!t.style.fill || BLACK.includes(t.style.fill))
      t.style.fill = 'currentColor'
  })
}

// nomnoml uses #33322E (dark brown) for text/strokes and #eee8d5 (beige) for node fills.
function themeNomnomlSvg(svg: SVGElement): void {
  svg.style.maxWidth = '100%'
  svg.style.height = 'auto'
  const DARK = ['#33322E', '#33322e']
  const LIGHT_BG = ['#eee8d5', '#fdf6e3']
  svg.querySelectorAll('*').forEach((el) => {
    const fill = el.getAttribute('fill')
    const stroke = el.getAttribute('stroke')
    if (fill && DARK.includes(fill)) el.setAttribute('fill', 'currentColor')
    if (fill && LIGHT_BG.includes(fill)) {
      el.setAttribute('fill', 'currentColor')
      el.setAttribute('fill-opacity', '0.06')
    }
    if (stroke && DARK.includes(stroke))
      el.setAttribute('stroke', 'currentColor')
  })
}

const PANE_SEL =
  '.vditor-ir__preview, .vditor-wysiwyg__preview, .vditor-preview'

function findBlocks(
  root: ParentNode,
  lang: string,
): { wrapper: HTMLElement; code: string }[] {
  const results: { wrapper: HTMLElement; code: string }[] = []
  // Search preview panes first (IR/WYSIWYG collapsed preview, full Preview overlay),
  // then fall back to the whole root — custom languages (wavedrom, nomnoml, geojson,
  // topojson) are unknown to Vditor and may appear as bare <code> blocks without a
  // preview pane wrapper.
  const sel = `code.language-${lang}:not([data-processed="true"]), div.language-${lang}:not([data-processed="true"])`
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(sel))) {
    // Skip editable source blocks — render only in preview context
    if (el.closest('.vditor-ir__marker--pre, .vditor-wysiwyg__pre')) continue
    if (!el.getAttribute('data-code')) {
      el.setAttribute('data-code', el.textContent?.trim() ?? '')
    }
    const code = el.getAttribute('data-code') ?? el.textContent?.trim() ?? ''
    if (!code) continue
    // <code> can't hold block-level children (div/svg/canvas) — browsers refuse to
    // parse them as DOM inside inline elements. Swap to a <div> with the same class
    // so renderers can append real elements.
    let wrapper = el
    if (el.tagName === 'CODE') {
      const div = document.createElement('div')
      div.className = el.className
      if (el.getAttribute('data-code'))
        div.setAttribute('data-code', el.getAttribute('data-code')!)
      el.replaceWith(div)
      wrapper = div
    }
    results.push({ wrapper, code })
  }
  return results
}

// --- WaveDrom ---

export function renderWavedrom(root?: ParentNode): void {
  const container = root ?? document
  const blocks = findBlocks(container, 'wavedrom')
  if (!blocks.length) return

  const cdn = getCdn()
  addScript(
    `${cdn}/dist/js/wavedrom/wavedrom.min.js`,
    'vditorWavedromScript',
  ).then(() => {
    const wd = window.wavedrom
    if (!wd?.renderWaveForm) return
    // renderWaveForm internally reads window.WaveSkin (legacy global); the unpkg
    // bundle only sets wavedrom.waveSkin — bridge it.
    if (!window.WaveSkin && wd.waveSkin) (window as any).WaveSkin = wd.waveSkin

    let seq = 0
    blocks.forEach(({ wrapper, code }) => {
      try {
        const parsed = JSON.parse(code)
        // renderWaveForm(index, source, idPrefix) renders into
        // document.getElementById(idPrefix + index).
        const id = `__vmarkd_wd_${seq}`
        const div = document.createElement('div')
        div.id = id
        wrapper.innerHTML = ''
        wrapper.appendChild(div)
        wd.renderWaveForm(seq, parsed, '__vmarkd_wd_')
        seq++
        const svg = wrapper.querySelector('svg')
        if (svg) themeWavedromSvg(svg)
        wrapper.setAttribute('data-processed', 'true')
      } catch {
        // Invalid JSON or render error — leave the source visible
      }
    })
  })
}

export function reRenderWavedrom(root?: ParentNode): void {
  const container = root ?? document
  for (const pane of Array.from(
    container.querySelectorAll<HTMLElement>(PANE_SEL),
  )) {
    for (const el of Array.from(
      pane.querySelectorAll<HTMLElement>(
        'code.language-wavedrom[data-processed], div.language-wavedrom[data-processed]',
      ),
    )) {
      el.removeAttribute('data-processed')
      el.innerHTML = ''
    }
  }
  renderWavedrom(container)
}

// --- nomnoml ---

export function renderNomnoml(root?: ParentNode): void {
  const container = root ?? document
  const blocks = findBlocks(container, 'nomnoml')
  if (!blocks.length) return

  const cdn = getCdn()
  addScript(
    `${cdn}/dist/js/nomnoml/nomnoml.min.js`,
    'vditorNomnomlScript',
  ).then(() => {
    const nn = window.nomnoml
    if (!nn?.renderSvg) return

    blocks.forEach(({ wrapper, code }) => {
      try {
        const svgStr = nn.renderSvg(code)
        wrapper.innerHTML = svgStr
        const svg = wrapper.querySelector('svg')
        if (svg) themeNomnomlSvg(svg)
        wrapper.setAttribute('data-processed', 'true')
      } catch {
        // Parse error — leave the source visible
      }
    })
  })
}

export function reRenderNomnoml(root?: ParentNode): void {
  const container = root ?? document
  for (const pane of Array.from(
    container.querySelectorAll<HTMLElement>(PANE_SEL),
  )) {
    for (const el of Array.from(
      pane.querySelectorAll<HTMLElement>(
        'code.language-nomnoml[data-processed], div.language-nomnoml[data-processed]',
      ),
    )) {
      el.removeAttribute('data-processed')
      el.innerHTML = ''
    }
  }
  renderNomnoml(container)
}

// --- D2 (compile-only WASM + dagre + currentColor SVG) ---

export function renderD2(root?: ParentNode): void {
  const container = root ?? document
  // findBlocks already skips IR/WYSIWYG edit-surface markers (.vditor-ir__marker--pre,
  // .vditor-wysiwyg__pre) and already-[data-processed] blocks — D2 inherits that guard.
  const blocks = findBlocks(container, 'd2')
  if (!blocks.length) return

  const cdn = getCdn()
  for (const { wrapper, code } of blocks) {
    // D2 is ASYNC (WASM boot + compile), unlike the synchronous renderers above. Mark the
    // block processed UP-FRONT so a re-firing observer can't double-render it while
    // compileD2 is pending (the sync renderers set data-processed at the end; D2 cannot).
    wrapper.setAttribute('data-processed', 'true')
    compileD2(cdn, code)
      .then(async (res) => {
        if ('error' in res) {
          // Distinguish a WASM boot/timeout from a real d2 compile error so a stuck engine
          // isn't mistaken for bad syntax. Both leave the source visible (loud), like the
          // other renderers' catch{}. data-d2-error is inspectable in devtools / e2e.
          wrapper.setAttribute(
            'data-d2-error',
            res.error === 'd2 wasm unavailable' ? 'boot' : 'compile',
          )
          return
        }
        const reason = unsupportedReason(res)
        if (reason) {
          // LOUD fallback (faithful-by-construction, NON-NEGOTIABLE): raw source + a note,
          // NEVER a partial/wrong picture. Single enforcement point for unsupportedReason.
          wrapper.innerHTML = ''
          const note = document.createElement('div')
          note.className = 'd2-unsupported-note'
          note.textContent = `d2: ${reason} not supported — showing source`
          const pre = document.createElement('pre')
          pre.className = 'language-d2-unsupported'
          pre.textContent = code
          wrapper.append(note, pre)
          return
        }
        // Layout engine from the `vmarkd.diagram.d2Layout` setting (window global set by main.ts).
        // ELK gives orthogonal routing; it lazy-loads a separate main-thread bundle (elk-main.js,
        // ~1.4 MB) and returns null if it can't load/lay out, so we fall back to dagre.
        // Colour theme from `vmarkd.theme.d2` (window global set by main.ts). 'auto' pairs the
        // palette to the content theme + editor mode (also globals); named themes paint their own
        // palette (+bg for d2-*); 'mono'/undefined → monochrome currentColor that follows the editor.
        const style = d2Theme(
          (window as any).__vmarkdD2Theme,
          (window as any).__vmarkdContentTheme,
          (window as any).__vmarkdMode,
        )
        let svgStr: string | null = null
        let engine = 'dagre'
        // Three engines (vmarkd.diagram.d2Layout): 'vmarkd' = ELK + our refinement pipeline (default),
        // 'elk' = raw ELK (refine off), 'dagre' = the bundled fallback. ELK lazy-loads elk-main.js and
        // returns null if it can't load/lay out → we always fall back to dagre.
        const layout = (window as any).__vmarkdD2Layout
        if (layout === 'vmarkd' || layout === 'elk') {
          const refine = layout === 'vmarkd'
          svgStr = await renderD2GraphElk(
            res,
            canvasMeasure,
            cdn,
            style,
            refine,
          )
          if (svgStr) engine = layout
        }
        if (!svgStr) svgStr = renderD2Graph(res, canvasMeasure, style)
        wrapper.innerHTML = svgStr
        // Record which engine actually produced the SVG (elk vs the dagre fallback). Lets the
        // real-VS-Code e2e prove ELK ran in the webview rather than silently falling back.
        wrapper.setAttribute('data-d2-engine', engine)
        const svg = wrapper.querySelector('svg')
        if (svg) themeSvg(svg)
      })
      .catch(() => {
        /* leave source visible */
      })
  }
}

export function reRenderD2(root?: ParentNode): void {
  const container = root ?? document
  for (const pane of Array.from(
    container.querySelectorAll<HTMLElement>(PANE_SEL),
  )) {
    for (const el of Array.from(
      pane.querySelectorAll<HTMLElement>(
        'code.language-d2[data-processed], div.language-d2[data-processed]',
      ),
    )) {
      el.removeAttribute('data-processed')
      el.removeAttribute('data-d2-error')
      el.innerHTML = ''
    }
  }
  renderD2(container)
}

// --- GeoJSON / TopoJSON (Leaflet) ---

function initLeafletMap(wrapper: HTMLElement, geojson: any): void {
  const L = window.L
  if (!L) return

  const div = document.createElement('div')
  div.style.cssText = 'width:100%;height:300px;background:transparent'
  wrapper.innerHTML = ''
  wrapper.appendChild(div)

  const map = L.map(div, {
    zoomControl: true,
    attributionControl: false,
    scrollWheelZoom: false,
  })

  const fg = getComputedStyle(wrapper).color || '#3388ff'
  const layer = L.geoJSON(geojson, {
    style: {
      color: fg,
      fillColor: fg,
      fillOpacity: 0.15,
      weight: 2,
    },
    pointToLayer: (_feature: any, latlng: any) =>
      L.circleMarker(latlng, {
        radius: 6,
        color: fg,
        fillColor: fg,
        fillOpacity: 0.4,
      }),
  })
  layer.addTo(map)

  try {
    map.fitBounds(layer.getBounds(), { padding: [20, 20] })
  } catch {
    map.setView([0, 0], 2)
  }

  wrapper.setAttribute('data-processed', 'true')
}

export function renderGeojson(root?: ParentNode): void {
  const container = root ?? document
  const blocks = findBlocks(container, 'geojson')
  if (!blocks.length) return

  const cdn = getCdn()
  addStylesheet(`${cdn}/dist/js/leaflet/leaflet.css`, 'vditorLeafletCss')
  addScript(`${cdn}/dist/js/leaflet/leaflet.js`, 'vditorLeafletScript').then(
    () => {
      if (!window.L) return
      blocks.forEach(({ wrapper, code }) => {
        try {
          const data = JSON.parse(code)
          initLeafletMap(wrapper, data)
        } catch {
          // Invalid JSON — leave source visible
        }
      })
    },
  )
}

export function renderTopojson(root?: ParentNode): void {
  const container = root ?? document
  const blocks = findBlocks(container, 'topojson')
  if (!blocks.length) return

  const cdn = getCdn()
  addStylesheet(`${cdn}/dist/js/leaflet/leaflet.css`, 'vditorLeafletCss')
  Promise.all([
    addScript(`${cdn}/dist/js/leaflet/leaflet.js`, 'vditorLeafletScript'),
    addScript(
      `${cdn}/dist/js/topojson/topojson-client.min.js`,
      'vditorTopojsonScript',
    ),
  ]).then(() => {
    if (!window.L || !window.topojson) return
    blocks.forEach(({ wrapper, code }) => {
      try {
        const topo = JSON.parse(code)
        const firstObj = Object.values(topo.objects)[0]
        const geojson = window.topojson!.feature(topo, firstObj)
        initLeafletMap(wrapper, geojson)
      } catch {
        // Invalid JSON or conversion error — leave source visible
      }
    })
  })
}

export function reRenderGeojson(root?: ParentNode): void {
  const container = root ?? document
  for (const pane of Array.from(
    container.querySelectorAll<HTMLElement>(PANE_SEL),
  )) {
    for (const el of Array.from(
      pane.querySelectorAll<HTMLElement>(
        'code.language-geojson[data-processed], div.language-geojson[data-processed]',
      ),
    )) {
      el.removeAttribute('data-processed')
      el.innerHTML = ''
    }
  }
  renderGeojson(container)
}

export function reRenderTopojson(root?: ParentNode): void {
  const container = root ?? document
  for (const pane of Array.from(
    container.querySelectorAll<HTMLElement>(PANE_SEL),
  )) {
    for (const el of Array.from(
      pane.querySelectorAll<HTMLElement>(
        'code.language-topojson[data-processed], div.language-topojson[data-processed]',
      ),
    )) {
      el.removeAttribute('data-processed')
      el.innerHTML = ''
    }
  }
  renderTopojson(container)
}

// --- Vega / Vega-Lite ---

function renderVegaBlock(
  blocks: { wrapper: HTMLElement; code: string }[],
): void {
  const ve = window.vegaEmbed
  if (!ve) return

  blocks.forEach(({ wrapper, code }) => {
    try {
      const spec = JSON.parse(code)
      // Block remote data URLs for offline/security — only inline data.values works
      if (spec.data?.url) delete spec.data.url
      const div = document.createElement('div')
      wrapper.innerHTML = ''
      wrapper.appendChild(div)
      const fg = getComputedStyle(wrapper).color || '#333'
      const bg = 'transparent'
      ve(div, spec, {
        renderer: 'svg',
        actions: false,
        config: {
          background: bg,
          axis: {
            labelColor: fg,
            titleColor: fg,
            tickColor: fg,
            domainColor: fg,
            gridColor: fg,
            gridOpacity: 0.15,
          },
          legend: { labelColor: fg, titleColor: fg },
          title: { color: fg },
          view: { stroke: 'transparent' },
        },
      })
        .then(() => {
          wrapper.setAttribute('data-processed', 'true')
        })
        .catch(() => {})
    } catch {
      // Invalid JSON — leave source visible
    }
  })
}

export function renderVega(root?: ParentNode): void {
  const container = root ?? document
  const blocks = findBlocks(container, 'vega')
  if (!blocks.length) return

  const cdn = getCdn()
  addScript(`${cdn}/dist/js/vega/vega-embed.min.js`, 'vditorVegaScript').then(
    () => {
      renderVegaBlock(blocks)
    },
  )
}

export function renderVegaLite(root?: ParentNode): void {
  const container = root ?? document
  const blocks = findBlocks(container, 'vega-lite')
  if (!blocks.length) return

  const cdn = getCdn()
  addScript(`${cdn}/dist/js/vega/vega-embed.min.js`, 'vditorVegaScript').then(
    () => {
      renderVegaBlock(blocks)
    },
  )
}

export function reRenderVega(root?: ParentNode): void {
  const container = root ?? document
  for (const pane of Array.from(
    container.querySelectorAll<HTMLElement>(PANE_SEL),
  )) {
    for (const el of Array.from(
      pane.querySelectorAll<HTMLElement>(
        'code.language-vega[data-processed], div.language-vega[data-processed],' +
          'code.language-vega-lite[data-processed], div.language-vega-lite[data-processed]',
      ),
    )) {
      el.removeAttribute('data-processed')
      el.innerHTML = ''
    }
  }
  renderVega(container)
  renderVegaLite(container)
}

// --- STL 3D models (three.js) ---

// A shaded 3D solid can't follow the theme foreground (currentColor) the way our line-art SVG
// diagrams do: three.js lighting MULTIPLIES the base colour, so a near-black foreground — every light
// content theme, e.g. github-light — collapses the model into an all-black, formless blob (reported
// bug). Use a fixed, theme-INDEPENDENT neutral mid-grey instead; the directional lights then render
// clear 3D shading on BOTH light and dark backgrounds. Kept mid-tone (luminance ~0.35) so neither the
// lit nor the shadowed faces clip to white/black. Exported + asserted in stl-material.test.ts.
export const STL_MATERIAL_COLOR = '#9aa0a6'

function initStlViewer(wrapper: HTMLElement, stlText: string): void {
  const T = window.__threeSTL
  if (!T) return

  const canvas = document.createElement('canvas')
  canvas.style.cssText =
    'width:100%;height:300px;display:block;background:transparent'
  wrapper.innerHTML = ''
  wrapper.appendChild(canvas)

  const w = canvas.clientWidth || 400
  const h = canvas.clientHeight || 300

  const scene = new T.Scene()
  const camera = new T.PerspectiveCamera(50, w / h, 0.1, 10000)
  scene.add(new T.AmbientLight(0x666666))
  const keyLight = new T.DirectionalLight(0xffffff, 1.2)
  keyLight.position.set(1, 2, 1.5)
  scene.add(keyLight)
  const fillLight = new T.DirectionalLight(0xffffff, 0.4)
  fillLight.position.set(-1, -0.5, -1)
  scene.add(fillLight)

  const geom = new T.STLLoader().parse(stlText)
  geom.computeVertexNormals()
  // Theme-independent neutral material (see STL_MATERIAL_COLOR) — NOT the wrapper's foreground, which
  // turned the model all-black on every light theme. data-stl-material records the applied colour so
  // the real-VS-Code e2e can verify the fix without a flaky WebGL pixel read-back.
  const mat = new T.MeshPhongMaterial({
    color: new T.Color(STL_MATERIAL_COLOR),
    shininess: 60,
    specular: new T.Color(0x444444),
  })
  canvas.dataset.stlMaterial = STL_MATERIAL_COLOR
  const mesh = new T.Mesh(geom, mat)
  scene.add(mesh)

  const box = new T.Box3().setFromObject(mesh)
  const center = box.getCenter(new T.Vector3())
  mesh.position.sub(center)
  const size = box.getSize(new T.Vector3()).length()
  // Offset camera for a 3/4 view so multiple faces are visible with shading
  camera.position.set(size * 0.8, size * 0.6, size * 1.2)

  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setSize(w, h)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  // Ctrl-to-interact: orbit/zoom only with Ctrl held (plain scroll = page scroll)
  const controls = new T.OrbitControls(camera, canvas)
  controls.enableZoom = false
  controls.enableRotate = false
  controls.enablePan = false
  canvas.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.ctrlKey) {
      controls.enableRotate = true
      controls.enablePan = true
    }
  })
  canvas.addEventListener('mouseup', () => {
    controls.enableRotate = false
    controls.enablePan = false
  })
  canvas.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      if (e.ctrlKey) {
        controls.enableZoom = true
        e.preventDefault()
      } else {
        controls.enableZoom = false
      }
    },
    { passive: false },
  )

  function animate() {
    if (!canvas.isConnected) {
      renderer.dispose()
      return
    }
    requestAnimationFrame(animate)
    controls.update()
    renderer.render(scene, camera)
  }
  animate()

  wrapper.setAttribute('data-processed', 'true')
}

export function renderStl(root?: ParentNode): void {
  const container = root ?? document
  const blocks = findBlocks(container, 'stl')
  if (!blocks.length) return

  const cdn = getCdn()
  addScript(
    `${cdn}/dist/js/threejs/three-stl.min.js`,
    'vditorThreeStlScript',
  ).then(() => {
    if (!window.__threeSTL) return
    blocks.forEach(({ wrapper, code }) => {
      try {
        initStlViewer(wrapper, code)
      } catch {
        // Parse error — leave source visible
      }
    })
  })
}

export function reRenderStl(root?: ParentNode): void {
  const container = root ?? document
  for (const pane of Array.from(
    container.querySelectorAll<HTMLElement>(PANE_SEL),
  )) {
    for (const el of Array.from(
      pane.querySelectorAll<HTMLElement>(
        'code.language-stl[data-processed], div.language-stl[data-processed]',
      ),
    )) {
      el.removeAttribute('data-processed')
      el.innerHTML = ''
    }
  }
  renderStl(container)
}

// --- Observer: render all custom diagrams on DOM mutations ---

export function observeCustomDiagrams(
  appEl: HTMLElement | null | undefined,
): () => void {
  if (!appEl) return () => {}
  let raf = 0
  const run = () => {
    raf = 0
    renderWavedrom(appEl)
    renderNomnoml(appEl)
    renderGeojson(appEl)
    renderTopojson(appEl)
    renderVega(appEl)
    renderVegaLite(appEl)
    renderStl(appEl)
    renderD2(appEl)
  }
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(run)
  }
  const obs = new MutationObserver(schedule)
  obs.observe(appEl, { childList: true, subtree: true })
  schedule()
  return () => {
    obs.disconnect()
    if (raf) cancelAnimationFrame(raf)
  }
}
