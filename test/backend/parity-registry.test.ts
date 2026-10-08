import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as vm from 'node:vm'
import { JSDOM } from 'jsdom'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { prewarmLute, renderForMode } from '../../src/lute/lute-host'
import {
  buildParityFixture,
  PARITY_ELEMENTS,
  PARITY_MARKERS,
  BEHAVIOUR_OBSERVERS,
  type ParityFamily,
  stageFamily,
} from '../parity/elements'
import {
  type AllowedDifference,
  diffRun,
  evaluateRuns,
  registryProblems,
  validateAllowList,
} from '../parity/compare'
import { PARITY_CONFIGS, resolveParityConfig } from '../parity/configs'
import { CONTENT_DECORATORS } from '../../media-src/src/boot/content-decorators'
import { flattenSnapshot, type StageSnapshot } from '../parity/snapshot'
import { CONTENT_THEMES } from '../../src/shared/theme-registry'
import {
  isLuteArtifactBuilt,
  waitForLuteWarm,
  warnLuteArtifactMissing,
} from './lute-artifact'

// Task 532 §E — the registry tests behind the cross-stage parity gate (tests 4, 5 and 7), plus the
// comparator's own logic. The gate itself runs in a browser (media-src/e2e/parity.spec.ts and
// test/vscode-e2e/parity-matrix.spec.ts); these are the no-boot checks that keep its inputs honest:
// the fixture is generated from the registry, every probe finds an element in a real Lute render,
// every long-lived observer is classified, and the allow-list is well-formed with no dangling task.

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const FIXTURE_PATH = path.join(ROOT, 'test/vscode-e2e/fixtures/parity-canon.md')
const ALLOW_PATH = path.join(ROOT, 'test/parity/allowed-differences.json')
const TASK_PATH = path.join(
  ROOT,
  'tasks/532-visual-consistency-across-stages.md',
)

// MAX_PRERENDER_CHARS in lute-host.ts (private): a fixture past it would be CUT before the overlay
// is rendered, and the gate would compare a truncated overlay with a full editor.
const MAX_PRERENDER_CHARS = 10_000

describe('parity element registry (§E 4)', () => {
  it('has unique kinds and unique, prefix-free anchors that occur in their own snippet', () => {
    const kinds = PARITY_ELEMENTS.map((e) => e.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
    const anchors = PARITY_ELEMENTS.flatMap((e) =>
      'anchor' in e.probe ? [{ kind: e.kind, anchor: e.probe.anchor }] : [],
    )
    for (const a of anchors) {
      const owner = PARITY_ELEMENTS.find((e) => e.kind === a.kind)
      expect(owner?.snippet, `${a.kind} snippet carries its anchor`).toContain(
        a.anchor,
      )
    }
    for (const a of anchors)
      for (const b of anchors)
        if (a !== b)
          expect(
            b.anchor.includes(a.anchor),
            `anchor "${a.anchor}" (${a.kind}) must not occur inside "${b.anchor}" (${b.kind})`,
          ).toBe(false)
  })

  it('the committed parity-canon.md equals the fixture generated from the registry', () => {
    // Regenerate with: node scripts/gen-parity-fixture.mjs
    expect(readFileSync(FIXTURE_PATH, 'utf8')).toBe(buildParityFixture())
  })

  it('the fixture fits the instant-paint cap, so the overlay is never truncated', () => {
    expect(buildParityFixture().length).toBeLessThan(MAX_PRERENDER_CHARS)
  })

  it('names only registered markers in every expectation', () => {
    for (const e of PARITY_ELEMENTS)
      for (const m of e.expectMarkers)
        expect(PARITY_MARKERS, `${e.kind} -> ${m}`).toHaveProperty(m)
  })

  describe('every probe matches an element in a real Lute render', () => {
    const LUTE_BUILT = isLuteArtifactBuilt(ROOT)
    if (!LUTE_BUILT)
      warnLuteArtifactMissing('parity registry > Lute renders', ROOT)

    let md = ''
    const html: Record<'ir' | 'wysiwyg' | 'html', string> = {
      ir: '',
      wysiwyg: '',
      html: '',
    }

    beforeAll(async () => {
      if (!LUTE_BUILT) return
      md = buildParityFixture()
      prewarmLute(ROOT)
      await waitForLuteWarm()
      html.ir = renderForMode(ROOT, md, 'ir') ?? ''
      html.wysiwyg = renderForMode(ROOT, md, 'wysiwyg') ?? ''
      // The Preview's producer: stock Md2HTML (no host wrapper), run in its own vm like lute-host.
      const sandbox: Record<string, unknown> = {
        TextEncoder,
        TextDecoder,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        console,
      }
      vm.createContext(sandbox)
      vm.runInContext(
        readFileSync(
          path.join(ROOT, 'media/vditor/dist/js/lute/lute.min.js'),
          'utf8',
        ),
        sandbox,
      )
      const lute = (
        sandbox as { Lute: { New(): { Md2HTML(m: string): string } } }
      ).Lute.New()
      html.html = lute.Md2HTML(md)
    })

    // The same lookup the in-page snapshot performs (test/parity/snapshot.ts `find`).
    const locate = (
      doc: Document,
      root: Element,
      el: (typeof PARITY_ELEMENTS)[number],
      family: ParityFamily,
    ): Element | null => {
      if (!('anchor' in el.probe))
        return root.querySelector(el.probe.select[family])
      const w = doc.createTreeWalker(root, 4 /* SHOW_TEXT */)
      let n = w.nextNode()
      while (n) {
        if ((n.nodeValue ?? '').includes(el.probe.anchor))
          return n.parentElement?.closest(el.probe[family]) ?? null
        n = w.nextNode()
      }
      return null
    }

    // Elements the WEBVIEW creates at run time in the Preview, so stock Md2HTML cannot contain them:
    // the custom d2 engine replaces `<pre><code class=language-d2>` with a div, and the comment
    // decorator turns the invisible `<!-- -->` into `.vmarkd-comment`. The gate asserts those against
    // the live stages instead (registryProblems).
    const RUNTIME_HTML = new Set(['diagram-d2', 'html-comment'])

    for (const [label, key, family] of [
      ['IR', 'ir', 'edit'],
      ['WYSIWYG', 'wysiwyg', 'edit'],
      ['HTML (Preview)', 'html', 'preview'],
    ] as const) {
      it(`${label}`, () => {
        if (!LUTE_BUILT) return
        const dom = new JSDOM(`<body><div id="root">${html[key]}</div></body>`)
        const doc = dom.window.document
        const root = doc.getElementById('root') as Element
        const missing = PARITY_ELEMENTS.filter(
          (e) =>
            !(key === 'html' && RUNTIME_HTML.has(e.kind)) &&
            !locate(doc, root, e, family),
        ).map((e) => e.kind)
        expect(missing, `${label}: kinds with no element`).toEqual([])
      })
    }
  })

  it('maps each stage to its probe family', () => {
    expect(
      ['overlay', 'ir', 'wysiwyg'].map((s) => stageFamily(s as never)),
    ).toEqual(['edit', 'edit', 'edit'])
    expect(['preview', 'sv'].map((s) => stageFamily(s as never))).toEqual([
      'preview',
      'preview',
    ])
  })

  it('registryProblems flags a missing kind and a missing expected marker', () => {
    const ir: Record<string, Record<string, string | number>> = {}
    for (const e of PARITY_ELEMENTS) {
      ir[e.kind] = { present: 'yes' }
      for (const m of e.expectMarkers) ir[e.kind][`marker.${m}`] = 1
    }
    expect(registryProblems(ir)).toEqual([])
    delete ir.h2
    ir.table = { present: 'yes' }
    ir['task-list']['marker.checkbox'] = 0
    const problems = registryProblems(ir)
    expect(problems.join('\n')).toMatch(/kind "h2" has no element/)
    expect(problems.join('\n')).toMatch(/task-list.*marker "checkbox"/)
  })
})

describe('decorator registration (§E 5)', () => {
  const finishInit = readFileSync(
    path.join(ROOT, 'media-src/src/boot/finish-init.ts'),
    'utf8',
  )
  const decoratorNames = CONTENT_DECORATORS.map((d) => d.name)

  it('finish-init installs content decorators ONLY through the registry loop', () => {
    // Same style as probe-tier-convention.test.ts: scan the source text for `observers.set('name'`.
    const handWritten = [
      ...finishInit.matchAll(/observers\.set\(\s*'([\w-]+)'/g),
    ].map((m) => m[1])
    expect(handWritten.length).toBeGreaterThan(8)
    expect([...new Set(handWritten)].sort()).toEqual(
      [...BEHAVIOUR_OBSERVERS].sort(),
    )
    for (const name of decoratorNames)
      expect(handWritten, `${name} must not be hand-registered`).not.toContain(
        name,
      )
    expect(finishInit).toContain("observeDecorators('edit'")
    expect(finishInit).toContain("observeDecorators('preview'")
  })

  it('registry names are unique and every observing entry targets a live surface', () => {
    expect(new Set(decoratorNames).size).toBe(decoratorNames.length)
    for (const d of CONTENT_DECORATORS) {
      if (d.observe)
        expect(
          d.stages.has('edit') || d.stages.has('preview'),
          `${d.name} observes but names no live stage`,
        ).toBe(true)
      if (d.decorate)
        expect(d.stages.has('overlay'), `${d.name} decorates the overlay`).toBe(
          true,
        )
    }
  })

  const decoratorMarkers = CONTENT_DECORATORS.flatMap((d) =>
    d.parityMarkers.map((m) => ({ name: d.name, m })),
  )

  it('names only registered markers', () => {
    for (const { name, m } of decoratorMarkers)
      expect(PARITY_MARKERS, `${name} -> ${m}`).toHaveProperty(m)
  })

  it('every decorator marker the canon can reach is expected by some element', () => {
    // A decorator marker no element expects can never be observed by the gate (a dead check), unless
    // the canon cannot reach the decorator (documented: code-ref chips need a workspace file,
    // soft-break marks need reflow — covered by the reflow configuration, not an `expect` — and wiki
    // chips need a wiki file; the wiki-chip corpus test pins the host string transform instead).
    const unreachable = new Set(['code-ref-chip', 'softbreak', 'wiki-chip'])
    const expected = new Set(PARITY_ELEMENTS.flatMap((e) => e.expectMarkers))
    for (const { m } of decoratorMarkers)
      if (!unreachable.has(m))
        expect(expected, `marker "${m}" is expected by no element`).toContain(m)
  })
})

describe('allow-list hygiene (§E 7)', () => {
  const raw: unknown = JSON.parse(readFileSync(ALLOW_PATH, 'utf8'))

  it('is schema-valid with exact properties and a known kind/pair/task on every entry', () => {
    expect(validateAllowList(raw)).toEqual([])
  })

  it('names configurations that exist in the matrix', () => {
    const ids = new Set(PARITY_CONFIGS.map((c) => c.id))
    for (const e of raw as AllowedDifference[])
      for (const t of [e.theme].flat())
        expect(t === '*' || ids.has(t), `unknown theme "${t}"`).toBe(true)
  })

  it('every entry names a step the task file defines (or the follow-up / accepted buckets)', () => {
    const task = readFileSync(TASK_PATH, 'utf8')
    expect(existsSync(TASK_PATH)).toBe(true)
    for (const e of raw as AllowedDifference[]) {
      const step = /^532 step (\d+)$/.exec(e.task)?.[1]
      if (step)
        expect(task, `step ${step}`).toMatch(new RegExp(`\\*\\*${step}\\. `))
      else
        expect(e.task).toMatch(
          /^(532 follow-up|accepted \(user, \d{4}-\d{2}-\d{2}\))$/,
        )
    }
  })

  it('only names properties the snapshot can produce', () => {
    const prefixes =
      /^(present|shape|rect\.[A-Za-z]+|style\.[a-z-]+|text\.[a-z-]+)$/
    for (const e of raw as AllowedDifference[]) {
      const ok =
        prefixes.test(e.property) ||
        (e.property.startsWith('marker.') &&
          e.property.slice('marker.'.length) in PARITY_MARKERS)
      expect(ok, `${e.kind} ${e.property}`).toBe(true)
    }
  })
})

describe('parity comparator + allow-list semantics', () => {
  const cell = (over: Record<string, unknown> = {}) => ({
    rect: { height: 20, gapBefore: 10, left: 0, width: 600, firstGlyphX: 52 },
    style: { 'margin-bottom': '16px', 'padding-left': '28px' },
    text: { 'line-height': '22.4px' },
    marker: { hljs: 0 },
    shape: 'ul(li)',
    ...over,
  })
  const snap = (c: ReturnType<typeof cell>): StageSnapshot => ({
    root: cell(),
    cells: { 'ul-tight': c },
  })
  const run = (cand: ReturnType<typeof cell>, theme = 'T') => ({
    theme,
    stages: {
      ir: flattenSnapshot(snap(cell())),
      preview: flattenSnapshot(snap(cand)),
    },
  })
  const entry = (over: Partial<AllowedDifference> = {}): AllowedDifference => ({
    theme: 'T',
    stagePair: 'ir>preview',
    kind: 'ul-tight',
    property: 'style.padding-left',
    reason: 'x',
    task: '532 step 3',
    values: ['"28px" -> "40px"'],
    ...over,
  })
  const drift = cell({
    style: { 'margin-bottom': '16px', 'padding-left': '40px' },
  })

  it('reports each differing cell, none when the stages agree', () => {
    expect(diffRun(run(cell()))).toEqual([])
    const d = diffRun(run(drift))
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({
      stagePair: 'ir>preview',
      kind: 'ul-tight',
      property: 'style.padding-left',
      expected: '28px',
      actual: '40px',
    })
  })

  it('applies the rect tolerance of the pair (1px for ir>preview) but not to styles', () => {
    const within = cell({ rect: { ...cell().rect, height: 20.9 } })
    const beyond = cell({ rect: { ...cell().rect, height: 21.2 } })
    expect(diffRun(run(within))).toEqual([])
    expect(diffRun(run(beyond)).map((x) => x.property)).toEqual(['rect.height'])
  })

  it('does not compare rects for preview>sv', () => {
    const wide = cell({ rect: { ...cell().rect, height: 500, width: 100 } })
    const r = {
      theme: 'T',
      stages: {
        preview: flattenSnapshot(snap(cell())),
        sv: flattenSnapshot(snap(wide)),
      },
    }
    expect(diffRun(r)).toEqual([])
  })

  it('an entry suppresses exactly its cell', () => {
    const v = evaluateRuns([run(drift)], [entry()])
    expect(v).toMatchObject({ suppressed: 1, unexplained: [], stale: [] })
    const other = evaluateRuns(
      [run(drift)],
      [entry({ property: 'style.margin-bottom' })],
    )
    expect(other.unexplained).toHaveLength(1)
    expect(other.stale).toHaveLength(1)
  })

  it('a STALE entry (suppresses nothing) fails the run', () => {
    const v = evaluateRuns([run(cell())], [entry()])
    expect(v.stale).toHaveLength(1)
    expect(v.unexplained).toHaveLength(0)
  })

  it('an entry for a configuration that was not run is not stale', () => {
    const v = evaluateRuns([run(cell())], [entry({ theme: 'OTHER' })])
    expect(v.stale).toEqual([])
  })

  it('`*` and theme lists match; `*` must match somewhere in the run', () => {
    const runs = [run(drift, 'A'), run(cell(), 'B')]
    expect(evaluateRuns(runs, [entry({ theme: '*' })])).toMatchObject({
      suppressed: 1,
      stale: [],
    })
    expect(evaluateRuns(runs, [entry({ theme: ['A', 'B'] })]).stale).toEqual([])
    expect(
      evaluateRuns(runs, [entry({ theme: ['B'] })]).unexplained,
    ).toHaveLength(1)
  })

  it('a pinned string cell accepts only the measured value: 40px -> 44px is red', () => {
    const moved = cell({
      style: { 'margin-bottom': '16px', 'padding-left': '44px' },
    })
    expect(evaluateRuns([run(drift)], [entry()]).unexplained).toHaveLength(0)
    const v = evaluateRuns([run(moved)], [entry()])
    expect(v.unexplained).toHaveLength(1)
    expect(v.unexplained[0]).toMatchObject({ expected: '28px', actual: '44px' })
    expect(v.stale).toEqual([])
  })

  it('a pinned numeric cell accepts its [min, max] delta (+slack) and nothing beyond', () => {
    const at = (h: number) => cell({ rect: { ...cell().rect, height: h } })
    const e = entry({
      property: 'rect.height',
      values: undefined,
      delta: [-6, -4],
    })
    const judge = (h: number) => evaluateRuns([run(at(h))], [e]).unexplained
    expect(judge(20 - 5)).toHaveLength(0)
    expect(judge(20 - 6.9)).toHaveLength(0) // within 1px slack of -6
    expect(judge(20 - 8)).toHaveLength(1) // the drift grew
    expect(judge(20 - 2)).toHaveLength(1) // ...or shrank off the pin
  })

  it('a numeric pin does not excuse a non-numeric change of the same cell', () => {
    const e = entry({ values: undefined, delta: [-6, -4] })
    expect(evaluateRuns([run(drift)], [e]).unexplained).toHaveLength(1)
  })

  it('validateAllowList requires a pin and well-formed pins', () => {
    const errs = validateAllowList([
      entry({ values: undefined }),
      entry({ property: 'rect.height', values: undefined, delta: [3, 1] }),
      entry({ property: 'shape', values: [] }),
    ])
    expect(errs.join('\n')).toMatch(/must pin its value/)
    expect(errs.join('\n')).toMatch(/delta must be \[min, max\]/)
    expect(errs.join('\n')).toMatch(/values must be a non-empty/)
  })

  it('a kind present in one stage only is a `present` difference', () => {
    const r = run(cell())
    delete (r.stages.preview as Record<string, unknown>)['ul-tight']
    const d = diffRun(r).filter((x) => x.kind === 'ul-tight')
    expect(d).toMatchObject([
      { property: 'present', expected: 'yes', actual: 'no' },
    ])
  })

  it('validateAllowList rejects a wildcard property, an unknown kind and a task-less entry', () => {
    const errs = validateAllowList([
      entry({ property: 'style.*' }),
      entry({ kind: 'nope', property: 'shape' }),
      { ...entry({ property: 'present' }), task: 'someday' },
    ])
    expect(errs.join('\n')).toMatch(/no wildcard/)
    expect(errs.join('\n')).toMatch(/unknown kind nope/)
    expect(errs.join('\n')).toMatch(/task must be/)
  })
})

describe('configuration matrix', () => {
  it('has one row per registered content theme plus the 5 extra configurations (10 total)', () => {
    const ids = PARITY_CONFIGS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const t of CONTENT_THEMES) expect(ids).toContain(t.value)
    expect(PARITY_CONFIGS).toHaveLength(CONTENT_THEMES.length + 5)
    expect(PARITY_CONFIGS.filter((c) => c.fast)).toHaveLength(1)
  })

  it('the fast configuration is `auto` under Default Dark Modern = vscode-dark-2026', () => {
    const fast = PARITY_CONFIGS.find((c) => c.fast)
    expect(fast?.settings['vmarkd.theme.content']).toBe('auto')
    expect(fast && resolveParityConfig(fast).contentTheme).toBe(
      'vscode-dark-2026',
    )
  })

  it('auto under Monokai and High Contrast stays on the no-content-theme path', () => {
    for (const id of ['auto-monokai', 'auto-high-contrast']) {
      const c = PARITY_CONFIGS.find((x) => x.id === id)
      expect(c && resolveParityConfig(c).contentTheme).toBe('auto')
    }
  })
})
