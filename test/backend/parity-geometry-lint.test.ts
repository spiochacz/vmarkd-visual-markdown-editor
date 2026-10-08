import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs build helper, no type declarations
import { GEO_TOKENS } from '../../scripts/vditor-geometry-patch.mjs'
import {
  declaredGeoTokens,
  declaresDefaultProfile,
  surfaceGeometryRules,
  surfaceScopedRules,
} from '../parity/geometry-lint'

// Task 532 §E tests 1-3 — the structural guard that keeps content geometry a property of the CONTENT.
// (1) every theme declares the whole --vmarkd-geo-* set or opts into `@profile: default`; (2) a theme
// file never scopes to a surface; (3) main.css surface-scoped rules that set geometry are tagged.
const ROOT = path.join(__dirname, '..', '..')
const THEMES_DIR = path.join(ROOT, 'media', 'markdown-themes')
const FULL_SET = (GEO_TOKENS as [string, string][]).map(([name]) => name)

const themeFiles = () =>
  readdirSync(THEMES_DIR)
    .filter((f) => f.endsWith('.css'))
    .sort()
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), 'utf8')

// Missing tokens of a theme file; empty when it is complete or opted out. Exported shape for RED proofs.
function missingGeoTokens(css: string): string[] {
  if (declaresDefaultProfile(css)) return []
  const have = declaredGeoTokens(css)
  return FULL_SET.filter((t) => !have.has(t))
}

describe('theme files declare the geometry token set (task 532 §E1)', () => {
  it('there are theme files to check', () => {
    expect(themeFiles().length).toBeGreaterThanOrEqual(5)
  })

  it.each(themeFiles())(
    '%s declares every --vmarkd-geo-* token or "@profile: default"',
    (file) => {
      expect(missingGeoTokens(read('media', 'markdown-themes', file))).toEqual(
        [],
      )
    },
  )

  it.each(themeFiles())('%s declares only known geometry tokens', (file) => {
    const unknown = [
      ...declaredGeoTokens(read('media', 'markdown-themes', file)),
    ].filter((t) => !FULL_SET.includes(t))
    expect(unknown).toEqual([])
  })

  it('light/dark twins declare identical geometry tokens and values', () => {
    const geo = (file: string) =>
      [
        ...read('media', 'markdown-themes', file).matchAll(
          /(--vmarkd-geo-[a-z0-9-]+)\s*:\s*([^;]+);/g,
        ),
      ]
        .map((m) => `${m[1]}:${m[2].trim()}`)
        .sort()
    expect(geo('vscode-light-2026.css')).toEqual(geo('vscode-dark-2026.css'))
    expect(geo('github-markdown-light.css')).toEqual(
      geo('github-markdown-dark.css'),
    )
  })

  it('the check itself fails a theme that silently inherits', () => {
    expect(missingGeoTokens('.markdown-body { color: red }')).toEqual(FULL_SET)
    expect(
      missingGeoTokens('body { --vmarkd-geo-block-gap: 16px }'),
    ).not.toContain('--vmarkd-geo-block-gap')
    expect(missingGeoTokens('/*! x\n * @profile: default\n */ a{}')).toEqual([])
  })
})

describe('heading sizes are profile tokens (task 532 step 3b)', () => {
  const css = read('media-src', 'src', 'main.css')

  it.each([1, 2, 3, 4, 5, 6])(
    'the h%i gutter marker line box reads the same --vmarkd-geo-hN token as the heading font-size',
    (n) => {
      const rule = css
        .split('\n')
        .find((l) => l.includes(`> h${n}::before { line-height:`))
      expect(rule, `h${n} marker rule`).toBeDefined()
      expect(rule).toContain(`var(--vmarkd-geo-h${n},`)
      expect(rule).toContain('var(--vmarkd-geo-heading-lh,')
    },
  )

  it('heading size tokens are unitless numbers (the patched rule multiplies them by 1em; `2em` would break the calc)', () => {
    const sources = [
      ...themeFiles().map((f) => [f, read('media', 'markdown-themes', f)]),
      ['main.css', css],
    ]
    for (const [name, src] of sources)
      expect(
        [...src.matchAll(/--vmarkd-geo-h[1-6]\s*:\s*([^;]+);/g)]
          .map((m) => m[1].trim())
          .filter((v) => !/^\d*\.?\d+$/.test(v)),
        name,
      ).toEqual([])
  })

  it('no theme file sets a heading font-size directly (the token does)', () => {
    for (const f of themeFiles())
      expect(read('media', 'markdown-themes', f), f).not.toMatch(
        /\bh[1-6]\b[^{]*\{[^}]*font-size/,
      )
  })
})

describe('theme files do not scope to a surface (task 532 §E2)', () => {
  const contentThemeDir = existsSync(
    path.join(ROOT, 'media', 'vditor', 'dist', 'css', 'content-theme'),
  )
    ? path.join(ROOT, 'media', 'vditor', 'dist', 'css', 'content-theme')
    : path.join(
        ROOT,
        'media-src',
        'node_modules',
        'vditor',
        'dist',
        'css',
        'content-theme',
      )
  const targets: [string, string][] = [
    ...themeFiles().map((f): [string, string] => [
      `markdown-themes/${f}`,
      path.join(THEMES_DIR, f),
    ]),
    ...readdirSync(contentThemeDir)
      .filter((f) => f.endsWith('.css'))
      .map((f): [string, string] => [
        `content-theme/${f}`,
        path.join(contentThemeDir, f),
      ]),
  ]

  it.each(targets)('%s has no surface selector', (_label, file) => {
    const offenders = surfaceScopedRules(readFileSync(file, 'utf8')).map(
      (r) => `line ${r.line}: ${r.selector}`,
    )
    expect(
      offenders,
      'a theme may only set tokens / content, never a surface',
    ).toEqual([])
  })

  it('the check itself flags a surface-scoped theme rule', () => {
    const bad = '.markdown-body .vditor-preview .vditor-reset { color: red }'
    expect(surfaceScopedRules(bad)).toHaveLength(1)
    expect(surfaceScopedRules('#vmarkd-prerender p{}')).toHaveLength(1)
    expect(surfaceScopedRules('.vditor-ir__link{}')).toHaveLength(0)
    expect(surfaceScopedRules('.markdown-body p{}')).toHaveLength(0)
  })
})

// The tagged set can only SHRINK: step 3 deletes the task-110 rules and generalises the code-box
// mirror. Lower the number when you remove a tagged rule; never raise it to admit a new one — set a
// --vmarkd-geo-* token instead (or, for genuinely geometry-neutral edit chrome, tag it AND justify it).
const MAX_TAGGED_SURFACE_RULES = 35

describe('main.css surface-scoped geometry rules are tagged (task 532 §E3)', () => {
  const rules = surfaceGeometryRules(read('media-src', 'src', 'main.css'))

  it('finds the surface-scoped geometry rules (parser sanity)', () => {
    expect(rules.length).toBeGreaterThan(20)
  })

  it('every one carries an @surface-only: <reason> tag', () => {
    const untagged = rules
      .filter((r) => !r.tagged)
      .map((r) => `main.css:${r.rule.line}  ${r.rule.selector.slice(0, 90)}`)
    expect(
      untagged,
      'Surface-scoped rule that sets margin/padding/line-height/font-*/width/height/gap/...: put the value in a --vmarkd-geo-* token (all stages), or tag the rule `/* @surface-only: <why it is geometry-neutral edit chrome> */`.',
    ).toEqual([])
  })

  it('the tagged set only shrinks (ratchet)', () => {
    // toBe, not <=: deleting a tagged rule must lower the constant, so a freed slot can't be reused.
    expect(rules.filter((r) => r.tagged).length).toBe(MAX_TAGGED_SURFACE_RULES)
  })

  it('the check itself flags an untagged rule and accepts a tagged one', () => {
    const bad = '.vditor-preview .vditor-reset p { margin-bottom: 0.7em }'
    expect(surfaceGeometryRules(bad).map((r) => r.tagged)).toEqual([false])
    const ok = `/* @surface-only: edit chrome */\n${bad}`
    expect(surfaceGeometryRules(ok).map((r) => r.tagged)).toEqual([true])
    // a tag with no reason, or a tag on a DIFFERENT (earlier) rule, does not count
    expect(
      surfaceGeometryRules(`/* @surface-only: */\n${bad}`).map((r) => r.tagged),
    ).toEqual([false])
    expect(
      surfaceGeometryRules(`/* @surface-only: x */\na{color:red}\n${bad}`).map(
        (r) => r.tagged,
      ),
    ).toEqual([false])
    // a content-scoped rule and a non-geometry surface rule are out of scope
    expect(surfaceGeometryRules('.vditor-reset p{margin:0}')).toEqual([])
    expect(surfaceGeometryRules('.vditor-preview a{color:red}')).toEqual([])
  })
})

// Task 532 step 9 — the link colour is ONE token on every stage: each theme file declares
// --vmarkd-link, and main.css feeds it to the rendered anchors under `auto` (named themes set their
// own `.markdown-body a` to the same value).
describe('link colour is one token (task 532 step 9)', () => {
  it.each(themeFiles())('%s declares --vmarkd-link', (file) => {
    expect(read('media', 'markdown-themes', file)).toMatch(
      /--vmarkd-link\s*:\s*[^;]+;/,
    )
  })

  it('main.css applies --vmarkd-link to the rendered anchors under auto', () => {
    expect(read('media-src', 'src', 'main.css')).toMatch(
      /body\[data-use-vscode-theme-color="1"\] \.vditor-reset a:not\(\.wiki-link-chip\)\s*\{\s*color:\s*var\(--vmarkd-link\);/,
    )
  })
})
