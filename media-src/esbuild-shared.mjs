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
  new URL('./src/chrome/stubs/vditor-toolbar-stubs.ts', import.meta.url),
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
const DMP_IMPORT_ANCHOR = 'import * as DiffMatchPatch from "diff-match-patch";'
export function patchDmpInterop(code) {
  // Fail loud on drift like every other patch (audit 185/1a): a silent no-op here means undo
  // throws "is not a constructor" at runtime — the exact bug this patch exists to fix.
  if (!code.includes(DMP_IMPORT_ANCHOR)) {
    throw new Error(
      'patchDmpInterop: anchor not found in vditor undo/index.ts (version drift?)',
    )
  }
  return code.replace(
    DMP_IMPORT_ANCHOR,
    'import DiffMatchPatch from "diff-match-patch";',
  )
}

// Task 445 — the first click into a freshly-opened document sometimes drops the caret (present,
// collapsed, but PAINTS with zero height — task 439's exact failure mode). Root-caused by call-stack
// trace (task 445 "Round 6", 4/4 reproductions, identical every time):
// `Range.insertNode ← Undo.addCaret ← Undo.addToUndoStack ← setTimeout`. `addCaret(vditor, true)`
// serialises the caret into the ONE-TIME initial undo-stack snapshot: it clones the live Range
// (`cloneRange`), inserts a `<span class="vditor-wbr">` marker via `range.insertNode()` to bake the
// caret's position into the snapshot HTML, clones+diffs the editor, strips the marker again, then
// calls `setSelectionFocus(cloneRange)` to put the "original" caret back.
//
// The bug: `range.insertNode` on a Range anchored in a Text node SPLITS that node (DOM spec). DOM
// Ranges are LIVE, so `cloneRange`'s boundary auto-adjusts to the split, per spec, regardless of
// which Range performed the mutation — landing on the (possibly now-EMPTY) pre-split half whenever
// the original offset was AT or BEFORE the split point. Clicking near the top of a fresh document
// (offset 0 of a text run — the common case) leaves the ENTIRE original text in the second half, so
// `cloneRange` points at an empty text node. `setSelectionFocus` restores onto it: a Range that is
// validly placed and collapsed, and has a ZERO-HEIGHT client rect — a caret nothing can paint. This
// is upstream Vditor's own undo-snapshot machinery, not vMarkd's init code (task 445's own probes
// ruled that out first).
//
// Fix: a stale node-and-offset pair CANNOT be made correct after the node it names has been split
// out from under it — but a character OFFSET can be re-derived against the fresh DOM regardless of
// which node the split touched, because character counts don't care where node boundaries fall. So
// capture a character offset within the editable BEFORE `insertNode` runs (this patch's first
// anchor), and after the wbr markers are stripped, restore via that offset INSTEAD of the
// stale `cloneRange` (the second anchor) — routed through the webview's own caret AUTHORITY
// (`window.__vmarkdRequestCaret`, media-src/src/caret.ts's `{textOffset}` intent, ADR-0007 /
// task 446 — the exact mechanism `caret-preserve.ts` already uses for the same "every node is gone,
// only a character count survived" situation after a full `setValue()` rebuild) so a still-settling
// block gets the same re-assert-until-PAINTABLE retry as every other programmatic placement, not
// another one-shot write. Falls back to Vditor's original stale-range restore if the bridge isn't
// installed (a standalone harness loading this bundle without vMarkd's own main.ts wiring),
// matching this file's other `window.__vmarkd*` bridges (see `LINK_GATE` below).
const UNDO_CARET_OFFSET_DECL_ANCHOR = 'let cloneRange: Range;'
const UNDO_CARET_OFFSET_CAPTURE_ANCHOR =
  '                cloneRange = range.cloneRange();\n' +
  '                const wbrElement = document.createElement("span");'
const UNDO_CARET_OFFSET_RESTORE_ANCHOR =
  '        if (setFocus && cloneRange) {\n' +
  '            setSelectionFocus(cloneRange);\n' +
  '        }'
const UNDO_CLASS_ANCHOR = 'class Undo {'
export function patchUndoCaretSplitRestore(code) {
  for (const [label, anchor] of [
    ['class', UNDO_CLASS_ANCHOR],
    ['decl', UNDO_CARET_OFFSET_DECL_ANCHOR],
    ['capture', UNDO_CARET_OFFSET_CAPTURE_ANCHOR],
    ['restore', UNDO_CARET_OFFSET_RESTORE_ANCHOR],
  ]) {
    if (!code.includes(anchor)) {
      throw new Error(
        `patchUndoCaretSplitRestore: ${label} anchor not found in vditor undo/index.ts (version drift?)`,
      )
    }
  }
  return code
    .replace(
      UNDO_CLASS_ANCHOR,
      // Free function (not a class member): kept outside Undo so the class body's diff against
      // upstream stays minimal, and so it's reachable from both the decl/capture/restore anchors
      // without threading it through `this`.
      'function vmarkdCaretTextOffset(root: HTMLElement, node: Node, offset: number): number {\n' +
        '    if (!root.contains(node)) {\n' +
        '        return -1;\n' +
        '    }\n' +
        '    const pre = document.createRange();\n' +
        '    pre.selectNodeContents(root);\n' +
        '    pre.setEnd(node, offset);\n' +
        '    return pre.toString().length;\n' +
        '}\n\n' +
        // Task 487 (vMarkd patch): the STRUCTURAL capture that supersedes the flat offset above for
        // this call site. A document-wide character count cannot address an empty block — an empty
        // <p>/<li> contributes zero characters, so this very function computed the SAME number for
        // "caret in the blank line the user just made with Enter" as for "caret at the end of the
        // line before it", and the restore below could then only ever land on the latter (task 486's
        // user-visible "caret snaps back ~800ms after every Enter"). Naming the top-level block and
        // counting only WITHIN it is unambiguous, and it survives the `insertNode` split the same way
        // the character offset does: the wbr marker is spliced inside a block, never between blocks.
        // Consumed by media-src/src/editing/caret.ts's `{blockIndex, offsetInBlock}` intent.
        // The address is a PATH of child indices down to the caret's OWN element, not a single
        // top-level block index: inside a list the top-level block is the <ul>, so a top-level index
        // puts every <li> back into one shared character space and reproduces the very ambiguity this
        // replaces, one level down (measured — the caret still snapped back on Enter inside a list).
        'function vmarkdCaretBlockOffset(root: HTMLElement, node: Node, offset: number): {blockPath: number[], offsetInBlock: number} | null {\n' +
        '    if (!root.contains(node)) {\n' +
        '        return null;\n' +
        '    }\n' +
        '    const block = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);\n' +
        '    if (!block || block === root || !root.contains(block)) {\n' +
        '        return null;\n' +
        '    }\n' +
        '    const blockPath: number[] = [];\n' +
        '    let walk: Element | null = block;\n' +
        '    while (walk && walk !== root) {\n' +
        '        const parent: Element | null = walk.parentElement;\n' +
        '        if (!parent) {\n' +
        '            return null;\n' +
        '        }\n' +
        '        blockPath.unshift(Array.prototype.indexOf.call(parent.children, walk));\n' +
        '        walk = parent;\n' +
        '    }\n' +
        '    const pre = document.createRange();\n' +
        '    pre.selectNodeContents(block);\n' +
        '    pre.setEnd(node, offset);\n' +
        '    return { blockPath: blockPath, offsetInBlock: pre.toString().length };\n' +
        '}\n\n' +
        UNDO_CLASS_ANCHOR,
    )
    .replace(
      UNDO_CARET_OFFSET_DECL_ANCHOR,
      `${UNDO_CARET_OFFSET_DECL_ANCHOR}\n        let vmarkdCaretOffset = -1; // task 445 (vMarkd patch)\n        let vmarkdCaretBlock: {blockPath: number[], offsetInBlock: number} | null = null; // task 487`,
    )
    .replace(
      UNDO_CARET_OFFSET_CAPTURE_ANCHOR,
      '                cloneRange = range.cloneRange();\n' +
        '                // Task 445 (vMarkd patch): capture a character offset BEFORE insertNode\n' +
        '                // (below) splits range.startContainer — see the restore branch below for why.\n' +
        '                vmarkdCaretOffset = vmarkdCaretTextOffset(vditor[vditor.currentMode].element, range.startContainer, range.startOffset);\n' +
        '                // Task 487 (vMarkd patch): the structural capture, preferred on restore.\n' +
        '                vmarkdCaretBlock = vmarkdCaretBlockOffset(vditor[vditor.currentMode].element, range.startContainer, range.startOffset);\n' +
        '                const wbrElement = document.createElement("span");',
    )
    .replace(
      UNDO_CARET_OFFSET_RESTORE_ANCHOR,
      '        if (setFocus && cloneRange) {\n' +
        '            // Task 445 (vMarkd patch) — restore via the offset captured above through the\n' +
        '            // caret authority; fall back to the original stale-range restore if the bridge\n' +
        "            // isn't installed. See the file-level comment above for the full mechanism.\n" +
        '            if (vmarkdCaretBlock && window.__vmarkdRequestCaret) {\n' +
        '                // Task 487 (vMarkd patch): structural first — it is the only form that can\n' +
        '                // name an EMPTY block, i.e. the blank line an Enter just created.\n' +
        '                window.__vmarkdRequestCaret(vmarkdCaretBlock);\n' +
        '            } else if (vmarkdCaretOffset >= 0 && window.__vmarkdRequestCaret) {\n' +
        '                window.__vmarkdRequestCaret({ textOffset: vmarkdCaretOffset });\n' +
        '            } else {\n' +
        '                setSelectionFocus(cloneRange);\n' +
        '            }\n' +
        '        }',
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
// Task 517 — `uploadFiles` slices its input by `filesMax` (1 unless upload.multiple) BEFORE
// looking at what the entries are. A drop that carries both a file and a `text/plain` payload —
// dragging a link and a file together, or any browser drag that stamps both — enumerates the
// STRING item first in Chromium's DataTransferItemList regardless of add order, so `files[0]` is
// the string, `getAsFile()` returns null, and the real File is never reached. The user saw
// nothing at all happen. Filter to file-kind entries first, so the slice counts real files.
const UPLOAD_FILES_ANCHOR = `        let fileList = [];
        const filesMax = vditor.options.upload.multiple === true ? files.length : 1;`
export function patchUploadFilesKindFilter(code) {
  if (!code.includes(UPLOAD_FILES_ANCHOR)) {
    throw new Error(
      'patchUploadFilesKindFilter: anchor not found in vditor upload/index.ts (version drift?)',
    )
  }
  return code.replace(
    UPLOAD_FILES_ANCHOR,
    `        let fileList = [];
        // vmarkd (task 517): drop non-file entries BEFORE the filesMax slice. A mixed
        // string+file DataTransfer otherwise puts a text item at index 0, whose getAsFile()
        // is null, and the real File is never uploaded.
        const fileEntries = Array.from(files as ArrayLike<unknown>).filter(
            (entry: any) => !(entry instanceof DataTransferItem) || entry.kind === "file",
        ) as typeof files;
        files = fileEntries;
        const filesMax = vditor.options.upload.multiple === true ? files.length : 1;`,
  )
}
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
// Tasks 428/461/462 — `fixList`'s own Backspace-at-start handling is wrong in two ways:
//   1. Its "first item → paragraph" branch (:474 below) is gated only on
//      `!liElement.previousElementSibling`, NOT on top-level-ness, so it also fires for a NESTED
//      first item — where it inserts the lifted content as a stray `<p>` SIBLING inside the PARENT
//      `<li>` (via `liElement.parentElement.insertAdjacentHTML("beforebegin", …)`, and for a nested
//      item `parentElement` is the nested `<ul>`) instead of promoting it. That corrupts a still
//      `data-tight="true"` list — task 391's ORIGINAL bug. RE-MEASURED 2026-07-31 (tasks 461/462,
//      `media-src/e2e/list.spec.ts`'s "stock Vditor fixList" probe): Backspace on a nested first item
//      against UNMODIFIED Vditor reproduces `list-tight.test.ts`'s `CORRUPTED` fixture exactly.
//   2. A NON-first item WITH text has no branch at all and falls through to the browser's default
//      merge (task 428 probe, 2026-07-30: "1. otwo" + Backspace → "1. ooneotwo").
// Fix: gate the first-item branch to top-level-only, and route every remaining Backspace-at-start
// case (any nested item, or a top-level non-first item) through `list-backspace.ts`'s
// `handleListKeydown`, called via the `window.__vmarkdListKeydown` seam (the
// patched Vditor source cannot import from our bundle — matches this file's other `window.__vmarkd*`
// bridges). This REPLACES `list-backspace.ts`'s former document CAPTURE-phase keydown listener: an
// override left Vditor's wrong branches in place plus a second listener racing them (ADR-0004's
// argument) — a Vditor bump that changed those branches' guard conditions would make the interceptor
// silently stop matching; this patch's anchor-assert fails the build loudly instead.
const FIX_LIST_FIRST_ITEM_ANCHOR =
  '!liElement.previousElementSibling && range.toString() === "" &&'
// Task 525: the seam moved from before the Tab branch to before the EMPTY-item branch, whose
// "\n\n"-appending Backspace handling is the root cause of the loose-list / dead-key findings. It also
// handles Tab now (Vditor's own Tab branch only acts with the caret at offset 0).
// Task 525 #7: it moved again, to the TOP of fixList's `if (liElement) {` block, so it also runs before
// fixList's own Enter branch for loose items ("li 中有多个 P"), which would otherwise pre-empt our
// Enter-at-end-of-an-item-with-a-sublist handling. `handleListKeydown` returns false for every key it
// does not own, so the branches below stay reachable exactly as before.
const FIX_LIST_EMPTY_ITEM_ANCHOR =
  '    const liElement = hasClosestByMatchTag(startContainer, "LI");\n    if (liElement) {\n'
// Task 525 #4: `listOutdent` only re-spins the list the CALLER passes (the immediate sub-list), so the
// outdented item keeps its stale `data-marker` (`1. bbb` instead of `3. bbb`). Rebind to the top list
// just before the spin so every caller (Shift+Tab, toolbar, our Backspace) renumbers.
const FIX_LIST_OUTDENT_SPIN_ANCHOR =
  '        if (vditor.currentMode === "wysiwyg") {\n            topListElement.outerHTML = vditor.lute.SpinVditorDOM(topListElement.outerHTML);'
export function patchFixListOutdent(code) {
  for (const anchor of [
    FIX_LIST_FIRST_ITEM_ANCHOR,
    FIX_LIST_EMPTY_ITEM_ANCHOR,
    FIX_LIST_OUTDENT_SPIN_ANCHOR,
  ]) {
    if (!code.includes(anchor)) {
      throw new Error(
        'patchFixListOutdent: anchor not found in vditor fixBrowserBehavior.ts (version drift?)',
      )
    }
  }
  return code
    .replace(
      FIX_LIST_FIRST_ITEM_ANCHOR,
      '!liElement.previousElementSibling && !hasClosestByMatchTag(liElement.parentElement, "LI") && range.toString() === "" &&',
    )
    .replace(
      FIX_LIST_EMPTY_ITEM_ANCHOR,
      FIX_LIST_EMPTY_ITEM_ANCHOR +
        '        if ((window as any).__vmarkdListKeydown?.(vditor, liElement, range, vditor[vditor.currentMode].element, event)) {\n' +
        '            event.preventDefault();\n' +
        '            return true;\n' +
        '        }\n\n',
    )
    .replace(
      FIX_LIST_OUTDENT_SPIN_ANCHOR,
      '        topListElement = getTopList(liElements[0]) || topListElement;\n' +
        FIX_LIST_OUTDENT_SPIN_ANCHOR,
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
// Task 492 Phase 5: `upload` is the ONE toolbar item MenuItem.ts builds as a `<div>` instead of a
// `<button>` (the `menuItem.name === "upload"` special case) — no native keyboard activation
// (Enter/Space don't synthesize a click on a plain div), no button semantics for AT. Drop the
// exception so `upload`'s trigger is a real `<button>` like every other toolbar item; nothing else
// in MenuItem.ts branches on tagName, so this is safe for the one caller (Upload.ts) that overrides
// its contents afterward — see patchUploadHiddenInput below, which relies on this being a button.
const UPLOAD_TAGNAME_ANCHOR =
  'const tagName = menuItem.name === "upload" ? "div" : "button";'
export function patchUploadTagName(code) {
  if (!code.includes(UPLOAD_TAGNAME_ANCHOR)) {
    throw new Error(
      'patchUploadTagName: anchor not found in vditor toolbar/MenuItem.ts (version drift?)',
    )
  }
  return code.replace(UPLOAD_TAGNAME_ANCHOR, 'const tagName = "button";')
}
// Task 492 Phase 5, other half of the upload fix: Upload.ts (unchanged by the patch above) still
// nests the real `<input type="file">` INSIDE that trigger — now a `<button>` — via
// `this.element.children[0].innerHTML = icon + inputHTML`. A `<button>` containing an `<input>` is
// invalid content (interactive-in-interactive) and, worse, `input.click()` on activation would
// dispatch a bubbling click that re-enters the button's OWN listener (input is button's descendant)
// — an infinite loop. Move the input OUT to be a hidden, tab-inert SIBLING of the button (still a
// child of `this.element`, so `this.element.querySelector("input")` below keeps finding it) and have
// the button's own click explicitly open it — the standard "hidden file input + visible trigger"
// pattern, and the only way to keep both a semantic button AND a working file picker.
const UPLOAD_INNER_HTML_ANCHOR =
  'this.element.children[0].innerHTML = `${(menuItem.icon || \'<svg><use xlink:href="#vditor-icon-upload"></use></svg>\')}${inputHTML}>`;'
const UPLOAD_CLICK_GUARD_ANCHOR =
  'this.element.children[0].addEventListener(getEventName(), (event) => {\n' +
  '            if (this.element.firstElementChild.classList.contains(Constants.CLASS_MENU_DISABLED)) {\n' +
  '                event.stopPropagation();\n' +
  '                event.preventDefault();\n' +
  '                return;\n' +
  '            }\n' +
  '        });'
export function patchUploadHiddenInput(code) {
  if (
    !code.includes(UPLOAD_INNER_HTML_ANCHOR) ||
    !code.includes(UPLOAD_CLICK_GUARD_ANCHOR)
  ) {
    throw new Error(
      'patchUploadHiddenInput: anchor not found in vditor toolbar/Upload.ts (version drift?)',
    )
  }
  return code
    .replace(
      UPLOAD_INNER_HTML_ANCHOR,
      `${UPLOAD_INNER_HTML_ANCHOR}\n` +
        '        const vmarkdUploadInput = this.element.children[0].querySelector("input");\n' +
        '        vmarkdUploadInput.tabIndex = -1;\n' +
        '        vmarkdUploadInput.style.display = "none";\n' +
        '        this.element.appendChild(vmarkdUploadInput);',
    )
    .replace(
      UPLOAD_CLICK_GUARD_ANCHOR,
      UPLOAD_CLICK_GUARD_ANCHOR.replace(
        '        });',
        '            this.element.querySelector("input").click();\n' +
          '        });',
      ),
    )
}
// Task 505 follow-up: `Headings`/`EditMode` are the two toolbar items whose dropdown ROWS Vditor
// builds from a raw `innerHTML` template (H1-H6 in Headings.ts, WYSIWYG/IR/SplitView in
// EditMode.ts) instead of the generic `IMenuItem`/`MenuItem.ts` path `toolbar.ts`'s `hotkey: ''`
// neutralises — so they were untouched by that change and kept showing Vditor's native
// `<Alt+Ctrl+N>` bracket style, inconsistent with every promoted item's `(Ctrl+X)` style from
// `formatTip`. Cosmetic only, not a "one owner per key" fix: these rows' hotkeys
// (`Ctrl+Alt+1..6`/`Ctrl+Alt+7..9`) are ALSO hardcoded directly in `editorCommonEvent.ts` (two
// `isCtrl(event) && event.altKey && ...Digit[1-6|7-9]` blocks, entirely separate from the
// `IMenuItem.hotkey`/`matchHotKey` table `hotkey: ''` disables) — not VS Code keybindings, not
// promoted, and not colliding with any known VS Code default, so left live; only the DISPLAYED
// bracket style is patched here, to match every other tooltip in the toolbar.
const HEADINGS_H1_ANCHOR = '${updateHotkeyTip("&lt;⌥⌘1>")}'
const HEADINGS_H26_ANCHORS = [2, 3, 4, 5, 6].map(
  (n) => ` &lt;${'$'}{updateHotkeyTip("⌥⌘${n}")}>`,
)
export function patchHeadingsTooltipBrackets(code) {
  if (
    !code.includes(HEADINGS_H1_ANCHOR) ||
    HEADINGS_H26_ANCHORS.some((a) => !code.includes(a))
  ) {
    throw new Error(
      'patchHeadingsTooltipBrackets: anchor not found in vditor toolbar/Headings.ts (version drift?)',
    )
  }
  let out = code.replace(HEADINGS_H1_ANCHOR, '(${updateHotkeyTip("⌥⌘1")})')
  for (const anchor of HEADINGS_H26_ANCHORS) {
    out = out.replace(anchor, anchor.replace(' &lt;', ' (').replace('>', ')'))
  }
  return out
}
const EDIT_MODE_ANCHORS = [7, 8, 9].map(
  (n) => ` &lt;${'$'}{updateHotkeyTip("⌥⌘${n}")}>`,
)
export function patchEditModeTooltipBrackets(code) {
  if (EDIT_MODE_ANCHORS.some((a) => !code.includes(a))) {
    throw new Error(
      'patchEditModeTooltipBrackets: anchor not found in vditor toolbar/EditMode.ts (version drift?)',
    )
  }
  let out = code
  for (const anchor of EDIT_MODE_ANCHORS) {
    out = out.replace(anchor, anchor.replace(' &lt;', ' (').replace('>', ')'))
  }
  return out
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
// Task 385 — the clipboard on a COLLAPSED caret. Both defects were probe-confirmed in task 191
// (`media-src/e2e/copy-cut-probes.spec.ts`, PROBE-14/15) and deliberately left in place then,
// pending a product decision. The decision: a VS Code editor must behave like VS Code.
//
// `cutEvent` calls `copy(...)` and then `document.execCommand("delete")` UNCONDITIONALLY. The
// IR/WYSIWYG `copy` early-returns on an empty selection, so with a collapsed caret nothing reaches
// the clipboard — but the delete still runs, and Ctrl+X becomes a SILENT BACKSPACE that eats the
// character before the caret. VS Code cuts the whole line there; it never eats one character.
//
// Two different remedies, because the two keys need different ones:
//   - COPY expands the collapsed selection to the current block (in a keydown handler — see
//     clipboard-line.ts for why it cannot be done here), so Vditor's own serializer produces real
//     markdown for the line.
//   - CUT is simply made INERT when the selection is collapsed. Expanding there was tried and
//     rejected: the browser cuts natively AND Vditor's deferred `execCommand("delete")` then fires
//     against a since-collapsed selection, deleting part of the block. A no-op is strictly better
//     than both that and the stealth backspace; line-cut parity is follow-up work, not shipped
//     half-done.
const COPY_EVENT_ANCHOR = `        editorElement.addEventListener("copy", (event: ClipboardEvent) => copy(event, vditor));`
const CUT_EVENT_ANCHOR = `        editorElement.addEventListener("cut", (event: ClipboardEvent) => {
            copy(event, vditor);`
const CUT_DELETE_ANCHOR = `            document.execCommand("delete");`
export function patchClipboardCollapsed(code) {
  if (
    !code.includes(COPY_EVENT_ANCHOR) ||
    !code.includes(CUT_EVENT_ANCHOR) ||
    !code.includes(CUT_DELETE_ANCHOR)
  ) {
    throw new Error(
      'patchClipboardCollapsed: copy/cut anchors not found in vditor util/editorCommonEvent.ts (version drift?)',
    )
  }
  return code
    .replace(
      COPY_EVENT_ANCHOR,
      `        editorElement.addEventListener("copy", (event: ClipboardEvent) => {
            (window as any).__vmarkdExpandToLine?.(editorElement);
            copy(event, vditor);
        });`,
    )
    .replace(
      CUT_EVENT_ANCHOR,
      // The live selection CANNOT be trusted here. Measured in a real VS Code: the webview's own
      // clipboard bridge answers Ctrl+X by calling document.execCommand("cut") from a host-message
      // handler, and by the time this listener runs the selection reports collapsed === false — an
      // empty range that is nonetheless not collapsed. Reading it let execCommand("delete") through
      // and the stealth backspace this guard exists to prevent happened anyway, one character every
      // time. So ask clipboard-line.ts what the KEYSTROKE saw, and only fall back to the live
      // selection for a cut that did not come from Ctrl+X (context menu, toolbar).
      `        editorElement.addEventListener("cut", (event: ClipboardEvent) => {
            const vmarkdIntent = (window as any).__vmarkdTakeCutIntent?.();
            const vmarkdSel = window.getSelection();
            const vmarkdCollapsed = typeof vmarkdIntent === "boolean" ? vmarkdIntent :
                (!vmarkdSel || vmarkdSel.rangeCount === 0 ||
                vmarkdSel.getRangeAt(0).collapsed);
            copy(event, vditor);`,
    )
    .replace(
      CUT_DELETE_ANCHOR,
      `            if (!vmarkdCollapsed) { document.execCommand("delete"); }`,
    )
}

// Task 387 — cutting a selected multi-line paragraph left its last line behind (85 of ~96
// characters removed, measured on a real selection in a real VS Code). Same root cause as task
// 393's paste bug, instrumented there: VS Code's webview clipboard bridge answers Ctrl+X by
// calling document.execCommand("cut") from a host-message handler, so the `execCommand("delete")`
// above (task 385's guarded version) runs WITH execCommand already on the call stack — genuinely
// re-entrant. A forced-synchronous probe proved what Chromium does with that: silently REFUSE it
// (`execCommand` returns `false`, nothing deleted, no throw). The old `fixCut()` (utils.ts)
// deferred it into a `setTimeout` instead, which let it eventually fire — but a macrotask later,
// against whatever the selection had collapsed to by then: `deleteContentBackward` against an
// empty range, not the cut range. That is the measured 85-character loss.
//
// The fix mirrors task 393's: `range.deleteContents()` is a plain DOM mutation, not an editing
// command, so the recursion guard never applies and it cannot race a later selection state. Unlike
// `insertHTML`'s delete (task 393), cut has no manual re-spin afterward to fall back on — normally
// `execCommand("delete")`'s native "input" event drives Vditor's OWN `input()` pipeline (spin +
// undo-stack entry), which `deleteContents()` does not fire. So this re-drives it BY HAND, the same
// way `fixCodeBlock`'s Enter handler already does after its own `range.extractContents()` in this
// same vendored file (`IRInput(vditor, range)` / `input(vditor, range)`) — a precedented pattern in
// this exact codebase for "I mutated the DOM programmatically, now make Vditor treat it like a real
// edit" (spin, re-render, ONE undo-stack entry), not a new mechanism.
//
// sv is DELIBERATELY EXCLUDED, the hard way. Measured (real clipboard, real Ctrl+X, both a
// minimal fixture and the full torture.md fixture) that sv's cut was NEVER broken — its
// execCommand("delete") is not refused the way ir/wysiwyg's is. First attempt routed sv through
// the same deleteContents() path anyway (simpler code, one less branch) and that BROKE sv: the
// DOM mutation happened, but sv has no IRInput/wysiwyg-input equivalent to re-drive by hand, so
// nothing told sv's own render/sync pipeline the edit happened and the cut silently no-opped —
// caught by an e2e regression pin, not inspection. sv keeps its original, already-correct call.
//
// Multi-BLOCK selections (task 387 follow-up, measured before writing any code): a selection
// spanning several top-level paragraphs does NOT lose data with the fix above — clipboard, the
// removed range, and undo were all verified correct on a real 3-paragraph cut. The one real
// defect: `Range.deleteContents()` does not merge block-level ancestors the way a native
// contenteditable delete does. Deleting "…start[SELECTED ACROSS PARAGRAPHS]end…" leaves the
// remaining prefix and suffix as TWO separate `<p>` elements (a spurious paragraph break) instead
// of one joined paragraph — `deleteContents()` only removes/splices nodes between the boundary
// points, it never merges the partially-contained ancestors themselves. Fixed by merging them
// back by hand when it's the plain, common shape both sides being ordinary top-level `<p>`
// paragraphs (the parent is the editor root itself) — exactly the single-soft-break-paragraph
// case this bug was originally reported against, generalised to N adjacent paragraphs. Anything
// more structurally exotic (a selection crossing into a list item, blockquote, table, or code
// block) is deliberately left unmerged: `deleteContents()`'s default (no data loss, just two
// fragments instead of one) is safe, and inventing a general block-type-pairwise merge algorithm
// for every combination is the redesign-scale risk this task was scoped to avoid.
const CUT_SELECTION_IMPORT_ANCHOR = `import {getCursorPosition, getEditorRange} from "./selection";`
const CUT_HASCLOSEST_IMPORT_ANCHOR = `import {hasClosestByAttribute, hasClosestByMatchTag} from "./hasClosest";`
const CUT_SYNC_DELETE_ANCHOR = `            if (!vmarkdCollapsed) { document.execCommand("delete"); }`
export function patchCutDeleteSync(code) {
  if (
    !code.includes(CUT_SELECTION_IMPORT_ANCHOR) ||
    !code.includes(CUT_HASCLOSEST_IMPORT_ANCHOR) ||
    !code.includes(CUT_SYNC_DELETE_ANCHOR)
  ) {
    throw new Error(
      'patchCutDeleteSync: import/delete anchors not found in vditor util/editorCommonEvent.ts (version drift?)',
    )
  }
  return code
    .replace(
      CUT_SELECTION_IMPORT_ANCHOR,
      `import {getCursorPosition, getEditorRange, setSelectionFocus} from "./selection";
import {input as vmarkdIRInput} from "../ir/input";
import {input as vmarkdWysiwygInput} from "../wysiwyg/input";`,
    )
    .replace(
      CUT_HASCLOSEST_IMPORT_ANCHOR,
      `import {hasClosestBlock, hasClosestByAttribute, hasClosestByMatchTag} from "./hasClosest";`,
    )
    .replace(
      CUT_SYNC_DELETE_ANCHOR,
      // sv is deliberately excluded — measured that sv's execCommand("delete") is NOT re-entrant
      // (it works, unlike ir/wysiwyg's) and, the harder way, that routing it through
      // deleteContents() anyway breaks it: sv has no equivalent of IRInput/wysiwyg input to
      // re-drive by hand, so the DOM mutation never reaches its own render/sync pipeline and the
      // cut silently no-ops. sv keeps the original (already-correct-for-sv) call.
      `            if (!vmarkdCollapsed) {
                if (vditor.currentMode === "sv") {
                    document.execCommand("delete");
                } else {
                    const vmarkdCutRange = getEditorRange(vditor);
                    if (vmarkdCutRange.toString() !== "") {
                        const vmarkdEditorEl = vditor[vditor.currentMode].element;
                        const vmarkdStartBlock = hasClosestBlock(vmarkdCutRange.startContainer);
                        const vmarkdEndBlock = hasClosestBlock(vmarkdCutRange.endContainer);
                        vmarkdCutRange.deleteContents();
                        if (vmarkdStartBlock && vmarkdEndBlock && vmarkdStartBlock !== vmarkdEndBlock &&
                            vmarkdStartBlock.tagName === "P" && vmarkdEndBlock.tagName === "P" &&
                            vmarkdStartBlock.parentElement === vmarkdEditorEl &&
                            vmarkdEndBlock.parentElement === vmarkdEditorEl &&
                            vmarkdEndBlock.isConnected) {
                            const vmarkdMergePoint = document.createTextNode("");
                            vmarkdStartBlock.appendChild(vmarkdMergePoint);
                            while (vmarkdEndBlock.firstChild) {
                                vmarkdStartBlock.appendChild(vmarkdEndBlock.firstChild);
                            }
                            vmarkdEndBlock.remove();
                            vmarkdCutRange.setStart(vmarkdMergePoint, 0);
                        }
                        vmarkdCutRange.collapse(true);
                        setSelectionFocus(vmarkdCutRange);
                        if (vditor.currentMode === "wysiwyg") {
                            vmarkdWysiwygInput(vditor, vmarkdCutRange);
                        } else if (vditor.currentMode === "ir") {
                            vmarkdIRInput(vditor, vmarkdCutRange);
                        }
                    }
                }
            }`,
    )
}

// Task 393 — pasting plain text (or HTML, or a drop) over a non-collapsed selection inserted the
// new content BEFORE the selection instead of replacing it, and ate the selection's last
// character. Measured in a real VS Code with instrumented execCommand: VS Code's webview
// clipboard bridge answers Ctrl+V by calling `document.execCommand("paste")` from a
// host-message handler, so `insertHTML`'s own `document.execCommand("delete", false, "")` below
// runs WITH execCommand already on the call stack — genuinely re-entrant. Chromium's recursion
// guard SILENTLY REFUSES it there (`execCommand` returns `false`, no throw, nothing deleted) —
// confirmed by forcing the call synchronous and diffing the DOM before/after (unchanged). The
// OLD workaround (`fixCut()` in media-src/src/utils.ts, applied globally) deferred every
// `execCommand("delete")` into a `setTimeout` to dodge that guard — which let this one fire, but
// a macrotask later, against whatever the selection had collapsed to by then: a stealth
// backspace, one character short. `range.deleteContents()` is a plain DOM mutation, not an
// editing command, so the recursion guard never applies and it can never race a later selection
// state — it runs at the exact moment the still-valid `range` describes the selection.
//
// It fires no native `input` event, unlike `execCommand("delete")` — so `preventInput` (which
// exists only so the IR/WYSIWYG `input` listener can swallow THAT event once and call
// `processAfterRender` itself, see ir/index.ts and wysiwyg/index.ts) must NOT be set here: with
// nothing to swallow, the flag would stay `true` and wrongly intercept the very next real
// keystroke's `input` event.
const INSERT_HTML_DELETE_ANCHOR = `    const range = getEditorRange(vditor);
    if (range.toString() !== "") {
        vditor[vditor.currentMode].preventInput = true;
        document.execCommand("delete", false, "");
    }`
export function patchInsertHtmlDelete(code) {
  if (!code.includes(INSERT_HTML_DELETE_ANCHOR)) {
    throw new Error(
      'patchInsertHtmlDelete: delete anchor not found in vditor util/selection.ts (version drift?)',
    )
  }
  return code.replace(
    INSERT_HTML_DELETE_ANCHOR,
    `    const range = getEditorRange(vditor);
    if (range.toString() !== "") {
        range.deleteContents();
    }`,
  )
}

// Task 519 — typing a multi-word heading drops the space after the first word (`# Untitled
// journey` → `# Untitledjourney`), real-VS-Code-webview only. Root-caused by wrapping Lute's
// entry points at runtime (test/vscode-e2e/space-drop-caller-probe.spec.ts): the SPACE that
// disappears was never actually eaten as a keystroke — it lands in the DOM, then a later
// `SpinVditorIRDOM` receives `<span class="vditor-ir__marker vditor-ir__marker--heading">#
// Untitled <wbr></span>` (the ENTIRE typed run sitting INSIDE the marker span) and correctly
// re-splits that into marker `# ` + text `Untitled`, consuming the boundary space as the
// delimiter. So every keystroke after `# ` promotion was landing INSIDE the marker span instead
// of as a sibling of it — confirmed at the DOM-shape level too (an isolated Node Lute probe: `Md2
// VditorIRDOM`/`SpinVditorIRDOM` on `'# Untitled '` puts the wbr as `<h1>`'s marker-span
// sibling, exactly where a correct caret restore should land).
//
// `setRangeByWbr` (right below `patchInsertHtmlDelete`'s target in this same file) is WHERE that
// goes wrong: it already documents this as a "Chrome set range bug" (see the `**c**` comment
// below) — Chrome's native contenteditable typing does not reliably treat a collapsed Range at an
// ELEMENT-offset boundary right after an inline element as "start a new sibling"; it can instead
// extend the END of that preceding element. Vditor's own fix is to insert a ZWSP text node right
// after the marker so Chrome has an unambiguous text-node anchor to type into — but it is gated to
// `tagName === "EM" || "STRONG" || "S"` (bold/italic/strikethrough) only. The heading marker
// (`SPAN.vditor-ir__marker--heading`) produces the IDENTICAL DOM shape after promotion
// (`<span class="…marker--heading">#&nbsp;</span><wbr>`) and hits the exact same Chrome bug, but
// was never added to the list — so it gets no anchor, and typing accumulates inside the marker
// until the next real spin drops the boundary space. Widen the tag check to also cover it.
//
// (Real-webview-only because the harness's own 10 typed-heading cells never happened to chain
// "promote, then immediately continue typing in the SAME burst" against this exact seeded-leading-
// block shape — the bug is a Chrome contenteditable quirk, not something the harness structurally
// cannot reach; `isChrome()` is true in both environments.)
const SET_RANGE_BY_WBR_CHROME_FIX = `                if (isChrome() && (wbrElement.previousElementSibling.tagName === "EM" ||
                    wbrElement.previousElementSibling.tagName === "STRONG" ||
                    wbrElement.previousElementSibling.tagName === "S")) {`
export function patchSetRangeByWbrHeadingMarker(code) {
  if (!code.includes(SET_RANGE_BY_WBR_CHROME_FIX)) {
    throw new Error(
      'patchSetRangeByWbrHeadingMarker: Chrome-bug tag-check anchor not found in vditor util/selection.ts (version drift?)',
    )
  }
  return code.replace(
    SET_RANGE_BY_WBR_CHROME_FIX,
    `                if (isChrome() && (wbrElement.previousElementSibling.tagName === "EM" ||
                    wbrElement.previousElementSibling.tagName === "STRONG" ||
                    wbrElement.previousElementSibling.tagName === "S" ||
                    (wbrElement.previousElementSibling as HTMLElement).classList.contains("vditor-ir__marker--heading"))) {`,
  )
}

// The same collapsed-caret story on the COPY side, in split mode only. `sv`'s copy handler writes
// `getSelectText(...)` to text/plain with no empty-selection guard (IR and WYSIWYG both have one),
// so a Ctrl+C with nothing selected sets text/plain to "" — it does not merely fail to copy, it
// WIPES whatever was on the clipboard. That is the user-visible "copy/paste doesn't work": copy,
// then paste, and nothing comes back. Expand to the line first, exactly as the cut path does, and
// bail out entirely if there is nothing to copy rather than clobbering the clipboard.
const SV_COPY_ANCHOR = `    private copy(event: ClipboardEvent, vditor: IVditor) {
        event.stopPropagation();
        event.preventDefault();
        event.clipboardData.setData("text/plain", getSelectText(vditor[vditor.currentMode].element));`
export function patchSvCopyGuard(code) {
  if (!code.includes(SV_COPY_ANCHOR)) {
    throw new Error(
      'patchSvCopyGuard: copy anchor not found in vditor sv/index.ts (version drift?)',
    )
  }
  return code.replace(
    SV_COPY_ANCHOR,
    `    private copy(event: ClipboardEvent, vditor: IVditor) {
        (window as any).__vmarkdExpandToLine?.(vditor[vditor.currentMode].element);
        const vmarkdText = getSelectText(vditor[vditor.currentMode].element);
        if (vmarkdText === "") {
            return;
        }
        event.stopPropagation();
        event.preventDefault();
        event.clipboardData.setData("text/plain", vmarkdText);`,
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

// Task 386 — copying from the SPLIT-VIEW PREVIEW pane silently did nothing.
//
// `preview/index.ts` handles its own `copy` event by cloning the selection into a temp element and
// calling `copyToX`, which ends in `document.execCommand("copy")` — RE-ENTRANT, because it runs
// inside that very `copy` handler — and then `preventDefault()`s the original event. In a VS Code
// webview (a doubly-nested OOPIF) Chromium refuses the re-entrant clipboard write but STILL RETURNS
// TRUE, so the native copy was cancelled and nothing ever reached the clipboard.
//
// Measured, not deduced: the copy event fired on the pane (`target: P`, clipboardData present),
// `execCommand("copy")` returned `true`, and the system clipboard kept its previous sentinel value —
// while the identical keystroke in the sv EDIT pane, which uses `clipboardData.setData`, copied
// correctly in the same run. That control is what rules out focus, keyboard routing and the VS Code
// clipboard bridge.
//
// Fix: write the event's own `clipboardData`, the mechanism every other pane already uses and which
// is proven to work here. The KaTeX fix-up is kept so pasted math renders. copyToX's white
// background and code-background overrides are deliberately NOT carried over — they exist for the
// WeChat/Zhihu export buttons (which still call copyToX and are untouched), and forcing a white
// background on an ordinary Ctrl+C would paste wrongly into a dark document.
const PREVIEW_COPY_EXEC_ANCHOR = `            this.copyToX(vditor, tempElement, "default");
            event.preventDefault();`
export function patchPreviewCopyClipboardData(code) {
  if (!code.includes(PREVIEW_COPY_EXEC_ANCHOR)) {
    throw new Error(
      'patchPreviewCopyClipboardData: copy anchor not found in vditor preview/index.ts (version drift?)',
    )
  }
  return code.replace(
    PREVIEW_COPY_EXEC_ANCHOR,
    `            tempElement.querySelectorAll(".katex-html .base").forEach((item: HTMLElement) => {
                item.style.display = "initial";
            });
            event.clipboardData.setData("text/html", tempElement.outerHTML);
            event.clipboardData.setData("text/plain", tempElement.textContent || "");
            vditor.tip.show("Copied to clipboard");
            event.preventDefault();`,
  )
}
// Task 390: the link toolbar button ignored a selected URL. Vditor treats the selection as label
// text unconditionally, so selecting `https://example.com` and clicking 🔗 produced
// `[https://example.com](https://)` — the URL became the link TEXT and the destination stayed the
// literal placeholder, i.e. the one thing the user had already supplied was the one thing missing.
//
// A URL-shaped selection now fills BOTH halves: `[https://example.com](https://example.com)`.
// Ordinary text is untouched — it stays the label with the caret in the placeholder destination,
// which is the right behaviour for it and the case a false positive would wreck. The detector lives
// in media-src/src/link-url.ts and reaches these patched Vditor sources through the
// `__vmarkdSelectedUrl` global (they cannot import from our bundle); `?.` so a harness without it
// falls back to stock behaviour.
const IR_LINK_INSERT_ANCHOR =
  '                html = `${prefix}${range.toString()}${suffix.replace(")", "<wbr>)")}`;'
export function patchIrLinkSelectedUrl(code) {
  if (!code.includes(IR_LINK_INSERT_ANCHOR)) {
    throw new Error(
      'patchIrLinkSelectedUrl: link anchor not found in vditor ir/process.ts (version drift?)',
    )
  }
  // IR builds the link as an HTML string for insertHTML, so both halves are escaped here — a `&` in
  // a query string would otherwise be parsed as an entity. `<wbr>` after the closing paren leaves
  // the caret past the finished link, since there is nothing left to fill in.
  return code.replace(
    IR_LINK_INSERT_ANCHOR,
    `                const vmarkdUrl = (window as any).__vmarkdSelectedUrl?.(range.toString());
                const vmarkdEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
                if (vmarkdUrl) { (window as any).__vmarkdExplicitEdit?.(); }
                html = vmarkdUrl
                    ? \`\${prefix}\${vmarkdEsc(range.toString())}](\${vmarkdEsc(vmarkdUrl)}<wbr>)\`
                    : \`\${prefix}\${range.toString()}\${suffix.replace(")", "<wbr>)")}\`;`,
  )
}
// The WYSIWYG twin. It builds a real <a> node rather than an HTML string (so no escaping is needed)
// and then opens the link popover; setting href BEFORE genAPopover is what makes the popover show
// the destination already filled in.
const WYSIWYG_LINK_HREF_ANCHOR =
  '                node.setAttribute("href", "");'
export function patchWysiwygLinkSelectedUrl(code) {
  if (!code.includes(WYSIWYG_LINK_HREF_ANCHOR)) {
    throw new Error(
      'patchWysiwygLinkSelectedUrl: link anchor not found in vditor wysiwyg/toolbarEvent.ts (version drift?)',
    )
  }
  return code.replace(
    WYSIWYG_LINK_HREF_ANCHOR,
    `                const vmarkdHref = (window as any).__vmarkdSelectedUrl?.(range.toString());
                if (vmarkdHref) { (window as any).__vmarkdExplicitEdit?.(); }
                node.setAttribute("href", vmarkdHref || "");`,
  )
}
// Task 392: pasting a URL should produce a markdown link.
//
// Vditor already handles HALF of this — with text selected it wraps the selection:
// `range.toString() !== "" && IsValidLinkDest(textPlain)` → `[selection](url)`. What it does not do
// is the case the user actually reported: paste a URL with NOTHING selected and you get the bare
// URL as text. This adds only that branch, immediately after Vditor's, so the selected-text
// behaviour is left exactly as it is.
//
// Two guards ride along. The caret must not be inside an existing link — pasting into a
// destination has to stay literal — and code is already excluded, because this branch only runs
// after the `codeElement` (fenced + inline code) branch has been ruled out upstream.
//
// The result is flagged as an EXPLICIT edit for the same reason as the link button (task 390):
// `[https://x](https://x)` and the bare URL are the same document under GFM, so the minimal-diff
// write-back would keep the original bytes and the paste would appear to do nothing.
//
// Task 224 residual gap (2026-07-30): Vditor's OWN selection-wrap branch was ungated — turning
// `vmarkd.editor.pasteUrlAsLink` off silently kept wrapping a pasted URL over a SELECTION, because
// only the no-selection branch below consulted the setting. It is now gated too, via
// `__vmarkdPasteUrlEnabled` (link-url.ts) — a separate, minimal boolean, NOT `__vmarkdPasteUrlMd`:
// that helper also runs OUR url-validity detector (selectedUrl), which disagrees with Lute's
// IsValidLinkDest tested in this branch (measured: Lute rejects `mailto:me@example.com` where ours
// accepts it) — reusing it here would change WHICH pastes wrap, not just whether the setting is
// honoured.
// Task 242 (and the shared hook 218 will build on) — rewrite pasted `text/plain` at the ONE point
// vditor reads it, before any branch decides what to do with it. A capture-phase listener cannot do
// this: a paste event's clipboardData is read-only, so intercepting would mean preventDefault +
// inserting ourselves, bypassing the code-fence handling, the HTML-vs-plain decision, undo grouping
// and the edit post. One line here leaves all of that untouched and only cleans the input.
//
// Anchored on the clipboardData branch specifically; the dataTransfer branch below it (drag-drop)
// has the identical statement and is deliberately NOT patched — a dropped file/text is a different
// gesture with its own handling, and widening the anchor would silently cover it.
const PASTE_TRANSFORM_ANCHOR = `        textHTML = event.clipboardData.getData("text/html");
        textPlain = event.clipboardData.getData("text/plain");`
export function patchPasteTransform(code) {
  if (!code.includes(PASTE_TRANSFORM_ANCHOR)) {
    throw new Error(
      'patchPasteTransform: clipboardData anchor not found in vditor util/fixBrowserBehavior.ts (version drift?)',
    )
  }
  return code.replace(
    PASTE_TRANSFORM_ANCHOR,
    `${PASTE_TRANSFORM_ANCHOR}
        // The code context is computed HERE, with the same two expressions vditor's own codeElement
        // branch uses further down, and passed in — the transform runs before that branch exists, and
        // pasting into a fence must stay LITERAL (the task-191 P0-9 contract). Without this a TSV
        // paste would become a markdown table inside a code block.
        const vmarkdInCode = vditor.currentMode === "sv" ?
            !!hasClosestByAttribute(event.target as Element, "data-type", "code-block") :
            !!hasClosestByMatchTag(event.target as Element, "CODE");
        textPlain = (window as any).__vmarkdPasteTransform?.(textPlain, vmarkdInCode) ?? textPlain;`,
  )
}
const PASTE_LINK_ANCHOR = `            if (range.toString() !== "" && vditor.lute.IsValidLinkDest(textPlain)) {
                textPlain = \`[\${range.toString()}](\${textPlain})\`;
            }`
export function patchPasteUrlAsLink(code) {
  if (!code.includes(PASTE_LINK_ANCHOR)) {
    throw new Error(
      'patchPasteUrlAsLink: paste anchor not found in vditor util/fixBrowserBehavior.ts (version drift?)',
    )
  }
  return code.replace(
    PASTE_LINK_ANCHOR,
    `            if (range.toString() !== "" && vditor.lute.IsValidLinkDest(textPlain)) {
                // Gate on the SAME setting as the no-selection branch below — see the task-224
                // comment above this function for why this is a separate accessor, not
                // __vmarkdPasteUrlMd. \`!== false\` keeps stock (always-wrap) behaviour when no
                // accessor is installed (a harness without link-url.ts).
                const vmarkdStartElement = range.startContainer.nodeType === 1 ?
                    range.startContainer as HTMLElement : range.startContainer.parentElement;
                const vmarkdEndElement = range.endContainer.nodeType === 1 ?
                    range.endContainer as HTMLElement : range.endContainer.parentElement;
                const vmarkdStartLink = vmarkdStartElement && vmarkdStartElement.closest("a, [data-type='a']");
                const vmarkdEndLink = vmarkdEndElement && vmarkdEndElement.closest("a, [data-type='a']");
                if ((window as any).__vmarkdPasteUrlEnabled?.() !== false) {
                    if (vmarkdStartLink && vmarkdStartLink === vmarkdEndLink) {
                        const vmarkdLabelElement = vmarkdStartLink.querySelector(".vditor-ir__link");
                        const vmarkdLabel = vmarkdLabelElement?.textContent ||
                            vmarkdStartLink.textContent || range.toString();
                        range.selectNode(vmarkdStartLink);
                        setSelectionFocus(range);
                        textPlain = \`[\${vmarkdLabel}](\${textPlain})\`;
                    } else {
                        textPlain = \`[\${range.toString()}](\${textPlain})\`;
                    }
                }
            }
            // NOTHING selected — and the emptiness is tested EXPLICITLY, not inferred from the
            // branch above being false. That condition is also false when something IS selected and
            // Lute's IsValidLinkDest rejects the clipboard, and the two detectors do disagree:
            // measured, Lute rejects \`mailto:me@example.com\` where ours accepts it. Falling into
            // this branch there would rewrite textPlain to a whole link and REPLACE the user's
            // selection instead of wrapping it — silent data loss on an ordinary paste.
            else if (range.toString() === "") {
                const vmarkdAnchor = range.startContainer.nodeType === 1 ?
                    range.startContainer as HTMLElement : range.startContainer.parentElement;
                const vmarkdInLink = !!(vmarkdAnchor && (vmarkdAnchor.closest("a") ||
                    vmarkdAnchor.closest("[data-type='a']")));
                const vmarkdMd = (window as any).__vmarkdPasteUrlMd?.(textPlain, vmarkdInLink);
                if (vmarkdMd) {
                    textPlain = vmarkdMd;
                    (window as any).__vmarkdExplicitEdit?.();
                }
            }`,
  )
}
// Task 187 (sv split polish): preview.render tears the whole pane down via
// `previewElement.innerHTML = html` on every debounced edit settle — leaflet
// re-initialises, STL re-boots three.js, echarts re-instantiates. Route the write
// through window.__vmarkdMorphPreview (preview-morph.ts: raw-vs-raw block diff that
// keeps unchanged blocks' live DOM); no hook → stock behaviour. Anchored on the
// NON-url else branch only — the xhr fallback branch has the same statements at a
// DEEPER indent and must stay untouched (vMarkd never sets preview.url).
const PREVIEW_MORPH_ANCHOR = `                let html = vditor.lute.Md2HTML(markdownText);
                if (vditor.options.preview.transform) {
                    html = vditor.options.preview.transform(html);
                }
                this.previewElement.innerHTML = html;`
export function patchPreviewMorph(code) {
  if (!code.includes(PREVIEW_MORPH_ANCHOR)) {
    throw new Error(
      'patchPreviewMorph: anchor not found in vditor preview/index.ts (version drift?)',
    )
  }
  return code.replace(
    PREVIEW_MORPH_ANCHOR,
    `                let html = vditor.lute.Md2HTML(markdownText);
                if (vditor.options.preview.transform) {
                    html = vditor.options.preview.transform(html);
                }
                const vmMorph = (window as any).__vmarkdMorphPreview;
                if (vmMorph) { vmMorph(this.previewElement, html); } else { this.previewElement.innerHTML = html; }`,
  )
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
// Perf (task 171 item 1): the IR space fast-path (ir/input.ts startSpace/endSpace) short-circuits the
// spin but calls `vditor.options.input(getMarkdown(vditor))` SYNCHRONOUSLY — a full-document Lute
// serialize on the keystroke→paint path on essentially EVERY inter-word SPACE while appending prose,
// and the result is thrown away (our options.input ignores its arg; counter/cache are off). Gate the
// serialize: only compute getMarkdown when counter/cache actually consume it; otherwise call input()
// with nothing. Two textually-identical sites → assert EXACTLY 2 so a partial apply can't slip by.
const IR_SPACE_INPUT = 'vditor.options.input(getMarkdown(vditor));'
export function patchIrSpaceSerialize(code) {
  const count = code.split(IR_SPACE_INPUT).length - 1
  if (count !== 2) {
    throw new Error(
      `fixIrSpaceSerialize: expected 2 '${IR_SPACE_INPUT}' sites in vditor ir/input.ts, found ${count} (version drift?)`,
    )
  }
  return code
    .split(IR_SPACE_INPUT)
    .join(
      'vditor.options.input((vditor.options.counter.enable || vditor.options.cache.enable) ? getMarkdown(vditor) : undefined);',
    )
}
// Perf (task 171 item 2): ir/input.ts calls `renderToc(vditor)` on EVERY keystroke; renderToc runs a
// SECOND full GopherJS SpinVditorIRDOM (outlineRender) + rewrites every heading id, regardless of
// whether a ToC block / outline panel even exists — a whole extra spin per keystroke on heading-heavy
// docs. Route it through window.__vmarkdDeferRenderToc (edit-activity.ts), which coalesces it to the
// edit-settle. Falls back to the stock call if the hook isn't installed (e.g. the harness).
const IR_RENDER_TOC = 'renderToc(vditor);'
export function patchDeferRenderToc(code) {
  if (!code.includes(IR_RENDER_TOC)) {
    throw new Error(
      'patchDeferRenderToc: renderToc(vditor) anchor not found in vditor ir/input.ts (version drift?)',
    )
  }
  const replacement =
    `if ((window as any).__vmarkdDeferRenderToc) {\n` +
    `        (window as any).__vmarkdDeferRenderToc(vditor, renderToc);\n` +
    `    } else {\n` +
    `        renderToc(vditor);\n` +
    `    }`
  return code.replace(IR_RENDER_TOC, replacement)
}
// Perf (task 172): the per-keystroke spin input is the edited block's outerHTML, which embeds the
// previously-rendered preview SVG/canvas (+ our task-161 keep-last overlay). SpinVditorIRDOM's ParseHTML
// tokenizes that whole multi-thousand-node subtree EVERY keystroke then the AST walker discards it
// (data-render skip is post-parse) — ~66 ms→0.35 ms for a 2000-node diagram. Empty the preview from a
// COPY before the spin (window.__vmarkdStripPreviewForSpin = stripPreviewForSpin, spin-strip.ts); proven
// byte-identical (preview is data-render="2", contributes 0 markdown bytes). Identity fallback if the
// hook isn't installed (e.g. the harness). Unique single anchor → assert exactly 1.
// Task 175 — defer the per-keystroke spin+rebuild while typing inside a fenced diagram/code body. A
// window hook at the TOP of input() early-returns (skips the whole spin + outerHTML rebuild + task-161
// overlay re-layout) for an inert keystroke; the typed char is already native in the source text node so
// the save stays byte-correct, and ONE real spin+render runs on the settle. The hook
// (window.__vmarkdTrySkipFenceSpin, edit-activity.ts) decides via the escape-hatch predicate
// (spin-skip-fence.ts) + the user opt-out flag. Identity-safe (no-op) if the hook isn't installed.
const IR_INPUT_OPEN =
  'export const input = (vditor: IVditor, range: Range, ignoreSpace = false, event?: InputEvent) => {'
export function patchIrFenceSpinSkip(code) {
  if (!code.includes(IR_INPUT_OPEN)) {
    throw new Error(
      'patchIrFenceSpinSkip: input() signature anchor not found in vditor ir/input.ts (version drift?)',
    )
  }
  return code.replace(
    IR_INPUT_OPEN,
    `${IR_INPUT_OPEN}\n    if ((window as any).__vmarkdTrySkipFenceSpin && (window as any).__vmarkdTrySkipFenceSpin(vditor, range, event)) { return; }`,
  )
}
const IR_SPIN_CALL = 'html = vditor.lute.SpinVditorIRDOM(html);'
export function patchIrStripPreviewSpin(code) {
  const count = code.split(IR_SPIN_CALL).length - 1
  if (count !== 1) {
    throw new Error(
      `patchIrStripPreviewSpin: expected 1 '${IR_SPIN_CALL}' in vditor ir/input.ts, found ${count} (version drift?)`,
    )
  }
  return code.replace(
    IR_SPIN_CALL,
    'html = vditor.lute.SpinVditorIRDOM((window as any).__vmarkdStripPreviewForSpin ? (window as any).__vmarkdStripPreviewForSpin(html) : html);',
  )
}
// Task 441 — a list marker should become a list on the SPACE, not only after a letter. IR input()
// has an `endSpace` fast-path: when the block is only a leading marker + trailing space (nothing
// after the caret) it early-returns WITHOUT running SpinVditorIRDOM, so `9. ` / `- ` stays a plain
// paragraph until a content char re-triggers the spin. Vditor already exempts ATX headings from that
// fast-path (`/^#{1,6} $/`, ir/input.ts:62) so `# ` becomes a heading on the space; we widen the SAME
// exemption to list markers. The spin itself already produces the list for a content-less marker
// (verified: SpinVditorIRDOM("9. ") → <ol><li></li></ol>), so clearing `endSpace` is the whole fix —
// the code then falls through to the spin and the empty item forms with the caret inside it. Matches
// ordered (`\d{1,9}[.)]`) and unordered (`-`/`*`/`+`) markers only at block start (regex is `^…$` on
// the block's full text), so a literal "1. " mid-sentence is untouched.
//
// WYSIWYG needs the SAME patch — see patchWysiwygListMarkerOnSpace. (The original note here claimed
// WYSIWYG "always spins and already forms the list". That was wrong, and the e2e caught it: WYSIWYG
// has an identical endSpace early-return, just in a different file — the `input` LISTENER in
// wysiwyg/index.ts rather than wysiwyg/input.ts — so it never even calls input(). Measured: typing
// `9. ` or `- ` there left a plain paragraph.)
const IR_HEADING_SPACE_ANCHOR =
  'if (endSpace && /^#{1,6} $/.test(blockElement.textContent)) {'
export const IR_MARKER_ON_SPACE_RE = /^(?:#{1,6}|\d{1,9}[.)]|[-*+]) $/
export function patchIrListMarkerOnSpace(code) {
  if (!code.includes(IR_HEADING_SPACE_ANCHOR)) {
    throw new Error(
      'patchIrListMarkerOnSpace: heading endSpace anchor not found in vditor ir/input.ts (version drift?)',
    )
  }
  return code.replace(
    IR_HEADING_SPACE_ANCHOR,
    'if (endSpace && /^(?:#{1,6}|\\d{1,9}[.)]|[-*+]) $/.test(blockElement.textContent)) {',
  )
}

// Task 441, WYSIWYG half. Same gesture, same `endSpace` early-return, DIFFERENT file: in WYSIWYG the
// guard lives in the `input` event LISTENER (wysiwyg/index.ts) and returns before `input()` is ever
// called, so Lute never spins the block. Vditor already carves out ATX headings there
// (`/^#{1,6} $/`, its issue #729); widening that same carve-out to list markers is the whole fix —
// measured: Lute's own SpinVditorDOM('<p data-block="0">9. <wbr></p>') already yields
// `<ol start="9"><li><wbr></li></ol>`, so reaching the spin is all that was missing. The anchor text
// is identical to the IR one, hence the shared constant, but the two files are patched separately so
// a version drift in one is reported against the right file.
export function patchWysiwygListMarkerOnSpace(code) {
  if (!code.includes(IR_HEADING_SPACE_ANCHOR)) {
    throw new Error(
      'patchWysiwygListMarkerOnSpace: heading endSpace anchor not found in vditor wysiwyg/index.ts (version drift?)',
    )
  }
  return code.replace(
    IR_HEADING_SPACE_ANCHOR,
    'if (endSpace && /^(?:#{1,6}|\\d{1,9}[.)]|[-*+]) $/.test(blockElement.textContent)) {',
  )
}
// Perf (task 171 item 4): WYSIWYG (afterRenderEvent.ts) and SV (sv/process.ts) compute
// `const text = getMarkdown(vditor)` then pass it to options.input(text), which ignores the arg — dead
// super-linear serialize when counter/cache are off (parity cleanup; the IR default path is task 68).
// Gate it; `text` stays declared so the counter/cache blocks below still compile. Same one-line anchor
// in both files → per-file count assert.
const DEFER_GETMD_TEXT = 'const text = getMarkdown(vditor);'
export function patchDeferGetMarkdown(code, fileLabel) {
  const count = code.split(DEFER_GETMD_TEXT).length - 1
  if (count !== 1) {
    throw new Error(
      `patchDeferGetMarkdown: expected 1 '${DEFER_GETMD_TEXT}' in vditor ${fileLabel}, found ${count} (version drift?)`,
    )
  }
  return code.replace(
    DEFER_GETMD_TEXT,
    'const text = (vditor.options.counter.enable || vditor.options.cache.enable) ? getMarkdown(vditor) : "";',
  )
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
// Mermaid parse-error UX. Vditor's mermaidRender.ts catch dumps mermaid's "bomb" error SVG
// (errorElement.outerHTML) + the raw e.message into a bare <small>, with `e.message.replace(/\n/,
// "<br>")` — no /g, so only the FIRST newline survives and multi-line parser errors (with the caret
// diagram) mash together; it also crashes if errorElement is null. We (1) set
// `suppressErrorRendering: true` so mermaid never injects the bomb (render() just throws), and (2)
// replace the catch with the shared compact, themed `.vmarkd-diagram-error` box (task 178 —
// generalised across engines; markup mirrors diagram-error.ts `diagramErrorHtml('mermaid', …)`) whose
// <pre> preserves every newline incl. the caret diagram (escaped so source `<…>` can't inject HTML).
// The box carries data-render="1" and lives in the `data-render="2"` preview half → invisible to the
// Lute round-trip. Styled in media-src/src/main.css. Anchored on the config flag + the catch body;
// throws on drift.
const MERMAID_START_ON_LOAD = 'startOnLoad: false,'
const MERMAID_CATCH_RE =
  /\} catch \(e\) \{[\s\S]*?errorElement\.parentElement\.remove\(\);\s*\}/
const MERMAID_ERROR_CATCH = `} catch (e) {
                // vMarkd (patchMermaidErrorRender): suppressErrorRendering (above) stops mermaid
                // injecting its bomb SVG, so render the shared themed box instead. <pre> keeps every
                // newline incl. the caret diagram; escape so source <…> can't inject HTML. data-render="1"
                // + the data-render="2" preview → invisible to the Lute round-trip. Mirrors diagram-error.ts.
                const stray = document.querySelector("#" + id);
                if (stray && stray.parentElement) { stray.parentElement.remove(); }
                const msg = String(e && e.message ? e.message : e)
                    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                item.innerHTML = '<div class="vmarkd-diagram-error" data-render="1">' +
                    '<div class="vmarkd-diagram-error__title">Mermaid</div>' +
                    '<pre class="vmarkd-diagram-error__msg">' + msg + '</pre></div>';
            }`
export function patchMermaidErrorRender(code) {
  if (
    !code.includes('errorElement.outerHTML') ||
    !MERMAID_CATCH_RE.test(code)
  ) {
    throw new Error(
      'patchMermaidErrorRender: mermaidRender.ts catch-block anchor not found (version drift?)',
    )
  }
  if (!code.includes(MERMAID_START_ON_LOAD)) {
    throw new Error(
      'patchMermaidErrorRender: mermaid config `startOnLoad: false,` anchor not found (version drift?)',
    )
  }
  return code
    .replace(
      MERMAID_START_ON_LOAD,
      `${MERMAID_START_ON_LOAD}\n            suppressErrorRendering: true,`,
    )
    .replace(MERMAID_CATCH_RE, () => MERMAID_ERROR_CATCH)
}

// Mermaid's C4 renderer does not consume themeVariables for relationship labels, lines, or
// arrowheads: it emits #444444/#000000 inline even in dark palettes. Run a typed, scoped DOM hook
// immediately after Vditor inserts the SVG. The hook itself is installed by mermaid-theme.ts, and
// the optional call keeps a standalone Vditor harness compatible.
const MERMAID_C4_INSERT_ANCHOR = 'item.innerHTML = mermaidData.svg;'
export function patchMermaidC4Colors(code) {
  if (!code.includes(MERMAID_C4_INSERT_ANCHOR)) {
    throw new Error(
      'patchMermaidC4Colors: mermaid SVG insertion anchor not found (version drift?)',
    )
  }
  return code.replace(
    MERMAID_C4_INSERT_ANCHOR,
    `${MERMAID_C4_INSERT_ANCHOR}\n                (window as any).__vmarkdStyleMermaidC4?.(item, theme);`,
  )
}
// Task 178 — generalise the mermaid error box to the other NATIVE Vditor renderers (echarts, mindmap,
// flowchart) that can't import diagram-error.ts. Each produces ONE JS statement that builds the shared
// `.vmarkd-diagram-error` box BYTE-IDENTICAL to diagram-error.ts `diagramErrorHtml(...)` (same class,
// same &/</> escape, same <pre>) — `elVar` is the preview element in scope, `title` the engine label.
// Keep in sync with diagram-error.ts + main.css `.vmarkd-diagram-error`.
function diagramErrorBoxStmt(elVar, title, errVar = 'error') {
  return (
    `const vmErrMsg = String(${errVar} && ${errVar}.message ? ${errVar}.message : ${errVar}).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); ` +
    `${elVar}.innerHTML = '<div class="vmarkd-diagram-error" data-render="1">' + '<div class="vmarkd-diagram-error__title">${title}</div>' + '<pre class="vmarkd-diagram-error__msg">' + vmErrMsg + '</pre></div>';`
  )
}
// echarts (chartRender.ts) and mindmap (mindmapRender.ts) both dump
// `e.className = "vditor-reset--error"; e.innerHTML = \`<engine> render error: <br>${error}\`;` on a
// parse/setOption failure — unformatted red text. Replace each with the shared themed box (drop the
// vditor-reset--error class; the box is self-styled). One parametrised patch; `rawLiteral`
// ("echarts render error" / "mindmap render error") doubles as the drift anchor. Throws on drift.
function patchNativeDiagramError(code, rawLiteral, title) {
  const anchor =
    '} catch (error) {\n' +
    '                    e.className = "vditor-reset--error";\n' +
    '                    e.innerHTML = `' +
    rawLiteral +
    ': <br>${error}`;\n' +
    '                }'
  if (!code.includes(anchor)) {
    throw new Error(
      `patchNativeDiagramError: "${rawLiteral}" catch anchor not found in vditor renderer (version drift?)`,
    )
  }
  const box =
    '} catch (error) {\n                    ' +
    diagramErrorBoxStmt('e', title) +
    '\n                }'
  return code.replace(anchor, box)
}
// flowchart (flowchartRender.ts) has NO catch — a `flowchart.parse` syntax error (or a drawSVG throw)
// propagates uncaught and leaves a blank/broken block. Wrap the parse+render body in try/catch so a bad
// flowchart shows the shared themed box (task 178). Runs BEFORE patchFlowchartTheme (which rewrites the
// `flowchartObj.drawSVG(item);` line kept verbatim inside the try), so the order in the registry is
// patchFlowchartTheme(patchFlowchartError(code)). Anchored on the contiguous body; throws on drift.
const FLOWCHART_BODY_ANCHOR =
  '            const flowchartObj = flowchart.parse(flowchartRenderAdapter.getCode(item));\n' +
  '            item.innerHTML = "";\n' +
  '            flowchartObj.drawSVG(item);\n' +
  '            item.setAttribute("data-processed", "true");'
export function patchFlowchartError(code) {
  if (!code.includes(FLOWCHART_BODY_ANCHOR)) {
    throw new Error(
      'fixFlowchartError: render-body anchor not found in vditor flowchartRender.ts (version drift?)',
    )
  }
  const wrapped =
    '            try {\n' +
    FLOWCHART_BODY_ANCHOR +
    '\n            } catch (error) {\n                ' +
    diagramErrorBoxStmt('item', 'Flowchart') +
    '\n            }'
  return code.replace(FLOWCHART_BODY_ANCHOR, wrapped)
}
export function patchEchartsErrorBox(code) {
  return patchNativeDiagramError(code, 'echarts render error', 'ECharts')
}
export function patchMindmapErrorBox(code) {
  return patchNativeDiagramError(code, 'mindmap render error', 'Mindmap')
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
// Task 418: which vendored file we're looking at, named rather than re-derived inline, since the
// animation-disable below must apply to exactly one of the two files this transform is chained
// over (see the registry entry for `markdown/(chartRender|mindmapRender)`).
const CHART_RENDER_FILE_RE = /[/\\]chartRender\.ts$/
const ECHARTS_ANIMATION_ANCHOR = '.setOption(option)'
export function patchEchartsThemeInit(code, path) {
  // Task 418 follow-up: `path` decides whether the animation-disable half below applies at all —
  // silently falling back to "skip it" when `path` is missing would be the SAME silent-no-op class
  // this task exists to close, just moved from the anchor up to the argument. There is exactly one
  // caller (the registry entry for chartRender.ts/mindmapRender.ts), and it always supplies `path`,
  // so requiring it is a no-op in practice and a loud failure if that ever regresses.
  if (!path) {
    throw new Error(
      'fixEcharts: patchEchartsThemeInit called without a path — cannot decide whether to gate the animation-disable rewrite for chartRender.ts vs mindmapRender.ts (caller regression?)',
    )
  }
  if (!ECHARTS_INIT_ANCHOR.test(code)) {
    throw new Error(
      'fixEcharts: `echarts.init(e, theme === "dark" ? "dark" : undefined)` anchor not found in vditor chartRender.ts (version drift?)',
    )
  }
  let out = code.replace(
    ECHARTS_INIT_ANCHOR,
    'echarts.init(e, window.__vmarkdEchartsResolve ? window.__vmarkdEchartsResolve(echarts) : (theme === "dark" ? "dark" : undefined))',
  )
  // Disable the chart entry animation ("przy włączaniu") — force `animation:false` over the user
  // option. ONLY for chartRender.ts: mindmapRender.ts must KEEP its entry animation — ECharts `tree`
  // gates the entry animation AND the click-collapse re-render on the SAME flag, so disabling it
  // there would break collapse (see patchMindmapThemeColors's own note; user-confirmed regression).
  // This used to be an incidental string mismatch (mindmapRender.ts's `.setOption({…})` object
  // literal never matched the `.setOption(option)` identifier form, so the `.replace` silently
  // no-op'd there) — now an EXPLICIT per-file branch (task 418), asserted for chartRender.ts so a
  // Vditor reformat of that call fails the build instead of silently dropping the fix, while
  // mindmapRender.ts is deliberately skipped outright rather than left to a coincidental non-match.
  if (CHART_RENDER_FILE_RE.test(path)) {
    if (!out.includes(ECHARTS_ANIMATION_ANCHOR)) {
      throw new Error(
        'fixEcharts: `.setOption(option)` animation anchor not found in vditor chartRender.ts (version drift?)',
      )
    }
    out = out.replace(
      ECHARTS_ANIMATION_ANCHOR,
      '.setOption(Object.assign({}, option, { animation: false }))',
    )
  }
  return out
}

// Task 454 — stamp `data-code` on the chart container AS chartRender.ts reads its source, mirroring
// the established idiom `patchAbcRender` already uses for abcjs (and the mermaid/plantuml/wavedrom/D2
// renderers stamp themselves). Why echarts alone needed this: `chartRenderAdapter.getCode` is
// `el.innerText` (adapterRender.ts) — a live read of the DOM text — and `echarts.init(e, …)` a few
// lines below REPLACES `e`'s contents with the rendered canvas, so the JSON source is recoverable
// from `e` ONLY on this element's first pass through here. `echarts-retheme.ts`'s `reRenderEcharts`
// (a live theme-flip redraw) used to recover the source via a sibling editable `<code
// class="language-echarts">` OUTSIDE the preview pane — which exists in the IR/WYSIWYG dual-node
// surface, but NOT in the single shared `.vditor-preview` pane (sv split / full Preview), which has
// no 1:1 editable-block pairing at all (see `native-offscreen.ts`'s `nativeSourceForPane`, which
// already documents and works around the identical gap for OTHER purposes). Without a stamp, a
// chart re-themed inside `.vditor-preview` silently never redrew.
//
// Read any EXISTING `data-code` first (idempotent, same shape as `patchAbcRender`) so a re-entrant
// call — after the first has already clobbered `innerText` with rendered output — reads back the
// good stamped value instead of stamping garbage over it.
//
// Encoding contract: RAW text, no `encodeURIComponent`/`decodeURIComponent` — unlike mindmap's
// `data-code`, which Lute itself URI-encodes (`reconstructMindmaps` decodes it). The echarts read
// side (`echarts-retheme.ts`) reads this attribute back RAW to match; asserted together in
// `echarts-retheme.test.ts` so the two sides can't drift apart silently.
const CHART_TEXT_ANCHOR =
  '                const text = chartRenderAdapter.getCode(e).trim();\n' +
  '                if (!text) {\n' +
  '                    return;\n' +
  '                }'
export function patchEchartsDataCode(code) {
  if (!code.includes(CHART_TEXT_ANCHOR)) {
    throw new Error(
      'fixEchartsDataCode: `const text = chartRenderAdapter.getCode(e).trim()` anchor not found in vditor chartRender.ts (version drift?)',
    )
  }
  return code.replace(
    CHART_TEXT_ANCHOR,
    '                const text = (e.getAttribute("data-code") || chartRenderAdapter.getCode(e) || "").trim();\n' +
      '                if (!text) {\n' +
      '                    return;\n' +
      '                }\n' +
      '                e.setAttribute("data-code", text); // task 454 — see file-level comment above',
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

// Task 189: codeRender decorates EVERY fresh `pre > code` with a copy button. A d2
// |md| label (task 154) can contain a code block INSIDE the rendered svg's
// foreignObject — it renders async, so a LATER afterRender pass (kept alive by the
// task-187 preview morph) found it fresh and injected the button INTO the diagram
// (the cross-diagram-edit net catches it as a phantom svg). Diagram output is not a
// copyable code panel — skip pres inside any rendered svg / md label.
const CODE_RENDER_FILTER_ANCHOR = `        if (e.parentElement.classList.contains("vditor-wysiwyg__pre") ||
            e.parentElement.classList.contains("vditor-ir__marker--pre")) {
            return false;
        }`
export function patchCodeRenderSkipDiagram(code) {
  if (!code.includes(CODE_RENDER_FILTER_ANCHOR)) {
    throw new Error(
      'patchCodeRenderSkipDiagram: filter anchor not found in vditor codeRender.ts (version drift?)',
    )
  }
  return code.replace(
    CODE_RENDER_FILTER_ANCHOR,
    `${CODE_RENDER_FILTER_ANCHOR}
        if (e.closest("svg, .vmarkd-d2-md")) {
            return false;
        }`,
  )
}

// Task 212: Vditor's code-copy button is wired solely through an inline onclick attribute.
// The webview CSP intentionally blocks inline scripts, so leave an inert marker and let our
// document-level listener send the already-normalised textarea value through VS Code's clipboard.
const CODE_RENDER_COPY_ONCLICK = `onclick="event.stopPropagation();this.previousElementSibling.select();document.execCommand('copy');this.setAttribute('aria-label', '\${window.VditorI18n?.copied || "已复制"}');this.previousElementSibling.blur()"`
export function patchCodeRenderCopyButton(code) {
  if (!code.includes(CODE_RENDER_COPY_ONCLICK)) {
    throw new Error(
      'patchCodeRenderCopyButton: copy-button anchor not found in vditor codeRender.ts (version drift?)',
    )
  }
  return code.replace(CODE_RENDER_COPY_ONCLICK, 'data-vmarkd-copy-code="true"')
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
// Task 189: markmapRender CHECKS data-processed but never SETS it, and after the first
// render the original code node is removed — so the selector re-matches the RENDER div
// itself on every later pass and re-renders its own output (duplicate .language-markmap
// divs, growing svg, stray nodes; harmless pre-morph only because the whole preview
// pane was rebuilt each settle). Mark the render div processed so the guard holds.
const MARKMAP_RENDER_DIV_ANCHOR = 'render.className = "language-markmap"'
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
  if (!code.includes(MARKMAP_RENDER_DIV_ANCHOR)) {
    throw new Error(
      'fixMarkmapStatic: render-div anchor not found in vditor markmapRender.ts (version drift?) — idempotence guard not applied',
    )
  }
  let out = code.replace(
    MARKMAP_RENDER_DIV_ANCHOR,
    `render.className = "language-markmap"
            render.setAttribute("data-processed", "true")`,
  )
  if (version) {
    // The ?v= bump must not fail silently (audit 185/3c): a drifted script anchor would let a
    // stale webview serve OLD markmap bytes across an update — the exact bug ?v= prevents.
    if (!out.includes(MARKMAP_SCRIPT_ANCHOR)) {
      throw new Error(
        'fixMarkmapStatic: markmap.min.js script anchor not found in markmapRender.ts (version drift?) — ?v= cache-buster not applied',
      )
    }
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
  // module (media-src/src/diagrams/graphviz-render.ts). This shim re-exports graphvizRender so
  // Vditor's previewRender (and our plantuml-retheme.ts) keep importing it from here. Relative
  // path climbs out of node_modules/vditor/src/ts/markdown/ to media-src/src/ (build-time
  // resolved; the anchor assert above still guards version drift) — NOT a real import statement
  // the module-move codemod can see (task 460): it's text baked into a patch string, so a module
  // move needs this depth/subpath edited by hand, same as the two siblings below.
  return `import {Constants} from "../constants";
import {graphvizRender as vmGraphvizRender} from "../../../../../src/diagrams/graphviz-render";
export const graphvizRender = (element: HTMLElement, cdn = Constants.CDN) => vmGraphvizRender(element, cdn);
`
}

// highlightRender walks EVERY `pre > code` under the element it is given and rewrites it with hljs
// markup + a `.hljs` class. Diagram engines that support markdown labels (d2's `|md ... |`) emit
// real `<pre><code>` inside a `<foreignObject>`, so the highlighter descends INTO a rendered diagram
// and restyles its labels — hljs colours plus the code-panel background, neither of which belongs on
// a diagram label. Surfaced by task 365: once the Preview pane started reusing the IR render, the
// diagram existed early enough for this pass to reach it, and the two panes' markup diverged by
// exactly `class="hljs"`. Skip anything inside an <svg>; highlight.js has no business in there.
// Placed before Vditor's own marker-pre skips so it costs one closest() on the blocks it rejects.
const HIGHLIGHT_SKIP_ANCHOR =
  'if (block.parentElement.classList.contains("vditor-ir__marker--pre") ||'
export function patchHighlightSkipDiagrams(code) {
  if (!code.includes(HIGHLIGHT_SKIP_ANCHOR)) {
    throw new Error(
      'patchHighlightSkipDiagrams: marker--pre skip anchor not found in vditor highlightRender.ts (version drift?)',
    )
  }
  return code.replace(
    HIGHLIGHT_SKIP_ANCHOR,
    '// vmarkd (task 365): never highlight a code block that is part of a rendered diagram label.\n' +
      '                if (block.closest("svg")) {\n' +
      '                    return;\n' +
      '                }\n' +
      '                ' +
      HIGHLIGHT_SKIP_ANCHOR,
  )
}

// Read the language from the `language-*` CLASS, not from the whole className string.
// Vditor does `block.className.replace("language-", "")`, which assumes the element carries exactly
// one class. It does on the FIRST pass — but the same pass then appends `hljs`, so a SECOND pass over
// the same element computes `"language-js hljs".replace("language-", "")` = `"js hljs"`, which is not
// a known language, so it falls back to `plaintext` and re-renders the block with ZERO token spans:
// the code silently loses its colouring (task 371).
// A second pass over the SAME element only became reachable with the task-187 preview morph: before
// it, every preview render replaced the pane via `innerHTML`, so highlightRender always met a fresh
// `<code class="language-js">`. The morph keeps unchanged blocks' live DOM — which is the point — so
// the element it meets on the second render already carries `hljs`. Reproduced as IR → Preview →
// IR → Preview: the first Preview is coloured, every one after it is not.
const HIGHLIGHT_LANG_ANCHOR =
  'let language = block.className.replace("language-", "");'
export function patchHighlightLanguageClass(code) {
  if (!code.includes(HIGHLIGHT_LANG_ANCHOR)) {
    throw new Error(
      'patchHighlightLanguageClass: language anchor not found in vditor highlightRender.ts (version drift?)',
    )
  }
  return code.replace(
    HIGHLIGHT_LANG_ANCHOR,
    // Falls back to the original expression when no `language-` class is present, so a block that
    // only ever had a bare class keeps Vditor's behaviour.
    'let language = (block.className.match(/(?:^|\\s)language-(\\S+)/) || [])[1] ||' +
      ' block.className.replace("language-", "");',
  )
}

// The Preview pane renders through Lute with `sanitize: true`, and Lute's sanitiser DROPS HTML
// comments outright — measured (task 367): an authored `<!-- … -->` was absent from the pane's DOM
// entirely, while the IR pane (SpinVditorIRDOM, unsanitised) showed it. So the two panes disagreed
// about whether a whole block exists. Disabling sanitising is the wrong lever (it is what strips
// <script>/onclick from a hostile document); instead pre-rewrite each block comment into a
// `<div class="vmarkd-comment">`, which the sanitiser keeps intact. Anchored on the single
// `markdownText` binding both render branches read (the XHR preview-server branch included, so a
// server-rendered preview gets the same text).
const PREVIEW_MD_ANCHOR = 'const markdownText = getMarkdown(vditor);'
export function patchPreviewComments(code) {
  if (!code.includes(PREVIEW_MD_ANCHOR)) {
    throw new Error(
      'patchPreviewComments: markdownText anchor not found in vditor preview/index.ts (version drift?)',
    )
  }
  // Relative path climbs out of node_modules/vditor/src/ts/preview/ to media-src/src/. Text
  // patch, not a real import statement — the module-move codemod (task 460) can't see this;
  // edited by hand when html-comment.ts moved to media-src/src/editing/.
  return code
    .replace(
      PREVIEW_MD_ANCHOR,
      'const markdownText = vmMaskCommentsForPreview(getMarkdown(vditor));',
    )
    .replace(
      'import {getMarkdown} from "../markdown/getMarkdown";',
      'import {getMarkdown} from "../markdown/getMarkdown";\nimport {maskCommentsForPreview as vmMaskCommentsForPreview} from "../../../../../src/editing/html-comment";',
    )
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
    // Task 376: the colours come from ONE definition, flowchartDrawOptions (flowchart-retheme.ts),
    // reached through the window global main.ts installs — the same one the live re-theme calls, so
    // first render and flip can no longer drift. Lines/borders take the palette's `muted`, labels
    // keep `fg` (all-foreground made the diagram as loud as the body text). The inline fallback
    // stays for the case where the global is not installed yet: single foreground colour, i.e. the
    // pre-376 look, which beats flowchart.js's own default of BLACK on a dark page.
    'var vmFcColor = (typeof getComputedStyle === "function" && getComputedStyle(item).color) || "#000";\n' +
      '            var vmFcOpts = (typeof window !== "undefined" && window.__vmarkdFlowchartOpts && window.__vmarkdFlowchartOpts(item)) || { "line-color": vmFcColor, "element-color": vmFcColor, "font-color": vmFcColor, "fill": "none" };\n' +
      '            flowchartObj.drawSVG(item, vmFcOpts);\n' +
      // Task 378 — halo the edge labels after the draw (the routed line runs through them).
      '            if (typeof window !== "undefined" && window.__vmarkdFlowchartAfterDraw) window.__vmarkdFlowchartAfterDraw(item);',
  )
}

// Task 92/93 — bump abcjs 5→6 cache-buster + foreground color theming.
// abcRender.ts loads `abcjs_basic.min.js` with no `?v=` → stale webview serves old bytes.
// Also, `renderAbc(item, code)` passes no params → black ink, unreadable on dark. abcjs 6 has
// `foregroundColor` → pass the themed foreground (getComputedStyle(item).color). Save `data-code`
// for re-render on theme flip (the rendered SVG clobbers textContent).
// NOTE the backtick: the source line is addScript(`${cdn}/…/abcjs_basic.min.js`, "vditorAbcjsScript").
// The original anchor expected a double quote here and NEVER matched — the abc ?v= bump was
// silently dead until the 185/3c hardening turned that skip into this loud assert.
const ABC_SCRIPT_ANCHOR = 'abcjs_basic.min.js`, "vditorAbcjsScript"'
const ABC_RENDER_ANCHOR =
  'ABCJS.renderAbc(item, abcRenderAdapter.getCode(item).trim())'
export function patchAbcRender(code, version) {
  if (!code.includes(ABC_RENDER_ANCHOR)) {
    throw new Error(
      'fixAbcRender: renderAbc anchor not found in abcRender.ts (version drift?)',
    )
  }
  let out = code
  if (version) {
    // Same 185/3c hardening as markmap: with a pinned version the anchor MUST match, or a
    // stale webview serves old abcjs bytes across an update.
    if (!out.includes(ABC_SCRIPT_ANCHOR)) {
      throw new Error(
        'fixAbcRender: abcjs script anchor not found in abcRender.ts (version drift?) — ?v= cache-buster not applied',
      )
    }
    out = out.replace(
      ABC_SCRIPT_ANCHOR,
      `abcjs_basic.min.js?v=${version}\`, "vditorAbcjsScript"`,
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

// SMILESRender.ts hardcodes `smiles-drawer.min.js?v=2.1.7` — bump the `?v=` to the vendored
// version so a stale webview can't serve old bytes across an update. Hardened per 185/3c:
// with a pinned version present, a missing anchor is a build error, not a silent skip.
const SMILES_SCRIPT_ANCHOR = 'smiles-drawer.min.js?v=2.1.7'
export function patchSmilesVersion(code, version) {
  if (!version) return code
  if (!code.includes(SMILES_SCRIPT_ANCHOR)) {
    throw new Error(
      'patchSmilesVersion: smiles-drawer script anchor not found in SMILESRender.ts (version drift?) — ?v= cache-buster not applied',
    )
  }
  return code.replace(SMILES_SCRIPT_ANCHOR, `smiles-drawer.min.js?v=${version}`)
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
  // unit-tested module (media-src/src/diagrams/plantuml/plantuml-render.ts). This shim just
  // re-exports plantumlRender so Vditor's previewRender (and our plantuml-retheme.ts) keep
  // importing it from here. The relative path climbs out of node_modules/vditor/src/ts/markdown/
  // to media-src/src/ (resolved at bundle time — a wrong path fails the build loudly). The
  // anchor assert above still guards version drift. Text patch, not a real import statement —
  // edited by hand when plantuml-render.ts moved (task 460's codemod can't see this).
  return `import {Constants} from "../constants";
import {plantumlRender as vmPlantumlRender} from "../../../../../src/diagrams/plantuml/plantuml-render";
export const plantumlRender = (element = document, cdn = Constants.CDN) => vmPlantumlRender(element, cdn);
`
}

// Task 370: hand every Lute instance to our code the moment it is created, so the wrappers that
// undo Lute's invented space before glued inline code (src/inline-code-gap.ts, installed by
// main.ts as `window.__vmarkdPatchLute`) are in force for the FIRST render too. Vditor renders the
// initial value from initUI → setEditMode, which runs BEFORE `options.after` — the only hook we
// otherwise get — so a document opened straight into WYSIWYG would already carry the spaces.
// Optional-call: a harness that never sets the global just gets stock Lute.
//
// Task 243: also flip `SetHeadingID(true)` here, on the SAME anchor — Vditor never sets this
// option itself (setLute.ts has no `headingID` field at all), so a `{#custom-id}` heading marker
// parses (IR shows a `data-type="heading-id"` marker span) but never reaches the rendered `id`
// attribute; Sanitize (already on) keeps a Lute-emitted id, it just never gets one to keep. This
// is the one Lute call site that renders what the user actually edits/clicks (IR + WYSIWYG); the
// host's read-only prerender Lute (src/lute-host.ts) gets the same flag for overlay/live parity.
const SET_LUTE_ANCHOR = '    return lute;'
export function patchLuteHook(code) {
  if (
    !code.includes('const lute: Lute = Lute.New();') ||
    !code.includes(SET_LUTE_ANCHOR)
  ) {
    throw new Error(
      'patchLuteHook: Lute.New()/return anchor not found in vditor setLute.ts (version drift?)',
    )
  }
  return code.replace(
    SET_LUTE_ANCHOR,
    // Task 528: Vditor 3.11.3 calls `lute.SetCallout(options.callout)` with default true; native
    // callouts rewrite DOM + saved markdown (`[!NOTE]` -> `[!NOTE] ✏️ Note`). We keep OUR callouts,
    // so force it off AFTER Vditor's own call (this runs at the `return lute;` anchor), whatever the
    // saved options say.
    `    lute.SetHeadingID(true);\n    lute.SetCallout(false);\n    (window as any).__vmarkdPatchLute?.(lute);\n${SET_LUTE_ANCHOR}`,
  )
}

// Task 528: Vditor 3.11.3 ships a NATIVE WaveDrom renderer (called from preview/index.ts,
// previewRender.ts, processCode.ts) that loads its own wavedrom bundle under the SAME script id
// (`vditorWavedromScript`) as our engine and renders into the same `.language-wavedrom` blocks. Our
// engine (diagrams/engines/wavedrom.ts) owns WaveDrom, so make Vditor's `wavedromRender` a no-op.
// Same shape as patchGraphvizRender: keep the export so every caller still links.
const WAVEDROM_ANCHOR = 'addScript(`${cdn}/dist/js/wavedrom/wavedrom.min.js'
export function patchWavedromRender(code) {
  if (!code.includes(WAVEDROM_ANCHOR)) {
    throw new Error(
      'patchWavedromRender: addScript anchor not found in vditor wavedromRender.ts (version drift?)',
    )
  }
  return `import {Constants} from "../constants";
// vmarkd (task 528): intentionally a no-op, our engine (diagrams/engines/wavedrom.ts) renders WaveDrom.
export const wavedromRender = (_element: (HTMLElement | Document) = document, _cdn = Constants.CDN) => {};
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
// Exported so the mutation test (test/backend/patch-mutation.test.ts) can iterate every
// entry and assert each transform actually MUTATES its vendored source — the build-time
// coverage assert below only proves a file MATCHED, not that the patch still bites (a
// Vditor bump can shift an anchor so a `.replace()` patch silently no-ops).
export const VDITOR_TS_PATCHES = [
  {
    // chain the undo/index.ts patches: CJS default-import interop + the split-caret restore
    // (task 445). Distinct anchors, so order is immaterial.
    file: /vditor[/\\]src[/\\]ts[/\\]undo[/\\]index\.ts$/,
    transform: (code) => patchUndoCaretSplitRestore(patchDmpInterop(code)),
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]ir[/\\]index\.ts$/,
    transform: patchIrLinkClick,
  },
  {
    // chain the wysiwyg/index.ts patches (link-click gate + clicked-line caret + list marker on
    // space, task 441). Distinct anchors, so order is immaterial.
    file: /vditor[/\\]src[/\\]ts[/\\]wysiwyg[/\\]index\.ts$/,
    transform: (code) =>
      patchWysiwygListMarkerOnSpace(
        patchWysiwygCodeClickCaret(patchWysiwygLinkClick(code)),
      ),
  },
  {
    // chain every fixBrowserBehavior.ts patch (list-toggle null-deref + callout arrow-nav + the two
    // paste ones + the list-outdent seam, tasks 428/461/462). patchPasteTransform must be able to run
    // before patchPasteUrlAsLink's anchor is read, but they touch different lines, so composition
    // order here is free.
    file: /vditor[/\\]src[/\\]ts[/\\]util[/\\]fixBrowserBehavior\.ts$/,
    transform: (code) =>
      patchFixListOutdent(
        patchPasteTransform(
          patchPasteUrlAsLink(patchCalloutArrowNav(patchListToggle(code))),
        ),
      ),
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]toolbar[/\\]Outline\.ts$/,
    transform: patchOutlineCurrent,
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]toolbar[/\\]MenuItem\.ts$/,
    transform: patchUploadTagName,
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]toolbar[/\\]Upload\.ts$/,
    transform: patchUploadHiddenInput,
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]toolbar[/\\]Headings\.ts$/,
    transform: patchHeadingsTooltipBrackets,
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]toolbar[/\\]EditMode\.ts$/,
    transform: patchEditModeTooltipBrackets,
  },
  {
    // chain all editorCommonEvent.ts patches: blur-expand (flash fix) + collapsed-caret clipboard
    // guard (task 385) + the synchronous cut delete (task 387). ONE entry per file.
    //
    // Task 463 considered ALSO patching the undo/redo toolbar-absence gate here (dropping
    // `!vditor.toolbar.elements.undo/redo` so Vditor binds its own Ctrl/Cmd+Z·Y) to replace
    // `undo-keybind.ts`'s runtime interceptor. Measured (real VS Code, all 3 modes, all 3 chords):
    // it does NOT fully replace it — see undo-keybind.ts's header for the reason. Reverted; no
    // patch here.
    file: /vditor[/\\]src[/\\]ts[/\\]util[/\\]editorCommonEvent\.ts$/,
    transform: (code) =>
      patchCutDeleteSync(patchClipboardCollapsed(patchIrBlurExpand(code))),
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]util[/\\]selection\.ts$/,
    transform: (code) =>
      patchSetRangeByWbrHeadingMarker(patchInsertHtmlDelete(code)),
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]sv[/\\]index\.ts$/,
    transform: patchSvCopyGuard,
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]markdown[/\\]mathRender\.ts$/,
    transform: patchMathRender,
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]markdown[/\\]setLute\.ts$/,
    transform: patchLuteHook,
  },
  {
    // Task 517 — non-file DataTransfer entries must be dropped before the filesMax slice.
    file: /vditor[/\\]src[/\\]ts[/\\]upload[/\\]index\.ts$/,
    transform: patchUploadFilesKindFilter,
  },
  {
    // chain the preview/index.ts patches (copy-tip translation + block-level morph, task 187 +
    // comment masking, task 367). ONE entry per file: the registry registers an esbuild onLoad per
    // entry and the FIRST matching handler wins, so a second entry for the same file would silently
    // never run — and then trip the build's own "matched no file" guard.
    file: /vditor[/\\]src[/\\]ts[/\\]preview[/\\]index\.ts$/,
    transform: (code) =>
      patchPreviewComments(
        patchPreviewMorph(
          patchPreviewCopyClipboardData(patchPreviewCopyTip(code)),
        ),
      ),
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]markdown[/\\]codeRender\.ts$/,
    transform: (code) =>
      patchCodeRenderCopyButton(patchCodeRenderSkipDiagram(code)),
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]util[/\\]processCode\.ts$/,
    transform: patchProcessCode,
  },
  {
    // chain the ir/process.ts patches: the per-input serialize takeover (68 C2) + the link button's
    // selected-URL destination (390). ONE entry per file — the first matching handler wins.
    file: /vditor[/\\]src[/\\]ts[/\\]ir[/\\]process\.ts$/,
    transform: (code) => patchIrLinkSelectedUrl(patchIrInputSerialize(code)),
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]wysiwyg[/\\]toolbarEvent\.ts$/,
    transform: patchWysiwygLinkSelectedUrl,
  },
  {
    // chain ir/input.ts patches: defer diagram render (161) + gate the space fast-path serialize +
    // defer renderToc (171 items 1/2) + strip the preview SVG from the spin input (172) + skip the spin
    // for non-structural fenced-body keystrokes (175) + form the list on the marker's space (441).
    // Distinct anchors, so order is immaterial.
    file: /vditor[/\\]src[/\\]ts[/\\]ir[/\\]input\.ts$/,
    transform: (code) =>
      patchIrListMarkerOnSpace(
        patchIrFenceSpinSkip(
          patchIrStripPreviewSpin(
            patchDeferRenderToc(
              patchIrSpaceSerialize(patchIrDeferDiagramRender(code)),
            ),
          ),
        ),
      ),
  },
  {
    // 171 item 4: skip the discarded full-doc serialize in WYSIWYG + SV (same anchor in both files).
    file: /vditor[/\\]src[/\\]ts[/\\]wysiwyg[/\\]afterRenderEvent\.ts$/,
    transform: (code) =>
      patchDeferGetMarkdown(code, 'wysiwyg/afterRenderEvent.ts'),
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]sv[/\\]process\.ts$/,
    transform: (code) => patchDeferGetMarkdown(code, 'sv/process.ts'),
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]toolbar[/\\]Info\.ts$/,
    transform: (code) => patchInfoDialog(code, lutePin),
  },
  {
    // chain: clean parse-error box (suppressErrorRendering + themed catch) THEN the ?v= bump
    file: /vditor[/\\]src[/\\]ts[/\\]markdown[/\\]mermaidRender\.ts$/,
    transform: (code) => {
      const withErr = patchMermaidErrorRender(code)
      const withC4 = patchMermaidC4Colors(withErr)
      return mermaidPin?.version
        ? patchMermaidVersion(withC4, mermaidPin.version)
        : withC4
    },
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
    file: /vditor[/\\]src[/\\]ts[/\\]markdown[/\\]wavedromRender\.ts$/,
    transform: patchWavedromRender,
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]markdown[/\\]highlightRender\.ts$/,
    // chain: skip diagram labels (365) THEN read the language from its own class (371)
    transform: (code) =>
      patchHighlightLanguageClass(patchHighlightSkipDiagrams(code)),
  },
  {
    // chain: wrap the render body in a catch → themed error box (patchFlowchartError) THEN theme the
    // drawSVG call (patchFlowchartTheme finds the verbatim drawSVG line kept inside the new try).
    file: /vditor[/\\]src[/\\]ts[/\\]markdown[/\\]flowchartRender\.ts$/,
    transform: (code) => patchFlowchartTheme(patchFlowchartError(code)),
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]markdown[/\\]plantumlRender\.ts$/,
    transform: patchPlantumlRender,
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]markdown[/\\]abcRender\.ts$/,
    transform: (code) => patchAbcRender(code, abcjsPin?.version),
  },
  {
    file: /vditor[/\\]src[/\\]ts[/\\]markdown[/\\]SMILESRender\.ts$/,
    transform: (code) => patchSmilesVersion(code, smilesDrawerPin?.version),
  },
  {
    // 3 echarts loaders share this filter; bump the `?v=` in all, rewrite theme-init in chartRender only,
    // and replace each renderer's raw "render error" dump with the shared themed error box (task 178).
    file: /vditor[/\\]src[/\\]ts[/\\](markdown[/\\](chartRender|mindmapRender)|devtools[/\\]index)\.ts$/,
    transform: (code, path) => {
      let out = echartsPin?.version
        ? patchEchartsVersion(code, echartsPin.version)
        : code
      if (/[/\\](chartRender|mindmapRender)\.ts$/.test(path))
        out = patchEchartsThemeInit(out, path)
      if (/[/\\]chartRender\.ts$/.test(path)) {
        out = patchEchartsDataCode(out) // task 454
        out = patchEchartsErrorBox(out)
      }
      if (/[/\\]mindmapRender\.ts$/.test(path)) {
        out = patchMindmapThemeColors(out)
        out = patchMindmapErrorBox(out)
      }
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
    // Rename blind spot (audit 185/1b): onLoad filters match by PATH, so a Vditor file rename
    // makes its filter never fire — the transform (and its anchor assert) simply doesn't run and
    // the bundle ships silently UNPATCHED. Track which entries matched and fail the build if any
    // entry never fired while Vditor source was being bundled. Both sets ACCUMULATE across watch
    // rebuilds (incremental rebuilds only re-fire onLoad for changed files, so resetting per
    // build would false-fail every rebuild).
    const matched = new Set()
    let sawVditorSource = false
    // Observation-only pass — returns undefined so esbuild falls through to the patch onLoads.
    // Lets vditor-free bundles (elk-entry) skip the coverage assert entirely.
    build.onLoad({ filter: /vditor[/\\]src[/\\]/ }, () => {
      sawVditorSource = true
      return undefined
    })
    for (const entry of VDITOR_TS_PATCHES) {
      build.onLoad({ filter: entry.file }, async (args) => {
        matched.add(entry)
        const code = await readFile(args.path, 'utf8')
        return { loader: 'ts', contents: entry.transform(code, args.path) }
      })
    }
    build.onEnd((result) => {
      // A build that already failed may legitimately not have loaded every file — don't pile on.
      if (result.errors.length > 0 || !sawVditorSource) return
      const missing = VDITOR_TS_PATCHES.filter((e) => !matched.has(e))
      if (missing.length === 0) return
      return {
        errors: missing.map((e) => ({
          text: `vditor-source-patches: registry entry ${String(e.file)} matched no file (Vditor file renamed/removed?) — its patch was NOT applied`,
        })),
      }
    })
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
