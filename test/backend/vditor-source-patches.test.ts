import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  patchDmpInterop,
  patchIrLinkClick,
  patchIrLinkSelectedUrl,
  patchPasteTransform,
  patchPasteUrlAsLink,
  patchWysiwygLinkSelectedUrl,
  patchWysiwygLinkClick,
  patchWysiwygCodeClickCaret,
  patchListToggle,
  patchUploadFilesKindFilter,
  patchFixListOutdent,
  patchOutlineCurrent,
  patchMathRender,
  patchProcessCode,
  patchIrInputSerialize,
  patchIrDeferDiagramRender,
  patchIrSpaceSerialize,
  patchDeferRenderToc,
  patchIrStripPreviewSpin,
  patchIrFenceSpinSkip,
  patchIrListMarkerOnSpace,
  patchWysiwygListMarkerOnSpace,
  patchDeferGetMarkdown,
  patchInfoDialog,
  patchPreviewCopyClipboardData,
  patchPreviewCopyTip,
  patchPreviewMorph,
  patchCodeRenderSkipDiagram,
  patchCodeRenderCopyButton,
  patchIrBlurExpand,
  patchModifiedTabPassthrough,
  patchSetContentTheme,
  patchCalloutArrowNav,
  patchMarkmapStatic,
  patchGraphvizRender,
  patchLuteHook,
  patchPreviewReflow,
  patchWavedromRender,
  patchHighlightSkipDiagrams,
  patchHighlightLanguageClass,
  patchPreviewComments,
  patchFlowchartTheme,
  patchPlantumlRender,
  patchAbcRender,
  patchMindmapThemeColors,
  patchEchartsThemeInit,
  patchEchartsDataCode,
  patchMermaidVersion,
  patchMermaidC4Colors,
  patchEchartsVersion,
  patchSmilesVersion,
  patchMermaidErrorRender,
  patchFlowchartError,
  patchEchartsErrorBox,
  patchMindmapErrorBox,
  patchInsertHtmlDelete,
  patchSetRangeByWbrHeadingMarker,
  patchClipboardCollapsed,
  patchCutDeleteSync,
  patchUndoCaretSplitRestore,
  patchUndoSnapshotStripSoftBreaks,
  VDITOR_TS_PATCHES,
} from '../../media-src/esbuild-shared.mjs'

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const irSource = read('../../media-src/node_modules/vditor/src/ts/ir/index.ts')
const undoSource = read(
  '../../media-src/node_modules/vditor/src/ts/undo/index.ts',
)
const fixBrowserSource = read(
  '../../media-src/node_modules/vditor/src/ts/util/fixBrowserBehavior.ts',
)
const uploadSource = read(
  '../../media-src/node_modules/vditor/src/ts/upload/index.ts',
)
const mathSource = read(
  '../../media-src/node_modules/vditor/src/ts/markdown/mathRender.ts',
)
const setLuteSource = read(
  '../../media-src/node_modules/vditor/src/ts/markdown/setLute.ts',
)
const wavedromSource = read(
  '../../media-src/node_modules/vditor/src/ts/markdown/wavedromRender.ts',
)
const wysiwygSource = read(
  '../../media-src/node_modules/vditor/src/ts/wysiwyg/index.ts',
)
const processCodeSource = read(
  '../../media-src/node_modules/vditor/src/ts/util/processCode.ts',
)
const outlineSource = read(
  '../../media-src/node_modules/vditor/src/ts/toolbar/Outline.ts',
)
const irProcessSource = read(
  '../../media-src/node_modules/vditor/src/ts/ir/process.ts',
)
const irInputSource = read(
  '../../media-src/node_modules/vditor/src/ts/ir/input.ts',
)
const afterRenderEventSource = read(
  '../../media-src/node_modules/vditor/src/ts/wysiwyg/afterRenderEvent.ts',
)
const svProcessSource = read(
  '../../media-src/node_modules/vditor/src/ts/sv/process.ts',
)
const infoSource = read(
  '../../media-src/node_modules/vditor/src/ts/toolbar/Info.ts',
)
const mermaidRenderSource = read(
  '../../media-src/node_modules/vditor/src/ts/markdown/mermaidRender.ts',
)
// Reading this path also guards against a file rename: if Vditor moves
// preview/index.ts, this readFileSync throws at load and the suite fails loudly —
// the esbuild onLoad filter would otherwise silently skip the patch (no build error).
const previewSource = read(
  '../../media-src/node_modules/vditor/src/ts/preview/index.ts',
)
const editorCommonEventSource = read(
  '../../media-src/node_modules/vditor/src/ts/util/editorCommonEvent.ts',
)
const setContentThemeSource = read(
  '../../media-src/node_modules/vditor/src/ts/ui/setContentTheme.ts',
)
const chartSource = read(
  '../../media-src/node_modules/vditor/src/ts/markdown/chartRender.ts',
)
const markmapSource = read(
  '../../media-src/node_modules/vditor/src/ts/markdown/markmapRender.ts',
)
const graphvizSource = read(
  '../../media-src/node_modules/vditor/src/ts/markdown/graphvizRender.ts',
)
const flowchartSource = read(
  '../../media-src/node_modules/vditor/src/ts/markdown/flowchartRender.ts',
)
const mindmapSource = read(
  '../../media-src/node_modules/vditor/src/ts/markdown/mindmapRender.ts',
)
const plantumlSource = read(
  '../../media-src/node_modules/vditor/src/ts/markdown/plantumlRender.ts',
)
const abcSource = read(
  '../../media-src/node_modules/vditor/src/ts/markdown/abcRender.ts',
)
const selectionSource = read(
  '../../media-src/node_modules/vditor/src/ts/util/selection.ts',
)

// The unguarded link-open condition Vditor ships — plain click follows the link.
const UNGATED =
  'if (aElement && (!aElement.classList.contains("vditor-ir__node--expand"))) {'

describe('patchIrLinkClick (task 62)', () => {
  // Confirms the behaviour exists in the code we actually ship today: a plain
  // (no-modifier) click on an IR link enters the open branch.
  it('the shipped Vditor IR source opens links on a plain click (pre-patch)', () => {
    expect(irSource).toContain(UNGATED)
    expect(irSource).toContain(
      'window.open(aElement.querySelector(":scope > .vditor-ir__marker--link").textContent);',
    )
  })

  it('gates the open branch behind the runtime link-open policy', () => {
    const patched = patchIrLinkClick(irSource)
    expect(patched).not.toContain(UNGATED)
    expect(patched).toContain('window.__vmarkdShouldOpenLink(event)')
    // The marker still feeds link.click/window.open inside the now-gated block.
    expect(patched).toContain(
      'window.open(aElement.querySelector(":scope > .vditor-ir__marker--link").textContent);',
    )
  })

  it('throws (fails the build loudly) if the anchor is gone — version-bump guard', () => {
    expect(() => patchIrLinkClick('// unrelated source')).toThrow(
      /fixIrLinkClick/,
    )
  })

  it('is idempotent-safe: re-running on patched output does not double-gate', () => {
    const once = patchIrLinkClick(irSource)
    // The original anchor is gone after patching, so a second run must throw
    // rather than silently patch again.
    expect(() => patchIrLinkClick(once)).toThrow(/fixIrLinkClick/)
  })
})

describe('patchWysiwygLinkClick (task 62)', () => {
  const WYSIWYG_UNGATED =
    'const a = hasClosestByMatchTag(event.target, "A");\n            if (a) {'

  it('the shipped Vditor WYSIWYG source opens links on a plain click (pre-patch)', () => {
    expect(wysiwygSource).toContain(WYSIWYG_UNGATED)
  })

  it('gates the WYSIWYG open branch behind the runtime link-open policy', () => {
    const patched = patchWysiwygLinkClick(wysiwygSource)
    expect(patched).not.toContain(WYSIWYG_UNGATED)
    expect(patched).toContain(
      'if (a && (window.__vmarkdShouldOpenLink ? window.__vmarkdShouldOpenLink(event) : true)) {',
    )
  })

  it('throws (fails the build loudly) if the anchor is gone — version-bump guard', () => {
    expect(() => patchWysiwygLinkClick('// unrelated source')).toThrow(
      /fixWysiwygLinkClick/,
    )
  })
})

describe('patchWysiwygCodeClickCaret (click lands caret at the clicked line)', () => {
  const CLICK_ANCHOR =
    'if (previewElement) {\n                showCode(previewElement, vditor);\n            }'

  it('the shipped Vditor WYSIWYG source collapses the caret to the block start (pre-patch)', () => {
    expect(wysiwygSource).toContain(CLICK_ANCHOR)
  })

  it('injects a caretRangeFromPoint reposition after showCode in the click handler', () => {
    const patched = patchWysiwygCodeClickCaret(wysiwygSource)
    expect(patched).toContain('caretRangeFromPoint')
    expect(patched).toContain('data-type") === "code-block"')
    // still calls showCode (we reposition AFTER it, falling back to its start)
    expect(patched).toContain('showCode(previewElement, vditor);')
  })

  it('throws (fails the build loudly) if the anchor is gone — version-bump guard', () => {
    expect(() => patchWysiwygCodeClickCaret('// unrelated source')).toThrow(
      /fixWysiwygCodeClickCaret/,
    )
  })
})

describe('patchCalloutArrowNav (callout dual-node arrow navigation)', () => {
  it('the shipped Vditor source checks last-line against raw textContent and splices only TABLE/data-type (pre-patch)', () => {
    expect(fixBrowserSource).toContain(
      'element.textContent.trimRight().substr(position.start).indexOf("\\n") === -1',
    )
    expect(fixBrowserSource).toContain(
      '(nextElement && (nextElement.tagName === "TABLE" || nextElement.getAttribute("data-type")))',
    )
    expect(fixBrowserSource).toContain(
      '(previousElement && (previousElement.tagName === "TABLE" || previousElement.getAttribute("data-type")))',
    )
  })

  it('compares the EDITABLE text (callout preview stripped) and splices for data-callout neighbours', () => {
    const patched = patchCalloutArrowNav(fixBrowserSource)
    // last-line / at-end checks use the preview-stripped text
    expect(patched).toContain(
      'vmarkdEditableText(element).trimRight().substr(position.start).indexOf("\\n") === -1',
    )
    expect(patched).toContain(
      'position.start >= vmarkdEditableText(element).trimRight().length',
    )
    // the helper is injected before insertAfterBlock
    expect(patched).toContain('const vmarkdEditableText = ')
    // both splice sets gain data-callout; TABLE/data-type behaviour preserved
    expect(patched).toContain(
      'nextElement.getAttribute("data-type") || nextElement.hasAttribute("data-callout")',
    )
    expect(patched).toContain(
      'previousElement.getAttribute("data-type") || previousElement.hasAttribute("data-callout")',
    )
    // …and a contenteditable=false neighbour (e.g. the HTML-comment preview) is a splice
    // boundary too — Vditor inserts a paragraph instead of dropping the caret into it.
    expect(patched).toContain(
      'nextElement.getAttribute("contenteditable") === "false"',
    )
    expect(patched).toContain(
      'previousElement.getAttribute("contenteditable") === "false"',
    )
  })

  it('throws (fails the build loudly) if any anchor is gone — version-bump guard', () => {
    expect(() => patchCalloutArrowNav('// unrelated source')).toThrow(
      /fixCalloutArrowNav/,
    )
  })
})

describe('patchListToggle (task 56 — null-deref crash fix)', () => {
  // Confirms the crashing call ships today: in listToggle's uncheck branch the
  // guard checks only the clicked <li> for an <input>, then iterates ALL sibling
  // <li>; a sibling without a checkbox throws on `.remove()` of null.
  it('the shipped Vditor source removes an <input> without optional chaining (pre-patch)', () => {
    expect(fixBrowserSource).toContain('item.querySelector("input").remove()')
  })

  it('adds optional chaining so a checkbox-less sibling no longer crashes the toggle', () => {
    const patched = patchListToggle(fixBrowserSource)
    expect(patched).not.toContain('item.querySelector("input").remove()')
    expect(patched).toContain('item.querySelector("input")?.remove()')
  })

  it('throws (fails the build loudly) if the anchor is gone — version-bump guard', () => {
    expect(() => patchListToggle('// unrelated source')).toThrow(
      /fixListToggle/,
    )
  })
})

describe('patchFixListOutdent (tasks 428/461/462 — list-outdent seam)', () => {
  // Confirms the shipped Vditor source's first-item Backspace branch is gated ONLY on
  // `!previousElementSibling`, not on top-level-ness — the anchor this patch narrows. Measured
  // (media-src/e2e/list.spec.ts): unpatched, this branch corrupts a nested first item's tight list.
  it('the shipped Vditor source gates the first-item branch on !previousElementSibling alone (pre-patch)', () => {
    expect(fixBrowserSource).toContain(
      '!liElement.previousElementSibling && range.toString() === "" &&',
    )
  })

  it('gates the first-item branch to top-level-only and inserts the keydown seam before the empty-item branch', () => {
    const patched = patchFixListOutdent(fixBrowserSource)
    expect(patched).toContain(
      '!liElement.previousElementSibling && !hasClosestByMatchTag(liElement.parentElement, "LI") && range.toString() === "" &&',
    )
    expect(patched).toContain('__vmarkdListKeydown')
    // The seam branch preventDefaults + returns true, same shape as every other fixList branch.
    expect(patched).toMatch(
      /__vmarkdListKeydown\?\.\(vditor, liElement, range, vditor\[vditor\.currentMode\]\.element, event\)\) \{\s*event\.preventDefault\(\);\s*return true;/,
    )
    // Inserted at the TOP of fixList's `if (liElement) {` block (task 525 #7) — before fixList's own
    // Enter branch, the first-item branch and the "\n\n"-appending empty-item branch.
    const seam = patched.indexOf('__vmarkdListKeydown')
    expect(seam).toBeGreaterThan(-1)
    expect(seam).toBeLessThan(patched.indexOf('li 中有多个 P'))
    expect(seam).toBeLessThan(
      patched.indexOf('!hasClosestByMatchTag(liElement.parentElement, "LI")'),
    )
    // 3.11.3 removed the "\n\n"-appending branch (its comment marker is gone) and added
    // `exitEmptyListItem` calls; the seam must still precede those.
    expect(seam).toBeLessThan(patched.indexOf('exitEmptyListItem(liElement)'))
    expect(seam).toBeGreaterThan(patched.indexOf('export const fixList'))
  })

  it('rebinds listOutdent to the TOP list just before its spin (task 525 #4 — renumber the moved item)', () => {
    const patched = patchFixListOutdent(fixBrowserSource)
    const rebind =
      'topListElement = getTopList(liElements[0]) || topListElement;'
    expect(patched).toContain(rebind)
    expect(patched.indexOf(rebind)).toBeLessThan(
      patched.indexOf(
        'topListElement.outerHTML = vditor.lute.SpinVditorDOM(topListElement.outerHTML)',
      ),
    )
    expect(fixBrowserSource).toContain('getTopList,')
  })

  it('throws (fails the build loudly) if any anchor is gone — version-bump guard', () => {
    expect(() => patchFixListOutdent('// unrelated source')).toThrow(
      /patchFixListOutdent/,
    )
    for (const anchor of [
      'const liElement = hasClosestByMatchTag(startContainer, "LI");\n    if (liElement) {\n',
      'topListElement.outerHTML = vditor.lute.SpinVditorDOM(topListElement.outerHTML);',
    ]) {
      expect(() =>
        patchFixListOutdent(fixBrowserSource.replace(anchor, 'x')),
      ).toThrow(/patchFixListOutdent/)
    }
  })
})

describe('patchEchartsThemeInit (chart theme + no entry animation, per-file guarded — task 418)', () => {
  // Drift net (mirrors task 147 item 1's smiles fix): asserts the real vendored source still
  // carries the exact literal the animation patch keys on, independent of running the patch.
  it('the real vendored chartRender.ts still contains the `.setOption(option)` animation anchor', () => {
    expect(chartSource).toContain('.setOption(option)')
  })

  // And the mirror-image fact the exclusion depends on: mindmapRender.ts's setOption call is an
  // object literal, so it never matches — this is real vendored source, not a synthetic fixture.
  it('the real vendored mindmapRender.ts does NOT contain that literal (setOption takes an object)', () => {
    expect(mindmapSource).not.toContain('.setOption(option)')
  })

  it('routes init through the theme resolver and forces animation:false on the chart setOption (chartRender.ts)', () => {
    const patched = patchEchartsThemeInit(
      chartSource,
      'vditor/src/ts/markdown/chartRender.ts',
    )
    expect(patched).toContain('window.__vmarkdEchartsResolve')
    // chart entry animation disabled ("przy włączaniu") — forced over the user option
    expect(patched).toContain(
      '.setOption(Object.assign({}, option, { animation: false }))',
    )
    expect(patched).not.toContain('.setOption(option)')
  })

  it('throws a named version-drift error when chartRender.ts-shaped source lacks the animation anchor', () => {
    // Simulates a Vditor reformat of the call (rename/wrap/extra arg) — must fail the build loudly,
    // not silently ship with the entry animation back on.
    const reformatted = chartSource.replace(
      '.setOption(option)',
      '.setOption(chartOption)',
    )
    expect(() =>
      patchEchartsThemeInit(
        reformatted,
        'vditor/src/ts/markdown/chartRender.ts',
      ),
    ).toThrow(/fixEcharts.*setOption/)
  })

  it('does NOT throw for mindmapRender.ts-shaped source lacking that anchor — the exclusion is explicit, not incidental', () => {
    // ECharts `tree` gates the entry animation AND the click-collapse re-render on the same flag
    // (see patchMindmapThemeColors), so mindmapRender.ts must NEVER get animation:false forced on
    // it. Uses the real vendored mindmapRender.ts, which genuinely lacks `.setOption(option)`.
    expect(() =>
      patchEchartsThemeInit(
        mindmapSource,
        'vditor/src/ts/markdown/mindmapRender.ts',
      ),
    ).not.toThrow()
    const patched = patchEchartsThemeInit(
      mindmapSource,
      'vditor/src/ts/markdown/mindmapRender.ts',
    )
    expect(patched).not.toContain('animation: false')
  })

  it('still throws if the shared init anchor is missing, regardless of which file', () => {
    expect(() =>
      patchEchartsThemeInit(
        '// unrelated source',
        'vditor/src/ts/markdown/chartRender.ts',
      ),
    ).toThrow(/fixEcharts/)
    expect(() =>
      patchEchartsThemeInit(
        '// unrelated source',
        'vditor/src/ts/markdown/mindmapRender.ts',
      ),
    ).toThrow(/fixEcharts/)
  })

  // Task 418 follow-up: `CHART_RENDER_FILE_RE.test(path || '')` silently falls through to "not
  // chartRender" whenever `path` itself is falsy — same silent-no-op failure mode as the bug this
  // task fixed, just moved from the anchor up to the argument. A caller (the registry entry) that
  // ever dropped `path` would ship with the animation-disable quietly gone and nothing would fail.
  it('throws a named error rather than silently skipping the animation gate when called without a path', () => {
    expect(() => patchEchartsThemeInit(chartSource)).toThrow(/fixEcharts/)
    expect(() => patchEchartsThemeInit(chartSource, '')).toThrow(/fixEcharts/)
    expect(() => patchEchartsThemeInit(chartSource, null)).toThrow(/fixEcharts/)
    expect(() => patchEchartsThemeInit(chartSource, undefined)).toThrow(
      /fixEcharts/,
    )
  })

  // Task 418 follow-up: none of the tests above drive the registry ENTRY itself — they call
  // patchEchartsThemeInit directly, passing `path` by hand. That leaves a real gap: a future edit
  // to the registry entry (entry 28, `markdown/(chartRender|mindmapRender)` + `devtools/index`)
  // that dropped `path` from its own `patchEchartsThemeInit(out, path)` call would still pass every
  // unit test above (they never touch the entry), and `patch-mutation.test.ts`'s "mutates at least
  // one file" check would also stay green (the init-anchor rewrite alone still mutates the file).
  // Only running the actual `entry.transform(code, path)` proves the wire, not just the unit.
  it('the registry entry itself (not just the unit) lands the animation-disable on real chartRender.ts', () => {
    const chartRenderPath = fileURLToPath(
      new URL(
        '../../media-src/node_modules/vditor/src/ts/markdown/chartRender.ts',
        import.meta.url,
      ),
    )
    const entry = VDITOR_TS_PATCHES.find((e) => e.file.test(chartRenderPath))
    expect(entry, 'no registry entry matches chartRender.ts').toBeTruthy()
    const patched = entry.transform(chartSource, chartRenderPath)
    expect(patched).toContain(
      '.setOption(Object.assign({}, option, { animation: false }))',
    )
  })

  it('the registry entry deliberately leaves mindmapRender.ts entry animation alone', () => {
    const mindmapRenderPath = fileURLToPath(
      new URL(
        '../../media-src/node_modules/vditor/src/ts/markdown/mindmapRender.ts',
        import.meta.url,
      ),
    )
    const entry = VDITOR_TS_PATCHES.find((e) => e.file.test(mindmapRenderPath))
    expect(entry, 'no registry entry matches mindmapRender.ts').toBeTruthy()
    const patched = entry.transform(mindmapSource, mindmapRenderPath)
    expect(patched).not.toContain('animation: false')
  })
})

describe('patchEchartsDataCode (stamp data-code so a theme flip can re-find the source — task 454)', () => {
  it('the shipped Vditor source reads the source via getCode with no data-code fallback (pre-patch)', () => {
    expect(chartSource).toContain(
      'const text = chartRenderAdapter.getCode(e).trim();',
    )
  })

  it('prefers an existing data-code, falls back to getCode, and stamps the result', () => {
    const patched = patchEchartsDataCode(chartSource)
    expect(patched).toContain(
      'const text = (e.getAttribute("data-code") || chartRenderAdapter.getCode(e) || "").trim();',
    )
    expect(patched).toContain('e.setAttribute("data-code", text)')
    // The stamp happens right where `text` is computed — BEFORE the `data-processed === "true"`
    // early return a few lines later — so a re-entrant call still has a source to read back.
    expect(patched.indexOf('e.setAttribute("data-code", text)')).toBeLessThan(
      patched.indexOf('data-processed") === "true"'),
    )
  })

  // Encoding contract, asserted at the source-of-truth end: the stamp is the RAW string returned by
  // getCode/data-code — no encodeURIComponent wrapping. echarts-retheme.test.ts asserts the read
  // side matches (no decodeURIComponent); if either side drifted, a value that is valid JSON but
  // invalid percent-encoding (e.g. a bare `%`) would break one side and not the other.
  it('does not URI-encode the stamped value — unlike mindmap, which is Lute-encoded', () => {
    const patched = patchEchartsDataCode(chartSource)
    expect(patched).not.toContain('encodeURIComponent')
  })

  it('throws (fails the build loudly) if the anchor is gone — version-bump guard', () => {
    expect(() => patchEchartsDataCode('// unrelated source')).toThrow(
      /fixEchartsDataCode/,
    )
  })

  it('the registry entry itself lands the stamp on real chartRender.ts (and leaves mindmapRender.ts alone)', () => {
    const chartRenderPath = fileURLToPath(
      new URL(
        '../../media-src/node_modules/vditor/src/ts/markdown/chartRender.ts',
        import.meta.url,
      ),
    )
    const mindmapRenderPath = fileURLToPath(
      new URL(
        '../../media-src/node_modules/vditor/src/ts/markdown/mindmapRender.ts',
        import.meta.url,
      ),
    )
    const chartEntry = VDITOR_TS_PATCHES.find((e) =>
      e.file.test(chartRenderPath),
    )
    expect(chartEntry, 'no registry entry matches chartRender.ts').toBeTruthy()
    expect(chartEntry.transform(chartSource, chartRenderPath)).toContain(
      'e.setAttribute("data-code", text)',
    )
    // mindmapRender.ts gets its OWN data-code from Lute already (reconstructMindmaps reads it) —
    // this patch is chartRender.ts-only, gated the same explicit-per-file way as
    // patchEchartsThemeInit's animation-disable half.
    const mindmapEntry = VDITOR_TS_PATCHES.find((e) =>
      e.file.test(mindmapRenderPath),
    )
    expect(
      mindmapEntry.transform(mindmapSource, mindmapRenderPath),
    ).not.toContain('e.setAttribute("data-code", text)')
  })
})

describe('patchMindmapThemeColors (mindmap follows the content theme)', () => {
  it('Vditor ships hardcoded GitHub-light colours in the tree setOption', () => {
    expect(mindmapSource).toContain('color: "#4285f4"')
    expect(mindmapSource).toContain('backgroundColor: "#f6f8fa"')
    expect(mindmapSource).toContain('color: "#586069"')
    expect(mindmapSource).toContain('color: "#d1d5da"')
  })

  it('drives the tree node/label/line colours from the resolved theme (window.__vmarkdMindmapStyle)', () => {
    const patched = patchMindmapThemeColors(mindmapSource)
    // ECharts' `tree` ignores the registered theme palette, so the colours are set EXPLICITLY
    // from the resolved theme each render — not stripped (stripping left the nodes default grey).
    expect(patched).toContain('window.__vmarkdMindmapStyle.node')
    expect(patched).toContain('window.__vmarkdMindmapStyle.label')
    expect(patched).toContain('window.__vmarkdMindmapStyle.labelBg')
    expect(patched).toContain('window.__vmarkdMindmapStyle.labelBorder')
    expect(patched).toContain('window.__vmarkdMindmapStyle.line')
    // Vditor's GitHub-light colours survive only as the no-resolver fallback (bare harness).
    expect(patched).toContain(
      'window.__vmarkdMindmapStyle ? window.__vmarkdMindmapStyle.node : "#4285f4"',
    )
    // geometry is kept
    expect(patched).toContain('borderRadius: 5')
    expect(patched).toContain('position: "insideRight"')
    expect(patched).toContain('width: 1')
    // We do NOT touch the entry animation here (ECharts tree gates entry + collapse on one flag —
    // animation:false breaks collapse; animationDuration:0 doesn't suppress entry). So no anim patch.
    expect(patched).not.toContain('animation: false')
  })

  it('throws (fails the build loudly) if the colour block is gone — version-bump guard', () => {
    expect(() => patchMindmapThemeColors('// unrelated source')).toThrow(
      /fixMindmapTheme/,
    )
  })
})

describe('patchMarkmapStatic (markmap wheel/zoom hijack)', () => {
  it('marks the render div data-processed (task 189 — adapter re-entry accumulated duplicates)', () => {
    const src = read(
      '../../media-src/node_modules/vditor/src/ts/markdown/markmapRender.ts',
    )
    const patched = patchMarkmapStatic(src, '0.18.12')
    expect(patched).toContain('render.setAttribute("data-processed", "true")')
  })

  it('Vditor ships the interactive create + plain setData (no options)', () => {
    expect(markmapSource).toContain('const mm = Markmap.create(svg, null);')
    expect(markmapSource).toContain('mm.setData(root, frontmatterOptions)')
  })

  it('overrides the d3-zoom filter to Ctrl-gate, keeps duration:0 at create AND forces duration:0 into setData (no init animation)', () => {
    const patched = patchMarkmapStatic(markmapSource, '0.18.12')
    expect(patched).toContain(
      'const mm = Markmap.create(svg, { duration: 0, fitRatio: 0.80, autoFit: true });',
    )
    expect(patched).toContain('mm.zoom.filter((e) => e.ctrlKey && !e.button)')
    // fold/unfold gated on Ctrl — plain click enters edit mode
    expect(patched).toContain('if (e.ctrlKey) _origClick(e, d)')
    expect(patched).toContain('svg.__vmarkdMm = mm')
    expect(patched).toContain(
      'mm.setData(root, Object.assign({}, frontmatterOptions, { duration: 0, fitRatio: 0.80 }))',
    )
    expect(patched).not.toContain('const mm = Markmap.create(svg, null);')
    expect(patched).not.toContain('mm.setData(root, frontmatterOptions)')
  })

  it('injects ?v= cache-buster on the markmap script load', () => {
    const patched = patchMarkmapStatic(markmapSource, '0.18.12')
    expect(patched).toContain('markmap.min.js?v=0.18.12')
    expect(patched).not.toContain('markmap.min.js`, "vditorMarkerScript"')
  })

  it('skips ?v= when no version is provided', () => {
    const patched = patchMarkmapStatic(markmapSource)
    expect(patched).toContain('markmap.min.js`, "vditorMarkerScript"')
  })

  it('throws (fails the build loudly) if a markmap anchor is gone — version-bump guard', () => {
    expect(() => patchMarkmapStatic('// unrelated source')).toThrow(
      /fixMarkmapStatic/,
    )
    expect(() =>
      patchMarkmapStatic('const mm = Markmap.create(svg, null); // no setData'),
    ).toThrow(/fixMarkmapStatic/)
  })
})

describe('patchGraphvizRender (shared viz-global.js + theme)', () => {
  it('the shipped Vditor source loads the old graphviz/viz.js (pre-patch)', () => {
    expect(graphvizSource).toContain('dist/js/graphviz/viz.js')
  })

  // Task 144 item 1: the patch is now a thin shim that re-exports graphvizRender from the real,
  // typed, unit-tested module (media-src/src/graphviz-render.ts) — the render + theming logic lives
  // there (covered by graphviz-render.test.ts), NOT in this string any more.
  it('re-exports graphvizRender from the extracted module + drops the old graphviz/viz.js path', () => {
    const patched = patchGraphvizRender(graphvizSource)
    expect(patched).toContain('graphviz-render')
    expect(patched).toContain('export const graphvizRender')
    expect(patched).not.toContain('dist/js/graphviz/viz.js')
    // no manual Worker construction leaked back in
    expect(patched).not.toContain('new Worker(')
    expect(patched).not.toContain('importScripts(')
  })

  it('throws if the anchor is gone — version-bump guard', () => {
    expect(() => patchGraphvizRender('// unrelated source')).toThrow(
      /fixGraphvizRender/,
    )
  })
})

describe('patchFlowchartTheme (task 91 — pair flowchart.js with the content theme)', () => {
  it('the shipped Vditor source draws with NO style options (pre-patch, baked black)', () => {
    expect(flowchartSource).toContain('flowchartObj.drawSVG(item);')
  })

  it('passes themed colours (foreground + fill:none) to drawSVG', () => {
    const patched = patchFlowchartTheme(flowchartSource)
    // line/element/font colours come from the themed foreground (getComputedStyle(item).color).
    expect(patched).toContain('getComputedStyle(item).color')
    expect(patched).toContain('"line-color": vmFcColor')
    expect(patched).toContain('"element-color": vmFcColor')
    expect(patched).toContain('"font-color": vmFcColor')
    // box interiors transparent (NOT "transparent" — Raphael renders that black; "none" works).
    expect(patched).toContain('"fill": "none"')
    // the bare (baked-black) call is gone
    expect(patched).not.toContain('flowchartObj.drawSVG(item);')
  })

  it('throws (fails the build loudly) if the drawSVG anchor is gone — version-bump guard', () => {
    expect(() => patchFlowchartTheme('// unrelated source')).toThrow(
      /fixFlowchartTheme/,
    )
  })
})

describe('patchPlantumlRender (task 87 — local offline TeaVM render)', () => {
  it('the shipped Vditor source uses the remote plantuml.com encoder (pre-patch)', () => {
    expect(plantumlSource).toContain('plantumlEncoder.encode(text)')
    expect(plantumlSource).toContain('plantuml.com')
  })

  // Task 144 item 1: the patch is now a thin shim re-exporting plantumlRender from the real, typed,
  // unit-tested module (media-src/src/plantuml-render.ts). The remote encoder is gone (kept assert);
  // the render + theming logic moved to the module (covered by plantuml-render.test.ts), not here.
  it('drops the remote encoder and re-exports plantumlRender from the extracted module', () => {
    const patched = patchPlantumlRender(plantumlSource)
    expect(patched).not.toContain('plantumlEncoder.encode')
    expect(patched).not.toContain('plantuml.com')
    expect(patched).toContain('plantuml-render')
    expect(patched).toContain('export const plantumlRender')
  })

  it('throws if the encoder anchor is gone — version-bump guard', () => {
    expect(() => patchPlantumlRender('// unrelated source')).toThrow(
      /fixPlantumlRender/,
    )
  })
})

describe('patchAbcRender (task 92/93 — abcjs bump + foreground color)', () => {
  it('the shipped Vditor source calls renderAbc with no params (pre-patch)', () => {
    expect(abcSource).toContain(
      'ABCJS.renderAbc(item, abcRenderAdapter.getCode(item).trim())',
    )
  })

  it('passes foregroundColor from the themed foreground', () => {
    const patched = patchAbcRender(abcSource)
    expect(patched).toContain('foregroundColor: abcFg')
    expect(patched).toContain('getComputedStyle(item).color')
    expect(patched).toContain('data-code')
  })

  it('throws if the renderAbc anchor is gone — version-bump guard', () => {
    expect(() => patchAbcRender('// unrelated source')).toThrow(/fixAbcRender/)
  })
})

describe('patchSetContentTheme (content-theme stylesheet reload flicker)', () => {
  it('the shipped Vditor source reloads on a raw-string href mismatch (pre-patch)', () => {
    expect(setContentThemeSource).toContain(
      'vditorContentTheme.getAttribute("href") !== cssPath',
    )
  })

  it('compares RESOLVED urls so the same file is not reloaded', () => {
    const patched = patchSetContentTheme(setContentThemeSource)
    expect(patched).not.toContain(
      'vditorContentTheme.getAttribute("href") !== cssPath',
    )
    expect(patched).toContain(
      'new URL(vditorContentTheme.getAttribute("href"), document.baseURI).href !== new URL(cssPath, document.baseURI).href',
    )
  })

  it('throws (fails the build loudly) if the anchor is gone — version-bump guard', () => {
    expect(() => patchSetContentTheme('// unrelated source')).toThrow(
      /fixSetContentTheme/,
    )
  })
})

describe('patchOutlineCurrent (outline toolbar button blue-flash on init)', () => {
  // The shipped Outline item highlights itself with `if (vditor.options.outline)`,
  // an always-truthy object check — so the button is marked active on init even
  // when the outline panel is closed.
  it('the shipped Vditor source checks the truthy object (pre-patch)', () => {
    expect(outlineSource).toContain('if (vditor.options.outline) {')
  })

  it('gates the active highlight on .enable so it matches the panel state', () => {
    const patched = patchOutlineCurrent(outlineSource)
    expect(patched).not.toContain('if (vditor.options.outline) {')
    expect(patched).toContain('if (vditor.options.outline.enable) {')
  })

  it('throws (fails the build loudly) if the anchor is gone — version-bump guard', () => {
    expect(() => patchOutlineCurrent('// unrelated source')).toThrow(
      /fixOutlineCurrent/,
    )
  })
})

describe('patchMathRender (task 57 — KaTeX error resilience)', () => {
  // Confirms the shipped katex call lacks the resilience options today, so a single
  // malformed formula can throw out of renderToString instead of rendering KaTeX's
  // inline red error.
  it('the shipped katex.renderToString has no throwOnError/strict options (pre-patch)', () => {
    expect(mathSource).toContain('katex.renderToString(math, {')
    const call = mathSource.slice(
      mathSource.indexOf('katex.renderToString(math, {'),
    )
    const optionsBlock = call.slice(0, call.indexOf('});'))
    expect(optionsBlock).not.toContain('throwOnError')
    expect(optionsBlock).not.toContain('strict')
  })

  it('adds strict:false + throwOnError:false to the katex call', () => {
    const patched = patchMathRender(mathSource)
    const call = patched.slice(patched.indexOf('katex.renderToString(math, {'))
    const optionsBlock = call.slice(0, call.indexOf('});'))
    expect(optionsBlock).toContain('throwOnError: false')
    expect(optionsBlock).toContain('strict: false')
  })

  it('leaves the (MathJax) tex.macros config untouched — only the katex call changes', () => {
    const patched = patchMathRender(mathSource)
    // throwOnError must appear exactly once (the katex call), not leak into the
    // MathJax branch that shares `macros: options.math.macros`.
    expect(patched.split('throwOnError').length - 1).toBe(1)
  })

  it('throws (fails the build loudly) if the anchor is gone — version-bump guard', () => {
    expect(() => patchMathRender('// unrelated source')).toThrow(
      /fixMathRender/,
    )
  })
})

describe('patchProcessCode (task 63 — content-based paste code detection, PR #1921)', () => {
  // Confirms the marker-based heuristics ship today (they cause #1917/#1914).
  it('the shipped source detects code by IDE markers (pre-patch)', () => {
    expect(processCodeSource).toContain('monospace') // VS Code marker
    expect(processCodeSource).toContain('\\n<p class="p1">') // Xcode marker
  })

  it('replaces marker heuristics with content-based detection', () => {
    const patched = patchProcessCode(processCodeSource)
    expect(patched).toContain('const looksLikeCodeContent =')
    expect(patched).toContain('isCode = hasCodeChild || looksLikeCodeContent(')
    // The brittle IDE/Xcode markers are gone.
    expect(patched).not.toContain('monospace')
    expect(patched).not.toContain('\\n<p class="p1">')
    // The output half (isCode → code block) is preserved.
    expect(patched).toContain('data-type="code-block"')
    expect(patched).toContain('export const processPasteCode =')
  })

  it('throws (fails the build loudly) if the anchors are gone — version-bump guard', () => {
    expect(() => patchProcessCode('// unrelated source')).toThrow(
      /fixProcessCode/,
    )
  })
})

describe('patchIrInputSerialize (task 68 — webview owns the serialize)', () => {
  it('the shipped IR process serialises on every input (pre-patch)', () => {
    expect(irProcessSource).toContain('const text = getMarkdown(vditor);')
    expect(irProcessSource).toContain('vditor.options.input(text);')
  })

  it('turns options.input into a cheap signal; serialises only for counter/cache', () => {
    const patched = patchIrInputSerialize(irProcessSource)
    expect(patched).toContain('vditor.options.input();') // signal, no markdown
    expect(patched).not.toContain('vditor.options.input(text);')
    // getMarkdown is now gated behind counter/cache (both off → no serialize).
    expect(patched).toContain(
      '(vditor.options.counter.enable || vditor.options.cache.enable) ? getMarkdown(vditor) : ""',
    )
  })

  it('throws (fails the build loudly) if the anchors are gone — version-bump guard', () => {
    expect(() => patchIrInputSerialize('// unrelated source')).toThrow(
      /fixIrInputSerialize/,
    )
  })
})

describe('patchIrDeferDiagramRender (task 161 — debounce diagram render while typing)', () => {
  it('the shipped IR input re-renders every diagram preview on each input (pre-patch)', () => {
    expect(irInputSource).toContain(
      `vditor.ir.element.querySelectorAll(".vditor-ir__preview[data-render='2']").forEach((item: HTMLElement) => {`,
    )
    expect(irInputSource).toContain('processCodeRender(item, vditor);')
  })

  it('routes the per-input render loop through the edit-activity gate (with a stock fallback)', () => {
    const patched = patchIrDeferDiagramRender(irInputSource)
    // gate hook is preferred when installed…
    expect(patched).toContain('(window as any).__vmarkdDeferIrDiagramRender')
    expect(patched).toContain(
      '(window as any).__vmarkdDeferIrDiagramRender(vditor, processCodeRender);',
    )
    // …and the original loop is kept as the else-branch fallback (harness / hook absent).
    expect(patched).toContain('processCodeRender(item, vditor);')
    expect(patched).toContain('} else {')
  })

  it('throws (fails the build loudly) if the loop anchor is gone — version-bump guard', () => {
    expect(() => patchIrDeferDiagramRender('// unrelated source')).toThrow(
      /patchIrDeferDiagramRender/,
    )
  })
})

describe('patchIrSpaceSerialize (task 171 item 1 — gate the space fast-path serialize)', () => {
  it('the shipped IR input serialises the whole doc on both space fast-paths (pre-patch)', () => {
    // startSpace + endSpace each call input(getMarkdown(...)) — exactly two sites.
    expect(
      irInputSource.split('vditor.options.input(getMarkdown(vditor));').length -
        1,
    ).toBe(2)
  })

  it('gates getMarkdown behind counter/cache at BOTH sites (no serialize when off)', () => {
    const patched = patchIrSpaceSerialize(irInputSource)
    expect(patched).not.toContain('vditor.options.input(getMarkdown(vditor));')
    expect(
      patched.split(
        'vditor.options.input((vditor.options.counter.enable || vditor.options.cache.enable) ? getMarkdown(vditor) : undefined);',
      ).length - 1,
    ).toBe(2) // both sites rewritten
  })

  it('throws if the site count drifts from 2 — version-bump guard', () => {
    expect(() => patchIrSpaceSerialize('// no sites')).toThrow(
      /fixIrSpaceSerialize.*found 0/,
    )
  })
})

describe('patchDeferRenderToc (task 171 item 2 — defer renderToc to settle)', () => {
  it('the shipped IR input calls renderToc on every input (pre-patch)', () => {
    expect(irInputSource).toContain('renderToc(vditor);')
  })

  it('routes renderToc through the settle hook with a stock fallback', () => {
    const patched = patchDeferRenderToc(irInputSource)
    expect(patched).toContain(
      '(window as any).__vmarkdDeferRenderToc(vditor, renderToc);',
    )
    expect(patched).toContain('} else {')
    expect(patched).toContain('renderToc(vditor);') // fallback kept
  })

  it('throws if the renderToc anchor is gone — version-bump guard', () => {
    expect(() => patchDeferRenderToc('// no renderToc')).toThrow(
      /patchDeferRenderToc/,
    )
  })
})

describe('patchIrStripPreviewSpin (task 172 — strip the preview SVG from the spin input)', () => {
  it('the shipped IR input feeds the raw block html straight to the spin (pre-patch)', () => {
    expect(irInputSource).toContain('html = vditor.lute.SpinVditorIRDOM(html);')
  })

  it('routes the spin input through the strip hook with an identity fallback', () => {
    const patched = patchIrStripPreviewSpin(irInputSource)
    expect(patched).not.toContain('html = vditor.lute.SpinVditorIRDOM(html);')
    expect(patched).toContain(
      'vditor.lute.SpinVditorIRDOM((window as any).__vmarkdStripPreviewForSpin ? (window as any).__vmarkdStripPreviewForSpin(html) : html);',
    )
  })

  it('throws if the spin-call anchor count drifts from 1 — version-bump guard', () => {
    expect(() => patchIrStripPreviewSpin('// no spin call')).toThrow(
      /patchIrStripPreviewSpin.*found 0/,
    )
  })
})

describe('patchIrFenceSpinSkip (task 175 — defer the spin for inert fenced-body keystrokes)', () => {
  it('the shipped IR input has the input() signature anchor (pre-patch)', () => {
    expect(irInputSource).toContain(
      'export const input = (vditor: IVditor, range: Range, ignoreSpace = false, event?: InputEvent) => {',
    )
  })

  it('injects an early-return hook at the top of input()', () => {
    const patched = patchIrFenceSpinSkip(irInputSource)
    expect(patched).toContain(
      '(window as any).__vmarkdTrySkipFenceSpin(vditor, range, event)',
    )
    // the hook sits at the very top of the function body (before blockElement is resolved)
    const hookIdx = patched.indexOf('__vmarkdTrySkipFenceSpin')
    const blockIdx = patched.indexOf('hasClosestBlock(range.startContainer)')
    expect(hookIdx).toBeGreaterThan(0)
    expect(hookIdx).toBeLessThan(blockIdx)
  })

  it('throws if the input() signature anchor is gone — version-bump guard', () => {
    expect(() => patchIrFenceSpinSkip('// no input fn')).toThrow(
      /patchIrFenceSpinSkip/,
    )
  })
})

describe('patchDeferGetMarkdown (task 171 item 4 — WYSIWYG/SV discarded serialize)', () => {
  it('both WYSIWYG + SV compute a discarded full-doc serialize (pre-patch)', () => {
    expect(afterRenderEventSource).toContain(
      'const text = getMarkdown(vditor);',
    )
    expect(svProcessSource).toContain('const text = getMarkdown(vditor);')
  })

  it('gates the serialize behind counter/cache in both files (text stays declared)', () => {
    for (const [src, label] of [
      [afterRenderEventSource, 'wysiwyg/afterRenderEvent.ts'],
      [svProcessSource, 'sv/process.ts'],
    ] as const) {
      const patched = patchDeferGetMarkdown(src, label)
      expect(patched).not.toContain('const text = getMarkdown(vditor);')
      expect(patched).toContain(
        'const text = (vditor.options.counter.enable || vditor.options.cache.enable) ? getMarkdown(vditor) : "";',
      )
      // the counter/cache consumers below still reference `text`
      expect(patched).toContain('vditor.counter.render(vditor, text);')
    }
  })

  it('throws if the anchor count drifts — version-bump guard', () => {
    expect(() => patchDeferGetMarkdown('// none', 'x.ts')).toThrow(
      /patchDeferGetMarkdown.*found 0/,
    )
  })
})

describe('patchInfoDialog (original Vditor About, English, + Help section)', () => {
  const pin = {
    commit: '36ea9e0966025d7f4f343cdf9a611109bfb29ef6',
    committedAt: '2026-06-03',
  }

  // The shipped Info dialog is Chinese, loads a remote unpkg logo, and interpolates
  // a stale Lute.Version. The Help dialog (its links folded in here) is also Chinese.
  it('the shipped Info.ts is Chinese with a remote unpkg logo (pre-patch)', () => {
    expect(infoSource).toContain('组件版本：')
    expect(infoSource).toContain('unpkg.com')
  })

  it('keeps Vditor’s original About (translated) and appends a Help section', () => {
    const patched = patchInfoDialog(infoSource, pin)
    // top half = Vditor's original About content, in English (no vMarkd branding)
    expect(patched).toContain(
      'The next-generation Markdown editor, built for the future',
    )
    expect(patched).toContain('Project: ')
    expect(patched).toContain('License: MIT')
    expect(patched).not.toContain('vMarkd —') // not rebranded
    // Help folded in as its own section below
    expect(patched).toContain('<strong>Markdown guide</strong>')
    expect(patched).toContain('<strong>Vditor support</strong>')
    expect(patched).toContain('Syntax cheatsheet')
    expect(patched).toContain('Keyboard shortcuts')
    // no Chinese left (Info or the folded-in Help)
    expect(patched).not.toContain('组件版本')
    expect(patched).not.toContain('Markdown 使用指南')
    // Lute commit link (short sha) + date; Vditor version still interpolated
    expect(patched).toContain(
      `https://github.com/88250/lute/commit/${pin.commit}`,
    )
    expect(patched).toContain('>36ea9e0<')
    expect(patched).toContain('2026-06-03')
    // eslint-disable-next-line no-template-curly-in-string
    expect(patched).toContain('Vditor v${VDITOR_VERSION}')
    // logo repointed off unpkg to the locally-served asset (CSP task 67)
    expect(patched).not.toContain('unpkg.com')
    // eslint-disable-next-line no-template-curly-in-string
    expect(patched).toContain('${vditor.options.cdn}/dist/images/logo.png')
    // upstream links kept (Vditor project + ld246 help/community + sponsor)
    expect(patched).toContain('https://b3log.org/vditor')
    expect(patched).toContain('https://ld246.com/article/1583308420519')
    expect(patched).toContain('https://github.com/Vanessa219/vditor/issues')
    expect(patched).toContain('https://ld246.com/sponsor')
  })

  it('without a vendored pin, keeps Vditor’s runtime version interpolation', () => {
    const patched = patchInfoDialog(infoSource, null)
    // eslint-disable-next-line no-template-curly-in-string
    expect(patched).toContain('Lute v${Lute.Version}')
  })

  it('throws (fails the build loudly) if the dialog anchor is gone — version-bump guard', () => {
    expect(() => patchInfoDialog('// unrelated source', pin)).toThrow(
      /fixInfoDialog/,
    )
  })
})

describe('patchCodeRenderSkipDiagram (task 189 — no copy button inside rendered diagrams)', () => {
  const codeRenderSource = read(
    '../../media-src/node_modules/vditor/src/ts/markdown/codeRender.ts',
  )
  it('adds the svg/.vmarkd-d2-md skip to the filter', () => {
    const patched = patchCodeRenderSkipDiagram(codeRenderSource)
    expect(patched).toContain('e.closest("svg, .vmarkd-d2-md")')
  })
  it('throws on drift', () => {
    expect(() => patchCodeRenderSkipDiagram('// x')).toThrow(
      /patchCodeRenderSkipDiagram/,
    )
  })
})

describe('patchCodeRenderCopyButton (task 212 — CSP-safe code copy)', () => {
  const codeRenderSource = read(
    '../../media-src/node_modules/vditor/src/ts/markdown/codeRender.ts',
  )

  it('replaces Vditor inline handlers with a delegated-listener marker', () => {
    const patched = patchCodeRenderCopyButton(codeRenderSource)
    expect(patched).toContain('data-vmarkd-copy-code="true"')
    expect(patched).not.toContain('onclick="event.stopPropagation()')
  })

  it('throws on Vditor source drift', () => {
    expect(() => patchCodeRenderCopyButton('// x')).toThrow(
      /patchCodeRenderCopyButton/,
    )
  })
})

describe('patchPreviewMorph (task 187 — block-level preview morph hook)', () => {
  it('routes the non-url innerHTML write through the morph hook, with a stock fallback', () => {
    const patched = patchPreviewMorph(previewSource)
    expect(patched).toContain('window as any).__vmarkdMorphPreview')
    expect(patched).toContain(
      'vmMorph(this.previewElement, html); } else { this.previewElement.innerHTML = html; }',
    )
  })

  it('leaves the xhr fallback branch (deeper indent) untouched', () => {
    const patched = patchPreviewMorph(previewSource)
    // The xhr branch keeps its plain innerHTML assignment at 28-space indent.
    expect(patched).toContain(
      '                            this.previewElement.innerHTML = html;',
    )
    // Exactly ONE morph hook was inserted.
    expect(patched.match(/__vmarkdMorphPreview/g)).toHaveLength(1)
  })

  it('throws (fails the build loudly) if the anchor is gone — version-bump guard', () => {
    expect(() => patchPreviewMorph('// unrelated source')).toThrow(
      /patchPreviewMorph/,
    )
  })
})

describe('patchPreviewCopyTip (Ctrl+C in preview shows a hardcoded Chinese toast)', () => {
  const CHINESE_TIP = '已复制到剪切板'

  // The shipped preview shows a hardcoded Chinese "copied to clipboard" toast on
  // Ctrl+C, NOT routed through VditorI18n, so an English-locale user sees Chinese.
  it('the shipped preview/index.ts shows the Chinese tip (pre-patch)', () => {
    expect(previewSource).toContain(`\`${CHINESE_TIP}\``)
  })

  it('translates the copy toast to English', () => {
    const patched = patchPreviewCopyTip(previewSource)
    expect(patched).not.toContain(CHINESE_TIP)
    expect(patched).toContain('Copied to clipboard')
  })

  it('throws (fails the build loudly) if the anchor is gone — version-bump guard', () => {
    expect(() => patchPreviewCopyTip('// unrelated source')).toThrow(
      /fixPreviewCopyTip/,
    )
  })
})

describe('patchPreviewCopyClipboardData (split-preview Ctrl+C copied nothing)', () => {
  // The shipped handler copies via a RE-ENTRANT document.execCommand("copy") from inside its own
  // `copy` listener, then preventDefault()s the original event. In a VS Code webview Chromium
  // refuses that write and returns true anyway, so the clipboard was never written at all.
  it('the shipped preview/index.ts copies through copyToX/execCommand (pre-patch)', () => {
    expect(previewSource).toContain(
      'this.copyToX(vditor, tempElement, "default");',
    )
    expect(previewSource).toContain('document.execCommand("copy");')
  })

  it('writes the event clipboardData instead, the mechanism every other pane uses', () => {
    const patched = patchPreviewCopyClipboardData(previewSource)
    expect(patched).not.toContain(
      'this.copyToX(vditor, tempElement, "default");',
    )
    expect(patched).toContain(
      'event.clipboardData.setData("text/html", tempElement.outerHTML);',
    )
    expect(patched).toContain('event.clipboardData.setData("text/plain"')
    // The original event must still be cancelled — the clipboard is ours now.
    expect(patched).toContain('event.preventDefault();')
  })

  it('leaves copyToX in place for the WeChat/Zhihu export buttons', () => {
    const patched = patchPreviewCopyClipboardData(previewSource)
    expect(patched, 'the method itself survives').toContain('private copyToX(')
    expect(patched, 'its own execCommand path is untouched').toContain(
      'document.execCommand("copy");',
    )
  })

  it('keeps the KaTeX fix-up so pasted math still renders', () => {
    expect(patchPreviewCopyClipboardData(previewSource)).toContain(
      'tempElement.querySelectorAll(".katex-html .base")',
    )
  })

  it('throws (fails the build loudly) if the anchor is gone — version-bump guard', () => {
    expect(() => patchPreviewCopyClipboardData('// unrelated source')).toThrow(
      /patchPreviewCopyClipboardData/,
    )
  })
})

describe('patchIrBlurExpand (code-block edit click flash)', () => {
  const ANCHOR = 'expandElement.classList.remove("vditor-ir__node--expand");'

  it('Vditor ships the unguarded synchronous collapse-on-blur', () => {
    expect(editorCommonEventSource).toContain(ANCHOR)
  })

  it('defers the collapse and skips it when focus returns to the editor', () => {
    const patched = patchIrBlurExpand(editorCommonEventSource)
    // wrapped in a deferred, focus-rechecked callback
    expect(patched).toContain('requestAnimationFrame(')
    expect(patched).toContain('document.activeElement')
    expect(patched).toContain('editorElement.contains(ae)')
    // the removal still happens — but only inside the guard
    expect(patched).toContain(ANCHOR)
  })

  it('throws (fails the build loudly) if the anchor is gone — version-bump guard', () => {
    expect(() => patchIrBlurExpand('// unrelated source')).toThrow(
      /fixIrBlurExpand/,
    )
  })
})

describe('patchModifiedTabPassthrough (Ctrl/Alt/Meta+Tab must not insert a tab)', () => {
  const ANCHOR = `        if (!event.isComposing && vditor.options.keydown) {
            vditor.options.keydown(event);
        }
`

  it('Vditor ships the unconditional options.keydown prologue of the editor keydown listener', () => {
    expect(editorCommonEventSource).toContain(ANCHOR)
  })

  it('returns early for a modified Tab, right after the options.keydown hook and before any mode handler', () => {
    const patched = patchModifiedTabPassthrough(editorCommonEventSource)
    const guard =
      'event.key === "Tab" && (event.ctrlKey || event.metaKey || event.altKey)'
    expect(patched).toContain(guard)
    expect(patched.indexOf(guard)).toBeGreaterThan(patched.indexOf(ANCHOR))
    expect(patched.indexOf(guard)).toBeLessThan(
      patched.indexOf('irProcessKeydown(vditor, event)'),
    )
  })

  it('throws (fails the build loudly) if the anchor is gone — version-bump guard', () => {
    expect(() => patchModifiedTabPassthrough('// unrelated source')).toThrow(
      /patchModifiedTabPassthrough/,
    )
  })
})

describe('patchMermaidErrorRender (mermaidRender.ts)', () => {
  it('suppresses the bomb + renders the shared themed escaped error box, drops the raw dump', () => {
    const patched = patchMermaidErrorRender(mermaidRenderSource)
    // mermaid no longer injects its bomb error graphic (render() just throws) …
    expect(patched).toContain('suppressErrorRendering: true')
    // … and the catch renders the SHARED box (task 178 — same class for every engine), not
    // errorElement.outerHTML + a <small> dump. data-render="1" → Lute-invisible.
    expect(patched).toContain('vmarkd-diagram-error')
    expect(patched).toContain('vmarkd-diagram-error__msg')
    expect(patched).toContain('data-render="1"')
    expect(patched).toContain('vmarkd-diagram-error__title">Mermaid')
    expect(patched).toContain('&amp;') // message is HTML-escaped (source <…> can't inject)
    expect(patched).not.toContain('errorElement.outerHTML')
    expect(patched).not.toContain('errorElement.parentElement.remove()')
    expect(patched).not.toContain('vmarkd-mermaid-error') // old per-engine class is gone
  })

  it('throws (fails the build loudly) if the config or catch anchor drifts', () => {
    expect(() => patchMermaidErrorRender('// unrelated source')).toThrow(
      /patchMermaidErrorRender/,
    )
    // config flag present but the catch body gone → still throws (both anchors required)
    expect(() =>
      patchMermaidErrorRender('const c = { startOnLoad: false, };'),
    ).toThrow(/patchMermaidErrorRender/)
  })
})

describe('patchMermaidC4Colors (mermaidRender.ts)', () => {
  it('runs the scoped C4 recolour hook after Mermaid inserts the SVG', () => {
    const patched = patchMermaidC4Colors(mermaidRenderSource)
    expect(patched).toContain('item.innerHTML = mermaidData.svg;')
    expect(patched).toContain(
      '(window as any).__vmarkdStyleMermaidC4?.(item, theme);',
    )
    expect(patched.indexOf('__vmarkdStyleMermaidC4')).toBeGreaterThan(
      patched.indexOf('item.innerHTML = mermaidData.svg;'),
    )
  })

  it('throws when the render insertion anchor drifts', () => {
    expect(() => patchMermaidC4Colors('// unrelated source')).toThrow(
      /patchMermaidC4Colors/,
    )
  })
})

describe('patchEchartsErrorBox / patchMindmapErrorBox (task 178 — native render-error box)', () => {
  it('Vditor ships the raw "render error" dump in chart + mindmap (pre-patch)', () => {
    expect(chartSource).toContain('echarts render error: <br>')
    expect(chartSource).toContain('e.className = "vditor-reset--error";')
    expect(mindmapSource).toContain('mindmap render error: <br>')
  })

  it('echarts: replaces the raw dump with the shared themed box (escaped, titled)', () => {
    const patched = patchEchartsErrorBox(chartSource)
    expect(patched).toContain('vmarkd-diagram-error" data-render="1"')
    expect(patched).toContain('vmarkd-diagram-error__title">ECharts')
    expect(patched).toContain('vmarkd-diagram-error__msg')
    expect(patched).toContain('&amp;') // escaped message
    // raw dump + the unwanted reset class are gone (the box is self-styled)
    expect(patched).not.toContain('echarts render error')
    expect(patched).not.toContain('e.className = "vditor-reset--error"')
  })

  it('mindmap: replaces the raw dump with the shared themed box (titled Mindmap)', () => {
    const patched = patchMindmapErrorBox(mindmapSource)
    expect(patched).toContain('vmarkd-diagram-error__title">Mindmap')
    expect(patched).toContain('vmarkd-diagram-error__msg')
    expect(patched).not.toContain('mindmap render error')
  })

  it('composes with patchMindmapThemeColors (both apply, independent anchors)', () => {
    const patched = patchMindmapErrorBox(patchMindmapThemeColors(mindmapSource))
    expect(patched).toContain('window.__vmarkdMindmapStyle.node') // theme patch survived
    expect(patched).toContain('vmarkd-diagram-error__title">Mindmap') // error patch applied
  })

  it('throws (fails the build loudly) if the catch anchor drifts', () => {
    expect(() => patchEchartsErrorBox('// unrelated source')).toThrow(
      /patchNativeDiagramError/,
    )
    expect(() => patchMindmapErrorBox('// unrelated source')).toThrow(
      /patchNativeDiagramError/,
    )
  })
})

describe('patchFlowchartError (task 178 — wrap flowchart render in a catch → box)', () => {
  it('Vditor ships the render body with NO catch (pre-patch, uncaught parse error)', () => {
    expect(flowchartSource).toContain(
      'const flowchartObj = flowchart.parse(flowchartRenderAdapter.getCode(item));',
    )
    expect(flowchartSource).not.toContain('vmarkd-diagram-error')
  })

  it('wraps parse+draw in a try/catch that renders the shared themed box', () => {
    const patched = patchFlowchartError(flowchartSource)
    expect(patched).toContain('try {')
    expect(patched).toContain('} catch (error) {')
    expect(patched).toContain('vmarkd-diagram-error" data-render="1"')
    expect(patched).toContain('vmarkd-diagram-error__title">Flowchart')
    expect(patched).toContain('&amp;') // escaped message
    // the drawSVG line is kept verbatim INSIDE the try so patchFlowchartTheme can still theme it
    expect(patched).toContain('flowchartObj.drawSVG(item);')
  })

  it('composes with patchFlowchartTheme (error wrap inner, theme outer)', () => {
    const patched = patchFlowchartTheme(patchFlowchartError(flowchartSource))
    // themed drawSVG present (theme patch found the verbatim line inside the try)…
    expect(patched).toContain('"line-color": vmFcColor')
    expect(patched).toContain('"fill": "none"')
    // …and the error box is present, and the bare baked-black call is gone
    expect(patched).toContain('vmarkd-diagram-error__title">Flowchart')
    expect(patched).not.toContain('flowchartObj.drawSVG(item);')
  })

  it('throws (fails the build loudly) if the render-body anchor is gone — version-bump guard', () => {
    expect(() => patchFlowchartError('// unrelated source')).toThrow(
      /fixFlowchartError/,
    )
  })
})

describe('patchDmpInterop (undo CJS default-import interop)', () => {
  // diff-match-patch is CJS whose module.exports IS the constructor; the ES
  // namespace object esbuild builds for `import * as` is not callable, so
  // `new DiffMatchPatch()` throws at runtime and undo breaks (task 20).
  it('the shipped Vditor undo source uses the namespace import + `new` (pre-patch)', () => {
    expect(undoSource).toContain(
      'import * as DiffMatchPatch from "diff-match-patch";',
    )
    expect(undoSource).toContain('new DiffMatchPatch()')
  })

  it('rewrites the namespace import to a default import (constructor callable)', () => {
    const patched = patchDmpInterop(undoSource)
    expect(patched).toContain('import DiffMatchPatch from "diff-match-patch";')
    expect(patched).not.toContain(
      'import * as DiffMatchPatch from "diff-match-patch";',
    )
    // The constructor call site is untouched — only the import shape changes.
    expect(patched).toContain('new DiffMatchPatch()')
  })

  it('throws (fails the build loudly) if the anchor is gone — version-bump guard', () => {
    expect(() => patchDmpInterop('// unrelated source')).toThrow(
      /patchDmpInterop/,
    )
  })

  it('is idempotent-safe: re-running on patched output throws rather than no-oping', () => {
    const once = patchDmpInterop(undoSource)
    expect(() => patchDmpInterop(once)).toThrow(/patchDmpInterop/)
  })
})

describe('patchUndoCaretSplitRestore (task 445 — undo-snapshot caret restore survives the text-node split)', () => {
  // Task 445 "Round 6": Range.insertNode (Undo.addCaret's own wbr-marker insert, called from the
  // ONE-TIME initial undo snapshot) splits a Text startContainer; the pre-cloned `cloneRange` is a
  // LIVE Range, so its boundary auto-adjusts onto the (possibly now-empty) pre-split half — restoring
  // onto it produces a caret with a zero-height client rect (task 439's exact failure, this time
  // caused by Vditor's own undo machinery). See esbuild-shared.mjs's patch comment for the full trace.
  it('the shipped Vditor undo source restores via the stale cloneRange (pre-patch)', () => {
    expect(undoSource).toContain('cloneRange = range.cloneRange();')
    expect(undoSource).toContain('range.insertNode(wbrElement);')
    expect(undoSource).toContain(
      'if (setFocus && cloneRange) {\n            setSelectionFocus(cloneRange);\n        }',
    )
  })

  it('inserts a character-offset capture BEFORE insertNode splits the node', () => {
    const patched = patchUndoCaretSplitRestore(patchDmpInterop(undoSource))
    expect(patched).toContain('function vmarkdCaretTextOffset(')
    const captureIdx = patched.indexOf(
      'vmarkdCaretOffset = vmarkdCaretTextOffset(',
    )
    const insertNodeIdx = patched.indexOf('range.insertNode(wbrElement);')
    expect(captureIdx, 'capture call exists').toBeGreaterThan(-1)
    expect(insertNodeIdx, 'insertNode call exists').toBeGreaterThan(-1)
    // ORDER matters: the offset must be captured against the UNSPLIT DOM, strictly before the
    // mutation that splits it.
    expect(captureIdx).toBeLessThan(insertNodeIdx)
  })

  it('restores via the caret authority bridge, falling back to the original stale-range restore', () => {
    const patched = patchUndoCaretSplitRestore(patchDmpInterop(undoSource))
    expect(patched).toContain(
      'if (vmarkdCaretOffset >= 0 && window.__vmarkdRequestCaret) {',
    )
    expect(patched).toContain(
      'window.__vmarkdRequestCaret({ textOffset: vmarkdCaretOffset });',
    )
    // The original restore is PRESERVED as the fallback (bridge not installed) — not deleted.
    expect(patched).toContain('setSelectionFocus(cloneRange);')
  })

  it('leaves the rest of addCaret (marker creation, diff/clone, marker removal) untouched', () => {
    const patched = patchUndoCaretSplitRestore(patchDmpInterop(undoSource))
    expect(patched).toContain('wbrElement.className = "vditor-wbr";')
    expect(patched).toContain(
      'const cloneElement = vditor[vditor.currentMode].element.cloneNode(true) as HTMLElement;',
    )
    expect(patched).toContain(
      'vditor[vditor.currentMode].element.querySelectorAll(".vditor-wbr").forEach((item) => {',
    )
  })

  it('throws (fails the build loudly) if the source is unrelated — version-bump guard', () => {
    expect(() => patchUndoCaretSplitRestore('// unrelated source')).toThrow(
      /patchUndoCaretSplitRestore/,
    )
  })

  it('names WHICH anchor drifted when only one of the four goes missing', () => {
    // Delete just the restore anchor's exact text (leave the other three intact) — confirms the
    // per-anchor loop attributes the failure precisely instead of one generic message for all four.
    const oneAnchorGone = undoSource.replace(
      'if (setFocus && cloneRange) {\n            setSelectionFocus(cloneRange);\n        }',
      'if (setFocus && cloneRange) { /* anchor removed for this test */ }',
    )
    expect(() => patchUndoCaretSplitRestore(oneAnchorGone)).toThrow(/restore/)
  })

  it('is idempotent-safe: re-running on patched output throws rather than no-oping', () => {
    const once = patchUndoCaretSplitRestore(patchDmpInterop(undoSource))
    expect(() => patchUndoCaretSplitRestore(once)).toThrow(
      /patchUndoCaretSplitRestore/,
    )
  })

  it('is chained with patchDmpInterop in the registry for this one file', () => {
    const entry = VDITOR_TS_PATCHES.find((e) =>
      e.file.test('vditor/src/ts/undo/index.ts'),
    )
    expect(entry, 'a registry entry matches undo/index.ts').toBeDefined()
    const patched = entry!.transform(undoSource, 'vditor/src/ts/undo/index.ts')
    // Both patches bit in the ONE chained transform.
    expect(patched).toContain('import DiffMatchPatch from "diff-match-patch";')
    expect(patched).toContain(
      'window.__vmarkdRequestCaret({ textOffset: vmarkdCaretOffset });',
    )
  })
})

describe('?v= cache-buster patches (185/3c — no silent skips)', () => {
  const smilesSource = read(
    '../../media-src/node_modules/vditor/src/ts/markdown/SMILESRender.ts',
  )

  it('patchMermaidVersion bumps the ?v= and throws when the URL drifts', () => {
    const bumped = patchMermaidVersion(mermaidRenderSource, '99.9.9')
    expect(bumped).toContain('mermaid.min.js?v=99.9.9')
    expect(() => patchMermaidVersion('// unrelated source', '99.9.9')).toThrow(
      /fixMermaidVersion/,
    )
  })

  it('patchEchartsVersion bumps every echarts loader ?v= and throws when the URL drifts', () => {
    const bumped = patchEchartsVersion(chartSource, '88.8.8')
    expect(bumped).toContain('echarts.min.js?v=88.8.8')
    expect(bumped).not.toMatch(/echarts\.min\.js\?v=(?!88\.8\.8)/)
    expect(() => patchEchartsVersion('// unrelated source', '88.8.8')).toThrow(
      /fixEchartsVersion/,
    )
  })

  it('patchSmilesVersion bumps the ?v=, no-ops without a pin, throws on anchor drift', () => {
    expect(patchSmilesVersion(smilesSource, '9.9.9')).toContain(
      'smiles-drawer.min.js?v=9.9.9',
    )
    expect(patchSmilesVersion(smilesSource, undefined)).toBe(smilesSource)
    expect(() =>
      patchSmilesVersion(smilesSource.replace('?v=2.1.7', ''), '9.9.9'),
    ).toThrow(/cache-buster not applied/)
  })

  it('patchAbcRender with a pinned version bumps the ?v= and throws when the script anchor drifts', () => {
    const bumped = patchAbcRender(abcSource, '6.6.6')
    expect(bumped).toContain('abcjs_basic.min.js?v=6.6.6')
    // Script anchor renamed while the render anchor survives → MUST throw, not skip the bump.
    const renamedScript = abcSource.replace(
      'abcjs_basic.min.js',
      'abcjs_RENAMED.min.js',
    )
    expect(() => patchAbcRender(renamedScript, '6.6.6')).toThrow(
      /cache-buster not applied/,
    )
    // Unpinned (no version) legitimately skips the bump but still applies the render patch.
    expect(patchAbcRender(abcSource, undefined)).toContain('foregroundColor')
  })

  it('patchMarkmapStatic with a pinned version bumps the ?v= and throws when the script anchor drifts', () => {
    const bumped = patchMarkmapStatic(markmapSource, '7.7.7')
    expect(bumped).toContain('markmap.min.js?v=7.7.7')
    const renamedScript = markmapSource.replace(
      'markmap.min.js',
      'markmap_RENAMED.min.js',
    )
    expect(() => patchMarkmapStatic(renamedScript, '7.7.7')).toThrow(
      /cache-buster not applied/,
    )
  })
})

describe('error-box titles: esbuild-inlined markup mirrors the engine registry (185/2a)', () => {
  // diagram-error.ts derives its titles from the registry; the NATIVE renderers get the same
  // box inlined at build time by these patches. This pins the two to the SAME source of truth:
  // change a title in engine-registry.ts and this fails until the inlined markup follows.
  it('mermaid / flowchart / echarts / mindmap inline the registry title verbatim', async () => {
    const { engineByLang } = await import(
      '../../media-src/src/diagram-kit/engine-registry'
    )
    const titleMarkup = (lang: string) =>
      `vmarkd-diagram-error__title">${engineByLang(lang)?.errorTitle}<`
    expect(patchMermaidErrorRender(mermaidRenderSource)).toContain(
      titleMarkup('mermaid'),
    )
    expect(patchFlowchartError(flowchartSource)).toContain(
      titleMarkup('flowchart'),
    )
    expect(patchEchartsErrorBox(chartSource)).toContain(titleMarkup('echarts'))
    expect(patchMindmapErrorBox(mindmapSource)).toContain(
      titleMarkup('mindmap'),
    )
  })
})

// Task 365 — highlightRender must not descend into a rendered diagram. d2 markdown labels emit real
// `<pre><code>` inside a `<foreignObject>`, so without this the highlighter restyles diagram labels
// (hljs colours + the code-panel background) and, worse, does it in only ONE pane — which is how the
// IR and Preview markup diverged once Preview started reusing the IR render.
const highlightSource = read(
  '../../media-src/node_modules/vditor/src/ts/markdown/highlightRender.ts',
)

describe('patchHighlightSkipDiagrams (no hljs inside a rendered diagram)', () => {
  it('the shipped Vditor source highlights every pre > code, diagram labels included (pre-patch)', () => {
    expect(highlightSource).toContain('querySelectorAll("pre > code")')
    expect(highlightSource).not.toContain('closest("svg")')
  })

  it('adds an in-svg skip ahead of the existing marker-pre skip', () => {
    const patched = patchHighlightSkipDiagrams(highlightSource)
    expect(patched).toContain('block.closest("svg")')
    // The guard must come BEFORE the highlight call, not after it.
    expect(patched.indexOf('block.closest("svg")')).toBeLessThan(
      patched.indexOf('window.hljs.highlight'),
    )
    // Vditor's own skips survive untouched.
    expect(patched).toContain('vditor-ir__marker--pre')
  })

  it('throws if Vditor drops the anchor (version drift fails the build loudly)', () => {
    expect(() => patchHighlightSkipDiagrams('nothing to anchor on')).toThrow(
      /anchor not found/,
    )
  })
})

// Task 367 — the Preview render sanitises and Lute's sanitiser drops HTML comments, so an authored
// comment vanished from the pane while IR showed it. Pre-rewrite the markdown instead of turning
// sanitising off.

const previewIndexSource = read(
  '../../media-src/node_modules/vditor/src/ts/preview/index.ts',
)

describe('patchPreviewComments (comments survive the preview sanitiser)', () => {
  it('the shipped Vditor source feeds raw markdown straight to Lute (pre-patch)', () => {
    expect(previewIndexSource).toContain(
      'const markdownText = getMarkdown(vditor);',
    )
    expect(previewIndexSource).not.toContain('maskCommentsForPreview')
  })

  it('routes the markdown through the mask + imports it from the real module', () => {
    const patched = patchPreviewComments(previewIndexSource)
    expect(patched).toContain(
      'const markdownText = vmMaskCommentsForPreview(getMarkdown(vditor));',
    )
    expect(patched).toContain('html-comment')
    // The raw binding must be gone — both render branches read this one variable.
    expect(patched).not.toContain('const markdownText = getMarkdown(vditor);')
  })

  it('throws if Vditor drops the anchor (version drift fails the build loudly)', () => {
    expect(() => patchPreviewComments('nothing to anchor on')).toThrow(
      /anchor not found/,
    )
  })
})

// Task 371 — Vditor reads the language with `className.replace("language-", "")`, which assumes the
// element has exactly one class. True on the FIRST pass — but that pass appends `hljs`, so a SECOND
// pass computes "language-js hljs" -> "js hljs", which is not a language, falls back to plaintext,
// and re-renders the block with ZERO token spans. Reachable since the task-187 preview morph keeps
// unchanged blocks' live DOM across renders.
describe('patchHighlightLanguageClass (re-highlighting a block keeps its language)', () => {
  it('the shipped Vditor source derives the language from the whole className (pre-patch)', () => {
    expect(highlightSource).toContain(
      'let language = block.className.replace("language-", "");',
    )
  })

  it('reads the language from the language-* class only', () => {
    const patched = patchHighlightLanguageClass(highlightSource)
    expect(patched).toContain('block.className.match(')
    // The naive expression survives ONLY as the no-language-class fallback, never on its own line.
    expect(patched).not.toMatch(
      /let language = block\.className\.replace\("language-", ""\);/,
    )
  })

  it('the patched expression picks "js" out of an already-highlighted class list', () => {
    const patched = patchHighlightLanguageClass(highlightSource)
    const expr = /let language = (.*?);\n/.exec(patched)?.[1]
    expect(expr).toBeTruthy()
    const evalFor = (className: string) =>
      // biome-ignore lint/security/noGlobalEval: evaluating the patched expression is the point
      eval(
        `(block => { let language = ${expr}; return language })({ className: ${JSON.stringify(className)} })`,
      )
    expect(evalFor('language-js hljs')).toBe('js') // the bug: was "js hljs"
    expect(evalFor('language-js')).toBe('js')
    expect(evalFor('hljs language-python')).toBe('python') // order-independent
  })

  it('throws if Vditor drops the anchor (version drift fails the build loudly)', () => {
    expect(() => patchHighlightLanguageClass('nothing to anchor on')).toThrow(
      /anchor not found/,
    )
  })
})

// ── Task 390 — the link toolbar button ignored a selected URL ────────────────────────────────────
const wysiwygToolbarEventSource = read(
  '../../media-src/node_modules/vditor/src/ts/wysiwyg/toolbarEvent.ts',
)

describe('patchIrLinkSelectedUrl / patchWysiwygLinkSelectedUrl (selected URL → destination)', () => {
  it('the shipped sources drop the selection into the LABEL only (pre-patch)', () => {
    // IR builds `[selection](https://)`: the placeholder destination survives whatever was selected.
    expect(irProcessSource).toContain(
      'html = `${prefix}${range.toString()}${suffix.replace(")", "<wbr>)")}`;',
    )
    // WYSIWYG creates the <a> with an empty href and puts the selection in its text.
    expect(wysiwygToolbarEventSource).toContain(
      'node.setAttribute("href", "");',
    )
    expect(wysiwygToolbarEventSource).toContain(
      'node.innerHTML = range.toString();',
    )
  })

  it('IR routes a URL-shaped selection into BOTH halves of the link', () => {
    const patched = patchIrLinkSelectedUrl(irProcessSource)
    expect(patched).toContain(
      'window as any).__vmarkdSelectedUrl?.(range.toString())',
    )
    // Label AND destination come from the selection; the caret lands inside the finished link.
    expect(patched).toContain('](${vmarkdEsc(vmarkdUrl)}<wbr>)')
    // …and the edit is flagged EXPLICIT, so the host writes it even though `[url](url)` and the
    // bare autolinked URL are the same document under GFM.
    expect(patched).toContain('__vmarkdExplicitEdit?.()')
  })

  it('IR keeps the stock behaviour for ordinary text', () => {
    // The branch that makes the selection the label and parks the caret in the placeholder
    // destination must survive intact — that is the right behaviour for non-URL text.
    expect(patchIrLinkSelectedUrl(irProcessSource)).toContain(
      '`${prefix}${range.toString()}${suffix.replace(")", "<wbr>)")}`',
    )
  })

  it('IR escapes both halves, since it inserts an HTML string', () => {
    const patched = patchIrLinkSelectedUrl(irProcessSource)
    expect(patched).toContain('replace(/&/g, "&amp;")')
    expect(patched).toContain('vmarkdEsc(range.toString())')
  })

  it('WYSIWYG sets href from the selection before the popover opens', () => {
    const patched = patchWysiwygLinkSelectedUrl(wysiwygToolbarEventSource)
    expect(patched).toContain('node.setAttribute("href", vmarkdHref || "");')
    expect(patched).toContain('__vmarkdExplicitEdit?.()')
    // Order is load-bearing: genAPopover reads the node, so href must already be set.
    expect(patched.indexOf('__vmarkdSelectedUrl')).toBeLessThan(
      patched.indexOf('genAPopover(vditor, node, range);'),
    )
  })

  it('WYSIWYG falls back to an empty href when the selection is not a URL', () => {
    expect(patchWysiwygLinkSelectedUrl(wysiwygToolbarEventSource)).toContain(
      '|| "");',
    )
  })

  it('both throw (fail the build loudly) if their anchor drifts on a Vditor bump', () => {
    expect(() => patchIrLinkSelectedUrl('// unrelated source')).toThrow(
      /patchIrLinkSelectedUrl/,
    )
    expect(() => patchWysiwygLinkSelectedUrl('// unrelated source')).toThrow(
      /patchWysiwygLinkSelectedUrl/,
    )
  })
})

// ── Task 392 — pasting a URL produces a markdown link ────────────────────────────────────────────
describe('patchPasteTransform (task 242 — the shared pre-Vditor paste hook)', () => {
  it('the shipped source reads text/plain straight from the clipboard, unfiltered', () => {
    expect(fixBrowserSource).toContain(
      'textPlain = event.clipboardData.getData("text/plain");',
    )
    expect(fixBrowserSource).not.toContain('__vmarkdPasteTransform')
  })

  it('rewrites textPlain at the single point it is read, before any branch decides', () => {
    const patched = patchPasteTransform(fixBrowserSource)
    const hook = patched.indexOf('__vmarkdPasteTransform')
    const firstBranch = patched.indexOf('if (files && files.length > 0')
    expect(hook).toBeGreaterThan(-1)
    // Ordering is the whole point: a transform applied after a branch has already inspected the
    // text would leave that branch reading the unfiltered value.
    expect(hook, 'the hook runs before the paste branches').toBeLessThan(
      firstBranch === -1 ? Number.POSITIVE_INFINITY : firstBranch,
    )
  })

  it('leaves the drag-drop (dataTransfer) branch alone', () => {
    const patched = patchPasteTransform(fixBrowserSource)
    // A drop is a different gesture with its own handling; widening the anchor would cover it
    // silently. The dataTransfer read must remain exactly one occurrence, unhooked.
    const dropRead = 'textPlain = event.dataTransfer.getData("text/plain");'
    const after = patched.slice(patched.indexOf(dropRead) + dropRead.length)
    expect(after.slice(0, 80)).not.toContain('__vmarkdPasteTransform')
  })

  it('falls back to the raw text when the hook is absent (harness without our bundle)', () => {
    expect(patchPasteTransform(fixBrowserSource)).toContain(
      '?.(textPlain, vmarkdInCode) ?? textPlain',
    )
  })

  it('hands the transform the code context, using vditor own two expressions', () => {
    // The transform runs BEFORE vditor's codeElement branch exists, and pasting into a fence must
    // stay literal (task 191 P0-9) — so the context has to be computed at the hook site. Using the
    // same two expressions as the branch below keeps the two from disagreeing.
    const patched = patchPasteTransform(fixBrowserSource)
    expect(patched).toContain(
      'const vmarkdInCode = vditor.currentMode === "sv"',
    )
    expect(patched).toContain(
      'hasClosestByAttribute(event.target as Element, "data-type", "code-block")',
    )
    expect(patched).toContain(
      'hasClosestByMatchTag(event.target as Element, "CODE")',
    )
    // Both helpers must already be imported by the file, or the patch would not compile.
    expect(fixBrowserSource).toContain('hasClosestByAttribute')
    expect(fixBrowserSource).toContain('hasClosestByMatchTag')
  })

  it('throws on version drift rather than silently not patching', () => {
    expect(() => patchPasteTransform('nothing like the anchor')).toThrow(
      /clipboardData anchor not found/,
    )
  })
})

describe('patchPasteUrlAsLink', () => {
  it('the shipped source only handles the SELECTED-text case (pre-patch)', () => {
    // Vditor already wraps a selection when the clipboard holds a link destination…
    expect(fixBrowserSource).toContain(
      'if (range.toString() !== "" && vditor.lute.IsValidLinkDest(textPlain)) {',
    )
    // …and has no branch at all for pasting a URL with nothing selected.
    expect(fixBrowserSource).not.toContain('__vmarkdPasteUrlMd')
  })

  it('adds the no-selection branch without touching the selected-text one', () => {
    const patched = patchPasteUrlAsLink(fixBrowserSource)
    expect(patched, "Vditor's own selection wrap survives").toContain(
      'textPlain = `[${range.toString()}](${textPlain})`;',
    )
    expect(patched).toContain('__vmarkdPasteUrlMd?.(textPlain, vmarkdInLink)')
  })

  it('guards against pasting into an existing link', () => {
    const patched = patchPasteUrlAsLink(fixBrowserSource)
    expect(patched).toContain('vmarkdAnchor.closest("a")')
    expect(patched).toContain(`vmarkdAnchor.closest("[data-type='a']")`)
  })

  it('flags the rewrite as an explicit edit so it reaches the file', () => {
    // `[url](url)` and the bare URL are the same document under GFM; without this the
    // minimal-diff write-back keeps the original bytes and the paste appears to do nothing.
    expect(patchPasteUrlAsLink(fixBrowserSource)).toContain(
      '__vmarkdExplicitEdit?.()',
    )
  })

  it('throws (fails the build loudly) if the anchor drifts on a Vditor bump', () => {
    expect(() => patchPasteUrlAsLink('// unrelated source')).toThrow(
      /patchPasteUrlAsLink/,
    )
  })

  // Task 224 residual gap: the STOCK selection-wrap branch was ungated — vmarkd.editor.pasteUrlAsLink
  // only reached the collapsed-caret branch below it.
  it('gates the SELECTED-text wrap on __vmarkdPasteUrlEnabled', () => {
    const patched = patchPasteUrlAsLink(fixBrowserSource)
    expect(patched).toContain(
      '(window as any).__vmarkdPasteUrlEnabled?.() !== false',
    )
    // The gate must sit INSIDE Vditor's own condition, wrapping the same assignment — not replace
    // or duplicate it. Pulled from the PRE-patch source rather than a second hardcoded copy of the
    // anchor text, so this assertion can't silently drift out of sync with PASTE_LINK_ANCHOR itself.
    const stockIfLine = fixBrowserSource
      .split('\n')
      .find((l) => l.includes('vditor.lute.IsValidLinkDest(textPlain)'))
    expect(stockIfLine).toBeTruthy()
    const ifIdx = patched.indexOf(stockIfLine as string)
    const gateIdx = patched.indexOf(
      '__vmarkdPasteUrlEnabled?.() !== false',
      ifIdx,
    )
    const assignIdx = patched.indexOf(
      'textPlain = `[${range.toString()}](${textPlain})`;',
      gateIdx,
    )
    expect(ifIdx).toBeGreaterThanOrEqual(0)
    expect(gateIdx).toBeGreaterThan(ifIdx)
    expect(assignIdx).toBeGreaterThan(gateIdx)
  })

  it('replaces an existing link as a whole and keeps its visible label', () => {
    const patched = patchPasteUrlAsLink(fixBrowserSource)
    expect(patched).toContain(
      'const vmarkdLabelElement = vmarkdStartLink.querySelector(".vditor-ir__link")',
    )
    expect(patched).toContain('range.selectNode(vmarkdStartLink)')
    expect(patched).toContain('setSelectionFocus(range)')
    expect(patched).toContain(
      `textPlain = \`[\${vmarkdLabel}](\${textPlain})\``,
    )
  })

  it('does NOT gate the no-selection branch through the same accessor (that one keeps using __vmarkdPasteUrlMd)', () => {
    const patched = patchPasteUrlAsLink(fixBrowserSource)
    const elseIdx = patched.indexOf('else if (range.toString() === "")')
    const mdIdx = patched.indexOf(
      '__vmarkdPasteUrlMd?.(textPlain, vmarkdInLink)',
      elseIdx,
    )
    expect(elseIdx).toBeGreaterThan(0)
    expect(mdIdx).toBeGreaterThan(elseIdx)
  })
})

describe('patchInsertHtmlDelete (task 393 — paste over a selection)', () => {
  it('the shipped source deletes via execCommand before inserting (pre-patch)', () => {
    expect(selectionSource).toContain(
      'vditor[vditor.currentMode].preventInput = true;',
    )
    expect(selectionSource).toContain(
      'document.execCommand("delete", false, "");',
    )
  })

  it('replaces the execCommand delete with a synchronous range.deleteContents()', () => {
    const patched = patchInsertHtmlDelete(selectionSource)
    expect(patched).toContain('range.deleteContents();')
    expect(patched).not.toContain('document.execCommand("delete", false, "");')
  })

  it('does not set preventInput — deleteContents() fires no "input" event to swallow', () => {
    // Leaving the flag set would wrongly intercept the NEXT real keystroke's input event (see
    // ir/index.ts and wysiwyg/index.ts, both reset it only inside the input listener).
    const patched = patchInsertHtmlDelete(selectionSource)
    expect(patched).not.toContain('preventInput = true')
  })

  it('leaves the rest of insertHTML (the block-insert branch) untouched', () => {
    const patched = patchInsertHtmlDelete(selectionSource)
    expect(patched).toContain(
      'pasteElement.firstElementChild.getAttribute("data-block") === "0"',
    )
    expect(patched).toContain(
      'range.insertNode(pasteTemplate.content.cloneNode(true));',
    )
  })

  it('throws (fails the build loudly) if the anchor drifts on a Vditor bump', () => {
    expect(() => patchInsertHtmlDelete('// unrelated source')).toThrow(
      /patchInsertHtmlDelete/,
    )
  })
})

describe('patchSetRangeByWbrHeadingMarker (task 519 — heading typing drops a space)', () => {
  it('the shipped source gates the Chrome-bug ZWSP anchor to EM/STRONG/S only (pre-patch)', () => {
    expect(selectionSource).toContain(
      'wbrElement.previousElementSibling.tagName === "EM"',
    )
    expect(selectionSource).toContain(
      'wbrElement.previousElementSibling.tagName === "STRONG"',
    )
    expect(selectionSource).toContain(
      'wbrElement.previousElementSibling.tagName === "S"',
    )
    expect(selectionSource).not.toContain('vditor-ir__marker--heading')
  })

  it('widens the same Chrome-bug branch to also cover the heading marker span', () => {
    const patched = patchSetRangeByWbrHeadingMarker(selectionSource)
    // The original EM/STRONG/S check must survive untouched — this widens, not replaces.
    expect(patched).toContain(
      'wbrElement.previousElementSibling.tagName === "EM"',
    )
    expect(patched).toContain(
      'wbrElement.previousElementSibling.tagName === "STRONG"',
    )
    expect(patched).toContain(
      'wbrElement.previousElementSibling.tagName === "S"',
    )
    expect(patched).toContain(
      '(wbrElement.previousElementSibling as HTMLElement).classList.contains("vditor-ir__marker--heading")',
    )
    // Still inside the SAME isChrome() guard, not a separate unconditional branch.
    const chromeIdx = patched.indexOf('if (isChrome() && (')
    const headingIdx = patched.indexOf('vditor-ir__marker--heading')
    const closeIdx = patched.indexOf(
      'range.insertNode(document.createTextNode(Constants.ZWSP));',
    )
    expect(chromeIdx).toBeGreaterThan(0)
    expect(headingIdx).toBeGreaterThan(chromeIdx)
    expect(closeIdx).toBeGreaterThan(headingIdx)
  })

  it('leaves the ZWSP-insert body and the rest of setRangeByWbr untouched', () => {
    const patched = patchSetRangeByWbrHeadingMarker(selectionSource)
    expect(patched).toContain(
      'range.insertNode(document.createTextNode(Constants.ZWSP));',
    )
    expect(patched).toContain('range.collapse(false);')
    expect(patched).toContain('wbrElement.remove();')
  })

  it('throws (fails the build loudly) if the anchor drifts on a Vditor bump', () => {
    expect(() =>
      patchSetRangeByWbrHeadingMarker('// unrelated source'),
    ).toThrow(/patchSetRangeByWbrHeadingMarker/)
  })
})

describe('patchCutDeleteSync (task 387 — cutting a real selection)', () => {
  // Runs on the OUTPUT of patchClipboardCollapsed (task 385), exactly as the build composes them
  // — the raw vendored source has no `vmarkdCollapsed` guard to anchor on.
  const guarded = () => patchClipboardCollapsed(editorCommonEventSource)

  it('the task-385 guarded delete is still execCommand-based (pre-patch)', () => {
    expect(guarded()).toContain(
      'if (!vmarkdCollapsed) { document.execCommand("delete"); }',
    )
  })

  it('replaces it with a synchronous deleteContents() + hand-driven input, gated by mode', () => {
    const patched = patchCutDeleteSync(guarded())
    expect(patched).not.toContain(
      'if (!vmarkdCollapsed) { document.execCommand("delete"); }',
    )
    expect(patched).toContain('vmarkdCutRange.deleteContents();')
    expect(patched).toContain('vmarkdWysiwygInput(vditor, vmarkdCutRange);')
    expect(patched).toContain('vmarkdIRInput(vditor, vmarkdCutRange);')
  })

  it('leaves sv on the original execCommand("delete") call — deleteContents() broke it', () => {
    // Measured: sv's execCommand("delete") is not re-entrant (unlike ir/wysiwyg's) and sv has no
    // IRInput/wysiwyg-input equivalent to re-drive by hand, so routing it through deleteContents()
    // anyway silently no-ops the cut (caught by a real-VS-Code regression test, not inspection).
    const patched = patchCutDeleteSync(guarded())
    expect(patched).toContain(
      'if (vditor.currentMode === "sv") {\n                    document.execCommand("delete");',
    )
  })

  it('imports IRInput and wysiwyg input alongside the existing selection helpers', () => {
    const patched = patchCutDeleteSync(guarded())
    expect(patched).toContain(
      'import {getCursorPosition, getEditorRange, setSelectionFocus} from "./selection";',
    )
    expect(patched).toContain(
      'import {input as vmarkdIRInput} from "../ir/input";',
    )
    expect(patched).toContain(
      'import {input as vmarkdWysiwygInput} from "../wysiwyg/input";',
    )
  })

  it('imports hasClosestBlock alongside the existing hasClosest helpers', () => {
    const patched = patchCutDeleteSync(guarded())
    expect(patched).toContain(
      'import {hasClosestBlock, hasClosestByAttribute, hasClosestByMatchTag} from "./hasClosest";',
    )
  })

  it('merges two boundary paragraphs when a selection spans several top-level blocks', () => {
    // Range.deleteContents() does not merge block-level ancestors — this is the fix for that,
    // scoped to the plain case (both sides ordinary <p> paragraphs, direct children of the editor).
    const patched = patchCutDeleteSync(guarded())
    expect(patched).toContain(
      'vmarkdStartBlock.tagName === "P" && vmarkdEndBlock.tagName === "P"',
    )
    expect(patched).toContain(
      'vmarkdStartBlock.parentElement === vmarkdEditorEl',
    )
    expect(patched).toContain('vmarkdEndBlock.parentElement === vmarkdEditorEl')
    expect(patched).toContain(
      'vmarkdStartBlock.appendChild(vmarkdEndBlock.firstChild)',
    )
    expect(patched).toContain('vmarkdEndBlock.remove();')
  })

  it('captures the start/end blocks BEFORE deleteContents() collapses the range', () => {
    // hasClosestBlock(startContainer)/(endContainer) must run on the ORIGINAL (non-collapsed)
    // range — after deleteContents() the range is already collapsed and only describes one point.
    const patched = patchCutDeleteSync(guarded())
    const closestIdx = patched.indexOf(
      'hasClosestBlock(vmarkdCutRange.startContainer)',
    )
    const deleteIdx = patched.indexOf('vmarkdCutRange.deleteContents();')
    expect(closestIdx).toBeGreaterThan(-1)
    expect(deleteIdx).toBeGreaterThan(-1)
    expect(closestIdx).toBeLessThan(deleteIdx)
  })

  it('throws (fails the build loudly) if the anchor drifts on a Vditor bump', () => {
    expect(() => patchCutDeleteSync('// unrelated source')).toThrow(
      /patchCutDeleteSync/,
    )
  })
})

// Task 441 — a list marker must become a list on the SPACE, not only once a content character
// follows. BOTH surfaces ship the same `endSpace` early-return, and both already carve out ATX
// headings from it (Vditor issue #729) so `# ` becomes a heading on the space; these patches widen
// that identical carve-out to ordered/unordered list markers. The two live in DIFFERENT files —
// ir/input.ts (inside input()) vs wysiwyg/index.ts (the input LISTENER, which returns before input()
// is even called) — which is exactly the asymmetry the first cut of this fix missed: it patched IR
// only, and the real-VS-Code e2e caught WYSIWYG still producing a plain paragraph.
describe('list marker forms a list on the space (task 441)', () => {
  const WIDENED =
    '/^(?:#{1,6}|\\d{1,9}[.)]|[-*+]) $/.test(blockElement.textContent)'

  it('both shipped sources carry the heading-only endSpace carve-out (pre-patch)', () => {
    expect(irInputSource).toContain(
      'if (endSpace && /^#{1,6} $/.test(blockElement.textContent)) {',
    )
    expect(wysiwygSource).toContain(
      'if (endSpace && /^#{1,6} $/.test(blockElement.textContent)) {',
    )
  })

  it('widens the carve-out to list markers in IR', () => {
    expect(patchIrListMarkerOnSpace(irInputSource)).toContain(WIDENED)
  })

  it('widens the carve-out to list markers in WYSIWYG', () => {
    expect(patchWysiwygListMarkerOnSpace(wysiwygSource)).toContain(WIDENED)
  })

  it('each throws on version drift, naming its own file', () => {
    expect(() => patchIrListMarkerOnSpace('// nothing')).toThrow(
      /patchIrListMarkerOnSpace/,
    )
    expect(() => patchWysiwygListMarkerOnSpace('// nothing')).toThrow(
      /patchWysiwygListMarkerOnSpace/,
    )
  })

  it('the widened regex matches every marker form and nothing mid-sentence', () => {
    const re = /^(?:#{1,6}|\d{1,9}[.)]|[-*+]) $/
    for (const ok of [
      '# ',
      '###### ',
      '1. ',
      '9. ',
      '9) ',
      '123456789. ',
      '- ',
      '* ',
      '+ ',
    ]) {
      expect(re.test(ok), ok).toBe(true)
    }
    for (const no of ['text 1. ', '1.', '- x', '1234567890. ', '', ' - ']) {
      expect(re.test(no), no).toBe(false)
    }
  })
})

describe('patchUploadFilesKindFilter (task 517 — mixed string+file drop)', () => {
  // Confirms the shipped source slices by filesMax BEFORE inspecting entry kinds. That order is
  // the bug: with a text/plain sibling, Chromium enumerates the STRING item first, so files[0]
  // is a string whose getAsFile() is null and the real File is never reached.
  it('the shipped Vditor source slices by filesMax before filtering by kind (pre-patch)', () => {
    expect(uploadSource).toContain(
      'const filesMax = vditor.options.upload.multiple === true ? files.length : 1;',
    )
    expect(uploadSource).not.toContain('entry.kind === "file"')
  })

  it('drops non-file DataTransfer entries before the filesMax slice', () => {
    const patched = patchUploadFilesKindFilter(uploadSource)
    expect(patched).toContain('entry.kind === "file"')
    // The filter must come BEFORE the slice, or it changes nothing.
    expect(patched.indexOf('entry.kind === "file"')).toBeLessThan(
      patched.indexOf('const filesMax ='),
    )
  })

  it('throws (fails the build loudly) if the anchor is gone — version-bump guard', () => {
    expect(() => patchUploadFilesKindFilter('// unrelated source')).toThrow(
      /patchUploadFilesKindFilter/,
    )
  })
})

// Task 528 — the three Vditor 3.11.3 neutralisations.
describe('patchLuteHook (task 528: native callout forced off)', () => {
  it('3.11.3 turns native callouts on from the option (pre-patch)', () => {
    expect(setLuteSource).toContain('lute.SetCallout(options.callout);')
  })

  it("forces SetCallout(false) AFTER Vditor's own call, before the returned instance", () => {
    const patched = patchLuteHook(setLuteSource)
    const own = patched.indexOf('lute.SetCallout(options.callout);')
    const forced = patched.indexOf('lute.SetCallout(false);')
    expect(forced).toBeGreaterThan(own)
    expect(forced).toBeLessThan(patched.lastIndexOf('return lute;'))
    expect(patched).toContain('lute.SetHeadingID(true);')
  })

  it('throws if the anchor is gone — version-bump guard', () => {
    expect(() => patchLuteHook('// unrelated source')).toThrow(/patchLuteHook/)
  })
})

describe('patchWavedromRender (task 528: native WaveDrom renderer neutralised)', () => {
  it('3.11.3 ships a native renderer that loads its own wavedrom bundle (pre-patch)', () => {
    expect(wavedromSource).toContain('dist/js/wavedrom/wavedrom.min.js')
    expect(wavedromSource).toContain('vditorWavedromScript')
  })

  it('replaces the body with a no-op that keeps the export', () => {
    const patched = patchWavedromRender(wavedromSource)
    expect(patched).toContain('export const wavedromRender')
    expect(patched).not.toContain('addScript')
    expect(patched).not.toContain('vditorWavedromScript')
    expect(patched).not.toContain('renderWaveElement')
  })

  it('throws if the anchor is gone — version-bump guard', () => {
    expect(() => patchWavedromRender('// unrelated source')).toThrow(
      /patchWavedromRender/,
    )
  })
})

// Task 83 (increment 2) — the Preview overlay / split pane renders with `vditor.lute.Md2HTML`, which
// keeps Lute's SoftBreak2HardBreak default (soft break -> <br>). Route that one call through our hook.
describe('patchPreviewReflow (task 83: soft line breaks flow in the preview)', () => {
  const previewSource = read(
    '../../media-src/node_modules/vditor/src/ts/preview/index.ts',
  )
  const morphed = patchPreviewMorph(previewSource)

  it('routes the non-xhr Md2HTML call through the __vmarkdPreviewMd2HTML hook, once', () => {
    const patched = patchPreviewReflow(morphed)
    expect(patched).toContain('__vmarkdPreviewMd2HTML')
    expect(patched.match(/__vmarkdPreviewMd2HTML/g)).toHaveLength(1)
    // The hook is optional: without it the stock call still runs.
    expect(patched).toMatch(/vditor\.lute\.Md2HTML\(markdownText\)/)
    // The xhr fallback keeps the stock call.
    expect(
      patched.match(/let html = vditor\.lute\.Md2HTML\(markdownText\);/g),
    ).toHaveLength(1)
  })

  it('composes with patchPreviewMorph in the registry entry', () => {
    const entry = VDITOR_TS_PATCHES.find((e) =>
      e.file.test('vditor/src/ts/preview/index.ts'),
    )
    const out = entry!.transform(previewSource, 'preview/index.ts')
    expect(out).toContain('__vmarkdPreviewMd2HTML')
    expect(out).toContain('__vmarkdMorphPreview')
  })

  it('throws (fails the build loudly) if the anchor is gone', () => {
    expect(() => patchPreviewReflow('// unrelated source')).toThrow(
      /patchPreviewReflow/,
    )
  })

  it('throws if the anchor is not unique', () => {
    expect(() => patchPreviewReflow(morphed + morphed)).toThrow(
      /patchPreviewReflow/,
    )
  })
})

// Task 83 (increment 3) — the undo snapshot is taken from a clone of the editor with the soft-break
// marker spans unwrapped, so decoration never lands in (or diffs against) the undo stack.
describe('patchUndoSnapshotStripSoftBreaks (task 83: marker spans stay out of undo snapshots)', () => {
  const undoSource = read(
    '../../media-src/node_modules/vditor/src/ts/undo/index.ts',
  )

  it('unwraps the spans in the clone right before it is serialised, once', () => {
    const patched = patchUndoSnapshotStripSoftBreaks(undoSource)
    expect(patched.match(/\.vmarkd-softbreak/g)).toHaveLength(1)
    const strip = patched.indexOf('.vmarkd-softbreak')
    const serialise = patched.indexOf('const text = cloneElement.innerHTML;')
    expect(strip).toBeGreaterThan(-1)
    expect(strip).toBeLessThan(serialise)
  })

  it('is part of the undo/index.ts registry chain', () => {
    const entry = VDITOR_TS_PATCHES.find((e) =>
      e.file.test('vditor/src/ts/undo/index.ts'),
    )
    expect(entry!.transform(undoSource, 'undo/index.ts')).toContain(
      '.vmarkd-softbreak',
    )
  })

  it('throws if the anchor is gone or not unique', () => {
    expect(() => patchUndoSnapshotStripSoftBreaks('// unrelated')).toThrow(
      /patchUndoSnapshotStripSoftBreaks/,
    )
    expect(() =>
      patchUndoSnapshotStripSoftBreaks(undoSource + undoSource),
    ).toThrow(/patchUndoSnapshotStripSoftBreaks/)
  })
})
