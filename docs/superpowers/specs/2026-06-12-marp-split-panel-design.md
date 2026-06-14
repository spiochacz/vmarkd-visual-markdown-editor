# Marp Split panel — design (task 107 Phase 1)

> **Status:** design, 2026-06-12. Supersedes/details the Phase-1 section of
> `tasks/107-marp-slide-preview.md` (the original brainstorm). Design only — no implementation yet.
> **Decisions below are locked** unless re-opened by the user.
> **Scope:** Phase 1 only — live read-only Marp deck in a right split panel + per-slide "card"
> overlay in IR/WYSIWYG + caret↔slide sync. **No** export/PDF/PPTX, **no** math (KaTeX), **no**
> per-slide WYSIWYG editing (Phases 2–3, sketched at the end).

## Goal

Author Marp presentations in vMarkd: the Markdown source on the left (any editor mode), a live
**read-only** Marp slide deck on the right. The deck is the user's previously-named "View Slider".

## Core insight (why Marp ≠ mermaid/echarts/callouts)

Mermaid/echarts/callouts are **block renderers** (one fence → one widget inside the document). **Marp
is document-level**: the whole file is a deck. `marp: true` frontmatter turns it on; a top-level
`---` (normally `<hr>`) becomes a **slide break**; per-slide directives live in HTML comments
(`<!-- _class: lead -->`). So Marp is a *mode*, not a fence.

`@marp-team/marp-core` is **markdown-it based, not Lute/Vditor**. The deck is therefore a **second,
independent render of the same source text** — not a transform of Vditor's DOM. Consequence: the deck
is **read-only output**; the Markdown text stays the single source of truth. (This is exactly how the
official `marp-vscode` works — it replaces the preview renderer wholesale.)

## Decisions

### Locked in the original brainstorm (task 107)

1. **Activation — per-document, zero cost when off.** Host parses frontmatter; if `marp: true`, set
   `marp.enabled` in the `init` message (extend the options blob in `src/extension.ts` /
   `media-src/src/vditor-options.ts`). Only then does the webview **lazy-load** the Marp renderer and
   show a "Marp" toggle. Plain MD docs: no Marp UI, renderer never loaded.
2. **Render — scoped CSS, no Shadow DOM, no iframe.** `new Marp({ container, math: false })` →
   `marp.render(source)` → `{ html, css }`. Passing `container` makes Marpit **scope the theme CSS
   under the container class** (the marp-vscode mechanism). Inject `css` into a `<style>` in the
   panel, `html` into the container. CSP-clean (script via nonce, style via `style-src
   'unsafe-inline'`).
3. **Theming — render exactly as Marp would for export.** Honor the deck's `theme:` directive
   (default/gaia/uncover/custom). **Do NOT** apply vMarkd's dark/light pairing to the deck (that would
   diverge the preview from a future export). Slide background = Marp's, independent of the VS Code
   theme. The gutter *around* the slides may follow the VS Code theme.
4. **Re-render on the existing debounced `edit` signal** in `main.ts` — do **not** add a new debounce.
5. **Card overlay is non-editable + measures `<hr>`** (see "Slide-card overlay") — the editable DOM is
   never mutated → round-trip 100% safe.
6. **Build — npm devDependency + lazy esbuild chunk** (see "Build & deps").

### Decided in this session

7. **Layout vs editor modes — separate panel; in `sv` the deck replaces Vditor's preview.** The Marp
   deck is a collapsible **right panel** beside IR/WYSIWYG/source. In `sv` mode (which already splits
   source|preview) the deck **replaces** Vditor's HTML preview (source | deck) to avoid a cramped
   three-column layout; reuse the task-48 scroll-sync wiring for that pane.
8. **Deck layout — vertical stack (scroll).** All slides stacked top-to-bottom, panel scrolls. (Not a
   one-slide carousel, not a thumbnail grid.)
9. **Caret → deck — auto-scroll + highlight.** As you edit, the deck auto-scrolls to the slide
   containing the caret and highlights it with a frame.
10. **Click a slide → caret (reverse-nav), in P1.** Clicking a slide in the deck scrolls the editor
    and places the caret at the start of that slide's source.
11. **Card overlay style — subtle.** A thin frame around each slide's content with the slide number in
    a corner (IR/WYSIWYG only).
12. **Defaults (decideable later):** panel split ≈ 50/50 with a draggable splitter and persisted width
    (mirrors `outline-resize.ts` persistence); panel **open** by default when `marp: true`; toggle
    "Marp" in the toolbar plus a command; render-failure shows a message inside the panel.

## Architecture & components

The deck is a **second render of the source**, not a DOM transform. Five isolated units:

| Unit | File | Responsibility |
|---|---|---|
| Marp render + scoped inject + lazy-load | `media-src/src/marp-preview.ts` (new) | `new Marp({container, math:false})` → `render(src)` → inject `{html,css}`; lazy `import()` of the marp chunk |
| Slide-card overlay | `media-src/src/marp-slide-overlay.ts` (new) | measure top-level `<hr>` positions, draw subtle card frames + numbers, recompute via observers |
| Slide↔source map | small helper (in `marp-preview.ts` or reuse `source-map.ts`) | map slide index ↔ source offset/line (count top-level `---`) for caret-sync + reverse-nav |
| `marp:true` detection | `src/extension.ts` (+ helper) | parse frontmatter, set `marp.enabled` in `init` |
| Wiring | `main.ts`, `vditor-options.ts`, `esbuild-shared.mjs`, `package.json`, `main.css` | toggle, panel/splitter, edit re-render, mode-aware overlay mount, lazy chunk |

**Data flow:** host parses frontmatter → `marp.enabled` in `init` → webview lazy-loads `marp.js` →
on each existing debounced `edit` signal, `marp.render(source)` → inject HTML+CSS into the panel →
recompute the slide↔source map → update active-slide highlight.

## Layout & UX

- **Right panel**, collapsible, with a draggable **splitter** (reuse the `outline-resize.ts` pattern;
  persist width like the outline width). Default split ≈ 50/50.
- **`sv` mode:** the deck **replaces** Vditor's preview pane (source | deck); reuse task-48
  heading-anchored scroll sync for the source side.
- **Toggle "Marp"** in the toolbar (+ a command), shown **only when `marp: true`**. Panel **open** by
  default when the doc is a deck; the open/closed + width state persists.
- **Plain MD docs:** no Marp UI; `marp.js` never loaded.
- **Deck:** vertical scroll of `<section>` slides scaled to panel width (16:9 from the theme). Active
  slide is framed; the deck auto-scrolls to keep the caret's slide in view.

## Render pipeline

`marp.render()` returns `{ html, css }`. `container` scopes the theme CSS under the container class so
the deck's theme **does not leak** onto `.vditor-reset` / `.markdown-body`. Inject `css` into a
`<style>` in the panel and `html` into the container. **No iframe, no Shadow DOM.** Re-render is
driven by the existing debounced `edit` signal — never a second debounce.

## Slide-card overlay (IR/WYSIWYG, round-trip-safe)

CSS cannot group a run of siblings between `<hr>`s, and **injecting wrapper `<div>`s into the
contenteditable tree is rejected** (Lute could serialize them as HTML blocks → breaks round-trip +
caret). Instead use an **overlay layer**: a non-editable element (`pointer-events:none`, behind the
text) that **measures top-level `<hr>` positions and draws subtle card frames + slide numbers**. The
editable DOM is untouched → round-trip 100% safe (source stays plain `---`). Recompute on
`MutationObserver` + `ResizeObserver`. Mount **only for the active IR/WYSIWYG mode element** (reuse
`activeModeElement(vditor)` + the observer-teardown pattern from `callouts.ts` / `code-source.ts`); in
source mode there is no overlay. Slide numbers come from the `<hr>` index. Known cost: reflow on
edit/resize, possible minor alignment jitter.

## Activation & sync

- **Activation:** `marp: true` frontmatter → `marp.enabled` in `init`. Otherwise the renderer is never
  loaded and no Marp UI appears.
- **Slide↔source map:** count top-level `---` to derive slide boundaries; map each slide index to its
  source line range (leverage the existing DOM↔source offset map in `source-map.ts`). This single map
  powers both sync directions.
- **Caret → deck (forward):** compute the active slide from the count of top-level `---` before the
  caret; highlight it and auto-scroll the deck to it.
- **Deck → caret (reverse, P1):** clicking a slide scrolls the editor and places the caret at the
  start of that slide's source via the map.
- Smooth, line-accurate bidirectional **scroll** sync (beyond active-slide) remains a later increment.

> Note: items 9–10 expand task 107's "deliberately minimal" P1 sync. Both are bounded by the same
> slide↔source map; no new heavy machinery.

## Build & deps

`@marp-team/marp-core` as an npm **devDependency** + a **lazy esbuild chunk** (`media/dist/marp.js`,
dynamic `import()`) so `main.js` is not bloated for non-Marp docs. ⚠️ This is the **one** spot that
breaks the `vendor/<lib>/source.json` + sha256 convention (marp-core ships no single UMD `.min.js`),
documented on purpose. Pin via `package-lock.json`. Still plain node + npm — no niche tooling. Wire the
chunk in `media-src/esbuild-shared.mjs`. CSP-clean (script via nonce, style via `style-src
'unsafe-inline'`; no iframe).

## Testing (per AGENTS)

- **e2e** — `media-src/e2e/marp-{harness.ts,html,spec.ts}`:
  - a `marp:true` doc renders **N** `<section>` slides in the panel;
  - **scoped CSS does NOT leak** onto `.vditor-reset` / `.markdown-body` (a known Marp selector does
    not restyle editor chrome);
  - editing the source **re-renders** the deck;
  - a **non-Marp** doc shows **no** panel and never loads `marp.js`;
  - the **slide-card overlay** appears in IR/WYSIWYG (N cards for N−1 `---`), is **absent in source
    mode**, leaves editor text/caret unaffected, and round-trips `---` unchanged;
  - **caret in slide K** highlights slide K in the deck; **clicking slide K** moves the caret into
    slide K's source.
- **backend** — `test/backend/marp-detect.test.ts`: `marp: true` frontmatter detection
  (true / false / absent / whitespace variants).

## Out of scope (later phases)

- **Phase 2 — export.** HTML export first (marp-core already yields standalone HTML+CSS, no Chromium);
  PDF/PPTX/PNG via host-side `@marp-team/marp-cli` **detected, not bundled**; optional fallback to the
  official Marp extension if installed. Math (KaTeX): flip `math` on, vendor KaTeX + webfonts (CSP
  `font-src`).
- **Phase 3 — per-slide WYSIWYG editing.** Edit each slide as its own WYSIWYG region, `---` as a real
  boundary, re-stitch with directive comments preserved. Round-trip integrity is the hard part.

## Risks / open questions

- **Overlay alignment jitter** on fast edits/resize (measuring `<hr>` positions) — accepted P1 cost;
  recompute is observer-driven.
- **`sv`-replace interaction** with the task-48 scroll-sync override — needs care so the sync targets
  the deck pane, not a removed Vditor preview.
- **Reverse-nav precision** depends on the slide↔source map staying correct across edits — covered by
  e2e.

## References

- `tasks/107-marp-slide-preview.md` (original brainstorm + Phase 2/3 sketches).
- Skill `vmarkd-renderer-theming` (renderer models, IR dual-node gotchas, CSP/build pitfalls).
- Pattern refs: `media-src/src/callouts.ts`, `media-src/src/code-source.ts`,
  `media-src/src/echarts-apply.ts`, `media-src/src/outline-resize.ts`, `media-src/src/source-map.ts`,
  `media-src/src/split-scroll-sync.ts` (task 48).
- [Marp](https://marp.app/), [`@marp-team/marp-core`](https://github.com/marp-team/marp-core),
  [`marp-vscode`](https://github.com/marp-team/marp-vscode).
