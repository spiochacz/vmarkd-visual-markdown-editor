// Pure checks behind test/backend/parity-geometry-lint.test.ts (task 532 §E tests 1-3). Kept separate
// from the test so the RED proofs can feed them deliberately bad CSS.
import { type CssRule, parseCssRules } from './css-rules'

/** A selector scoped to ONE surface (the overlay or an editor/Preview mode), not to the content. */
const SURFACE_SELECTOR =
  /\.vditor-preview|\.vditor-ir(__(preview|node))?\b|\.vditor-wysiwyg|\.vditor-sv|#vmarkd-prerender/

/** Declarations that set the geometry of content (task 532 §A). */
const GEOMETRY_DECL =
  /(^|[;\s{])((margin|padding)(-[a-z-]+)?|line-height|font-size|font-family|((min|max)-)?(width|height)|text-indent|border(-(top|right|bottom|left))?(-width)?|(row-|column-)?gap)\s*:/

/** The tag a surface-scoped geometry rule must carry, with a non-empty reason. */
const SURFACE_ONLY_TAG = /(^|\n)\s*@surface-only:\s*\S/

const isSurfaceScoped = (r: CssRule) =>
  r.selector.split(',').some((s) => SURFACE_SELECTOR.test(s))

/** Rules scoped to a surface that declare geometry — tagged or not. */
export function surfaceGeometryRules(css: string): {
  rule: CssRule
  tagged: boolean
}[] {
  return parseCssRules(css)
    .filter((r) => isSurfaceScoped(r) && GEOMETRY_DECL.test(r.body))
    .map((rule) => ({ rule, tagged: SURFACE_ONLY_TAG.test(rule.leadComment) }))
}

/** Theme-file rules whose selector names a surface (a theme may only set tokens / content). */
export function surfaceScopedRules(css: string): CssRule[] {
  return parseCssRules(css).filter(isSurfaceScoped)
}

/** Geometry tokens a theme declares (`--vmarkd-geo-x:` custom-property declarations). */
export function declaredGeoTokens(css: string): Set<string> {
  const out = new Set<string>()
  for (const m of css.matchAll(/(--vmarkd-geo-[a-z-]+)\s*:/g)) out.add(m[1])
  return out
}

/** The `@profile: default` opt-out, only honoured inside the file's leading comment block. */
export function declaresDefaultProfile(css: string): boolean {
  const head = css.slice(0, css.indexOf('*/') + 2)
  return /@profile:\s*default\b/.test(head)
}
