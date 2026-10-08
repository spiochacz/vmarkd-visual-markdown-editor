// Task 532 step 2 — make Vditor's content GEOMETRY custom-property driven, same shape as
// `varifyVditorPalette` does for colours. Each declaration that sets the rhythm of the document
// (leading, block gap, list indent, heading margins, code-box padding) is rewritten in the COPIED
// `index.css` to `var(--vmarkd-geo-*, <Vditor's own value>)`. With no token set the output renders
// exactly as before; a theme profile changes ALL stages at once by setting the token (ADR-0003 row
// "Geometry value", ADR-0004 mechanism 2). No `!important` is added anywhere.
//
// Every anchor must occur EXACTLY once in the stock file: a Vditor bump that moves, duplicates or
// drops one fails the build loudly instead of silently reverting the token.
// Tests: test/backend/vditor-geometry-patch.test.ts.

/** [token, Vditor default] — the full set; a theme either declares all of it or `@profile: default`. */
export const GEO_TOKENS = [
  ['--vmarkd-geo-line-height', '1.5'],
  ['--vmarkd-geo-block-gap', '16px'],
  ['--vmarkd-geo-list-indent', '2em'],
  ['--vmarkd-geo-heading-mt', '24px'],
  ['--vmarkd-geo-heading-mb', '16px'],
  ['--vmarkd-geo-heading-lh', '1.25'],
  ['--vmarkd-geo-code-pad', '0.5em'],
  ['--vmarkd-geo-code-radius', '5px'],
  // Code BLOCK leading (pre + pre > code), never inline code. Vditor has no declaration of its own
  // (the block inherits the prose leading), so the two rules below ADD one.
  ['--vmarkd-geo-code-lh', '1.5'],
  // `hr` vertical margin (and the IR/WYSIWYG footnote rule that mimics it): GitHub 24px, VS Code's native preview leaves the UA 0.5em.
  ['--vmarkd-geo-hr-gap', '24px'],
]

/** [label, find, replace] — each `find` must occur exactly once in the stock index.css. */
export const VDITOR_GEOMETRY_PATCHES = [
  [
    '.vditor-reset line-height',
    '  overflow: auto;\n  line-height: 1.5;\n  font-size:',
    '  overflow: auto;\n  line-height: var(--vmarkd-geo-line-height, 1.5);\n  font-size:',
  ],
  [
    'ul/ol indent + gap',
    '.vditor-reset ul,\n.vditor-reset ol {\n  padding-left: 2em;\n  margin-top: 0;\n  margin-bottom: 16px;\n}',
    '.vditor-reset ul,\n.vditor-reset ol {\n  padding-left: var(--vmarkd-geo-list-indent, 2em);\n  margin-top: 0;\n  margin-bottom: var(--vmarkd-geo-block-gap, 16px);\n}',
  ],
  [
    'li > p gap',
    '.vditor-reset li p {\n  margin-top: 16px;\n}',
    '.vditor-reset li p {\n  margin-top: var(--vmarkd-geo-block-gap, 16px);\n}',
  ],
  [
    'heading margins + line-height',
    '  margin-top: 24px;\n  margin-bottom: 16px;\n  font-weight: 600;\n  line-height: 1.25;\n}',
    '  margin-top: var(--vmarkd-geo-heading-mt, 24px);\n  margin-bottom: var(--vmarkd-geo-heading-mb, 16px);\n  font-weight: 600;\n  line-height: var(--vmarkd-geo-heading-lh, 1.25);\n}',
  ],
  [
    'p gap',
    '.vditor-reset p {\n  margin-top: 0;\n  margin-bottom: 16px;\n}',
    '.vditor-reset p {\n  margin-top: 0;\n  margin-bottom: var(--vmarkd-geo-block-gap, 16px);\n}',
  ],
  [
    'blockquote gap',
    '  border-left: 0.25em solid #eaecef;\n  margin: 0 0 16px 0;\n}',
    '  border-left: 0.25em solid #eaecef;\n  margin: 0 0 var(--vmarkd-geo-block-gap, 16px) 0;\n}',
  ],
  [
    'table gap',
    '  empty-cells: show;\n  margin-bottom: 16px;\n',
    '  empty-cells: show;\n  margin-bottom: var(--vmarkd-geo-block-gap, 16px);\n',
  ],
  [
    'pre > code box',
    '.vditor-reset pre > code {\n  margin: 0;\n  font-size: 85%;\n  padding: 0.5em;\n  border-radius: 5px;\n',
    '.vditor-reset pre > code {\n  margin: 0;\n  font-size: 85%;\n  padding: var(--vmarkd-geo-code-pad, 0.5em);\n  border-radius: var(--vmarkd-geo-code-radius, 5px);\n  line-height: var(--vmarkd-geo-code-lh, 1.5);\n',
  ],
  [
    'hr margin',
    '.vditor-reset hr {\n  height: 2px;\n  padding: 0;\n  margin: 24px 0;\n',
    '.vditor-reset hr {\n  height: 2px;\n  padding: 0;\n  margin: var(--vmarkd-geo-hr-gap, 24px) 0;\n',
  ],
  [
    'ir footnotes rule (hr stand-in)',
    '.vditor-ir div[data-type="footnotes-block"] {\n  border-top: 2px solid var(--heading-border-color);\n  padding-top: 24px;\n  margin-top: 24px;\n}',
    '.vditor-ir div[data-type="footnotes-block"] {\n  border-top: 2px solid var(--heading-border-color);\n  padding-top: var(--vmarkd-geo-hr-gap, 24px);\n  margin-top: var(--vmarkd-geo-hr-gap, 24px);\n}',
  ],
  [
    'wysiwyg footnotes rule (hr stand-in)',
    '.vditor-wysiwyg div[data-type="footnotes-block"] {\n  border-top: 2px solid var(--heading-border-color);\n  padding-top: 24px;\n  margin-top: 24px;\n}',
    '.vditor-wysiwyg div[data-type="footnotes-block"] {\n  border-top: 2px solid var(--heading-border-color);\n  padding-top: var(--vmarkd-geo-hr-gap, 24px);\n  margin-top: var(--vmarkd-geo-hr-gap, 24px);\n}',
  ],
  [
    'pre leading',
    '.vditor-reset pre {\n  margin: 1em 0;\n}',
    '.vditor-reset pre {\n  margin: 1em 0;\n  line-height: var(--vmarkd-geo-code-lh, 1.5);\n}',
  ],
]

const countOf = (src, needle) => src.split(needle).length - 1

/** Apply every geometry rewrite to Vditor's index.css text; throws on a missing/duplicated anchor. */
export function varifyGeometryCss(css) {
  let out = css
  for (const [label, find, replace] of VDITOR_GEOMETRY_PATCHES) {
    const n = countOf(out, find)
    if (n !== 1) {
      throw new Error(
        `[geometry] ${label}: anchor ${n === 0 ? 'not found' : `matched ${n} times (expected 1)`} in vditor index.css — Vditor changed; update scripts/vditor-geometry-patch.mjs`,
      )
    }
    out = out.replace(find, () => replace)
  }
  return out
}
