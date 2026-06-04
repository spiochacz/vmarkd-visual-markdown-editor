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

const stubPath = fileURLToPath(
  new URL('./src/stubs/vditor-toolbar-stubs.ts', import.meta.url),
)

export const stubUnusedVditorButtons = {
  name: 'stub-vditor-buttons',
  setup(build) {
    build.onResolve(
      { filter: /^\.\/(Br|Fullscreen|Record|Export)$/ },
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
const fixDmpInterop = {
  name: 'fix-diff-match-patch-interop',
  setup(build) {
    build.onLoad(
      { filter: /vditor[/\\]src[/\\]ts[/\\]undo[/\\]index\.ts$/ },
      async (args) => {
        const code = await readFile(args.path, 'utf8')
        return {
          loader: 'ts',
          contents: code.replace(
            /import \* as DiffMatchPatch from "diff-match-patch";/,
            'import DiffMatchPatch from "diff-match-patch";',
          ),
        }
      },
    )
  },
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

const fixIrLinkClick = {
  name: 'fix-ir-link-click',
  setup(build) {
    build.onLoad(
      { filter: /vditor[/\\]src[/\\]ts[/\\]ir[/\\]index\.ts$/ },
      async (args) => {
        const code = await readFile(args.path, 'utf8')
        return { loader: 'ts', contents: patchIrLinkClick(code) }
      },
    )
  },
}
const fixWysiwygLinkClick = {
  name: 'fix-wysiwyg-link-click',
  setup(build) {
    build.onLoad(
      { filter: /vditor[/\\]src[/\\]ts[/\\]wysiwyg[/\\]index\.ts$/ },
      async (args) => {
        const code = await readFile(args.path, 'utf8')
        return { loader: 'ts', contents: patchWysiwygLinkClick(code) }
      },
    )
  },
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
const fixListToggle = {
  name: 'fix-list-toggle',
  setup(build) {
    build.onLoad(
      { filter: /vditor[/\\]src[/\\]ts[/\\]util[/\\]fixBrowserBehavior\.ts$/ },
      async (args) => {
        const code = await readFile(args.path, 'utf8')
        return { loader: 'ts', contents: patchListToggle(code) }
      },
    )
  },
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
const fixMathRender = {
  name: 'fix-math-render',
  setup(build) {
    build.onLoad(
      { filter: /vditor[/\\]src[/\\]ts[/\\]markdown[/\\]mathRender\.ts$/ },
      async (args) => {
        const code = await readFile(args.path, 'utf8')
        return { loader: 'ts', contents: patchMathRender(code) }
      },
    )
  },
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
const fixProcessCode = {
  name: 'fix-process-code',
  setup(build) {
    build.onLoad(
      { filter: /vditor[/\\]src[/\\]ts[/\\]util[/\\]processCode\.ts$/ },
      async (args) => {
        const code = await readFile(args.path, 'utf8')
        return { loader: 'ts', contents: patchProcessCode(code) }
      },
    )
  },
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
const fixIrInputSerialize = {
  name: 'fix-ir-input-serialize',
  setup(build) {
    build.onLoad(
      { filter: /vditor[/\\]src[/\\]ts[/\\]ir[/\\]process\.ts$/ },
      async (args) => {
        const code = await readFile(args.path, 'utf8')
        return { loader: 'ts', contents: patchIrInputSerialize(code) }
      },
    )
  },
}

export const vditorSourceConfig = {
  define: { VDITOR_VERSION: JSON.stringify(vditorVersion) },
  tsconfigRaw: { compilerOptions: { useDefineForClassFields: false } },
  loader: { '.less': 'empty' },
  plugins: [
    stubUnusedVditorButtons,
    fixDmpInterop,
    fixIrLinkClick,
    fixWysiwygLinkClick,
    fixListToggle,
    fixMathRender,
    fixProcessCode,
    fixIrInputSerialize,
  ],
}
