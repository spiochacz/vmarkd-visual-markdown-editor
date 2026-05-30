# Task: Lean Vditor init (gate features/renderers on content)

> **Source:** vMark performance audit (open latency — medium)
> **Value / Risk:** 🟧 MED open latency / medium
> **Engines:** none

## Problem
`initVditor` (`media-src/src/main.ts`) constructs Vditor with the full toolbar and
default preview features every time, regardless of what the document actually contains.
Heavy renderers (Mermaid, KaTeX/MathJax, ECharts, abc.js, Graphviz) are lazy-loaded by
Vditor on demand, but init still wires the preview pipeline and toolbar unconditionally.
There is also a defensive `customWysiwygToolbar: () => {}` hook (a Vditor 3.11 init
workaround) worth revisiting.

## Goal
Do the minimum work at init for the common case (plain prose), defer the rest.

> **Background (Vditor 3.11 source):** the heavy diagram/math renderers are
> **alias-gated, not flag-gated** — there are no per-renderer enable/disable options for
> Mermaid/ECharts/Graphviz/Flowchart/ABC/Mindmap/PlantUML. They load via runtime
> `addScript(${cdn}/dist/js/<lib>...)` *only* when a matching code-block alias is
> rendered. So a plain-prose file already pays none of that — the lever is "don't make
> Vditor wire/scan for them," not "disable a flag." Features that **do** have real
> flags: `outline`, `counter`, `resize`, `media`, `comment`, `hljs`.

## Steps
1. **Disable unused real-flag features at init** where they aren't needed:
   `counter`, `resize`, `media`, `comment`, and trim `outline`/`hljs` config. These are
   the only init-time toggles Vditor actually exposes.
2. **Confirm the math engine + local cdn.** No `preview.math.engine` is set, so Vditor
   defaults to KaTeX. Open the webview Network tab and confirm on a math/diagram file:
   (a) **MathJax (6.5 MB) is never fetched** (feeds the VSIX trim in
   `24-ci-cd-pipeline.md`), and (b) renderer scripts load from the **local
   `asWebviewUri` cdn base** (`vditorBaseUri`), **never from `unpkg.com`** — a wrong
   `cdn` override silently adds network latency.
3. **Content-aware init (optional, smaller win):** since renderers are alias-gated,
   the main remaining cost is Vditor's preview pipeline setup. Measure whether skipping
   math/preview config for files with no `$`/diagram blocks meaningfully speeds init
   before investing — it may be marginal.
4. **Trim the default toolbar** to essentials; lazy-add advanced groups. Coordinate with
   `09-toolbar-show-setting.md`.
5. Re-evaluate the `customWysiwygToolbar: () => {}` workaround against current Vditor;
   remove if no longer needed.

> Note: `cache: { enable: false }` is already set in `initVditor` (correct — with
> caching on, Vditor *requires* a `cache.id` or it throws). No change needed there.

## Measure
`console.time` around `initVditor` for (a) a plain prose file vs (b) a file with math +
a Mermaid block; confirm the plain case is materially faster and loads no renderer JS
(Network tab in webview devtools shows no katex/mermaid fetch).

## See also
- `24-ci-cd-pipeline.md` — the MathJax-unused finding gates a VSIX size cut.
- `20-tree-shake-vditor-source-import.md` — bundle is 94 % Vditor; source import needed
  for any core trim.
- `09-toolbar-show-setting.md` — toolbar configurability.

## Verify
Opening a plain markdown file runs no math/diagram renderer fetches and inits faster;
math/diagram documents still render correctly when those blocks are present.
