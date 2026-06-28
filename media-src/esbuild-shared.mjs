// Shared esbuild config for importing Vditor from *source* (task 20), used by
// both the production bundle (build.mjs) and the e2e harness server (e2e/serve.mjs).
// The harnesses import main.ts's modules, so they need the exact same treatment.
//
//  - define VDITOR_VERSION   : source uses it as a `declare const` → else throws.
//  - useDefineForClassFields : false → Vditor MenuItem class-field init works.
//  - loader '.less': 'empty' : `vditor/src/index.ts` imports `index.less`; the
//                              compiled `vditor/dist/index.css` is shipped instead.
//  - stubUnusedVditorButtons : redirect 4 unused toolbar buttons to empty stubs
//                              (toolbar/index.ts imports them statically).
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const vditorVersion = JSON.parse(
  readFileSync(
    new URL('./node_modules/vditor/package.json', import.meta.url),
    'utf8',
  ),
).version

// The vendored Lute pin (commit + date), surfaced in the About dialogs. Read once
// here so both the fixInfoDialog patch and the build-time `define` (used by the
// vMarkd About dialog in toolbar.ts) share one source of truth. null if unpinned.
let lutePin = null
try {
  lutePin = JSON.parse(
    readFileSync(new URL('./vendor/lute/source.json', import.meta.url), 'utf8'),
  )
} catch {
  lutePin = null
}

// The vendored Mermaid pin (build.mjs `syncMermaid` overwrites Vditor's bundled
// mermaid.min.js with this version — task 86). null if unpinned.
let mermaidPin = null
try {
  mermaidPin = JSON.parse(
    readFileSync(
      new URL('./vendor/mermaid/source.json', import.meta.url),
      'utf8',
    ),
  )
} catch {
  mermaidPin = null
}

// The vendored ECharts pin (build.mjs `syncEcharts` overwrites Vditor's bundled
// echarts.min.js with this version — task 89). null if unpinned.
let echartsPin = null
try {
  echartsPin = JSON.parse(
    readFileSync(
      new URL('./vendor/echarts/source.json', import.meta.url),
      'utf8',
    ),
  )
} catch {
  echartsPin = null
}

// The vendored abcjs pin (build.mjs `syncAbcjs` overwrites Vditor's bundled
// abcjs_basic.min.js with this version — task 92). null if unpinned.
let markmapPin = null
try {
  markmapPin = JSON.parse(
    readFileSync(
      new URL('./vendor/markmap/source.json', import.meta.url),
      'utf8',
    ),
  )
} catch {
  markmapPin = null
}

let smilesDrawerPin = null
try {
  smilesDrawerPin = JSON.parse(
    readFileSync(
      new URL('./vendor/smiles-drawer/source.json', import.meta.url),
      'utf8',
    ),
  )
} catch {
  smilesDrawerPin = null
}

let abcjsPin = null
try {
  abcjsPin = JSON.parse(
    readFileSync(
      new URL('./vendor/abcjs/source.json', import.meta.url),
      'utf8',
    ),
  )
} catch {
  abcjsPin = null
}

const stubPath = fileURLToPath(
  new URL('./src/stubs/vditor-toolbar-stubs.ts', import.meta.url),
)

export const stubUnusedVditorButtons = {
  name: 'stub-vditor-buttons',
  setup(build) {
    build.onResolve(
      { filter: /^\.\/(Br|Fullscreen|Record|Export|Help)$/ },
      (args) => {
        if (
          args.importer.replace(/\\/g, '/').includes('vditor/src/ts/toolbar')
        ) {
          return { path: stubPath }
        }
        return null
      },
    )
  },
}

// Vditor's undo/index.ts does `import * as DiffMatchPatch from "diff-match-patch"`
// then `new DiffMatchPatch()`. diff-match-patch is a CommonJS module whose
// `module.exports` IS the constructor, so the ES-namespace object esbuild builds
// is NOT callable → `new` throws "is not a constructor" at runtime (undo breaks).
// The prebuilt vditor/dist hid this via its own bundler's esModuleInterop; bundling
// from source (task 20) re-exposes it. Rewrite that single import to a *default*
// import, which esbuild resolves to the CJS function-with-statics — so both
// `new DiffMatchPatch()` and `DiffMatchPatch.patch_obj`/static access work.
export function patchDmpInterop(code) {
  return code.replace(
    /import \* as DiffMatchPatch from "diff-match-patch";/,
    'import DiffMatchPatch from "diff-match-patch";',
  )
}

// Task 62 — link-click UX, gated on our runtime policy. Vditor's IR and WYSIWYG
// click handlers open a link on ANY click (`if (linkEl) { …open…; return; }`),
// which our window.open override / fixLinkClick route to the host. We gate that
// open branch on `window.__vmarkdShouldOpenLink(event)` (installed from
// link-open-policy.ts) so behaviour follows the `linkOpenWithModifier` setting:
// in the default 'modifier' mode a plain click falls through to editing and only
// Ctrl/Cmd+click follows the link; in 'click' mode it opens on any click. Falls
// back to true (legacy open) if the gate isn't installed. Anchored single-line
// rewrites of each outer condition; throw if the anchor drifts on a Vditor bump.
const LINK_GATE =
  '(window.__vmarkdShouldOpenLink ? window.__vmarkdShouldOpenLink(event) : true)'

const IR_LINK_ANCHOR =
  'if (aElement && (!aElement.classList.contains("vditor-ir__node--expand"))) {'
export function patchIrLinkClick(code) {
  if (!code.includes(IR_LINK_ANCHOR)) {
    throw new Error(
      'fixIrLinkClick: anchor not found in vditor ir/index.ts (version drift?)',
    )
  }
  return code.replace(
    IR_LINK_ANCHOR,
    'if (aElement && (!aElement.classList.contains("vditor-ir__node--expand")) && ' +
      `${LINK_GATE}) {`,
  )
}

const WYSIWYG_LINK_ANCHOR =
  'const a = hasClosestByMatchTag(event.target, "A");\n            if (a) {'
export function patchWysiwygLinkClick(code) {
  if (!code.includes(WYSIWYG_LINK_ANCHOR)) {
    throw new Error(
      'fixWysiwygLinkClick: anchor not found in vditor wysiwyg/index.ts (version drift?)',
    )
  }
  return code.replace(
    WYSIWYG_LINK_ANCHOR,
    'const a = hasClosestByMatchTag(event.target, "A");\n' +
      `            if (a && ${LINK_GATE}) {`,
  )
}

// Clicking a rendered WYSIWYG code block opens its source but Vditor's `showCode` collapses the
// caret to the block START (`first=true` → `range.collapse(true)`), so clicking a specific line
// jumps to the top. Land the caret at the CLICKED position instead. We capture the clicked character
// offset from the PREVIEW's `<code>` text BEFORE `showCode` runs (text-based, so it's immune to the
// `scrollCenter` that `showCode` does), then map that offset into the now-visible source's text
// nodes. Falls back to Vditor's start if anything doesn't line up (caretRangeFromPoint missing, click
// outside the code, etc.). Scoped to `data-type="code-block"` so other previews are untouched.
const WYSIWYG_CODE_CLICK_ANCHOR =
  'if (previewElement) {\n                showCode(previewElement, vditor);\n            }'
export function patchWysiwygCodeClickCaret(code) {
  if (!code.includes(WYSIWYG_CODE_CLICK_ANCHOR)) {
    throw new Error(
      'fixWysiwygCodeClickCaret: anchor not found in vditor wysiwyg/index.ts (version drift?)',
    )
  }
  const replacement = `if (previewElement) {
                let vmCkOffset = -1;
                const vmCkBlock = previewElement.parentElement;
                if (vmCkBlock && vmCkBlock.getAttribute("data-type") === "code-block"
                    && typeof event.clientX === "number" && event.clientX > 0) {
                    const vmCkDoc = previewElement.ownerDocument;
                    const vmCkPt = vmCkDoc.caretRangeFromPoint
                        ? vmCkDoc.caretRangeFromPoint(event.clientX, event.clientY) : null;
                    const vmCkPvCode = previewElement.querySelector("code") || previewElement;
                    if (vmCkPt && vmCkPvCode.contains(vmCkPt.startContainer)) {
                        const vmCkM = vmCkDoc.createRange();
                        vmCkM.setStart(vmCkPvCode, 0);
                        vmCkM.setEnd(vmCkPt.startContainer, vmCkPt.startOffset);
                        vmCkOffset = vmCkM.toString().length;
                    }
                }
                showCode(previewElement, vditor);
                if (vmCkOffset >= 0) {
                    const vmCkPre = previewElement.previousElementSibling;
                    const vmCkSrc = vmCkPre && vmCkPre.tagName === "PRE"
                        ? (vmCkPre.querySelector("code") || vmCkPre) : vmCkPre;
                    if (vmCkSrc) {
                        const vmCkDoc2 = previewElement.ownerDocument;
                        const vmCkW = vmCkDoc2.createTreeWalker(vmCkSrc, NodeFilter.SHOW_TEXT);
                        let vmCkRem = vmCkOffset, vmCkN = vmCkW.nextNode(), vmCkT = null, vmCkTo = 0;
                        while (vmCkN) {
                            const vmCkL = vmCkN.nodeValue.length;
                            if (vmCkRem <= vmCkL) { vmCkT = vmCkN; vmCkTo = vmCkRem; break; }
                            vmCkRem -= vmCkL; vmCkN = vmCkW.nextNode();
                        }
                        if (vmCkT) {
                            const vmCkR = vmCkDoc2.createRange();
                            vmCkR.setStart(vmCkT, vmCkTo); vmCkR.collapse(true);
                            const vmCkS = vmCkDoc2.getSelection();
                            vmCkS.removeAllRanges(); vmCkS.addRange(vmCkR);
                        }
                    }
                }
            }`
  return code.replace(WYSIWYG_CODE_CLICK_ANCHOR, replacement)
}

// Task 56 — listToggle null-deref crash. In fixBrowserBehavior.ts `listToggle`,
// the uncheck branch guards only the clicked <li> for an <input> then iterates
// ALL sibling <li>; a sibling without a checkbox throws on `.remove()` of null.
// Add optional chaining so the toggle never crashes on a mixed list. (The wider
// "mutates all siblings" scoping is a separate, runtime-repro-first change.)
const LIST_TOGGLE_ANCHOR = 'item.querySelector("input").remove()'
export function patchListToggle(code) {
  if (!code.includes(LIST_TOGGLE_ANCHOR)) {
    throw new Error(
      'fixListToggle: anchor not found in vditor fixBrowserBehavior.ts (version drift?)',
    )
  }
  return code.replaceAll(
    LIST_TOGGLE_ANCHOR,
    'item.querySelector("input")?.remove()',
  )
}
// Callout arrow navigation. Two defects around our callout dual-node (callouts.ts):
// 1. The injected `.vmarkd-callout__preview` (contenteditable=false, LAST child) duplicates
//    the callout's text inside `element.textContent`, so insertAfterBlock's "caret is on the
//    last line" check (`substr(position.start).indexOf("\n") === -1`) never passes — arrowing
//    down out of a callout (incl. at end-of-file, where Vditor would splice the trailing
//    paragraph you type into) silently did nothing. Compare against the EDITABLE text
//    (preview stripped); the preview is the LAST child so `position.start` itself is sound.
// 2. insertAfterBlock/insertBeforeBlock splice the in-between paragraph only for TABLE /
//    `data-type` neighbours; otherwise they do `selectNodeContents(neighbour)` INTO it. Two
//    problems that fix:
//    a. adjacent callouts are plain BLOCKQUOTEs, so there was NO way to insert a line between
//       two callouts → add `data-callout` neighbours to the splice set.
//    b. our floating table-edit panel (`#fix-table-ir-wrapper`, fix-table-ir.ts) is a
//       `contenteditable=false` 0×0 box pinned at top:0 appended as the editor's LAST child —
//       so it is a table's `nextElementSibling`. Vditor's selectNodeContents drops the caret
//       INTO it and the page scrolls to the top ("jump to top" at end-of-file). Treat any
//       `contenteditable=false` neighbour as a splice boundary → Vditor inserts a paragraph
//       between instead of entering the helper. (The gap-paragraph observer reclaims it when
//       left empty, exactly like the code-block gap.)
const CALLOUT_TEXT_HELPER = `const vmarkdEditableText = (el: HTMLElement): string => {
    if (!el.querySelector(":scope > .vmarkd-callout__preview")) {
        return el.textContent;
    }
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".vmarkd-callout__preview").forEach((p) => p.remove());
    return clone.textContent;
};
`
const ARROW_DOWN_ANCHOR =
  'if ((event.key === "ArrowDown" && element.textContent.trimRight().substr(position.start).indexOf("\\n") === -1) ||\n' +
  '        (event.key === "ArrowRight" && position.start >= element.textContent.trimRight().length)) {'
const ARROW_AFTER_SPLICE_ANCHOR =
  '(nextElement && (nextElement.tagName === "TABLE" || nextElement.getAttribute("data-type")))'
const ARROW_BEFORE_SPLICE_ANCHOR =
  '(previousElement && (previousElement.tagName === "TABLE" || previousElement.getAttribute("data-type")))'
const INSERT_AFTER_EXPORT_ANCHOR = 'export const insertAfterBlock = '
export function patchCalloutArrowNav(code) {
  for (const anchor of [
    ARROW_DOWN_ANCHOR,
    ARROW_AFTER_SPLICE_ANCHOR,
    ARROW_BEFORE_SPLICE_ANCHOR,
    INSERT_AFTER_EXPORT_ANCHOR,
  ]) {
    if (!code.includes(anchor)) {
      throw new Error(
        'fixCalloutArrowNav: anchor not found in vditor fixBrowserBehavior.ts (version drift?)',
      )
    }
  }
  return code
    .replace(
      INSERT_AFTER_EXPORT_ANCHOR,
      CALLOUT_TEXT_HELPER + INSERT_AFTER_EXPORT_ANCHOR,
    )
    .replace(
      ARROW_DOWN_ANCHOR,
      'if ((event.key === "ArrowDown" && vmarkdEditableText(element).trimRight().substr(position.start).indexOf("\\n") === -1) ||\n' +
        '        (event.key === "ArrowRight" && position.start >= vmarkdEditableText(element).trimRight().length)) {',
    )
    .replace(
      ARROW_AFTER_SPLICE_ANCHOR,
      '(nextElement && (nextElement.tagName === "TABLE" || nextElement.getAttribute("data-type") || nextElement.hasAttribute("data-callout") || nextElement.getAttribute("contenteditable") === "false"))',
    )
    .replace(
      ARROW_BEFORE_SPLICE_ANCHOR,
      '(previousElement && (previousElement.tagName === "TABLE" || previousElement.getAttribute("data-type") || previousElement.hasAttribute("data-callout") || previousElement.getAttribute("contenteditable") === "false"))',
    )
}
// patchOutlineCurrent: Vditor's Outline toolbar item marks itself "current" (the
// accent/blue active highlight) with `if (vditor.options.outline)` — but
// options.outline is an OBJECT ({enable, position}), always truthy, so the button
// is highlighted on init even when the outline panel is closed (enable:false). The
// instant-paint toolbar clone then freezes that blue, and the live editor clears it
// a beat later via outline.toggle → a blue→white flash on the closed outline button.
// Gate the highlight on `.enable` so it matches the actual panel state.
const OUTLINE_CURRENT_ANCHOR = 'if (vditor.options.outline) {'
export function patchOutlineCurrent(code) {
  if (!code.includes(OUTLINE_CURRENT_ANCHOR)) {
    throw new Error(
      'fixOutlineCurrent: anchor not found in vditor toolbar/Outline.ts (version drift?)',
    )
  }
  return code.replace(
    OUTLINE_CURRENT_ANCHOR,
    'if (vditor.options.outline.enable) {',
  )
}
// patchIrBlurExpand: Vditor's blurEvent (editorCommonEvent.ts) removes `vditor-ir__node--expand`
// from the edited node on EVERY blur. In the VS Code webview a click inside the editor causes a
// transient blur→refocus, so --expand is dropped mid-click → our CSS stops hiding the rendered
// `.vditor-ir__preview` → the syntax-highlighted render flashes until mouseup re-expands it (very
// visible when clicking to reposition the caret in a code block). Defer the collapse to the next
// frame and skip it if focus has returned to the editor — so a transient blur no longer collapses,
// while a genuine blur (focus truly left) still collapses one frame later.
const IR_BLUR_EXPAND_ANCHOR =
  'expandElement.classList.remove("vditor-ir__node--expand");'
export function patchIrBlurExpand(code) {
  if (!code.includes(IR_BLUR_EXPAND_ANCHOR)) {
    throw new Error(
      'fixIrBlurExpand: anchor not found in vditor util/editorCommonEvent.ts (version drift?)',
    )
  }
  return code.replace(
    IR_BLUR_EXPAND_ANCHOR,
    'requestAnimationFrame(() => { const ae = document.activeElement; ' +
      'if (ae !== editorElement && !editorElement.contains(ae)) { ' +
      'expandElement.classList.remove("vditor-ir__node--expand"); } });',
  )
}
// Task 57 — KaTeX error resilience. Vditor's `katex.renderToString` (mathRender.ts)
// passes no `throwOnError`/`strict`, so one malformed formula can throw and break
// the render instead of showing KaTeX's inline red error. Inject the resilient
// options into the (single) katex call. Anchored on the call open so the MathJax
// branch that shares `macros: options.math.macros` is left untouched.
const MATH_ANCHOR = 'katex.renderToString(math, {'
export function patchMathRender(code) {
  if (!code.includes(MATH_ANCHOR)) {
    throw new Error(
      'fixMathRender: anchor not found in vditor mathRender.ts (version drift?)',
    )
  }
  return code.replace(
    MATH_ANCHOR,
    `${MATH_ANCHOR}\n                            strict: false,\n                            throwOnError: false,`,
  )
}
// preview/index.ts shows a hardcoded Chinese toast on Ctrl+C in preview mode
// (`vditor.tip.show(`已复制到剪切板`)` — NOT routed through VditorI18n), so an
// English-locale user copying from the preview sees "已复制到剪切板". vMarkd only ever
// calls copyToX with type "default", so the zhihu/wechat branch is dead here — just
// translate the literal the user actually hits to English.
const COPY_TIP_ANCHOR = '已复制到剪切板'
export function patchPreviewCopyTip(code) {
  if (!code.includes(COPY_TIP_ANCHOR)) {
    throw new Error(
      'fixPreviewCopyTip: anchor not found in vditor preview/index.ts (version drift?)',
    )
  }
  return code.replaceAll(COPY_TIP_ANCHOR, 'Copied to clipboard')
}
// Task 63 (paste) — content-based code-block detection on paste. Vditor's
// `processPasteCode` (util/processCode.ts) forced pasted content into a code block
// from IDE-source MARKERS (VS Code monospace font, any single <pre>, Xcode `p1`,
// web-source table), so pasting markdown-with-HTML (#1917) or math (#1914) became a
// code block. Port upstream PR #1921: drop the marker heuristics and decide from
// the CONTENT — a <pre> is code only if it has a <code> child or the text looks
// like code (multi-line + ≥2 of: braces/semicolons, code keywords, html tags,
// indentation). The titular tab-indent case is separate (CommonMark indented-code
// in Lute's SpinVditorDOM) and intentionally not changed here.
const looksLikeCodeContentSrc = `const looksLikeCodeContent = (content: string) => {
    const text = content.trim();
    if (!text) {
        return false;
    }
    const lines = text.split("\\n");
    if (lines.length < 2) {
        return false;
    }
    let score = 0;
    if (/[{};]/.test(text)) {
        score++;
    }
    if (/\\b(const|let|var|function|class|interface|if|else|for|while|return)\\b/.test(text)) {
        score++;
    }
    if (/<\\/?[a-z][^>]*>/.test(text)) {
        score++;
    }
    if (/^\\s{2,}|\\t/m.test(text)) {
        score++;
    }
    return score >= 2;
};
`
const PC_DETECT_START = 'let isCode = false;'
const PC_DETECT_END = '\n    if (isCode) {'
const PC_FN_ANCHOR =
  'export const processPasteCode = (html: string, text: string, type = "sv") => {'
const PC_NEW_DETECT = `let isCode = false;
    const pres = tempElement.querySelectorAll("pre");
    if (tempElement.childElementCount === 1 && pres.length === 1
        && pres[0].className !== "vditor-wysiwyg"
        && pres[0].className !== "vditor-sv") {
        const preElement = pres[0] as HTMLElement;
        const hasCodeChild = !!preElement.querySelector("code");
        const preText = text || preElement.textContent || "";
        isCode = hasCodeChild || looksLikeCodeContent(preText);
    }`
export function patchProcessCode(code) {
  const start = code.indexOf(PC_DETECT_START)
  const end = code.indexOf(PC_DETECT_END)
  if (start === -1 || end === -1 || !code.includes(PC_FN_ANCHOR)) {
    throw new Error(
      'fixProcessCode: anchors not found in vditor processCode.ts (version drift?)',
    )
  }
  // Replace the marker-based detection block with the content-based one…
  const withDetect = code.slice(0, start) + PC_NEW_DETECT + code.slice(end)
  // …and prepend the looksLikeCodeContent helper before the function.
  return withDetect.replace(
    PC_FN_ANCHOR,
    `${looksLikeCodeContentSrc}\n${PC_FN_ANCHOR}`,
  )
}
// Perf (task 68 C2-takeover): IR reserializes the whole document to markdown on
// every input — `ir/process.ts` computes `getMarkdown(vditor)` (super-linear Lute)
// and hands it to `options.input(text)`. That's the only consumer on the hot path
// (counter/cache are off, undo diffs innerHTML not markdown). Stop Vditor serializing
// per input: call `options.input()` as a cheap *signal*, and the webview owns the
// (single, debounced, busy-cursor-wrapped) serialize itself. `text` is still declared
// for the gated counter/cache blocks (no serialize when both are off).
const IR_INPUT_START = 'const text = getMarkdown(vditor);'
const IR_INPUT_END = 'vditor.options.input(text);\n        }'
export function patchIrInputSerialize(code) {
  const start = code.indexOf(IR_INPUT_START)
  const endTok = code.indexOf(IR_INPUT_END)
  if (start === -1 || endTok === -1) {
    throw new Error(
      'fixIrInputSerialize: anchors not found in vditor ir/process.ts (version drift?)',
    )
  }
  const end = endTok + IR_INPUT_END.length
  const replacement =
    'if (typeof vditor.options.input === "function" && options.enableInput) {\n' +
    '            vditor.options.input();\n' +
    '        }\n' +
    '        const text = (vditor.options.counter.enable || vditor.options.cache.enable) ? getMarkdown(vditor) : "";'
  return code.slice(0, start) + replacement + code.slice(end)
}
// Perf (task 161 step 1): IR re-renders EVERY diagram preview through processCodeRender on every input
// (mermaid ~670 ms/keystroke, graphviz, d2 WASM, …) → the main thread freezes while you type in a
// diagram's source. Route the per-input render loop through our edit-activity gate, which defers the
// heavy engines until the user pauses + keeps the last render visible (window.__vmarkdDeferIrDiagramRender,
// installed by main.ts). Falls back to the stock loop if the hook isn't installed (e.g. the harness).
const IR_DIAGRAM_LOOP =
  `vditor.ir.element.querySelectorAll(".vditor-ir__preview[data-render='2']").forEach((item: HTMLElement) => {\n` +
  `        processCodeRender(item, vditor);\n` +
  `    });`
export function patchIrDeferDiagramRender(code) {
  if (!code.includes(IR_DIAGRAM_LOOP)) {
    throw new Error(
      'patchIrDeferDiagramRender: processCodeRender loop anchor not found in vditor ir/input.ts (version drift?)',
    )
  }
  const replacement =
    `if ((window as any).__vmarkdDeferIrDiagramRender) {\n` +
    `        (window as any).__vmarkdDeferIrDiagramRender(vditor, processCodeRender);\n` +
    `    } else {\n` +
    `        ${IR_DIAGRAM_LOOP}\n` +
    `    }`
  return code.replace(IR_DIAGRAM_LOOP, replacement)
}
// About Vditor dialog. Vditor hard-codes it in Chinese (toolbar/Info.ts) — NOT an
// i18n string, so English is only possible by rewriting the tip.show() HTML at build
// time. The TOP half is Vditor's ORIGINAL About content, translated verbatim (tagline,
// description, project/license/version/sponsor). Below a divider we add the (separate,
// also-Chinese) Help dialog's links as their own section, so one window carries both
// (the `help` toolbar item is dropped + stubbed). Every upstream link is kept (incl.
// the ld246 community links), plus two fixes:
//   - logo: Vditor loads it from unpkg (remote https:), now blocked by our hardened
//     img-src CSP (task 67) → repointed to the locally-served copy.
//   - version: Vditor interpolates `Lute.Version`, a stale tag (v1.7.6) on our master
//     pin (task 66) → a GitHub commit link (short sha) + date from source.json.
// `${VDITOR_VERSION}` and `${vditor.options.cdn}` are left literal (single-quoted) so
// they interpolate at runtime inside Vditor's tip.show template literal.
function infoDialogHtml(pin) {
  const luteCell = pin?.commit
    ? `Lute <a href="https://github.com/88250/lute/commit/${pin.commit}" target="_blank">${pin.commit.slice(0, 7)}</a>${pin.committedAt ? ` (${pin.committedAt})` : ''}`
    : // no vendored pin → keep Vditor's runtime version interpolation
      'Lute v${Lute.Version}'
  return (
    '<div style="max-width: 520px;font-size: 14px;line-height: 22px;margin-bottom: 14px;">' +
    // — Original Vditor About (translated) —
    '<p style="text-align: center;margin: 14px 0"><em>The next-generation Markdown editor, built for the future</em></p>' +
    '<div style="display: flex;margin-bottom: 14px;flex-wrap: wrap;align-items: center">' +
    '<img src="${vditor.options.cdn}/dist/images/logo.png" style="margin: 0 auto;height: 68px"/>' +
    '<div>&nbsp;&nbsp;</div>' +
    '<div style="flex: 1;min-width: 250px">Vditor is a browser-based Markdown editor supporting WYSIWYG, instant rendering (Typora-like) and split-preview modes. It is written in TypeScript and works with vanilla JavaScript as well as Vue, React, Angular and Svelte.</div>' +
    '</div>' +
    '<div style="display: flex;flex-wrap: wrap;">' +
    '<ul style="list-style: none;flex: 1;min-width: 148px">' +
    '<li>Project: <a href="https://b3log.org/vditor" target="_blank">b3log.org/vditor</a></li>' +
    '<li>License: MIT</li>' +
    '</ul>' +
    '<ul style="list-style: none;margin-right: 18px">' +
    '<li>Version: Vditor v${VDITOR_VERSION} / ' +
    luteCell +
    '</li>' +
    '<li>Sponsor: <a href="https://ld246.com/sponsor" target="_blank">ld246.com/sponsor</a></li>' +
    '</ul>' +
    '</div>' +
    // — Help section (folded in from the dropped Help dialog) —
    '<hr style="border: none;border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,.35));margin: 4px 0 12px"/>' +
    '<div style="display: flex;flex-wrap: wrap;">' +
    '<ul style="list-style: none;flex: 1;min-width: 148px;margin-right: 18px">' +
    '<li><strong>Markdown guide</strong></li>' +
    '<li><a href="https://ld246.com/article/1583308420519" target="_blank">Syntax cheatsheet</a></li>' +
    '<li><a href="https://ld246.com/article/1583129520165" target="_blank">Basic syntax</a></li>' +
    '<li><a href="https://ld246.com/article/1583305480675" target="_blank">Extended syntax</a></li>' +
    '<li><a href="https://ld246.com/article/1582778815353" target="_blank">Keyboard shortcuts</a></li>' +
    '</ul>' +
    '<ul style="list-style: none;flex: 1;min-width: 148px">' +
    '<li><strong>Vditor support</strong></li>' +
    '<li><a href="https://github.com/Vanessa219/vditor/issues" target="_blank">Issues</a></li>' +
    '<li><a href="https://ld246.com/tag/vditor" target="_blank">Community forum</a></li>' +
    '<li><a href="https://ld246.com/article/1549638745630" target="_blank">Developer guide</a></li>' +
    '<li><a href="https://ld246.com/guide/markdown" target="_blank">Demo</a></li>' +
    '</ul>' +
    '</div>' +
    '</div>'
  )
}

const INFO_TIP_OPEN = 'vditor.tip.show(`'
const INFO_TIP_CLOSE = '`, 0);'
export function patchInfoDialog(code, pin) {
  const s = code.indexOf(INFO_TIP_OPEN)
  const e =
    s === -1 ? -1 : code.indexOf(INFO_TIP_CLOSE, s + INFO_TIP_OPEN.length)
  // Guard on the tip.show anchor AND a known Chinese marker so the build fails loudly
  // if Vditor's Info dialog drifts on a version bump.
  if (s === -1 || e === -1 || !code.includes('组件版本')) {
    throw new Error(
      'fixInfoDialog: Info.ts tip.show anchor not found (version drift?)',
    )
  }
  return (
    code.slice(0, s + INFO_TIP_OPEN.length) +
    infoDialogHtml(pin) +
    code.slice(e)
  )
}
// Task 86 — we vendor a newer Mermaid than Vditor bundles (syncMermaid). Vditor's
// mermaidRender.ts loads `…/mermaid.min.js?v=11.6.0`; the `?v=` is a cache-buster, so
// bump it to the vendored version or a stale webview could serve the old bytes across
// an extension update. Anchored on the literal; throws if Vditor's URL drifts.
const MERMAID_VER_ANCHOR = /mermaid\.min\.js\?v=[\d.]+/
export function patchMermaidVersion(code, version) {
  if (!MERMAID_VER_ANCHOR.test(code)) {
    throw new Error(
      'fixMermaidVersion: `mermaid.min.js?v=` anchor not found in vditor mermaidRender.ts (version drift?)',
    )
  }
  return code.replace(MERMAID_VER_ANCHOR, `mermaid.min.js?v=${version}`)
}
// Task 89 — we vendor a newer ECharts than Vditor bundles (syncEcharts). Three vditor modules
// load `…/echarts.min.js?v=5.5.1` under the SAME script id (`vditorEchartsScript`): chartRender
// (charts), mindmapRender (mind maps), devtools. addScript dedupes by id, so whichever loads
// first pins the URL — bump the `?v=` cache-buster in ALL of them to the vendored version, or a
// stale webview could serve old bytes across an update. Anchored on the literal (one per file);
// throws if Vditor's URL drifts. (Replaces every occurrence in case a file gains more.)
export function patchEchartsVersion(code, version) {
  if (!code.includes('echarts.min.js?v=')) {
    throw new Error(
      'fixEchartsVersion: `echarts.min.js?v=` anchor not found in a vditor echarts loader (version drift?)',
    )
  }
  return code.replace(
    /echarts\.min\.js\?v=[\d.]+/g,
    `echarts.min.js?v=${version}`,
  )
}

// Task 90 — Vditor's chartRender hardcodes the ECharts theme: `init(e, theme === "dark" ?
// "dark" : undefined)`. Rewrite that single call to consult `window.__vmarkdEchartsResolve`
// (installed by echarts-apply.ts) so charts follow the content-theme palette; falls back to
// Vditor's original dark/light when the resolver isn't installed. Anchored on the literal init
// call; throws if it drifts.
const ECHARTS_INIT_ANCHOR =
  /echarts\.init\(e,\s*theme === "dark" \? "dark" : undefined\)/
export function patchEchartsThemeInit(code) {
  if (!ECHARTS_INIT_ANCHOR.test(code)) {
    throw new Error(
      'fixEcharts: `echarts.init(e, theme === "dark" ? "dark" : undefined)` anchor not found in vditor chartRender.ts (version drift?)',
    )
  }
  return (
    code
      .replace(
        ECHARTS_INIT_ANCHOR,
        'echarts.init(e, window.__vmarkdEchartsResolve ? window.__vmarkdEchartsResolve(echarts) : (theme === "dark" ? "dark" : undefined))',
      )
      // Disable the chart entry animation ("przy włączaniu") — force `animation:false` over the user
      // option. Matches ONLY chartRender's `.setOption(option)` (mindmapRender uses an object literal
      // `.setOption({…})`), so the mindmap keeps its animation. No-op if the anchor is absent.
      .replace(
        '.setOption(option)',
        '.setOption(Object.assign({}, option, { animation: false }))',
      )
  )
}

// mindmapRender (an ECharts `tree`) hardcodes GitHub-LIGHT colours into its setOption — node
// `#4285f4`, label bg `#f6f8fa` / border `#d1d5da` / text `#586069`, line `#d1d5da` — so it ignores
// the content theme (wrong on dark). chartRender already follows the theme via the resolver
// (patchEchartsThemeInit, applied to mindmapRender too in fixEcharts). For a `tree` series, though,
// ECharts does NOT apply the registered theme's categorical `color` palette to node symbols (unlike
// bar/line), so merely stripping these hardcoded colours left the nodes ECharts-default GREY — the
// mindmap still ignored the content theme. So we instead DRIVE the colours from the resolved theme
// at render time via `window.__vmarkdMindmapStyle` (installed by echarts-apply.ts): node → series
// colour 0, label text → theme foreground, label surface/border + line → theme tooltip surface/line.
// Falls back to Vditor's GitHub-light defaults when the resolver isn't installed (bare harness).
// Geometry (radius/padding/offset/width) is kept. Anchored on the exact colour block; throws on drift.
const MINDMAP_COLORS_ANCHOR = `itemStyle: {
                                    borderWidth: 0,
                                    color: "#4285f4",
                                },
                                label: {
                                    backgroundColor: "#f6f8fa",
                                    borderColor: "#d1d5da",
                                    borderRadius: 5,
                                    borderWidth: 0.5,
                                    color: "#586069",
                                    lineHeight: 20,
                                    offset: [-5, 0],
                                    padding: [0, 5],
                                    position: "insideRight",
                                },
                                lineStyle: {
                                    color: "#d1d5da",
                                    width: 1,
                                },`
// NOTE: we intentionally do NOT patch the mindmap's entry "grow" animation here. ECharts `tree`
// gates the entry animation AND the click-collapse re-render on the same `animation` flag, so the
// only thing that stops the entry grow (`animation: false`) also breaks collapse (tangled re-render,
// user-confirmed), and `animationDuration: 0` doesn't suppress the entry anyway. So the brief grow is
// accepted; this patch only re-themes the colours + tightens the vertical layout box.
export function patchMindmapThemeColors(code) {
  if (!code.includes(MINDMAP_COLORS_ANCHOR)) {
    throw new Error(
      'fixMindmapTheme: itemStyle/label/lineStyle colour block not found in vditor mindmapRender.ts (version drift?)',
    )
  }
  return code.replace(
    MINDMAP_COLORS_ANCHOR,
    `itemStyle: {
                                    borderWidth: 0,
                                    color: (window.__vmarkdMindmapStyle ? window.__vmarkdMindmapStyle.node : "#4285f4"),
                                },
                                label: {
                                    backgroundColor: (window.__vmarkdMindmapStyle ? window.__vmarkdMindmapStyle.labelBg : "#f6f8fa"),
                                    borderColor: (window.__vmarkdMindmapStyle ? window.__vmarkdMindmapStyle.labelBorder : "#d1d5da"),
                                    borderRadius: 5,
                                    borderWidth: 0.5,
                                    color: (window.__vmarkdMindmapStyle ? window.__vmarkdMindmapStyle.label : "#586069"),
                                    lineHeight: 20,
                                    offset: [-5, 0],
                                    padding: [0, 5],
                                    position: "insideRight",
                                },
                                lineStyle: {
                                    color: (window.__vmarkdMindmapStyle ? window.__vmarkdMindmapStyle.line : "#d1d5da"),
                                    width: 1,
                                },
                                top: 14,
                                bottom: 14,`,
  )
}

// setContentTheme content-theme flicker. Vditor's `setContentTheme` (ui/setContentTheme.ts)
// reloads the `#vditorContentTheme` stylesheet whenever `getAttribute("href") !== cssPath`
// — it does `link.remove(); addStyle(cssPath)`, an ASYNC re-fetch. On init the instant-paint
// overlay already shipped that link, but its href is the host's `toUri(...)` STRING while the
// runtime cssPath is the `${cdn}/…` STRING — different strings, SAME file. So Vditor needlessly
// tears the stylesheet down and re-fetches it; for the ~100 ms until it reloads, the content
// theme isn't applied and the editor flashes wrong colours (hr, inline-code, text — whatever the
// theme drives) before snapping back. Compare RESOLVED absolute URLs instead, so the same file
// is never reloaded. A genuine theme switch (different file) still reloads. Anchored single-line
// rewrite; throws on drift.
const SET_CONTENT_THEME_ANCHOR =
  'vditorContentTheme.getAttribute("href") !== cssPath'
export function patchSetContentTheme(code) {
  if (!code.includes(SET_CONTENT_THEME_ANCHOR)) {
    throw new Error(
      'fixSetContentTheme: anchor not found in vditor ui/setContentTheme.ts (version drift?)',
    )
  }
  return code.replace(
    SET_CONTENT_THEME_ANCHOR,
    'new URL(vditorContentTheme.getAttribute("href"), document.baseURI).href !== new URL(cssPath, document.baseURI).href',
  )
}

// markmap renders an INTERACTIVE, ANIMATED SVG: markmap-view attaches d3-zoom (a non-passive
// `wheel` handler that preventDefaults and zooms the map → scrolling the document with the pointer
// over a markmap zooms the mindmap instead of scrolling the page, "przechwytuje kursor"), and it
// animates the tree on init with a d3 transition (`duration`, default 500ms). Vditor calls
// `Markmap.create(svg, null)`. Two rewrites:
//   1. CREATE: pass `{ duration: 0 }` (instant render + fit, no init animation) and override
//      d3-zoom's filter to `e => e.ctrlKey && !e.button` — the Ctrl-to-interact model the user
//      asked for. d3-zoom checks the filter at the TOP of every gesture handler and returns early
//      (BEFORE preventDefault) when it rejects, so a plain wheel scrolls the PAGE and a plain click
//      still works, while Ctrl+wheel zooms and Ctrl+drag pans. NB: simply disabling zoom (the old
//      `{ zoom:false }`) left the wheel handler bound — it still preventDefaulted, "capturing" the
//      scroll without scrolling OR zooming; the filter is the correct gate. (ECharts mindmaps have
//      no such filter → gated in the DOM by diagram-zoom-gate.ts instead.)
//   2. SETDATA: force duration:0 as the LAST merge so the zoom-to-fit is instant too (setData
//      re-applies deriveOptions(frontmatter), which carries a non-zero default duration that would
//      otherwise re-animate the fit). markmap's `transition()` skips the d3 transition when
//      duration <= 0.
// Anchored single-line rewrites; throw on drift.
const MARKMAP_CREATE_ANCHOR = 'const mm = Markmap.create(svg, null);'
const MARKMAP_SETDATA_ANCHOR = 'mm.setData(root, frontmatterOptions)'
const MARKMAP_SCRIPT_ANCHOR = 'markmap.min.js`, "vditorMarkerScript"'
export function patchMarkmapStatic(code, version) {
  if (
    !code.includes(MARKMAP_CREATE_ANCHOR) ||
    !code.includes(MARKMAP_SETDATA_ANCHOR)
  ) {
    throw new Error(
      'fixMarkmapStatic: create/setData anchor not found in vditor markmapRender.ts (version drift?)',
    )
  }
  let out = code
  if (version && out.includes(MARKMAP_SCRIPT_ANCHOR)) {
    out = out.replace(
      MARKMAP_SCRIPT_ANCHOR,
      `markmap.min.js?v=${version}\`, "vditorMarkerScript"`,
    )
  }
  return out
    .replace(
      MARKMAP_CREATE_ANCHOR,
      // fitRatio:0.88 (default .95) — markmap fits content to the svg then clips overflow, but it
      // slightly UNDER-measures the bottom of the tree (label descenders / node markers), so the
      // default 2.5%-per-side margin let the lowest branch clip at the bottom ("obcina trochę
      // wykres"). 0.88 = 6% per side, absorbing the under-measure. Re-asserted in setData below.
      'const mm = Markmap.create(svg, { duration: 0, fitRatio: 0.80, autoFit: true });' +
        ' try { mm.zoom.filter((e) => e.ctrlKey && !e.button); } catch (_e) {}' +
        // Gate fold/unfold on Ctrl — plain click enters edit mode (expands the IR code block);
        // Ctrl+click toggles node collapse. handleClick receives the DOM event as first arg.
        ' try { const _origClick = mm.handleClick.bind(mm);' +
        ' mm.handleClick = (e, d) => { if (e.ctrlKey) _origClick(e, d); }; } catch (_e) {}' +
        // Expose the instance on its svg so markmap-fit.ts can re-fit it when the column is resized
        // (markmap doesn\'t auto-refit; the svg shrinks but content clips). See markmap-fit.ts.
        ' try { svg.__vmarkdMm = mm; } catch (_e) {}',
    )
    .replace(
      MARKMAP_SETDATA_ANCHOR,
      // setData re-derives options from frontmatter (default fitRatio .95, duration), which would
      // overwrite our create-time values — re-assert both as the LAST merge so they stick.
      'mm.setData(root, Object.assign({}, frontmatterOptions, { duration: 0, fitRatio: 0.80 }));' +
        // Size SVG to tree content: default 150px is too short for multi-branch trees → clipping.
        // Read the <g> bounding box (tree in local coords) and set SVG height to fit at scale 1.
        // autoFit then re-runs fit() and centers within the correctly-sized viewport.
        ' try { const b = mm.g.node().getBBox();' +
        ' svg.style.height = Math.max(b.height * 1.5, 120) + "px"; mm.fit(); } catch(_e) {}',
    )
}
// graphvizRender: Vditor ships the OLD mdaines viz.js + full.render.js (Web Worker via
// blob-importScripts that hangs in the VS Code webview cross-origin). We replaced that with
// a fetch+inline-blob fix, but now we vendor the modern `@viz-js/viz` 3.x `viz-global.js`
// (shared with PlantUML TeaVM — task 87). Rewrite the entire render to use the modern API:
// `Viz.instance().then(viz => viz.renderSVGElement(dot))` — no manual Worker construction,
// no old viz.js/full.render.js. The script tag loads `viz-global.js` from the plantuml dir.
// Theme fix (same as before): strip bg polygon, recolour #000000/black → currentColor.
const GRAPHVIZ_ANCHOR = 'addScript(`${cdn}/dist/js/graphviz/viz.js`'
export function patchGraphvizRender(code) {
  if (!code.includes(GRAPHVIZ_ANCHOR)) {
    throw new Error(
      'fixGraphvizRender: addScript anchor not found in vditor graphvizRender.ts (version drift?)',
    )
  }
  // Task 144 item 1: render + theme-agnostic post-processing moved to a real, typed, unit-tested
  // module (media-src/src/graphviz-render.ts). This shim re-exports graphvizRender so Vditor's
  // previewRender (and our plantuml-retheme.ts) keep importing it from here. Relative path climbs out
  // of node_modules/vditor/src/ts/markdown/ to media-src/src/ (build-time resolved; the anchor assert
  // above still guards version drift).
  return `import {Constants} from "../constants";
import {graphvizRender as vmGraphvizRender} from "../../../../../src/graphviz-render";
export const graphvizRender = (element: HTMLElement, cdn = Constants.CDN) => vmGraphvizRender(element, cdn);
`
}

// flowchartRender (flowchart.js) bakes #000 lines/borders/text + #fff box fill and ignores the
// content theme → black-on-dark is invisible (task 91). flowchart.js DOES take a style-options
// object as drawSVG's 2nd arg, so pair it with the theme: drive line/element/font colours from the
// THEMED foreground (`getComputedStyle(item).color` — an rgb() string, which flowchart.js's Raphael
// parses fine) and `fill:"none"` so box interiors are transparent (the page background shows
// through, like graphviz). Verified in the real editor: `currentColor` does NOT work (Raphael
// normalises it to a garbage #6688cc — unlike graphviz's CSS path) and `fill:"transparent"` renders
// BLACK; an explicit colour + `"none"` are the working values. Anchored on the bare drawSVG call.
const FLOWCHART_DRAW_ANCHOR = 'flowchartObj.drawSVG(item);'
export function patchFlowchartTheme(code) {
  if (!code.includes(FLOWCHART_DRAW_ANCHOR)) {
    throw new Error(
      'fixFlowchartTheme: drawSVG anchor not found in vditor flowchartRender.ts (version drift?)',
    )
  }
  return code.replace(
    FLOWCHART_DRAW_ANCHOR,
    'var vmFcColor = (typeof getComputedStyle === "function" && getComputedStyle(item).color) || "#000";\n' +
      '            flowchartObj.drawSVG(item, { "line-color": vmFcColor, "element-color": vmFcColor, "font-color": vmFcColor, "fill": "none" });',
  )
}

// Task 92/93 — bump abcjs 5→6 cache-buster + foreground color theming.
// abcRender.ts loads `abcjs_basic.min.js` with no `?v=` → stale webview serves old bytes.
// Also, `renderAbc(item, code)` passes no params → black ink, unreadable on dark. abcjs 6 has
// `foregroundColor` → pass the themed foreground (getComputedStyle(item).color). Save `data-code`
// for re-render on theme flip (the rendered SVG clobbers textContent).
const ABC_SCRIPT_ANCHOR = 'abcjs_basic.min.js", "vditorAbcjsScript"'
const ABC_RENDER_ANCHOR =
  'ABCJS.renderAbc(item, abcRenderAdapter.getCode(item).trim())'
export function patchAbcRender(code) {
  if (!code.includes(ABC_RENDER_ANCHOR)) {
    throw new Error(
      'fixAbcRender: renderAbc anchor not found in abcRender.ts (version drift?)',
    )
  }
  let out = code
  if (abcjsPin?.version && out.includes(ABC_SCRIPT_ANCHOR)) {
    out = out.replace(
      ABC_SCRIPT_ANCHOR,
      `abcjs_basic.min.js?v=${abcjsPin.version}", "vditorAbcjsScript"`,
    )
  }
  out = out.replace(
    ABC_RENDER_ANCHOR,
    `(() => {
                var abcCode = (item.getAttribute("data-code") || abcRenderAdapter.getCode(item) || "").trim();
                if (!abcCode) return;
                item.setAttribute("data-code", abcCode);
                var abcFg = (typeof getComputedStyle === "function" && getComputedStyle(item).color) || "#000";
                ABCJS.renderAbc(item, abcCode, { foregroundColor: abcFg });
                })()`,
  )
  return out
}

// Task 87 — replace Vditor's remote-server `<object>` plantuml renderer with our local TeaVM
// engine. The original loads `plantuml-encoder.min.js` and emits an `<object data="https://
// plantuml.com/…">` tag → blocked by CSP `object-src 'none'` AND a privacy leak. The patch
// rewrites the render function to lazy-load the local TeaVM JS (`plantuml.js` + `viz-global.js`)
// and call `render(lines, targetEl, {dark})` — fully offline, inline SVG. The `{dark}` option
// is read from Vditor's `options.theme` (passed by processCode → previewRender).
const PLANTUML_ANCHOR = 'plantumlEncoder.encode(text)'
export function patchPlantumlRender(code) {
  if (!code.includes(PLANTUML_ANCHOR)) {
    throw new Error(
      'fixPlantumlRender: plantumlEncoder.encode anchor not found in plantumlRender.ts (version drift?)',
    )
  }
  // Task 144 item 1: the render + theme-agnostic post-processing logic moved to a real, typed,
  // unit-tested module (media-src/src/plantuml-render.ts). This shim just re-exports plantumlRender
  // so Vditor's previewRender (and our plantuml-retheme.ts) keep importing it from here. The relative
  // path climbs out of node_modules/vditor/src/ts/markdown/ to media-src/src/ (resolved at bundle
  // time — a wrong path fails the build loudly). The anchor assert above still guards version drift.
  return `import {Constants} from "../constants";
import {plantumlRender as vmPlantumlRender} from "../../../../../src/plantuml-render";
export const plantumlRender = (element = document, cdn = Constants.CDN) => vmPlantumlRender(element, cdn);
`
}

// Declarative registry of every Vditor *source* (.ts) patch: one entry per file we rewrite at
// bundle time, mapping the file's filter to the transform(s) applied to its contents. Each
// transform is an anchor-asserted `patchXxx` defined above (tests import those directly); the
// assert throws a NAMED error on a Vditor version bump so a drift fails the build loudly. A file
// touched by more than one patch chains them in ONE transform (esbuild runs only the FIRST
// matching onLoad per file). `pin`/`path`-dependent cases (mermaid/echarts version, info dialog)
// close over the relevant value here. CSS is NOT in this list: index.css is no longer bundled —
// the host links the build.mjs-patched media/ copy directly (html-builder.ts), so all index.css
// rewrites live in build.mjs patchVditorIndexCss(), the single copy every surface loads (ADR-0004).
const VDITOR_TS_PATCHES = [
  {
    file: /vditor[/\\]src[/\\]ts[/\\]undo[/\\]index\.ts$/,
    transform: patchDmpInterop,
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]ir[/\\]index\.ts$/,
    transform: patchIrLinkClick,
  },
  {
    // chain both wysiwyg/index.ts patches (link-click gate + clicked-line caret)
    file: /vditor[/\\]src[/\\]ts[/\\]wysiwyg[/\\]index\.ts$/,
    transform: (code) =>
      patchWysiwygCodeClickCaret(patchWysiwygLinkClick(code)),
  },
  {
    // chain both fixBrowserBehavior.ts patches (list-toggle null-deref + callout arrow-nav)
    file: /vditor[/\\]src[/\\]ts[/\\]util[/\\]fixBrowserBehavior\.ts$/,
    transform: (code) => patchCalloutArrowNav(patchListToggle(code)),
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]toolbar[/\\]Outline\.ts$/,
    transform: patchOutlineCurrent,
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]util[/\\]editorCommonEvent\.ts$/,
    transform: patchIrBlurExpand,
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]markdown[/\\]mathRender\.ts$/,
    transform: patchMathRender,
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]preview[/\\]index\.ts$/,
    transform: patchPreviewCopyTip,
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]util[/\\]processCode\.ts$/,
    transform: patchProcessCode,
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]ir[/\\]process\.ts$/,
    transform: patchIrInputSerialize,
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]ir[/\\]input\.ts$/,
    transform: patchIrDeferDiagramRender,
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]toolbar[/\\]Info\.ts$/,
    transform: (code) => patchInfoDialog(code, lutePin),
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]markdown[/\\]mermaidRender\.ts$/,
    transform: (code) =>
      mermaidPin?.version
        ? patchMermaidVersion(code, mermaidPin.version)
        : code,
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]markdown[/\\]markmapRender\.ts$/,
    transform: (code) => patchMarkmapStatic(code, markmapPin?.version),
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]markdown[/\\]graphvizRender\.ts$/,
    transform: patchGraphvizRender,
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]markdown[/\\]flowchartRender\.ts$/,
    transform: patchFlowchartTheme,
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]markdown[/\\]plantumlRender\.ts$/,
    transform: patchPlantumlRender,
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]markdown[/\\]abcRender\.ts$/,
    transform: patchAbcRender,
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]markdown[/\\]SMILESRender\.ts$/,
    transform: (code) => {
      if (!smilesDrawerPin?.version) return code
      const anchor = 'smiles-drawer.min.js?v=2.1.7'
      if (!code.includes(anchor)) return code
      return code.replace(
        anchor,
        `smiles-drawer.min.js?v=${smilesDrawerPin.version}`,
      )
    },
  },
  {
    // 3 echarts loaders share this filter; bump the `?v=` in all, rewrite theme-init in chartRender only
    file: /vditor[/\\]src[/\\]ts[/\\](markdown[/\\](chartRender|mindmapRender)|devtools[/\\]index)\.ts$/,
    transform: (code, path) => {
      let out = echartsPin?.version
        ? patchEchartsVersion(code, echartsPin.version)
        : code
      if (/[/\\](chartRender|mindmapRender)\.ts$/.test(path))
        out = patchEchartsThemeInit(out)
      if (/[/\\]mindmapRender\.ts$/.test(path))
        out = patchMindmapThemeColors(out)
      return out
    },
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]ui[/\\]setContentTheme\.ts$/,
    transform: patchSetContentTheme,
  },
]

// Generic engine: ONE esbuild plugin that applies every registry entry via an onLoad per file.
// esbuild runs the first onLoad whose filter matches a file; each entry targets a DISTINCT file,
// so registration order is irrelevant. Replaces the ~14 near-identical per-patch plugin objects.
const vditorSourcePatches = {
  name: 'vditor-source-patches',
  setup(build) {
    for (const { file, transform } of VDITOR_TS_PATCHES) {
      build.onLoad({ filter: file }, async (args) => {
        const code = await readFile(args.path, 'utf8')
        return { loader: 'ts', contents: transform(code, args.path) }
      })
    }
  },
}

export const vditorSourceConfig = {
  define: {
    VDITOR_VERSION: JSON.stringify(vditorVersion),
    // Surfaced in the vMarkd About dialog (toolbar.ts). Empty strings if unpinned.
    __VMARKD_VDITOR_VERSION__: JSON.stringify(vditorVersion),
    __VMARKD_LUTE_COMMIT__: JSON.stringify(lutePin?.commit || ''),
    __VMARKD_LUTE_COMMITTED_AT__: JSON.stringify(lutePin?.committedAt || ''),
  },
  tsconfigRaw: { compilerOptions: { useDefineForClassFields: false } },
  loader: { '.less': 'empty' },
  // main.css @font-face points at media/fonts/*.woff2 via `url(../fonts/…)` — correct RELATIVE TO
  // THE OUTPUT (media/dist/main.css) but unresolvable from the source dir at bundle time. Mark
  // woff2 external so esbuild leaves the url untouched. Shared by the prod build (build.mjs) AND
  // the e2e harness server (e2e/serve.mjs), both of which bundle main.css.
  external: ['*.woff2'],
  // stubUnusedVditorButtons uses onResolve (not onLoad) so it stays standalone; every onLoad
  // source patch is applied by the single registry-driven engine.
  plugins: [stubUnusedVditorButtons, vditorSourcePatches],
}
