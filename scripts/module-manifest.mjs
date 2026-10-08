#!/usr/bin/env node
// Task 460 — single source of truth for the module decomposition (host `src/` + webview
// `media-src/src/`). Checked in from `tmp/modmap3.mjs`'s `G` map (Fable's corrected grouping),
// reconciled against the tree as it stands NOW — modmap3.mjs was measured 2026-07-30 and a
// session's worth of new files landed since (code-ref-*, escape-*, outline-keyboard,
// roving-tabindex, same-doc-anchor, toolbar-icons, wiki-chip-a11y on the webview side;
// heading-slug, code-ref-core on the host side; `list-tight.ts` was deleted). The one-line
// reasoning for every reconciled file is in the phase-0 report, not reproduced here as prose —
// see inline comments below for the short version.
//
// IDs are bare basenames (no extension, no directory) keyed against the WHOLE tree — verified
// globally unique across `src/` + `media-src/src/` (187 files, 187 distinct basenames, including
// `diagram-engines/`, `stubs/`; the build-artifact `media/` dir is excluded). Each entry has a
// `dir` (the file's TARGET directory relative to its root) AND a `module` (its identity for
// grouping/cycle-check purposes) — these are DIFFERENT fields, not derived from each other.
//
// Corrected in phase 3 (task 460): the original version derived module identity FROM `dir`,
// which meant nesting a subdirectory under an existing module silently invented a new module.
// `diagrams/engines/`, `diagrams/d2/engines/` and `chrome/stubs/` are directories INSIDE the
// `diagrams`, `diagrams/d2` and `chrome` modules respectively (per the task table's own
// `engines/{...}` shorthand) — not siblings. Left un-split, the phase-3 cycle re-check reported a
// `diagrams <-> diagrams/engines` bidirectional pair that was never real: under the original
// `tmp/modmap3.mjs` grouping (one flat `diagrams` bucket including the engine files),
// `custom-diagrams -> vega` and `vega -> faithful-render` were intra-module edges, invisible to a
// cross-group scan — that's why the original measurement reported 1 pair, not 2. A manifest that
// conflates directory with module identity would have baked that false cycle straight into
// phase 4's boundary meta-test. `moduleDirFor(id)` still answers "where does this file go"; the
// new `moduleIdFor(id)` answers "which module is this file part of" — phase 4 and any cycle check
// must use the latter for grouping, never the manifest object's own keys (those are dir-shaped,
// not module-shaped, by construction — see WEBVIEW_MODULES below).
//
// This file is DATA + assertion tooling, not the codemod. `scripts/codemod-module-move.mjs`
// resolves import targets by scanning the tree (basename -> current absolute path), not by
// walking these tables at rewrite time — see that file's header for why that's the design that
// makes "no-op on an already-correct tree" hold. The manifest's job is (a) this totality/
// disjointness assertion, (b) telling `git mv` where each file goes in phases 1-2, (c) the
// phase-4 boundary meta-test (cycles, allowlist, `shared/` no-sibling-imports).
//
// Run directly (`node scripts/module-manifest.mjs`) to assert the manifest is TOTAL and
// DISJOINT against the tree on disk, wherever files currently sit (pre-move flat, or post-move
// in their module dirs — both are valid states this checks).

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const HOST_ROOT = path.join(ROOT, 'src')
const WEBVIEW_ROOT = path.join(ROOT, 'media-src', 'src')

// ---------------------------------------------------------------------------------------------
// Host `src/` -> 9 modules (47 files: task file's 44 baseline + heading-slug + code-ref-core +
// editor-view-type; `platform/` split into `app/`+`platform/` in phase 3, see below).
//
// DECIDED (phase-0 review, team-lead): `heading-slug.ts` AND `md-scan.ts` both go in `shared/`.
// `heading-slug` is imported cross-side by `media-src/src/same-doc-anchor.ts` — the criterion for
// `shared/` is "part of the cross-side contract," not "is a leaf," so it qualifies by definition.
// `md-scan` comes with it because `heading-slug` needs it and `md-scan` is itself a true level-0
// leaf (task doc's own measurement), so it cannot violate "`shared/` imports nothing from
// siblings" (phase-4 assertion). `markdown/`'s three remaining files (minimal-diff-writeback,
// outline-tree, table-pipe-escape) now import from `shared/` — the same relationship every other
// module already has to it. The rejected alternative (heading-slug -> markdown/ + a phase-4
// allowlist exception for a webview -> markdown/ cross-side edge) would have put a hole in "the
// webview reaches into src/shared/ and nowhere else" on day one — not worth the one avoided move.
export const HOST_MODULES = {
  shared: {
    module: 'shared', dir: 'shared',
    ids: [
      'protocol',
      'message-shape',
      'theme-registry',
      'mermaid-palettes',
      'echarts-theme',
      'echarts-gallery',
      'wiki-core',
      'code-ref-core', // NEW (task 229) — true leaf, only importer is webview code-ref-decorate.ts
      'heading-slug', // NEW (task 243) — see the DECIDED note above
      'md-scan', // moved from markdown/ alongside heading-slug, see the DECIDED note above
      'editor-view-type', // NEW (phase 3 finding) — resolves platform<->wiki; see this file's own
      // header comment for why (a package.json-declared id, zero deps, needed by both platform/
      // and wiki/; MarkdownEditorViewType moved here out of platform/tab-targeting.ts).
      // MOVED from wiki/ (phase 3 finding: webview links/ leaked into wiki/, not shared/, via
      // same-doc-anchor.ts). Zero imports; own header comment already said "Shared with task
      // 243" before the layout agreed.
      'link-target',
      // MOVED from lute/ (phase 3 finding: closes the ORIGINAL lute-gap-repair leak named in
      // this task's own opening ground-truth measurement — phase 0 moved 6 of the 7 leaked host
      // modules into shared/ and left this one behind). lute-block-repair comes with it exactly
      // as md-scan came with heading-slug: lute-gap-repair's only dependency, itself zero
      // imports, own header comment already said "the extension host... and the webview...
      // share this module." lute-host.ts stays in lute/ and imports both from shared/ now — the
      // ordinary relationship every module has to it.
      'lute-gap-repair',
      'lute-hard-break', // NEW (task 530) — same shared host+webview Lute repair family as lute-gap-repair
      'soft-break-html', // NEW (task 83) — the soft-break marker rule on an HTML string (open-time overlay); host + webview share the class name
      'lute-block-repair',
      // NEW (task 499) — `clamp(v, lo, hi)`, the one numeric primitive both trees had been
      // hand-rolling as `Math.max(lo, Math.min(v, hi))`. Zero imports; lives here rather than in
      // either tree because host (session/reveal-range.ts) and webview (source-map, caret,
      // echarts-retheme, d2-geometry, …) both call it.
      'clamp',
      // NEW (task 505) — FORMAT_HOTKEYS single source of truth for the promoted Vditor toolbar
      // hotkeys. Zero imports; host (app/commands.ts) imports it directly, webview
      // (chrome/toolbar.ts, editing/format-hotkey-guard.ts) reaches across the tree — the same
      // cross-side-contract relationship as protocol.ts.
      'format-hotkeys',
    ],
  },
  markdown: { module: 'markdown', dir: 'markdown', ids: ['diff-lines', 'table-pipe-escape', 'minimal-diff-writeback', 'outline-tree', 'reading-time'] },
  lute: { module: 'lute', dir: 'lute', ids: ['lute-host'] },
  writeback: { module: 'writeback', dir: 'writeback', ids: ['writeback-controller', 'git-diff', 'git-conflict', 'doc-sync', 'sync-state'] },
  wiki: { module: 'wiki', dir: 'wiki', ids: ['wiki', 'wiki-cache', 'wiki-session'] },
  'webview-host': { module: 'webview-host', dir: 'webview-host', ids: ['html-builder', 'webview-message-shape', 'diagram-cache-host', 'panel-config'] },
  // Split from the original single `platform/` (phase 3 finding 3, measured before moving):
  // `platform/` held both composition-root SINKS (extension, markdown-editor-provider — import
  // nearly everything) and LEAVES (host-log, state-keys, active-panels, tab-targeting,
  // editor-config, default-mode, host-session-state — imported by nearly everything). A module
  // holding both structurally cycles with every module in between — measured 3 bidirectional
  // pairs (platform<->session, platform<->webview-host, platform<->wiki) where the task's
  // "host src/ is an acyclic DAG" claim was a FILE-level fact, never checked at module level.
  // `app` = the sinks; `platform` keeps the leaves. Verified: this resolves platform<->session
  // and platform<->webview-host outright; platform<->wiki needed a separate fix (see
  // shared/editor-view-type.ts's header) since it wasn't a sink/leaf artifact.
  app: { module: 'app', dir: 'app', ids: ['extension', 'markdown-editor-provider', 'commands', 'status-bar'] },
  platform: {
    module: 'platform', dir: 'platform',
    ids: [
      'active-panels',
      'tab-targeting',
      'state-keys',
      'host-log',
      'host-session-state',
      'editor-config',
      'default-mode',
    ],
  },
  session: {
    module: 'session', dir: 'session',
    ids: [
      'editor-session',
      'reveal-caret',
      'reveal-range',
      'image-asset-watcher', // NEW (task 513) — per-document watcher over the local image files the
      // markdown references; its only importer is editor-session.ts, intra-module.
      // MOVED from wiki/ (phase 3 finding: platform<->wiki cycle). asset-link-actions.ts's ONLY
      // real importer, repo-wide, was session/editor-session.ts (measured — nothing in wiki/
      // imports it) — it handles link routing, cross-file link resolution, asset upload, and
      // code references (task 229); wiki-link opening is one branch, not its identity, same
      // shape as escape-toolbar's toolbar destination not being its identity. Its own 2 imports
      // from platform/ (editor-config's cfgFor/getAssetsFolder, active-panels' findPanelForUri)
      // were the entire wiki->platform direction of the cycle — moving it collapses that
      // direction to zero, leaving only platform->wiki via tab-targeting->isWikiFile (acyclic,
      // no reverse edge into platform/ from wiki/ or app/).
      'asset-link-actions',
    ],
  },
}

// ---------------------------------------------------------------------------------------------
// Webview `media-src/src/` -> the task table's 13 named modules (`diagrams` further splits into
// diagrams/{engines,d2,d2/engines,plantuml,mermaid} sub-dirs; `chrome` gains a `stubs` sub-dir) —
// 141 files: task file's 132 baseline, minus deleted `list-tight`, plus 9 new files reconciled
// against the current tree, plus `stubs/vditor-toolbar-stubs.ts`. `diagram-engines/` is renamed
// `engines/` and nested under `diagrams/` (and `diagrams/d2/` for the d2 engine file) per the
// task table's own `engines/{...}` shorthand.
export const WEBVIEW_MODULES = {
  util: {
    module: 'util', dir: 'util',
    ids: [
      'webview-log',
      'source-map',
      'stream-chunk',
      'debounce',
      'deep-merge',
      'disposables',
      'observe-coalesce',
      'format-timestamp',
      'lang',
      'platform',
      'load-script',
      'utils',
      'types',
      'inner-vditor',
      'roving-tabindex', // NEW (task 456/458) — generic composite-widget primitive; used by
      // outline-keyboard (nav/) today and designed for escape-toolbar (chrome/) too — 2 unrelated
      // domain callers is exactly the util/ criterion (decision #2 in the task file).
      'vscode-api', // MOVED from bridge/ (task 460 addendum, post-close): both its imports are
      // type-only, so it is a true zero-value-import leaf — it lives topically near "host
      // messaging" but has no dependency on bridge/, and its 4 non-bridge importers
      // (chrome/clipboard/links/util, all bare side-effect `import`) closed 4 real bridge<->X
      // cycles the original from-only extraction never saw. See module-boundaries.test.ts.
      'caret-gesture', // NEW (tasks 457/459 unification) — the shared Ctrl/Cmd+Enter caret-gesture
      // dispatcher both links/link-click-fix.ts and editing/callout-popover-keys.ts register
      // against. Lives in util/ (not either caller's own module) because BOTH already have an
      // allowed edge to util/ — links->util and editing->util — so this needed zero new allowlist
      // entries; placing it in either caller's module would have needed one (task 460's standing
      // rule: move the file rather than widen the allowlist).
    ],
  },
  'diagram-kit': {
    module: 'diagram-kit', dir: 'diagram-kit',
    ids: [
      'engine-registry',
      'diagram-dom',
      'diagram-error',
      'diagram-loading',
      'diagram-note',
      'diagram-surfaces',
      'diagram-palette',
      'd2-config',
      'native-offscreen',
      'diagram-config-delta',
      'svg-recolor', // NEW (task 502) — shared SVG foreground-to-currentColor repaint pulled out
      // of graphviz-render.ts and plantuml-render.ts (jscpd duplication cleanup); intra-module
      // edge, no allowlist change.
    ],
  },
  boot: {
    module: 'boot', dir: 'boot',
    ids: ['vditor-theme', 'main', 'preload', 'finish-init', 'init-payload', 'vditor-init', 'vditor-options', 'live-config', 'editor-session-state'],
  },
  bridge: { module: 'bridge', dir: 'bridge', ids: ['message-router', 'edit-sync', 'edit-sync-tuning', 'save-flush', 'pending-edit', 'incremental-md'] },
  editing: {
    module: 'editing', dir: 'editing',
    ids: [
      'caret',
      'caret-preserve',
      'caret-scroll',
      'editor-caret',
      'initial-caret',
      'focus-restore',
      'host-find', // task 522 — host find widget open flag
      'gap-paragraph',
      'trailing-paragraph', // NEW (task 472) — split out of gap-paragraph.ts to break the
      // caret<->gap-paragraph import cycle; intra-module edge, no allowlist change.
      'nav-geometry', // NEW (task 473) — pure caret/block geometry shared by callout-nav.ts,
      // gap-nav.ts and gap-paragraph.ts (jscpd duplication cleanup); intra-module edge, no
      // allowlist change.
      'gap-boundary', // NEW (task 292) — the pure "which boundaries have no reachable caret
      // position" rule; intra-module edge (reads trailing-paragraph's isAtomicBlock).
      'gap-nav', // REPLACES 'hr-nav' (task 292) — hr-nav.ts was retired into it so a single
      // keydown handler owns every void boundary, not one per bug.
      'gap-click', // NEW (task 292) — the same boundaries reached with the mouse; the only part
      // that needs real layout (hit-testing the thin strips between rendered blocks).
      'gap-nav-fixture', // NEW (task 292) — jsdom scaffolding SHARED by gap-nav.test.ts and
      // gap-click.test.ts (stubbed rects: jsdom has no layout, and both movers read it). Not a
      // `.test.ts` file — vitest would collect it as an empty suite — so the manifest, which
      // ignores `*.test.ts` and nothing else, has to carry it like any other module file.
      'list-backspace',
      'list-normalize', // NEW (task 255) — "Fix list numbering" / "Renormalize all lists";
      // shares list-backspace.ts's spin-outerHTML-through-Lute primitive.
      // 'list-tight' DELETED since modmap3.mjs was measured — do not re-add.
      'fix-table-ir',
      'spin-skip-fence',
      'spin-strip',
      'wysiwyg-code-highlight',
      'code-source',
      'edit-activity',
      'hard-break-key', // NEW (task 530) — Shift+Enter makes a real hard line break in prose (IR + WYSIWYG)
      'reflow-line-breaks', // NEW (task 83) — soft line breaks flow in the Preview (vmarkd.editor.reflowLineBreaks)
      'reflow-toggle', // NEW (task 83) — pressed state + click for the reflow-line-breaks toolbar toggle
      'soft-break', // NEW (task 83) — DOM half of the editor's soft-line-break reflow: marker spans, caret-kept wrap/unwrap, idle chunk scheduler
      'soft-break-observer', // NEW (task 83) — keeps the spans on the IR/WYSIWYG surface (observer, structural-key unwrap, live toggle)
      'mutation-scope',
      'html-comment',
      'table-hotkey',
      'undo-keybind',
      'format-hotkey-guard', // NEW (task 505) — capture-phase preventDefault-only guard blocking
      // the browser's native contenteditable execCommand for the promoted FORMAT_HOTKEYS keys
      // (Ctrl/Cmd+B/I/U); see its own header for the corruption this fixes.
      'format-word-expand', // NEW (task 506) — capture-phase click word-expansion so a collapsed
      // caret + bold/italic/strike wraps the word under it; pairs with format-hotkey-guard.
      'callouts',
      'callout-nav',
      'callout-popover-keys', // NEW (task 459) — Ctrl/Cmd+Enter (shared dispatcher, tasks 457/459
      // unification) focuses the callout popover controls + Escape returns focus to the editor
      'preview-morph',
      // Moved from chrome/ (phase 3 finding: chrome<->editing cycle). escape-arm/escape-toolbar
      // are a capture-phase keydown interceptor bound to the editing surface — same shape as
      // undo-keybind/table-hotkey/gap-nav/callout-nav above, all already here; it also restores
      // the caret. The toolbar is its destination, not its identity. roving-tabindex (util/) and
      // inner-vditor (util/) don't follow — nothing else in escape-toolbar's own dependency set
      // was chrome-specific.
      'escape-arm', // MOVED from chrome/ (task 456) — toolbar-escape state machine
      'escape-toolbar', // MOVED from chrome/ (task 456) — drives toolbar DOM + roving tabindex
      'dblclick-word-select', // NEW (task 485) — trims a double-click word selection's trailing
      // whitespace (Windows-only Chromium over-selection); document-level listener, intra-module.
    ],
  },
  clipboard: { module: 'clipboard', dir: 'clipboard', ids: ['clipboard-line', 'paste-transform', 'paste-table', 'image-convert', 'upload-handler', 'upload-name', 'code-copy'] },
  links: {
    module: 'links', dir: 'links',
    ids: [
      'link-click',
      'link-click-fix',
      'link-open-policy',
      'link-url',
      'raw-href',
      'wiki-serialize',
      'custom-renderer',
      'code-ref-decorate', // NEW (task 229) — "link cluster" per the task list; clickable code refs
      'code-ref-resolve', // NEW (task 229) — host round-trip for the above, paired 1:1
      'same-doc-anchor', // NEW (task 243) — "link cluster"; same-document #fragment anchor links
      'caret-link', // NEW (task 457) — pure "which link-like element is the caret in" + its decoration
      'image-refresh', // NEW (task 513) — revalidates the cached resource URL of an image whose file
      // was replaced on disk. Lives in links/ (the "resolve a URL the document points at" cluster,
      // next to raw-href/link-url); its only importer is bridge/message-router, an allowed edge.
      'caret-link-decorate', // NEW (task 457) — selectionchange DOM wiring for caret-link's pure core
    ],
  },
  nav: {
    module: 'nav', dir: 'nav',
    ids: [
      'outline',
      'outline-resize',
      'heading-align',
      'preview-scroll-preserve',
      'split-scroll-sync',
      'viewport-gate',
      'outline-keyboard', // NEW (task 458) — outline tree keyboard nav, co-located with outline.ts
    ],
  },
  chrome: {
    module: 'chrome', dir: 'chrome',
    ids: [
      'toolbar',
      'toolbar-actions',
      'toolbar-dismiss',
      'toolbar-scroll-guard',
      'busy-cursor',
      'prerender-overlay',
      'open-preview',
      'responsive-tables',
      'diff-markers',
      'toolbar-icons', // NEW (task 470) — extracted out of toolbar.ts, only importer is toolbar.ts
      'toolbar-overflow', // NEW (task 492) — responsive row measurement + DOM reparenting shell
      // 'toolbar-hotkey-dedupe' DELETED (task 505) — dedupe is no longer needed, see
      // format-hotkeys.ts's module header; do not re-add.
      'toolbar-submenu-aria', // NEW (task 492 Phase 5) — aria-haspopup/expanded + menu semantics for emoji/headings/edit-mode
    ],
  },
  diagrams: {
    module: 'diagrams', dir: 'diagrams',
    ids: [
      'diagram-retheme',
      'echarts-retheme',
      'flowchart-retheme',
      'custom-diagrams',
      'diagram-runtime',
      'diagram-zoom',
      'diagram-zoom-gate',
      'diagram-zoom-keys-gated', // NEW (task 459) — +/-/0 keyboard zoom for markmap/mindmap/geojson/topojson
      'render-cache-client',
      'faithful-render',
      'stream-render',
      'abc-fit',
      'echarts-apply',
      'echarts-fit',
      'markmap-fit',
      'graphviz-render',
      'smiles-render',
    ],
  },
  'diagrams/engines': { module: 'diagrams', dir: 'diagrams/engines', ids: ['geojson-topojson', 'nomnoml', 'stl', 'vega', 'wavedrom'] },
  'diagrams/d2': {
    module: 'diagrams/d2', dir: 'diagrams/d2',
    ids: ['d2-entry', 'd2-geometry', 'd2-refine', 'd2-render', 'd2-sketch', 'd2-wasm', 'astar', 'elk-layout', 'elk-entry', 'elk-bundled-shim', 'boot-elk', 'd2-consts', 'd2-layout', 'd2-svg-paths', 'd2-style', 'd2-svg-shapes'],
  },
  'diagrams/d2/engines': { module: 'diagrams/d2', dir: 'diagrams/d2/engines', ids: ['d2'] },
  'diagrams/plantuml': { module: 'diagrams/plantuml', dir: 'diagrams/plantuml', ids: ['plantuml-render', 'plantuml-stdlib', 'plantuml-timing', 'plantuml-retheme'] },
  'diagrams/mermaid': { module: 'diagrams/mermaid', dir: 'diagrams/mermaid', ids: ['mermaid-c4-colors', 'mermaid-elk', 'mermaid-elk-entry', 'mermaid-retheme', 'mermaid-theme'] },
  // stubs/ is redirected to via esbuild-shared.mjs:101's `new URL(...)`, not an import specifier
  // — the codemod's import-rewrite pass will NOT catch that reference; see phase-0 report.
  'chrome/stubs': { module: 'chrome', dir: 'chrome/stubs', ids: ['vditor-toolbar-stubs'] },
}

// Non-.ts files the task calls out to relocate explicitly rather than leave stranded. Not part
// of the id-based .ts manifest above (checkManifest doesn't scan non-.ts files).
// `media/` (media-src/src/media/) is a BUILD ARTIFACT directory — leave in place, not listed.
export const EXTRA_RELOCATIONS = {
  // only importers are d2-quality.test.ts / d2-theme.test.ts, both moving to diagrams/d2/.
  'media-src/src/__fixtures__/d2-raw-layouts.json': 'media-src/src/diagrams/d2/__fixtures__/d2-raw-layouts.json',
}

// ---------------------------------------------------------------------------------------------

function flatten(modules) {
  const idToDir = new Map()
  const idToModule = new Map()
  const dupes = []
  for (const { module, dir, ids } of Object.values(modules)) {
    for (const id of ids) {
      if (idToDir.has(id)) dupes.push(id)
      idToDir.set(id, dir)
      idToModule.set(id, module)
    }
  }
  return { idToDir, idToModule, dupes }
}

// Where does this file live (or need to move to)? A directory, not a module.
export function moduleDirFor(id) {
  const { idToDir: hostMap } = flatten(HOST_MODULES)
  if (hostMap.has(id)) return { side: 'host', dir: hostMap.get(id) }
  const { idToDir: webviewMap } = flatten(WEBVIEW_MODULES)
  if (webviewMap.has(id)) return { side: 'webview', dir: webviewMap.get(id) }
  return undefined
}

// Which MODULE is this file part of, for grouping/cycle-check/allowlist purposes? Not the same
// as moduleDirFor's `dir` — `diagrams/engines/*.ts` files answer 'diagrams' here, not
// 'diagrams/engines' (see the header comment on WEBVIEW_MODULES for why that distinction exists).
export function moduleIdFor(id) {
  const { idToModule: hostMap } = flatten(HOST_MODULES)
  if (hostMap.has(id)) return { side: 'host', module: hostMap.get(id) }
  const { idToModule: webviewMap } = flatten(WEBVIEW_MODULES)
  if (webviewMap.has(id)) return { side: 'webview', module: webviewMap.get(id) }
  return undefined
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'media') continue // build artifact dir, left in place
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(p)
  }
}

// Assert totality + disjointness against the tree ON DISK, wherever files currently sit.
export function checkManifest({ verbose = true } = {}) {
  let ok = true
  const report = (msg) => {
    if (verbose) console.log(msg)
  }

  for (const [label, modules, rootDir] of [
    ['HOST', HOST_MODULES, HOST_ROOT],
    ['WEBVIEW', WEBVIEW_MODULES, WEBVIEW_ROOT],
  ]) {
    const { idToDir, dupes } = flatten(modules)
    if (dupes.length) {
      ok = false
      report(`[${label}] DUPLICATE ids in manifest: ${dupes.join(', ')}`)
    }

    const onDisk = []
    walk(rootDir, onDisk)
    const diskIds = new Set(onDisk.map((f) => path.basename(f, '.ts')))

    const missingFromManifest = [...diskIds].filter((id) => !idToDir.has(id))
    if (missingFromManifest.length) {
      ok = false
      report(`[${label}] ON DISK but not in manifest: ${missingFromManifest.sort().join(', ')}`)
    }

    const missingFromDisk = [...idToDir.keys()].filter((id) => !diskIds.has(id))
    if (missingFromDisk.length) {
      ok = false
      report(`[${label}] in manifest but MISSING from disk: ${missingFromDisk.sort().join(', ')}`)
    }

    report(
      `[${label}] modules=${Object.keys(modules).length} manifestIds=${idToDir.size} onDisk=${onDisk.length}` +
        ` ok=${!dupes.length && !missingFromManifest.length && !missingFromDisk.length}`,
    )
  }

  // Global uniqueness: no basename may appear on both sides (the codemod's target-resolution
  // relies on this — see codemod-module-move.mjs header).
  const { idToDir: hostIds } = flatten(HOST_MODULES)
  const { idToDir: webviewIds } = flatten(WEBVIEW_MODULES)
  const crossCollisions = [...hostIds.keys()].filter((id) => webviewIds.has(id))
  if (crossCollisions.length) {
    ok = false
    report(`CROSS-TREE basename collisions (host vs webview): ${crossCollisions.join(', ')}`)
  }

  return ok
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ok = checkManifest()
  if (!ok) {
    console.error('\nmodule-manifest: FAILED — not total/disjoint against the tree on disk.')
    process.exit(1)
  }
  console.log('\nmodule-manifest: OK — total and disjoint.')
}
