import '../src/preload'
import Vditor from 'vditor'
import { createToolbar } from '../src/toolbar'

// Init-construction benchmark harness (tasks/42). Constructs Vditor under
// different option sets / documents and times new Vditor -> after() (i.e.
// `init.construct`, the GopherJS Lute load + first parse). Driven by Playwright
// through window.__bench / window.__benchCold.

const CDN = `${location.origin}/vditor`

function repeat(s: string, n: number): string {
  let out = ''
  for (let i = 0; i < n; i++) out += s
  return out
}

// Synthetic documents covering the content types that may trigger Vditor's
// lazy renderer loading (math -> KaTeX, code -> highlight.js, etc.).
export function makeDoc(kind: string): string {
  switch (kind) {
    case 'empty':
      return ''
    case 'plain1k':
      return repeat('lorem ipsum dolor sit amet ', 40) // ~1 KB
    case 'plain10k':
      return repeat('lorem ipsum dolor sit amet consectetur\n', 260) // ~10 KB
    case 'plain50k':
      return repeat('lorem ipsum dolor sit amet consectetur\n', 1300) // ~50 KB
    case 'headings': {
      let s = ''
      for (let i = 0; i < 200; i++)
        s += `## Heading ${i}\n\nParagraph text number ${i} with some words.\n\n`
      return s
    }
    case 'code': {
      let s = ''
      for (let i = 0; i < 50; i++)
        s +=
          '```js\nconst x' +
          i +
          ' = ' +
          i +
          '\nfunction f' +
          i +
          '() { return x' +
          i +
          ' * 2 }\n```\n\n'
      return s
    }
    case 'math': {
      let s = ''
      for (let i = 0; i < 50; i++)
        s += `Inline $a_${i}^2 + b = c$ and a block:\n\n$$\\int_0^${i} x\\,dx = \\frac{${i}^2}{2}$$\n\n`
      return s
    }
    case 'tables': {
      let s = ''
      for (let i = 0; i < 30; i++)
        s += '| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n\n'
      return s
    }
    default:
      return ''
  }
}

function buildOptions(spec: any): any {
  const opts: any = {
    cache: { enable: false },
    mode: spec.mode ?? 'ir',
    cdn: CDN,
    value:
      typeof spec.doc === 'string' ? spec.doc : makeDoc(spec.doc ?? 'empty'),
    // Vditor 3.11 calls this unconditionally while rendering the wysiwyg
    // toolbar; without it init throws (see main.ts).
    customWysiwygToolbar: () => {},
  }
  if (spec.toolbar === 'none') opts.toolbar = []
  else if (spec.toolbar === 'full') {
    opts.toolbar = createToolbar({})
    opts.toolbarConfig = { pin: true }
  }
  if (spec.math === false) {
    // leave math defaults off
  } else if (spec.math === true) {
    opts.preview = { ...(opts.preview || {}), math: { inlineDigit: true } }
  }
  return opts
}

function constructOnce(spec: any): Promise<number> {
  return new Promise((resolve) => {
    const host = document.getElementById('app')!
    host.innerHTML = '<div id="ed"></div>'
    const opts = buildOptions(spec)
    const t0 = performance.now()
    const ed: any = new Vditor('ed', {
      ...opts,
      after() {
        const dt = performance.now() - t0
        try {
          ed.destroy()
        } catch {}
        resolve(dt)
      },
    })
  })
}

async function measure(spec: any, iterations: number): Promise<number[]> {
  const runs: number[] = []
  for (let i = 0; i < iterations; i++) {
    runs.push(await constructOnce(spec))
  }
  return runs
}

function median(runs: number[]): number {
  const s = [...runs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
// Warm matrix: a single throwaway construct first loads Lute, then every spec
// is measured `iterations` times (median reported) with Lute already resident.
;(window as any).__bench = async (specs: any[], iterations = 3) => {
  await constructOnce({ doc: 'empty' }) // warmup: load Lute
  const out: any[] = []
  for (const spec of specs) {
    const runs = await measure(spec, iterations)
    out.push({ name: spec.name, median: median(runs), runs })
  }
  return out
}

// Cold: a single construct on a freshly-loaded page (Lute not yet in the JS
// engine) — Playwright reloads between calls to keep it cold.
;(window as any).__benchCold = async (spec: any) => {
  return await constructOnce(spec)
}

;(window as any).__ready = true
