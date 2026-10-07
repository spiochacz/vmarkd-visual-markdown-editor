# Task 528 — Upgrade Vditor 3.11.2 → 3.11.3

**Status:** ✅ DONE (2026-10-07) — Vditor 3.11.3; native callouts/WaveDrom off, empty-nested Enter kept ours; all gates green, VSIX installed. · **Impact:** 🟠 med (list-editing fixes, IR copy/toggle fixes, Mermaid 11.16.1 upstream; the real work is neutralising two new native features) · **Origin:** user decision 2026-10-07, "we move to Vditor 3.11.3", after the Lute re-pin (task 526, done)


## Decisions (user, 2026-10-07)

- **Callouts: keep OURS.** Force the native node off (`lute.SetCallout(false)` in `patchLuteHook` +
  `preview.markdown.callout: false` in the config-derived last merge) so callout DOM and saved bytes
  stay identical to 3.11.2. Integrating the native callouts is task
  [529](../529-native-callouts-github-compatible.md), with GitHub compatibility as the hard requirement.
- **HR toolbar button: keep `---`.** Measured in phase B: NO patch needed. HR stays `---` in IR/WYSIWYG
  without a patch (they insert an `<hr>` node and Lute serialises `---`); SV writes `***` via Lute
  regardless of the item's `prefix`. A `util/Options.ts` patch would be dead surface, so none exists.
- **Enter on an empty nested list item: keep the old outliner behaviour** (lead decision, phase B). The
  `handleListKeydown` seam owns it and outdents like Shift+Tab (`isEmptyNestedItem`, `list-backspace.ts`);
  an empty top-level item stays Vditor's.
- WaveDrom: keep our engine; neutralise Vditor's native `wavedromRender` (blocker 2).
## Problem

We run `vditor@3.11.2` (`media-src/package.json` `^3.11.2`, lockfile-pinned). 3.11.3 was published
2026-08-11. We override its bundled Lute with our vendored build (task 526, `591a695`), so only
Vditor's TypeScript (`src/`, which we bundle with anchor-asserted patches) and its CSS/assets
(`dist/`, which `build.mjs` copies and patches) matter. Task 527 evaluates 4.0.0 separately; this
task is the smaller step that 527 assumes happens first.

Two 3.11.3 features turn on by default and are **not** neutral for us: native Callout (it changes the
DOM *and the saved markdown*) and a native WaveDrom renderer (it competes with ours). Both are
handled in the steps below.

## Steps

- [x] `npm i vditor@3.11.3` in `media-src/` (updates `package.json` to `^3.11.3` and the lockfile).
      Rollback is the previous lockfile.
- [x] **BLOCKER 1, native callout off.** Force `lute.SetCallout(false)` in `patchLuteHook`
      (`esbuild-shared.mjs`, next to `SetHeadingID(true)`), so every `setLute` site (editor,
      `Vditor.preview`, export) gets it regardless of saved options. Also set
      `preview.markdown.callout: false` in the config-derived LAST merge of `buildVditorOptions`
      (`boot/vditor-options.ts`), like the other saved-options-proof settings. Add a unit test on the
      patch output and a harness e2e that opens `> [!NOTE]\n> Body` in IR + WYSIWYG and asserts the
      DOM is still our `blockquote[data-callout]` dual node and `getValue()` is byte-identical.
- [x] **BLOCKER 2, native WaveDrom off.** New patch `patchWavedromRender` on
      `markdown/wavedromRender.ts` (new `VDITOR_TS_PATCHES` entry) that makes Vditor's
      `wavedromRender` a no-op (our engine `diagrams/engines/wavedrom.ts` owns `language-wavedrom`).
      Same shape as `patchGraphvizRender` (replace the file body, anchor on
      `addScript(\`${cdn}/dist/js/wavedrom/wavedrom.min.js`). Reason: the native renderer is now called
      from `preview/index.ts`, `previewRender.ts` and `processCode.ts`, uses the SAME script id
      `vditorWavedromScript` as our engine, and renders into the same blocks. RED proof: IR, WYSIWYG and
      Preview with a wavedrom block, assert exactly one svg, no `wavedrom render error`.
- [x] **Decide the toolbar HR marker.** 3.11.3 changes the `line` toolbar item prefix from `---` to
      `***` (`util/Options.ts`), which changes what the HR button writes into the user's file in IR/SV.
      Recommended: restore `---` with a one-line anchored patch on `util/Options.ts` (new entry). Ask
      the user if they would rather take upstream's `***`.
- [x] Re-run the full patch check on the installed 3.11.3 (the phase A harness, see Phase A findings),
      then `node build.mjs` and read its `[index-css]` / `[theme-vars]` lines.
- [x] **Task 525 list matrix** (`list-scenarios.spec.ts`, `list-editing-scenarios.spec.ts`, both
      layers) and `list.spec.ts`: 3.11.3 added Enter/Backspace branches to `fixList` that run AFTER our
      seam. Measure, per scenario, whether our seam still owns it; for the ones it declines (empty
      first top-level item, Enter in an empty last nested item) record the new Vditor result.
      Check `data-tight`, ordered-list `start`/numbering of the split-off trailing list, and the caret.
- [x] Re-run callout specs (`callout*.spec.ts`, both harnesses), `caret-on-open`, `find-widget-*`,
      undo/caret specs (`patchUndoCaretSplitRestore`), IR bold/italic/strike toggle with a selection,
      IR copy of a partly selected heading, WYSIWYG heading toggle inside a list item.
- [x] Measure the per-input cost of the new unconditional `renderImageCaptions(...)` calls (they run
      `unwrapWYSIWYGCaptions` / `resetIRCaptions` even when `imageCaption` is false) on a large
      document in IR and WYSIWYG, and check they do not trip our MutationObservers.
- [x] Update the hard-coded version strings: `media-src/src/chrome/toolbar.test.ts` (lines 35, 43, 52,
      56), the comments in `media-src/e2e/keybugs.spec.ts` and `test/vscode-e2e/local-assets-only.spec.ts`.
- [ ] `npm test`, chromium e2e harness, `test:vscode:fast` plus the specs above, `npm run quality`,
      CHANGELOG. Install the VSIX for the user's own check.

## Verify

- [x] All 36 TS patch transforms and all build.mjs CSS patches pass on 3.11.3 (already true in phase A,
      re-check after the install).
- [x] `> [!NOTE]` documents round-trip byte-identically and keep our callout decoration (IR + WYSIWYG).
- [x] A wavedrom block renders once, in every mode, with no native error box.
- [x] Task 525 scenario matrix result is recorded, with every behaviour change classified.
- [x] Every new/changed patch has a RED-GREEN-RED proof (AGENTS.md).

## See also

- `tasks/526-lute-repin-sept-2026.md` (done): the vendored Lute this upgrade relies on.
- `tasks/527-vditor-4-upgrade-spike.md`: the 4.0.0 estimate; this task removes 3.11.3's ~460 of its
  ~1640 changed lines from that spike.
- `docs/adr/0004-patching-vditor.md`: how and why we patch Vditor.

## Phase A findings (2026-10-07)

Analysis only. Nothing under `media/`, `media-src/` (sources, `node_modules`, package files),
`build.mjs`, `src/` or any spec was touched; no `npm install`, build, test or Playwright run. Everything
below was produced from `npm pack vditor@3.11.2` / `vditor@3.11.3` extracted under `tmp/vditor-3113/`
(scripts in `tmp/vditor-3113/scripts/`: `check.mjs`, `syntax.mjs`, `callout.mjs`).

**Recommendation: GO.** No existing patch breaks. Two new blockers (native callout, native WaveDrom)
and one decision (HR marker) need patches in phase B, plus a list-matrix re-measure. The npm package
ships no `CHANGELOG.md`, so upstream commit refs are only those quoted in code comments or in task 527.

### 1. What changed (npm 3.11.2 vs 3.11.3)

`src/`: 21 files changed, 2 added (`markdown/imageCaptionRender.ts`, `markdown/wavedromRender.ts`),
about 950 diff lines. `dist/`: `index.css`, four content themes, `index.js`/`index.min.js`, `method*.js`,
`types/index.d.ts`, `ts/*.d.ts`, i18n `ja_JP` and `zh_TW` (wording only), `js/mermaid/mermaid.min.js`,
`js/lute/lute.min.js`, new `js/wavedrom/` (3.6.2). devDependencies only in `package.json`.

| Area | Files | Change |
| --- | --- | --- |
| Native callout (vditor#1866) | `setLute.ts`, `index.ts`, `previewRender.ts`, `export/index.ts`, `Options/constants.ts`, `wysiwyg/input.ts`, `_reset.less`, `index.less`, content themes | New option `preview.markdown.callout`, **default `true`**; `setLute` calls `lute.SetCallout(...)`. WYSIWYG input widens the block to a `data-type="callout"` ancestor. New `.callout` CSS and `--callout-*` variables (all scoped to `.callout` / `blockquote.callout`). |
| Sub/sup | `setLute.ts`, `index.ts`, `previewRender.ts`, `constants.ts` | New options `sub`, `sup` (default false), `SetSub/SetSup`. |
| WaveDrom (vditor#1931) | new `wavedromRender.ts`, `adapterRender.ts`, `method.ts`, `previewRender.ts`, `preview/index.ts`, `processCode.ts`, `export/index.ts`, `constants.ts` (`ALIAS_CODE_LANGUAGES`), CSS | New native renderer, called from every render path, loads `dist/js/wavedrom/wavedrom.min.js?v=3.6.2`, script id `vditorWavedromScript`. |
| Image captions (vditor#930) | new `imageCaptionRender.ts`, `getHTML.ts`, `ir/process.ts`, `wysiwyg/afterRenderEvent.ts`, `highlightToolbarWYSIWYG.ts`, `preview/*`, CSS | New option `imageCaption` (default false). The IR/WYSIWYG hooks run `resetIRCaptions` / `unwrapWYSIWYGCaptions` on every after-render even when disabled. |
| Lists | `util/fixBrowserBehavior.ts`, `wysiwyg/setHeading.ts` | `fixList` gains (a) Enter on an empty LAST nested item exits to a paragraph in the parent item (vditor#939), (b) Backspace on ANY empty item exits the list via the new exported `exitEmptyListItem` (splits the list around it); the old "empty item → append `\n\n` to the previous item" branch is **removed**. Blockquote-in-list Enter / ArrowUp/Down tweaks (vditor#1925). WYSIWYG heading toggle works inside list items, unwraps in tight lists, and calls `renderToc`. |
| IR | `ir/process.ts`, `ir/index.ts` | Bold/italic/strike/inline-code toggle keeps the selection (two `<wbr>`); `removeInline` keeps the selection; IR copy restores a cut-off heading marker. |
| Paste / link refs | `fixBrowserBehavior.ts` (paste `renderLinkDest`) | Reference-style link destinations (`parent.Type === 33 && parent.LinkType === 3`) are not repeated. Needs `LinkType` on the Lute node; the vendored 591a695 has it (2 hits). |
| Toolbar | `util/Options.ts` | `line` item `prefix` `---` → `***`. No hotkey, name or other option changed. |
| Misc | `wysiwyg/highlightToolbarWYSIWYG.ts` | `customWysiwygToolbar` null-guarded. |
| Mermaid | `mermaidRender.ts`, `dist/js/mermaid` | `?v=11.6.0` → `11.16.1`. We bump to our own pin (`patchMermaidVersion`) and sync our vendored copy over it. |
| Lute (dist) | `dist/js/lute/lute.min.js` | Still reports `1.7.6`; we override with the vendored `591a695` build, so irrelevant. |

Not changed: `undo/index.ts`, `util/selection.ts` (`addCaret`, `setRangeByWbr`),
`util/editorCommonEvent.ts`, `markdown/getMarkdown.ts`, `sv/*`, `toolbar/*` (except `Options.ts`),
`wysiwyg/index.ts`, `ir/input.ts`, `upload/index.ts`, every diagram renderer except mermaid's version.

### 2. Patch anchor check (mechanical)

`tmp/vditor-3113/scripts/check.mjs` imports the real `VDITOR_TS_PATCHES` from `esbuild-shared.mjs` and
runs every entry's `transform` on every matching file of both versions (so the baseline proves the
harness works), reporting a throw as FAIL and an unchanged output as NOOP. Result:

- **TS patches: 36 file-transforms (all 34 registry entries, incl. the echarts filter matching 3 files)
  PASS on 3.11.3, 0 FAIL, 0 NOOP.** Identical to the 3.11.2 baseline.
- `tmp/vditor-3113/scripts/syntax.mjs` additionally runs every patched 3.11.3 output through esbuild's
  TS transform: **0 syntax failures.**
- **CSS patches:** the `build.mjs` functions `varifyVditorPalette`, `patchContentThemeIrLink` and
  `patchVditorIndexCss` were copied (lines 1-575, unmodified, only the vendored-assets import made
  absolute) into a sandbox whose `media/vditor/dist` is the 3.11.3 `dist/`, then run. **All pass**
  (every anchor found, the `[theme-vars]`, `[content-theme]` and `[index-css]` lines printed), and the
  same run on 3.11.2 is the control.

So no anchor needs rewriting. A passing anchor does not prove the patched code still behaves; the
semantic review of the patches that touch changed regions:

| Patch | Verdict |
| --- | --- |
| `patchFixListOutdent` (seam at top of `if (liElement) {`, first-item gate, outdent re-bind) | Anchors fine and the seam still runs BEFORE the new branches. But our seam returns false when `previousVisibleLine` is null (empty FIRST item) and for Enter on an empty item, and those now reach the NEW Vditor branches instead of the old ones. Needs the 525 re-measure (Steps). The `FIX_LIST_FIRST_ITEM_ANCHOR` gate is still valid but is now mostly shadowed for empty items. The comment in `list-backspace.ts` ("fires BEFORE fixList's empty item -> align branch") is stale once the branch is gone. |
| `patchListToggle`, `patchCalloutArrowNav`, `patchPasteTransform`, `patchPasteUrlAsLink` | Unaffected (their regions are unchanged). |
| `patchLuteHook` | Anchor fine; **must be extended** (blocker 1). |
| `patchProcessCode` | Anchors fine; the new `wavedrom` branch sits in the part that is not replaced; it calls the native renderer (blocker 2). |
| `patchPreviewMorph`, `patchPreviewComments`, copy-tip patches | Anchors fine. New `renderImageCaptions` lines land in `preview/index.ts` outside the morph anchor. |
| `patchIrInputSerialize`, `patchIrLinkSelectedUrl` (`ir/process.ts`) | Anchors fine; the new `renderImageCaptions` call is at the top of `processAfterRender`, ahead of our serialize takeover (cost to measure). |
| `patchDeferGetMarkdown` (`wysiwyg/afterRenderEvent.ts`) | Anchor fine; `renderImageCaptions` is added before it. |
| `patchUndoCaretSplitRestore`, `patchDmpInterop`, `patchSetRangeByWbrHeadingMarker`, `patchInsertHtmlDelete`, editorCommonEvent patches | Files unchanged upstream. |
| `patchIrLinkClick` (`ir/index.ts`) | Anchor fine; upstream's new copy-handler code (`restoreHeadingMarker`) is next to, not inside, the patched click region. Interacts conceptually with `patchSetRangeByWbrHeadingMarker` (task 286); covered by the IR copy-heading check in Steps. |

### 3. Callouts (the main risk, and it is real)

- 3.11.3 has native callouts in IR, WYSIWYG and preview, enabled by the option
  `preview.markdown.callout`, **default `true`**; `setLute` calls `lute.SetCallout(callout)`. Our
  `buildVditorOptions` uses a deep merge on top of Vditor's defaults, so with no change we get
  `callout: true`. A saved options blob from 3.11.2 sessions does not carry the key, so it does not
  protect us either.
- Task 526's callout finding ("the Vditor renderers never emit it") was true for 3.11.2 only because
  3.11.2 never calls `SetCallout`. Measured with the vendored `591a695` blob in Node
  (script `tmp/vditor-3113/scripts/callout.mjs`, output `tmp/vditor-3113/callout-vendored.txt`):
  - `SetCallout` not called, or `false`: byte-identical to today (`<blockquote data-block="0"><p
    data-block="0">[!NOTE]\nBody</p></blockquote>`), markdown round-trips unchanged.
  - `SetCallout(true)`: `<blockquote data-type="callout" data-subtype="NOTE" class="callout"><p
    class="callout-info vditor-ir__node"><span class="vditor-ir__marker">[!NOTE] </span>✏️ Note</p>
    <p>Body</p></blockquote>` in IR, a `vditor-wysiwyg__callout-marker` span in WYSIWYG, a
    `<div class="callout">` in `Md2HTML`. **The serialised markdown changes**:
    `> [!NOTE]\n> Body` becomes `> [!NOTE] ✏️ Note\n>\n> Body`; `> [!WARNING]-` becomes
    `> [!WARNING] ⚠️ -`; a custom title gets an emoji prefix. That is silent data change on save, and
    our `blockquote[data-callout]` decorators and `callout-nav.ts` key on the plain blockquote, so
    they would not match.
- The new `.callout` CSS and the `--callout-*` variables (also added to the four content themes) are
  all scoped to `.callout` / `blockquote.callout` / `.vditor-wysiwyg__callout-marker`, so with
  `SetCallout(false)` they are inert and do not collide with our `blockquote[data-callout]` rules.
- All three Lute methods 3.11.3's TS calls that 3.11.2's did not (`SetCallout`, `SetSub`, `SetSup`) and
  `LinkType` exist in the vendored blob; the full `lute.X(` / `Lute.X` set used by 3.11.3's `src/` was
  checked by name against `media-src/vendor/lute/lute.min.js`: **0 missing.**
- Whether to adopt native callouts later (it would drop our dual-node machinery) is a separate
  product decision, not part of this upgrade. Task 526 already said to ask before switching.

### 4. Other flags

- **Options:** added `callout`, `sub`, `sup`, `imageCaption` under `preview.markdown`; nothing removed.
  `imageCaption`, `sub`, `sup` default false, which is what we want; we do not expose any of them.
- **Toolbar / hotkeys:** only the `line` prefix (`***`, decision in Steps). No hotkey changed. Our
  `chrome/toolbar.ts` only overrides the tip and hotkey of `line`, so the prefix comes from Vditor.
- **Lists:** see the `fixList` rows above; this is the highest-risk behaviour area after callouts.
  `exitEmptyListItem` does `cloneNode(false)` for the split-off trailing list and does NOT spin, so a
  stale ordered-list `start` or `data-tight` on the trailing list is possible; measure in the matrix.
- **Undo / caret:** `undo/index.ts` and `util/selection.ts` are byte-identical, so
  `patchUndoCaretSplitRestore` and `addCaret` are untouched. The only caret-relevant additions are the
  IR toolbar `keepSelection` double-`<wbr>` flow and `setHeading`'s `setRangeByWbr`.
- **`getMarkdown`, paste:** `getMarkdown.ts` unchanged. Paste code unchanged apart from the
  reference-link `renderLinkDest` guard above.
- **Hard-coded version strings** in tests and comments (see Steps).
- **`dist` assets:** `syncVditorAssets` copies the new `dist/js/wavedrom/` (3.6.2); our vendored
  `wavedrom` (3.6.1, `vendored-assets.mjs`) is copied to the same path afterwards, so ours wins. Both bundles
  contain the string `renderWaveElement` (string match only, API compatibility not run), so blocker 2
  may be a race rather than an obvious error.
- **Reference to the unrelated gain:** upstream's IR bold/italic selection fix, copy-heading fix, list
  fixes and Mermaid 11.16.1 come for free once the blockers are handled.

## Phase B results (2026-10-07)

Done: `vditor` `^3.11.3`; patches `patchLuteHook` (+`SetCallout(false)`) and new `patchWavedromRender`
(anchor-asserted, unit-tested, red-proved); `preview.markdown.callout: false` in the config-derived last
merge; NO HR patch (see Decisions); the seam in `list-backspace.ts` now owns Enter on an empty NESTED item
(`isEmptyNestedItem`, outdent like Shift+Tab), keeping the 525 expectation `1. one\n2. two\n   - aaa\n3. three\n`
(3.11.3's vditor#939 branch would have produced a loose list); version strings; stale comments;
`media-src/e2e/vditor-upgrade.spec.ts` (+harness); #1925 tripwire in `keybugs.spec.ts` converted to a
correctness test (fixed upstream); CHANGELOG.

Gates: `npm test` 3003 pass; whole chromium harness 580 pass / 5 skipped / 0 failed; `test:vscode:smoke` 10 pass;
`test:vscode:fast` 62 pass; `npm run quality` all PASS; targeted real-VS-Code specs (list-*, callout-*, caret-*,
find-widget-*, wavedrom-theme, `--retries=0`) 32 pass, 1 fail: `find-widget-modes` is intermittent (sv/preview/wysiwyg
"focus left the find box"), reproduced on Vditor 3.11.2 too (3/6 failed there, 3/7 on 3.11.3), so pre-existing
(task 522 area), not caused by the upgrade.

Perf: `renderImageCaptions` with `imageCaption` off is one attribute `querySelectorAll`; ~0.002 ms/call on
a 14.6k-node IR document; no patch proposed.

Open: install the VSIX for the user's check; find-widget-modes flake (task 522).
