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

// Task 62 — IR link click UX. Vditor's IR click handler opens a link on ANY click
// (`if (aElement && !expand) { …open…; return; }`), which our window.open override
// routes to the host. We gate that open branch behind the platform modifier so a
// plain click instead falls through to normal IR handling (caret in the link →
// edit), and only Ctrl/Cmd+click follows the link. Anchored single-line rewrite of
// the outer condition; throws if the anchor drifts on a Vditor bump.
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
      '(navigator.platform.toLowerCase().includes("mac") ? event.metaKey : event.ctrlKey)) {',
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

export const vditorSourceConfig = {
  define: { VDITOR_VERSION: JSON.stringify(vditorVersion) },
  tsconfigRaw: { compilerOptions: { useDefineForClassFields: false } },
  loader: { '.less': 'empty' },
  plugins: [
    stubUnusedVditorButtons,
    fixDmpInterop,
    fixIrLinkClick,
    fixListToggle,
    fixMathRender,
  ],
}
