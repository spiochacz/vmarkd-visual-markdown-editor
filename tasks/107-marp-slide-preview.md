# Task 107 — Marp slide preview (split deck + slide-card editor overlay)

> **Status:** 🟢 Phase 1 DONE (2026-06-13) — see "Phase 1 — DONE" below. Design from brainstorming
> session. **Phase 1 only**
> (this file): live read-only Marp deck in a right split panel + per-slide "card" overlay in the
> IR/WYSIWYG editor. **No export, no PDF/PPTX, no per-slide WYSIWYG editing, no math** — those are
> Phases 2–3 (sketched at the bottom).
> **Source:** user request; Marp ecosystem (`@marp-team/*`) parity survey.
> **Value / Risk:** 🟢 high (presentations are a major Markdown use-case) / 🟡 medium — second
> render pipeline + editor overlay; mitigated by keeping the deck read-only and the overlay
> non-editable (zero source mutation, round-trip safe).

## The core insight (why Marp ≠ mermaid/echarts/callouts)

Mermaid/echarts/callouts are **block renderers** — one fence → one widget *inside* the document.
**Marp is document-level**: the whole file is a slide deck. Frontmatter `marp: true` turns it on,
and a top-level `---` (normally `<hr>`) becomes a **slide break**. Per-slide directives live in HTML
comments (`<!-- _class: lead -->`, `<!-- paginate: true -->`). So Marp is a *mode*, not a fence.

Marp Core is **markdown-it based**, not Lute/Vditor. The live deck is therefore a **second,
independent render of the same source text** — not a transform of Vditor's DOM. Consequence: the
deck is **read-only output**; the markdown text stays the single source of truth. This is exactly
how the official `@marp-team/marp-vscode` works (it replaces the preview renderer wholesale).

## Phase 1 scope & decisions (locked in brainstorming)

1. **Activation — per-document, zero cost when off.** Host parses frontmatter; if `marp: true`,
   set `marp.enabled` in the `init` message (extend the options blob in
   `src/extension.ts` / `media-src/src/vditor-options.ts`). Only then does the webview **lazy-load**
   the Marp renderer and show a "Marp" toggle in the toolbar. Plain MD docs: no Marp UI, renderer
   never loaded. Default: panel **open** when `marp:true` (you opened a deck → show it), collapsible.

2. **Render — scoped CSS, no Shadow DOM.** New `media-src/src/marp-preview.ts`:
   `new Marp({ container: <div.marpit-deck>, math: false })` → `marp.render(source)` → `{ html, css }`.
   Pass `container` so Marpit **scopes theme CSS under the container class** (the marp-vscode
   mechanism — chosen over Shadow DOM and over relaxing CSP for an iframe). Inject `css` into a
   `<style>` in the panel; `html` into the container. **Re-render on edit** by subscribing to the
   existing debounced `edit` signal in `main.ts` — do **not** add a new debounce mechanism.

3. **Build — npm devDependency + lazy esbuild chunk (⚠️ diverges from the vendor/sha256 pattern).**
   Unlike mermaid/echarts, `@marp-team/marp-core` is **not** shipped as a single UMD `.min.js`, so the
   "fetch prebuilt + pin sha256" model (`fetch-mermaid.mjs` etc.) does **not** apply. Add
   `@marp-team/marp-core` as an npm **devDependency** and have esbuild bundle it as a **separate
   lazy-loaded chunk** (`media/dist/marp.js`) so `main.js` is **not** bloated for non-Marp docs. Pin
   via `package-lock.json`. Still plain node+npm (no niche tooling) — but it's the one spot that
   breaks the `vendor/<lib>/source.json` convention; documented on purpose. Wire the chunk in
   `media-src/esbuild-shared.mjs` (new entry point, code-split / dynamic `import()`), CSP-clean
   (script via nonce, style via `style-src 'unsafe-inline'`; **no iframe**).

4. **Layout — right split panel.** Resizable splitter; Vditor stays on the **left** in its current
   mode (IR/SV/source). Deck panel: vertical scroll of `<section>`s scaled to panel width (16:9 from
   theme). CSS in `media-src/src/main.css`; panel container markup built in JS (or
   `src/html-builder.ts`). `---` stays `<hr>` in source mode — fine.

5. **Theming — render exactly as Marp would for export.** Honor the deck's `theme:` directive
   (default/gaia/uncover/custom). **Do NOT** apply vmarkd's dark/light pairing to the deck — that
   would diverge the preview from the eventual export. Slide background = Marp's; independent of the
   VS Code theme. (The gutter *around* slides may follow the VS Code theme.)

6. **Sync — deliberately minimal in P1.** Highlight the active slide computed from the count of
   top-level `---` before the caret (cheap, robust). Smooth bidirectional scroll-sync (line mapping)
   is a later increment.

7. **Slide-card editor overlay — IR + WYSIWYG only, NOT source.** In the editor each Marp slide
   reads as a framed **card** (subtle border/tint, `╭─ Slide N ─╮`). Implementation constraint: CSS
   cannot group a run of siblings between `<hr>`s, and **injecting wrapper `<div>`s into the
   contenteditable tree is rejected** — Lute could serialize them as HTML blocks and it endangers the
   round-trip + caret model (that's the Phase-3 danger zone). Instead use an **overlay layer**: a
   non-editable element (`pointer-events:none`, behind the text) that **measures `<hr>` positions and
   draws the card frames**. The editable DOM is **untouched → round-trip 100% safe** (source stays
   plain `---`). Recompute on `MutationObserver` + `ResizeObserver`. Marpit splits on top-level `<hr>`,
   so decorating every top-level `<hr>` (only when `marp.enabled`) matches how Marp really cuts the
   deck; slide numbers come from `<hr>` index. **Mount the overlay only for the active IR/WYSIWYG
   mode element** (reuse `activeModeElement(vditor)` + the observer-teardown pattern from
   `callouts.ts` / `code-source.ts`); in **source mode** show raw markdown, no overlay. Known cost:
   reflow on edit/resize, possible minor alignment jitter.

## Phase 1 — DONE (2026-06-13)

Implemented: lazy `marp-core` chunk, `marp: true` detection, read-only deck in a collapsible
right panel + draggable splitter, slide-card overlay (IR/WYSIWYG), caret→slide highlight/scroll,
click-slide→source nav. See `docs/superpowers/specs/2026-06-12-marp-split-panel-design.md` and
`docs/superpowers/plans/2026-06-13-marp-presentation-phase1.md`. Phases 2 (export) and 3 (per-slide
WYSIWYG) remain out of scope.

## Files (Phase 1)

| Purpose | File | Status |
|---|---|---|
| Marp render + scoped inject + lazy-load | `media-src/src/marp-preview.ts` | new |
| Slide-card overlay (measure `<hr>`, draw frames, observers) | `media-src/src/marp-slide-overlay.ts` | new |
| Frontmatter `marp: true` detection | `src/extension.ts` (or small helper) | edit |
| Pass `marp.enabled` into init options | `media-src/src/vditor-options.ts` | edit |
| Wire toggle, panel, edit re-render, mode-aware overlay mount | `media-src/src/main.ts` | edit |
| Split layout, splitter, panel, card frame CSS | `media-src/src/main.css` | edit |
| Lazy `marp.js` chunk / dynamic import | `media-src/esbuild-shared.mjs` | edit |
| `@marp-team/marp-core` devDependency | `package.json` | edit |
| Panel container markup (if not JS-built) | `src/html-builder.ts` | maybe |

## Tests (per AGENTS)

- **e2e** (mandatory webview harness) — `media-src/e2e/marp-{harness.ts,html,spec.ts}`:
  - a `marp:true` doc renders **N** `<section>` slides in the panel;
  - **scoped CSS does NOT leak** onto `.vditor-reset` / `.markdown-body` (assert a known Marp
    selector doesn't restyle editor chrome);
  - editing the source **re-renders** the deck;
  - a **non-Marp** doc shows **no** panel and never loads `marp.js`;
  - the **slide-card overlay** appears in IR/WYSIWYG (N cards for N−1 `---`) and is **absent in
    source mode**; editor text/caret unaffected; **round-trip** of `---` unchanged.
- **backend** — `test/backend/marp-detect.test.ts`: `marp: true` frontmatter detection (true/false/
  absent/whitespace variants).

## Phase 2 — export (separate task)

- **HTML export** first (cheap): `marp-core` in the webview already yields standalone HTML+CSS — no
  Chromium. **PDF/PPTX/PNG** via host-side `@marp-team/marp-cli`, **detected, not bundled** (use a
  user-installed `marp` / `npx @marp-team/marp-cli`); optional fallback: delegate to the official
  Marp extension if installed.
- **Math** (KaTeX) — flip `math` on; vendor/bundle KaTeX assets + theme webfonts (CSP `font-src`).

## Phase 3 — per-slide WYSIWYG editing (separate task, highest risk)

- Edit each slide as its own WYSIWYG region, `---` as a real slide boundary, re-stitch slides with
  `---` + preserve per-slide directive comments. Round-trip integrity is the hard part — only after
  P1/P2 prove out the slide model.

## See also

- Skill `vmarkd-renderer-theming` (renderer application models, IR dual-node gotchas, CSP/build
  pitfalls) — read before touching theme CSS or the overlay.
- Pattern refs: `media-src/src/callouts.ts` (attribute-only + observer + selection-driven editing
  state), `media-src/src/code-source.ts` (`activeModeElement` + observer teardown),
  `media-src/src/echarts-apply.ts` (lazy lib + post-render hook).
- [Marp](https://marp.app/), [`@marp-team/marp-core`](https://github.com/marp-team/marp-core),
  [`marp-vscode`](https://github.com/marp-team/marp-vscode) (scoped-CSS preview prior art).
