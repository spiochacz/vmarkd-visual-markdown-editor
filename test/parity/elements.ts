// Task 532 — the element registry behind the cross-stage parity gate (test/parity/*).
//
// The same document is drawn by five stages (instant-paint overlay · IR · WYSIWYG · full Preview ·
// split preview pane) that each have their own CSS scope, DOM producer and decoration pass. The gate
// snapshots every element KIND below in every stage and compares the stages pairwise. This file is
// the ONE list of kinds: the canonical fixture (test/vscode-e2e/fixtures/parity-canon.md) is
// GENERATED from it (scripts/gen-parity-fixture.mjs), so a kind cannot exist without a probe and a
// probe cannot exist without a fixture snippet.
//
// Dependency-free and test-only (lives under test/, not src/: nothing in the shipped extension reads it):
// the vitest suite, the chromium harness and the real-VS-Code specs import it.

export type ParityStage = 'overlay' | 'ir' | 'wysiwyg' | 'preview' | 'sv'

/** `edit` = overlay/ir/wysiwyg (a `pre.vditor-reset`), `preview` = the full Preview overlay + the sv right pane. */
export type ParityFamily = 'edit' | 'preview'

export function stageFamily(stage: ParityStage): ParityFamily {
  return stage === 'preview' || stage === 'sv' ? 'preview' : 'edit'
}

/**
 * How the gate finds an element's box in a stage root. Two shapes:
 *  - `anchor`: a unique token in the snippet's text; the probe takes the first text node containing it
 *    and walks UP to the nearest ancestor matching `edit` / `preview` (a selector per stage family,
 *    because the same block is `div[data-type=code-block]` while editing and `pre` in a Preview).
 *  - `select`: no usable text (hr, a rendered diagram, math) — the first element matching the
 *    selector for the family.
 */
type ParityProbe =
  | { anchor: string; edit: string; preview: string }
  | { select: { edit: string; preview: string } }

/**
 * Decoration markers the gate counts under each element, per stage. A marker is something a
 * decorator ADDS to the plain Lute output (so a stage the decorator does not reach shows count 0).
 * Name → CSS selector. Keep the names stable: they are allow-list keys (`marker.<name>`).
 */
export const PARITY_MARKERS: Readonly<Record<string, string>> = {
  hljs: 'code.hljs, pre.hljs, .hljs',
  'hljs-token': '.hljs span[class*="hljs-"]',
  'callout-title': '.vmarkd-callout__title',
  'callout-type': 'blockquote[class*="vmarkd-callout"]',
  'html-comment': '.vmarkd-comment',
  'code-ref-chip': '.vmarkd-code-ref-chip, code[data-code-ref]',
  'wiki-chip': '.wiki-link-chip',
  softbreak: '.vmarkd-softbreak',
  svg: 'svg',
  katex: '.katex',
  checkbox: 'input[type="checkbox"]',
}

export interface ParityElement {
  /** Stable id; allow-list key. */
  kind: string
  /** Markdown that goes into the canonical fixture. Must contain `anchor` when the probe uses one. */
  snippet: string
  probe: ParityProbe
  /**
   * Markers the LIVE editor (IR) is expected to show on this element — the gate refuses to run if the
   * live IR does not carry them (a registry/DOM sanity check: the marker names must stay true to what
   * the product draws). Stages that lack them are exactly the overlay drift the allow-list records.
   */
  expectMarkers: readonly string[]
  /**
   * Skip the structure signature: dual-node blocks (code, math, html, diagrams) wrap their render in
   * Vditor edit chrome the Preview does not have, so a tag-path comparison would only restate that.
   */
  shape?: false
  /** Engine id for elements that need an async renderer to settle before the snapshot. */
  engine?: 'mermaid' | 'd2'
}

const blockProbe = (
  anchor: string,
  edit: string,
  preview = edit,
): ParityProbe => ({ anchor, edit, preview })

// Order = order in the fixture. Anchors are unique `PX…` tokens and none is a prefix of another
// (a unit test enforces both).
export const PARITY_ELEMENTS: readonly ParityElement[] = [
  {
    kind: 'frontmatter',
    shape: false,
    snippet: '---\ntitle: PXfrontmatter\n---',
    probe: blockProbe(
      'PXfrontmatter',
      'div[data-type="yaml-front-matter"]',
      'pre',
    ),
    expectMarkers: [],
  },
  ...([1, 2, 3, 4, 5, 6] as const).map(
    (n): ParityElement => ({
      kind: `h${n}`,
      snippet: `${'#'.repeat(n)} PXh${n}x heading level ${n}`,
      probe: blockProbe(`PXh${n}x`, `h${n}`),
      expectMarkers: [],
    }),
  ),
  {
    kind: 'paragraph',
    snippet:
      'PXpara first line of a soft-wrapped paragraph\nsecond line of the same paragraph\nthird line closes it.',
    probe: blockProbe('PXpara', 'p'),
    expectMarkers: [],
  },
  {
    kind: 'hard-break',
    snippet: 'PXbreak line one  \nline two after a hard break.',
    probe: blockProbe('PXbreak', 'p'),
    expectMarkers: [],
  },
  {
    kind: 'bold',
    snippet: 'Inline **PXbold** text.',
    probe: blockProbe('PXbold', 'strong'),
    expectMarkers: [],
  },
  {
    kind: 'em',
    snippet: 'Inline *PXem* text.',
    probe: blockProbe('PXem', 'em'),
    expectMarkers: [],
  },
  {
    kind: 'strike',
    snippet: 'Inline ~~PXstrike~~ text.',
    probe: blockProbe('PXstrike', 'del, s'),
    expectMarkers: [],
  },
  {
    kind: 'inline-code',
    snippet: 'Inline `PXicode` text.',
    probe: blockProbe('PXicode', 'code'),
    expectMarkers: [],
  },
  {
    kind: 'link',
    snippet: 'Inline [PXlink](https://example.com/) text.',
    probe: blockProbe('PXlink', 'a, span.vditor-ir__link', 'a'),
    expectMarkers: [],
  },
  {
    kind: 'autolink',
    snippet: 'Inline <https://example.org/PXauto> text.',
    probe: blockProbe('example.org/PXauto', 'a, span.vditor-ir__link', 'a'),
    expectMarkers: [],
  },
  {
    kind: 'image',
    snippet:
      'Inline ![PXimg](data:image/gif;base64,R0lGODlhAQABAIAAAMLCwgAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==) image.',
    probe: {
      select: { edit: 'img[alt="PXimg"]', preview: 'img[alt="PXimg"]' },
    },
    expectMarkers: [],
  },
  {
    kind: 'ul-tight',
    snippet: '- PXtight one\n- PXtight two\n- PXtight three',
    probe: blockProbe('PXtight', 'ul'),
    expectMarkers: [],
  },
  {
    kind: 'ul-loose',
    snippet: '* PXloose one\n\n* PXloose two\n\n* PXloose three',
    probe: blockProbe('PXloose', 'ul'),
    expectMarkers: [],
  },
  {
    kind: 'ul-nested',
    snippet:
      '+ PXnest outer one\n\n  - PXnest inner a\n  - PXnest inner b\n\n+ PXnest outer two',
    probe: blockProbe('PXnest', 'ul'),
    expectMarkers: [],
  },
  {
    kind: 'ol',
    snippet: '1. PXordered one\n2. PXordered two\n3. PXordered three',
    probe: blockProbe('PXordered', 'ol'),
    expectMarkers: [],
  },
  {
    kind: 'task-list',
    snippet: '- [ ] PXtask open\n- [x] PXtask done',
    probe: blockProbe('PXtask', 'ul'),
    expectMarkers: ['checkbox'],
  },
  {
    kind: 'blockquote',
    snippet: '> PXquote plain blockquote\n> second line of the quote.',
    probe: blockProbe('PXquote', 'blockquote'),
    expectMarkers: [],
  },
  {
    kind: 'blockquote-nested',
    snippet: '> PXqnest outer\n>\n> > PXqnest inner',
    probe: blockProbe('PXqnest', 'blockquote'),
    expectMarkers: [],
  },
  {
    kind: 'callout-note',
    snippet: '> [!NOTE]\n> PXcnote body of a note callout.',
    probe: blockProbe('PXcnote', 'blockquote'),
    expectMarkers: ['callout-title', 'callout-type'],
  },
  {
    kind: 'callout-titled',
    snippet: '> [!TIP] PXctitle custom title\n> Body of a titled tip callout.',
    probe: blockProbe('PXctitle', 'blockquote'),
    expectMarkers: ['callout-title', 'callout-type'],
  },
  {
    kind: 'code-fence',
    shape: false,
    snippet:
      '```ts\n// PXfence\nconst a: number = 1\nfunction f(x: number) {\n  return x + a\n}\n```',
    probe: blockProbe('PXfence', 'div[data-type="code-block"]', 'pre'),
    expectMarkers: ['hljs', 'hljs-token'],
  },
  {
    kind: 'code-indented',
    shape: false,
    snippet: 'Text before an indented block.\n\n    PXindent code line',
    probe: blockProbe('PXindent', 'div[data-type="code-block"]', 'pre'),
    expectMarkers: [],
  },
  {
    kind: 'math-inline',
    snippet: 'Inline math $PXimath$ in a sentence.',
    probe: {
      select: {
        edit: 'span.language-math',
        preview: 'span.language-math',
      },
    },
    expectMarkers: ['katex'],
  },
  {
    kind: 'math-block',
    shape: false,
    snippet: '$$\nPXbmath = 1\n$$',
    probe: {
      select: {
        edit: 'div[data-type="math-block"]',
        preview: 'div.language-math',
      },
    },
    expectMarkers: ['katex'],
  },
  {
    kind: 'table',
    snippet:
      '| PXtable A | B | C |\n| :-- | :-: | --: |\n| left | center | right |\n| one | two | three |',
    probe: blockProbe('PXtable', 'table'),
    expectMarkers: [],
  },
  {
    kind: 'hr',
    snippet: '***',
    probe: { select: { edit: 'hr', preview: 'hr' } },
    expectMarkers: [],
  },
  {
    kind: 'footnote-ref',
    snippet: 'Footnote reference PXfnref[^pxfn] in prose.',
    probe: blockProbe('PXfnref', 'p'),
    expectMarkers: [],
  },
  {
    kind: 'html-comment',
    shape: false,
    snippet: '<!-- PXcomment hidden note -->',
    probe: {
      select: {
        edit: 'div[data-type="html-block"]',
        preview: '.vmarkd-comment',
      },
    },
    expectMarkers: ['html-comment'],
  },
  {
    kind: 'html-block',
    shape: false,
    snippet: '<div>PXhtml raw html block</div>',
    probe: blockProbe('PXhtml', 'div[data-type="html-block"]', 'div'),
    expectMarkers: [],
  },
  {
    // Only a wiki-enabled document turns `[[page]]` into a chip (isWikiFile), and the canon is a
    // plain .md — so this is the literal text in every stage. Kept so the kind exists and the
    // registry stays in step with the task's element list; the chip marker is exercised by the
    // wiki corpus test in step 4, not here.
    kind: 'wiki-link',
    snippet: 'See [[PXwiki]] for a wiki-style link.',
    probe: blockProbe('PXwiki', 'p'),
    expectMarkers: [],
  },
  {
    // Resolves only against a real workspace file, so in the canon (no such file) it stays plain
    // inline code in every stage — same status as wiki-link above.
    kind: 'code-ref',
    snippet: 'Reference `src/foo.ts:42` in code.',
    probe: blockProbe('src/foo.ts:42', 'code'),
    expectMarkers: [],
  },
  {
    kind: 'diagram-mermaid',
    shape: false,
    snippet:
      '```mermaid\ngraph TD\n  A[PXmermaid] --> B[Two]\n  B --> C[Three]\n```',
    probe: {
      select: {
        edit: 'div[data-type="code-block"]:has(.language-mermaid)',
        preview: 'div.language-mermaid',
      },
    },
    expectMarkers: ['svg'],
    engine: 'mermaid',
  },
  {
    kind: 'diagram-d2',
    shape: false,
    snippet: '```d2\nPXd2a -> PXd2b\n```',
    probe: {
      select: {
        edit: 'div[data-type="code-block"]:has(.language-d2)',
        preview: 'pre:has(> div.language-d2)',
      },
    },
    expectMarkers: ['svg'],
    engine: 'd2',
  },
  {
    kind: 'closing-paragraph',
    snippet: 'PXclose closing paragraph of the canonical document.',
    probe: blockProbe('PXclose', 'p'),
    expectMarkers: [],
  },
  {
    // Last on purpose: Lute's HTML moves footnote definitions to the foot of the document, so the
    // editors (which keep a definition where it is written) only agree with the Preview when it
    // already is last. The gate parks the caret in the editors' trailing paragraph, below it, so no
    // IR node is expanded while snapshotting.
    kind: 'footnote-def',
    snippet: '[^pxfn]: PXfndef the footnote definition.',
    probe: blockProbe(
      'PXfndef',
      'div[data-type="footnotes-block"]',
      'div.footnotes-defs-div',
    ),
    expectMarkers: [],
  },
]

/**
 * Every long-lived observer `runFinishInit` registers, classified for the gate. `decorator` entries
 * paint something the plain Lute output lacks (so they are what the overlay can miss) and name the
 * markers they produce; `behaviour` entries are not content (key handlers, toolbars, scroll). A new
 * `observers.set('<name>', …)` in finish-init.ts fails the unit test until it is classified here —
 * the forcing function for "new decorators cannot be added without registering with the gate". Step
 * 4 replaces this table with the real decorator registry (content-decorators.ts).
 */
export const PARITY_OBSERVERS: Readonly<
  Record<
    string,
    { role: 'decorator'; markers: readonly string[] } | { role: 'behaviour' }
  >
> = {
  callouts: { role: 'decorator', markers: ['callout-title', 'callout-type'] },
  'preview-callouts': {
    role: 'decorator',
    markers: ['callout-title', 'callout-type'],
  },
  'soft-breaks': { role: 'decorator', markers: ['softbreak'] },
  'code-refs': { role: 'decorator', markers: ['code-ref-chip'] },
  'preview-code-refs': { role: 'decorator', markers: ['code-ref-chip'] },
  'html-comments': { role: 'decorator', markers: ['html-comment'] },
  'preview-html-comments': { role: 'decorator', markers: ['html-comment'] },
  'code-source': { role: 'decorator', markers: ['hljs', 'hljs-token'] },
  'wysiwyg-highlight': { role: 'decorator', markers: ['hljs-token'] },
  'diagram-zoom': { role: 'decorator', markers: [] },
  'outline-keyboard': { role: 'behaviour' },
  'edit-activity': { role: 'behaviour' },
  'caret-link': { role: 'behaviour' },
  trailing: { role: 'behaviour' },
  'gated-diagram-zoom-keys': { role: 'behaviour' },
  'list-backspace': { role: 'behaviour' },
  'escape-toolbar': { role: 'behaviour' },
  'format-word-expand': { role: 'behaviour' },
  'toolbar-overflow': { role: 'behaviour' },
  'toolbar-submenu-aria': { role: 'behaviour' },
  'callout-popover-keys': { role: 'behaviour' },
  'diagram-retheme-gate': { role: 'behaviour' },
  'dblclick-word-select': { role: 'behaviour' },
}

/** The canonical fixture, generated from the registry (one blank line between snippets). */
export function buildParityFixture(): string {
  return `${PARITY_ELEMENTS.map((e) => e.snippet).join('\n\n')}\n`
}
