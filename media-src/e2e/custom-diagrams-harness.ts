// Harness for task 101 (WaveDrom) + task 103 (nomnoml) + task 99 (GeoJSON/TopoJSON) + task 100 (STL).
import '../src/preload'
import Vditor from 'vditor/src/index'
import { observeCustomDiagrams } from '../src/custom-diagrams'

const cdn = `${location.origin}/vditor`

const md = `# Custom diagrams

\`\`\`wavedrom
{ "signal": [{ "name": "clk", "wave": "p......." }, { "name": "dat", "wave": "x.345x.." }] }
\`\`\`

\`\`\`nomnoml
[Pirate|eyeCount: Int|raid();pillage()]
[Pirate] -> [Ship]
\`\`\`

\`\`\`geojson
{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1],[0,0]]]},"properties":{"name":"Square"}}]}
\`\`\`

\`\`\`topojson
{"type":"Topology","objects":{"shape":{"type":"GeometryCollection","geometries":[{"type":"Polygon","arcs":[[0]]}]}},"arcs":[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}
\`\`\`

\`\`\`stl
solid triangle
 facet normal 0 0 1
  outer loop
   vertex 0 0 0
   vertex 1 0 0
   vertex 0.5 1 0
  endloop
 endfacet
endsolid triangle
\`\`\`
`

const app = document.getElementById('app')!
const v = new Vditor(app, {
  cdn,
  mode: 'wysiwyg',
  cache: { id: 'custom-diagrams-test' },
  value: md,
  after() {
    observeCustomDiagrams(app)
    ;(window as any).__ready = true
    ;(window as any).__cdn = cdn
  },
})
;(window as any).vditor = v
;(window as any).__el = () =>
  document.querySelector('.vditor-wysiwyg') as HTMLElement
