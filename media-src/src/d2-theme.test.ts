// Unit coverage for the D2 colour themes (vmarkd.diagram.d2Theme). Asserts the theme registry resolves
// to the right styles (mono fallback, d2-catalog exact tokens, editor-paired backgrounds) and that toSVG
// actually paints them — a page-background rect + themed edge stroke for a colour theme, and neither
// (transparent canvas, currentColor edges) for mono. Pure node: reuses a frozen layout fixture.
import { describe, expect, it } from 'vitest'
import { d2Theme, toSVG } from './d2-render'
import type { Layout } from './d2-render'
import raw from './__fixtures__/d2-raw-layouts.json'

const oauth = (raw as unknown as Record<string, Layout>).oauth

describe('d2Theme resolution', () => {
  it('falls back to mono for undefined / mono / unknown names', () => {
    for (const name of [undefined, 'mono', 'not-a-theme']) {
      const s = d2Theme(name)
      expect(s.mono).toBe(true)
      expect(s.leafFill).toBe('transparent')
      expect(s.leafStroke).toBe('currentColor')
      expect(s.edge).toBe('currentColor')
      expect(s.bg).toBeUndefined()
    }
  })

  it('d2-original reproduces the d2 Neutral-default tokens', () => {
    const s = d2Theme('d2-original')
    expect(s).toMatchObject({
      leafFill: '#F7F8FE', // B6 — d2's actual leaf fill (near-white)
      leafStroke: '#0D32B2', // B1
      contFill: '#E3E9FD', // B4 — level-0 container
      edge: '#0D32B2', // B1
      bg: '#FFFFFF', // N7
      text: '#0A0F25', // N1 — labels
      textMuted: '#676C7E', // N2 — edge labels
      accent: '#0D32B2', // B2 — sql/class column name
      accent2: '#4A6FF3', // AA2 — constraint / field type
      mono: false,
    })
    expect(s.fills).toEqual(['#E3E9FD', '#EDF0FD', '#F7F8FE', '#FFFFFF']) // B4→B5→B6→N7
  })

  it('each d2-catalog theme paints its own page background', () => {
    expect(d2Theme('d2-dark-mauve').bg).toBe('#1E1E2E')
    expect(d2Theme('d2-terminal').bg).toBe('#FFFFFF')
    expect(d2Theme('d2-cool-classics').edge).toBe('#000536')
  })

  it('editor-paired themes use the editor background', () => {
    expect(d2Theme('github-dark').bg).toBe('#0d1117')
    expect(d2Theme('github-light').bg).toBe('#ffffff')
    expect(d2Theme('vscode-dark').bg).toBe('#121314')
    expect(d2Theme('vscode-dark').mono).toBe(false)
  })
})

describe('toSVG applies the theme', () => {
  it('a colour theme paints a background rect + themed edge stroke', () => {
    const svg = toSVG(oauth, d2Theme('d2-original'))
    expect(svg).toContain('fill="#FFFFFF"') // page background rect
    expect(svg).toContain('stroke="#0D32B2"') // themed connection lines
    expect(svg).not.toContain('stroke="currentColor"')
  })

  it('mono keeps a transparent canvas and currentColor edges', () => {
    const svg = toSVG(oauth)
    expect(svg).toContain('stroke="currentColor"')
    expect(svg).not.toContain('fill="#FFFFFF"') // no page background rect in mono
  })
})

describe('sql_table / class follow the theme', () => {
  // Minimal one-node layouts (no edges) exercising the bespoke sql_table + class renderers, which used
  // to hardcode currentColor and ignore the colour theme.
  const sqlLayout = {
    nodes: [
      {
        s: {
          id: 't',
          shape: 'sql_table',
          label: 'Users',
          columns: [{ name: 'id', type: 'int', constraint: 'primary_key' }],
        },
        x: 0,
        y: 0,
        w: 160,
        h: 60,
        kind: 'sql',
        sqlCols: [40, 40, 40],
      },
    ],
    edges: [],
    W: 180,
    H: 80,
    edgeStyle: 'orthogonal',
  } as unknown as Layout

  const classLayout = {
    nodes: [
      {
        s: {
          id: 'c',
          shape: 'class',
          label: 'Repo',
          fields: [{ visibility: 'public', name: 'db', type: 'Conn' }],
          methods: [{ visibility: 'public', name: 'find()', type: 'User' }],
        },
        x: 0,
        y: 0,
        w: 160,
        h: 90,
        kind: 'class',
      },
    ],
    edges: [],
    W: 180,
    H: 110,
    edgeStyle: 'orthogonal',
  } as unknown as Layout

  for (const [name, layout] of [
    ['sql_table', sqlLayout],
    ['class', classLayout],
  ] as const) {
    it(`${name} uses d2 token colours under d2-original`, () => {
      const svg = toSVG(layout, d2Theme('d2-original'))
      expect(svg).toContain('stroke="#0A0F25"') // N1 border + dividers (neutral, like d2)
      expect(svg).toContain('fill="#0D32B2"') // B2 accent (column name / visibility marker)
      expect(svg).toContain('fill="#4A6FF3"') // AA2 accent (constraint / field type)
      expect(svg).not.toContain('currentColor') // no leftover monochrome
    })

    it(`${name} stays monochrome under mono`, () => {
      const svg = toSVG(layout)
      expect(svg).toContain('stroke="currentColor"')
      expect(svg).not.toContain('#0D32B2')
    })
  }
})
