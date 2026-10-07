# Task 191 — mouse-operations test plan (selection · clipboard · menus × ir/wysiwyg/sv/preview)

> **Status:** 📋 PLAN (2026-07-03). Deep-dive companion to task 190: map every MOUSE-driven
> operation (caret clicks, double/triple-click, drag selection, copy/cut/paste, drag & drop,
> toolbar/panel/popover/hint menus, context menu, middle-click) across the three edit modes
> (**ir**, **wysiwyg**, **sv**) plus the read-only **preview** surfaces, audit what is really
> tested today, and produce a prioritized implementation plan. Produced by a 12-agent workflow
> (`wf_2947eb81-70f`: 5 dimension audits + 1 test-inventory sweep → 5 adversarial verifiers →
> synthesis, 53 inventoried specs). Load-bearing claims hand-verified afterwards (see §0).
>
> Layers: **L1** = vitest unit, **L2** = chromium harness e2e (`media-src/e2e`),
> **L3** = real-VS-Code e2e (`test/vscode-e2e`, xvfb). Item types: **NET** = protects behaviour
> known to work; **PROBE** = may discover behaviour that is already broken (run probe first,
> promote to net after fixing). Where an item touches a task-190 entry it says so —
> task 190 stays the umbrella plan; this file is the authoritative detail for mouse ops.

## 0. Progress (2026-07-03)

Implemented in the plan's own sequence (§6). Each batch verified green under `xvfb-run -a`.

**Batch 1 — Infra-1 + Infra-2/3 + P0 copy/cut (DONE, verified):**
- **Infra-1 ✅** — the RED L2 gate is green again. `webview-behaviors.spec.ts` was **9/24
  failing** (re-confirmed by hand: all `window.__utils.X is not a function`). Fix:
  `behaviors-harness.ts` now re-aggregates the task-185-moved helpers — `fixLinkClick`
  (link-click-fix.ts) + `fixResponsiveTables` (responsive-tables.ts) under `__utils`, and
  `saveVditorOptions`/`handleToolbarClick` under a new `__toolbarActions` namespace.
  Findings folded in: (a) the two `confirm()` dialog tests were **deleted** — that helper was
  intentionally removed as dead code in task 185 (`utils.ts:5`), nothing left to protect;
  (b) the two toolbar-save assertions were updated to the **allow-list contract** — save-options
  now posts `{mode}` only, not the pre-185 `{theme, mode, preview}` (toolbar-actions.ts:23-28);
  (c) added the plan's requested **capture-phase + real-`stopPropagation`** test (a `[data-mode]`
  click persists + reports the mode despite Vditor swallowing the bubble event). Now **23/23**.
- **Infra-2/3 ✅** — new shared mouse-ops harness + helpers (dedicated, matching the repo's
  one-harness-per-concern pattern rather than bloating keybugs): `mouseops-harness.ts` (+`.html`,
  registered in `harness-entries.mjs`; meta-test green) = real Vditor from source, `?mode=`, wired
  like main.ts with `patchLuteSerialize` + custom wiki renderer + `fixCut` + the edit-sync message
  recorder + a canonical `__torture` value. `mouseops-helpers.ts` = `gotoMouseops`, `setDoc`,
  `selectAllContent`/`selectWithin`/`collapseCaret` (focus-first), `syntheticClipboard(copy|cut)`
  (DataTransfer read-back with UNSET sentinels), `tripleClick`, `posted`/`editPosts`/`getValue`.
- **P0-1 ✅ / P0-2 ✅ / P0-3 ✅** — `media-src/e2e/copy-cut.spec.ts` (8 tests, all green). P0-1:
  IR cross-block copy restores `**`/`[[Home]]` markers with no DOM leak + `text/html===''`,
  triple-click marker-inclusive copy, empty-selection early-return leaves the clipboard untouched.
  P0-2: all four WYSIWYG branches (inline code, pre>code raw, titled link, cross-block incl a
  highlighted fence with no hljs/`<span` leak). P0-3: cut payload == copy payload + the block
  disappears after fixCut's deferred delete.

**Findings / adjustments recorded this batch:**
- **ZWSP in WYSIWYG inline-code copy is real** (→ Probe-19): the copied `` `inline code` `` carries
  a U+200B (codeRender.ts:58 caret pad). P0-2 normalizes it out (protects the branch, stays
  forward-compatible with the Probe-19 fix) rather than locking the bug in.
- **A synthetic ClipboardEvent's deferred `execCommand('delete')` mutates the DOM but does NOT
  drive Vditor's IR `input` pipeline** (verified: `inputCount===0`), so a cut posts no edit in L2.
  The input→debounce→post plumbing is already covered (edit-sync.test.ts, save-flush.spec.ts), so
  P0-3's L2 scope is payload+removal; the cut→save WIRE proof stays at **P0-4** (L3, real Ctrl+X→
  Ctrl+S→disk). No behaviour change — an accurate scoping of what each layer can prove.

**Batch 2 — P0 paste pipeline (DONE, verified):** `media-src/e2e/paste-pipeline.spec.ts`
(14 tests, all green). **P0-5** ✅ plain-markdown paste renders into real blocks in order
across ir/wysiwyg/sv (+ ir renders a real `<h1>`). **P0-7** ✅ Word-ish HTML → markdown across
all three modes with zero style/onclick/raw-tag leak (Sanitize + style/`.vditor-copy` strips) +
the address-bar `<a href=X>X</a>` special-case → bare autolink, not `[url](url)`. **P0-8** ✅
URL-over-selection → `[word](url)`, plain-over-selection replaces exactly once, URL-with-html
does NOT autolink. **P0-9** ✅ paste inside a fence stays literal (ir/wysiwyg via the CODE
branch; sv via processPaste).
- **Finding (sv P0-9):** sv renders a fence as marker spans (`code-block-open-marker`/`text`/
  `code-block-close-marker`), NOT a `data-type="code-block"` element, and `hasClosestByAttribute`
  matches EXACTLY — so paste()'s sv codeElement/escaping branch (fixBrowserBehavior.ts:1383-1384)
  is **unreachable**; sv pastes flow through processPaste. sv stays literal because the whole
  surface is literal, not because of that branch. The sv leg asserts the real (processPaste) path.
- **P0-16 (one paste = one undo) → deferred to P0-6 (L3):** a synthetic ClipboardEvent's
  insertHTML mutates the DOM but does NOT populate Vditor's undo stack (verified: a single Ctrl+Z
  did not roll back the paste), the same input-pipeline gap that scoped the cut edit-post to L3.
  A faithful "single Ctrl+Z restores the pre-paste doc" needs a REAL Ctrl+V — that is P0-6.

**Batch 3 — P0 selection + checkbox (DONE, verified):**
- **P0-10 ✅** `mouse-selection.spec.ts` — a cross-block delete across a paragraph→fence
  boundary keeps the fence balanced (even ``` count) + untouched neighbour intact; a delete
  across a rendered mermaid removes BOTH its source and its preview SVG.
- **P0-11 ✅** double-click a bold word + type → word replaced, neighbours + `**` markers
  intact; triple-click a line + type → line becomes the typed text, no orphan `**`.
- **P0-12 ✅** (data-integrity leg) after a table-cell click materializes
  `#fix-table-ir-wrapper`, select-all→Delete→type leaves clean markdown — the injected
  helper DOM never serializes. (The plan's Ctrl+A-block-scoping leg is a Vditor built-in,
  not a corruption path, and wouldn't reproduce from a synthetic caret at L2 → left to L3.)
  Wired `fixTableIr()` into the mouseops harness so the wrapper materializes as in main.ts.
- **P0-15 ✅** `checkbox-click.spec.ts` — a REAL locator click flips `- [ ]`↔`- [X]` cleanly
  (no getValue collapse — the task-190 §5 synthetic-click artifact does NOT occur with a
  trusted click); Preview checkboxes are `disabled` + inert.

**Consolidated finding (L2 vs L3 boundary):** in the mouseops harness, DOM-mutating mouse
ops (cut, paste, checkbox toggle) reliably change `getValue()`, but do NOT reliably drive
Vditor's `options.input → schedule → {command:'edit'}` post pipeline (verified 3×). So L2
proves DOM/serialize INTEGRITY; the mutation→edit→save WIRE is proven at L3 (P0-4 cut, P0-6
paste+undo, Probe-21 checkbox). This is an accurate layer split, not a gap.

**Batch 4a — P1-18 sanitize fix + P0-13 image-upload wire (DONE, verified):**
- **P1-18 ✅** (real bug fix, §0) — extracted `sanitizeUploadName` (media-src/src/upload-name.ts):
  fixed the missing `/g` (every disallowed run replaced, not just the first) and the surviving
  interior `..` (collapsed → no path-traversal segment). Added a HOST-side guard too (defense in
  depth): `onUpload` now reduces each name to a basename + verifies the join stays inside the
  assets folder, skipping anything that would escape (extension.ts). Unit tests: upload-name.test.ts
  (4) + image-upload.test.ts (+2: neutralizes `../../evil.png`, rejects `..`). Full suite 1236 green.
- **P0-13 ✅** `paste-upload.spec.ts` (3/3) — an image-File paste posts exactly one {command:'upload'}
  with a timestamp-prefixed, sanitized name + non-empty base64 (two files → two entries; a crafted
  `../` name is sanitized before the wire). Extracted the upload handler to upload-handler.ts
  (§5.4) so the harness drives the REAL handler, not a copy; main.ts now uses createUploadHandler.
  (Extension is webp when convertForUpload converts / original on fallback — the codec decision is
  convertForUpload's, unit-tested in image-convert.test.ts; P0-13 pins the message shape.)

**Batch 4b — P0 L3 wire (DONE, verified) — ALL of P0 now complete:**
- **P0-4 ✅** `copy-clipboard.spec.ts` (2/2) — cut a block (triple-click + Ctrl+X) then save →
  the file on disk loses EXACTLY that block, other blocks verbatim (the data-loss net the L2
  spec couldn't prove); copy (Ctrl+C) → `vscode.env.clipboard.readText()` holds the markdown.
- **P0-6 ✅ + P0-16 ✅** `paste-real.spec.ts` (1/1) — `clipboard.writeText(md)` + a REAL Ctrl+V →
  the paste reaches the live TextDocument and saves verbatim to disk; a SINGLE Ctrl+Z rolls
  back the WHOLE 3-block paste (the one-paste=one-undo leg, folded in from P0-16).
- **P0-14 ✅** `image-upload-wire.spec.ts` (1/1) — an in-frame synthetic image-File paste →
  the host writes the decoded image into the assets folder (sanitized, timestamped name) and
  the `![](assets/…)` link lands in the saved document. Re-opened the task-190 deferral with
  the in-frame-synthetic approach; exercises createUploadHandler + sanitizeUploadName end to end.
- **Discovery:** the VS Code clipboard bridges BOTH ways under xvfb (copy→readText AND
  writeText→Ctrl+V), so L3 clipboard nets are viable here — no prior L3 spec had used it.
  A real triple-click (not a programmatic Range) is required for a clean cut (the Range raced
  the native cut and merged blocks).

**Batch 5 — P1 nets reusing the mouse-ops infra (DONE, verified):**
- **P1-2 ✅** toolbar-selection.spec.ts — bold/italic/list on a selection (ir) + sv bold, via a
  real toolbar (new `?toolbar=1` harness option). **P1-12/13/14/15 ✅** paste-pipeline.spec.ts —
  code-HTML→fence, pasted mermaid renders, table-cell paste, copy→paste round-trip. **P1-17 ✅**
  dragdrop.spec.ts — image-File drop → upload wire (+ Probe-4 text/plain-only drop no-op).
  **P1-19 ✅** copy-cut.spec.ts — sv verbatim source copy.
- **Probe-4/14/15 ✅** run + pinned: text/plain drop no-op; collapsed sv copy clobbers '';
  collapsed cut = stealth backspace. 14/15 confirmed as real (minor) bugs — pinned as current,
  fix gated on a product decision (not touched, to keep the cut/copy paths stable).

## 0b. Status + triage of the remainder (2026-07-03)

**DONE + verified (green under xvfb / in the gates):** Infra-1, Infra-2/3, **ALL of P0 (1-16)**,
P1-18 (+ host guard), P1-2, P1-12, P1-13, P1-14, P1-15, P1-17, P1-19, Probe-4, Probe-14, Probe-15.
The change-stability CORE the task set out to protect — selection→edit, clipboard fidelity, paste,
cut/paste→save→disk, image upload, checkbox — is fully covered. New nets ride the standing L2
(`test:e2e`) + L3 gates; the three L3 data-loss nets are added to the PR smoke battery.

**Remaining P1 — core already covered by existing tests; only a refinement leg is new → deferred
(none are corruption/data-loss paths):**
- **P1-1 wysiwyg popover battery** — the single highest-value UNCOVERED surface (table/link/img
  popovers, heading ∧/∨/🗑). Genuinely new; deferred as the top follow-up — needs a dedicated
  popover-interaction harness; not a data-loss path. **Recommended next.**
- **P1-3** real-webview toolbar actions — formatting covered at L2 (P1-2); scroll-guard by
  `scrolljump.spec`; only the L3 focus/persist + preview-disabled legs are new.
- **P1-4** mode-switch persistence — the capture-phase persist is covered (Infra-1 test +
  save-vditor-options.test.ts); only the L3 close/reopen + the ir→sv type-race leg are new.
- **P1-5** click-to-edit caret landing — wysiwyg clicked-char covered (`wysiwyg-highlight.spec`);
  IR click-to-edit + padding-fallback legs new (caret nuance, not corruption).
- **P1-6** callout click-to-enter — callout edit machinery covered (`callout-ir/edit`); only the
  mouse click-to-ENTER caret leg is new.
- **P1-7** link policy — dispatched-event policy covered (`link.spec`, `link-open-policy.test`);
  only caret-in-anchor + the preview/sv legs are new.
- **P1-8** toolbar dropdown dismiss — createToolbar command posts covered (`webview-behaviors`);
  the dismiss mechanism is Vditor-internal UI.
- **P1-9** IR table panel — all 9 icon clicks covered at L2 (`table-hotkey.spec`); only L3
  positioning + per-cell align-tracking are new.
- **P1-10** hint menus — wiki hint incl. mouse completion covered (`wiki-hint.spec`); emoji /
  code-lang hint insert paths new.
- **P1-11** callout popover controls (L3 native `<select>`) — callout type-change covered at L2
  (`callout-rename`); the L3 native-select leg is new.
- **P1-16** sv paste → split preview — sv split covered (`sv-split`, `split-scroll`); paste-into-
  split-left leg new.
- **P1-20** preview copy + copy-button — needs a REAL-clipboard harness (execCommand ignores
  stubs); overlaps Probe-3/19 (CSP). Deferred with those.

**Probes not run this pass** (cheap discovery; none block the core — run opportunistically):
- **HIGH value to run next:** Probe-1/2/3 (CSP bricks the image-preview overlay + code copy-button
  in the real webview — inline `onclick` is dead under our CSP, §0) — these are real user-facing
  breakage worth confirming + fixing (`image.isPreview:false` / rewire). L3-only.
- The rest (5-13,16-27) are edge-case desyncs / variants; several (8 select-all-leak, 20 table
  partial) are refinements of behaviour P0-1/P0-11 already exercise.

**P2 (all 11):** nice-to-have (math/table copy, outline drag-resize, STL orbit, etc.) — batch
opportunistically when a neighbouring spec is touched; none are data-loss.

**Infra §5.4 remainder:** `sanitizeUploadName` + the upload handler are extracted (done);
`handleScrollToHeading` + outline `onResize` + STL `dataset` extractions remain (their P2/probe
consumers are deferred, so not on the critical path).

## 0. Hand-verified facts (2026-07-03)

Three synthesis claims were re-verified by hand before this plan was written down:

- **The L2 `webview-behaviors.spec.ts` gate is RED today — worse than the audit claimed.**
  Ran it: **9/24 tests fail** (confirm() dialog ×2, fixLinkClick ×4, fixResponsiveTables,
  toolbar config save ×2), all with the same root: `window.__utils.handleToolbarClick is not
  a function` class — task 185 moved functions out of `utils.ts` (→ `toolbar-actions.ts` et
  al.) but `behaviors-harness.ts:10-16` still exposes only `utils`, and the specs assert the
  pre-allow-list payload. Fixing this rot is **Infra-1** and blocks nothing else — but it
  means the harness e2e gate currently cannot catch mouse-behaviour regressions in these areas.
- **Upload-name sanitize bug is real** (→ P1-18, fix+test): `main.ts:527-530` sanitizes with
  `replace(/[^\w-_.]+/, '_')` — **no `/g`**, only the first bad-char run is replaced; and the
  char class permits `.`, so interior `..` survives. The host then joins it unsanitized:
  `NodePath.join(assetsFolder, file.name)` at `extension.ts:772` — a crafted name with an
  interior `../` segment escapes the assets folder. Small blast radius (the name is built by
  our own webview from the pasted file's name, not attacker-controlled markdown), but it is a
  correctness+hygiene bug worth an extraction + unit pin.
- **CSP kills inline `onclick`** (→ Probe-1/Probe-3): `src/html-builder.ts:54-59` sets
  `default-src 'none'` with `'unsafe-inline'` granted **only to `style-src`** — script
  attributes are dead. Vditor's image-preview overlay and the code-block copy button are
  wired via inline `onclick` in the vendored code, so both are expected to be bricked in the
  real webview (harness has no CSP → L3-only probes).

## 1. Coverage matrix (mouse operations × mode)

✅ solid · △ partial/grazing (unit-only, synthetic-only, or one narrow case) · ❌ nothing ·
— n/a for that mode.

| Operation group | ir | wysiwyg | sv | preview |
|---|---|---|---|---|
| Click-to-edit rendered blocks (caret landing) | △ CSS-state only, no coordinate click (codeedit.spec) | ✅ clicked-char (wysiwyg-highlight.spec:223) | — | — |
| Double/triple-click & mouse-drag text selection | ❌ | ❌ | ❌ | ❌ |
| Select-all | △ keybugs #3 only | ❌ | ❌ | — |
| Copy — clipboard payload | ❌ | ❌ | ❌ | ❌ (toast patch-string only) |
| Cut | ❌ (fixCut deferral unit in isolation) | ❌ | ❌ | — |
| Paste (ClipboardEvent) | △ L1 spin gates only | △ function-level detection only | ❌ | — no listener |
| Drag & drop (text / files) | ❌ | ❌ | ❌ | ❌ |
| Link / wiki click policy | ✅ | △ caret side missing | △ unit only (link-open-policy) | △ wiki ✅, real `<a>` ❌ |
| Toolbar formatting on selection | ❌ | △ inline-code only (keybugs #7) | ❌ | — (disabled state untested) |
| Mode switch / preview toggle by mouse | △ synthetic dispatch; persistence ❌ | △ | △ | △ button clicked as driver only |
| Floating panels / popovers | ✅ table panel L2 (L3 ❌) | ❌ stock popovers (callout additions ✅) | — | — |
| Hint menus | △ wiki ✅; emoji/code-lang ❌ | ❌ | ❌ | — |
| Task checkbox click | ❌ (crash pin only) | ❌ | — | ❌ disabled unpinned |
| Outline click-nav / drag-resize | △ flash ✅, drag ❌, scroll-to-heading msg ❌ (mode-agnostic) | | | |
| Diagram mouse gates (zoom/pan/click) | ✅ except STL | △ L1 gate only | △ | ✅ |
| Scroll gestures (wheel, guard, sync) | ✅ | △ | ✅ | △ programmatic toggle |
| Copy button / image overlay widgets | ❌ (CSP-suspect, §0) | ❌ | ❌ | ❌ |
| Context menu passthrough / middle-click | ❌ | ❌ | ❌ | ❌ |

## 2. Already well covered — do NOT add tests here

- Wiki chip click policy + caret placement, ir + preview (`wiki-click.spec.ts`); `[[` hint
  incl. real mouse completion (`wiki-hint.spec.ts:180`).
- Link open policy at dispatched-event level, ir/wysiwyg + all-mode unit (`link.spec.ts:59-111`,
  `link-open-policy.test.ts`). Only the caret-in-anchor and preview/sv legs are new (P1-7).
- WYSIWYG code click→clicked-char caret, L2 happy path (`wysiwyg-highlight.spec.ts:223`) —
  only the L3 leg + padding-fallback are new (P1-5).
- IR table panel L2 mechanics incl. all 9 real icon clicks with markdown asserted
  (`table-hotkey.spec.ts:68-176`).
- Toolbar scroll-guard L2 mechanism (`scrolljump.spec.ts`, incl. mousedown defaultPrevented) —
  real-webview L3 confirmation is the only gap (P1-3b).
- Formatting applies to an active selection (wysiwyg inline-code, real toolbar click —
  `keybugs.spec.ts:235-266`); the audit headline claiming zero coverage was refuted.
- Diagram Ctrl-gates: L1 predicate + `diagram-zoom.spec`, `geojson-pan-gate.spec`,
  `diagram-inline-zoom.spec` (L3). Only STL orbit is dark (P2).
- Split scroll-sync via real wheel (`split-scroll.spec.ts`); prepaint wheel capture
  (`prepaint-scroll.spec.ts`).
- Callout selection-driven expand/collapse machinery (`callout-ir.spec`, `callouts.test.ts`,
  L3 `callout-edit.spec`) — only the mouse click-to-ENTER is new (P1-6).
- Mode round-trip byte stability (`mode-roundtrip.spec.ts`); `patchOutlineCurrent` build-time
  net; `showToolbar=false` (`config-apply.spec.ts:69-78`).
- Host copy-html/copy-markdown handler unit (`test/backend/extension.test.ts:161-179`) — but
  the route is **dead** (zero webview senders); no test to add, carried as a task-190
  amendment instead (§6.5).

## 3. Prioritized plan

### P0 — corruption / data-loss class (all NETs)

Clusters into 3 new L2 spec files + 3 L3 specs. Selection→edit, clipboard fidelity, and
paste are the mouse paths that can silently corrupt a document.

- [x] **P0-1 IR copy payload** ✅ — `media-src/e2e/copy-cut.spec.ts` (new), **L2, M, ir**.
      Mouse-drag a cross-block selection over `# H` + `**bold**` + `[[wiki]]`, dispatch
      synthetic `ClipboardEvent('copy')` with a `DataTransfer` → text/plain is the exact
      markdown (markers + `[[..]]` restored via patchLuteSerialize — ir/index.ts:54-67,
      wiki-serialize.ts:87-89), text/html === `''`. Include triple-click marker-inclusive
      copy (dual-node range) and pin the empty-selection early-return. *Caveat: harness must
      wire patchLuteSerialize (wiki-harness boot pattern).*
- [x] **P0-2 WYSIWYG copy branches** ✅ — `copy-cut.spec.ts`, **L2, M, wysiwyg**. Parametrize the
      4 branches (wysiwyg/index.ts:204-244): inside inline code → `` `x` ``; inside pre>code;
      inside titled link → `[t](href "title")`; cross-block incl. a live-highlighted code
      block → markdown with **no** `hljs`/`<span` leak (wrapLuteFlatten).
- [x] **P0-3 Cut end-to-end** ✅ (L2 scope = payload+removal; edit-post→P0-4) — `copy-cut.spec.ts`, **L2, M, ir (+sv leg S)**. Drag-select a
      paragraph, synthetic `cut` → payload equals the copy payload, block gone **after one
      tick** (our fixCut defers `execCommand('delete')` — media-src/src/utils.ts:52-63),
      exactly one `{command:'edit'}` posted (save-flush spy pattern) whose content lost the block.
- [x] **P0-4 ✅ Copy/cut real wire + cut writeback** — `test/vscode-e2e/copy-clipboard.spec.ts`
      (new), **L3, M, ir+sv**. Triple-click + Ctrl+C → `vscode.env.clipboard.readText()` is
      the markdown source line; Ctrl+X then Ctrl+S → clipboard holds the text AND the file on
      disk no longer contains it (the cut data-loss net). Plus: drag-select in the sv
      **right** preview pane + Ctrl+C → rendered plain text.
- [x] **P0-5 ✅ Plain-markdown paste pipeline** — `media-src/e2e/paste-pipeline.spec.ts` (new),
      **L2, M, ir/wysiwyg/sv**. Synthetic paste (ClipboardEvent + DataTransfer text/plain,
      keybugs-harness `?mode=` pattern) of `# H\n\npara **b**\n\n- item` at a mid-doc caret →
      getValue() gains all blocks in order; ir renders the heading; sv source spans intact
      (fixBrowserBehavior.ts:1258-1499).
- [x] **P0-6 ✅ Paste → save real journey** — `test/vscode-e2e/paste-real.spec.ts` (new),
      **L3, M, ir**. `vscode.env.clipboard.writeText(md)` + Ctrl+V → TextDocument gains the
      content; Ctrl+S → bytes on disk verbatim; single Ctrl+Z restores the pre-paste document
      (extends undo-dirty-probe's typing-only coverage).
- [x] **P0-7 ✅ HTML→markdown paste matrix** — `paste-pipeline.spec.ts`, **L2, M, ir/wysiwyg/sv**
      — **extends task-190 `paste-html.spec` (upgrade PROBE/S→NET/M, repoint the entry, §6.5)**.
      Word-ish HTML (`<h1>+<b>+<table>` + style + onclick) per mode → heading/bold/table
      markdown, zero style/onclick/HTML leak (Sanitize :1372, style-strip :1412-1414,
      `.vditor-copy` strip :1415-1417); address-bar `<a href=X>X</a>` + matching text/plain →
      bare autolink, not `[url](url)` (:1360-1365).
- [x] **P0-8 ✅ Paste over selection / URL autolink** — `paste-pipeline.spec.ts`, **L2, S, all**.
      Includes existing-link href replacement and literal URL guards for fenced code, inline code,
      and `sv` raw/source. The focused L2 paste pipeline is 22/22 green; task 224 also has a
      real-VS-Code existing-link test (1/1 green, 2026-08-11).
      Select `target`, paste a URL → `[target](url)`; select a phrase, paste text → replaced
      exactly once; a URL pasted WITH other html markup does **not** autolink (:1458-1462).
- [x] **P0-9 ✅ Paste into fence stays literal** — `paste-pipeline.spec.ts`, **L2, M, all**.
      `# not a heading\n**not bold**` pasted inside ```` ```js ```` stays verbatim in the
      fence; ir `__preview` twin refreshes; sv `&`/`<` literal (:1377-1400). (The null-deref
      sibling is Probe-2.)
- [x] **P0-10 ✅ Drag-select cross-block delete** — `media-src/e2e/mouse-selection.spec.ts`
      (new), **L2, M, ir**. mouse.down/move/up from mid-paragraph into code line 2 +
      Backspace → well-formed fence (even ``` count, language intact); drag from above a
      rendered mermaid to below + Backspace → source AND `.vditor-ir__preview` both gone from
      DOM and getValue().
- [x] **P0-11 ✅ Double/triple-click select→edit** — `mouse-selection.spec.ts`, **L2, M,
      ir (+wysiwyg)**. `clickCount:2` on rendered **bold** → deferred expandMarker fires,
      `'bold'` selected, typing replaces without corrupting neighbours; `clickCount:3` on
      `pre **mid** post` + type → line becomes exactly the typed text, no orphan `**`
      (hidden markers are width:0 in selectable flow).
- [x] **P0-12 ✅ Select-all with helper DOM present** — `mouse-selection.spec.ts`, **L2, M, ir**.
      Click a table cell (materializes `#fix-table-ir-wrapper`), move caret to **prose**
      (Ctrl+A inside a PRE is block-scoped — fixBrowserBehavior.ts:966), Ctrl+A + Delete +
      type `x` → getValue()==='x', no wrapper/`data-vmarkd-trailing` junk. Plus S case:
      Ctrl+A inside a code block selects only the block (ir + wysiwyg).
- [x] **P0-13 ✅ Image paste → upload wire (L2)** — `media-src/e2e/paste-upload.spec.ts` (new),
      **L2, M, ir**. Synthetic paste with a real PNG `File` and empty text/html → exactly one
      `{command:'upload'}` with webp base64 + `YYYYMMDD_HHMMSS_name.webp`; synthetic
      `uploaded` reply → `![](assets/x.webp)` inserted (+`<audio>` for .wav); two files → two
      entries. *Caveat: main.ts:509-539/774-784 handlers are inline — extract them (§6.4) or
      accept the harness tests a wiring copy; L3 is the real-wire proof.*
- [x] **P0-14 ✅ Image upload real wire (L3)** — `test/vscode-e2e/image-upload-wire.spec.ts`
      (new), **L3, M** — **re-opens the task-190 P1 deferral**: an in-frame synthetic
      files-paste dispatched in `frame.evaluate` avoids the OS-clipboard flake the deferral
      feared → file written under `image.saveFolder`, markdown link inserted in the saved doc.
- [x] **P0-15 ✅ Task checkbox click** — `media-src/e2e/list.spec.ts` (extend), **L2, S,
      ir/wysiwyg/preview** — **extends the task-190 §5 checkbox probe**. Real
      `locator.click()` on the rendered checkbox → getValue flips `- [ ]` ↔ `- [x]`, exactly
      one edit post per toggle (preventInput path, ir/index.ts:113-123); in preview the input
      is `disabled` and clicking is inert. (L3 leg stays a probe — Probe-21.)
- [x] **P0-16 ✅ One paste = one undo step** (proven at L3 in P0-6) (→ folded into P0-6 L3; L2 synthetic paste cannot populate the undo stack) — `paste-pipeline.spec.ts`, **L2, S, ir
      (+mode-aware)**. 3-block paste → single Ctrl+Z restores baseline, Ctrl+Y reinstates;
      input-signal count is mode-sensitive (wysiwyg defers past `undoDelay`, sv synchronous)
      — the counter must wait accordingly.

### P1 — medium risk (NETs)

- [ ] **P1-1 WYSIWYG popover battery** — `media-src/e2e/wysiwyg-popover.spec.ts` (new),
      **L2, L, wysiwyg** — highest-value dark surface (zero coverage of the primary wysiwyg
      mouse-editing UI, highlightToolbarWYSIWYG.ts:540/987/1075/880-955). Table popover
      align/insert/delete round-trip; link href input updates markdown; click a **plain
      markdown** `<img>` (not one inside `__preview` — wysiwyg/index.ts:428-429) → src/alt
      edits round-trip; 🗑 on a heading updates value+TOC; ∧/∨ reorder serializes. Plus
      `test/vscode-e2e/wysiwyg-popover.spec.ts`, **L3, M**: popover positioned over the block
      (not 0,0) under injected CSS; href edit persists to disk.
- [x] **P1-2 ✅ Toolbar formatting battery** — `media-src/e2e/toolbar-selection.spec.ts` (new),
      **L2, M, ir+sv**. IR: drag-select word → bold wraps `**word**` (ir/process.ts:149-215),
      click again un-wraps (:117-148); italic/strike/inline-code; list/ordered/check via
      `listToggle`; table button — expect `col1` + selection **concatenated**
      (Options.ts:339-345). sv: select in source pane → bold → `**text**` + right pane
      re-renders (processToolbarSV, zero coverage today).
- [ ] **P1-3 Real-webview toolbar actions** — `test/vscode-e2e/toolbar-actions.spec.ts` (new),
      **L3, M, ir+preview**. (a) Triple-click a line + real Bold click → `**` in the document
      + selection survives (webview-iframe focus semantics), Ctrl+S persists; (b) scroll-guard
      in the real webview: wheel to bottom without caret, click bold → scroller stays within
      50px over 800ms (the original webview-only bug; `scrolljump.spec.ts:83-87` documents
      that the harness can't prove it); (c) preview toggle: EDIT_TOOLBARS get `--disabled`
      and bold-click is a no-op in Preview, panels hidden on entry, exit re-enables, doc
      unchanged; sv display branch (Preview.ts:24-41).
- [ ] **P1-4 Mode-switch persistence + race** — `test/vscode-e2e/mode-persist.spec.ts` (new),
      **L3, M** + `toolbar-selection.spec.ts` **L2, S**. L3: real two-step journey (click
      edit-mode trigger → panel visible → click `[data-mode=wysiwyg]`), wait >500ms,
      close+reopen the file → boots in wysiwyg; status-bar label flipped. L2: type a char,
      immediately switch ir→sv → the char is in the sv source (getMarkdown race).
- [ ] **P1-5 Click-to-edit caret landing** — `mouse-selection.spec.ts` **L2, S** +
      `test/vscode-e2e/mouse-selection.spec.ts` (new) **L3, M, ir+wysiwyg**. L2: real click on
      rendered IR code/math → `--expand` + selection inside `pre.vditor-ir__marker--pre`,
      getValue unchanged; wysiwyg padding-click → source opens, caret falls back to start, no
      throw (vmCkOffset=-1 branch). L3: click rendered code then a paragraph → expand
      collapses with no flash (patchIrBlurExpand — the blur/refocus only exists in the real
      webview); wysiwyg mid-line click → offset > start under real injected CSS.
- [ ] **P1-6 Callout click-to-enter** — `test/vscode-e2e/mouse-selection.spec.ts`, **L3, M,
      ir**. Real click on the rendered callout preview → `--expand` + caret inside the
      editable source **first**, type a char, **then** expect `data-callout-editing`
      (decorateCallout is mutation-driven — asserting both immediately flakes); getValue
      round-trips.
- [ ] **P1-7 Link policy: preview/sv + caret-in-anchor** — `media-src/e2e/link.spec.ts`
      (extend), **L2, M, preview/sv/wysiwyg**. Extend the mode loop (link-harness already
      accepts `?mode=sv`): plain click on `<a>` posts nothing, Ctrl+click posts exactly one
      open-link — including when the target is a `<strong>` child (only our
      `closest('a[href]')` catches it; pins the double-post seam); sv source markers post
      nothing. One-liner: real click mid-anchor in wysiwyg → no post AND caret inside the
      `<a>` text.
- [ ] **P1-8 Toolbar dropdown dismiss + more-submenu** — `media-src/e2e/toolbar-dismiss.spec.ts`
      (new), **L2, M, all**. Open `…`/headings/edit-mode panels by real click, mousedown on
      the editor → panel `display:none` (primary signal — triggers never carry `--current`,
      setToolbar.ts:109-111); scoping: IR fix-table panel and the `[[` hint untouched; owner
      re-click toggles once. Same spec: `…` → About vMarkd tip content, Settings →
      `open-settings` posted.
- [ ] **P1-9 IR table panel L3 + align tracking** — `test/vscode-e2e/table-panel.spec.ts`
      (new), **L3, M** — **un-defers the task-190 table-panel L3 leg** with the two angles
      that plan didn't weigh: panel positioning under injected CSS, and whether the synthetic
      Ctrl+Shift hotkeys leak to real VS Code keybindings (fix-table-ir.ts:148-153 —
      only observable in L3); insertColumnR/deleteRow → Ctrl+S persists. L2 extend
      (`table-hotkey.spec.ts`, S): clicking between differently-aligned columns moves
      `vditor-icon--current` (markAlignCurrent per-cell, fix-table-ir.ts:194-196).
- [ ] **P1-10 Hint menus by mouse** — `media-src/e2e/hint-menus.spec.ts` (new), **L2, M,
      ir (+wysiwyg)**. Fence language field: type `pyth` → click `python` → ```` ```python ````
      round-trips (fillEmoji code-block-info branch, hint/index.ts:135-150); `:smile` hint
      click + emoji toolbar panel (two distinct insert paths, one Spin-based); run both boot
      shapes (wiki hint on/off — main.ts:346-386).
- [ ] **P1-11 Callout popover controls L3** — `test/vscode-e2e/callout-popover.spec.ts` (new),
      **L3, M, wysiwyg**. `selectOption('warning')` on the injected type select →
      `[!WARNING]` in the document and on disk after Ctrl+S; title input → marker line
      updated (a native `<select>` inside the webview iframe is exactly what L2 can't prove).
- [x] **P1-12 ✅ Paste code-detection via real event** — `paste-pipeline.spec.ts`, **L2, S,
      ir/wysiwyg/sv**. **Corrected payload**: single `<pre><code>` HTML (or code-looking
      multi-line text) — the shipped patchProcessCode deleted the monospace-div heuristic,
      and the single-line→inline-code case is dead post-patch (drop it). Assert the ir/sv
      raw-fence insertHTML is promoted to a real fence by the post-paste spin (ir/index.ts:73,
      :1479-1493).
- [x] **P1-13 ✅ Pasted diagram fence renders immediately** — `paste-pipeline.spec.ts`, **L2, S,
      ir**. Paste a ```` ```mermaid ```` fence → `.vditor-ir__preview` gains `<svg>` promptly
      (paste loop bypasses the edit-activity defer gate — patchIrDeferDiagramRender anchors
      only ir/input.ts) and the fence round-trips.
- [x] **P1-14 ✅ Paste into table cell** — `paste-pipeline.spec.ts`, **L2, S, ir+wysiwyg**.
      Single-line paste stays in the cell (row/col counts unchanged); multi-block paste → pin
      placement after the table, table still parses, caret NOT at document top (EOF-caret-jump
      class with `#fix-table-ir-wrapper` in the block chain).
- [x] **P1-15 ✅ Copy→paste round-trip (torture)** — `paste-pipeline.spec.ts`, **L2, M, ir**
      (scoped — IR copy handler only). For each interesting block of the torture fixture:
      real copy event, capture text/plain, re-dispatch as paste at EOF → appended markdown
      equals the copied text (± trailing newline); pin Lute's output for table-row/fence if
      not byte-equal.
- [ ] **P1-16 sv paste updates split preview** — `test/vscode-e2e/sv-split.spec.ts` (extend),
      **L3, S, sv**. Clipboard `## Pasted\n\n<!-- hidden -->` + Ctrl+V in the left pane →
      right pane gains the `<h2>`, comment invisible, pre-existing diagram DOM node identity
      preserved (task-187 morph).
- [x] **P1-17 ✅ Image file drop** — `media-src/e2e/dragdrop.spec.ts` (new), **L2, M, ir** —
      **merges with the task-190 §5 drop probe**. Dispatch drop with a PNG `File` → one
      `upload` post (webp-renamed); synthetic `uploaded` → `![](path)` (Files branch reached
      only when text/html is empty — fixBrowserBehavior.ts:1432).
- [x] **P1-18 ✅ Upload-name sanitize (fix + test)** — `media-src/src/upload-name.test.ts` +
      `test/backend/image-upload.test.ts` (extend), **L1, S**. Hand-verified bugs (§0):
      missing `/g` in the name sanitize (main.ts:527-530) and unsanitized host-side join
      (extension.ts:772). Extract `sanitizeUploadName`; pin multi-run replacement and that
      interior `/..` segments (`ts_.._../evil.png`) cannot escape the assets folder.
- [x] **P1-19 ✅ sv source-pane copy** — `copy-cut.spec.ts`, **L2, S, sv**. Drag-select two
      lines incl. `## ` → text/plain verbatim source, text/html `''` (sv/index.ts:42-46).
- [ ] **P1-20 Preview copy + copy-button payload** — `media-src/e2e/preview-copy.spec.ts`
      (new), **L2, M, preview+sv**. Grant clipboard permissions and use **real Ctrl+C / real
      click + `navigator.clipboard.read()`** — the preview handler and the copy button use
      `execCommand`, a stubbed DataTransfer captures nothing. Assert rendered text/plain
      (no `#` markers), tip shows "Copied to clipboard"; copy-button yields exactly the code
      (no line-number digits). *Caveat: L2 has no CSP — real-webview truth is Probe-3.*

### P2 — low / nice-to-have (NETs)

- [ ] Math whole-element copy — `copy-cut.spec.ts`, L2 S, ir+preview: partial selection inside
      KaTeX → text/plain = full TeX source, text/html contains `katex` (mathRender.ts:68-75).
- [ ] Table copy — `copy-cut.spec.ts`/`preview-copy.spec.ts`, L2 S: whole rendered table →
      valid pipe table; preview selection → text/html contains `<table`.
- [ ] Outline drag-resize — `outline.spec.ts` (extend), L2 S: mouse drag → `--me-outline-width`
      follows, clamps [100px, 50vw], one `save-outline-width` with the **offsetWidth** value.
      *Harness fixes needed: recording `onResize` (currently a no-op, outline-harness.ts:38) +
      position param ('right' hardcoded).*
- [ ] Scroll-to-heading handler — extract `handleScrollToHeading` from main.ts:789-800
      (module-private, unreachable from the harness), then L2 NET S: message → Nth heading
      flash + scroll; sv outline-item click case.
- [ ] Selection survival — `wysiwyg-highlight.spec.ts` (extend), L2 S: non-collapsed selection
      survives re-highlight both-ends (must invalidate `__vmcsText`); `mouse-selection.spec.ts`
      S: drag selection + `preserveCaretAndScroll(setValue)` → collapse-to-start pinned as
      coded semantics.
- [ ] Diagram selection atomicity + pan-click swallow — `mouse-selection.spec.ts` L2 S: drag
      across a diagram selects both paragraphs, no SVG label text; `diagram-inline-zoom.spec.ts`
      (extend) L3 M: Ctrl+drag pan then release → following click swallowed, no `--expand`
      (diagram-zoom.ts:148-158).
- [ ] Shift+click selection extension — `mouse-selection.spec.ts`, L2 S (deferred expandMarker
      with mouse-placed endpoints).
- [ ] IR image click selects URL marker — `mouse-selection.spec.ts`, L2 S (ir/index.ts:146-153);
      the wysiwyg IMG popover is covered by P1-1.
- [ ] sv 'both' toggle — `sv-split.spec.ts` (extend), L3 S: journey is `…` submenu → both (not
      a top-level button); preview hides/returns with real content; hidden outside sv.
- [ ] Toolbar undo/redo buttons + `--disabled` sync; insert-before/after buttons —
      `toolbar-selection.spec.ts`, L2 S each (zero references anywhere today).
- [ ] STL Ctrl-orbit gate — `stl-material.spec.ts` (extend), L3 S. *Blocked on a small product
      change: mirror orbit/camera state onto `canvas.dataset` (no assertable state today;
      WebGL may be absent headless — guard).*
- [ ] Upload toolbar file input — `webview-behaviors.spec.ts` (extend), L2 M: `setInputFiles` →
      `upload` message (same harness-wiring caveat as P0-13).
- [ ] ~~fixPanelHover delayed collapse~~ (dead code, removed 2026-10-07: the panel is created lazily after it ran);
      `info` About-Vditor dialog; preview ToC click; toolbar
      `--current` state on drag selection — S each, batch opportunistically.

## 4. Probes — suspected-broken / dark paths (most severe first)

Run each as a cheap throwaway first; fix, then promote to a NET.

1. **Image overlay CSP brick** — `test/vscode-e2e/preview-widgets.spec.ts` (new), L3 M,
   ir/wysiwyg/sv/preview. Dblclick an IMG (single click in preview/sv-right) → `.vditor-img`
   overlay opens but both close paths are inline `onclick`, dead under the CSP (§0), body
   scroll locked → editor unusable. **Expected FAIL**; fix = `image.isPreview:false` or
   rewire; then NET. L3-only (harness has no CSP).
2. **Paste inline-code null-deref → silent desync** — `paste-pipeline.spec.ts`, L2 S, wysiwyg
   (+ir variant). Paste into inline code in the LAST block → TypeError at
   fixBrowserBehavior.ts:1395 after the splice, before execAfterRender: DOM shows text the
   host never receives. Assert pageerror + divergence; pin desired behaviour.
3. **Code copy-button CSP-dead** — `preview-widgets.spec.ts`, L3 M, **all modes** (codeRender
   injects buttons in ir/wysiwyg preview panels too — processCode.ts:96). Click → clipboard
   via `vscode.env`; expected FAIL + CSP console violation.
4. **text/plain-only drop desync** — `dragdrop.spec.ts`, L2 S — **extends the task-190 §5 drop
   probe with a corrected premise**. Split proof: drop with only text/plain is not
   defaultPrevented (editorCommonEvent.ts:64-77); `insertFromDrop` input is discarded → NO
   edit posted (ir/index.ts:94-96). Flip to NET when fixed.
5. **Internal text drag-move** — `dragdrop.spec.ts`, L2 M, ir/wysiwyg/sv. Drag a
   bold+link/wiki-chip selection into another block → getValue must be clean markdown, one
   edit posted (Vditor skips the spin for drag inputTypes). *Caveat: if a synthetic mouse drag
   doesn't trigger native DnD, fall back to dispatched dragstart/drop + InputEvents.*
6. **Word RTF paste crash** — `paste-pipeline.spec.ts`, L2 S. text/rtf + `<img src="http…">`
   (NOT data:, Sanitize may strip it) → whole paste swallowed (`base64ToLink` unset yet
   awaited, :1407 vs :1556-1559); assert unhandledrejection.
7. **Bare-editor click caret teleport** — `table-hotkey.spec.ts` (extend), L2 M, ir. After a
   cell click the 0×0 wrapper is `lastElementChild` at top:0 → any gutter click appends an
   EOF `<p>` + teleports (ir/index.ts:165-178). Pair with the NET: click below the last block
   reuses one EOF paragraph (no accumulation).
8. **Select-all copy injected-DOM leak** — `copy-cut.spec.ts`, L2 M, ir (+wysiwyg minus table
   panel). Fixture with table+callout+mermaid+chip+hljs; Ctrl+A copy → **trim-normalized**
   equality with getValue(). Fix if leaking = `data-render` tag the wrapper; probe becomes
   the net.
9. **SVG-internal selection copies empty** — `copy-cut.spec.ts`, L2 S, ir. Programmatic Range
   over a mermaid label + copy → expected `''` (Lute has no svg mapping); fix direction:
   fall back to `range.toString()`.
10. **IR caret-at-start on preview click** — `mouse-selection.spec.ts`, L2 S. Click line 3 of
    a rendered code block → offset ≈ 0 (no IR port of patchWysiwygCodeClickCaret exists).
    Expected fail = acceptance test for the port.
11. **Callout multi-paragraph caret landing** — `callout-ir.spec.ts` (extend), L2 S. Click the
    FIRST body line → caret lands at start of the LAST source `<p>` (preview appended last);
    pin as UX-fix candidate.
12. **selectionchange endpoint mutation** — `gap.spec.ts` (extend), L2 M+S. Non-collapsed
    selection **ending** inside a `--- `/gap paragraph → is it promoted/removed under the
    selection? Four start-only sites (gap-paragraph.ts:480, :248-249; promote/cleanup;
    callouts.ts anchorNode). Use programmatic selection + dispatched selectionchange.
13. **Whole-fence wysiwyg copy loses ```** — `copy-cut.spec.ts`, L2 S. Both endpoints INSIDE
    the code element (the branch requirement) → raw code without fence; document or fix.
14. **sv copy clipboard clobber** — `copy-cut.spec.ts`, L2 S. Collapsed-caret Ctrl+C in sv
    setData('') unconditionally; straddle selection → `''` via getSelectText. Silent clipboard
    destruction.
15. **Collapsed cut = stealth backspace** — `copy-cut.spec.ts`, L2 S. Ctrl+X with no selection
    deletes the char before the caret (cutEvent runs delete unconditionally).
16. **Cut multi-block incremental drift** — `copy-cut.spec.ts`, L2 M. Large doc above the
    block gate: cut multi-block, flush → posted markdown === getValue() (drift audit silent).
17. **Non-image file drop → `![](x.pdf)`** — `dragdrop.spec.ts`, L2 S. No `upload.accept`
    anywhere; a PDF uploads and inserts image syntax. Product decision pending (link vs
    reject) before NET.
18. **Browser-image paste keeps remote URL** — `paste-upload.spec.ts`, L2 S. text/html+File →
    HTML branch wins, no upload posted; pins routing until the localization decision.
19. **Preview copy payload leaks** — `preview-copy.spec.ts`, L2 M. Cross-code-block+chip
    selection → text/plain contains ZWSP (codeRender.ts:58), text/html contains
    `vditor-copy`/chip span markup. Expected fail per code reading.
20. **Table partial selections** — `copy-cut.spec.ts` / `mouse-selection.spec.ts`, L2 M.
    Two-cell copy payload (programmatic Range across td) and drag-across-cells + type → pin;
    assert non-crash + table still parses.
21. **Checkbox L3 real-click artifact** — small L3 spec, S. The tracked question from
    `list-ops.spec.ts:8-11`: does a REAL click also collapse getValue in the headless
    harness? Then `[x]` → Ctrl+S → disk.
22. **Middle-click experiments** — `test/vscode-e2e/middle-click.spec.ts` (new), L3 M,
    EXPERIMENT, timeboxed. (a) drag-select sets X11 PRIMARY, middle-click elsewhere →
    inserted exactly once + edit posted, or record N/A (`test.fixme` if PRIMARY is inert
    under xvfb); (b) middle-click an `<a>` → panel not navigated, no open-link. Never in a
    smoke battery.
23. **Contextmenu passthrough** — L2 (`mouse-selection.spec.ts`) + one L3 assert, S.
    Cancelable contextmenu over prose/mermaid/gated markmap → `defaultPrevented === false`
    (no listener exists anywhere; guards a future gate from killing the native menu). Spec
    header must note: keyboard/synthetic clipboard tests stand proxy for native-menu
    Copy/Cut/Paste — the native menu itself is not drivable by Playwright.
24. **Drop onto read-only panes** — `preview-widgets.spec.ts`, L3 S. No dragover/drop
    preventDefault on `.vditor-preview` → does a Files drop navigate the webview?
    Real-VS-Code-only class.
25. **Gated-diagram plain click caret** — `mouse-selection.spec.ts`, L2 S. The gate stops
    propagation but not default → click still bubbles, preview branch fires anyway; pin where
    the caret goes.
26. **Large-paste perf budget** — `media-src/e2e/paste-perf.spec.ts` (new), L2 M, ir/sv.
    300 KB paste < N s + next keystroke < 500 ms; non-CI, init-bench treatment.
27. **Toolbar disabled-in-code-block** — `toolbar-selection.spec.ts`, L2 S. Caret in fence →
    bold/link/table carry `--disabled`, clicks are no-ops (highlightToolbarIR).

**Dropped** (verified keep=false): copy-as-html tests (dead route — task-190 amendment only);
drag-select edge autoscroll (manual checklist); wysiwyg code-click L2 happy path,
toolbar-format headline, link caret-policy bulk, preview-button entry path,
showToolbar=false — all already covered; only the refinements above were kept.

## 5. Infrastructure

1. **Fix the RED L2 gate first** ✅ DONE — `webview-behaviors.spec.ts` was **9/24 failing**
   (hand-verified, §0): task 185 moved `handleToolbarClick`/`saveVditorOptions` (and friends)
   out of `utils.ts` but `behaviors-harness.ts` still exposed only `utils`, and the specs
   asserted the pre-allow-list payload. Rewired against `toolbar-actions.ts` + the other moved
   homes, deleted the dead `confirm()` tests, updated to the `{mode}`-only allow-list contract,
   and added the capture-persist-with-real-stopPropagation check. Now **23/23** (see §0 Progress).
2. **One canonical mouse-ops fixture + harness** ✅ DONE — built a DEDICATED `mouseops-harness.ts`
   (registered; meta-test green) rather than extending keybugs (keeps the repo's one-harness-per-
   concern pattern; keybugs stays focused on keydown repros). Real Vditor from source, `?mode=`,
   with `patchLuteSerialize` + custom wiki renderer + `fixCut` + a posted-message recorder
   (save-flush pattern) + a canonical `__torture` value. `test/vscode-e2e/fixtures/torture.md`
   remains the L3 fixture.
3. **Shared helpers** ✅ (core set) — `mouseops-helpers.ts`: `gotoMouseops`, `setDoc`,
   `selectAllContent`/`selectWithin`/`collapseCaret`, `syntheticClipboard(copy|cut)`
   (ClipboardEvent+DataTransfer in evaluate, UNSET sentinels), `tripleClick`, `posted`/
   `editPosts`/`getValue`. Still to add as later specs need them: `dragSelect` (real
   mouse.down/move/up), `readRealClipboard` (preview + copy-button — the execCommand path
   ignores stubs), mode-aware `editPostCount` waits.
4. **Extract for testability** (small refactors, each unblocks P0/P1 items):
   `sanitizeUploadName` + the upload handler + `handleUploaded` out of main.ts:509-539/774-784;
   `handleScrollToHeading` → outline.ts export; outline harness recording `onResize` +
   position param; STL orbit state onto `canvas.dataset`.
5. **tasks/190 amendments** (keep 190 the umbrella source of truth): repoint `paste-html.spec`
   → consolidated `paste-pipeline.spec.ts`, PROBE/S→NET/M (P0-7); annotate copy-html
   (190 §5/§7 J42) as unreachable — zero webview senders exist; resurrect a toolbar item or
   delete protocol.ts:153-154 + extension.ts:628-645 + the backend test; re-open the
   image-upload-wire deferral with the in-frame-synthetic rationale (P0-14); correct the §5
   drop-probe premise — there is NO type filter, PDFs upload and insert `![]()` (Probe-17);
   refine the checkbox probe → real-click L2 (P0-15).
6. **Product decisions gating probe→NET promotion**: non-image drop handling; remote-image
   localization on paste; preview link-click asymmetry (wiki plain vs `<a>` Ctrl); IR
   clicked-position caret port; copy-as-html resurrect-vs-delete; CSP fixes
   (`image.isPreview:false`, copy-button rewire/hide).
7. **Experiments & manual checklist**: middle-click PRIMARY under xvfb (timeboxed L3);
   OS-level file drag over the custom editor (not synthesizable — one manual check decides if
   the drag-drop journey is even reachable); drag-edge autoscroll (manual only).

## 6. Sequencing

1. **Infra-1 first** (fix the 9 red `webview-behaviors` tests) — the L2 gate must be green
   before any new L2 spec lands on top of it.
2. **Infra-2/3** (harness + fixture + helpers) with the first P0 batch — `copy-cut.spec.ts`
   (P0-1..3) and `paste-pipeline.spec.ts` (P0-5, 7, 8, 9, 16) share them.
3. **P0 batch 2** — `mouse-selection.spec.ts` (P0-10..12) + checkbox (P0-15).
4. **P0 batch 3 (L3 wire)** — `copy-clipboard.spec.ts` (P0-4), `paste-real.spec.ts` (P0-6),
   image upload (P0-13/14 + the P1-18 sanitize fix folded in, since it touches the same code).
5. **Severe probes opportunistically** — Probe-1/2/3 (CSP + paste desync) are cheap and may
   surface real user-facing breakage worth fixing before the P1 batteries.
6. **P1 batteries** (wysiwyg-popover, toolbar-selection, dismiss, hints, table L3) in any
   order; P2 batched opportunistically when a neighbouring spec is touched.
