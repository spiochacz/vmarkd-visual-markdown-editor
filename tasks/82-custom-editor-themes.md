# Task: GitHub-style markdown rendering (light + dark)

> **Status:** ✅ Implemented (awaiting in-editor verify + publish). Setting
> `vmarkd.theme.content` (`auto` | `github-light` | `github-dark`, default `auto`).
> `auto` = the old VS Code-colour look (unchanged). The GitHub themes are the
> **unmodified upstream** github-markdown-css files (MIT), vendored verbatim under
> `media/markdown-themes/`; the webview ships both as `<link>` tags and enables one
> via `link.disabled` + the `markdown-body` class the CSS targets — no selector
> rewriting, no companion CSS, no build/regen step. **Toolbar/chrome always follows
> VS Code** (toolbar/border vars are unconditional in `main.css`, so they're
> mode-independent). The editor's light/dark **mode follows the GitHub content theme**
> (`effectiveThemeKind`: github-light → light, github-dark → dark, `auto` → VS Code) so
> the content — incl. **code blocks (hljs)** — is themed consistently, not VS
> Code-dark. For a GitHub theme the editing surfaces are transparent (the
> `body.markdown-body` canvas shows through) and the content font uses GitHub's system
> stack (VS Code editor font for `auto`). `useVscodeColors` removed (no migration).
> Unit (html-builder link/class + extension mode/config mapping) + e2e (canvas colour
> independent of VS Code theme, content font, toolbar-stays-VS-Code) covered; full
> suite green (554 unit / 187 e2e). README acknowledgement + DEVELOPMENT note added.
> **Source:** user request (2026-06-09) — render the markdown **exactly like
> GitHub** does, in both light and dark, as a selectable rendering theme. Found the
> canonical asset: `sindresorhus/github-markdown-css` (MIT) — CSS generated from
> GitHub's actual Primer renderer.
> **Scope note:** this is the **content/rendering** theme (how the rendered
> markdown looks — headings, text, links, blockquotes, tables, lists). It is NOT
> code-block syntax highlighting — `vmarkd.theme.code` (highlight.js) stays a
> separate, independent control.
> **Migration:** none. Few users so far — we replace the `useVscodeColors` boolean
> outright (drop it; no compat shim).
> **Value / Risk:** 🟢 high-visibility, exactly-asked-for / low — vendored CSS
> scoped to `.vditor-reset`, gated by a `data-*` attribute on the existing
> live-config path.
> **Engines:** none.

## Problem
The rendered-markdown look is a **boolean** today: `vmarkd.theme.useVscodeColors`
(`package.json` → `data-use-vscode-theme-color="1"` on `<body>` →
`media-src/src/main.css` remaps Vditor's colour vars / `.vditor-reset` rules to
`--vscode-*`). That makes the editor *match VS Code's editor colours*, but it does
**not** look like GitHub's markdown rendering (GitHub's typography, heading rules,
table/blockquote/code styling, link colours). The user wants the GitHub look,
light and dark.

Vditor's own content themes are minimal (`light`, `dark`, `wechat`, `ant-design`)
and none is GitHub-faithful, so we vendor a purpose-built stylesheet.

## The asset (researched)
**`sindresorhus/github-markdown-css`** — MIT, generated from GitHub's real Primer
markdown renderer. Provides `github-markdown-light.css`, `github-markdown-dark.css`
(+ `dark-dimmed`, `*-high-contrast`, `*-colorblind`) and an auto file using
`@media (prefers-color-scheme)`. Container class `.markdown-body`.

The files target a `.markdown-body` container. Rather than rewrite their selectors,
add that class to `<body>` while a GitHub theme is active — the upstream CSS then
styles the rendered content as-is.

Source: https://github.com/sindresorhus/github-markdown-css (MIT, the CSS files)

## Goal
Replace `vmarkd.theme.useVscodeColors` (boolean) with a rendering-theme dropdown
`vmarkd.theme.content`:
- `auto` (**default**) → **exactly today's behaviour** — match the VS Code editor
  colours via the existing `data-use-vscode-theme-color` / `--vscode-*` path
  (`main.css:13–83`). No visual change for current users.
- `github-light` → force GitHub light rendering, regardless of the VS Code theme.
- `github-dark` → force GitHub dark rendering, regardless of the VS Code theme.

(Future-easy additions, same pipeline: `github-dark-dimmed`, high-contrast,
colorblind variants. Non-GitHub palettes like Dracula/Nord would each need a
separate hand-authored stylesheet — out of scope here.)

Applies live (no reopen). Code-block syntax colours stay on `vmarkd.theme.code`.

## Themes
`auto` (VS Code colours) · `github-light` · `github-dark` (vendored github-markdown-css,
verbatim) · `material-dark` (One Dark/Material, adapted from raycon/vscode-markdown-style,
MIT — paired with `atom-one-dark` hljs). The set is data-driven: `CONTENT_THEME_FILES`
in `html-builder.ts` maps each value → a `.markdown-body` stylesheet; the webview
enables exactly one `ct-<value>` `<link>` via `link.disabled`. Add a theme = file +
`CONTENT_THEME_FILES` row + enum + (if fixed dark/light) `effectiveThemeKind` mode +
`codeHljsStyle` paired code style.

## Approach (as implemented)
1. **Vendor the files verbatim.** The unmodified upstream `github-markdown-light.css`
   and `github-markdown-dark.css` live under `media/markdown-themes/` (only a
   provenance comment prepended). No transform, no generation, no build step —
   update by copying newer upstream files. (`media/` ships in the `.vsix`; the dir
   is not in `.vscodeignore`.)
2. **Ship both, enable one.** `html-builder.ts` emits both as `<link>` tags
   (`gh-theme-light` / `gh-theme-dark`), all but the active one `disabled`, and adds
   the `markdown-body` class to `<body>` for a GitHub theme. The webview flips
   `link.disabled` + the class live in `applyContentTheme` (`live-config.ts`, called
   from `applyBodyOptions`). `auto` → both disabled, class absent.
3. **Manifest** (`package.json`, "Appearance"): `vmarkd.theme.content`
   (enum `["auto","github-light","github-dark"]`, `default: "auto"`).
   `vmarkd.theme.useVscodeColors` **removed** — `auto` subsumes it (no migration).
4. **Host** (`src/extension.ts`): `collectConfigOptions` sends `contentTheme` and
   derives `useVscodeThemeColor = contentTheme === 'auto'`. `effectiveThemeKind()`
   resolves the editor's light/dark MODE — github-light → light, github-dark → dark,
   `auto` → VS Code — used for init, `set-theme`, `config-changed`, and the teaser, so
   the content (incl. code blocks) is themed consistently. The toolbar's colours are
   mode-independent (always VS Code), so the bar stays VS Code-native.
5. **Chrome vs content** (`main.css`): the toolbar/resize vars (`--toolbar-*`,
   `--border-color`) are **unconditional** → the bar always follows VS Code. The
   content-surface vars (`--panel-/--textarea-background-color`, which back the
   editing panes AND dropdowns) stay under `data-use-vscode-theme-color` (auto). For
   a GitHub theme the editing surfaces (`.vditor-content/-ir/-wysiwyg/-sv/-preview`,
   `pre.vditor-reset`, `:focus`) are set `background: transparent` so the themed
   `body.markdown-body` canvas shows — for any github + any VS Code light/dark. The
   content **font** also switches: `body.markdown-body .vditor .vditor-reset` uses
   GitHub's system stack, else the VS Code editor font (task 43). Size still follows
   `--me-font-size`.
6. **`auto` unchanged:** the existing `data-use-vscode-theme-color` content block is
   the `auto` rendering and is untouched.
7. **Attribution (MIT):** README **Acknowledgement** credits `github-markdown-css`
   (Sindre Sorhus, MIT); the vendored files keep a provenance header; `DEVELOPMENT.md`
   documents the verbatim-vendor + update step.

## Tests (per AGENTS)
- **Unit** (`html-builder.test.ts`): GitHub theme → active link enabled + other
  `disabled` + body `markdown-body` class; `auto` → both links disabled, no class.
  (`extension.test.ts`): a GitHub theme pins the mode to its own light/dark
  regardless of the VS Code theme; `config-changed` carries `contentTheme` + mode.
- **E2e** (`media-src/e2e/content-theme.spec.ts` — extend): set `theme.content` to
- **E2e** (`media-src/e2e/content-theme.spec.ts`): load the vendored upstream file +
  add the `markdown-body` class; assert the GitHub canvas colour paints and is
  **independent** of a simulated VS Code background (the upstream CSS uses fixed hex,
  no `--vscode-*` vars). The existing `auto`-path assertions stay green unchanged.

## Verify
Open a markdown file. `github-light` → renders like GitHub's light markdown page
(headings, `#0969da` links, bordered tables, grey blockquote bar) even under a dark
VS Code theme; `github-dark` → GitHub dark (`#0d1117` canvas, `#58a6ff` links) even
under a light VS Code theme; `auto` → **looks identical to today** (VS Code editor
colours, following the VS Code light/dark theme). Setting applies live (no reopen).
Code-block syntax colours follow `vmarkd.theme.code`.

## See also
- `25-theme-live-switch.md` — the `set-theme` postMessage + `setTheme` live path.
- `26-live-config-reload.md` — `onDidChangeConfiguration` live re-apply.
- `main.css:13–83` — the `data-use-vscode-theme-color` block `auto` keeps using.
- `media/markdown-themes/` — the vendored upstream CSS files (verbatim).
