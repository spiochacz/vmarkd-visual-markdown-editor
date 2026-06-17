// Custom diagram renderers for languages Vditor doesn't natively support.
// Each renderer: lazy-loads the engine script, finds unprocessed code blocks,
// replaces them with rendered SVG. Themed via currentColor (same as graphviz/plantuml).

declare const window: Window & {
  vditor?: { options?: { cdn?: string } }
  wavedrom?: {
    renderWaveForm: (
      index: number,
      source: object,
      outputElement: HTMLElement,
      skin?: string,
    ) => void
  }
  nomnoml?: {
    renderSvg: (source: string) => string
  }
  L?: any
  topojson?: {
    feature: (topology: any, object: any) => any
  }
  __threeSTL?: any
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
    if (!t.getAttribute('fill') || t.getAttribute('fill') === '#000' || t.getAttribute('fill') === 'black')
      t.setAttribute('fill', 'currentColor')
  })
  svg.querySelectorAll('path, line, polyline, rect, polygon').forEach((el) => {
    const s = el.getAttribute('stroke')
    if (s === '#000' || s === 'black' || s === '#000000')
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
    // Skip editable source blocks (IR marker panes) — render only in preview context
    if (el.closest('.vditor-ir__marker--pre')) continue
    if (!el.getAttribute('data-code')) {
      el.setAttribute('data-code', el.textContent?.trim() ?? '')
    }
    const code = el.getAttribute('data-code') ?? el.textContent?.trim() ?? ''
    if (!code) continue
    results.push({ wrapper: el, code })
  }
  return results
}

// --- WaveDrom ---

export function renderWavedrom(root?: ParentNode): void {
  const container = root ?? document
  const blocks = findBlocks(container, 'wavedrom')
  if (!blocks.length) return

  const cdn = getCdn()
  addScript(`${cdn}/dist/js/wavedrom/wavedrom.min.js`, 'vditorWavedromScript').then(() => {
    const wd = window.wavedrom
    if (!wd?.renderWaveForm) return

    let seq = 0
    blocks.forEach(({ wrapper, code }) => {
      try {
        const parsed = JSON.parse(code)
        // renderWaveForm writes SVG via createElementNS — the target must be in
        // the document for namespace resolution to work.
        const div = document.createElement('div')
        div.style.position = 'absolute'
        div.style.visibility = 'hidden'
        document.body.appendChild(div)
        wd.renderWaveForm(seq++, parsed, div)
        const svg = div.querySelector('svg')
        if (svg) {
          themeSvg(svg)
          wrapper.innerHTML = ''
          wrapper.appendChild(svg)
          wrapper.setAttribute('data-processed', 'true')
        }
        div.remove()
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
  addScript(`${cdn}/dist/js/nomnoml/nomnoml.min.js`, 'vditorNomnomlScript').then(() => {
    const nn = window.nomnoml
    if (!nn?.renderSvg) return

    blocks.forEach(({ wrapper, code }) => {
      try {
        const svgStr = nn.renderSvg(code)
        wrapper.innerHTML = svgStr
        const svg = wrapper.querySelector('svg')
        if (svg) themeSvg(svg)
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

// --- GeoJSON / TopoJSON (Leaflet) ---

function initLeafletMap(
  wrapper: HTMLElement,
  geojson: any,
): void {
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
    pointToLayer: (feature: any, latlng: any) =>
      L.circleMarker(latlng, { radius: 6, color: fg, fillColor: fg, fillOpacity: 0.4 }),
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
  addScript(`${cdn}/dist/js/leaflet/leaflet.js`, 'vditorLeafletScript').then(() => {
    if (!window.L) return
    blocks.forEach(({ wrapper, code }) => {
      try {
        const data = JSON.parse(code)
        initLeafletMap(wrapper, data)
      } catch {
        // Invalid JSON — leave source visible
      }
    })
  })
}

export function renderTopojson(root?: ParentNode): void {
  const container = root ?? document
  const blocks = findBlocks(container, 'topojson')
  if (!blocks.length) return

  const cdn = getCdn()
  addStylesheet(`${cdn}/dist/js/leaflet/leaflet.css`, 'vditorLeafletCss')
  Promise.all([
    addScript(`${cdn}/dist/js/leaflet/leaflet.js`, 'vditorLeafletScript'),
    addScript(`${cdn}/dist/js/topojson/topojson-client.min.js`, 'vditorTopojsonScript'),
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

// --- STL 3D models (three.js) ---

function initStlViewer(wrapper: HTMLElement, stlText: string): void {
  const T = window.__threeSTL
  if (!T) return

  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'width:100%;height:300px;display:block;background:transparent'
  wrapper.innerHTML = ''
  wrapper.appendChild(canvas)

  const w = canvas.clientWidth || 400
  const h = canvas.clientHeight || 300

  const scene = new T.Scene()
  const camera = new T.PerspectiveCamera(50, w / h, 0.1, 10000)
  scene.add(new T.AmbientLight(0x888888))
  const dirLight = new T.DirectionalLight(0xffffff, 1)
  dirLight.position.set(1, 1, 1)
  scene.add(dirLight)

  const geom = new T.STLLoader().parse(stlText)
  const fg = getComputedStyle(wrapper).color || '#888888'
  const mat = new T.MeshPhongMaterial({ color: new T.Color(fg), flatShading: true })
  const mesh = new T.Mesh(geom, mat)
  scene.add(mesh)

  // Center and fit camera to model
  const box = new T.Box3().setFromObject(mesh)
  const center = box.getCenter(new T.Vector3())
  mesh.position.sub(center)
  const size = box.getSize(new T.Vector3()).length()
  camera.position.set(0, 0, size * 1.5)

  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setSize(w, h)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  // Ctrl-to-interact: orbit/zoom only with Ctrl held (plain scroll = page scroll)
  const controls = new T.OrbitControls(camera, canvas)
  controls.enableZoom = false
  controls.enableRotate = false
  controls.enablePan = false
  canvas.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.ctrlKey) { controls.enableRotate = true; controls.enablePan = true }
  })
  canvas.addEventListener('mouseup', () => {
    controls.enableRotate = false; controls.enablePan = false
  })
  canvas.addEventListener('wheel', (e: WheelEvent) => {
    if (e.ctrlKey) { controls.enableZoom = true; e.preventDefault() }
    else { controls.enableZoom = false }
  }, { passive: false })

  function animate() {
    if (!canvas.isConnected) { renderer.dispose(); return }
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
  addScript(`${cdn}/dist/js/threejs/three-stl.min.js`, 'vditorThreeStlScript').then(() => {
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
    renderStl(appEl)
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
